# ClimaScope

ClimaScope is a map-based environmental decision-support prototype for
exploring projected climate change, land cover, catchments, habitats and
LiDAR-derived terrain information across Scotland on a common 1 km grid.

The application was developed at the James Hutton Institute for the Scottish
Government RESAS Strategic Research Programme 2022-2027, project D5-2:
*Climate Change Impacts on Natural Capital*.

ClimaScope combines UKCP18-derived climate indicators with UKCEH land cover,
SEPA river catchments, local-authority boundaries, habitat context and
LiDAR-derived products. Users can explore national, council, catchment and
user-defined areas; compare climate periods; apply environmental and terrain
filters; inspect data availability; and export data for further analysis.

> **Status:** research and internal decision-support prototype. The source code
> is public for transparency and technical review, but no public hosted service
> is currently provided. Runtime datasets are not included in this repository.

## Main capabilities

- Explore Scotland-wide climate indicators at 1 km resolution for baseline and
  projected periods.
- View precipitation, temperature, evapotranspiration and climate-water-balance
  metrics by month and period.
- Work at national, local-authority, river-catchment or drawn-area scope.
- Overlay land-cover fractions, habitat context, LiDAR coverage and terrain
  variables.
- Filter grid cells using combinations of climate, land-cover and terrain
  criteria.
- Inspect cell-level context and generate summaries for selected areas.
- Export cell-level CSV data and supported geospatial products for downstream
  analysis.

## LiDAR and terrain functionality

ClimaScope integrates LiDAR availability and derived terrain information with
the climate and land-cover evidence base:

- LiDAR coverage displayed by acquisition phase on the 1 km grid.
- Cell-level availability of digital terrain model (DTM), digital surface model
  (DSM) and point-cloud products.
- LiDAR-derived mean elevation, slope, ruggedness and canopy-height metrics.
- Terrain variables available as interactive layers and filter criteria.
- Regional 10 m LiDAR-derived hillshade where coverage is available.
- Size-limited export of AOI-clipped, georeferenced hillshade GeoTIFFs.
- LiDAR phase and terrain attributes added to relevant tabular AOI exports.

The application exposes dedicated APIs for coverage, cell metadata, terrain
variables, hillshade tiles and controlled hillshade export. Raw LiDAR and some
derived datasets are not redistributed because of volume and third-party
licensing constraints.

## Data and analytical scope

The application currently covers:

- 32 Scottish local authorities;
- 81,659 one-kilometre grid cells;
- SEPA river catchments;
- UKCP18-derived baseline and projected climate indicators; and
- land-cover, habitat, LiDAR-coverage and terrain context where available.

Climate metrics include:

| Code | Description |
| --- | --- |
| `CWBPM` | Climate Water Balance (Penman-Monteith), mm |
| `CWBPT` | Climate Water Balance (Penman-Thornthwaite), mm |
| `CWRPM` | Climate Water Ratio (Penman-Monteith) |
| `CWRPT` | Climate Water Ratio (Penman-Thornthwaite) |
| `ETPM_sum` | Evapotranspiration (Penman-Monteith), mm |
| `ETPT_sum` | Evapotranspiration (Penman-Thornthwaite), mm |
| `Prec_sum` | Annual precipitation sum, mm |
| `Tmax_mean` | Mean maximum temperature |
| `Tmin_mean` | Mean minimum temperature |

Metric definitions should be confirmed against the authoritative project data
dictionary before formal reuse or citation.

## Data sources

- **UKCP18:** Met Office 12-member ensemble and derived climate indicators,
  using the scenario and periods configured in the project datasets.
- **UKCEH Land Cover Map:** fractional land-cover information at 1 km.
- **SEPA:** river-catchment boundaries.
- **Scottish local-authority boundaries:** council selection and summaries.
- **NatureScot / Scottish Government National LiDAR Programme:** LiDAR coverage
  and derived terrain products where available.
- **Bluesky LiDAR:** licensed coverage and derived products where available.
- **James Hutton Institute:** project-derived catchment summaries and analytical
  datasets.

Users are responsible for checking the licence, attribution and permitted use
of each underlying dataset. Inclusion in the application does not transfer
third-party data rights.

## Technical architecture

