"""Catchment class areas from Jess's tables: /api/catchment.

Moved from app.py. init_catchment_api() supplies the app's lookups as module
globals; tests patch them on this module.
"""
import json
import logging
import math
import time
from functools import lru_cache
from urllib.parse import quote as _url_quote

import duckdb
from flask import Blueprint, current_app, jsonify, request

JESS_ROOT = JESS_CWR_ROOT = None
_VALID_MEMBERS = frozenset()
_COUNCIL_CATCHMENTS = {}
_CATCHMENT_NAMES = frozenset()
_CATCHMENT_CELLS = {}
MAX_AOI_CELL_IDS = 0
_validated_ids = _json_object = _current_month = get_councils = None

routes = Blueprint('catchment', __name__)


class CatchmentDataUnavailable(LookupError):
    pass


@lru_cache(maxsize=256)
def _catchment_cached(variable, metric, month, period, scenario, scope_str,
                      member='mean', aoi_weights=()):
    # Target the exact partitioned file — DuckDB cannot partition-prune
    # URL-encoded directory names like Variable=Land%20Use (space encoded as %20 on disk),
    # so the /**/*.parquet glob would scan all ~40 files instead of one.
    v_enc = _url_quote(variable, safe='')
    root  = JESS_CWR_ROOT if metric in ('CWRPM', 'CWRPT') else JESS_ROOT
    path  = f"{root}/Variable={v_enc}/Period={period}/Metric={metric}/*.parquet"

    weights = dict(aoi_weights) if scope_str == 'aoi' else None
    names = None
    if scope_str == 'aoi':
        names = list(weights)
    elif scope_str.startswith('catchment:'):
        names = [scope_str[len('catchment:'):]]
    elif scope_str.startswith('council:'):
        names = list(dict.fromkeys(_COUNCIL_CATCHMENTS.get(scope_str[len('council:'):], [])))
    if names == []:
        return '[]'

    selected = sorted(_VALID_MEMBERS) if member == 'mean' else [member]
    members_sql = ','.join('?' for _ in selected)
    where_scope = '' if names is None else ' AND catchment_name IN (' + ','.join('?' for _ in names) + ')'
    scope_params = [] if names is None else names
    with duckdb.connect() as db:
        db.execute('SET threads=2')
        available = db.execute(f"""
            SELECT catchment_name,
                   COUNT(DISTINCT CASE WHEN Member IN ({members_sql}) THEN Member END)
            FROM read_parquet(?, hive_partitioning=false)
            WHERE Month = ? AND Scenario = ? {where_scope}
            GROUP BY catchment_name
        """, [*selected, path, month, scenario, *scope_params]).fetchall()
        if any(count != len(selected) for _, count in available):
            raise CatchmentDataUnavailable('Catchment data is incomplete for the selected member.')
        source = db.execute(f"""
            SELECT catchment_name, Type, class, SUM(total_area_HA)::DOUBLE / ?
            FROM read_parquet(?, hive_partitioning=false)
            WHERE Month = ? AND Scenario = ? AND Member IN ({members_sql}) {where_scope}
            GROUP BY catchment_name, Type, class
        """, [len(selected), path, month, scenario, *selected, *scope_params]).fetchall()

    classes = ['Strong Deficit', 'Moderate Deficit', 'Moderate Surplus', 'Strong Surplus']
    totals = {}
    for catchment_name, cover, category, area in source:
        if category not in classes or not math.isfinite(area) or area < 0:
            raise CatchmentDataUnavailable('Invalid catchment class areas.')
        values = totals.setdefault(cover, dict.fromkeys(classes, 0.0))
        values[category] += area * (weights[catchment_name] if weights is not None else 1.0)
    rows = []
    for cover, values in totals.items():
        rounded = {category: round(area) for category, area in values.items()}
        rows.append({'type': cover, 'total_ha': sum(rounded.values()), 'classes': rounded})
    rows.sort(key=lambda x: x['total_ha'], reverse=True)
    if variable == 'LCA':
        for row in rows:
            code = str(row['type'])
            row['type'] = _LCA_LABELS.get(code, code)
    return json.dumps(rows)


_LCA_LABELS = {
    '1':    '1 · Best arable',
    '2':    '2 · Prime arable',
    '3.1':  '3.1 · Mixed agri',
    '3.2':  '3.2 · Mixed agri',
    '4.1':  '4.1 · Mixed agri',
    '4.2':  '4.2 · Mixed agri',
    '5.1':  '5.1 · Grassland',
    '5.2':  '5.2 · Grassland',
    '5.3':  '5.3 · Grassland',
    '6.1':  '6.1 · Rough gr.',
    '6.2':  '6.2 · Rough gr.',
    '6.3':  '6.3 · Rough gr.',
    '7':    '7 · Marginal',
    '888':  'Urban',
    '999':  'Water',
    '9500': 'Coastal',
}

