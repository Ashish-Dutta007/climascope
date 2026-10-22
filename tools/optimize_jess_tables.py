#!/usr/bin/env python3
"""Rewrite Jess's catchment tables for fast reads.

The supplied Parquet files hold ~1,100 small row groups each, so a query on
network storage makes ~1,100 separate reads. This writes the same rows, sorted
by Month, Member and catchment, in 100,000-row groups under data/jess_opt/,
keeping the Variable=/Period=/Metric= layout. app.py uses these copies when
they exist and falls back to data/jess/ otherwise.

Each output is checked against its source before it replaces anything:
same row count and the same area totals by Member, Month, Scenario, Type and
class. Rerun after Jess's tables change:

  venv/bin/python tools/optimize_jess_tables.py
"""
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import duckdb

APP = Path(__file__).resolve().parents[1]
SOURCES = {"parquet": APP / "data/jess/parquet", "parquet_cwr": APP / "data/jess/parquet_cwr"}
OUT = APP / "data/jess_opt"
CHECK = """SELECT Member, Month, Scenario, Type, class, count(*), round(sum(total_area_HA), 3)
           FROM read_parquet(?, hive_partitioning=false) GROUP BY ALL ORDER BY ALL"""


def fingerprint(files):
    digest = hashlib.sha256()
    for f in sorted(files):
        st = f.stat()
        digest.update(f"{f.relative_to(APP)}|{st.st_size}|{int(st.st_mtime)}\n".encode())
    return digest.hexdigest()[:16]


def main():
    t0 = time.time()
    con = duckdb.connect()
    manifest = {"generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "generator": "tools/optimize_jess_tables.py", "row_group_size": 100_000,
                "order": ["Month", "Member", "catchment_name"], "tables": {}}
    for label, root in SOURCES.items():
        for folder in sorted(p for p in root.glob("Variable=*/Period=*/Metric=*") if p.is_dir()):
            files = sorted(folder.glob("*.parquet"))
            if not files:
                continue
            rel = folder.relative_to(root)
            target_dir = OUT / label / rel
            target_dir.mkdir(parents=True, exist_ok=True)
            target, temporary = target_dir / "data.parquet", target_dir / "data.parquet.tmp"
            stamp_file, stamp = target_dir / "source.json", fingerprint(files)
            if target.exists() and stamp_file.exists() and json.loads(stamp_file.read_text()).get("source_fingerprint") == stamp:
                manifest["tables"][f"{label}/{rel}"] = json.loads(stamp_file.read_text())
                print(f"{label}/{rel}: unchanged, kept")
                continue
            pattern = str(folder / "*.parquet")
            con.execute(f"""COPY (SELECT * FROM read_parquet('{pattern}', hive_partitioning=false)
                            ORDER BY Month, Member, catchment_name)
                            TO '{temporary}' (FORMAT parquet, ROW_GROUP_SIZE 100000, COMPRESSION zstd)""")
            before = con.execute(CHECK, [pattern]).fetchall()
            after = con.execute(CHECK, [str(temporary)]).fetchall()
            if before != after:
                temporary.unlink()
                sys.exit(f"MISMATCH in {label}/{rel}: refusing to write")
            for stale in target_dir.glob("*.parquet"):
                if stale != target:
                    stale.unlink()
            os.replace(temporary, target)
            rows = sum(r[5] for r in before)
            manifest["tables"][f"{label}/{rel}"] = {"rows": rows, "source_fingerprint": stamp}
            stamp_file.write_text(json.dumps(manifest["tables"][f"{label}/{rel}"]) + "\n")
            print(f"{label}/{rel}: {rows:,} rows, totals identical")
    (OUT / "MANIFEST.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"{len(manifest['tables'])} tables in {time.time() - t0:.0f}s → {OUT}")


if __name__ == "__main__":
    main()
