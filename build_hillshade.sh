#!/usr/bin/env bash
# Build the NatureScot SRSP hillshade MBTiles from every available DTM.
#
# The SRSP archive has two nodata conventions. NLP 2025 uses -32767; all
# other collections use -9999. They must be normalised in separate VRT/warp
# stages or one value is interpreted as real terrain and becomes black land.
#
# This is intentionally resumable: completed multi-minute intermediates are
# kept in WORK_DIR. Set FORCE=1 to rebuild all stages after source changes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIF="${GDAL_CONTAINER:-/mnt/apps/users/adutta/pdal_2.6.sif}"
SRSP_ROOT="${SRSP_ROOT:-/mnt/shared/datasets/spatial/natureScot/SRSP/lidar}"
WORK_DIR="${HILLSHADE_WORK_DIR:-$ROOT/data/hillshade_build}"
OUTPUT="${HILLSHADE_MBTILES:-$ROOT/data/tiles/terrain_hillshade.mbtiles}"
EXPECTED_DTM_COUNT="${EXPECTED_DTM_COUNT:-4753}"
EXPECTED_NLP_COUNT="${EXPECTED_NLP_COUNT:-1590}"
TARGET_RESOLUTION="${TARGET_RESOLUTION:-10}"
GDAL_CACHEMAX_MB="${GDAL_CACHEMAX_MB:-4096}"
WARP_MEMORY_MB="${WARP_MEMORY_MB:-4096}"
THREADS="${THREADS:-ALL_CPUS}"
ENCODE_JOBS="${ENCODE_JOBS:-4}"
PYTHON="${PYTHON:-$ROOT/venv/bin/python}"
FORCE="${FORCE:-0}"
BUILD_EXPORT_COG="${BUILD_EXPORT_COG:-1}"

mkdir -p "$WORK_DIR" "$(dirname "$OUTPUT")"

