import os, json, uuid, math, glob as _glob, logging, time, sqlite3, base64, shutil, threading
from collections import deque
from urllib.parse import quote as _url_quote, urlencode as _urlencode
from urllib.request import Request as _UrlRequest, urlopen as _urlopen
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, request, send_from_directory, Response

import geopandas as gpd
import pandas as pd
import pyarrow.dataset as ds
import pyarrow.parquet as pq
from shapely.geometry import shape, Point, mapping
from shapely.ops import transform as shp_transform
from pyproj import Transformer
from shapely.geometry import box
from functools import lru_cache
from flask_compress import Compress
import duckdb

_APP_DIR = os.path.dirname(os.path.abspath(__file__))
def _data(rel): return os.path.join(_APP_DIR, rel)

FACTS_DIR  = os.environ.get("FACTS_DIR",  _data("data/facts_catalog"))
GRID_FILE  = os.environ.get("GRID_FILE",  _data("data/grid.parquet"))
OUTPUT_DIR  = os.environ.get("OUTPUT_DIR",  _data("data/outputs"))
PRECOMP_DIR = os.environ.get("PRECOMP_DIR", _data("data/precomputed"))
COG_DIR      = os.environ.get("COG_DIR",      _data("data/cogs"))
MBTILES_FILE = os.environ.get("MBTILES_FILE", _data("data/tiles/grid.mbtiles"))
WEB_EPSG    = 4326
UK_TIMEZONE = ZoneInfo("Europe/London")
AREA_LIMIT_M2 = 200_000_000
# Drawn analyses/exports may be much larger than an interactive bbox.  Highland,
# Scotland's largest council, is ~26,022 km²; allow ~15% hand-drawing tolerance.
AOI_AREA_LIMIT_M2 = int(os.environ.get("AOI_AREA_LIMIT_M2", 30_000_000_000))
HILLSHADE_EXPORT_AREA_LIMIT_M2 = int(os.environ.get("HILLSHADE_EXPORT_AREA_LIMIT_M2", 100_000_000))
HILLSHADE_EXPORT_MAX_PIXELS = int(os.environ.get("HILLSHADE_EXPORT_MAX_PIXELS", 1_500_000))
HILLSHADE_EXPORT_MAX_DIMENSION = int(os.environ.get("HILLSHADE_EXPORT_MAX_DIMENSION", 1_600))
MAX_AOI_COORDINATES = int(os.environ.get("MAX_AOI_COORDINATES", 50_000))
MAX_AOI_CELL_IDS = int(os.environ.get("MAX_AOI_CELL_IDS", 35_000))
MAX_REQUEST_CELL_IDS = int(os.environ.get("MAX_REQUEST_CELL_IDS", 100_000))
MAX_FILTER_RULES = int(os.environ.get("MAX_FILTER_RULES", 20))
OUTPUT_MAX_AGE_SECONDS = int(os.environ.get("OUTPUT_MAX_AGE_SECONDS", 86_400))
MAX_JSON_BYTES = int(os.environ.get("MAX_JSON_BYTES", 5 * 1024 * 1024))

# ── Metric availability scan (runs once at import under --preload)
_EXPECTED_PERIODS = ("2020-2049", "2050-2079")
_EXPECTED_MONTHS  = 12

def _scan_metric_availability() -> dict:
    out = {}
    for d in sorted(_glob.glob(os.path.join(PRECOMP_DIR, "Metric=*"))):
        metric = os.path.basename(d).split("=", 1)[1]
        periods = {}
        for p in _EXPECTED_PERIODS:
            files = _glob.glob(os.path.join(d, f"Period={p}", "Month=*.parquet"))
            periods[p] = len(files)
        complete = all(periods.get(p, 0) == _EXPECTED_MONTHS for p in _EXPECTED_PERIODS)
        out[metric] = {"periods": periods, "complete": complete}
    return out

_METRIC_AVAILABILITY: dict = _scan_metric_availability()
logging.getLogger("gunicorn.error").info(
    "Metric availability: %s",
    {k: v["complete"] for k, v in _METRIC_AVAILABILITY.items()}
)

COUNCILS_FILE    = os.environ.get("COUNCILS_FILE",    _data("data/councils.gpkg"))
CATCHMENTS_FILE  = os.environ.get("CATCHMENTS_FILE",  _data("data/catchments.gpkg"))

WET_FILE = os.environ.get("WET_FILE", _data("data/soilwet_fractions.parquet"))
_wet = None
def get_wet():
    global _wet
    if _wet is None:
        _wet = pd.read_parquet(WET_FILE)[["id_1km","wetn_class_smd","frac"]].copy()
        _wet["id_1km"] = _wet["id_1km"].astype(int)
        _wet["wetn_class_smd"] = _wet["wetn_class_smd"].astype(int)
        _wet["frac"] = _wet["frac"].astype(float).clip(0,1)
    return _wet

SOILWET_SUMMARY = os.environ.get(
    "SOILWET_SUMMARY",
    _data("data/soilwet_parquet/soilwet_cell_summary.parquet")
)

_soilwet = None

app = Flask(__name__, static_url_path="/static", static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = MAX_JSON_BYTES
Compress(app)


class InvalidSelection(ValueError):
    """A client supplied an unsupported climate data selector."""


@app.errorhandler(InvalidSelection)
def _invalid_selection(exc):
    return jsonify({"error": str(exc)}), 400


@app.errorhandler(413)
def _request_too_large(_exc):
    return jsonify({"error": f"request body exceeds {MAX_JSON_BYTES // (1024 * 1024)} MB"}), 413


@app.after_request
def _security_headers(resp):
    # CSP still permits inline styles because MapLibre and the current UI set
    # style attributes dynamically. Scripts are version-pinned with SRI in the
    # templates and inline script execution remains disabled.
    resp.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; "
        "script-src 'self' https://unpkg.com https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' https://unpkg.com; "
        "img-src 'self' data: blob: https://server.arcgisonline.com; "
        "connect-src 'self' https://server.arcgisonline.com; "
        "font-src 'self' data:; worker-src 'self' blob:; "
        "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; "
        "upgrade-insecure-requests"
    )
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    return resp


_RATE_BUCKETS = {}
_RATE_LOCK = threading.Lock()


def _check_process_rate(bucket: str, limit: int, window_seconds: int = 60):
    """Small per-worker backstop for costly public endpoints.

    The reverse proxy remains the right place for a site-wide/IP-aware limit;
    this cap is deliberately process-global so it is safe when proxy addresses
    mask individual clients.
    """
    now = time.monotonic()
    with _RATE_LOCK:
        calls = _RATE_BUCKETS.setdefault(bucket, deque())
        while calls and calls[0] <= now - window_seconds:
            calls.popleft()
        if len(calls) >= limit:
            return False, max(1, math.ceil(window_seconds - (now - calls[0])))
        calls.append(now)
    return True, None


def _rate_limited(bucket: str, limit: int):
    ok, retry_after = _check_process_rate(bucket, limit)
    if ok:
        return None
    resp = jsonify({"error": "rate limit exceeded; try again shortly"})
    resp.status_code = 429
    resp.headers["Retry-After"] = str(retry_after)
    return resp


def _json_object():
    body = request.get_json(force=True, silent=True)
    if not isinstance(body, dict):
        raise InvalidSelection("JSON object required")
    return body

_grid = None
_dset = None
_grid_web = None
_grid_sindex = None

LC_FRACTIONS = os.environ.get("LC_FRACTIONS", "./data/landcover_fractions.parquet")
_lc = None
_lc_classes = None

HABITAT_FRACTIONS = os.environ.get(
    "HABITAT_FRACTIONS", _data("data/habitat_fractions.parquet")
)
_habitat = None
_habitat_classes = None

# Compact, colour-safe presentation groups derived from NatureScot HLCM 2022's
# 28 EUNIS level-2 classes. The parquet retains the source class on every row;
# these groups keep the map legend and dashboard readable.
HABITAT_GROUP_COLORS = {
    1: "#3b82f6",  # water
    2: "#7c3aed",  # wetlands
    3: "#a3c95b",  # grasslands
    4: "#b77963",  # scrub and tall vegetation
    5: "#1f7a4d",  # woodland
    6: "#8b8175",  # rock, scree and bare ground
    7: "#e58b3a",  # arable
    8: "#52525b",  # built-up
    9: "#e879c5",  # coastal dunes and shores
}

_councils_gdf   = None
_catchments_gdf = None

def get_lc():
    global _lc, _lc_classes
    if _lc is None:
        df = pd.read_parquet(LC_FRACTIONS)
        df["lc_code"] = df["lc_code"].astype(int)
        df["frac"]    = df["frac"].astype(float)
        _lc = df
        _lc_classes = (
            df[["lc_code","lc_name"]]
            .drop_duplicates()
            .sort_values("lc_code")
            .to_dict(orient="records")
        )
    return _lc, _lc_classes


def get_habitat():
    """Load exact 1 km habitat fractions, grouped for presentation."""
    global _habitat, _habitat_classes
    if _habitat is None:
        df = pd.read_parquet(HABITAT_FRACTIONS)
        required = {"id_1km", "group_code", "group_name", "frac", "area_frac"}
        if not required.issubset(df.columns):
            raise ValueError("habitat fractions have an unexpected schema")
        df = df[["id_1km", "group_code", "group_name", "frac", "area_frac"]].copy()
        df["id_1km"] = df["id_1km"].astype(int)
        df["group_code"] = df["group_code"].astype(int)
        df["frac"] = df["frac"].astype(float).clip(0, 1)
        df["area_frac"] = df["area_frac"].astype(float).clip(0, 1)
        _habitat = (
            df.groupby(
                ["id_1km", "group_code", "group_name"], as_index=False
            )[["frac", "area_frac"]]
            .sum()
        )
        _habitat_classes = [
            {
                "group_code": int(code),
                "group_name": str(name),
                "color": HABITAT_GROUP_COLORS.get(int(code), "#94a3b8"),
            }
            for code, name in (
                _habitat[["group_code", "group_name"]]
                .drop_duplicates()
                .sort_values("group_code")
                .itertuples(index=False, name=None)
            )
        ]
    return _habitat, _habitat_classes

def get_soilwet():
    global _soilwet
    if _soilwet is None:
        df = pd.read_parquet(SOILWET_SUMMARY)
        df["id_1km"] = df["id_1km"].astype(int)
        _soilwet = df
    return _soilwet

def get_grid_web():
    global _grid_web, _grid_sindex
    if _grid_web is not None:
        return _grid_web, _grid_sindex
    g = gpd.read_parquet(GRID_FILE)
    if g.crs is None:
        xmin, ymin, xmax, ymax = g.total_bounds
        g.set_crs(27700 if max(map(abs, [xmin, xmax, ymin, ymax])) > 360 else 4326, inplace=True)
    if g.crs.to_epsg() != WEB_EPSG:
        g = g.to_crs(WEB_EPSG)
    _grid_web = g[["id_1km", "geometry"]].copy()
    try:
        _grid_sindex = _grid_web.sindex
    except Exception:
        _grid_sindex = None
    return _grid_web, _grid_sindex


def get_councils():
    global _councils_gdf
    if _councils_gdf is not None:
        return _councils_gdf
    if not os.path.exists(COUNCILS_FILE):
        return None
    gdf = gpd.read_file(COUNCILS_FILE)

    # Normalise the name column — handle various source schemas
    name_col = None
    for candidate in ["council_name", "LAD22NM", "local_authority", "name", "Name", "NAME"]:
        if candidate in gdf.columns:
            name_col = candidate
            break
    if name_col is None:
        for col in gdf.columns:
            if col != "geometry" and gdf[col].dtype == object:
                name_col = col
                break

    if name_col and name_col != "council_name":
        gdf = gdf.rename(columns={name_col: "council_name"})

    if gdf.crs is None:
        gdf.set_crs(27700, inplace=True)
    if gdf.crs.to_epsg() != WEB_EPSG:
        gdf = gdf.to_crs(WEB_EPSG)

    # Simplify geometry for faster serving (5m tolerance in BNG equiv)
    gdf["geometry"] = gdf["geometry"].simplify(0.001, preserve_topology=True)

    _councils_gdf = gdf[["council_name", "geometry"]].copy()
    return _councils_gdf


def get_catchments():
    """Lazy-load SEPA catchment polygons (WGS84). Mirrors get_councils()."""
    global _catchments_gdf
    if _catchments_gdf is not None:
        return _catchments_gdf
    if not os.path.exists(CATCHMENTS_FILE):
        return None
    gdf = gpd.read_file(CATCHMENTS_FILE)
    if gdf.crs is None or gdf.crs.to_epsg() != WEB_EPSG:
        gdf = gdf.to_crs(WEB_EPSG)
    _catchments_gdf = gdf[["catchment_name", "category", "geometry"]].copy()
    return _catchments_gdf


def _build_council_cells() -> dict:
    gdf = get_councils()
    if gdf is None:
        return {}
    grid_web, sindex = get_grid_web()
    mapping = {}
    t0 = time.perf_counter()
    for _, row in gdf.iterrows():
        geom = row.geometry
        qpoly = box(*geom.bounds)
        if sindex is not None:
            try:
                idx = list(sindex.query(qpoly, predicate="intersects"))
            except AttributeError:
                idx = list(sindex.intersection(qpoly.bounds))
            sub = grid_web.iloc[idx]
        else:
            sub = grid_web[grid_web.intersects(qpoly)]
        sub = sub[sub.intersects(geom)]
        mapping[row["council_name"]] = frozenset(sub["id_1km"].tolist())
    elapsed = time.perf_counter() - t0
    total_cells = sum(len(v) for v in mapping.values())
    msg = (f"Council cell index built in {elapsed:.2f}s "
           f"({len(mapping)} councils, {total_cells} cells)")
    logging.getLogger("gunicorn.error").info(msg)
    logging.info(msg)
    return mapping


_COUNCIL_CELLS: dict = _build_council_cells()

_CATCHMENT_LOOKUP = pd.read_csv('data/catchment_council_lookup.csv')
_COUNCIL_CATCHMENTS: dict = (
    _CATCHMENT_LOOKUP.groupby('council')['catchment_name']
    .apply(list)
    .to_dict()
)
# Fast O(1) validation for catchment:<name> scope
_CATCHMENT_NAMES: frozenset = frozenset(_CATCHMENT_LOOKUP['catchment_name'])
logging.info('Catchment lookup loaded: %d catchments, %d councils',
             len(_CATCHMENT_LOOKUP), len(_COUNCIL_CATCHMENTS))


