#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIF="${GDAL_CONTAINER:-/mnt/apps/users/adutta/pdal_2.6.sif}"
SOURCE="${HILLSHADE_MBTILES:-$ROOT/data/tiles/terrain_hillshade.mbtiles}"
OUTPUT="${HILLSHADE_COG:-$ROOT/data/terrain_hillshade_cog.tif}"
PART="${OUTPUT}.part.tif"
THREADS="${THREADS:-ALL_CPUS}"

mkdir -p "$(dirname "$OUTPUT")"
rm -f "$PART"

APPTAINERENV_PROJ_NETWORK=OFF singularity exec -B /mnt "$SIF" \
  gdal_translate "$SOURCE" "$PART" \
  -of COG \
  -co COMPRESS=DEFLATE \
  -co PREDICTOR=2 \
  -co BLOCKSIZE=512 \
  -co BIGTIFF=IF_SAFER \
  -co "NUM_THREADS=$THREADS"

band_count=$(APPTAINERENV_PROJ_NETWORK=OFF singularity exec -B /mnt "$SIF" \
  gdalinfo "$PART" | grep -c '^Band ')
[[ "$band_count" -eq 4 ]] || {
  echo "ERROR: COG has $band_count bands; expected RGBA (4)" >&2
  exit 1
}

mv -f "$PART" "$OUTPUT"
APPTAINERENV_PROJ_NETWORK=OFF singularity exec -B /mnt "$SIF" gdalinfo "$OUTPUT"
