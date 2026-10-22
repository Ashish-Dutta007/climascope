# ClimaScope deployment

Flask app, Python 3.12, gunicorn on port 8000.

## Running

```bash
./start.sh    # starts gunicorn on port 8000
./stop.sh     # stop
./check.sh    # quick health check
```

The deployment checkout has a `venv/`. For a fresh clone, create it and install
`requirements.txt` as described in [README.md](README.md#running). Logs go to
`../logs/gunicorn.log`.

For OS place-name search, set the API key on the server (never in browser JS):

```bash
export OS_NAMES_API_KEY='replace-with-the-rotated-key'
docker compose up -d --build --force-recreate
```

Local council/catchment/tile search still works when the key is unset. Drawn
analysis and export requests default to a 30,000 km² ceiling (approximately the
largest Scottish council plus drawing tolerance); override it with
`AOI_AREA_LIMIT_M2` if required.

Postcode search uses Postcodes.io through the server and needs no OS API key.
Generate the local climate tables before deploying the Dashboard/remote postcode
feature:

```bash
venv/bin/python tools/precompute_place_profiles.py
```

Keep `data/place_profiles/` in `data/`. Regenerate it and the regional
summaries whenever source climate data change, then sync the data (below); see
[local climate](docs/climate-profiles.md).

Hillshade GeoTIFF exports have a separate, intentionally tight 100 km² ceiling,
plus server-side pixel and dimension caps. Override only the area ceiling with
`HILLSHADE_EXPORT_AREA_LIMIT_M2` if required.

## Data on retina's local disk

The container reads `data/` from the Docker volume `climascope-data-local` on
retina's local disk, not from the shared drive, which slows every Parquet read.
`data/` on the shared drive stays the master copy. After changing anything in
it, on retina:

```bash
venv/bin/python tools/optimize_jess_tables.py   # only if Jess's tables changed
tools/sync_local_data.sh                         # copy data/ into the volume
docker compose restart
```

`optimize_jess_tables.py` writes sorted copies of Jess's tables to
`data/jess_opt/`, checking each against its source. It is slow on the shared
drive but resumes where it stopped and skips unchanged tables. The app uses the
copies only while they match the source files; otherwise it logs a warning and
reads `data/jess/`, which is correct but slower. The sync leaves
`data/outputs/` (export jobs) alone.

## Releases and rollback

Build each release from a commit, tag the image with it and keep the previous
image:

```bash
docker tag app-climascope:latest app-climascope:previous
git archive HEAD | docker build -t app-climascope:$(git rev-parse --short HEAD) -t app-climascope:latest -
docker compose up -d --no-build --force-recreate
```

To roll back, run `docker tag app-climascope:previous app-climascope:latest`
and recreate the container the same way.

## Data layout

The app expects a `data/` folder next to `app.py`:

```
app/
├── app.py
├── data/
│   ├── facts_catalog/
│   ├── precomputed/
│   ├── jess/parquet/
│   ├── jess_opt/            # sorted copies of jess/, see below
│   ├── soilwet_parquet/
│   ├── grid.parquet
│   ├── landcover_fractions.parquet
│   ├── soilwet_fractions.parquet
│   ├── terrain_hillshade_cog.tif
│   ├── tiles/terrain_hillshade.mbtiles
│   ├── councils.gpkg
│   └── catchment_council_lookup.csv
```

The MBTiles file drives map display; the COG drives clipped GeoTIFF downloads.
Regenerate the COG from the MBTiles source on the HPC host with:

```bash
./build_hillshade_cog.sh
```

If a deployment made before Rasterio was added reports `hillshade export is not
configured`, force one clean dependency rebuild, then recreate the container:

```bash
docker compose build --no-cache
docker compose up -d --force-recreate
```
