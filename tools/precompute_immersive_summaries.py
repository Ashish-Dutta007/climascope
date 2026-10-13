#!/usr/bin/env python3
"""Precompute versioned regional monthly summaries for the immersive wall.

Replaces the v1 ``region_monthly.json`` (ensemble mean only, rounded to 1 dp).

Output directory: static/immersive/summaries/v2/
  mean.json         national + every council/catchment, ensemble mean,
                    all three periods, plus scene colour domains
  member_<id>.json  same regions, one ensemble member, future periods only
                    (the 1990-2019 baseline is observed and identical for
                    every member; the script asserts that before omitting it)

Each file:
  {
    "_meta":   {...provenance, method, periods, decimals...},
    "regions": {region_id: {metric: {period: [Jan..Dec]}}},
    "n_cells": {region_id: {metric: [Jan..Dec]}}          (mean.json only)
  }

Method (matches the wall maps and the v1 artifact):
  unweighted arithmetic mean of valid 1 km climate cells whose grid square
  intersects the region polygon (the app's _COUNCIL_CELLS / _CATCHMENT_CELLS
  membership), obs_value for 1990-2019 and proj_value for the future periods.
  Means are taken over the cells valid in all three periods for that
  metric/month (common support), and that cell count is recorded.

Values are stored to 3 dp so the wall can difference periods before rounding
for display. Run from anywhere:

  app/venv/bin/python app/tools/precompute_immersive_summaries.py
"""
import gzip
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(APP_DIR)
sys.path.insert(0, APP_DIR)
os.environ.setdefault("PREWARM_CATCHMENT", "0")

import numpy as np
import pandas as pd
import app  # import builds _COUNCIL_CELLS / _CATCHMENT_CELLS at module load

t0 = time.perf_counter()

VERSION = 2
DECIMALS = 3
METRICS = ["CWBPT", "Prec_sum", "Tmax_mean"]
BASELINE = ("1990-2019", "obs_value")
FUTURES = [("2020-2049", "proj_value"), ("2050-2079", "proj_value")]
PERIODS = [BASELINE] + FUTURES
MEMBERS = sorted(app._VALID_MEMBERS)
OUT_DIR = os.path.join(APP_DIR, "static", "immersive", "summaries", f"v{VERSION}")

# Fixed scene colour domains: pooled national cells of the ensemble mean over
# all 12 months x 3 periods, clipped to these quantiles and rounded outward.
DOMAIN_Q = (0.005, 0.995)
DOMAIN_STEP = {"CWBPT": 10.0, "Prec_sum": 10.0, "Tmax_mean": 1.0}


def mean_path(metric, period, month):
    return os.path.join(app.PRECOMP_DIR, f"Metric={metric}", f"Period={period}", f"Month={month}.parquet")


def member_path(metric, period, month, member):
    return os.path.join(app.PRECOMP_DIR, f"Metric={metric}", f"Period={period}",
                        f"Month={month}", f"Member={member}.parquet")


def read_col(path, col):
    df = pd.read_parquet(path, columns=["id_1km", col])
    s = df.set_index("id_1km")[col].astype("float64")
    return s[np.isfinite(s)]


def rnd(v):
    return None if v is None or not np.isfinite(v) else round(float(v), DECIMALS)


# ── Region membership ──────────────────────────────────────────────────
council_names = sorted(set(app.get_councils()["council_name"]))
catch_names = sorted(set(app.get_catchments()["catchment_name"]))
assert set(council_names).isdisjoint(catch_names), "council/catchment name collision"
assert "national" not in set(council_names) | set(catch_names), "'national' collides with a region name"
region_ids = ["national"] + council_names + catch_names

rows = [(c, name) for name, cells in app._COUNCIL_CELLS.items() for c in cells]
rows += [(c, name) for name, cells in app._CATCHMENT_CELLS.items() for c in cells]
membership = pd.DataFrame(rows, columns=["id_1km", "region_id"])


def region_means(series):
    """{region_id: mean} for a Series indexed by id_1km (already on common support)."""
    out = {"national": float(series.mean()) if len(series) else None}
    df = membership.merge(series.rename("v"), left_on="id_1km", right_index=True, how="inner")
    out.update(df.groupby("region_id")["v"].mean().to_dict())
    return out


