# ClimaScope — deployment notes

Flask app, Python 3.12, gunicorn on port 8000.

## Running

```bash
./start.sh    # starts gunicorn on port 8000
./stop.sh     # stop
./check.sh    # quick health check
```

Venv is included (`venv/`), so no install needed. Logs go to `../logs/gunicorn.log`.

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
│   ├── councils.gpkg
│   └── catchment_council_lookup.csv
```
