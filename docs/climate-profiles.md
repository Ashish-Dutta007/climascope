# Local climate

Dashboard has two tabs: **Climate** and **Land & catchments**. Search a full
Scottish postcode in either the map search or Climate tab. The postcode selects
its containing 1 km climate cell. Clicking the map in the Climate tab is another
way to choose a location.

Drag the divider above the Dashboard tabs to change the map/chart split. The
split is saved for the next visit. Double-click the divider to reset it; arrow
keys also move it when focused.

The Climate tab shows mean daily maximum temperature, precipitation and PT
water balance for 1990–2019, 2020–2049 and 2050–2079. Charts show all twelve
months; precipitation uses grouped bars for monthly totals, while temperature
and water balance use lines. Captions follow the selected month, comparison
period and member.
Member counts and ranges always compare the twelve members with the observed
baseline. They are calculated separately for each metric and month. Direction
counts use changes rounded to 0.1 in the metric's units, matching the display;
any members rounding to zero are listed only when present.

**This location**, **Catchment** and **Council** switch the climate summary's
scope. A catchment button appears only where the postcode point is inside a
mapped catchment. The Land & catchments tab keeps the existing area charts;
its heading states which area is used when a postcode cell is selected.

## Wall and preview

The paired phone controller has a postcode search. **Show on wall** opens the
**Climate near you** scene. For a postcode, it shows:

- a neighbourhood map with the postcode point and its 1 km climate square;
- temperature, precipitation and water balance, using the desktop charts and
  monthly captions;
- changes at that cell alongside the catchment and council means, where
  available. The comparison uses 2050–2079 minus 1990–2019 for the selected
  month and member.

The Scotland inset shows where the place is. A missing background map leaves
the climate figures available with a message. Area selections keep the compact
locator and three-card layout.

**Save this place** adds the displayed location to a list of up to eight places.
**Place loop** cycles through that list in order, keeping the selected month
and member. **Month loop** stays at one location and cycles through the year.
The seconds setting applies to each completed step; loading time is additional.
Manual selections pause playback. The wall owns both loops, keeps playing after
the phone closes, and restores its saved list and position on reload.

Other wall scenes use area summaries, so select Catchment or Council before
switching to them. Scene loop is available for area selections. The browser
preview has its own postcode search and saved-place list and never changes a
paired wall. Its list lasts for that preview session. Copy this view includes
the selected location, rather than the saved-place list.

## Data and lookup

- `GET /api/location?postcode=PH27HP` resolves a full postcode to a valid cell,
  its geometry and point-based council/catchment membership. `lon` and `lat`
  can be supplied instead for map clicks. Invalid, unsupported and uncovered
  locations return an error rather than Scotland totals. Coastal postcodes can
  fall just outside the land grid or council outline; the nearest cell or
  council within 1 km is then used, and the page shows the cell's distance.
- `GET /api/climate/profile?scope=cell:135422&member=mean` returns all months
  and periods for four metrics, including PT evapotranspiration, plus changes
  for all twelve members. Area scopes use `national`, `council:<name>` or
  `catchment:<name>`.
- Cell values use `obs_value` for the baseline and `proj_value` for projections.
  Changes are calculated before rounding. The baseline is shared across members;
  generation checks this against every source partition. Missing member tables
  or mixed data versions fail without substituting the mean.
- Cell and area profiles return the same source version. The wall checks it
  before displaying a comparison. A failed data request keeps the previous
  frame and pauses playback.
- Regional summaries use the existing wall tables: equally weighted valid
  climate cells intersecting the area, with common support across periods for
  each metric/month. Their cell counts appear below the charts.
- Postcodes.io supplies postcode locations through the server. A full postcode
  represents a location within that postcode, rather than its whole area.
  Geocoding needs an internet connection; resolved results are cached in memory.
  The separate OS place-name search still uses `OS_NAMES_API_KEY`.

Generate the cell lookup tables before deploying this feature:

```bash
venv/bin/python tools/precompute_place_profiles.py
```

This creates `data/place_profiles/*.parquet` outside Git. Queries read small,
sorted row groups. Regenerate these tables and the regional wall summaries
together whenever the source climate files change. Rebuilding Docker alone
does not regenerate climate data.

These are thirty-year monthly averages and projections. Recent-year weather,
daily extremes, significance tests and adaptation recommendations need further
data or agreed methods.