def _build_catchment_cells() -> dict:
    gdf = get_catchments()
    if gdf is None:
        return {}
    grid_web, _ = get_grid_web()
    t0 = time.perf_counter()
    # Single vectorised sjoin is faster than 1026 individual spatial joins
    joined = gpd.sjoin(
        grid_web[["id_1km", "geometry"]],
        gdf[["catchment_name", "geometry"]],
        how="inner", predicate="intersects"
    )
    mapping = {
        name: frozenset(grp.tolist())
        for name, grp in joined.groupby("catchment_name")["id_1km"]
    }
    elapsed = time.perf_counter() - t0
    total_cells = sum(len(v) for v in mapping.values())
    msg = (f"Catchment cell index built in {elapsed:.2f}s "
           f"({len(mapping)} catchments, {total_cells} cell-slots)")
    logging.getLogger("gunicorn.error").info(msg)
    logging.info(msg)
    return mapping


_CATCHMENT_CELLS: dict = _build_catchment_cells()

# Reverse lookup (id_1km int to name) derived from the forward indexes above
_CELL_COUNCIL: dict = {
    cell: name
    for name, cells in _COUNCIL_CELLS.items()
    for cell in cells
}
_CELL_CATCHMENT: dict = {
    cell: name
    for name, cells in _CATCHMENT_CELLS.items()
    for cell in cells
}


@lru_cache(maxsize=256)
def slice_facts(metric, period, month, member):
    metric, period, month_s, member = _validated_climate_selection(metric, period, month, member)
    month = int(month_s)
    if not member:
        precomp = _precomp_path(metric, period, str(month))
        if os.path.exists(precomp):
            return pd.read_parquet(precomp, columns=["id_1km", "Change"])
    else:
        # Prefer precomputed member parquet when available
        member_precomp = _resolve_precomp_path(metric, period, str(month), member)
        if os.path.exists(member_precomp):
            return pd.read_parquet(member_precomp, columns=["id_1km", "Change"])

    dset = get_dset()
    filt = (ds.field("Metric")==metric) & (ds.field("Period")==period) & (ds.field("Month")==month)
    cols = ["id_1km","Change"]
    if member:
        # Raw dataset stores member as float string: "1.0", "7.0", not "01", "07"
        try:
            member_raw = f"{int(member)}.0"
        except (ValueError, TypeError):
            member_raw = str(member)
        filt = filt & (ds.field("Member") == member_raw)
        cols.append("Member")
    tbl = dset.to_table(columns=cols, filter=filt)
    df  = tbl.to_pandas()
    if df.empty: return df
    if not member:
        df = df.groupby("id_1km", as_index=False)["Change"].mean()
    return df

def get_grid():
    global _grid
    if _grid is None:
        _grid = gpd.read_parquet(GRID_FILE)
        if _grid.crs is None:
            _grid.set_crs(27700, inplace=True)
    return _grid


def _coordinate_count(value) -> int:
    if isinstance(value, (list, tuple)):
        if value and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in value):
            return 1
        return sum(_coordinate_count(v) for v in value)
    return 0


def _validated_aoi(geom_gj, properties=None):
    """Return (WGS84 geometry, BNG geometry, area_m2) for a bounded AOI."""
    if not isinstance(geom_gj, dict):
        raise InvalidSelection("geometry must be a GeoJSON object")
    if _coordinate_count(geom_gj.get("coordinates")) > MAX_AOI_COORDINATES:
        raise InvalidSelection(f"geometry exceeds {MAX_AOI_COORDINATES:,} coordinates")
    try:
        geom = shape(geom_gj)
    except Exception as exc:
        raise InvalidSelection("invalid GeoJSON geometry") from exc
    if geom.is_empty or not geom.is_valid:
        raise InvalidSelection("geometry must be non-empty and valid")
    if any(not math.isfinite(v) for v in geom.bounds):
        raise InvalidSelection("geometry bounds must be finite")

    to_bng = Transformer.from_crs(WEB_EPSG, 27700, always_xy=True).transform
    to_web = Transformer.from_crs(27700, WEB_EPSG, always_xy=True).transform
    props = properties if isinstance(properties, dict) else {}
    if geom.geom_type == "Point" and "radius" in props:
        try:
            radius_m = float(props["radius"])
        except (TypeError, ValueError) as exc:
            raise InvalidSelection("radius must be a number") from exc
        if not math.isfinite(radius_m) or radius_m <= 0:
            raise InvalidSelection("radius must be greater than zero")
        geom_bng = shp_transform(to_bng, geom).buffer(radius_m)
        geom = shp_transform(to_web, geom_bng)
    elif geom.geom_type in ("Polygon", "MultiPolygon"):
        geom_bng = shp_transform(to_bng, geom)
    else:
        raise InvalidSelection("geometry must be a Polygon, MultiPolygon, or radius Point")

    area_m2 = float(geom_bng.area)
    if not math.isfinite(area_m2) or area_m2 <= 0:
        raise InvalidSelection("geometry has no measurable area")
    if area_m2 > AOI_AREA_LIMIT_M2:
        raise InvalidSelection(
            f"drawn area is {area_m2 / 1e6:,.0f} km²; maximum is "
            f"{AOI_AREA_LIMIT_M2 / 1e6:,.0f} km² (approximately Scotland's largest council)"
        )
    return geom, geom_bng, area_m2


def _validated_ids(values, *, limit=MAX_REQUEST_CELL_IDS, field="ids") -> frozenset:
    if not isinstance(values, list):
        raise InvalidSelection(f"{field} must be a list")
    if len(values) > limit:
        raise InvalidSelection(f"{field} exceeds the {limit:,}-cell limit")
    try:
        ids = frozenset(int(v) for v in values if not isinstance(v, bool))
    except (TypeError, ValueError) as exc:
        raise InvalidSelection(f"{field} must contain integer cell IDs") from exc
    if len(ids) != len(values):
        raise InvalidSelection(f"{field} must contain unique integer cell IDs")
    if any(v < 0 for v in ids):
        raise InvalidSelection(f"{field} must contain positive cell IDs")
    return ids


def _csv_safe(df: pd.DataFrame) -> pd.DataFrame:
    """Prevent spreadsheet formula execution in downloaded CSV text fields."""
    out = df.copy()
    for col in out.select_dtypes(include=["object", "string"]).columns:
        out[col] = out[col].map(
            lambda v: "'" + v if isinstance(v, str) and v.startswith(("=", "+", "-", "@", "\t", "\r")) else v
        )
    return out


_LAST_OUTPUT_CLEANUP = 0.0


def _cleanup_old_outputs():
    global _LAST_OUTPUT_CLEANUP
    now = time.time()
    if now - _LAST_OUTPUT_CLEANUP < 900:
        return
    _LAST_OUTPUT_CLEANUP = now
    try:
        for entry in os.scandir(OUTPUT_DIR):
            if entry.is_dir(follow_symlinks=False) and now - entry.stat().st_mtime > OUTPUT_MAX_AGE_SECONDS:
                shutil.rmtree(entry.path, ignore_errors=True)
    except FileNotFoundError:
        pass
    except OSError:
        app.logger.exception("old output cleanup failed")

def get_dset():
    global _dset
    if _dset is None:
        _dset = ds.dataset(FACTS_DIR, format="parquet", partitioning="hive")
    return _dset

def _asset_v(rel_path: str) -> str:
    """Return mtime-based version string for a static asset (cache-busting)."""
    try:
        full = os.path.join(_APP_DIR, "static", rel_path)
        return str(int(os.path.getmtime(full)))
    except OSError:
        return "0"

app.jinja_env.globals["av"] = _asset_v

def _current_month() -> int:
    """Calendar month in the app's UK operating timezone."""
    return datetime.now(UK_TIMEZONE).month

@app.route("/")
def index():
    from flask import render_template, make_response
    month = _current_month()
    resp = make_response(render_template(
        "index.html",
        default_month=month,
        default_month_name=datetime(2000, month, 1).strftime("%B"),
    ))
    resp.headers["Cache-Control"] = "no-store"
    return resp

@app.route("/immersive")
def immersive():
    from flask import render_template, make_response
    resp = make_response(render_template("immersive.html"))
    resp.headers["Cache-Control"] = "no-store"
    return resp

@app.route("/immersive/control")
def immersive_control():
    from flask import render_template, make_response
    resp = make_response(render_template("immersive_control.html"))
    resp.headers["Cache-Control"] = "no-store"
    return resp


_OS_NAMES_ENDPOINT = "https://api.os.uk/search/names/v1/find"
_OS_NAMES_BOUNDS = "0,530000,470000,1220000"


@lru_cache(maxsize=512)
def _os_names_search(query: str) -> tuple:
    key = os.environ.get("OS_NAMES_API_KEY", "").strip()
    if not key:
        return ()
    url = _OS_NAMES_ENDPOINT + "?" + _urlencode({
        "query": query, "key": key, "bounds": _OS_NAMES_BOUNDS, "maxresults": 8,
    })
    req = _UrlRequest(url, headers={"User-Agent": "ClimaScope/1.0"})
    with _urlopen(req, timeout=5) as upstream:
        data = json.load(upstream)
    results = []
    for row in data.get("results", []):
        entry = row.get("GAZETTEER_ENTRY") or {}
        try:
            name = str(entry["NAME1"])[:200]
            east = float(entry["GEOMETRY_X"])
            north = float(entry["GEOMETRY_Y"])
        except (KeyError, TypeError, ValueError):
            continue
        if name and all(math.isfinite(v) for v in (east, north)):
            results.append({"NAME1": name, "GEOMETRY_X": east, "GEOMETRY_Y": north})
    return tuple(results)


@app.route("/api/search/places")
def search_places():
    query = request.args.get("q", "").strip()
    if not 2 <= len(query) <= 100:
        return jsonify({"error": "query must be 2-100 characters"}), 400
    if not os.environ.get("OS_NAMES_API_KEY", "").strip():
        return jsonify({"results": [], "available": False})
    limited = _rate_limited("os-names", 30)
    if limited:
        return limited
    try:
        return jsonify({"results": list(_os_names_search(query)), "available": True})
    except Exception:
        app.logger.exception("OS Names lookup failed")
        return jsonify({"error": "place search temporarily unavailable"}), 502

METRIC_CATALOGUE = [
    {
        "id": "CWBPT", "short": "CWB PT",
        "label": "Climate Water Balance (Penman-Thornthwaite)",
        "units": "mm", "colorscale": "diverging",
    },
    {
        "id": "CWBPM", "short": "CWB PM",
        "label": "Climate Water Balance (Penman-Monteith)",
        "units": "mm", "colorscale": "diverging",
    },
    {
        "id": "CWRPT", "short": "CWR PT",
        "label": "Climate Water Ratio (Penman-Thornthwaite)",
        "units": "ratio", "colorscale": "diverging",
    },
    {
        "id": "CWRPM", "short": "CWR PM",
        "label": "Climate Water Ratio (Penman-Monteith)",
        "units": "ratio", "colorscale": "diverging",
    },
    {
        "id": "Prec_sum", "short": "Precipitation",
        "label": "Precipitation (annual sum)",
        "units": "mm", "colorscale": "diverging",
    },
    {
        "id": "ETPT_sum", "short": "ET PT",
        "label": "Evapotranspiration (Penman-Thornthwaite)",
        "units": "mm", "colorscale": "sequential_warm",
    },
    {
        "id": "ETPM_sum", "short": "ET PM",
        "label": "Evapotranspiration (Penman-Monteith)",
        "units": "mm", "colorscale": "sequential_warm",
    },
    {
        "id": "Tmax_mean", "short": "Tmax",
        "label": "Mean Maximum Temperature",
        "units": "°C", "colorscale": "sequential_heat",
    },
    {
        "id": "Tmin_mean", "short": "Tmin",
        "label": "Mean Minimum Temperature",
        "units": "°C", "colorscale": "sequential_heat",
    },
]

# CWRPT/CWRPM 2020-2049 and 2050-2079 precomputed files are byte-identical to CWBPT/CWBPM.
# 1990-2019 was extracted from current_base_clim_summary.RDS and is genuine CWR data.
_INVALID_METRICS        = {"CWRPT", "CWRPM"}
_CWR_VALID_PERIODS      = {"1990-2019"}  # periods with real CWR precomputed data


@app.route("/api/layers", methods=["GET"])
def layers():
    def _enrich(m):
        if m["id"] in _INVALID_METRICS:
            return {**m, "available": True, "map_available": False,
                    "map_available_periods": sorted(_CWR_VALID_PERIODS),
                    "coverage": "catchment data only"}
        av = _METRIC_AVAILABILITY.get(m["id"], {"periods": {}, "complete": False})
        p1 = av["periods"].get("2020-2049", 0)
        p2 = av["periods"].get("2050-2079", 0)
        if av["complete"]:
            cov = "complete"
        elif p1 == 0 and p2 == 0:
            cov = "no data"
        else:
            cov = f"partial ({p1}/12, {p2}/12)"
        return {**m, "available": av["complete"], "coverage": cov}

    enriched = [_enrich(m) for m in METRIC_CATALOGUE]
    enriched.sort(key=lambda m: (0 if m["available"] else 1))
    return jsonify(enriched)


@app.route("/api/national/features", methods=["GET"])
def national_features():
    metric = request.args.get("metric", "CWBPT")
    period = request.args.get("period", "2050-2079")
    month  = request.args.get("month", type=int, default=_current_month())
    member = request.args.get("member")

    df = slice_facts(metric, period, month, member)
    gdf = get_councils()
    if gdf is None:
        return jsonify({"error": "COUNCILS_NOT_FOUND"}), 404

    council_gj = json.loads(gdf.to_json())
    features = []
    for feat in council_gj["features"]:
        name     = feat["properties"].get("council_name")
        cell_ids = _COUNCIL_CELLS.get(name, frozenset())
        sub      = df[df["id_1km"].isin(cell_ids)] if (cell_ids and not df.empty) else pd.DataFrame()
        mean_change = float(sub["Change"].mean()) if not sub.empty else None
        features.append({
            **feat,
            "properties": {**feat.get("properties", {}),
                           "Change": mean_change, "Month": month, "Period": period}
        })

    return jsonify({"type": "FeatureCollection", "features": features})


@lru_cache(maxsize=64)
def _national_catchment_json(metric: str, period: str, month: int) -> str:
    gdf = get_catchments()
    if gdf is None:
        return json.dumps({"type": "FeatureCollection", "features": []})

    df = slice_facts(metric, period, month, None)
    change_map: dict = {} if df.empty else dict(zip(df["id_1km"].tolist(), df["Change"].tolist()))

    catchment_fc = json.loads(gdf.to_json())
    features = []
    for feat in catchment_fc["features"]:
        name = feat["properties"].get("catchment_name")
        cell_ids = _CATCHMENT_CELLS.get(name, frozenset())
        if cell_ids and change_map:
            vals = [change_map[cid] for cid in cell_ids if cid in change_map]
            mean_change = float(sum(vals) / len(vals)) if vals else None
        else:
            mean_change = None
        features.append({
            **feat,
            "properties": {
                **feat.get("properties", {}),
                "Change": mean_change,
                "Month":  month,
                "Period": period,
            }
        })

    return json.dumps({"type": "FeatureCollection", "features": features})


