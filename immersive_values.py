"""Map values for the wall: one month of every panel and period.

JSON (default) maps cell ids to values rounded to 0.01. ``format=i16`` returns
the same cells as compact binary for the wall's map colours:

  bytes 0-3   b"CSI1"
  bytes 4-7   header length H (uint32, little-endian, includes padding)
  next H      JSON header: columns [[metric, period], ...], count, scale, nodata,
              month, member, source, substituted
  then        count × int32 cell ids (ascending), then one count × int16 array
              per column: value × scale, rounded; nodata where missing

Tenths are ample for map colours. The wall's printed figures come from the
regional summaries, not from these values.
"""
import gzip
import json
import os
import struct

try:  # installed with flask-compress; gzip is the fallback
    import brotli
except ImportError:
    brotli = None

import duckdb
import numpy as np
import pyarrow.parquet as pq
from flask import Blueprint, Response, jsonify, request

GRID_MIMETYPE = 'application/vnd.climascope.grid'
GRID_MAGIC = b'CSI1'
GRID_SCALE = 10
GRID_NODATA = -32768

# Metrics and periods served by the immersive wall display
_IMMERSIVE_PANELS  = ('CWBPT', 'Prec_sum', 'Tmax_mean', 'ETPT_sum')
_IMMERSIVE_PERIODS = (
    ('1990-2019', 'obs_value'),   # absolute baseline
    ('2020-2049', 'proj_value'),  # absolute projected
    ('2050-2079', 'proj_value'),  # absolute projected
)




def _column(table, name):
    return table[name].to_numpy(zero_copy_only=False).astype(np.float64)


def _grid_response(entries, include_change, meta):
    columns, id_arrays, value_arrays = [], [], []
    for metric, period, col, path in entries:
        wanted = ['id_1km', 'obs_value', 'proj_value'] if include_change and period == '2050-2079' else ['id_1km', col]
        table = pq.read_table(path, columns=wanted)
        ids = table['id_1km'].to_numpy(zero_copy_only=False).astype(np.int64)
        columns.append([metric, period]); id_arrays.append(ids); value_arrays.append(_column(table, col))
        if include_change and period == '2050-2079':
            # Difference raw values before rounding, as the JSON format does.
            columns.append([metric, '2050-2079_change']); id_arrays.append(ids)
            value_arrays.append(_column(table, 'proj_value') - _column(table, 'obs_value'))
    cells = np.unique(np.concatenate(id_arrays)) if id_arrays else np.empty(0, np.int64)
    block = np.full((len(columns), len(cells)), GRID_NODATA, dtype='<i2')
    for row, (ids, values) in enumerate(zip(id_arrays, value_arrays)):
        finite = np.isfinite(values)
        scaled = np.clip(np.round(values[finite] * GRID_SCALE), -32767, 32767).astype('<i2')
        block[row, np.searchsorted(cells, ids[finite])] = scaled
    header = json.dumps(dict(meta, version=1, columns=columns, count=int(len(cells)),
                             scale=GRID_SCALE, nodata=GRID_NODATA), separators=(',', ':')).encode()
    header += b' ' * ((-(8 + len(header))) % 4)   # keep the int32 ids 4-byte aligned
    body = GRID_MAGIC + struct.pack('<I', len(header)) + header + cells.astype('<i4').tobytes() + block.tobytes()
    # Flask-Compress only handles text types, so compress the binary here.
    accepted = request.headers.get('Accept-Encoding', '')
    if brotli and 'br' in accepted:
        body, encoding = brotli.compress(body, quality=5), 'br'
    elif 'gzip' in accepted:
        body, encoding = gzip.compress(body, 6), 'gzip'
    else:
        encoding = None
    response = Response(body, mimetype=GRID_MIMETYPE)
    if encoding:
        response.headers['Content-Encoding'] = encoding
    response.headers['Vary'] = 'Accept-Encoding'
    response.headers['Cache-Control'] = 'public, max-age=3600'
    return response


