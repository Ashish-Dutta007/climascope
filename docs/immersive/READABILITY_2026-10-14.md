# Wall copy and Scotland locator, 14 October 2026

This is the follow-up to the compact v4.2 layout. The month/scene loops and data calculations are unchanged.

## What changed

- Negative water balance keeps the future cell share and the baseline percentage. The extra percentage-point difference and drought-classification note are removed. Land cover also keeps its two percentages without an extra percentage-point line.
- Member headlines name what is higher or lower and say how many of the available members show that direction. Empty directions are omitted. For national July CWB, the card reads “12 of 12 show lower water balance”, then “4.4 to 49.7 mm lower”, with the comparison periods alongside it.
- The member chart names the metric. Yellow/dashed remains 2020–2049 and orange/solid remains 2050–2079; shading is the full member range and the line is the median. Map colours continue to encode the mapped value or change, using their own legends.
- The introductory preview sentence is removed. The metric selector is shown only in Member spread, where it selects which metric to compare. Other scenes already determine the metric, or show all three. The same rule applies to the phone control.
- The small Scotland locator now projects its context, selected region and marker into British National Grid (EPSG:27700) before fitting the SVG. Previously it used the same scale for longitude and latitude degrees, making Scotland too wide. The main MapLibre maps remain flat Web Mercator views.

The inset uses a pinned, locally served Proj4js 2.22.0 bundle with its MIT licence. Its OSGB36 datum transformation is suitable for a locator whose pixels cover kilometres. It is not used to alter source cells, regional statistics or the main tile renderer. See the [Proj4js projection documentation](https://proj4js.org/) and `static/immersive/vendor/README.md`.

## Member figures

The quoted July result is correct. Every available member has a lower national July mean water balance in 2050–2079 than in 1990–2019.

| Example | Baseline July mean | Future July mean | Change |
|---|---:|---:|---:|
| Member 05 | +3.217 mm | −1.151 mm | −4.368 mm |
| Member 08 | +3.217 mm | −46.465 mm | −49.682 mm |

Thus the reductions range from 4.4 to 49.7 mm. The range compares changes across members, while the maps retain the selected member or ensemble mean.

An independent DuckDB read checked 336 source partitions: both future periods and all twelve months/members for CWB PT, plus July members for precipitation and Tmax. All have 78,855 finite climate-cell pairs. Their raw regional changes match the generated agreement summaries to within 0.001, consistent with the summaries’ three-decimal precision. No new reports were needed to establish those numerical results.

The supplied chart image highlights October. The quoted member card refers to July. The render checks confirm that the card, marker and individual-member dots follow the same selected month.

## Validation and deployment

See [validation artifacts](readability-2026-10-14/). They include the source audit, July/October chart-coordinate checks, native card/chart captures, the corrected locator, and the scene/phone/preview flow results at both wall sizes. Projection tests compare Scottish control points with Pyproj and verify that both SVG axes preserve metre scale.

Deployed as immersive v4.2.1. The running Docker image is `sha256:681b1124e270502f1255dcf0daa6b531d7275906a33581733c5adf695b30db71`.
The previous v4.2 image is retained as `app-climascope:pre-readability-20261014`,
`sha256:3506baa0b397a3bca4f97fcf28033cedcd33a0e3b337742374e5ae5bca64377f`.
The normal rebuild/recreate flow is recorded in `DEPLOY.md`. The isolated hosted
scene study remains available; its twelve-map proposals are separate from the
seven current wall scenes.

All 52 runtime/static files inside the container match the tested sources. The
public viewer, wall, controller, preview and hosted study respond correctly;
served assets match the source hashes. Four tests passed, followed by the
independent chart-coordinate and deployment checks. Refresh the wall and preview.
The container-local relay database was recreated, so pair the phone again.
