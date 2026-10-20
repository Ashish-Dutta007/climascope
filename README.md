# ClimaScope

Scottish climate projections, land cover, catchments and terrain on a 1 km grid.

James Hutton Institute · RESAS D5-2, Climate Change Impacts on Natural Capital,
Scottish Government Strategic Research Programme 2022–2027.

[Viewer](https://climascope.hutton.ac.uk/) ·
[Wall](https://climascope.hutton.ac.uk/immersive) ·
[Remote](https://climascope.hutton.ac.uk/immersive/control) ·
[Preview](https://climascope.hutton.ac.uk/immersive/preview)

Climate periods: 1990–2019, 2020–2049 and 2050–2079. Postcode search selects a
1 km cell. Dashboard has Climate and Land & catchments tabs.

## Running

Python 3.12. Put runtime data in `data/`; it is excluded from Git.

```bash
./start.sh
./check.sh
./stop.sh
```

[Setup and Docker](DEPLOY.md) · [Postcode data](docs/climate-profiles.md) ·
[Land cover and CWR](docs/immersive/JESS_FEEDBACK_2026-10-15.md)

This app serves the desktop and wall. Wall files are also kept in
[climascope-immersive](https://github.com/Ashish-Dutta007/climascope-immersive).
[Sync commands](docs/immersive/REPOSITORIES.md).

Inputs include UKCP18-derived climate data, UKCEH land cover, SEPA catchments
and Scottish Government LiDAR. Dataset licences apply separately.

[Trishuli map](https://climascope.hutton.ac.uk/trishuli) ·
[Trishuli data notes](static/trishuli/DATA_NOTES.txt)
