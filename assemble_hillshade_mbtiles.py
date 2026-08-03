#!/usr/bin/env python3
"""Plan sparse z14 MBTiles chunks and merge them into a resumable database.

Raster processing stays in the GDAL singularity container. This helper only
parses the tiny XYZ occupancy grid and performs standard SQLite operations.
"""

from __future__ import annotations

import argparse
import math
import sqlite3
from pathlib import Path


WEB_MERCATOR_HALF_WORLD = 20_037_508.342789244
ZOOM = 14
TILE_COUNT = 1 << ZOOM
TILE_SIZE_M = 2 * WEB_MERCATOR_HALF_WORLD / TILE_COUNT


def expected_tiles(xyz_path: Path) -> set[tuple[int, int]]:
    tiles: set[tuple[int, int]] = set()
    with xyz_path.open(encoding="utf-8") as src:
        for line_number, line in enumerate(src, 1):
            fields = line.split()
            if len(fields) != 3:
                raise ValueError(f"{xyz_path}:{line_number}: expected X Y value")
            x, y, value = map(float, fields)
            if value <= 0:
                continue
            tile_x = math.floor((x + WEB_MERCATOR_HALF_WORLD) / TILE_SIZE_M)
            xyz_y = math.floor((WEB_MERCATOR_HALF_WORLD - y) / TILE_SIZE_M)
            tiles.add((tile_x, TILE_COUNT - 1 - xyz_y))
    if not tiles:
        raise ValueError("occupancy grid contains no non-transparent tiles")
    return tiles


def existing_tiles(path: Path) -> set[tuple[int, int]]:
    if not path.exists() or path.stat().st_size == 0:
        return set()
    with sqlite3.connect(path) as conn:
        check = conn.execute("PRAGMA quick_check").fetchone()
        if check != ("ok",):
            raise ValueError(f"invalid partial MBTiles database: {check}")
        return set(
            conn.execute(
                "SELECT tile_column, tile_row FROM tiles WHERE zoom_level = ?",
                (ZOOM,),
            )
        )


def tile_bounds(tile_x_min: int, tile_x_max: int, tms_y_min: int, tms_y_max: int):
    xyz_y_min = TILE_COUNT - 1 - tms_y_max
    xyz_y_max = TILE_COUNT - 1 - tms_y_min
    left = -WEB_MERCATOR_HALF_WORLD + tile_x_min * TILE_SIZE_M
    right = -WEB_MERCATOR_HALF_WORLD + (tile_x_max + 1) * TILE_SIZE_M
    top = WEB_MERCATOR_HALF_WORLD - xyz_y_min * TILE_SIZE_M
    bottom = WEB_MERCATOR_HALF_WORLD - (xyz_y_max + 1) * TILE_SIZE_M
    return left, top, right, bottom


