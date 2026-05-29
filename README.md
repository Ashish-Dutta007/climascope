# ClimaScope

A map-based tool for exploring projected climate change across Scotland at 1km resolution. Built for D5-2 (Climate Change Impacts on Natural Capital) at the James Hutton Institute.

Shows UKCP18-derived metrics (precipitation, temperature, ET, climate water balance) alongside UKCEH land cover and SEPA catchment boundaries. You can drill into council areas or individual catchments, draw an AOI, filter by metric thresholds, and export cell-level CSVs.

## Stack

Flask + Gunicorn backend, vanilla JS + MapLibre GL frontend. No build step: all frontend dependencies loaded from CDN.

DuckDB handles SQL queries over the parquet files. GeoPandas for spatial joins at startup. Precomputed monthly ensemble means stored as partitioned parquet (`data/precomputed/Metric=X/Period=Y/Month=N.parquet`) so each API call reads one file.

Vector tiles generated with Tippecanoe, served from Flask, values joined client-side via MapLibre feature-state.

## Data

Not in the repo: too large and some files are under third-party licences. Everything lives under `app/data/` on the HPC.

Key files:
- `data/precomputed/`: monthly mean change per 1km cell (UKCP18-derived)
- `data/grid.parquet`: 1km cell geometries
- `data/councils.gpkg`: 32 Scottish council boundaries
- `data/catchments.gpkg`: SEPA river catchments
- `data/landcover_fractions.parquet`: UKCEH LCM class fractions per cell
- `data/jess/parquet/`: catchment-level CWB summaries by land use type
- `data/jess/parquet_cwr/`: same for CWR metrics
- `data/tiles/grid.mbtiles`: vector tile pyramid

## Running locally

```bash
cd app/
./start.sh   # starts gunicorn on port 8000
./check.sh   # health check
./stop.sh
```

CWD must be `app/`: one path is read relative to CWD at import.

## Docker

```bash
docker compose build --no-cache && docker compose up -d
```

Data directory is bind-mounted at runtime.

## Known limitations

- CWR future grid data (2020-2049, 2050-2079) is not available: the source RDS had a formula error. Only the 1990-2019 baseline period has real CWR values. These metrics are marked `map_available: false` for future periods but work correctly in the catchment panel.
- No authentication: internal use only.
- Job outputs (`data/outputs/`) accumulate and aren't cleaned up automatically.

## Data sources

- **UKCP18**: Met Office, 12-member ensemble, RCP8.5
- **UKCEH LCM**: 1km fractional land cover
- **SEPA**: river catchment polygons
- **(JHI)**: catchment-level CWR summaries by land use, farm type, LCA, peat condition
