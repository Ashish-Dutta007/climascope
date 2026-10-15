#!/usr/bin/env python3
"""Fixed cover areas estimated from 1 km fractions and clipped cell footprints.

Fractions are assumed uniform within boundary cells. No climate support filter
or dominant-class counts are used for the area totals.
"""
import hashlib
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/"static/immersive/summaries/landcover-v1.json"


def main():
    grid = gpd.read_parquet(ROOT/"data/grid.parquet").to_crs(27700)
    grid["id_1km"] = grid.id_1km.astype(int)
    cover = pd.read_parquet(ROOT/"data/landcover_fractions.parquet")
    assert not cover.duplicated(["id_1km", "lc_code"]).any()
    assert cover.frac.between(0, 1).all()
    classes = cover[["lc_code", "lc_name"]].drop_duplicates().sort_values("lc_code")
    codes = classes.lc_code.tolist()
    fractions = cover.pivot(index="id_1km", columns="lc_code", values="frac").reindex(grid.id_1km).fillna(0)[codes].to_numpy()
    councils = gpd.read_file(ROOT/"data/councils.gpkg").to_crs(27700)
    council_name = next(c for c in ["council_name", "LAD22NM", "local_authority", "name", "Name", "NAME"] if c in councils)
    catchments = gpd.read_file(ROOT/"data/catchments.gpkg").to_crs(27700)
    scotland = councils.geometry.union_all()
    regions = [("national", scotland)]
    regions += [("council:"+str(r[council_name]), r.geometry) for _, r in councils.iterrows()]
    regions += [("catchment:"+str(r.catchment_name), r.geometry) for _, r in catchments.iterrows()]
    output = {}
    for key, geometry in regions:
        idx = grid.sindex.query(geometry, predicate="intersects")
        # Proportions describe fractions of a full 1 km cell; multiply by
        # the in-region footprint, rather than counting border cells whole.
        weights = grid.geometry.iloc[idx].intersection(geometry).area.to_numpy()/1e6
        areas = (fractions[idx]*weights[:, None]).sum(axis=0)
        output[key] = {"areas_km2": [round(float(x), 6) for x in areas],
                       "total_km2": round(float(areas.sum()), 6),
                       "grid_footprint_km2": round(float(weights.sum()), 6),
                       "region_km2": round(float(geometry.area/1e6), 6)}
    source_paths = ["data/grid.parquet", "data/landcover_fractions.parquet", "data/councils.gpkg", "data/catchments.gpkg"]
    hashes = {p: hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in source_paths}
    data = {"_meta": {"version": 1, "source_hashes": hashes,
              "data_version": hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()[:16],
              "classes": [{"code": int(r.lc_code), "name": r.lc_name} for r in classes.itertuples()],
              "quantity": "estimated fixed land-cover area in km²",
              "method": "sum 1 km fractional cover × cell footprint clipped to the region in EPSG:27700; uniform fractions within boundary cells",
              "national_extent": "union of Scottish council boundaries", "climate_filter": False},
            "regions": output}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False)+"\n")
    print(f"Wrote {len(output)} regions, {len(codes)} classes to {OUT}", flush=True)
    print("Scotland:", output["national"], flush=True)


if __name__ == "__main__":
    main()
