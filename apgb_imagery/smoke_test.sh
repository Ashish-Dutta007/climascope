#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [[ -f "$here/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$here/.env"
    set +a
fi

port=${APGB_GEOSERVER_PORT:-8181}
base="http://127.0.0.1:${port}/apgb"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl --fail --silent --show-error \
    "$base/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0" \
    -o "$tmp/wmts.xml"
grep -q 'apgb:aerial_125mm' "$tmp/wmts.xml"

# A small native-CRS image within the downloaded footprint exercises the
# ImageMosaic reader without warming a large national cache area.
curl --fail --silent --show-error --get "$base/wms" \
    --data-urlencode 'SERVICE=WMS' \
    --data-urlencode 'VERSION=1.1.1' \
    --data-urlencode 'REQUEST=GetMap' \
    --data-urlencode 'LAYERS=apgb:aerial_125mm' \
    --data-urlencode 'SRS=EPSG:27700' \
    --data-urlencode 'BBOX=197000,629000,198000,630000' \
    --data-urlencode 'WIDTH=512' \
    --data-urlencode 'HEIGHT=512' \
    --data-urlencode 'FORMAT=image/jpeg' \
    -o "$tmp/sample.jpg"

content_type=$(file --brief --mime-type "$tmp/sample.jpg")
if [[ "$content_type" != "image/jpeg" ]]; then
    echo "Expected JPEG map response, got $content_type" >&2
    exit 1
fi

echo "WMTS catalogue and sample APGB image passed"
echo "QGIS WMTS URL: $base/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetCapabilities"