@app.route("/api/national/features_catchment", methods=["GET"])
def national_features_catchment():
    metric = request.args.get("metric", "CWBPT")
    period = request.args.get("period", "2050-2079")
    month  = request.args.get("month", type=int, default=_current_month())
    return Response(_national_catchment_json(metric, period, month), mimetype="application/json")


@app.route("/cogs/<path:filepath>")
def serve_cog(filepath):
    base = os.path.realpath(COG_DIR)
    full_path = os.path.realpath(os.path.join(base, filepath))
    if not full_path.startswith(base + os.sep):
        return jsonify({"error": "invalid path"}), 400
    if not os.path.isfile(full_path):
        return jsonify({"error": "not found"}), 404
    from flask import send_file as _send_file
    return _send_file(full_path, conditional=True)


@app.route("/api/cog_url")
def cog_url():
    metric = request.args.get("metric", "CWBPT")
    period = request.args.get("period", "2050-2079")
    month  = request.args.get("month",  type=int, default=_current_month())
    metric, period, month_s, _ = _validated_climate_selection(metric, period, month, None)
    month = int(month_s)
    path   = f"Metric={metric}/Period={period}/Month={month}.tif"
    full   = os.path.join(COG_DIR, path)
    exists = os.path.exists(full)
    return jsonify({
        "url":    f"/cogs/{path}",
        "exists": exists,
        "metric": metric,
        "period": period,
        "month":  month,
    })


@app.route("/api/councils", methods=["GET"])
def councils():
    gdf = get_councils()
    if gdf is None:
        return jsonify({
            "error": "COUNCILS_NOT_FOUND",
            "detail": (
                "councils.gpkg not found at ./data/councils.gpkg. "
                "See app.py get_councils() docstring for how to create it."
            )
        }), 404

    fc = json.loads(gdf.to_json())
    fc["features"].sort(key=lambda f: f["properties"].get("council_name", ""))
    return jsonify(fc)


@app.route("/api/councils/<path:council_name>/bbox", methods=["GET"])
def council_bbox(council_name):
    gdf = get_councils()
    if gdf is None:
        return jsonify({"error": "COUNCILS_NOT_FOUND"}), 404

    match = gdf[gdf["council_name"].str.lower() == council_name.lower()]
    if match.empty:
        return jsonify({"error": "COUNCIL_NOT_FOUND", "name": council_name}), 404

    bounds = match.total_bounds  # [minx, miny, maxx, maxy]
    centroid = match.geometry.centroid.iloc[0]

    return jsonify({
        "council_name": match.iloc[0]["council_name"],
        "bbox": {
            "west":  float(bounds[0]),
            "south": float(bounds[1]),
            "east":  float(bounds[2]),
            "north": float(bounds[3])
        },
        "centroid": {
            "lng": float(centroid.x),
            "lat": float(centroid.y)
        }
    })


@app.route("/api/councils/<path:council_name>/features", methods=["GET"])
def council_features(council_name):
    gdf = get_councils()
    if gdf is None:
        return jsonify({"error": "COUNCILS_NOT_FOUND"}), 404

    match = gdf[gdf["council_name"].str.lower() == council_name.lower()]
    if match.empty:
        return jsonify({"error": "COUNCIL_NOT_FOUND", "name": council_name}), 404

    actual_name = match.iloc[0]["council_name"]
    cell_ids = _COUNCIL_CELLS.get(actual_name)
    if not cell_ids:
        return jsonify({"type": "FeatureCollection", "features": []})

    metric = request.args.get("metric", "CWBPT")
    period = request.args.get("period", "2050-2079")
    month  = request.args.get("month", type=int, default=_current_month())
    member = request.args.get("member")
    lc_q   = request.args.get("lc")
    lct    = request.args.get("lcthresh", type=float, default=0.0)

    df = slice_facts(metric, period, month, member)
    if df.empty:
        return jsonify({"type": "FeatureCollection", "features": []})

    # Fast set-based filter — no geometry involved
    df = df[df["id_1km"].isin(cell_ids)]
    if df.empty:
        return jsonify({"type": "FeatureCollection", "features": []})

    if lc_q:
        codes = {int(x) for x in lc_q.split(",") if x.strip().isdigit()}
        if codes:
            lc, _ = get_lc()
            m = lc[lc["lc_code"].isin(codes)].groupby("id_1km")["frac"].sum()
            keep_ids = set(m[m >= lct].index.astype(int))
            if not keep_ids:
                return jsonify({"type": "FeatureCollection", "features": []})
            df = df[df["id_1km"].isin(keep_ids)]
            if df.empty:
                return jsonify({"type": "FeatureCollection", "features": []})

    # Attach geometry via fast id_1km lookup (no spatial join)
    grid_web, _ = get_grid_web()
    grid_sub = grid_web[grid_web["id_1km"].isin(df["id_1km"])]

    gsub = grid_sub.merge(df, on="id_1km", how="inner")
    if gsub.empty:
        return jsonify({"type": "FeatureCollection", "features": []})

    gsub["Month"]  = month
    gsub["Period"] = period

    return jsonify(json.loads(gsub.to_json()))


@lru_cache(maxsize=1026)
def _get_catchment_cells(catchment_name: str) -> frozenset:
    gdf = get_catchments()
    if gdf is None:
        return frozenset()
    match = gdf[gdf["catchment_name"] == catchment_name]
    if match.empty:
        return frozenset()
    geom = match.iloc[0].geometry
    grid_web, sindex = get_grid_web()
    qpoly = box(*geom.bounds)
    if sindex is not None:
        try:
            idx = list(sindex.query(qpoly, predicate="intersects"))
        except AttributeError:
            idx = list(sindex.intersection(qpoly.bounds))
        sub = grid_web.iloc[idx]
    else:
        sub = grid_web[grid_web.intersects(qpoly)]
    sub = sub[sub.intersects(geom)]
    return frozenset(sub["id_1km"].tolist())


@app.route("/api/catchments/<path:name>/features", methods=["GET"])
def catchment_features(name):
    if name not in _CATCHMENT_NAMES:
        return jsonify({"error": "CATCHMENT_NOT_FOUND", "name": name}), 404

    cell_ids = _get_catchment_cells(name)
    if not cell_ids:
        return jsonify({"type": "FeatureCollection", "features": []})

    metric = request.args.get("metric", "CWBPT")
    period = request.args.get("period", "2050-2079")
    month  = request.args.get("month", type=int, default=_current_month())
    member = request.args.get("member")

    df = slice_facts(metric, period, month, member)
    if df.empty:
        return jsonify({"type": "FeatureCollection", "features": []})

    df = df[df["id_1km"].isin(cell_ids)]
    if df.empty:
        return jsonify({"type": "FeatureCollection", "features": []})

    grid_web, _ = get_grid_web()
    grid_sub = grid_web[grid_web["id_1km"].isin(df["id_1km"])]
    gsub = grid_sub.merge(df, on="id_1km", how="inner")
    if gsub.empty:
        return jsonify({"type": "FeatureCollection", "features": []})

    gsub["Month"]  = month
    gsub["Period"] = period
    return jsonify(json.loads(gsub.to_json()))


@app.route("/api/catchments", methods=["GET"])
def catchments_list():
    gdf = get_catchments()
    if gdf is None:
        return jsonify({"error": "CATCHMENTS_NOT_FOUND"}), 404

    result = []
    for _, row in gdf.iterrows():
        b = row.geometry.bounds  # (minx, miny, maxx, maxy)
        result.append({
            "name":     row["catchment_name"],
            "category": row.get("category", "River"),
            "bbox": {
                "west":  round(float(b[0]), 5),
                "south": round(float(b[1]), 5),
                "east":  round(float(b[2]), 5),
                "north": round(float(b[3]), 5),
            }
        })
    result.sort(key=lambda x: x["name"])
    return jsonify(result)


@app.route("/api/catchments/<path:name>/geometry", methods=["GET"])
def catchment_geometry(name):
    gdf = get_catchments()
    if gdf is None:
        return jsonify({"error": "CATCHMENTS_NOT_FOUND"}), 404

    match = gdf[gdf["catchment_name"] == name]
    if match.empty:
        return jsonify({"error": "CATCHMENT_NOT_FOUND", "name": name}), 404

    return jsonify(json.loads(match.to_json()))


@app.route("/api/jobs", methods=["POST"])
def jobs():
    limited = _rate_limited("jobs", 2)
    if limited:
        return limited
    payload = _json_object()
    aoi_gj = payload.get("aoi_geojson")
    metric = payload.get("metric", "CWBPT")
    period = payload.get("period", "2020-2049")
    month  = payload.get("month", None)
    member = payload.get("member", None)
    operation = payload.get("operation", "zonal_stats")

    if not aoi_gj:
        return jsonify({"error":"AOI_MISSING"}), 400
    if operation != "zonal_stats":
        return jsonify({"error": "unsupported operation"}), 400

    geom_gj = aoi_gj.get("geometry", aoi_gj)
    props   = aoi_gj.get("properties", {}) if isinstance(aoi_gj, dict) else {}
    aoi, aoi_bng, aoi_area_m2 = _validated_aoi(geom_gj, props)

    metric, period, month_s, member = _validated_climate_selection(
        metric, period, month if month is not None else _current_month(), member
    )
    month_val = int(month_s)
    df = slice_facts(metric, period, month_val, member)

    if df.empty:
        return jsonify({"error":"NO_FEATURES"}), 404

    grid = get_grid()[["id_1km","geometry"]]
    g = grid.merge(df, on="id_1km", how="inner")

    if g.empty:
        return jsonify({"error":"NO_MATCHING_IDS"}), 404

    if g.crs is None:
        g = g.set_crs(27700)
    elif g.crs.to_epsg() != 27700:
        g = g.to_crs(27700)
    inter = g.geometry.intersection(aoi_bng)
    mask = ~inter.is_empty
    if not mask.any():
        return jsonify({"error":"NO_INTERSECTION"}), 404

    areas = inter[mask].area
    vals  = g.loc[mask, "Change"].values
    w     = areas / areas.sum()

    wmean = float((w * vals).sum())
    wmin  = float(pd.Series(vals).min())
    wmax  = float(pd.Series(vals).max())

    lc_codes = payload.get("lc_codes")
    lc, _ = get_lc()
    cell = pd.DataFrame({
        "id_1km": g.loc[mask, "id_1km"].values,
        "area_weight": (areas / areas.sum()).values
    })

    lc_rows = []
    if lc_codes:
        sub = lc[lc["lc_code"].isin(lc_codes) & lc["id_1km"].isin(cell["id_1km"])]
        if not sub.empty:
            merged = sub.merge(cell, on="id_1km")
            merged["wfrac"] = merged["frac"] * merged["area_weight"]
            lc_rows = (
                merged.groupby(["lc_code","lc_name"])["wfrac"]
                .sum()
                .reset_index()
                .rename(columns={"wfrac":"weighted_frac"})
                .to_dict(orient="records")
            )

    _cleanup_old_outputs()
    job_id = str(uuid.uuid4())[:8]
    out_dir = os.path.join(OUTPUT_DIR, job_id)
    os.makedirs(out_dir, exist_ok=True)

    clip_gdf = g.loc[mask].copy()
    clip_gdf["geometry"] = inter[mask]
    clip_gdf = clip_gdf.to_crs(WEB_EPSG)
    clip_gdf.to_file(os.path.join(out_dir, f"{job_id}_clipped.geojson"), driver="GeoJSON")

    # CSV — one row per cell with WGS84 centroids from unclipped grid
    grid_web_csv, _ = get_grid_web()
    cell_ids_set = set(int(x) for x in clip_gdf["id_1km"].values)
    gw_csv = grid_web_csv[grid_web_csv["id_1km"].isin(cell_ids_set)].copy()
    gw_csv = gw_csv.merge(clip_gdf[["id_1km", "Change"]], on="id_1km", how="inner")
    csv_centroids = gw_csv.geometry.centroid
    stats_df = pd.DataFrame({
        "id_1km": gw_csv["id_1km"].values,
        "lon":    csv_centroids.x.round(6).values,
        "lat":    csv_centroids.y.round(6).values,
        "period": period,
        "month":  month_val,
        "Change": gw_csv["Change"].values,
    })
    _csv_safe(stats_df).to_csv(os.path.join(out_dir, f"{job_id}_stats.csv"), index=False)

    prov = {
        "job_id": job_id,
        "metric": metric,
        "period": period,
        "month": month_val,
        "member": member,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "aoi_area_m2": aoi_area_m2,
        "feature_count": int(mask.sum())
    }
    with open(os.path.join(out_dir, f"{job_id}_provenance.json"), "w", encoding="utf-8") as f:
        json.dump(prov, f, indent=2)

    return jsonify({
        "job_id": job_id,
        "status": "done",
        "files": {
            "csv": f"/download/{job_id}/{job_id}_stats.csv",
            "geojson": f"/download/{job_id}/{job_id}_clipped.geojson",
            "provenance": f"/download/{job_id}/{job_id}_provenance.json"
        },
        "stats": {
            "n_cells": int(mask.sum()),
            "weighted_mean_change_mm": wmean,
            "min_change_mm": wmin,
            "max_change_mm": wmax,
            "lc": lc_rows
        }
    })


@app.route("/api/timeseries", methods=["GET"])
def timeseries():
    metric  = request.args.get("metric", "CWBPT")
    period  = request.args.get("period", "2020-2049")
    cell_id = request.args.get("id_1km", type=int)
    member  = request.args.get("member", None)

    if cell_id is None:
        return jsonify({"error": "MISSING_ID"}), 400

    months, values = [], []
    for m in range(1, 13):
        fpath = _resolve_precomp_path(metric, period, str(m), member)
        if not os.path.exists(fpath):
            continue
        tbl = pq.read_table(fpath, columns=["id_1km", "Change"],
                            filters=[("id_1km", "=", cell_id)])
        if tbl.num_rows > 0:
            months.append(m)
            values.append(round(float(tbl.column("Change")[0].as_py()), 3))

    if not months:
        return jsonify({"error": "NO_DATA"}), 404

    return jsonify({
        "id_1km": cell_id,
        "metric": metric,
        "period": period,
        "months": months,
        "values": values,
    })


