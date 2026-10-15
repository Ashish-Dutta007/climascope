# Jess's wall feedback, 15 October 2026

Immersive v4.3.0 adds the fixed land-cover context and four-class CWR view. Both confirmed canvas sizes are supported: 11,514 × 1,200 open, and 15,360 × 1,200 full wrap.

## Display changes

- **Overview:** the nine climate maps now have a land-cover map and area chart alongside them, giving ten maps overall. The climate charts retain their 820 px width.
- **Land cover:** the existing baseline/future/change comparison and climate overlap charts remain. The added map shows dominant cover per 1 km cell; the new chart shows all ten classes' estimated area in km², with matching colours.
- **Chart titles:** monthly values and change charts name their metric. The water-balance threshold and member charts also name the quantity they show.
- **Water ratio classes:** a new chart scene compares 1990–2019, 2020–2049 and 2050–2079. Each period has twelve monthly stacked bars showing the four class shares, plus a land-use breakdown for the selected month. The class colours match the desktop catchment panel. The area axis and land-use order stay fixed across months and periods for the selected region/member.

There are now eight selectable scenes and nine scene-loop chapters. The class scene follows Land cover in the loop. Month loop advances the highlighted month and updates its land-use breakdown. Manual selection, pause, wall-owned playback, phone control and the independent preview retain their existing behaviour. Member spread remains one chapter.

## Land-cover areas

`tools/precompute_immersive_landcover.py` generates `static/immersive/summaries/landcover-v1.json` for Scotland, 32 councils and 1,026 catchments. Each class's fractional cover is multiplied by the cell footprint clipped to the region in EPSG:27700. This assumes uniform cover fractions within a boundary cell. The chart says **Estimated km²** and totals mapped cover.

The map uses the existing `/api/landcover/dominant` values and desktop palette. Area calculations use fractional cover and include the available geographic grid independently of climate validity. The existing negative-water-balance overlap retains its common valid climate-cell support and whole-cell method. These quantities have separate labels and denominators.

The national estimated mapped-cover area is 76,966.7 km²; its available grid footprint covers 77,301.2 km² of the council-boundary union's 78,312.4 km². Source fractions retain their original rounding. All source hashes and the calculation method are in the artifact metadata. The source-year link remains unresolved, so the wall continues to say Current land cover.

## CWR source and interpretation

The new `/api/immersive/cwr` endpoint reads the existing `data/jess/parquet_cwr/Variable=Land%20Use/Period=.../Metric=CWRPT/` partitions. It uses the supplied **Strong Deficit, Moderate Deficit, Moderate Surplus and Strong Surplus** classes unchanged. The source includes all twelve members and all months. The supplied Power BI report was also opened: it exposes CWRPT/CWRPM and the same class names.

Selecting a member uses that member's class areas. Selecting **Mean class areas** takes the arithmetic mean of the twelve supplied area totals in each class. The wall and controller label this explicitly. National classified land-use coverage is approximately 52,781.0 km². The monthly share denominator is this source's classified land-use area.

Catchment selections use their supplied totals. Council selections use the existing council-to-catchment lookup and are labelled **Catchments linked to [council]**. Their totals describe whole linked catchments. The CWR scene uses charts; the known invalid future CWR 1 km precomputes remain excluded. PT is the first method added, consistent with the current wall's water-balance scenes; PM is available in the source for a later option.

The browser retains one class payload, containing all twelve months for the selected scope/member. Month changes need no additional class or climate-grid requests. Requests are serialised; failures preserve the last completed scene and pause playback.

## Verification and release

See [checks and captures](feedback-2026-10-15/README.md). Twenty distinct tests passed across the source/relay and browser checks, including both wall sizes, the full nine-chapter loop, phone control, preview isolation, class-area reconciliation, region/member changes and injected CWR failure. Native captures were inspected and label spacing corrected.

The deployed Docker image is `sha256:d1cc02196e658b63d729536800c6c5a6667cb76af81c63fd23cd5718ec539b31`. Container/source hashes and public checks are recorded in [deployment-checks.json](feedback-2026-10-15/deployment-checks.json). The previous v4.2.2 image is retained as `app-climascope:pre-landcover-cwr-20261015`, SHA-256 `9a37c427174aaff714afc923bda2e5a8430b496316440d0e4bea8a99347001a5`. The normal Docker rebuild/recreate flow was used on retina. Rollback: tag the retained image as `app-climascope:latest`, then run `docker compose up -d --no-build --force-recreate climascope` from the app directory on retina.

Refresh the wall and preview, then pair the phone again. The separate twelve-month/member design study is unchanged. Projection contrast, viewing sectors and label readability should be checked in the physical suite.
