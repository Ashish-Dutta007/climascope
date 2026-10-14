# Scene study, 14 October 2026

Separate from the live app. Open [index.html](index.html) in Brave. It contains the data and works without a server. Use Fit for the arrangement, or 50%/100% and scroll to inspect a section. Open and full-wrap sizes are available.

The study is now [hosted here](https://climascope.hutton.ac.uk/static/immersive/scene-study/index.html). To review the seven scenes currently available on the suite wall, use the independent [current wall preview](https://climascope.hutton.ac.uk/immersive/preview). The study's twelve-map views are proposals, not current wall scenes. See [hosting record](HOSTED.md).

## Recommendation

Remove the generic cross-metric companions from the precipitation and temperature scenes. Keep their period comparisons available for discussion. Give the unattended loop distinct views that reveal another part of the data.

**Start with the twelve-month view.** One metric, twelve maps, January to December, all showing 2050–2079 minus 1990–2019. The shared scale stays fixed. The scene puts spatial and seasonal change together, which the current seasonal chart and single selected month cannot do. It is the strongest candidate for using the wider wall.

In the current national ensemble means, February rainfall increases by 57.1 mm while September decreases by 45.0 mm. Mean daily maximum temperature increases most in August, by 5.3 °C. These are monthly 30-year climatologies. A July-only sequence misses those national mean peaks; local peaks can occur in other months.

**Then add the twelve-member view.** All members show the same metric, month and comparison with one shared scale. The existing member chart reports regional means; these maps also reveal where their spatial patterns differ. July rainfall means range from −31.4 to +9.0 mm across the twelve members, illustrating what the ensemble mean conceals. Use the actual member IDs in a fixed order, and allow selection of one for the detailed comparison. This adds spatial member comparison to the existing scene, rather than presenting spread as probability.

**Keep the water-balance explanation, with a smaller contribution graphic.** The three-map trial has a sound identity: change in precipitation − change in PT evapotranspiration = change in water balance. However, on their common ±160 mm scale, the PT change map is pale. July PT changes are roughly +8 to +21 mm across the middle 90% of climate cells. That is meaningful, but does not automatically justify a large dedicated map. A compact chart can show the rainfall contribution, the negative contribution from increased PT evapotranspiration, and their net water-balance change on a common mm axis. Label the ET increase separately from its effect on the balance.

The prototype retains the three-map version so this tradeoff is visible. It is an option to assess, not the recommended final water scene.

## Visual direction

- Alternate compact comparisons with wider month/member views. The suite gets visual variety without requiring every scene to fill the same template.
- Keep map geography and colour limits stable. Use space for readable maps, titles and values; keep time-series charts compact.
- In the production atlas, group months into quarters and repeat context/legends by viewing sector. The study repeats labels per map to make their meaning unambiguous; the final arrangement can be quieter.
- Use a restrained selection outline and coordinated state changes. No decorative movement is needed to make the underlying pattern interesting.
- Validate the front-facing sector, label size and projection contrast in the room. Twelve maps need head movement; the detailed comparison should remain available for close discussion.

## Controls and loop

The study controls are independent of the wall and phone relay. Click a month or member to highlight it. It does not open the app's detailed scene.

For a production version, keep the existing Month loop for detailed scenes. In the year view, all twelve months would remain visible and the selected-month marker could advance. In the member view, changing month would update all twelve members together; selecting a member could open its detailed comparison. These are proposed behaviours, not current wall features.

For the scene loop, try annual precipitation, annual temperature, water-balance components, negative balance, land cover, member maps, and a winter water-balance comparison. Retain the overview for introduction and manual comparison. Tune chapter order and holds in the suite rather than adding every view to the existing two-minute loop.

## Data and checks

The study reads 84 source partitions: twelve ensemble-mean months for CWB PT, precipitation, Tmax and ET PT; plus July for all twelve members of the first three metrics. Changes are computed from raw `proj_value - obs_value`. The map display uses 255 colour bins with the current production domains; the water components share ±160 mm. Temperature reverses the diverging palette so warming is red. Missing values are grey. National numbers come from the existing common-support v2 summaries.

`sources.json` records the source hashes, colour encoding and climate version. The available geometry file contains 78,820 cells; the climate files contain 78,855. The 35 source cells without study geometry are omitted from these maps. National numbers retain the full official support. The maps use British National Grid, and are a design study rather than exact captures of the production MapLibre renderer.

Browser checks cover twelve view/metric/wall-size combinations, selection, fit/scroll, direct file loading and uncaught errors. See `browser-checks.json`. No live app files, remote sessions or deployments were changed.

For production, prepare compact map layers or images with shared geometry and labelled legends. Avoid creating twelve extra WebGL contexts or retaining twelve full monthly JSON payloads. Regional scope, member choice, missing data, readiness and phone state must remain consistent with the current app.