@app.route("/download/<job_id>/<path:filename>", methods=["GET"])
def download(job_id, filename):
    if len(job_id) != 8 or any(ch not in "0123456789abcdef" for ch in job_id.lower()):
        return jsonify({"error":"NOT_FOUND"}), 404
    base = os.path.realpath(OUTPUT_DIR)
    folder = os.path.realpath(os.path.join(base, job_id))
    if not folder.startswith(base + os.sep):
        return jsonify({"error":"NOT_FOUND"}), 404
    if not os.path.isdir(folder):
        return jsonify({"error":"NOT_FOUND"}), 404
    return send_from_directory(folder, filename, as_attachment=True)

@app.route("/api/landcover", methods=["GET"])
def landcover():
    _, classes = get_lc()
    return jsonify(classes)


_lc_dominant = None

@app.route("/api/landcover/dominant", methods=["GET"])
def landcover_dominant():
    """Dominant landcover class per 1km cell, as parallel arrays for the map overlay."""
    global _lc_dominant
    if _lc_dominant is None:
        lc, classes = get_lc()
        dom = lc.loc[lc.groupby("id_1km")["frac"].idxmax()]
        _lc_dominant = {
            "classes": classes,
            "ids":     dom["id_1km"].astype(int).tolist(),
            "codes":   dom["lc_code"].astype(int).tolist(),
            "fracs":   dom["frac"].round(3).tolist(),
        }
    return jsonify(_lc_dominant)


_habitat_dominant = None


@app.route("/api/habitat", methods=["GET"])
def habitat_classes():
    """Presentation classes and availability for NatureScot Habitat 2022."""
    if not os.path.isfile(HABITAT_FRACTIONS):
        return jsonify({"available": False, "classes": []})
    _, classes = get_habitat()
    return jsonify({"available": True, "classes": classes})


@app.route("/api/habitat/dominant", methods=["GET"])
def habitat_dominant():
    """Dominant grouped habitat per 1 km cell, as compact parallel arrays."""
    global _habitat_dominant
    if not os.path.isfile(HABITAT_FRACTIONS):
        return jsonify({"available": False, "classes": [], "ids": [], "codes": [], "fracs": []})
    if _habitat_dominant is None:
        habitat, classes = get_habitat()
        dom = habitat.loc[habitat.groupby("id_1km")["frac"].idxmax()]
        _habitat_dominant = {
            "available": True,
            "source": "NatureScot HLCM 2022 (20 m, grouped to 1 km)",
            "classes": classes,
            "ids": dom["id_1km"].astype(int).tolist(),
            "codes": dom["group_code"].astype(int).tolist(),
            "fracs": dom["frac"].round(4).tolist(),
        }
    return jsonify(_habitat_dominant)


_lidar_cov = None

# LiDAR acquisition phases -> (parquet key, display label, colour), ordered
# newest -> oldest (warm -> cool ramp reads as data vintage). Code is 1-based index.
LIDAR_PHASES = [
    ("NLP 2025",       "NLP 2025",       "#f97316"),
    ("NLP Phase 6",    "Phase 6",        "#fb923c"),
    ("NLP Phase 5",    "Phase 5",        "#fbbf24"),
    ("NLP Phase 4",    "Phase 4",        "#a3e635"),
    ("NLP Phase 3",    "Phase 3",        "#34d399"),
    ("NLP Phase 2",    "Phase 2",        "#22d3ee"),
    ("NLP Phase 1",    "Phase 1",        "#60a5fa"),
    ("Outer Hebrides", "Outer Hebrides", "#c084fc"),
    ("Historic",       "Historic",       "#94a3b8"),
]
_PHASE_CODE = {key: i + 1 for i, (key, _, _) in enumerate(LIDAR_PHASES)}

@app.route("/api/lidar/coverage", methods=["GET"])
def lidar_coverage():
    """Per-1km-cell LiDAR coverage coloured by acquisition phase (newest wins).
    Returns parallel ids/phases arrays + a legend of the phases present."""
    global _lidar_cov
    if _lidar_cov is None:
        coll = _get_coll_df()
        if coll.empty:
            return jsonify({"error": "NO_COVERAGE_DATA"}), 404
        ids, phases = [], []
        for cid, ph in coll["phase"].items():
            code = _PHASE_CODE.get(ph)
            if code:
                ids.append(int(cid)); phases.append(code)
        present = set(coll["phase"].unique())
        legend = [{"code": _PHASE_CODE[k], "label": lab, "color": c}
                  for k, lab, c in LIDAR_PHASES if k in present]
        cov = _get_cov_df()
        summary = {"any": len(ids)}
        if not cov.empty:
            summary.update(total=int(len(cov)), raster=int((cov["has_dtm"] & cov["has_dsm"]).sum()),
                           pc=int(cov["has_pc"].sum()), nlp=int(cov["has_nlp"].sum()))
        _lidar_cov = {"ids": ids, "phases": phases, "legend": legend, "summary": summary}
    return jsonify(_lidar_cov)


_terrain_df = None
# variable -> (column, label, units)
TERRAIN_VARS = {
    "elevation":  ("elev_mean",   "Elevation (mean)",  "m"),
    "slope":      ("slope_mean",  "Slope (mean)",      "°"),
    "ruggedness": ("ruggedness",  "Ruggedness (TRI)",  "m"),
    "canopy":     ("canopy_mean", "Canopy height",     "m"),
}

def _get_terrain():
    global _terrain_df
    if _terrain_df is None:
        path = _data("data/terrain_metrics.parquet")
        _terrain_df = pd.read_parquet(path) if os.path.exists(path) else pd.DataFrame()
    return _terrain_df

# terrain filter variable -> parquet column (for filter rules + export)
TERRAIN_FILTER_COLS = {
    "elevation": "elev_mean", "slope": "slope_mean",
    "ruggedness": "ruggedness", "canopy": "canopy_mean",
}

def _numeric_cond(col, op, val):
    """Build a safe SQL numeric condition for a quoted/plain column name."""
    c = f'"{col}"'
    try:
        if op == "gt":  return f"{c} > {float(val)}"
        if op == "lt":  return f"{c} < {float(val)}"
        if op == "gte": return f"{c} >= {float(val)}"
        if op == "lte": return f"{c} <= {float(val)}"
        if op == "between" and isinstance(val, (list, tuple)) and len(val) == 2:
            return f"{c} BETWEEN {float(val[0])} AND {float(val[1])}"
    except (TypeError, ValueError):
        return None
    return None

@app.route("/api/terrain/vars", methods=["GET"])
def terrain_vars():
    df = _get_terrain()
    return jsonify({
        "available": not df.empty,
        "count": int(len(df)),
        "vars": [{"id": k, "label": v[1], "units": v[2]} for k, v in TERRAIN_VARS.items()],
    })

@app.route("/api/terrain", methods=["GET"])
def terrain():
    """Per-cell terrain values for one variable: {id_1km: value}. Static (no period/month)."""
    var = request.args.get("var", "elevation")
    if var not in TERRAIN_VARS:
        return jsonify({"error": f"unknown var {var!r}"}), 400
    df = _get_terrain()
    if df.empty:
        return jsonify({"error": "NO_TERRAIN_DATA"}), 404
    col = TERRAIN_VARS[var][0]
    sub = df[["id_1km", col]].dropna()
    return jsonify({str(int(i)): round(float(v), 2)
                    for i, v in zip(sub["id_1km"], sub[col])})


@app.route("/api/terrain/range", methods=["GET", "POST"])
def terrain_range():
    """Min/max of one terrain variable for the current scope.

    Mirrors /api/filter/range for the terrain rule type. Unlike the climate
    range, an AOI can be honoured directly: POST the drawn/uploaded cell IDs
    and the range is computed over exactly those cells.
    """
    body = _json_object() if request.method == "POST" else {}
    var = (body.get("var") or request.args.get("var") or "elevation").strip()
    if var not in TERRAIN_VARS:
        return jsonify({"error": f"unknown var {var!r}"}), 400

    df = _get_terrain()
    if df.empty:
        return jsonify({"error": "NO_TERRAIN_DATA"}), 404

    scope = (body.get("scope") or request.args.get("scope") or "national").strip()
    ids = body.get("ids")
    try:
        if ids is not None:
            scope_ids = _validated_ids(ids, field="ids")
        elif scope == "aoi":
            # AOI selected but no IDs supplied — fall back to the national range
            # rather than silently reporting a wrong (narrower) one.
            scope, scope_ids = "national", None
        else:
            scope_ids = _scope_cells(scope)
    except InvalidSelection as exc:
        return jsonify({"error": str(exc)}), 400

    col = TERRAIN_VARS[var][0]
    sub = df[["id_1km", col]].dropna()
    if scope_ids is not None:
        sub = sub[sub["id_1km"].isin(scope_ids)]
        scope_total = len(scope_ids)
    else:
        scope_total = int(len(get_grid()))

    # LiDAR covers only part of Scotland, so the range alone is misleading —
    # always report how many of the scope's cells it was actually derived from.
    payload = {
        "var": var, "column": col, "scope": scope,
        "units": TERRAIN_VARS[var][2],
        "count": int(len(sub)),
        "scope_total": scope_total,
        "coverage_pct": round(100.0 * len(sub) / scope_total, 1) if scope_total else 0.0,
    }
    if sub.empty:
        payload.update({"min": None, "max": None})
    else:
        payload.update({"min": float(sub[col].min()), "max": float(sub[col].max())})
    return jsonify(payload)


_cov_df = None
_coll_df = None

def _get_cov_df():
    global _cov_df
    if _cov_df is None:
        p = _data("data/lidar_coverage.parquet")
        _cov_df = (pd.read_parquet(p).set_index("id_1km")
                   if os.path.exists(p) else pd.DataFrame())
    return _cov_df

def _get_coll_df():
    global _coll_df
    if _coll_df is None:
        p = _data("data/lidar_collections.parquet")
        _coll_df = (pd.read_parquet(p).set_index("id_1km")
                    if os.path.exists(p) else pd.DataFrame())
    return _coll_df

@app.route("/api/cell_lidar", methods=["GET"])
def cell_lidar():
    """LiDAR availability + collection/phase + terrain metrics for one cell (popups)."""
    id_ = request.args.get("id_1km", type=int)
    if id_ is None:
        return jsonify({"error": "MISSING_ID"}), 400
    out = {"id_1km": id_, "has_lidar": False}
    cov = _get_cov_df()
    if not cov.empty and id_ in cov.index:
        r = cov.loc[id_]
        out.update(tile=str(r["tile"]), has_lidar=bool(r["has_any"]), dtm=bool(r["has_dtm"]),
                   dsm=bool(r["has_dsm"]), point_cloud=bool(r["has_pc"]),
                   bluesky=bool(r["has_bluesky"]))
    coll = _get_coll_df()
    if not coll.empty and id_ in coll.index:
        out["collections"] = str(coll.loc[id_, "collections"])
    terr = _get_terrain()
    if not terr.empty:
        trow = terr[terr["id_1km"] == id_]
        if not trow.empty:
            t = trow.iloc[0]
            def _n(v): return None if pd.isna(v) else round(float(v), 2)
            out["terrain"] = {"elevation": _n(t["elev_mean"]), "slope": _n(t["slope_mean"]),
                              "ruggedness": _n(t["ruggedness"]), "canopy": _n(t["canopy_mean"])}
    return jsonify(out)


@lru_cache(maxsize=256)
def _landuse_composition(scope: str, variable: str = 'LCM') -> dict:
    if variable == 'HABITAT':
        if not os.path.isfile(HABITAT_FRACTIONS):
            return {}
        habitat, _ = get_habitat()
        scope_ids = _scope_cells(scope)
        sub = habitat[habitat["id_1km"].isin(scope_ids)] if scope_ids is not None else habitat
        if sub.empty:
            return {}
        totals = sub.groupby("group_name", sort=False)["area_frac"].sum()
        grand = float(totals.sum())
        if grand == 0:
            return {}
        return {
            str(name): round(float(val / grand * 100), 2)
            for name, val in totals.sort_values(ascending=False).items()
        }

    if not variable or variable == 'LCM':
        lc, _ = get_lc()
        scope_ids = _scope_cells(scope)
        sub = lc[lc["id_1km"].isin(scope_ids)] if scope_ids is not None else lc
        if sub.empty:
            return {}
        totals = sub.groupby("lc_name", sort=False)["frac"].sum()
        grand = float(totals.sum())
        if grand == 0:
            return {}
        return {
            str(name): round(float(val / grand * 100), 2)
            for name, val in totals.sort_values(ascending=False).items()
        }

    # JESS variable-based composition (Land Use, Farm Type, LCA, Peat Condition)
    v_enc = _url_quote(variable, safe='')
    path  = f"{JESS_ROOT}/Variable={v_enc}/Period=2050-2079/Metric=CWBPT/*.parquet"

    if scope == 'national':
        where_scope = ""
        params = [5, 'Projected']
    elif scope.startswith('catchment:'):
        cname = scope[len('catchment:'):]
        where_scope = "AND catchment_name = ?"
        params = [5, 'Projected', cname]
    elif scope.startswith('council:'):
        council = scope[len('council:'):]
        names = _COUNCIL_CATCHMENTS.get(council, [])
        if not names:
            return {}
        placeholders = ','.join(['?' for _ in names])
        where_scope = f"AND catchment_name IN ({placeholders})"
        params = [5, 'Projected'] + list(names)
    else:
        return {}

    sql = f"""
    SELECT Type, SUM(total_area_HA) AS total_ha
    FROM read_parquet('{path}')
    WHERE Month = ? AND Scenario = ? AND Member = '01'
    {where_scope}
    GROUP BY Type
    ORDER BY total_ha DESC
    """

    try:
        conn = duckdb.connect(':memory:')
        df   = conn.execute(sql, params).fetchdf()
        conn.close()
    except Exception:
        return {}

    if df.empty:
        return {}
    grand = float(df['total_ha'].sum())
    if grand == 0:
        return {}

    result = {}
    for _, row in df.iterrows():
        type_name = str(row['Type'])
        if variable == 'LCA':
            type_name = _LCA_LABELS.get(type_name, type_name)
        result[type_name] = round(float(row['total_ha']) / grand * 100, 2)
    return result


