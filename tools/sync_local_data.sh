#!/bin/sh
# Copy app data from the shared drive into the local Docker volume the
# container reads (see DEPLOY.md). Run on retina after data changes:
#
#   tools/sync_local_data.sh
#
# Files removed from the source are removed from the volume too, so a stale
# Parquet file can never be read alongside its replacement.
set -eu
SRC=${1:-/mnt/shared/docker/climascope/app/data}
VOLUME=${CLIMASCOPE_DATA_VOLUME:-climascope-data-local}
IMAGE=${SYNC_IMAGE:-alpine:3.22.1}

docker volume create "$VOLUME" >/dev/null
docker run --rm -v "$SRC":/src:ro -v "$VOLUME":/dst "$IMAGE" sh -euc '
  cd /src
  tar --exclude=./test --exclude=./outputs --exclude="./*.log" -cf - . | tar -C /dst -xf -
  cd /dst
  find . -type f ! -path "./outputs/*" | while read -r f; do [ -e "/src/$f" ] || { rm -f "$f"; echo "removed $f"; }; done
  echo "volume holds $(find . -type f ! -path "./outputs/*" | wc -l) files, $(du -sh . | cut -f1)"
'
