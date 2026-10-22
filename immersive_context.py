"""Catchment class areas for the immersive wall, using Jess's supplied classes."""
from functools import lru_cache
import json
from pathlib import Path

import duckdb
from flask import Blueprint, jsonify, request


CLASSES = ["Strong Deficit", "Moderate Deficit", "Moderate Surplus", "Strong Surplus"]
PERIODS = ["1990-2019", "2020-2049", "2050-2079"]
MEMBERS = ["01", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "15"]


def create_context_blueprint(root, council_catchments, catchment_names):
    api = Blueprint("immersive_context", __name__, url_prefix="/api/immersive")

    @lru_cache(maxsize=64)
    def summaries(scope, member, sources):
        names = None
        if scope.startswith("council:"):
            names = council_catchments[scope[8:]]
        elif scope.startswith("catchment:"):
            names = [scope[10:]]
        selected = MEMBERS if member == "mean" else [member]
        result = {}
        with duckdb.connect() as db:
            db.execute("SET threads=2")
            for period, (path, _, _) in zip(PERIODS, sources):
                where = "Member IN (" + ",".join("?" for _ in selected) + ")"
                params = [path, *selected]
                if names is not None:
                    if names:
                        where += " AND catchment_name IN (" + ",".join("?" for _ in names) + ")"
                        params += list(names)
                    else:
                        where += " AND FALSE"
                rows = db.execute(f"""
                    SELECT Month, Type, class, SUM(total_area_HA)::DOUBLE,
                           COUNT(DISTINCT Member)
                    FROM read_parquet(?, hive_partitioning=false)
                    WHERE {where}
                    GROUP BY Month, Type, class
                """, params).fetchall()
                # A missing class/member means zero area in that class. Validate
                # overall member availability separately before averaging.
                available = dict(db.execute(f"""
                    SELECT Month, COUNT(DISTINCT Member)
                    FROM read_parquet(?, hive_partitioning=false)
                    WHERE {where} GROUP BY Month
                """, params).fetchall())
                months = [{"total_km2": 0.0, "classes_km2": [0.0]*4,
                           "land_use": {}, "members": available.get(m, 0)} for m in range(1, 13)]
                for month, cover, category, area_ha, _ in rows:
                    if category not in CLASSES or not 1 <= month <= 12:
                        raise ValueError("Unexpected CWR source class or month")
                    if available[month] != len(selected):
                        continue
                    area = area_ha / (100 * len(selected))
                    if area < 0:
                        raise ValueError("Negative CWR class area")
                    item = months[month-1]
                    ci = CLASSES.index(category)
                    item["classes_km2"][ci] += area
                    item["land_use"].setdefault(cover, [0.0]*4)[ci] += area
                    item["total_km2"] += area
                result[period] = months
        if scope.startswith("council:"):
            label = ("Catchments linked to " if names else "No catchments linked to ") + scope[8:]
        elif scope.startswith("catchment:"):
            label = scope[10:] + " · catchment"
        else:
            label = "Scotland · available catchments"
        return json.dumps({
            "metric": "CWRPT", "scope": scope, "scope_label": label,
            "member": member, "classes": CLASSES, "periods": result,
            "ensemble_label": "Mean class areas · 12 members" if member == "mean" else "Member " + member,
            "source": "Jess's classified catchment land-use summaries",
            "area_unit": "km²", "spatial_method": "whole catchments; councils use the catchment lookup",
        }, allow_nan=False, separators=(",", ":"))

    @api.get("/cwr")
    def cwr():
        scope = request.args.get("scope", "national")
        member = request.args.get("member", "mean")
        if member != "mean" and member not in MEMBERS:
            return jsonify(error="Unknown member"), 400
        valid = scope == "national" or (
            scope.startswith("council:") and scope[8:] in council_catchments
        ) or (scope.startswith("catchment:") and scope[10:] in catchment_names)
        if not valid:
            return jsonify(error="Unknown scope"), 400
        sources = []
        for period in PERIODS:
            paths = sorted((Path(root)/"Variable=Land%20Use"/f"Period={period}"/"Metric=CWRPT").glob("*.parquet"))
            if len(paths) != 1:
                return jsonify(error="CWR catchment summaries unavailable"), 503
            p = paths[0]
            stat = p.stat()
            sources.append((str(p), stat.st_size, stat.st_mtime_ns))
        return api_response(summaries(scope, member, tuple(sources)))

    def api_response(body):
        from flask import current_app
        return current_app.response_class(body, mimetype="application/json")

    return api
