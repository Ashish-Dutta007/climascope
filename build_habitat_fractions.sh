#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HLCM_SOURCE="${1:-/mnt/shared/datasets/spatial/natureScot/HLCM/HLCM_2022_EUNIS_LEVEL2.tif}"
OUTPUT="${2:-$APP_DIR/data/habitat_fractions.parquet}"
GRID_IDS="${GRID_IDS:-$APP_DIR/data/grid_ids_scotland.tif}"
CONTAINER="${GDAL_CONTAINER:-/mnt/apps/users/adutta/pdal_2.6.sif}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/climascope-habitat.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

gdal() {
  singularity exec -B /mnt "$CONTAINER" "$@"
}

[[ -f "$HLCM_SOURCE" ]] || { echo "Missing HLCM source: $HLCM_SOURCE" >&2; exit 1; }
[[ -f "$GRID_IDS" ]] || { echo "Missing grid ID raster: $GRID_IDS" >&2; exit 1; }

calc_args=()
for code in $(seq 1 28); do
  calc_args+=(--calc "(A == $code)")
done
calc_args+=(--calc "((A >= 1) * (A <= 28))")

# Materialise the algebra directly. A GDALG virtual output is tempting here,
# but GDAL 3.11 can optimise past it during a same-size copy or warp and average
# the original category codes instead of the binary masks.
gdal gdal raster calc \
  -i "A=$HLCM_SOURCE" -o "$WORK/masks.tif" -f GTiff \
  "${calc_args[@]}" --output-data-type Byte --overwrite \
  --co TILED=YES --co BLOCKXSIZE=256 --co BLOCKYSIZE=256 \
  --co COMPRESS=DEFLATE --co BIGTIFF=YES

gdal gdalwarp --config GDAL_NUM_THREADS ALL_CPUS -multi -wo NUM_THREADS=ALL_CPUS \
  -wm 1024 -r average -ot Float32 \
  -te 55000 530000 469000 1218000 -tr 1000 1000 \
  -co TILED=YES -co COMPRESS=DEFLATE -co PREDICTOR=3 \
  "$WORK/masks.tif" "$WORK/hlcm_1km.tif"

gdal gdal_translate -q -of ENVI -co INTERLEAVE=BSQ \
  "$WORK/hlcm_1km.tif" "$WORK/habitat_values.bin"
gdal gdal_translate -q -of ENVI -co INTERLEAVE=BSQ \
  "$GRID_IDS" "$WORK/grid_ids.bin"

mkdir -p "$(dirname "$OUTPUT")"
"$APP_DIR/venv/bin/python" "$APP_DIR/assemble_habitat_fractions.py" \
  "$WORK/habitat_values.bin" "$WORK/grid_ids.bin" "$OUTPUT" \
  --width 414 --height 688
