#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIF="/mnt/apps/users/adutta/pdal_2.6.sif"
SOURCE="${HILLSHADE_MBTILES:-$ROOT/data/tiles/terrain_hillshade.mbtiles}"
OUTPUT="${HILLSHADE_COG:-$ROOT/data/terrain_hillshade_cog.tif}"

singularity exec -B /mnt "$SIF" gdal_translate "$SOURCE" "$OUTPUT" \
  -of COG \
  -co COMPRESS=DEFLATE \
  -co PREDICTOR=2 \
  -co BLOCKSIZE=512 \
  -co BIGTIFF=IF_SAFER \
  -co NUM_THREADS=ALL_CPUS

singularity exec -B /mnt "$SIF" gdalinfo "$OUTPUT"