_PERIOD_SCENARIO = {
    '1960-1989': 'Baseline',
    '1990-2019': 'Baseline',
    '2020-2049': 'Projected',
    '2050-2079': 'Projected',
}

@routes.route('/api/catchment', methods=['GET', 'POST'])
def catchment():
    params = _json_object() if request.method == 'POST' else request.args
    variable = params.get('variable', 'Land Use')
    metric = params.get('metric', 'CWBPT')
    period = params.get('period', '2050-2079')
    member = params.get('member', 'mean')
    scope = 'aoi' if request.method == 'POST' else params.get('scope', 'national')
    try:
        month = int(str(params.get('month', _current_month())))
    except (TypeError, ValueError):
        return jsonify(error='month must be 1-12'), 400
    if not 1 <= month <= 12:
        return jsonify(error='month must be 1-12'), 400
    if variable not in ('Land Use', 'Farm Type', 'LCA', 'Peat Condition', 'NA'):
        return jsonify(error='unknown variable'), 400
    if metric not in ('CWBPT', 'CWBPM', 'CWRPT', 'CWRPM'):
        return jsonify(error='unknown metric'), 400
    if period not in ('1960-1989', '1990-2019', '2020-2049', '2050-2079'):
        return jsonify(error='unknown period'), 400
    if not isinstance(member, str) or (member != 'mean' and member not in _VALID_MEMBERS):
        return jsonify(error='invalid ensemble member'), 400

    weights = ()
    if scope == 'aoi':
        aoi_set = _validated_ids(params.get('aoi_ids', []), limit=MAX_AOI_CELL_IDS, field='aoi_ids')
        if not aoi_set:
            return jsonify(error='aoi_ids required'), 400
        weights = tuple(sorted(
            (name, len(cells & aoi_set) / len(cells))
            for name, cells in _CATCHMENT_CELLS.items() if cells & aoi_set
        ))
        scope_label = 'Drawn area · estimated catchment shares'
        spatial_method = 'catchment totals weighted by intersecting grid-cell counts'
    elif scope == 'national':
        scope_label = 'Scotland · available catchments'
        spatial_method = 'whole catchments'
    elif scope.startswith('council:'):
        council = scope[len('council:'):]
        known = get_councils()
        if council not in _COUNCIL_CATCHMENTS and (known is None or council not in set(known['council_name'])):
            return jsonify(error=f'unknown council: {council}'), 404
        # Dundee City and North Lanarkshire have no linked catchments: an empty result, not an error.
        scope_label = ('Catchments linked to ' if _COUNCIL_CATCHMENTS.get(council) else 'No catchments linked to ') + council
        spatial_method = 'whole catchments linked by the council lookup'
    elif scope.startswith('catchment:'):
        name = scope[len('catchment:'):]
        if name not in _CATCHMENT_NAMES:
            return jsonify(error=f'unknown catchment: {name}'), 404
        scope_label = name
        spatial_method = 'whole catchment'
    else:
        return jsonify(error='scope must be national, council:<name>, or catchment:<name>'), 400

    try:
        result = _catchment_cached(variable, metric, month, period,
                                   _PERIOD_SCENARIO[period], scope, member, weights)
        return jsonify(
            variable=variable, metric=metric, month=month, period=period, scope=scope,
            member=member, scope_label=scope_label, spatial_method=spatial_method,
            ensemble_label='Mean class areas · 12 members' if member == 'mean' else 'Member ' + member,
            rows=json.loads(result),
        )
    except CatchmentDataUnavailable as exc:
        return jsonify(error=str(exc)), 503
    except duckdb.IOException:
        current_app.logger.exception('catchment source unavailable')
        return jsonify(error='Requested catchment data is unavailable.'), 503
    except Exception:
        current_app.logger.exception('catchment query failed')
        return jsonify(error='catchment analysis failed'), 500


def _prewarm_catchment():
    # Warm one national query per variable to prime OS page cache for each parquet
    # file. After this, any council query for the same (variable, metric, period)
    # hits OS cache and completes in ~0.3s instead of ~8s cold.
    combos = [
        ('Land Use',      'CWBPT', 5, '2050-2079', 'Projected'),
        ('Farm Type',     'CWBPT', 5, '2050-2079', 'Projected'),
        ('LCA',           'CWBPT', 5, '2050-2079', 'Projected'),
        ('Peat Condition','CWBPT', 5, '2050-2079', 'Projected'),
    ]
    t_total = time.time()
    for args in combos:
        try:
            t0 = time.time()
            _catchment_cached(*args, 'national')
            logging.info('Catchment prewarm %s done in %.2fs', args[0], time.time() - t0)
        except Exception:
            logging.exception('Catchment prewarm %s failed (non-fatal)', args[0])
    logging.info('Catchment prewarm complete in %.2fs', time.time() - t_total)


def init_catchment_api(app, prewarm, **dependencies):
    globals().update(dependencies)
    app.register_blueprint(routes)
    if prewarm:
        _prewarm_catchment()
