#!/usr/bin/env python3
"""Assemble GDAL-resampled HLCM bands into ClimaScope's habitat parquet."""

import argparse

import numpy as np
import pandas as pd


CLASSES = {
    1: ("C", "Water", 1, "Water"),
    2: ("D1", "Raised and blanket bogs", 2, "Wetlands"),
    3: ("D2", "Valley mires, poor fens and transition mires", 2, "Wetlands"),
    4: ("D4", "Base-rich fens and calcareous spring mires", 2, "Wetlands"),
    5: ("E1", "Dry grasslands", 3, "Grasslands"),
    6: ("E2", "Mesic grasslands", 3, "Grasslands"),
    7: ("E3", "Seasonally wet and wet grasslands", 3, "Grasslands"),
    8: ("E4", "Alpine and subalpine grasslands", 3, "Grasslands"),
    9: ("E5", "Woodland fringes, clearings and tall forb", 4, "Scrub and tall vegetation"),
    10: ("F2", "Arctic, alpine and subalpine scrub", 4, "Scrub and tall vegetation"),
    11: ("F3", "Temperate and montane scrub", 4, "Scrub and tall vegetation"),
    12: ("F4", "Temperate shrub heathland", 4, "Scrub and tall vegetation"),
    13: ("F9", "Riverine and fen scrubs", 4, "Scrub and tall vegetation"),
    14: ("G1", "Broadleaved deciduous woodland", 5, "Woodland"),
    15: ("G3.4", "Scots pine woodland", 5, "Woodland"),
    16: ("G3.F", "Artificial conifer plantations", 5, "Woodland"),
    17: ("G4", "Mixed woodland", 5, "Woodland"),
    18: ("G5", "Lines, small stands, recent felling and coppice", 5, "Woodland"),
    19: ("H2", "Screes", 6, "Rock, scree and bare ground"),
    20: ("H3", "Inland cliffs and exposed rock", 6, "Rock, scree and bare ground"),
    21: ("I1", "Arable land and market gardens", 7, "Arable"),
    22: ("J", "Built-up areas", 8, "Built-up"),
    23: ("O", "Bare land", 6, "Rock, scree and bare ground"),
    24: ("OW", "Windthrow", 5, "Woodland"),
    25: ("A2.5", "Coastal saltmarsh", 2, "Wetlands"),
    26: ("B1", "Coastal dunes and sandy shores", 9, "Coastal dunes and shores"),
    27: ("B2", "Coastal shingle", 9, "Coastal dunes and shores"),
    28: ("B3", "Rock cliffs, ledges and shores", 9, "Coastal dunes and shores"),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("values", help="29-band Float32 ENVI BSQ (28 masks + valid mask)")
    parser.add_argument("grid_ids", help="Int32 ENVI raster aligned to values")
    parser.add_argument("output", help="output parquet path")
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    args = parser.parse_args()

    shape = (args.height, args.width)
    bands = np.memmap(args.values, dtype="<f4", mode="r", shape=(29, *shape))
    ids = np.memmap(args.grid_ids, dtype="<i4", mode="r", shape=shape)
    valid = bands[28]
    base = (ids > 0) & (valid > 1e-7)

    frames = []
    for code, (eunis_code, name, group_code, group_name) in CLASSES.items():
        frac = np.divide(bands[code - 1], valid, out=np.zeros(shape, dtype=np.float32), where=valid > 1e-7)
        keep = base & (frac > 1e-7)
        if not keep.any():
            continue
        frames.append(pd.DataFrame({
            "id_1km": ids[keep].astype(np.int32),
            "habitat_code": np.full(keep.sum(), code, dtype=np.int8),
            "eunis_code": eunis_code,
            "habitat_name": name,
            "group_code": np.full(keep.sum(), group_code, dtype=np.int8),
            "group_name": group_name,
            # Share of the entire 1 km square. This preserves coastal/edge area
            # weighting for aggregate dashboards.
            "area_frac": bands[code - 1][keep].astype(np.float32),
            # Share of valid HLCM pixels. This is the intuitive within-cell
            # percentage used for dominant-class popups and opacity.
            "frac": frac[keep].astype(np.float32),
        }))

    result = pd.concat(frames, ignore_index=True)
    sums = result.groupby("id_1km")["frac"].sum()
    if not sums.between(0.995, 1.005).all():
        bad = sums[~sums.between(0.995, 1.005)]
        raise RuntimeError(f"class fractions failed validation for {len(bad)} cells")
    if result.duplicated(["id_1km", "habitat_code"]).any():
        raise RuntimeError("duplicate cell/class rows")
    area_sums = result.groupby("id_1km")["area_frac"].sum()
    if (area_sums > 1.005).any():
        raise RuntimeError("area fractions exceed the 1 km cell area")

    result.sort_values(["id_1km", "habitat_code"], inplace=True)
    result.to_parquet(args.output, index=False, compression="zstd")
    print(
        f"Wrote {len(result):,} cell/class rows for {result['id_1km'].nunique():,} cells "
        f"to {args.output}"
    )


if __name__ == "__main__":
    main()
