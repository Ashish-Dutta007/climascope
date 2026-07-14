# ClimaScope — deployment notes

Flask app, Python 3.12, gunicorn on port 8000.

## Running

```bash
./start.sh    # starts gunicorn on port 8000
./stop.sh     # stop
./check.sh    # quick health check
```

Venv is included (`venv/`), so no install needed. Logs go to `../logs/gunicorn.log`.

For OS place-name search, set the API key on the server (never in browser JS):

```bash
export OS_NAMES_API_KEY='replace-with-the-rotated-key'
docker compose up -d --build --force-recreate
```

Local council/catchment/tile search still works when the key is unset. Drawn
analysis and export requests default to a 30,000 km² ceiling (approximately the
largest Scottish council plus drawing tolerance); override it with
`AOI_AREA_LIMIT_M2` if required.

Hillshade GeoTIFF exports have a separate, intentionally tight 100 km² ceiling,
plus server-side pixel and dimension caps. Override only the area ceiling with
`HILLSHADE_EXPORT_AREA_LIMIT_M2` if required.

## Data layout

The app expects a `data/` folder next to `app.py`:

```
app/
├── app.py
├── data/
│   ├── facts_catalog/
│   ├── precomputed/
│   ├── jess/parquet/
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
