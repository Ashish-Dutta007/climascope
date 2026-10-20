"""Place lookup and monthly climate profiles shared by the dashboard and wall."""
import bisect
import json
import math
import os
import re
import threading
from functools import lru_cache
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import geopandas as gpd
import pyarrow.compute as pc
import pyarrow.parquet as pq
from flask import Blueprint, jsonify, request
from shapely.geometry import Point, mapping

PERIODS = ("1990-2019", "2020-2049", "2050-2079")
MEMBERS = ("01", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "15")
METRICS = {
    "Tmax_mean": ("Mean daily maximum temperature", "°C"),
    "Prec_sum": ("Precipitation", "mm"),
    "CWBPT": ("Climate water balance · PT", "mm"),
    "ETPT_sum": ("Evapotranspiration · PT", "mm"),
}
# Furthest a postcode point may be from the nearest climate cell or council.
SNAP_METRES = 1000
POSTCODE = re.compile(r"[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}\Z")


class ProfileError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def normalise_postcode(value):
    compact = re.sub(r"\s+", "", value.upper())
    if not POSTCODE.fullmatch(compact):
        raise ProfileError("Enter a full UK postcode, for example PH2 7HP.")
    return compact[:-3] + " " + compact[-3:]


@lru_cache(maxsize=512)
def lookup_postcode(postcode):
    # Fixed upstream; client input never supplies a host or URL.
    url = "https://api.postcodes.io/postcodes/" + postcode.replace(" ", "")
    try:
        with urlopen(Request(url, headers={"User-Agent": "ClimaScope/1.0"}), timeout=6) as response:
            document = json.load(response)
            if not isinstance(document, dict) or not isinstance(document.get("result"), dict):
                raise ValueError("Invalid postcode response")
            value = document["result"]
    except HTTPError as exc:
        if exc.code == 404:
            raise ProfileError("Postcode not found. Check it and try again.", 404) from exc
        raise ProfileError("Postcode search is unavailable. Try again shortly.", 502) from exc
    except (OSError, ValueError) as exc:
        raise ProfileError("Postcode search is unavailable. Try again shortly.", 502) from exc
    if value.get("country") != "Scotland":
        raise ProfileError("ClimaScope covers Scotland. Choose a Scottish postcode.", 404)
    try:
        lon, lat = float(value["longitude"]), float(value["latitude"])
        if not (math.isfinite(lon) and math.isfinite(lat) and
                -9 <= lon <= 1 and 54 <= lat <= 62):
            raise ValueError
    except (KeyError, TypeError, ValueError) as exc:
        raise ProfileError("This postcode has no location data.", 404) from exc
    return lon, lat


@lru_cache(maxsize=16)
def read_json(path, stamp):
    with open(path) as source:
        return json.load(source)


def json_file(path):
    return read_json(path, os.stat(path).st_mtime_ns)


@lru_cache(maxsize=32)
def open_profile(path, stamp):
    """Parsed footer plus each row group's first id. The files are sorted by
    id_1km in 512-row groups, so one lookup reads a single row group instead of
    re-parsing the large footer and scanning statistics on every request."""
    source = pq.ParquetFile(path)
    meta = source.metadata
    column = source.schema_arrow.get_field_index("id_1km")
    starts = [meta.row_group(i).column(column).statistics.min for i in range(meta.num_row_groups)]
    version = (source.schema_arrow.metadata or {}).get(b"climascope_profile_data_version", b"").decode()
    return source, starts, version


@lru_cache(maxsize=256)
def read_cell(path, stamp, cell_id):
    source, starts, version = open_profile(path, stamp)
    group = bisect.bisect_right(starts, cell_id) - 1
    if group < 0:
        return None
    table = source.read_row_group(group)
    table = table.filter(pc.equal(table["id_1km"], cell_id))
    rows = table.to_pylist()
    if not rows:
        return None
    row = rows[0]
    row["_data_version"] = version
    return row