@app.route("/api/landuse_composition", methods=["GET", "POST"])
def landuse_composition():
    if request.method == 'POST':
        body     = _json_object()
        aoi_ids  = body.get('aoi_ids', [])
        variable = body.get('variable', 'LCM')
        if not aoi_ids:
            return jsonify({'error': 'aoi_ids required'}), 400
        aoi_set = _validated_ids(aoi_ids, limit=MAX_AOI_CELL_IDS, field="aoi_ids")

        if variable == 'HABITAT':
            if not os.path.isfile(HABITAT_FRACTIONS):
                return jsonify({})
            habitat, _ = get_habitat()
            sub = habitat[habitat['id_1km'].isin(aoi_set)]
            if sub.empty:
                return jsonify({})
            totals = sub.groupby('group_name', sort=False)['area_frac'].sum()
            grand = float(totals.sum())
            if grand == 0:
                return jsonify({})
            return jsonify({
                str(name): round(float(val / grand * 100), 2)
                for name, val in totals.sort_values(ascending=False).items()
            })

        if not variable or variable == 'LCM':
            lc, _ = get_lc()
            sub   = lc[lc['id_1km'].isin(aoi_set)]
            if sub.empty:
                return jsonify({})
            totals = sub.groupby('lc_name', sort=False)['frac'].sum()
            grand  = float(totals.sum())
            if grand == 0:
                return jsonify({})
            return jsonify({
                str(name): round(float(val / grand * 100), 2)
                for name, val in totals.sort_values(ascending=False).items()
            })

        # Non-LCM: weighted catchment approach
        weights = {}
        for cname, cells in _CATCHMENT_CELLS.items():
            overlap = len(cells & aoi_set)
            if overlap > 0:
                weights[cname] = overlap / len(cells)
        if not weights:
            return jsonify({})
        v_enc          = _url_quote(variable, safe='')
        path           = f"{JESS_ROOT}/Variable={v_enc}/Period=2050-2079/Metric=CWBPT/*.parquet"
        catchment_list = list(weights.keys())
        placeholders   = ','.join(['?' for _ in catchment_list])
        q = f"""
            SELECT catchment_name, Type, SUM(total_area_HA) AS total_ha
            FROM read_parquet('{path}')
            WHERE Month = ? AND Scenario = ? AND Member = '01'
              AND catchment_name IN ({placeholders})
            GROUP BY catchment_name, Type
        """
        try:
            conn = duckdb.connect(':memory:')
            df   = conn.execute(q, [5, 'Projected'] + catchment_list).fetchdf()
            conn.close()
        except Exception:
            return jsonify({})
        if df.empty:
            return jsonify({})
        df['weight']      = df['catchment_name'].map(weights)
        df['weighted_ha'] = df['total_ha'] * df['weight']
        agg   = df.groupby('Type')['weighted_ha'].sum()
        grand = float(agg.sum())
        if grand == 0:
            return jsonify({})
        result = {}
        for type_name, val in agg.sort_values(ascending=False).items():
            name = str(type_name)
            if variable == 'LCA':
                name = _LCA_LABELS.get(name, name)
            result[name] = round(float(val / grand * 100), 2)
        return jsonify(result)

    # GET (existing)
    scope    = request.args.get("scope", "national")
    variable = request.args.get("variable", "LCM")
    return jsonify(_landuse_composition(scope, variable))


@app.route("/api/soilwet", methods=["GET"])
def soilwet():
    id_ = request.args.get("id_1km", type=int)
    if id_ is None:
        return jsonify({"error": "MISSING_ID"}), 400

    df = get_soilwet()
    row = df[df["id_1km"] == id_]
    if row.empty:
        return jsonify({"error": "NO_DATA"}), 404

    r = row.iloc[0]
    dominant_class = r.get("dominant_class", None)
    dominant_pct   = r.get("dominant_pct", None)
    n_total        = r.get("n_total", 0)
    top_mix        = r.get("top_mix", [])

    if pd.notna(dominant_class):
        dominant_class = int(dominant_class)
    else:
        dominant_class = None

    if pd.notna(dominant_pct):
        dominant_pct = float(dominant_pct)
    else:
        dominant_pct = None

    n_total = int(n_total) if pd.notna(n_total) else 0

    if isinstance(top_mix, str):
        try:
            top_mix = json.loads(top_mix)
        except Exception:
            top_mix = []
    elif not isinstance(top_mix, list):
        try:
            top_mix = list(top_mix)
        except Exception:
            top_mix = []

    clean_mix = []
    for item in top_mix:
        if isinstance(item, dict):
            c = int(item.get("class")) if item.get("class") is not None else None
            p = float(item.get("pct")) if item.get("pct") is not None else None
            clean_mix.append({"class": c, "pct": p})
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            clean_mix.append({"class": int(item[0]), "pct": float(item[1])})

    return jsonify({
        "id_1km": int(id_),
        "dominant_class": dominant_class,
        "dominant_pct": dominant_pct,
        "n_total": n_total,
        "top_mix": clean_mix
    })


@app.route("/api/wetness", methods=["GET"])
def wetness():
    cell_id = request.args.get("id", type=int)
    if cell_id is None:
        return jsonify({"error":"MISSING_ID"}), 400
    wet = get_wet()
    sub = wet[wet["id_1km"] == cell_id].copy()
    if sub.empty:
        return jsonify({"id_1km": cell_id, "classes": []})
    LABELS = {1:"Very dry", 2:"Dry", 3:"Mod. dry", 4:"Mod. wet", 5:"Wet", 6:"Very wet"}
    sub["pct"] = (sub["frac"]*100).round(1)
    sub["label"] = sub["wetn_class_smd"].map(LABELS).fillna(sub["wetn_class_smd"].astype(str))
    classes = (sub.sort_values("pct", ascending=False)
                 .loc[:,["wetn_class_smd","label","pct"]]
                 .to_dict(orient="records"))
    return jsonify({"id_1km": cell_id, "classes": classes})


@app.route("/api/features", methods=["GET"])
def features():
    metric = request.args.get("metric", "CWBPT")
    period = request.args.get("period", "2050-2079")
    month  = request.args.get("month", type=int, default=_current_month())
    member = request.args.get("member")
    bbox_q = request.args.get("bbox")
    lc_q   = request.args.get("lc")
    lct    = request.args.get("lcthresh", type=float, default=0.0)

    df = slice_facts(metric, period, month, member)
    if df.empty:
        return jsonify({"type":"FeatureCollection","features":[]})

    if lc_q:
        codes = {int(x) for x in lc_q.split(",") if x.strip().isdigit()}
        if codes:
            lc, _ = get_lc()
            m = lc[lc["lc_code"].isin(codes)].groupby("id_1km")["frac"].sum()
            keep_ids = set(m[m >= lct].index.astype(int))
            if not keep_ids:
                return jsonify({"type":"FeatureCollection","features":[]})
            df = df[df["id_1km"].isin(keep_ids)]
            if df.empty:
                return jsonify({"type":"FeatureCollection","features":[]})

    grid_web, sindex = get_grid_web()
    if bbox_q:
        try:
            minx, miny, maxx, maxy = map(float, bbox_q.split(","))
            qpoly = box(minx, miny, maxx, maxy)
            if sindex is not None:
                try:
                    idx = list(sindex.query(qpoly, predicate="intersects"))
                except AttributeError:
                    idx = list(sindex.intersection(qpoly.bounds))
                grid_sub = grid_web.iloc[idx]
            else:
                grid_sub = grid_web[grid_web.intersects(qpoly)]
        except Exception as exc:
            app.logger.warning("bbox parse/sindex error: %s", exc)
            grid_sub = grid_web
    else:
        grid_sub = grid_web

    gsub = grid_sub.merge(df, on="id_1km", how="inner")
    if gsub.empty:
        return jsonify({"type":"FeatureCollection","features":[]})

    if len(gsub) > 5000:
        return jsonify({
            "error": "TOO_MANY_FEATURES",
            "count": len(gsub),
            "detail": f"Too many cells in view ({len(gsub):,}) — zoom in or select a council."
        }), 400

    gsub["Month"]  = month
    gsub["Period"] = period
    return jsonify(json.loads(gsub.to_json()))


COVERAGE_METRIC_TYPES = {
    'CWBPT': 'balance', 'CWBPM': 'balance', 'CWRPT': 'balance', 'CWRPM': 'balance',
    'Prec_sum': 'volume', 'ETPT_sum': 'volume', 'ETPM_sum': 'volume',
    'Tmax_mean': 'temperature', 'Tmin_mean': 'temperature',
}

COVERAGE_METRIC_UNITS = {'balance': 'mm', 'volume': 'mm', 'temperature': '°C'}

LC_CANONICAL = [
    (1,  'Broadleaved woodland'),
    (2,  'Coniferous woodland'),
    (3,  'Arable & horticulture'),
    (4,  'Improved grassland'),
    (5,  'Semi-natural grassland'),
    (6,  'Mountain heath & bog'),
    (7,  'Fen marsh & swamp'),
    (8,  'Freshwater'),
    (9,  'Coastal'),
    (10, 'Urban/Suburban'),
]


def _nf(x):
    """Float rounded to 4 dp, or None if NaN/inf/None."""
    if x is None:
        return None
    try:
        f = float(x)
        return None if not math.isfinite(f) else round(f, 4)
    except (TypeError, ValueError):
        return None


def _compute_coverage(metric, scope_str, threshold, period_1='2020-2049', period_2='2050-2079', aoi_cell_ids=None, member=None):
    metric, period_1, _, member = _validated_climate_selection(metric, period_1, 1, member)
    _, period_2, _, _ = _validated_climate_selection(metric, period_2, 1, member)
    metric_type = COVERAGE_METRIC_TYPES[metric]
    is_balance  = metric_type == 'balance'
    thr         = float(threshold)

    # Resolve scope
    if aoi_cell_ids is not None:
        cell_ids   = frozenset(int(i) for i in aoi_cell_ids)
        scope_info = {'type': 'aoi', 'id': None, 'name': f'AOI ({len(cell_ids)} cells)'}
    elif scope_str == 'national':
        cell_ids   = None
        scope_info = {'type': 'national', 'id': None, 'name': 'Scotland (national)'}
    elif scope_str.startswith('catchment:'):
        cname = scope_str[len('catchment:'):]
        cell_ids = _CATCHMENT_CELLS.get(cname)
        if cell_ids is None:
            raise KeyError(cname)
        scope_info = {'type': 'catchment', 'id': cname, 'name': cname.split(' : ')[0]}
    else:
        council_name = scope_str[len('council:'):]
        if council_name not in _COUNCIL_CELLS:
            raise KeyError(council_name)
        cell_ids   = _COUNCIL_CELLS[council_name]
        scope_info = {'type': 'council', 'id': council_name, 'name': council_name}

    # Check data exists — use member-specific parquets when available, fall back to mean
    def _cglob(period):
        if member and member != 'mean' and period != '1990-2019' and member in _VALID_MEMBERS:
            g = os.path.join(PRECOMP_DIR, f'Metric={metric}', f'Period={period}', 'Month=*', f'Member={member}.parquet')
            if _glob.glob(g):
                return g
        return os.path.join(PRECOMP_DIR, f'Metric={metric}', f'Period={period}', 'Month=*.parquet')

    curr_glob = _cglob(period_1)
    fut_glob  = _cglob(period_2)
    if not _glob.glob(curr_glob):
        raise FileNotFoundError(f"No precomputed data for metric={metric}, Period={period_1}")
    if not _glob.glob(fut_glob):
        raise FileNotFoundError(f"No precomputed data for metric={metric}, Period={period_2}")

    lc_path = _data('data/landcover_fractions.parquet')

    if is_balance:
        extra_cols = f"""
            , SUM(CASE WHEN c.value < {thr} THEN lc.frac ELSE 0.0 END) AS curr_deficit
            , SUM(CASE WHEN c.value >= {thr} THEN lc.frac ELSE 0.0 END) AS curr_surplus
            , SUM(CASE WHEN f.value < {thr} THEN lc.frac ELSE 0.0 END) AS fut_deficit
            , SUM(CASE WHEN f.value >= {thr} THEN lc.frac ELSE 0.0 END) AS fut_surplus
        """
    else:
        extra_cols = ''

    sql = f"""
    WITH
    c AS (
        SELECT id_1km,
               "Change" AS value,
               CAST(regexp_extract(filename, 'Month=([0-9]+)', 1) AS INTEGER) AS month
        FROM read_parquet('{curr_glob}', filename=true)
    ),
    f AS (
        SELECT id_1km,
               "Change" AS value,
               CAST(regexp_extract(filename, 'Month=([0-9]+)', 1) AS INTEGER) AS month
        FROM read_parquet('{fut_glob}', filename=true)
    )
    SELECT
        lc.lc_code,
        lc.lc_name,
        c.month,
        SUM(lc.frac)                                           AS area_km2,
        SUM(c.value * lc.frac) / NULLIF(SUM(lc.frac), 0)     AS curr_mean,
        SUM(f.value * lc.frac) / NULLIF(SUM(lc.frac), 0)     AS fut_mean
        {extra_cols}
    FROM read_parquet('{lc_path}') lc
    {{filter_join}}
    INNER JOIN c ON lc.id_1km = c.id_1km
    INNER JOIN f ON lc.id_1km = f.id_1km AND c.month = f.month
    GROUP BY lc.lc_code, lc.lc_name, c.month
    ORDER BY lc.lc_code, c.month
    """

    conn = duckdb.connect(':memory:')
    try:
        if cell_ids is not None:
            cell_df = pd.DataFrame({'id_1km': list(cell_ids)})
            conn.register('_cells', cell_df)
            filter_join = 'INNER JOIN _cells _cf ON lc.id_1km = _cf.id_1km'
        else:
            filter_join = ''
        df = conn.execute(sql.format(filter_join=filter_join)).df()
    finally:
        conn.close()

    # Index by (lc_code, month)
    idx = {}
    for _, row in df.iterrows():
        idx[(int(row['lc_code']), int(row['month']))] = row

    # Derive area per lc_code (take max across months — should be consistent)
    area_by_lc = {}
    for (code, _month), row in idx.items():
        a = float(row['area_km2'])
        area_by_lc[code] = max(area_by_lc.get(code, 0.0), a)

    total_area = sum(area_by_lc.values())
    scope_info['total_km2'] = round(total_area, 2)

    classes = []
    for code, name in LC_CANONICAL:
        area = area_by_lc.get(code, 0.0)
        months = []
        for m in range(1, 13):
            row = idx.get((code, m))
            if row is not None:
                curr  = {'mean': _nf(row['curr_mean'])}
                fut   = {'mean': _nf(row['fut_mean'])}
                dm    = _nf(row['fut_mean'] - row['curr_mean'])
                delta = {'mean': dm}
                if is_balance:
                    curr['deficit_km2']  = _nf(row['curr_deficit'])
                    curr['surplus_km2']  = _nf(row['curr_surplus'])
                    fut['deficit_km2']   = _nf(row['fut_deficit'])
                    fut['surplus_km2']   = _nf(row['fut_surplus'])
                    delta['deficit_km2'] = _nf(row['fut_deficit'] - row['curr_deficit'])
            else:
                curr  = {'mean': None}
                fut   = {'mean': None}
                delta = {'mean': None}
                if is_balance:
                    curr['deficit_km2'] = curr['surplus_km2'] = None
                    fut['deficit_km2']  = fut['surplus_km2']  = None
                    delta['deficit_km2'] = None
            months.append({'month': m, 'current': curr, 'future': fut, 'delta': delta})
        classes.append({'lc_code': code, 'lc_name': name,
                        'area_km2': round(area, 2), 'months': months})

    # Totals per month (weighted sum across all LC classes)
    totals_months = []
    for m in range(1, 13):
        wsum = t_curr = t_fut = t_cd = t_cs = t_fd = t_fs = 0.0
        for code, _ in LC_CANONICAL:
            row = idx.get((code, m))
            if row is None:
                continue
            a = float(row['area_km2'])
            wsum  += a
            cm = float(row['curr_mean']) if math.isfinite(float(row['curr_mean'] or 0)) else 0.0
            fm = float(row['fut_mean'])  if math.isfinite(float(row['fut_mean']  or 0)) else 0.0
            t_curr += cm * a
            t_fut  += fm * a
            if is_balance:
                t_cd += float(row['curr_deficit'] or 0)
                t_cs += float(row['curr_surplus'] or 0)
                t_fd += float(row['fut_deficit']  or 0)
                t_fs += float(row['fut_surplus']  or 0)

        curr_m = _nf(t_curr / wsum) if wsum > 0 else None
        fut_m  = _nf(t_fut  / wsum) if wsum > 0 else None
        dm     = _nf(fut_m  - curr_m) if (curr_m is not None and fut_m is not None) else None
        curr_t  = {'mean': curr_m}
        fut_t   = {'mean': fut_m}
        delta_t = {'mean': dm}
        if is_balance:
            curr_t['deficit_km2']  = _nf(t_cd)
            curr_t['surplus_km2']  = _nf(t_cs)
            fut_t['deficit_km2']   = _nf(t_fd)
            fut_t['surplus_km2']   = _nf(t_fs)
            delta_t['deficit_km2'] = _nf(t_fd - t_cd)
        totals_months.append({'month': m, 'current': curr_t, 'future': fut_t, 'delta': delta_t})

    return {
        'scope':    scope_info,
        'metric':   {'id': metric, 'type': metric_type,
                     'units': COVERAGE_METRIC_UNITS[metric_type]},
        'threshold': threshold,
        'period_1':  period_1,
        'period_2':  period_2,
        'classes':   classes,
        'totals':    {'area_km2': round(total_area, 2), 'months': totals_months},
    }