# Parameter names match the app globals this route was written against, so its
# body is unchanged from app.py.
def create_values_blueprint(PRECOMP_DIR, _precomp_path, _VALID_MEMBERS, _current_month):
    routes = Blueprint('immersive_values', __name__)

    @routes.route('/api/immersive_values')
    def get_immersive_values():
        """Batch endpoint for the wall display.

        Returns the requested metrics (default all 4) × 3 periods in one response:
          {metric: {period: {id_1km_str: value}}, "_meta": {...}}

        Column logic mirrors /api/values with ?col= param:
          - 1990-2019  → obs_value  (absolute baseline)
          - 2020-2049, 2050-2079 → proj_value (absolute projected)
          - Specific member + future period + member parquet present → same absolute column from member parquet

        ?metrics=CWBPT,Prec_sum limits the payload to the panels actually drawn.
        ?change=1 adds 2050-2079_change from raw proj_value minus obs_value before
        rounding. The change shares the later period's member/substitution source.
        "_meta" records, per metric and period, whether values are observed, the
        ensemble mean or the member, and lists any member→mean substitution so the
        wall never labels substituted values as the member.

        Values are rounded to 0.01 (map colouring only; the wall's numbers and
        charts come from the precomputed regional summaries), which roughly halves
        the JSON. Uses a single UNION ALL query across the parquet files so DuckDB
        can parallelise the reads. flask_compress (already active globally)
        brotli-compresses the three wall metrics to ~3.6 MB for one month.
        """
        month  = request.args.get('month', str(_current_month()))
        member = request.args.get('member', None)

        metrics_arg = request.args.get('metrics')
        if metrics_arg:
            metrics = tuple(m for m in _IMMERSIVE_PANELS if m in set(metrics_arg.split(',')))
            unknown = set(metrics_arg.split(',')) - set(_IMMERSIVE_PANELS)
            if unknown or not metrics:
                return jsonify({'error': f'metrics must be drawn from {list(_IMMERSIVE_PANELS)}'}), 400
        else:
            metrics = _IMMERSIVE_PANELS

        try:
            month_int = int(month)
            if not 1 <= month_int <= 12:
                raise ValueError
        except ValueError:
            return jsonify({'error': 'month must be 1–12'}), 400
        month = str(month_int)
        include_change = request.args.get('change') == '1'

        if member and member != 'mean':
            if member not in _VALID_MEMBERS:
                return jsonify({'error': f'invalid member {member!r}'}), 400

        # Collect (metric, period, col, path) for every combination that exists on disk.
        # Paths are constructed from server-side constants; only month is user-supplied
        # (validated above to be a digit 1–12, so safe to embed in filesystem paths).
        parts  = []   # SQL fragments for UNION ALL
        entries = []  # (metric, period, column, path) for the binary format
        params = []   # positional params for metric/period labels and path
        source = {m: {} for m in metrics}   # metric → period → observed|mean|member|missing
        substituted = []

        for metric in metrics:
            for period, default_col in _IMMERSIVE_PERIODS:
                col = default_col
                if period == '1990-2019':
                    path = _precomp_path(metric, period, month)
                    source[metric][period] = 'observed'
                elif member and member != 'mean':
                    member_path = os.path.join(
                        PRECOMP_DIR, f"Metric={metric}", f"Period={period}",
                        f"Month={month}", f"Member={member}.parquet"
                    )
                    if os.path.exists(member_path):
                        path = member_path
                        source[metric][period] = 'member'
                    else:
                        path = _precomp_path(metric, period, month)
                        source[metric][period] = 'mean'
                        substituted.append({'metric': metric, 'period': period})
                else:
                    path = _precomp_path(metric, period, month)
                    source[metric][period] = 'mean'

                if not os.path.exists(path):
                    source[metric][period] = 'missing'
                    continue

                entries.append((metric, period, col, path))
                # col comes from _IMMERSIVE_PERIODS (hardcoded); double-quote it for DuckDB.
                # metric, period and path are passed as ? params.
                parts.append(
                    f'SELECT ? AS metric, ? AS period, id_1km,'
                    f' round(CAST("{col}" AS DOUBLE), 2) AS value'
                    f' FROM read_parquet(?)'
                )
                params.extend([metric, period, path])
                if include_change and period == '2050-2079':
                    # Difference raw source values before rounding; missing operands stay missing.
                    parts.append(
                        'SELECT ? AS metric, ? AS period, id_1km,'
                        ' CASE WHEN isfinite(proj_value) AND isfinite(obs_value)'
                        ' THEN round(CAST(proj_value AS DOUBLE) - CAST(obs_value AS DOUBLE), 2)'
                        ' ELSE NULL END AS value FROM read_parquet(?)'
                    )
                    params.extend([metric, '2050-2079_change', path])

        if request.args.get('format') == 'i16':
            meta = {
                'month': month_int,
                'member': member if member and member != 'mean' else 'mean',
                'metrics': list(metrics),
                'source': source,
                'substituted': substituted,
                'change': '2050-2079 proj_value minus obs_value, before rounding' if include_change else None,
            }
            return _grid_response(entries, include_change, meta)

        result = {m: {p: {} for p, _ in _IMMERSIVE_PERIODS} for m in metrics}
        if include_change:
            for values in result.values():
                values['2050-2079_change'] = {}

        if parts:
            con = duckdb.connect(':memory:')
            try:
                rows = con.execute(' UNION ALL '.join(parts), params).fetchall()
                for (metric, period, id_1km, value) in rows:
                    result[metric][period][str(id_1km)] = value
            finally:
                con.close()

        result['_meta'] = {
            'month': month_int,
            'member': member if member and member != 'mean' else 'mean',
            'metrics': list(metrics),
            'source': source,
            'substituted': substituted,
            'change': '2050-2079 proj_value minus obs_value, rounded to 0.01' if include_change else None,
        }
        resp = jsonify(result)
        resp.headers['Cache-Control'] = 'public, max-age=3600'
        return resp

    return routes