class Profiles:
    def __init__(self, grid_file, data_dir, summary_dir, councils, catchments, council_file, catchment_file):
        self.grid_file = grid_file
        self.data_dir, self.summary_dir = data_dir, summary_dir
        self.councils, self.catchments = councils, catchments
        self._grid = None
        self.region_files = {"council": council_file, "catchment": catchment_file}
        self._point_regions = {}

    def grid(self):
        if self._grid is None:
            grid = gpd.read_parquet(self.grid_file)[["id_1km", "geometry"]].to_crs(27700)
            grid["id_1km"] = grid["id_1km"].astype(int)
            grid = grid.sort_values("id_1km").set_index("id_1km", drop=False)
            _ = grid.sindex
            self._grid = grid
        return self._grid

    def cell_row(self, cell_id, member):
        path = os.path.join(self.data_dir, member + ".parquet")
        if not os.path.isfile(path):
            raise ProfileError("Local climate profiles are not available on this server yet.", 503)
        return read_cell(path, os.stat(path).st_mtime_ns, cell_id)

    def locate(self, lon, lat, label=None):
        point = gpd.GeoSeries([Point(lon, lat)], crs=4326).to_crs(27700).iloc[0]
        grid = self.grid()
        hits = grid.iloc[grid.sindex.query(point, predicate="intersects")].sort_index()
        distance = 0
        if hits.empty:
            # The grid holds only cells with climate data, so coastal postcodes
            # (Brodick, Stornoway) can fall just outside every cell. Use the
            # nearest cell within 1 km and report how far away it is.
            near = grid.iloc[grid.sindex.query(point.buffer(SNAP_METRES), predicate="intersects")]
            if not near.empty:
                gaps = near.geometry.distance(point)
                hits = near.assign(_gap=gaps).sort_index().sort_values("_gap", kind="stable")
                distance = int(round(float(hits.iloc[0]._gap)))
        if hits.empty:
            raise ProfileError("No Scottish climate grid cell at this location.", 404)
        # At an exact grid boundary, pick the lowest cell ID consistently.
        row = hits.iloc[0]
        cell_id = int(row.id_1km)
        values = self.cell_row(cell_id, "mean")
        if not values or not any(v is not None for k, v in values.items() if k != "id_1km" and not k.startswith('_')):
            raise ProfileError("No climate data for the 1 km cell at this location.", 404)
        geom = gpd.GeoSeries([row.geometry], crs=27700).to_crs(4326).iloc[0]
        context = {}
        # Point membership, rather than a cell's arbitrary intersecting region.
        for kind, column in (("council", "council_name"), ("catchment", "catchment_name")):
            if kind not in self._point_regions:
                # Keep the original boundaries for point membership. The map's
                # simplified council outline is for drawing only.
                regions = gpd.read_file(self.region_files[kind]).to_crs(27700)
                if column not in regions.columns:
                    raise ProfileError("Region boundary names are unavailable.", 503)
                self._point_regions[kind] = regions
            regions = self._point_regions[kind]
            containing = regions[regions.geometry.covers(point)].sort_values(column)
            if containing.empty and kind == "council":
                # Coastline generalisation can leave harbour points (Lerwick) just offshore.
                gaps = regions.geometry.distance(point)
                nearby = regions.assign(_gap=gaps)[gaps <= SNAP_METRES].sort_values(["_gap", column])
                containing = nearby
            if not containing.empty:
                context[kind] = str(containing.iloc[0][column])
        if distance:
            context["distance_m"] = distance
        return {"id": cell_id, "name": label or "Selected location", "kind": "cell",
                "scope": f"cell:{cell_id}", "longitude": lon, "latitude": lat,
                "geometry": mapping(geom), "bounds": list(geom.bounds), **context}

    def profile(self, scope, member):
        if member not in ("mean", *MEMBERS):
            raise ProfileError("Unknown ensemble member.")
        cell = scope.startswith("cell:")
        if cell:
            try:
                cell_id = int(scope[5:])
                if str(cell_id) != scope[5:] or cell_id < 0:
                    raise ValueError
            except ValueError as exc:
                raise ProfileError("Invalid climate grid cell.") from exc
            baseline = self.cell_row(cell_id, "mean")
            selected = self.cell_row(cell_id, member)
            if not baseline or not selected:
                raise ProfileError("No climate data for this cell.", 404)
            ensemble = {m: self.cell_row(cell_id, m) for m in MEMBERS}
            if not baseline.get('_data_version') or any(
                    not s or s.get('_data_version') != baseline['_data_version']
                    for s in [selected, *ensemble.values()]):
                raise ProfileError("Local climate profiles need to be rebuilt together.", 503)
            data_version = baseline['_data_version']
            def series(source, metric, period):
                return [source.get(f"{metric}|{period}|{month}") if source else None
                        for month in range(1, 13)]
            name, kind = f"Grid cell {cell_id}", "cell"
            counts = None
        else:
            if scope == "national":
                rid, name, kind = "national", "Scotland", "national"
            elif scope.startswith("council:") or scope.startswith("catchment:"):
                kind, name = scope.split(":", 1)
                regions = self.councils() if kind == "council" else self.catchments()
                column = "council_name" if kind == "council" else "catchment_name"
                if regions is None or name not in set(regions[column]):
                    raise ProfileError("Unknown council or catchment.")
                rid = name
            else:
                raise ProfileError("Choose a location, council or catchment.")
            def load(m):
                filename = "mean.json" if m == "mean" else f"member_{m}.json"
                return json_file(os.path.join(self.summary_dir, filename))
            mean = load("mean")
            data_version = mean['_meta']['data_version']
            baseline = mean["regions"].get(rid, {})
            chosen = load(member)
            selected = chosen["regions"].get(rid, {})
            member_sources = {m: load(m) for m in MEMBERS}
            if any(s["_meta"]["data_version"] != mean["_meta"]["data_version"]
                   for s in [chosen, *member_sources.values()]):
                raise ProfileError("Climate summaries need to be rebuilt together.", 503)
            ensemble = {m: s["regions"].get(rid, {}) for m, s in member_sources.items()}
            def series(source, metric, period):
                return source.get(metric, {}).get(period, [None] * 12)
            counts = mean["n_cells"].get(rid, {})
        metrics = {}
        for metric, (label, units) in METRICS.items():
            observed = series(baseline, metric, PERIODS[0])
            values = {p: observed if p == PERIODS[0] else series(selected, metric, p) for p in PERIODS}
            changes = {p: {m: [None if b is None or v is None else v - b
                               for b, v in zip(observed, series(s, metric, p))]
                            for m, s in ensemble.items()} for p in PERIODS[1:]}
            metrics[metric] = {"label": label, "units": units, "values": values,
                               "member_changes": changes,
                               "n_cells": counts.get(metric) if counts else [1] * 12}
        if not any(v is not None for m in metrics.values() for a in m["values"].values() for v in a):
            raise ProfileError("No climate data for this selection.", 404)
        return {"scope": scope, "name": name, "kind": kind, "member": member, "data_version": data_version,
                "periods": list(PERIODS), "metrics": metrics,
                "method": "1 km climate grid cell" if cell else
                "Mean of valid 1 km climate cells intersecting the area; cells equally weighted",
                "source": "ClimaScope climate data · 30-year monthly averages"}


