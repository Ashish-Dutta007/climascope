#!/usr/bin/env python3
"""Build small, cell-indexed profile tables from the climate source partitions.

Run: venv/bin/python tools/precompute_place_profiles.py
Outputs data/place_profiles/{mean,01,...,15}.parquet. No source files are changed.
Each row contains all months for one cell. Sorted 512-row groups make location
queries read a small part of the data instead of scanning 1,296 source files.
"""
import argparse
import hashlib
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from climate_profiles import METRICS, MEMBERS, PERIODS


def build(source, output, members=("mean", *MEMBERS)):
    output.mkdir(parents=True, exist_ok=True)
    fingerprint = hashlib.sha256()
    paths = []
    for metric in METRICS:
        for period in PERIODS:
            for month in range(1, 13):
                folder = source / f"Metric={metric}" / f"Period={period}"
                paths.append(folder / f"Month={month}.parquet")
                if period != PERIODS[0]:
                    paths.extend(folder / f"Month={month}/Member={m}.parquet" for m in MEMBERS)
    # Use the same source fingerprint as the regional wall summaries.
    for path in sorted(paths, key=str):
        stat = path.stat()
        fingerprint.update(f"{path.relative_to(source)}|{stat.st_size}|{int(stat.st_mtime)}\n".encode())
    version = fingerprint.hexdigest()[:16].encode()
    observed = {}
    for member in members:
        columns = {}
        for metric in METRICS:
            for period in PERIODS:
                if member != "mean" and period == PERIODS[0]:
                    continue
                for month in range(1, 13):
                    folder = source / f"Metric={metric}" / f"Period={period}"
                    path = folder / (f"Month={month}.parquet" if member == "mean"
                                     else f"Month={month}/Member={member}.parquet")
                    col = "obs_value" if period == PERIODS[0] else "proj_value"
                    # ParquetFile avoids Hive inference from the partition path.
                    df = pq.ParquetFile(path).read(columns=["id_1km", col, *([] if col == "obs_value" else ["obs_value"])]).to_pandas()
                    ids = df.id_1km.astype("int64")
                    if ids.duplicated().any():
                        raise ValueError(f"Duplicate cells: {path}")
                    values = pd.Series(df[col].to_numpy(), index=ids).replace([np.inf, -np.inf], np.nan)
                    key = f"{metric}|{period}|{month}"
                    if member == "mean" and period == PERIODS[0]:
                        observed[(metric, month)] = values
                    if period != PERIODS[0]:
                        baseline = observed[(metric, month)]
                        obs = pd.Series(df.obs_value.to_numpy(), index=ids).reindex(baseline.index)
                        if not np.allclose(obs, baseline, atol=1e-5, rtol=0, equal_nan=True):
                            raise ValueError(f"Observed baseline differs: {path}")
                    columns[key] = values.astype("float32")
        frame = pd.DataFrame(columns).sort_index()
        frame.index.name = "id_1km"
        table = pa.Table.from_pandas(frame.reset_index(), preserve_index=False)
        meta = dict(table.schema.metadata or {})
        meta[b"climascope_profile_version"] = b"1"
        meta[b"climascope_profile_data_version"] = version
        table = table.replace_schema_metadata(meta)
        temporary = output / f".{member}.parquet.tmp"
        pq.write_table(table, temporary, row_group_size=512, compression="zstd")
        os.replace(temporary, output / f"{member}.parquet")
        print(f"{member}: {len(frame):,} cells", flush=True)


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=root / "data/precomputed")
    parser.add_argument("--output", type=Path, default=root / "data/place_profiles")
    args = parser.parse_args()
    build(args.source, args.output)