@lru_cache(maxsize=512)
def _coverage_json_cached(metric, scope_str, threshold, period_1='2020-2049', period_2='2050-2079', member=None):
    return json.dumps(_compute_coverage(metric, scope_str, threshold, period_1=period_1, period_2=period_2, member=member))


@app.route('/api/coverage', methods=['GET', 'POST'])
def coverage():
    if request.method == 'POST':
        body     = _json_object()
        metric   = str(body.get('metric',    '')).strip()
        thr_s    = str(body.get('threshold',  0))
        cell_ids = body.get('cell_ids')
        period_1 = str(body.get('period_1', '2020-2049')).strip()
        period_2 = str(body.get('period_2', '2050-2079')).strip()
        member   = body.get('member', None)
        if member and member not in _VALID_MEMBERS:
            member = None

        if metric not in COVERAGE_METRIC_TYPES:
            return jsonify({'error': f'Unknown metric: {metric!r}. Valid: {list(COVERAGE_METRIC_TYPES)}'}), 400
        if not cell_ids or not isinstance(cell_ids, list):
            return jsonify({'error': 'cell_ids must be a non-empty list'}), 400
        cell_ids = list(_validated_ids(cell_ids, limit=MAX_AOI_CELL_IDS, field="cell_ids"))
        try:
            threshold = round(float(thr_s), 6)
        except ValueError:
            return jsonify({'error': f'Invalid threshold: {thr_s!r}'}), 400
        try:
            result = _compute_coverage(metric, 'aoi', threshold, period_1=period_1, period_2=period_2, aoi_cell_ids=cell_ids, member=member)
            return jsonify(result)
        except Exception as e:
            app.logger.exception('coverage AOI error')
            return jsonify({'error': 'coverage analysis failed'}), 500

    # GET — named scopes (cached)
    metric   = request.args.get('metric',   '').strip()
    scope    = request.args.get('scope',    '').strip()
    thr_s    = request.args.get('threshold', '0').strip()
    period_1 = request.args.get('period_1', '2020-2049').strip()
    period_2 = request.args.get('period_2', '2050-2079').strip()
    member   = request.args.get('member', None)
    if member and member not in _VALID_MEMBERS:
        member = None

    if metric not in COVERAGE_METRIC_TYPES:
        return jsonify({'error': f'Unknown metric: {metric!r}. Valid: {list(COVERAGE_METRIC_TYPES)}'}), 400

    if not scope:
        return jsonify({'error': 'scope required: "national", "council:<name>", or "catchment:<name>"'}), 400

    if scope != 'national' and not scope.startswith('council:') and not scope.startswith('catchment:'):
        return jsonify({'error': 'scope must be "national", "council:<name>", or "catchment:<name>"'}), 400

    try:
        threshold = round(float(thr_s), 6)
    except ValueError:
        return jsonify({'error': f'Invalid threshold: {thr_s!r}'}), 400

    try:
        result_json = _coverage_json_cached(metric, scope, threshold, period_1, period_2, member)
        return app.response_class(result_json, mimetype='application/json')
    except KeyError as e:
        return jsonify({'error': f'Council not found: {e}'}), 400
    except FileNotFoundError:
        return jsonify({'error': 'requested coverage data is unavailable'}), 404
    except Exception:
        app.logger.exception('coverage error')
        return jsonify({'error': 'coverage analysis failed'}), 500


JESS_ROOT = os.environ.get("JESS_ROOT", "data/jess/parquet")
JESS_CWR_ROOT = os.environ.get("JESS_CWR_ROOT", "data/jess/parquet_cwr")

@lru_cache(maxsize=256)
def _catchment_cached(variable, metric, month, period, scenario, scope_str):
    # Target the exact partitioned file — DuckDB cannot partition-prune
    # URL-encoded directory names like Variable=Land%20Use (space encoded as %20 on disk),
    # so the /**/*.parquet glob would scan all ~40 files instead of one.
    v_enc = _url_quote(variable, safe='')
    root  = JESS_CWR_ROOT if metric in ('CWRPM', 'CWRPT') else JESS_ROOT
    path  = f"{root}/Variable={v_enc}/Period={period}/Metric={metric}/*.parquet"

    db = duckdb.connect()

    if scope_str == 'national':
        q = f"""
            SELECT Type as type, class, ROUND(SUM(total_area_HA)) as area_ha
            FROM read_parquet('{path}')
            WHERE Month = ? AND Scenario = ? AND Member = '01'
            GROUP BY Type, class
            ORDER BY Type, class
        """
        params = [month, scenario]
    elif scope_str.startswith('catchment:'):
        cname = scope_str[len('catchment:'):]
        q = f"""
            SELECT Type as type, class, ROUND(SUM(total_area_HA)) as area_ha
            FROM read_parquet('{path}')
            WHERE Month = ? AND Scenario = ? AND Member = '01'
              AND catchment_name = ?
            GROUP BY Type, class
            ORDER BY Type, class
        """
        params = [month, scenario, cname]
    else:
        council = scope_str[len('council:'):]
        names = _COUNCIL_CATCHMENTS.get(council)
        if not names:
            return None
        placeholders = ','.join(['?' for _ in names])
        q = f"""
            SELECT Type as type, class, ROUND(SUM(total_area_HA)) as area_ha
            FROM read_parquet('{path}')
            WHERE Month = ? AND Scenario = ? AND Member = '01'
              AND catchment_name IN ({placeholders})
            GROUP BY Type, class
            ORDER BY Type, class
        """
        params = [month, scenario] + list(names)

    df = db.execute(q, params).fetchdf()

    classes = ['Strong Deficit', 'Moderate Deficit', 'Moderate Surplus', 'Strong Surplus']
    if df.empty:
        return '[]'

    pivot = df.pivot_table(
        index='type',
        columns='class',
        values='area_ha',
        fill_value=0
    ).reset_index()

    for c in classes:
        if c not in pivot.columns:
            pivot[c] = 0

    rows = []
    for _, r in pivot.iterrows():
        total = sum(r.get(c, 0) for c in classes)
        rows.append({
            'type': r['type'],
            'total_ha': round(total),
            'classes': {c: round(r.get(c, 0)) for c in classes}
        })
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

@app.route('/api/catchment', methods=['GET', 'POST'])
def catchment():
    if request.method == 'POST':
        body     = _json_object()
        aoi_ids  = body.get('aoi_ids', [])
        variable = body.get('variable', 'Land Use')
        metric   = body.get('metric',   'CWBPT')
        try:
            month = int(body.get('month', _current_month()))
        except (TypeError, ValueError):
            return jsonify({'error': 'month must be 1-12'}), 400
        period   = body.get('period', '2050-2079')

        valid_variables = ['Land Use', 'Farm Type', 'LCA', 'Peat Condition', 'NA']
        valid_metrics   = ['CWBPT', 'CWBPM', 'CWRPT', 'CWRPM']
        valid_periods   = ['1960-1989', '1990-2019', '2020-2049', '2050-2079']
        if variable not in valid_variables:
            return jsonify({'error': f'unknown variable: {variable}'}), 400
        if metric not in valid_metrics:
            return jsonify({'error': f'unknown metric: {metric}'}), 400
        if period not in valid_periods:
            return jsonify({'error': f'unknown period: {period}'}), 400
        if not 1 <= month <= 12:
            return jsonify({'error': 'month must be 1-12'}), 400
        if not aoi_ids:
            return jsonify({'error': 'aoi_ids required'}), 400

        aoi_set = _validated_ids(aoi_ids, limit=MAX_AOI_CELL_IDS, field="aoi_ids")
        weights = {}
        for cname, cells in _CATCHMENT_CELLS.items():
            overlap = len(cells & aoi_set)
            if overlap > 0:
                weights[cname] = overlap / len(cells)

        if not weights:
            return jsonify({'variable': variable, 'metric': metric, 'month': month,
                            'period': period, 'scope': 'aoi', 'rows': []})

        scenario       = _PERIOD_SCENARIO[period]
        v_enc          = _url_quote(variable, safe='')
        root           = JESS_CWR_ROOT if metric in ('CWRPM', 'CWRPT') else JESS_ROOT
        path           = f"{root}/Variable={v_enc}/Period={period}/Metric={metric}/*.parquet"
        catchment_list = list(weights.keys())
        placeholders   = ','.join(['?' for _ in catchment_list])
        q = f"""
            SELECT catchment_name, Type as type, class, SUM(total_area_HA) as area_ha
            FROM read_parquet('{path}')
            WHERE Month = ? AND Scenario = ? AND Member = '01'
              AND catchment_name IN ({placeholders})
            GROUP BY catchment_name, Type, class
        """
        try:
            db  = duckdb.connect()
            df  = db.execute(q, [month, scenario] + catchment_list).fetchdf()
            db.close()
        except Exception as e:
            app.logger.exception('catchment AOI query failed')
            return jsonify({'error': 'catchment analysis failed'}), 500

        if df.empty:
            return jsonify({'variable': variable, 'metric': metric, 'month': month,
                            'period': period, 'scope': 'aoi', 'rows': []})

        df['weight']  = df['catchment_name'].map(weights)
        df['area_ha'] = df['area_ha'] * df['weight']
        agg     = df.groupby(['type', 'class'])['area_ha'].sum().reset_index()
        classes = ['Strong Deficit', 'Moderate Deficit', 'Moderate Surplus', 'Strong Surplus']
        pivot   = agg.pivot_table(
            index='type', columns='class', values='area_ha', fill_value=0
        ).reset_index()
        for c in classes:
            if c not in pivot.columns:
                pivot[c] = 0

        rows = []
        for _, r in pivot.iterrows():
            total = sum(float(r.get(c, 0)) for c in classes)
            rows.append({
                'type':     r['type'],
                'total_ha': round(total),
                'classes':  {c: round(float(r.get(c, 0))) for c in classes},
            })
        rows.sort(key=lambda x: x['total_ha'], reverse=True)
        if variable == 'LCA':
            for row in rows:
                row['type'] = _LCA_LABELS.get(str(row['type']), str(row['type']))
        return jsonify({'variable': variable, 'metric': metric, 'month': month,
                        'period': period, 'scope': 'aoi', 'rows': rows})

    # ── GET (existing behaviour) ─────────────────────────────────────────
    variable = request.args.get('variable', 'Land Use')
    metric   = request.args.get('metric', 'CWBPT')
    month    = request.args.get('month', _current_month(), type=int)
    period   = request.args.get('period', '2050-2079')
    scope    = request.args.get('scope', 'national')

    valid_variables = ['Land Use', 'Farm Type', 'LCA', 'Peat Condition', 'NA']
    valid_metrics   = ['CWBPT', 'CWBPM', 'CWRPT', 'CWRPM']
    valid_periods   = ['1960-1989', '1990-2019', '2020-2049', '2050-2079']

    if variable not in valid_variables:
        return jsonify({'error': f'unknown variable: {variable}'}), 400
    if metric not in valid_metrics:
        return jsonify({'error': f'unknown metric: {metric}'}), 400
    if period not in valid_periods:
        return jsonify({'error': f'unknown period: {period}'}), 400
    if not 1 <= month <= 12:
        return jsonify({'error': 'month must be 1-12'}), 400
    if scope != 'national' and not scope.startswith('council:') and not scope.startswith('catchment:'):
        return jsonify({'error': 'scope must be national, council:<name>, or catchment:<name>'}), 400
    if scope.startswith('council:'):
        council = scope[len('council:'):]
        if council not in _COUNCIL_CATCHMENTS:
            return jsonify({'error': f'unknown council: {council}'}), 404
    if scope.startswith('catchment:'):
        cname = scope[len('catchment:'):]
        if cname not in _CATCHMENT_NAMES:
            return jsonify({'error': f'unknown catchment: {cname}'}), 404

    try:
        scenario = _PERIOD_SCENARIO[period]
        result = _catchment_cached(variable, metric, month, period, scenario, scope)
        if result is None:
            return jsonify({'error': 'no data'}), 404
        rows = json.loads(result)
        return jsonify({
            'variable': variable,
            'metric': metric,
            'month': month,
            'period': period,
            'scope': scope,
            'rows': rows
        })
    except Exception as e:
        app.logger.exception('catchment query failed')
        return jsonify({'error': 'catchment analysis failed'}), 500


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

if os.environ.get("PREWARM_CATCHMENT", "1").lower() not in ("0", "false", "no"):
    _prewarm_catchment()


# Metrics whose filter column is "Change"; all others use "proj_value"
_BALANCE_METRICS = {"CWBPT", "CWBPM", "CWRPT", "CWRPM"}