def region_counts(index):
    out = {"national": int(len(index))}
    sub = membership[membership["id_1km"].isin(index)]
    out.update(sub.groupby("region_id").size().astype(int).to_dict())
    return out


# ── Source fingerprint (data version) ──────────────────────────────────
source_files = []
for metric in METRICS:
    for period, _ in PERIODS:
        for month in range(1, 13):
            source_files.append(mean_path(metric, period, month))
            if period != BASELINE[0]:
                source_files += [member_path(metric, period, month, mb) for mb in MEMBERS]
missing = [p for p in source_files if not os.path.exists(p)]
assert not missing, f"{len(missing)} source parquets missing, e.g. {missing[:3]}"
fp = hashlib.sha256()
for p in sorted(source_files):
    st = os.stat(p)
    fp.update(f"{os.path.relpath(p, app.PRECOMP_DIR)}|{st.st_size}|{int(st.st_mtime)}\n".encode())
data_version = fp.hexdigest()[:16]

base_meta = {
    "artifact": "climascope-immersive-region-monthly",
    "version": VERSION,
    "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "generator": "tools/precompute_immersive_summaries.py",
    "data_version": data_version,
    "source_files": len(source_files),
    "metrics": METRICS,
    "periods": {p: c for p, c in PERIODS},
    "baseline": BASELINE[0],
    "decimals": DECIMALS,
    "quantity": "absolute monthly period mean (obs_value baseline, proj_value futures); not change",
    "aggregation": ("unweighted arithmetic mean of valid 1 km climate cells intersecting the "
                    "region polygon; common support = cells valid in all three periods for "
                    "that metric and month"),
    "regions": {"national": 1, "councils": len(council_names), "catchments": len(catch_names)},
}


# ── Ensemble mean ──────────────────────────────────────────────────────
result = {rid: {m: {p: [None] * 12 for p, _ in PERIODS} for m in METRICS} for rid in region_ids}
n_cells = {rid: {m: [0] * 12 for m in METRICS} for rid in region_ids}
support_notes = []
pools = {m: [] for m in METRICS}
baselines = {}   # (metric, month) -> baseline Series, reused for the member check

for metric in METRICS:
    for month in range(1, 13):
        series = {p: read_col(mean_path(metric, p, month), c) for p, c in PERIODS}
        counts = {p: len(s) for p, s in series.items()}
        common = series[BASELINE[0]].index
        for p, _ in FUTURES:
            common = common.intersection(series[p].index)
        if len(set(counts.values())) > 1 or len(common) != counts[BASELINE[0]]:
            support_notes.append({"metric": metric, "month": month, "per_period": counts, "common": len(common)})
        for rid, n in region_counts(common).items():
            n_cells[rid][metric][month - 1] = n
        for p, _ in PERIODS:
            s = series[p].loc[common]
            pools[metric].append(s.values)
            for rid, v in region_means(s).items():
                result[rid][metric][p][month - 1] = rnd(v)
        baselines[(metric, month)] = series[BASELINE[0]]

domains = {}
for metric in METRICS:
    pool = np.concatenate(pools[metric])
    q_lo, q_hi = np.quantile(pool, DOMAIN_Q)
    step = DOMAIN_STEP[metric]
    lo = float(np.floor(q_lo / step) * step)
    hi = float(np.ceil(q_hi / step) * step)
    domains[metric] = {
        "lo": lo, "hi": hi,
        "median": round(float(np.median(pool)), 1),
        "data_min": round(float(pool.min()), 1), "data_max": round(float(pool.max()), 1),
        "basis": f"ensemble-mean cells, all months and periods, quantiles {DOMAIN_Q[0]}-{DOMAIN_Q[1]} "
                 f"rounded outward to {step:g}; values beyond are drawn at the end colour",
    }

null_regions = sorted(rid for rid in result
                      if all(v is None for m in result[rid] for p in result[rid][m] for v in result[rid][m][p]))


