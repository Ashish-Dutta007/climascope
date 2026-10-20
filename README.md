# ClimaScope

A web viewer for climate projections, land cover, catchments, habitats and
LiDAR-derived terrain across Scotland on a 1 km grid.

Developed at the James Hutton Institute for RESAS project D5-2,
*Climate Change Impacts on Natural Capital*, within the Scottish Government
Strategic Research Programme 2022–2027.

[Open ClimaScope](https://climascope.hutton.ac.uk/)

## What it shows

- Monthly climate indicators for 1990–2019, 2020–2049 and 2050–2079.
- Scotland, council, catchment and drawn-area selections.
- Land-cover fractions, habitat context, LiDAR coverage and terrain layers.
- Filters combining climate, land cover and terrain criteria.
- Cell details, area summaries, CSV exports and selected geospatial downloads.
- Postcode climate profiles in Dashboard, with Climate and Land & catchments tabs.

The geographic grid contains 81,659 cells and covers 32 Scottish councils.
Climate-data coverage depends on the supplied files. LiDAR products and
hillshade cover the areas available from each acquisition phase.

## Climate metrics

| Code | Quantity |
|---|---|
| `CWBPM`, `CWBPT` | Climate water balance, mm |
| `CWRPM`, `CWRPT` | Climate water ratio |
| `ETPM_sum`, `ETPT_sum` | Monthly evapotranspiration, mm |
| `Prec_sum` | Monthly precipitation total, mm |
| `Tmax_mean` | Mean daily maximum temperature, °C |
| `Tmin_mean` | Mean daily minimum temperature, °C |

PM and PT are the method codes in the supplied datasets. Check the project data
definitions for the method, scenario and aggregation used in an analysis.
Future 1 km CWR grids are disabled because of a formula error in the source RDS.
The separate classified catchment CWR summaries remain available.

## Data

Inputs include UKCP18-derived climate indicators, UKCEH land-cover fractions,
SEPA catchments, council boundaries, habitat data and Scottish Government LiDAR
products. Project-derived summaries combine these for selected areas.

Runtime data are excluded from Git. A deployment needs the relevant files under
`data/`, including:

- `precomputed/`: monthly climate Parquets;
- `grid.parquet`, `councils.gpkg` and `catchments.gpkg`;
- `landcover_fractions.parquet` and the habitat/soil-wetness inputs;
- `jess/`: catchment summaries;
- LiDAR coverage, collection and terrain Parquets;
- `tiles/grid.mbtiles` and the hillshade MBTiles/COG where configured.

Dataset licences and attribution requirements apply separately. See
[deployment notes](DEPLOY.md) for paths and configuration.

## Immersive suite

- [Wall](https://climascope.hutton.ac.uk/immersive)
- [Phone controller](https://climascope.hutton.ac.uk/immersive/control)
- [Browser preview](https://climascope.hutton.ac.uk/immersive/preview)

Select **Phone remote** on the wall and enter its temporary code on the
controller. Nine scenes compare climate periods, negative water balance,
land cover, CWR classes, member spread and **Climate near you**. Search a postcode
on the controller to show its 1 km square, monthly climate and changes alongside
the surrounding council or catchment. Save up to eight places for **Place loop**.
**Month loop** cycles through the year at one place; **Scene loop** runs nine
stops for area selections. The wall runs playback after the controller closes.
Manual changes pause it.

The [immersive repo](https://github.com/Ashish-Dutta007/climascope-immersive)
contains setup, methods and release records. The
[land-cover and CWR notes](docs/immersive/JESS_FEEDBACK_2026-10-15.md) describe the
latest additions.

See [local climate](docs/climate-profiles.md) for postcode lookup, area summaries
and the required data-generation step.

## Running

Python 3.12; Flask/Gunicorn, DuckDB, GeoPandas, Pandas and Rasterio. The frontend
uses JavaScript and MapLibre GL. Climate values are read from partitioned
Parquets and joined to vector tiles in the browser.

For a fresh checkout, create the environment and provide the runtime data:

```bash
python3.12 -m venv venv
venv/bin/pip install -r requirements.txt
./start.sh
./check.sh
./stop.sh
```

The deployment checkout already has a venv. Gunicorn runs on port 8000, with
logs in `../logs/gunicorn.log`.

For Docker:

```bash
docker compose build climascope
docker compose up -d --no-build --force-recreate climascope
```

Data are mounted from `./data`; the host port is 8123. Code and static files are
built into the image, so changes need a rebuild. See [DEPLOY.md](DEPLOY.md).

## Trishuli

The app also hosts a separate
[Trishuli event map](https://climascope.hutton.ac.uk/trishuli) and
[evidence brief](https://climascope.hutton.ac.uk/trishuli/report).
Sources, measurements and interpretation limits are recorded in the
[data notes](static/trishuli/DATA_NOTES.txt) and
[build instructions](analysis/trishuli/README.md).