def _scope_cells(scope: str):
    """Return frozenset of id_1km values for the given scope string.
    Returns None for national (meaning: no cell restriction).
    """
    if not scope or scope == "national":
        return None
    if scope.startswith("council:"):
        council = scope[len("council:"):]
        if council not in _COUNCIL_CELLS:
            raise InvalidSelection(f"unknown council: {council!r}")
        return _COUNCIL_CELLS[council]
    if scope.startswith("catchment:"):
        name = scope[len("catchment:"):]
        if name not in _CATCHMENT_CELLS:
            raise InvalidSelection(f"unknown catchment: {name!r}")
        return _CATCHMENT_CELLS[name]
    raise InvalidSelection("scope must be national, a known council, catchment, or explicit AOI")

_VALID_OPERATORS = {"gt", "lt", "gte", "lte", "between"}


def _filter_col(metric: str) -> str:
    return "Change" if metric in _BALANCE_METRICS else "proj_value"


_PRECOMP_PERIODS = {"1990-2019", "2020-2049", "2050-2079"}


def _validated_climate_selection(metric, period, month, member=None):
    metric = str(metric)
    period = str(period)
    if metric not in COVERAGE_METRIC_TYPES:
        raise InvalidSelection(f"unknown metric: {metric!r}")
    if period not in _PRECOMP_PERIODS:
        raise InvalidSelection(f"unknown period: {period!r}")
    try:
        month_int = int(month)
    except (TypeError, ValueError) as exc:
        raise InvalidSelection("month must be 1-12") from exc
    if isinstance(month, bool) or not 1 <= month_int <= 12 or str(month).strip() != str(month_int):
        raise InvalidSelection("month must be 1-12")
    if member in (None, "", "mean"):
        member = None if member in (None, "") else "mean"
    else:
        member = str(member)
        if member not in _VALID_MEMBERS:
            raise InvalidSelection(f"invalid ensemble member: {member!r}")
    return metric, period, str(month_int), member


def _precomp_path(metric: str, period: str, month: str) -> str:
    metric, period, month, _ = _validated_climate_selection(metric, period, month, None)
    path = os.path.abspath(os.path.join(
        PRECOMP_DIR, f"Metric={metric}", f"Period={period}", f"Month={month}.parquet"
    ))
    if os.path.commonpath((os.path.abspath(PRECOMP_DIR), path)) != os.path.abspath(PRECOMP_DIR):
        raise InvalidSelection("invalid climate data path")
    return path


def _resolve_precomp_path(metric: str, period: str, month: str, member: str | None = None) -> str:
    """Return member-specific parquet path if valid and present, else fall back to mean."""
    metric, period, month, member = _validated_climate_selection(metric, period, month, member)
    if member and member != 'mean' and period != '1990-2019':
        p = os.path.join(PRECOMP_DIR, f"Metric={metric}", f"Period={period}",
                         f"Month={month}", f"Member={member}.parquet")
        if os.path.exists(p):
            return p
    return _precomp_path(metric, period, month)


@app.route('/tiles/<int:z>/<int:x>/<int:y>.pbf')
def serve_tile(z, x, y):
    with sqlite3.connect(MBTILES_FILE) as conn:
        row = conn.execute(
            'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?',
            (z, x, (2**z - 1 - y))  # mbtiles uses TMS y, MapLibre uses XYZ
        ).fetchone()
    if row is None:
        return '', 204
    resp = app.response_class(row[0], mimetype='application/x-protobuf')
    resp.headers['Content-Encoding'] = 'gzip'
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Cache-Control'] = 'public, max-age=86400'
    return resp


HILLSHADE_MBTILES = os.environ.get("HILLSHADE_MBTILES", _data("data/tiles/terrain_hillshade.mbtiles"))
HILLSHADE_COG = os.environ.get("HILLSHADE_COG", _data("data/terrain_hillshade_cog.tif"))

# 1x1 fully transparent PNG — returned for tiles with no data so MapLibre's image
# decoder never sees an empty (204) body, which it logs as "could not be decoded".
_TRANSPARENT_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)

def _png_tile(data):
    resp = app.response_class(data, mimetype='image/png')
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Cache-Control'] = 'public, max-age=86400'
    return resp

@app.route('/terrain_tiles/<int:z>/<int:x>/<int:y>.png')
def serve_hillshade_tile(z, x, y):
    """LiDAR-derived hillshade raster tiles (PNG) for the higher-res terrain layer."""
    if not os.path.exists(HILLSHADE_MBTILES):
        return _png_tile(_TRANSPARENT_PNG)
    with sqlite3.connect(HILLSHADE_MBTILES) as conn:
        row = conn.execute(
            'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?',
            (z, x, (2**z - 1 - y))  # mbtiles TMS y -> MapLibre XYZ
        ).fetchone()
    return _png_tile(row[0] if row is not None else _TRANSPARENT_PNG)

@app.route('/api/terrain/hillshade_info')
def hillshade_info():
    """Availability + zoom range for the hillshade layer (drives the toggle)."""
    if not os.path.exists(HILLSHADE_MBTILES):
        return jsonify({"available": False})
    try:
        with sqlite3.connect(HILLSHADE_MBTILES) as conn:
            zs = [r[0] for r in conn.execute('SELECT DISTINCT zoom_level FROM tiles')]
            meta = dict(conn.execute('SELECT name, value FROM metadata').fetchall())
        return jsonify({
            "available": bool(zs),
            "minzoom": min(zs),
            "maxzoom": max(zs),
            "bounds": meta.get("bounds"),
            "export_available": os.path.exists(HILLSHADE_COG),
            "export_max_area_km2": HILLSHADE_EXPORT_AREA_LIMIT_M2 / 1e6,
        })
    except Exception:
        return jsonify({"available": False})


@app.route('/api/terrain/hillshade_export', methods=['POST'])
def hillshade_export():
    """Return a tightly bounded, AOI-clipped, georeferenced hillshade GeoTIFF."""
    if not os.path.exists(HILLSHADE_COG):
        return jsonify({"error": "hillshade export is not available"}), 503

    body = _json_object()
    geom_gj = body.get("geometry")
    if not geom_gj:
        return jsonify({"error": "geometry required"}), 400
    geom, _geom_bng, area_m2 = _validated_aoi(geom_gj)
    if area_m2 > HILLSHADE_EXPORT_AREA_LIMIT_M2:
        raise InvalidSelection(
            f"hillshade export area is {area_m2 / 1e6:,.1f} km²; maximum is "
            f"{HILLSHADE_EXPORT_AREA_LIMIT_M2 / 1e6:,.0f} km²"
        )
    limited = _rate_limited("hillshade_export", 2)
    if limited:
        return limited

    # Imported here so the main climate APIs remain available if a deployment
    # is temporarily missing the optional raster export dependency.
    try:
        import rasterio
        from rasterio.errors import WindowError
        from rasterio.features import geometry_window
        from rasterio.io import MemoryFile
        from rasterio.mask import mask as raster_mask
    except ImportError:
        app.logger.exception("rasterio is required for hillshade exports")
        return jsonify({"error": "hillshade export is not configured"}), 503

    try:
        with rasterio.open(HILLSHADE_COG) as src:
            to_raster = Transformer.from_crs(WEB_EPSG, src.crs, always_xy=True).transform
            raster_geom = shp_transform(to_raster, geom)
            try:
                window = geometry_window(src, [mapping(raster_geom)])
            except WindowError:
                return jsonify({"error": "AOI is outside hillshade coverage"}), 400

            width, height = int(window.width), int(window.height)
            pixel_count = width * height
            if (width > HILLSHADE_EXPORT_MAX_DIMENSION or height > HILLSHADE_EXPORT_MAX_DIMENSION):
                raise InvalidSelection(
                    "hillshade export bounds are too long or narrow; draw a more compact AOI"
                )
            if pixel_count > HILLSHADE_EXPORT_MAX_PIXELS:
                raise InvalidSelection(
                    f"hillshade export would contain {pixel_count:,} pixels; maximum is "
                    f"{HILLSHADE_EXPORT_MAX_PIXELS:,}"
                )

            clipped, transform = raster_mask(
                src, [mapping(raster_geom)], crop=True, filled=True, nodata=0
            )
            # The source is RGBA. A zero alpha band means the AOI intersects the
            # rectangular file bounds but contains no actual hillshade pixels.
            if clipped.shape[0] < 4 or not clipped[3].any():
                return jsonify({"error": "AOI contains no hillshade data"}), 400

            profile = src.profile.copy()
            profile.update(
                driver="GTiff",
                height=clipped.shape[1],
                width=clipped.shape[2],
                transform=transform,
                compress="DEFLATE",
                predictor=2,
                tiled=True,
                blockxsize=256,
                blockysize=256,
            )
            with MemoryFile() as mem:
                with mem.open(**profile) as dst:
                    dst.write(clipped)
                    dst.colorinterp = src.colorinterp
                    dst.update_tags(
                        source="ClimaScope LiDAR-derived hillshade",
                        attribution="NatureScot / Scottish Government NLP LiDAR",
                    )
                payload = mem.read()
    except InvalidSelection:
        raise
    except Exception:
        app.logger.exception("hillshade export failed")
        return jsonify({"error": "hillshade export failed"}), 500

    response = Response(
        payload,
        mimetype="image/tiff",
        headers={"Content-Disposition": "attachment; filename=climascope_hillshade_aoi.tif"},
    )
    response.headers["Cache-Control"] = "no-store"
    return response


_VALID_MEMBERS = {'01','04','05','06','07','08','09','10','11','12','13','15'}

# Metrics and periods served by the immersive wall display
_IMMERSIVE_PANELS  = ('CWBPT', 'Prec_sum', 'Tmax_mean', 'ETPT_sum')
_IMMERSIVE_PERIODS = (
    ('1990-2019', 'obs_value'),   # absolute baseline
    ('2020-2049', 'proj_value'),  # absolute projected
    ('2050-2079', 'proj_value'),  # absolute projected
)


@app.route('/api/immersive_values')
def get_immersive_values():
    """Batch endpoint for the wall display.

    Returns all 4 metrics × 3 periods in one response:
      {metric: {period: {id_1km_str: value}}}

    Column logic mirrors /api/values with ?col= param:
      - 1990-2019  → obs_value  (absolute baseline)
      - 2020-2049, 2050-2079 → proj_value (absolute projected)
      - Specific member + future period + member parquet present → same absolute column from member parquet

    Uses a single UNION ALL query across all 12 parquet files so DuckDB can
    parallelise the reads (~1.2 s warm vs ~2.2 s serial).  flask_compress
    (already active globally) brotli-compresses the ~27 MB JSON to ~7.8 MB.
    """
    month  = request.args.get('month', str(_current_month()))
    member = request.args.get('member', None)

    try:
        month_int = int(month)
        if not 1 <= month_int <= 12:
            raise ValueError
    except ValueError:
        return jsonify({'error': 'month must be 1–12'}), 400
    month = str(month_int)

    if member and member != 'mean':
        if member not in _VALID_MEMBERS:
            return jsonify({'error': f'invalid member {member!r}'}), 400

    # Collect (metric, period, col, path) for every combination that exists on disk.
    # Paths are constructed from server-side constants; only month is user-supplied
    # (validated above to be a digit 1–12, so safe to embed in filesystem paths).
    parts  = []   # SQL fragments for UNION ALL
    params = []   # positional params for metric/period labels and path

    for metric in _IMMERSIVE_PANELS:
        for period, default_col in _IMMERSIVE_PERIODS:
            col = default_col
            if member and member != 'mean' and period != '1990-2019':
                member_path = os.path.join(
                    PRECOMP_DIR, f"Metric={metric}", f"Period={period}",
                    f"Month={month}", f"Member={member}.parquet"
                )
                if os.path.exists(member_path):
                    path = member_path
                else:
                    path = _precomp_path(metric, period, month)
            else:
                path = _precomp_path(metric, period, month)

            if not os.path.exists(path):
                continue

            # col comes from _IMMERSIVE_PERIODS (hardcoded); double-quote it for DuckDB.
            # metric, period and path are passed as ? params.
            parts.append(
                f'SELECT ? AS metric, ? AS period, id_1km, "{col}" AS value'
                f' FROM read_parquet(?)'
            )
            params.extend([metric, period, path])

    result = {m: {p: {} for p, _ in _IMMERSIVE_PERIODS} for m in _IMMERSIVE_PANELS}

    if parts:
        con = duckdb.connect(':memory:')
        try:
            rows = con.execute(' UNION ALL '.join(parts), params).fetchall()
            for (metric, period, id_1km, value) in rows:
                result[metric][period][str(id_1km)] = value
        finally:
            con.close()

    resp = jsonify(result)
    resp.headers['Cache-Control'] = 'public, max-age=3600'
    return resp


@app.route('/api/values')
def get_values():
    metric = request.args.get('metric', 'CWBPT')
    period = request.args.get('period', '2050-2079')
    month  = request.args.get('month', str(_current_month()))
    member = request.args.get('member', None)

    if metric in _INVALID_METRICS and period not in _CWR_VALID_PERIODS:
        return jsonify({'error': f'{metric} data not available for period {period!r}'}), 404

    metric, period, month, member = _validated_climate_selection(metric, period, month, member)

    if member and member != 'mean':
        if member not in _VALID_MEMBERS:
            return jsonify({'error': f'invalid member {member!r}; valid: {sorted(_VALID_MEMBERS)}'}), 400

    _ALLOWED_COL = {'proj_value', 'obs_value'}
    _col_override = request.args.get('col')
    if _col_override in _ALLOWED_COL:
        col = _col_override
    else:
        col = 'obs_value' if period == '1990-2019' else 'Change'

    fallback = False
    if member and member != 'mean' and period != '1990-2019':
        member_path = os.path.join(
            PRECOMP_DIR, f"Metric={metric}", f"Period={period}",
            f"Month={month}", f"Member={member}.parquet"
        )
        if os.path.exists(member_path):
            path = member_path
            if _col_override not in _ALLOWED_COL:
                col = 'Change'
        else:
            path = _precomp_path(metric, period, month)
            fallback = True
    else:
        path = _precomp_path(metric, period, month)

    if not os.path.exists(path):
        return jsonify({'error': 'not found'}), 404

    con  = duckdb.connect(':memory:')
    rows = con.execute(
        f'SELECT id_1km, "{col}" as value FROM read_parquet(?)', [path]
    ).fetchall()
    con.close()

    result = {str(r[0]): r[1] for r in rows}
    resp = jsonify(result)
    resp.headers['Cache-Control'] = 'public, max-age=3600'
    if fallback:
        resp.headers['X-Fallback'] = 'mean'
    return resp


@app.route('/api/cell/<int:id_1km>/context')
def cell_context(id_1km):
    council   = _CELL_COUNCIL.get(id_1km)
    catchment = _CELL_CATCHMENT.get(id_1km)
    return jsonify({'council': council, 'catchment': catchment})


