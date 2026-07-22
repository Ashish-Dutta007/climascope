# APGB aerial imagery service for QGIS

This isolated stack exposes the licensed APGB Getmapping 12.5 cm imagery as a
single GeoServer ImageMosaic layer. GeoWebCache provides JPEG WMTS tiles on
demand, so QGIS behaves as if the imagery were a basemap rather than opening
thousands of 60–100 MB files.

The source imagery remains read-only. The service indexes only the canonical
`tiles_125mm_{NG,NK,NL,NM,NR,NS,NW,NX}` directories (currently 4,261 TIFFs),
excluding the duplicate Galloway subset and pilot mosaic.

## 1. Start on retina

Run these commands on the persistent `retina` Docker host, not on a SLURM
compute node:

```bash
cd /mnt/shared/docker/climascope/app/apgb_imagery
./setup.sh
docker compose up -d
docker compose ps
./configure_geoserver.sh
```

`setup.sh` creates a strong GeoServer administrator secret under the ignored
`runtime/` directory. Do not print, email or commit that password.

The default port binding is `127.0.0.1:8181`; the service is therefore not
exposed to the internet or institute network. Docker named volumes hold the
GeoServer catalogue, the small mosaic index, and a cache limited to 50 GiB with
least-recently-used eviction. The 270 GB source dataset is not copied.

## 2. Reach it securely from desktop QGIS

Keep this tunnel running in a terminal on the desktop:

```bash
ssh -J adutta@gruffalo.cropdiversity.ac.uk \
  -L 8181:127.0.0.1:8181 \
  adutta@retina.hpc.hutton.ac.uk -N
```

Off-site access requires the SSH key and 2FA configuration used for the HPC.
If `retina` does not permit your SSH login, ask Research Computing to create the
equivalent tunnel or protected proxy route; do not bind GeoServer publicly as a
workaround.

In QGIS:

1. Open **Data Source Manager → WMS/WMTS → New**.
2. Name it `APGB aerial imagery`.
3. Use this URL:

   ```text
   http://127.0.0.1:8181/apgb/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetCapabilities
   ```

4. Connect and add `apgb:aerial_125mm`.

WMTS is the fast basemap path and is cached as JPEG in EPSG:3857. For exact
British National Grid output, add a second QGIS WMS connection using:

```text
http://127.0.0.1:8181/apgb/wms
```

The first view of an uncached area is expected to be slower; later views reuse
the server cache. Avoid pre-seeding the full 12.5 cm footprint because it would
create an unnecessarily large cache.

## 3. Permanent HTTPS access

For access without an SSH tunnel, ask the administrator of
`climascope.hutton.ac.uk` to proxy only the WMTS and WMS paths to retina using
[`nginx-apgb.conf.example`](nginx-apgb.conf.example). The proxy must:

- use HTTPS;
- require individual authentication or institute SSO;
- expose only `/apgb/gwc/service/wmts` and `/apgb/wms`;
- keep `/apgb/web` and `/apgb/rest` private;
- confirm that internal service delivery is permitted by the APGB licence.

After the proxy exists, update `.env` on retina:

```text
APGB_BIND_ADDRESS=<admin-approved-private-retina-address>
APGB_PUBLIC_URL=https://climascope.hutton.ac.uk/apgb
```

Then recreate GeoServer so generated capabilities use the public URL:

```bash
docker compose up -d --force-recreate geoserver
./smoke_test.sh
```

## Operations

```bash
docker compose ps
docker compose logs --tail=200 geoserver
./smoke_test.sh
docker compose restart geoserver
```

Adding newly downloaded canonical TIFFs requires rebuilding the symlink list and
reharvesting the ImageMosaic catalogue. Stop before doing this if source files
are still being written.

Do not run `docker compose down -v`: `-v` deletes the persistent catalogue and
tile cache volumes.