- **Backend:** Flask served by Gunicorn.
- **Spatial and tabular processing:** GeoPandas, Rasterio, Pandas and DuckDB.
- **Frontend:** vanilla JavaScript with MapLibre GL.
- **Storage:** partitioned Parquet for precomputed climate values, GeoPackage for
  boundaries and SQLite/MBTiles for vector and raster tiles.
- **Deployment:** Docker or a managed Gunicorn process; large runtime datasets
  are mounted separately from the application image.

Precomputed monthly ensemble means are stored in partitions such as
`data/precomputed/Metric=X/Period=Y/Month=N.parquet`, allowing each request to
read only the relevant subset. Vector tiles are generated with Tippecanoe and
served by Flask, with values joined client-side using MapLibre feature state.

## Runtime data

Runtime data are intentionally excluded from Git because the collection is
large and includes third-party licensed material. A configured deployment may
contain files such as:

- `data/precomputed/` - partitioned climate values;
- `data/grid.parquet` - 1 km cell identifiers and geometries;
- `data/councils.gpkg` - Scottish local-authority boundaries;
- `data/catchments.gpkg` - SEPA river catchments;
- `data/landcover_fractions.parquet` - UKCEH land-cover fractions;
- `data/lidar_coverage.parquet` - LiDAR product availability by grid cell;
- `data/lidar_collections.parquet` - acquisition collection/phase metadata;
- `data/terrain_metrics.parquet` - LiDAR-derived terrain summaries;
- `data/tiles/grid.mbtiles` - vector tile pyramid;
- `data/tiles/terrain_hillshade.mbtiles` - display hillshade tiles; and
- `data/terrain_hillshade_cog.tif` - export-enabled hillshade COG.

Exact paths can be overridden with deployment environment variables where the
application provides them.

## Running locally

Create an environment containing the packages in `requirements.txt`, provide
the required runtime datasets, and run from the repository root:

```bash
./start.sh
./check.sh
./stop.sh
```

The application listens on port 8000 by default. Some deployment paths are
resolved relative to the current working directory, so the repository root must
be the working directory.

For local development with Flask:

```bash
python app.py
```

## Docker deployment

Runtime data are bind-mounted rather than copied into the image:

```bash
docker compose build --no-cache
docker compose up -d
```

See [`DEPLOY.md`](DEPLOY.md) for deployment-specific guidance.

## Quality, safeguards and reproducibility

The implementation includes controls intended to keep analytical outputs
traceable and operationally safe:

- explicit validation of metric, period, month and spatial-scope parameters;
- council- and catchment-scoped queries to limit unnecessary national reads;
- precomputed, partitioned inputs for repeatable metric retrieval;
- stable 1 km cell identifiers across map, API and export outputs;
- source/phase metadata for LiDAR availability;
- bounded hillshade exports with AOI-area, pixel-count and dimension limits;
- checks for missing data and unavailable layers before enabling controls;
- documented separation between redistributable code and licensed runtime data;
  and
- health-check and controlled start/stop scripts for managed deployment.

These measures support reproducibility and proportionate quality assurance, but
the prototype and its outputs still require project-level scientific review,
source-data checks and fitness-for-purpose assessment before use in formal
environmental decisions.

## Known limitations

- Future-grid CWR data for 2020-2049 and 2050-2079 are unavailable because a
  formula error was identified in the source RDS. Those future-period map
  combinations are disabled rather than presenting unreliable values; the
  supported catchment workflow remains available where valid data exist.
- The application has no authentication layer and is intended for controlled
  internal deployment.
- Raw and derived datasets are not included, so the repository cannot run as a
  complete application without an authorised runtime-data bundle.
- LiDAR and hillshade coverage is regional and varies by acquisition phase and
  available source products.
- Generated job outputs require operational housekeeping in long-running
  deployments.

## Responsible use

ClimaScope is an exploratory research tool, not a substitute for authoritative
site assessment, statutory guidance or professional judgement. Users should
verify source data, units, spatial coverage, scenario assumptions and known
limitations before interpreting or communicating results.

## Acknowledgement

Developed at the James Hutton Institute under the Scottish Government RESAS
Strategic Research Programme 2022-2027, project D5-2: *Climate Change Impacts
on Natural Capital*.