# ── Reconcile against independent figures before writing ───────────────
JUL = 6
# July national ensemble mean from the 13 October design review (unrounded parquet means).
checks = [
    ("CWBPT", "1990-2019", 3.217), ("CWBPT", "2050-2079", -24.896),
    ("Prec_sum", "1990-2019", 94.5), ("Prec_sum", "2050-2079", 82.3),
    ("Tmax_mean", "1990-2019", 16.4),
]
print("Validation — national July:")
for metric, period, expect in checks:
    got = result["national"][metric][period][JUL]
    tol = 0.0015 if round(expect, 1) != expect else 0.05
    ok = abs(got - expect) <= tol
    print(f"  {metric:10s} {period} = {got:>9}  expect {expect:>8}  {'OK' if ok else 'DRIFT'}")
    assert ok, f"RECONCILE DRIFT: {metric} {period} July got {got}, expect {expect}"
assert n_cells["national"]["CWBPT"][JUL] == 78855, n_cells["national"]["CWBPT"][JUL]

# Cross-check every national value against a direct DuckDB mean of the parquet.
import duckdb
con = duckdb.connect()
worst = 0.0
for metric in METRICS:
    for period, col in PERIODS:
        for month in range(1, 13):
            v = con.execute(f'SELECT avg("{col}") FROM read_parquet(?) WHERE isfinite("{col}")',
                            [mean_path(metric, period, month)]).fetchone()[0]
            worst = max(worst, abs(v - result["national"][metric][period][month - 1]))
con.close()
print(f"  national means vs direct DuckDB: worst abs diff {worst:.5f}")
assert worst <= 10 ** -DECIMALS, worst


def write(name, payload):
    raw = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode()
    with open(os.path.join(OUT_DIR, name), "wb") as f:
        f.write(raw)
    return len(raw), len(gzip.compress(raw, 6))


os.makedirs(OUT_DIR, exist_ok=True)
sizes = {}
sizes["mean.json"] = write("mean.json", {
    "_meta": {**base_meta, "ensemble": "mean", "domains": domains,
              "common_support_exceptions": support_notes, "all_null_regions": null_regions,
              "members_available": MEMBERS},
    "regions": result,
    "n_cells": n_cells,
})


# ── Members (future periods; baseline shared) ───────────────────────────
for member in MEMBERS:
    mres = {rid: {m: {p: [None] * 12 for p, _ in FUTURES} for m in METRICS} for rid in region_ids}
    for metric in METRICS:
        for month in range(1, 13):
            base = baselines[(metric, month)]
            for period, col in FUTURES:
                path = member_path(metric, period, month, member)
                df = pd.read_parquet(path, columns=["id_1km", "obs_value", col]).set_index("id_1km")
                # The member's baseline column must be the shared observed baseline.
                ob = df["obs_value"].astype("float64").reindex(base.index)
                diff = float(np.nanmax(np.abs(ob.values - base.values)))
                assert diff < 1e-3, f"member {member} {metric} {period} m{month} baseline differs by {diff}"
                s = df[col].astype("float64")
                s = s[np.isfinite(s)]
                common = s.index.intersection(base.index)
                for rid, v in region_means(s.loc[common]).items():
                    mres[rid][metric][period][month - 1] = rnd(v)
    sizes[f"member_{member}.json"] = write(f"member_{member}.json", {
        "_meta": {**base_meta, "ensemble": member,
                  "baseline_source": "mean.json (observed baseline, identical for every member)"},
        "regions": mres,
    })

print(f"\nregions: {len(region_ids)} (national + {len(council_names)} councils + {len(catch_names)} catchments)")
print(f"all-null regions: {null_regions}")
print(f"common-support exceptions: {len(support_notes)}")
print(f"data_version: {data_version}")
print("domains:", json.dumps({m: (d['lo'], d['median'], d['hi']) for m, d in domains.items()}))
for name, (raw, gz) in sizes.items():
    print(f"  {name:18s} {raw/1e6:5.2f} MB raw  {gz/1e6:5.2f} MB gzip")
print(f"output: {OUT_DIR}")
print(f"runtime: {time.perf_counter() - t0:.1f}s")