def _warm_profile_footers(data_dir):
    # First touches of these files on the shared filesystem can take seconds.
    # Read only footers here: open handles must not be inherited by forked workers.
    for member in ("mean", *MEMBERS):
        try:
            pq.read_metadata(os.path.join(data_dir, member + ".parquet"))
        except (OSError, ValueError):
            pass


# Each worker opens its own Parquet handles after gunicorn's --preload fork.
os.register_at_fork(after_in_child=open_profile.cache_clear)
os.register_at_fork(after_in_child=read_cell.cache_clear)


def init_profiles(app, *, grid_file, data_dir, summary_dir, councils, catchments, council_file, catchment_file, rate_limit):
    threading.Thread(target=_warm_profile_footers, args=(data_dir,), daemon=True, name="profile-warm").start()
    service = Profiles(grid_file, data_dir, summary_dir, councils, catchments, council_file, catchment_file)
    app.extensions["climate_profiles"] = service
    routes = Blueprint("climate_profiles", __name__)

    @routes.errorhandler(ProfileError)
    def error(exc):
        return jsonify(error=exc.message), exc.status

    @routes.get("/api/location")
    def location():
        limited = rate_limit("location", 40)
        if limited:
            return limited
        postcode = request.args.get("postcode")
        if postcode is not None:
            label = normalise_postcode(postcode)
            lon, lat = lookup_postcode(label)
        else:
            label = None
            try:
                lon, lat = float(request.args["lon"]), float(request.args["lat"])
                if not all(math.isfinite(v) for v in (lon, lat)) or not (-9 <= lon <= 1 and 54 <= lat <= 62):
                    raise ValueError
            except (KeyError, TypeError, ValueError) as exc:
                raise ProfileError("Choose a location in Scotland.") from exc
        return jsonify(service.locate(lon, lat, label))

    @routes.get("/api/climate/profile")
    def profile():
        limited = rate_limit("climate-profile", 120)
        if limited:
            return limited
        try:
            return jsonify(service.profile(request.args.get("scope", "national"),
                                           request.args.get("member", "mean")))
        except FileNotFoundError as exc:
            raise ProfileError("Climate summaries are not available on this server yet.", 503) from exc

    app.register_blueprint(routes)