gdal() {
  # Prevent multi-threaded warps from contending on PROJ's optional download
  # cache. The container's installed transformations are deterministic and
  # sufficient for the same EPSG:27700 -> EPSG:3857 path used by the old build.
  APPTAINERENV_PROJ_NETWORK=OFF singularity exec -B /mnt "$SIF" "$@"
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

require_file() {
  [[ -s "$1" ]] || { log "ERROR: expected non-empty file: $1" >&2; exit 1; }
}

ALL_LIST="$WORK_DIR/dtm_all.txt"
NLP_LIST="$WORK_DIR/dtm_nlp_2025.txt"
OTHER_LIST="$WORK_DIR/dtm_other.txt"
MANIFEST_HASH="$WORK_DIR/manifest.sha256"

find "$SRSP_ROOT" -type f \( -iname '*.tif' -o -iname '*.tiff' \) \
  -path '*/dtm/*' -print | LC_ALL=C sort > "$ALL_LIST.new"
grep -F '/nlp/nlp-2025/dtm/' "$ALL_LIST.new" > "$NLP_LIST.new" || true
grep -Fv '/nlp/nlp-2025/dtm/' "$ALL_LIST.new" > "$OTHER_LIST.new" || true

all_count=$(wc -l < "$ALL_LIST.new")
nlp_count=$(wc -l < "$NLP_LIST.new")
other_count=$(wc -l < "$OTHER_LIST.new")
[[ "$all_count" -gt 0 && "$nlp_count" -gt 0 && "$other_count" -gt 0 ]] || {
  log "ERROR: DTM discovery returned all=$all_count nlp=$nlp_count other=$other_count" >&2
  exit 1
}
if [[ -n "$EXPECTED_DTM_COUNT" && "$all_count" -ne "$EXPECTED_DTM_COUNT" ]]; then
  log "ERROR: found $all_count DTMs; expected $EXPECTED_DTM_COUNT (override EXPECTED_DTM_COUNT for a new delivery)" >&2
  exit 1
fi
if [[ -n "$EXPECTED_NLP_COUNT" && "$nlp_count" -ne "$EXPECTED_NLP_COUNT" ]]; then
  log "ERROR: found $nlp_count NLP DTMs; expected $EXPECTED_NLP_COUNT (override EXPECTED_NLP_COUNT if appropriate)" >&2
  exit 1
fi
log "Discovered $all_count DTMs: $nlp_count NLP (-32767 nodata), $other_count other (-9999 nodata)"

new_hash=$(cat "$ALL_LIST.new" | sha256sum | awk '{print $1}')
if [[ -s "$MANIFEST_HASH" ]] && [[ "$(cat "$MANIFEST_HASH")" != "$new_hash" ]] && [[ "$FORCE" != 1 ]]; then
  log "ERROR: source manifest changed; rerun with FORCE=1 so cached rasters are not reused" >&2
  exit 1
fi
mv "$ALL_LIST.new" "$ALL_LIST"
mv "$NLP_LIST.new" "$NLP_LIST"
mv "$OTHER_LIST.new" "$OTHER_LIST"
printf '%s\n' "$new_hash" > "$MANIFEST_HASH"

NLP_VRT="$WORK_DIR/nlp_2025.vrt"
OTHER_VRT="$WORK_DIR/other_collections.vrt"
EXTENT_VRT="$WORK_DIR/all_extent.vrt"
TARGET_GRID_VRT="$WORK_DIR/target_grid_3857.vrt"
NLP_WARP="$WORK_DIR/nlp_2025_3857_10m.tif"
OTHER_WARP="$WORK_DIR/other_collections_3857_10m.tif"
MOSAIC_VRT="$WORK_DIR/all_dtm_3857_10m.vrt"
HILLSHADE_GRAY="$WORK_DIR/hillshade_gray.tif"
HILLSHADE_RGBA="$WORK_DIR/hillshade_rgba.tif"
MBTILES_PART="$WORK_DIR/terrain_hillshade.part.mbtiles"
Z14_OCCUPANCY="$WORK_DIR/z14_occupancy.tif"
Z14_OCCUPANCY_XYZ="$WORK_DIR/z14_occupancy.xyz"
ENCODE_PLAN="$WORK_DIR/z14_encode_plan.tsv"
FRAGMENT_DIR="$WORK_DIR/mbtiles_fragments"

if [[ "$FORCE" == 1 ]]; then
  log "FORCE=1: removing cached build stages"
  rm -f "$NLP_VRT" "$OTHER_VRT" "$EXTENT_VRT" "$TARGET_GRID_VRT" \
    "$NLP_WARP" "$OTHER_WARP" "$MOSAIC_VRT" "$HILLSHADE_GRAY" \
    "$HILLSHADE_RGBA" "$MBTILES_PART" "$MBTILES_PART-wal" "$MBTILES_PART-shm" \
    "$Z14_OCCUPANCY" "$Z14_OCCUPANCY_XYZ" "$ENCODE_PLAN"
  if [[ -d "$FRAGMENT_DIR" ]]; then
    find "$FRAGMENT_DIR" -type f -delete
  fi
fi

build_group_vrt() {
  local input_list="$1" source_nodata="$2" output_vrt="$3" label="$4"
  [[ ! -s "$output_vrt" ]] || { log "Reusing completed $label VRT"; return; }

  local stem="${output_vrt%.vrt}"
  local probe_vrt="$stem.probe.vrt" probe_log="$stem.probe.log"
  local resolved_list="$stem.resolved.txt" final_log="$stem.log"
  rm -f "$probe_vrt" "$probe_log" "$resolved_list" "$final_log"

  log "Building $label VRT with explicit $source_nodata source nodata"
  gdal gdalbuildvrt -overwrite -input_file_list "$input_list" \
    -srcnodata "$source_nodata" -vrtnodata -9999 "$probe_vrt" 2> "$probe_log"
  cat "$probe_log" >&2

  # A few SRSP files use a different numeric storage type. gdalbuildvrt skips
  # heterogeneous types, so wrap only those outliers in lazy Float32 VRTs and
  # rebuild. This preserves every source without materialising another raster.
  mapfile -t type_outliers < <(
    sed -n 's/^Warning 1: gdalbuildvrt does not support heterogeneous band data type:.* Skipping //p' "$probe_log"
  )
  mapfile -t all_skipped < <(sed -n 's/^Warning 1: .*Skipping //p' "$probe_log")
  if [[ "${#all_skipped[@]}" -ne "${#type_outliers[@]}" ]]; then
    log "ERROR: $label VRT skipped a source for a reason other than numeric data type" >&2
    exit 1
  fi

  cp "$input_list" "$resolved_list"
  if [[ "${#type_outliers[@]}" -gt 0 ]]; then
    log "Normalising ${#type_outliers[@]} $label data-type outlier(s) to lazy Float32 VRTs"
    mkdir -p "$WORK_DIR/normalised_float32"
    for source in "${type_outliers[@]}"; do
      source_hash=$(printf '%s' "$source" | sha256sum | cut -c1-16)
      normalised="$WORK_DIR/normalised_float32/${source_hash}_$(basename "${source%.*}").vrt"
      if [[ ! -s "$normalised" ]]; then
        gdal gdal_translate -q -of VRT -ot Float32 -a_nodata "$source_nodata" \
          "$source" "$normalised"
      fi
      awk -v old="$source" -v new="$normalised" \
        '$0 == old { print new; next } { print }' "$resolved_list" > "$resolved_list.new"
      mv "$resolved_list.new" "$resolved_list"
    done
  fi

  rm -f "$output_vrt.part.vrt"
  gdal gdalbuildvrt -overwrite -input_file_list "$resolved_list" \
    -srcnodata "$source_nodata" -vrtnodata -9999 "$output_vrt.part.vrt" 2> "$final_log"
  cat "$final_log" >&2
  if grep -q 'Skipping ' "$final_log"; then
    log "ERROR: final $label VRT still skipped one or more sources" >&2
    exit 1
  fi
  expected=$(wc -l < "$input_list")
  included=$(grep -c '<SourceFilename' "$output_vrt.part.vrt")
  [[ "$included" -eq "$expected" ]] || {
    log "ERROR: final $label VRT contains $included sources; expected $expected" >&2
    exit 1
  }
  mv "$output_vrt.part.vrt" "$output_vrt"
  rm -f "$probe_vrt"
  log "$label VRT includes all $included sources"
}

build_group_vrt "$NLP_LIST" -32767 "$NLP_VRT" "NLP 2025"
build_group_vrt "$OTHER_LIST" -9999 "$OTHER_VRT" "non-NLP"
require_file "$NLP_VRT"
require_file "$OTHER_VRT"

# Use the combined VRT only to derive the union extent. Pixel values are never
# read from it until both nodata groups have been normalised independently.
if [[ ! -s "$EXTENT_VRT" ]]; then
  gdal gdalbuildvrt -overwrite -srcnodata -9999 -vrtnodata -9999 \
    "$EXTENT_VRT.part.vrt" "$OTHER_VRT" "$NLP_VRT"
  mv "$EXTENT_VRT.part.vrt" "$EXTENT_VRT"
fi
if [[ ! -s "$TARGET_GRID_VRT" ]]; then
  log "Deriving a common EPSG:3857 ${TARGET_RESOLUTION}m target grid"
  gdal gdalwarp -overwrite -of VRT -t_srs EPSG:3857 \
    -tr "$TARGET_RESOLUTION" "$TARGET_RESOLUTION" -tap -r bilinear \
    -srcnodata -9999 -dstnodata -9999 "$EXTENT_VRT" "$TARGET_GRID_VRT.part.vrt"
  mv "$TARGET_GRID_VRT.part.vrt" "$TARGET_GRID_VRT"
fi

grid_info=$(gdal gdalinfo "$TARGET_GRID_VRT")
read -r grid_width grid_height < <(
  sed -n 's/^Size is \([0-9][0-9]*\), \([0-9][0-9]*\)$/\1 \2/p' <<< "$grid_info"
)
read -r xmin ymax < <(
  sed -n 's/^Origin = ( *\([^,]*\), *\([^)]*\))$/\1 \2/p' <<< "$grid_info"
)
read -r xres yres < <(
  sed -n 's/^Pixel Size = ( *\([^,]*\), *\([^)]*\))$/\1 \2/p' <<< "$grid_info"
)
[[ -n "${grid_width:-}" && -n "${grid_height:-}" && -n "${xmin:-}" && -n "${ymax:-}" ]] || {
  log "ERROR: could not parse target grid metadata" >&2
  exit 1
}
xmax=$(awk -v x="$xmin" -v w="$grid_width" -v r="$xres" 'BEGIN { printf "%.10f", x + w * r }')
ymin=$(awk -v y="$ymax" -v h="$grid_height" -v r="$yres" 'BEGIN { printf "%.10f", y + h * r }')
log "Target grid: ${grid_width}x${grid_height}; extent $xmin $ymin $xmax $ymax"

warp_group() {
  local source_vrt="$1" output_tif="$2" label="$3"
  if [[ -s "$output_tif" ]]; then
    log "Reusing completed $label warp: $output_tif"
    return
  fi
  local part="${output_tif%.tif}.part.tif"
  rm -f "$part"
  log "Warping $label to the common 10 m grid (I/O-heavy stage)"
  gdal gdalwarp --config GDAL_CACHEMAX "$GDAL_CACHEMAX_MB" \
    -overwrite -t_srs EPSG:3857 -te "$xmin" "$ymin" "$xmax" "$ymax" \
    -tr "$TARGET_RESOLUTION" "$TARGET_RESOLUTION" -tap -r bilinear \
    -srcnodata -9999 -dstnodata -9999 -ot Float32 \
    -multi -wo "NUM_THREADS=$THREADS" -wm "$WARP_MEMORY_MB" \
    -co TILED=YES -co BLOCKXSIZE=512 -co BLOCKYSIZE=512 \
    -co COMPRESS=DEFLATE -co PREDICTOR=3 -co BIGTIFF=YES \
    -co SPARSE_OK=YES -co "NUM_THREADS=$THREADS" \
    "$source_vrt" "$part"
  mv "$part" "$output_tif"
}

warp_group "$NLP_VRT" "$NLP_WARP" "NLP 2025"
warp_group "$OTHER_VRT" "$OTHER_WARP" "all non-NLP collections"

if [[ ! -s "$MOSAIC_VRT" ]]; then
  log "Mosaicking aligned nodata-normalised warps (NLP last/newest in overlaps)"
  gdal gdalbuildvrt -overwrite -srcnodata -9999 -vrtnodata -9999 \
    "$MOSAIC_VRT.part.vrt" "$OTHER_WARP" "$NLP_WARP"
  mv "$MOSAIC_VRT.part.vrt" "$MOSAIC_VRT"
fi

if [[ ! -s "$HILLSHADE_GRAY" ]]; then
  rm -f "$WORK_DIR/hillshade_gray.part.tif"
  log "Computing hillshade across the normalised 10 m mosaic"
  gdal gdaldem hillshade "$MOSAIC_VRT" "$WORK_DIR/hillshade_gray.part.tif" \
    -compute_edges -of GTiff \
    -co TILED=YES -co BLOCKXSIZE=512 -co BLOCKYSIZE=512 \
    -co COMPRESS=DEFLATE -co BIGTIFF=YES -co SPARSE_OK=YES \
    -co "NUM_THREADS=$THREADS"
  mv "$WORK_DIR/hillshade_gray.part.tif" "$HILLSHADE_GRAY"
fi

if [[ ! -s "$HILLSHADE_RGBA" ]]; then
  rm -f "$WORK_DIR/hillshade_rgba.part.tif"
  log "Adding alpha band so nodata remains transparent"
  gdal gdalwarp --config GDAL_CACHEMAX "$GDAL_CACHEMAX_MB" \
    -overwrite -srcnodata 0 -dstnodata 0 -dstalpha -r near \
    -multi -wo "NUM_THREADS=$THREADS" -wm "$WARP_MEMORY_MB" \
    -co TILED=YES -co BLOCKXSIZE=512 -co BLOCKYSIZE=512 \
    -co COMPRESS=DEFLATE -co BIGTIFF=YES -co SPARSE_OK=YES \
    -co "NUM_THREADS=$THREADS" \
    "$HILLSHADE_GRAY" "$WORK_DIR/hillshade_rgba.part.tif"
  mv "$WORK_DIR/hillshade_rgba.part.tif" "$HILLSHADE_RGBA"
fi

# Encoding the full sparse national bounding rectangle in one gdal_translate
# repeatedly scans hundreds of GB of transparent pixels and cannot resume. A
# one-pixel-per-z14-tile alpha occupancy grid lets us encode only populated
# 16x16 tile chunks. Committed z14 tiles in MBTILES_PART are retained, so a
# timeout resumes by planning only the missing chunks.
Z14_RESOLUTION="2445.98490512564"
if [[ ! -s "$Z14_OCCUPANCY" ]]; then
  log "Building the sparse z14 alpha occupancy grid"
  gdal gdalwarp --config GDAL_CACHEMAX "$GDAL_CACHEMAX_MB" \
    -overwrite -b 2 -r max -tr "$Z14_RESOLUTION" "$Z14_RESOLUTION" -tap \
    -srcnodata 0 -dstnodata 0 -ot Byte \
    -multi -wo "NUM_THREADS=$THREADS" -wm "$WARP_MEMORY_MB" \
    -co TILED=YES -co COMPRESS=DEFLATE -co SPARSE_OK=YES \
    "$HILLSHADE_RGBA" "$Z14_OCCUPANCY.part.tif"
  mv "$Z14_OCCUPANCY.part.tif" "$Z14_OCCUPANCY"
fi
if [[ ! -s "$Z14_OCCUPANCY_XYZ" ]]; then
  gdal gdal_translate -q -of XYZ "$Z14_OCCUPANCY" "$Z14_OCCUPANCY_XYZ.part"
  mv "$Z14_OCCUPANCY_XYZ.part" "$Z14_OCCUPANCY_XYZ"
fi

mkdir -p "$FRAGMENT_DIR"
log "Planning resumable sparse z14 MBTiles chunks"
plan_args=(
  plan --occupancy-xyz "$Z14_OCCUPANCY_XYZ"
  --output "$ENCODE_PLAN" --chunk-size 16
)
if [[ -s "$MBTILES_PART" ]]; then
  plan_args+=(--existing "$MBTILES_PART")
fi
"$PYTHON" "$ROOT/assemble_hillshade_mbtiles.py" "${plan_args[@]}"

encode_fragment() {
  local chunk_id="$1" left="$2" top="$3" right="$4" bottom="$5"
  local fragment="$FRAGMENT_DIR/chunk_${chunk_id}.mbtiles"
  local part="$fragment.part"
  [[ ! -s "$fragment" ]] || { log "Reusing encoded chunk $chunk_id"; return; }
  rm -f "$part" "$part-journal" "$part-wal" "$part-shm"
  log "Encoding z14 chunk $chunk_id"
  gdal gdal_translate -q \
    -projwin "$left" "$top" "$right" "$bottom" -projwin_srs EPSG:3857 \
    "$HILLSHADE_RGBA" "$part" \
    -b 1 -b 1 -b 1 -b 2 -of MBTILES \
    -co NAME=terrain_hillshade \
    -co DESCRIPTION='NatureScot SRSP LiDAR hillshade' \
    -co TYPE=overlay -co TILE_FORMAT=PNG -co ZLEVEL=6 \
    -co RESAMPLING=BILINEAR -co ZOOM_LEVEL_STRATEGY=AUTO \
    -co WRITE_BOUNDS=YES -co WRITE_MINMAXZOOM=YES
  mv "$part" "$fragment"
}

active_jobs=0
while IFS=$'\t' read -r chunk_id _xmin _xmax _ymin _ymax left top right bottom; do
  encode_fragment "$chunk_id" "$left" "$top" "$right" "$bottom" &
  ((active_jobs += 1))
  if (( active_jobs >= ENCODE_JOBS )); then
    wait -n
    ((active_jobs -= 1))
  fi
done < "$ENCODE_PLAN"
wait

log "Merging and validating all expected z14 tiles"
"$PYTHON" "$ROOT/assemble_hillshade_mbtiles.py" merge \
  --occupancy-xyz "$Z14_OCCUPANCY_XYZ" \
  --fragments "$FRAGMENT_DIR" --output "$MBTILES_PART" \
  --source-bounds "$xmin" "$ymin" "$xmax" "$ymax"

log "Building MBTiles overviews"
gdal gdaladdo -r bilinear "$MBTILES_PART" 2 4 8 16 32 64 128 256

require_file "$MBTILES_PART"
band_count=$(gdal gdalinfo "$MBTILES_PART" | grep -c '^Band ')
[[ "$band_count" -eq 4 ]] || { log "ERROR: MBTiles has $band_count bands, expected RGBA (4)" >&2; exit 1; }

# WORK_DIR defaults inside data/, so this rename stays on the shared filesystem
# and replaces the live MBTiles only after every stage and validation succeeds.
log "Publishing completed MBTiles to $OUTPUT"
mv -f "$MBTILES_PART" "$OUTPUT"
log "Hillshade MBTiles build complete: $(du -h "$OUTPUT" | awk '{print $1}')"

if [[ "$BUILD_EXPORT_COG" == 1 ]]; then
  log "Rebuilding the export COG from the published MBTiles"
  THREADS="$THREADS" HILLSHADE_MBTILES="$OUTPUT" "$ROOT/build_hillshade_cog.sh"
fi
