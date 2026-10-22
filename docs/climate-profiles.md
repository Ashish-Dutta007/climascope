# Local climate

Search a Scottish postcode in the map or Dashboard, or click the map. The
Climate tab shows temperature, precipitation and PT water balance. Drag the
Dashboard divider to resize it; double-click resets it. The split is saved.

## Wall and preview

The remote's postcode search opens **Climate near you**: a map of the selected
cell, three climate charts and nearby council/catchment changes.

- Month loop: cycle through the year at one place.
- Place loop: cycle through up to eight saved places, keeping month and member.
- Scene loop: cycle through views for an area selection.

The wall runs playback and saves its place list in the browser. Manual changes
pause playback. Failed loads keep the previous frame and pause. Preview has its
own controls and temporary place list. Copy this view includes the location.

## Data

- Thirty-year monthly averages: 1990–2019, 2020–2049 and 2050–2079.
- Cell values use `obs_value` for baseline and `proj_value` for projections.
  Changes are calculated before rounding.
- Area means use equally weighted valid cells intersecting the area, with
  common support across periods for each metric/month.
- Member counts compare all twelve members with baseline, rounded to 0.1 units.
- Postcodes.io supplies the point. Original boundaries give council/catchment
  membership. Coastal points can use the nearest cell or council within 1 km;
  the displayed cell distance is labelled.
- Cell and area source versions must match. Missing member tables stop the load.

APIs: `/api/location?postcode=<postcode>` (or `lon` and `lat`) and
`/api/climate/profile?scope=cell:<id>&member=mean`. Area scopes are `national`,
`council:<name>` and `catchment:<name>`.

Regenerate cell tables when the source data change:

```bash
venv/bin/python tools/precompute_place_profiles.py
```

Keep `data/place_profiles/*.parquet` outside Git and rebuild it with the regional
wall summaries. Docker rebuilds do not regenerate these tables.
