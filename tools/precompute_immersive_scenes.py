#!/usr/bin/env python3
"""Build cell-threshold, land-cover and regional ensemble summaries for wall scenes.

Run with the app venv. Existing v2 summaries must match the source climate files.
Land-cover weights describe whole intersecting climate cells, not clipped land area.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))
os.environ.setdefault("PREWARM_CATCHMENT", "0")

import numpy as np
import pandas as pd
import duckdb
import app

PERIODS = ["1990-2019", "2020-2049", "2050-2079"]
METRICS = ["CWBPT", "Prec_sum", "Tmax_mean"]
MEMBERS = sorted(app._VALID_MEMBERS)
SOURCE = ROOT / "static/immersive/summaries/v2"
OUT = ROOT / "static/immersive/summaries/scenes-v1"


def path(metric, period, month, member="mean"):
    folder = Path(app.PRECOMP_DIR) / f"Metric={metric}" / f"Period={period}"
    return folder / (f"Month={month}.parquet" if member == "mean" else f"Month={month}/Member={member}.parquet")


def read(period, month, member="mean"):
    col = "obs_value" if period == PERIODS[0] else "proj_value"
    df = pd.read_parquet(path("CWBPT", period, month, member), columns=["id_1km", col])
    assert not df.id_1km.duplicated().any(), "Duplicate climate cell IDs"
    s = df.set_index("id_1km")[col].astype("float64")
    return s[np.isfinite(s)].sort_index()


def write(name, payload):
    raw = json.dumps(payload, separators=(",", ":"), allow_nan=False)
    target = OUT / name
    temp = target.with_suffix(".tmp")
    temp.write_text(raw)
    temp.replace(target)
    print(f"  {name}: {len(raw)/1e6:.2f} MB", flush=True)


def main():
    started = time.monotonic()
    mean = json.loads((SOURCE / "mean.json").read_text())
    fp = hashlib.sha256()
    sources = []
    for metric in mean["_meta"]["metrics"]:
        for period in PERIODS:
            for month in range(1, 13):
                sources.append(path(metric, period, month))
                if period != PERIODS[0]:
                    sources.extend(path(metric, period, month, m) for m in MEMBERS)
    for p in sorted(sources, key=str):
        st = p.stat()
        fp.update(f"{p.relative_to(app.PRECOMP_DIR)}|{st.st_size}|{int(st.st_mtime)}\n".encode())
    assert fp.hexdigest()[:16] == mean["_meta"]["data_version"], "Regenerate v2 climate summaries first"

    land_path = Path(app._data("data/landcover_fractions.parquet"))
    land = pd.read_parquet(land_path)
    assert np.isfinite(land.frac).all() and land.frac.between(0, 1.00001).all()
    assert not land.duplicated(["id_1km", "lc_code"]).any()
    classes = land[["lc_code", "lc_name"]].drop_duplicates().sort_values("lc_code")
    assert not classes.lc_code.duplicated().any(), "Ambiguous land-cover names"
    codes = classes.lc_code.astype(int).tolist()
    class_index = {c: i for i, c in enumerate(codes)}
    regions = list(mean["regions"])
    region_index = {rid: i for i, rid in enumerate(regions)}
    membership = pd.DataFrame([(c, region_index[r]) for group in [app._COUNCIL_CELLS, app._CATCHMENT_CELLS]
                               for r, cells in group.items() for c in cells], columns=["id_1km", "region"])
    assert not membership.duplicated(["id_1km", "region"]).any()
    ln = len(codes)
    support = {}
    for month in range(1, 13):
        series = [read(p, month) for p in PERIODS]
        common = series[0].index.intersection(series[1].index).intersection(series[2].index)
        cells = pd.DataFrame({"id_1km": common, "cell": np.arange(len(common))})
        joined = membership.merge(cells, on="id_1km", how="inner")
        joined = pd.concat([joined, cells.assign(region=0)], ignore_index=True)
        weighted = joined.merge(land[["id_1km", "lc_code", "frac"]], on="id_1km", how="inner")
        ri = joined.region.to_numpy(dtype=int)
        ci = joined.cell.to_numpy(dtype=int)
        wi = weighted.region.to_numpy(dtype=int) * ln + weighted.lc_code.map(class_index).to_numpy(dtype=int)
        wc = weighted.cell.to_numpy(dtype=int)
        frac = weighted.frac.to_numpy(dtype=float)
        n = np.bincount(ri, minlength=len(regions)).astype(int)
        denom = np.bincount(wi, weights=frac, minlength=len(regions)*ln).reshape(-1, ln)
        for rid, i in region_index.items():
            assert n[i] == mean["n_cells"][rid]["CWBPT"][month-1], (rid, month, n[i])
        support[month] = (common, ri, ci, wi, wc, frac, n, denom)

    st = land_path.stat()
    extra_fp = hashlib.sha256(f"{fp.hexdigest()}|{st.st_size}|{st.st_mtime_ns}".encode()).hexdigest()[:16]
    meta = {"artifact": "climascope-immersive-scenes", "version": 1,
            "climate_version": mean["_meta"]["data_version"], "data_version": extra_fp,
            "generated_utc": datetime.now(timezone.utc).isoformat(),
            "generator": "tools/precompute_immersive_scenes.py", "metric": "CWBPT",
            "threshold": {"operator": "<", "value": 0, "unit": "mm"},
            "periods": PERIODS, "members": MEMBERS,
            "quantity": "absolute monthly climatological CWB: obs_value baseline, proj_value futures",
            "cell_method": "counts on common valid climate support across all three periods; whole cells intersecting region",
            "landcover_method": "sum existing lc.frac in cells with CWB < 0 / sum lc.frac on common climate support, by class; whole intersecting cells, not clipped region area",
            "landcover_fixed": True, "landcover_source": "landcover_fractions.parquet",
            "classes": [{"code": int(r.lc_code), "name": r.lc_name} for r in classes.itertuples()]}
    OUT.mkdir(exist_ok=True)
    validation = []
    for member in ["mean"] + MEMBERS:
        periods = PERIODS if member == "mean" else PERIODS[1:]
        result = {rid: {"below": {p: [None]*12 for p in periods},
                        "landcover": {str(c): {"below": {p: [None]*12 for p in periods}} for c in codes}}
                  for rid in regions}
        if member == "mean":
            for rid in regions:
                result[rid]["n_cells"] = [int(support[m][6][region_index[rid]]) for m in range(1, 13)]
                for c in codes:
                    result[rid]["landcover"][str(c)]["weight"] = [round(float(support[m][7][region_index[rid], class_index[c]]), 6) for m in range(1, 13)]
        for month in range(1, 13):
            common, ri, ci, wi, wc, frac, n, denom = support[month]
            selected = [read(p, month, member) for p in periods]
            assert all(s.index.equals(common) for s in selected), (member, month, "different support; do not reuse mean denominator")
            for period, s in zip(periods, selected):
                below = (s.to_numpy() < 0).astype(int)
                count = np.bincount(ri, weights=below[ci], minlength=len(regions)).astype(int)
                weights = np.bincount(wi, weights=frac*below[wc], minlength=len(regions)*ln).reshape(-1, ln)
                assert (count <= n).all() and (weights <= denom+1e-7).all()
                for rid, i in region_index.items():
                    result[rid]["below"][period][month-1] = int(count[i])
                    for c, j in class_index.items():
                        result[rid]["landcover"][str(c)]["below"][period][month-1] = round(float(weights[i, j]), 6)
                if month == 7:
                    con = duckdb.connect()
                    col = "obs_value" if period == PERIODS[0] else "proj_value"
                    direct = con.execute(f'SELECT count(*), count(*) FILTER (WHERE "{col}" < 0) FROM read_parquet(?) WHERE isfinite("{col}")', [str(path("CWBPT", period, month, member))]).fetchone()
                    assert direct == (int(n[0]), int(count[0])), (member, period, direct)
                    direct_land = dict(con.execute(f'SELECT lc_code, sum(CASE WHEN c."{col}" < 0 THEN l.frac ELSE 0 END) FROM read_parquet(?) l JOIN read_parquet(?) c USING(id_1km) WHERE isfinite(c."{col}") GROUP BY lc_code', [str(land_path), str(path("CWBPT", period, month, member))]).fetchall())
                    con.close()
                    assert all(abs(direct_land.get(c, 0)-weights[0, j]) < 1e-5 for c, j in class_index.items())
                    validation.append({"member": member, "period": period, "month": month, "n": int(n[0]), "below": int(count[0]), "pct": round(100*count[0]/n[0], 3)})
        write("mean.json" if member == "mean" else f"member_{member}.json", {"_meta": {**meta, "ensemble": member}, "regions": result})

    # Regional changes for every member, calculated after regional aggregation.
    deltas = {metric: np.full((len(regions), 2, 12, len(MEMBERS)), np.nan) for metric in METRICS}
    for mi, member in enumerate(MEMBERS):
        item = json.loads((SOURCE/f"member_{member}.json").read_text())
        assert item["_meta"]["data_version"] == meta["climate_version"]
        for ri, rid in enumerate(regions):
            for metric in METRICS:
                base = mean["regions"][rid][metric][PERIODS[0]]
                for pi, period in enumerate(PERIODS[1:]):
                    future = item["regions"][rid][metric][period]
                    for month, (b, f) in enumerate(zip(base, future)):
                        if b is not None and f is not None:
                            deltas[metric][ri, pi, month, mi] = round(f-b, 3)
    for metric in METRICS:
        values = {rid: {period: [[None if not np.isfinite(v) else float(v) for v in month] for month in deltas[metric][ri, pi]] for pi, period in enumerate(PERIODS[1:])} for ri, rid in enumerate(regions)}
        write(f"agreement_{metric}.json", {"_meta": {**meta, "metric": metric,
              "quantity": "each member's regional mean minus observed baseline regional mean, rounded to 3 dp",
              "uncertainty": "available-member spread, not probability or complete uncertainty"}, "regions": values})
    baseline, near, later = [v for v in validation if v["member"] == "mean"]
    assert [round(v["pct"], 1) for v in [baseline, near, later]] == [57.4, 68.9, 81.4]
    write("validation.json", {"national_july": validation, "runtime_seconds": round(time.monotonic()-started, 1), "source_version": meta["climate_version"]})
    print(f"Done in {time.monotonic()-started:.1f}s", flush=True)


if __name__ == "__main__":
    main()