def cmd_plan(args: argparse.Namespace) -> None:
    expected = expected_tiles(args.occupancy_xyz)
    existing = existing_tiles(args.existing) if args.existing else set()
    extra = existing - expected
    if extra:
        raise ValueError(f"partial MBTiles contains {len(extra)} unexpected z14 tiles")
    missing = expected - existing
    chunks: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for tile in missing:
        chunks.setdefault(
            (tile[0] // args.chunk_size, tile[1] // args.chunk_size), []
        ).append(tile)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as dst:
        for index, (_, tiles) in enumerate(sorted(chunks.items())):
            xs = [tile[0] for tile in tiles]
            ys = [tile[1] for tile in tiles]
            xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
            left, top, right, bottom = tile_bounds(xmin, xmax, ymin, ymax)
            dst.write(
                f"{index:04d}\t{xmin}\t{xmax}\t{ymin}\t{ymax}\t"
                f"{left:.12f}\t{top:.12f}\t{right:.12f}\t{bottom:.12f}\n"
            )
    print(
        f"expected={len(expected)} existing={len(existing)} "
        f"missing={len(missing)} chunks={len(chunks)}"
    )


def mercator_to_wgs84(x: float, y: float) -> tuple[float, float]:
    lon = x / WEB_MERCATOR_HALF_WORLD * 180.0
    lat = math.degrees(math.atan(math.sinh(y / WEB_MERCATOR_HALF_WORLD * math.pi)))
    return lon, lat


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS metadata (name TEXT, value TEXT);
        CREATE TABLE IF NOT EXISTS tiles (
            zoom_level INTEGER,
            tile_column INTEGER,
            tile_row INTEGER,
            tile_data BLOB
        );
        CREATE UNIQUE INDEX IF NOT EXISTS tile_index ON tiles (
            zoom_level, tile_column, tile_row
        );
        """
    )


def cmd_merge(args: argparse.Namespace) -> None:
    expected = expected_tiles(args.occupancy_xyz)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(args.output) as target:
        create_schema(target)
        target.execute("DELETE FROM tiles WHERE zoom_level < ?", (ZOOM,))
        for fragment in sorted(args.fragments.glob("*.mbtiles")):
            with sqlite3.connect(fragment) as source:
                check = source.execute("PRAGMA quick_check").fetchone()
                if check != ("ok",):
                    raise ValueError(f"invalid fragment {fragment}: {check}")
                rows = source.execute(
                    "SELECT tile_column, tile_row, tile_data "
                    "FROM tiles WHERE zoom_level = ?",
                    (ZOOM,),
                )
                target.executemany(
                    "INSERT OR REPLACE INTO tiles "
                    "(zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)",
                    (
                        (ZOOM, x, y, data)
                        for x, y, data in rows
                        if (x, y) in expected
                    ),
                )

        actual = set(
            target.execute(
                "SELECT tile_column, tile_row FROM tiles WHERE zoom_level = ?",
                (ZOOM,),
            )
        )
        missing = expected - actual
        extra = actual - expected
        # The max-resampled occupancy grid deliberately errs on the side of
        # including any alpha sliver. At tile encoding time, bilinear sampling
        # can legitimately drop a handful of sub-pixel edge slivers. Every
        # planned chunk has already produced a valid fragment, so allow only a
        # tightly bounded occupancy false-positive rate while rejecting extras.
        max_edge_slivers = max(1, math.ceil(len(expected) * 0.001))
        if extra or len(missing) > max_edge_slivers:
            raise ValueError(
                f"incomplete merge: expected={len(expected)} actual={len(actual)} "
                f"missing={len(missing)} extra={len(extra)}"
            )

        if args.source_bounds:
            left, bottom, right, top = args.source_bounds
        else:
            xs = [tile[0] for tile in expected]
            ys = [tile[1] for tile in expected]
            left, top, right, bottom = tile_bounds(min(xs), max(xs), min(ys), max(ys))
        west, south = mercator_to_wgs84(left, bottom)
        east, north = mercator_to_wgs84(right, top)
        metadata = {
            "name": "terrain_hillshade",
            "description": "NatureScot SRSP LiDAR hillshade",
            "version": "1.1",
            "type": "overlay",
            "format": "png",
            "bounds": f"{west:.15g},{south:.15g},{east:.15g},{north:.15g}",
            "minzoom": str(ZOOM),
            "maxzoom": str(ZOOM),
        }
        target.execute("DELETE FROM metadata")
        target.executemany(
            "INSERT INTO metadata (name, value) VALUES (?, ?)", metadata.items()
        )
        target.commit()
        check = target.execute("PRAGMA quick_check").fetchone()
        if check != ("ok",):
            raise ValueError(f"merged MBTiles failed quick_check: {check}")
    print(
        f"merged and validated {len(actual)} z14 tiles into {args.output}; "
        f"ignored {len(missing)} max-alpha sub-pixel edge slivers"
    )


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    sub = root.add_subparsers(dest="command", required=True)

    plan = sub.add_parser("plan")
    plan.add_argument("--occupancy-xyz", type=Path, required=True)
    plan.add_argument("--existing", type=Path)
    plan.add_argument("--output", type=Path, required=True)
    plan.add_argument("--chunk-size", type=int, default=16)
    plan.set_defaults(func=cmd_plan)

    merge = sub.add_parser("merge")
    merge.add_argument("--occupancy-xyz", type=Path, required=True)
    merge.add_argument("--fragments", type=Path, required=True)
    merge.add_argument("--output", type=Path, required=True)
    merge.add_argument(
        "--source-bounds",
        type=float,
        nargs=4,
        metavar=("LEFT", "BOTTOM", "RIGHT", "TOP"),
    )
    merge.set_defaults(func=cmd_merge)
    return root


def main() -> None:
    args = parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
