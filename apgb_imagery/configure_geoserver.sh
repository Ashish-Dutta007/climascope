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
rest="$base/rest"
auth=(--netrc-file "$here/runtime/secrets/geoserver.netrc")

request() {
    curl --fail --silent --show-error "${auth[@]}" "$@"
}

echo "Waiting for GeoServer REST API..."
for _ in $(seq 1 90); do
    if request "$rest/about/version.json" >/dev/null 2>&1; then
        break
    fi
    sleep 2
done
request "$rest/about/version.json" >/dev/null

if ! request "$rest/workspaces/apgb.json?quietOnNotFound=true" >/dev/null 2>&1; then
    request -X POST -H 'Content-Type: application/json' \
        -d '{"workspace":{"name":"apgb"}}' \
        "$rest/workspaces"
    echo "Created workspace apgb"
fi

store_url="$rest/workspaces/apgb/coveragestores/aerial_125mm.json?quietOnNotFound=true"
if ! request "$store_url" >/dev/null 2>&1; then
    request -X POST -H 'Content-Type: application/json' \
        -d '{"coverageStore":{"name":"aerial_125mm","type":"ImageMosaic","enabled":true,"workspace":{"name":"apgb"},"url":"file:///opt/apgb_mosaic"}}' \
        "$rest/workspaces/apgb/coveragestores"
    echo "Created APGB ImageMosaic store"
fi

coverage_url="$rest/workspaces/apgb/coveragestores/aerial_125mm/coverages/aerial_125mm.json?quietOnNotFound=true"
if ! request "$coverage_url" >/dev/null 2>&1; then
    request -X POST -H 'Content-Type: application/json' \
        -d '{"coverage":{"nativeCoverageName":"aerial_125mm","name":"aerial_125mm","title":"APGB Latest 12.5 cm aerial imagery","abstract":"Licensed APGB Getmapping RGB aerial imagery for internal Hutton use.","srs":"EPSG:27700","projectionPolicy":"REPROJECT_TO_DECLARED","enabled":true}}' \
        "$rest/workspaces/apgb/coveragestores/aerial_125mm/coverages"
    echo "Published APGB aerial coverage"
fi

# Restrict the tile cache to JPEG Web Mercator tiles. Native EPSG:27700 remains
# available through WMS for print/export or exact British National Grid work.
request -X PUT -H 'Content-Type: application/xml' --data-binary @- \
    "$base/gwc/rest/layers/apgb:aerial_125mm.xml" <<'XML'
<GeoServerLayer>
  <name>apgb:aerial_125mm</name>
  <enabled>true</enabled>
  <gridSubsets>
    <gridSubset><gridSetName>EPSG:900913</gridSetName></gridSubset>
  </gridSubsets>
  <mimeFormats><string>image/jpeg</string></mimeFormats>
  <metaWidthHeight><int>4</int><int>4</int></metaWidthHeight>
  <gutter>0</gutter>
</GeoServerLayer>
XML

cache_gib=${APGB_CACHE_GIB:-50}
request -X PUT -H 'Content-Type: application/xml' --data-binary @- \
    "$base/gwc/rest/diskquota.xml" <<XML
<gwcQuotaConfiguration>
  <enabled>true</enabled>
  <diskBlockSize>4096</diskBlockSize>
  <cacheCleanUpFrequency>10</cacheCleanUpFrequency>
  <cacheCleanUpUnits>MINUTES</cacheCleanUpUnits>
  <maxConcurrentCleanUps>1</maxConcurrentCleanUps>
  <globalExpirationPolicyName>LRU</globalExpirationPolicyName>
  <globalQuota><value>${cache_gib}</value><units>GiB</units></globalQuota>
</gwcQuotaConfiguration>
XML

echo "GeoServer catalogue and ${cache_gib} GiB LRU tile cache configured"
"$here/smoke_test.sh"