@app.route("/api/filter/range", methods=["GET"])
def filter_range():
    metric = request.args.get("metric", "").strip()
    period = request.args.get("period", "").strip()
    month  = request.args.get("month",  "").strip()
    scope  = request.args.get("scope", "national").strip()
    member = request.args.get("member", None)
    if member:
        member = member.strip()

    if not metric or not period or not month:
        return jsonify({"error": "metric, period and month are required"}), 400
    if metric not in COVERAGE_METRIC_TYPES:
        return jsonify({"error": f"unknown metric: {metric!r}"}), 400

    path = _resolve_precomp_path(metric, period, month, member)
    if not os.path.exists(path):
        return jsonify({"error": f"no data for {metric}/{period}/Month={month}"}), 404

    col = _filter_col(metric)
    # Range endpoint has no AOI ID payload; use the national range while an AOI
    # is active (the query itself is still restricted by explicit AOI IDs).
    scope_ids = None if scope == "aoi" else _scope_cells(scope)
    try:
        conn = duckdb.connect(":memory:")
        if scope_ids:
            conn.execute("CREATE TEMP TABLE _scope AS SELECT UNNEST(?) AS id_1km",
                         [list(scope_ids)])
            row = conn.execute(
                f'SELECT MIN(p."{col}") AS min_val, MAX(p."{col}") AS max_val '
                f'FROM read_parquet(?) p INNER JOIN _scope s ON p.id_1km = s.id_1km',
                [path]
            ).fetchone()
        else:
            row = conn.execute(
                f'SELECT MIN("{col}") AS min_val, MAX("{col}") AS max_val FROM read_parquet(?)',
                [path]
            ).fetchone()
        conn.close()
    except Exception as e:
        app.logger.exception("filter/range error")
        return jsonify({"error": "filter range query failed"}), 500

    return jsonify({"metric": metric, "period": period, "month": int(month),
                    "column": col, "min": row[0], "max": row[1]})


@app.route("/api/filter/query", methods=["POST"])
def filter_query():
    body = _json_object()
    rules   = body.get("rules", [])
    logic   = str(body.get("logic", "AND")).upper()
    scope   = body.get("scope", "national")
    aoi_ids = body.get("aoi_ids")  # explicit cell list when scope=='aoi'
    member  = body.get("member", None)

    if not rules:
        return jsonify({"error": "rules must be a non-empty list"}), 400
    if not isinstance(rules, list) or len(rules) > MAX_FILTER_RULES:
        return jsonify({"error": f"rules must contain at most {MAX_FILTER_RULES} items"}), 400
    if logic not in ("AND", "OR"):
        return jsonify({"error": "logic must be AND or OR"}), 400
    if not isinstance(scope, str):
        return jsonify({"error": "scope must be a string"}), 400

    lc_path      = _data('data/landcover_fractions.parquet')
    terrain_path = _data('data/terrain_metrics.parquet')

    # Validate all rules upfront
    for i, r in enumerate(rules):
        if not isinstance(r, dict):
            return jsonify({"error": f"rule[{i}] must be an object"}), 400
        rule_type = r.get("type", "climate")
        if rule_type == "landcover":
            for field in ("lc_class", "threshold"):
                if field not in r:
                    return jsonify({"error": f"rule[{i}] missing field: {field}"}), 400
        elif rule_type == "terrain":
            if r.get("terrain_var") not in TERRAIN_FILTER_COLS:
                return jsonify({"error": f"rule[{i}] terrain_var must be one of {sorted(TERRAIN_FILTER_COLS)}"}), 400
            for field in ("operator", "value"):
                if field not in r:
                    return jsonify({"error": f"rule[{i}] missing field: {field}"}), 400
            if r["operator"] not in _VALID_OPERATORS:
                return jsonify({"error": f"rule[{i}] invalid operator: {r['operator']!r}"}), 400
        else:
            for field in ("metric", "period", "month", "operator", "value"):
                if field not in r:
                    return jsonify({"error": f"rule[{i}] missing field: {field}"}), 400
            if r["metric"] not in COVERAGE_METRIC_TYPES:
                return jsonify({"error": f"rule[{i}] unknown metric: {r['metric']!r}"}), 400
            if r["operator"] not in _VALID_OPERATORS:
                return jsonify({"error": f"rule[{i}] invalid operator: {r['operator']!r}. Valid: {sorted(_VALID_OPERATORS)}"}), 400
            _validated_climate_selection(r["metric"], r["period"], r["month"], member)

    try:
        conn = duckdb.connect(":memory:")

        # Register each rule's parquet as a named table and build per-rule id_1km sets
        subqueries = []
        for i, r in enumerate(rules):
            rule_type = r.get("type", "climate")
            tbl = f"_r{i}"

            if rule_type == "landcover":
                lc_name = str(r["lc_class"])
                thr     = float(r["threshold"]) / 100.0
                conn.execute(
                    f"CREATE TEMP TABLE {tbl} AS "
                    f"SELECT id_1km FROM read_parquet(?) "
                    f"WHERE lc_name = ? AND frac >= ?",
                    [lc_path, lc_name, thr]
                )
            elif rule_type == "terrain":
                if not os.path.exists(terrain_path):
                    conn.close()
                    return jsonify({"error": "no terrain data available"}), 404
                col = TERRAIN_FILTER_COLS[r["terrain_var"]]
                cond = _numeric_cond(col, r["operator"], r["value"])
                if cond is None:
                    conn.close()
                    return jsonify({"error": f"rule[{i}] bad operator/value"}), 400
                conn.execute(f'CREATE TEMP TABLE {tbl} AS SELECT id_1km FROM read_parquet(?) '
                             f'WHERE {col} IS NOT NULL AND {cond}', [terrain_path])
            else:
                path = _resolve_precomp_path(r["metric"], r["period"], str(r["month"]), member)
                if not os.path.exists(path):
                    conn.close()
                    return jsonify({"error": f"rule[{i}] no data for {r['metric']}/{r['period']}/Month={r['month']}"}), 404

                col = _filter_col(r["metric"])
                op  = r["operator"]
                val = r["value"]

                if op == "gt":
                    cond = f'"{col}" > {float(val)}'
                elif op == "lt":
                    cond = f'"{col}" < {float(val)}'
                elif op == "gte":
                    cond = f'"{col}" >= {float(val)}'
                elif op == "lte":
                    cond = f'"{col}" <= {float(val)}'
                elif op == "between":
                    if not isinstance(val, (list, tuple)) or len(val) != 2:
                        conn.close()
                        return jsonify({"error": f"rule[{i}] between requires [lo, hi]"}), 400
                    cond = f'"{col}" BETWEEN {float(val[0])} AND {float(val[1])}'

                conn.execute(f"CREATE TEMP TABLE {tbl} AS SELECT id_1km FROM read_parquet(?) WHERE {cond}", [path])

            subqueries.append(tbl)

        # Combine with JOIN (AND) or UNION DISTINCT (OR)
        if logic == "AND":
            base = f"SELECT id_1km FROM {subqueries[0]}"
            for tbl in subqueries[1:]:
                base = f"SELECT a.id_1km FROM ({base}) a JOIN {tbl} b ON a.id_1km = b.id_1km"
            sql = base
        else:
            sql = " UNION ".join(f"SELECT id_1km FROM {t}" for t in subqueries)

        ids = conn.execute(f"SELECT id_1km FROM ({sql}) ORDER BY id_1km").fetchdf()["id_1km"].astype(int).tolist()
        conn.close()

    except Exception as e:
        app.logger.exception("filter/query error")
        return jsonify({"error": "filter query failed"}), 500

    if scope == 'aoi' and aoi_ids is not None:
        scope_ids = _validated_ids(aoi_ids, limit=MAX_AOI_CELL_IDS, field="aoi_ids")
    else:
        scope_ids = _scope_cells(scope)
    if scope_ids is not None:
        scope_set = set(scope_ids)
        ids = [i for i in ids if i in scope_set]

    return jsonify({"matched_ids": ids, "count": len(ids)})


@app.route("/api/filter/bbox", methods=["POST"])
def filter_bbox():
    body = _json_object()
    ids = body.get("ids", [])
    if not ids:
        return jsonify({"error": "ids required"}), 400
    ids = _validated_ids(ids, field="ids")
    grid_web, _ = get_grid_web()
    sub = grid_web[grid_web["id_1km"].isin(set(ids))]
    if sub.empty:
        return jsonify({"error": "no matching cells"}), 404
    b = sub.total_bounds
    return jsonify({"west": float(b[0]), "south": float(b[1]), "east": float(b[2]), "north": float(b[3])})


@app.route("/api/filter/cells", methods=["POST"])
def filter_cells():
    body = _json_object()
    ids = body.get("ids", [])
    if not ids:
        return jsonify({"type": "FeatureCollection", "features": []})
    ids = _validated_ids(ids, limit=MAX_AOI_CELL_IDS, field="ids")
    grid_web, _ = get_grid_web()
    sub = grid_web[grid_web["id_1km"].isin(set(ids))]
    return jsonify(json.loads(sub.to_json()))


@app.route("/api/aoi/features", methods=["POST"])
def aoi_features():
    body   = _json_object()
    geom_gj = body.get("geometry")
    metric  = body.get("metric", "CWBPT")
    period  = body.get("period", "2050-2079")
    month   = body.get("month", _current_month())
    member  = body.get("member", None)

    if not geom_gj:
        return jsonify({"error": "geometry required"}), 400
    geom, _geom_bng, _area_m2 = _validated_aoi(geom_gj)
    metric, period, month_s, member = _validated_climate_selection(metric, period, month, member)
    month = int(month_s)

    grid_web, sindex = get_grid_web()
    qpoly = box(*geom.bounds)
    if sindex is not None:
        try:
            idx = list(sindex.query(qpoly, predicate="intersects"))
        except AttributeError:
            idx = list(sindex.intersection(qpoly.bounds))
        sub = grid_web.iloc[idx]
    else:
        sub = grid_web[grid_web.intersects(qpoly)]
    sub = sub[sub.intersects(geom)]
    if sub.empty:
        return jsonify({"type": "FeatureCollection", "features": []})

    cell_ids = frozenset(sub["id_1km"].astype(int).tolist())
    df = slice_facts(metric, period, month, member)
    if df.empty:
        return jsonify({"type": "FeatureCollection", "features": []})

    df = df[df["id_1km"].isin(cell_ids)]
    if df.empty:
        return jsonify({"type": "FeatureCollection", "features": []})

    gsub = sub.merge(df, on="id_1km", how="inner")
    gsub["Month"]  = month
    gsub["Period"] = period
    return jsonify(json.loads(gsub.to_json()))


@app.route("/api/aoi/cells", methods=["POST"])
def aoi_cells():
    body = _json_object()
    geom_gj = body.get("geometry") or body.get("geojson")
    if not geom_gj:
        return jsonify({"error": "geometry required"}), 400
    geom, _geom_bng, _area_m2 = _validated_aoi(geom_gj)

    grid_web, sindex = get_grid_web()
    qpoly = box(*geom.bounds)
    if sindex is not None:
        try:
            idx = list(sindex.query(qpoly, predicate="intersects"))
        except AttributeError:
            idx = list(sindex.intersection(qpoly.bounds))
        sub = grid_web.iloc[idx]
    else:
        sub = grid_web[grid_web.intersects(qpoly)]
    sub = sub[sub.intersects(geom)]
    ids = sub["id_1km"].astype(int).tolist()
    return jsonify({"ids": ids, "count": len(ids)})


def _enrich_export(result):
    """Add LiDAR-derived terrain metrics, OS tile ref, and LiDAR phase to an
    export DataFrame keyed by id_1km (all left-joins; missing -> NaN)."""
    terr = _get_terrain()
    if not terr.empty:
        result = result.merge(
            terr[["id_1km", "elev_mean", "slope_mean", "ruggedness", "canopy_mean"]],
            on="id_1km", how="left")
    cov = _get_cov_df()
    if not cov.empty:
        result = result.merge(cov.reset_index()[["id_1km", "tile"]], on="id_1km", how="left")
    coll = _get_coll_df()
    if not coll.empty:
        result = result.merge(
            coll.reset_index()[["id_1km", "phase"]].rename(columns={"phase": "lidar_phase"}),
            on="id_1km", how="left")
    return result

@app.route("/api/aoi/export", methods=["POST"])
def aoi_export():
    body    = _json_object()
    aoi_ids = body.get("aoi_ids", [])
    metric  = body.get("metric", "CWBPT")
    period  = body.get("period", "2050-2079")
    month   = body.get("month", _current_month())
    fmt     = body.get("fmt", "csv")
    member  = body.get("member", None)
    if fmt not in ("csv", "geojson"):
        fmt = "csv"

    if not aoi_ids:
        return jsonify({"error": "aoi_ids required"}), 400

    id_set   = _validated_ids(aoi_ids, limit=MAX_AOI_CELL_IDS, field="aoi_ids")
    # Honour the selected ensemble member — hardcoding None silently exported
    # mean values while the map showed a different member.
    metric, period, month_s, member = _validated_climate_selection(metric, period, month, member)
    month = int(month_s)
    df       = slice_facts(metric, period, month, member)
    sub_df   = df[df["id_1km"].isin(id_set)][["id_1km", "Change"]].copy()

    grid_web, _ = get_grid_web()
    sub_grid    = grid_web[grid_web["id_1km"].isin(id_set)].copy()
    centroids   = sub_grid.geometry.centroid

    result = pd.DataFrame({
        "id_1km": sub_grid["id_1km"].values,
        "lon":    centroids.x.round(6).values,
        "lat":    centroids.y.round(6).values,
        "period": period,
        "month":  month,
        "metric": metric,
        "member": member or "mean",
    }).merge(sub_df, on="id_1km", how="left")
    result = _enrich_export(result)
    cols = ["id_1km", "tile", "lon", "lat", "period", "month", "metric", "member", "Change",
            "elev_mean", "slope_mean", "ruggedness", "canopy_mean", "lidar_phase"]
    result = result[[c for c in cols if c in result.columns]]

    if fmt == "geojson":
        gdf = sub_grid[["id_1km", "geometry"]].merge(result, on="id_1km", how="left")
        gdf = gdf[[c for c in cols if c in gdf.columns] + ["geometry"]]
        return Response(
            gdf.to_json(),
            mimetype="application/geo+json",
            headers={"Content-Disposition": "attachment; filename=climascope_aoi.geojson"},
        )
    return Response(
        _csv_safe(result).to_csv(index=False),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=climascope_aoi.csv"},
    )


if __name__ == "__main__":
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    app.run(host="0.0.0.0", port=8000, debug=False)
