# ClimaScope on the immersive wall

Initial design review and implementation brief, 13 October 2026, written before the implementation. Subsequent work is recorded in [INCREMENT_1_2026-10-13.md](INCREMENT_1_2026-10-13.md), [PHONE_REMOTE_2026-10-13.md](PHONE_REMOTE_2026-10-13.md) and [DEPLOYMENT_2026-10-13.md](DEPLOYMENT_2026-10-13.md).

## Recommendation

Develop the wall around five questions: **where does climate change, when, by how much, what land or habitat coincides with it, and how consistent is the projection across ensemble members?**

Retain the three-metric comparison as an overview. Add a small set of focused scenes for seasonal change and landscape context, with one controller supporting an unattended loop, presenter-led scenes, and exploration. A loop should progressively explain a question. Cycling through every available place and layer would make it harder to understand.

The colleague's five requests are good improvements to the overview. They are the first increment of this design, with a few interpretation and playback fixes alongside them.

## Evidence and context

Reviewed:

- The 8.17-second room recording, `../../20260924_160600.mp4`, using frames at 0.5, 2.5, 4.5 and 6.5 seconds, and the supplied flat wall screenshot. This is a partial view of the room, not a physical display survey.
- The immersive repository through existing SSH access, main commit `4cb3f4016b59a278d449d1abf8cd94ad6370571b`, dated 8 July 2026. Its `SUITE.md` is reproduced in [SUITE_REFERENCE_2026-07-08.md](SUITE_REFERENCE_2026-07-08.md). The public web request returned 404; authenticated Git worked.
- Local main-app history, current templates, JS, backend routes, monthly summary artifact and selected July Parquets. The local app checkout is at `ad970fb`, dated 28 August 2026.
- The live main script and immersive JS/CSS: fetched bytes match the local copies. This confirms those frontend assets, not every deployed backend setting or dataset.
- The app README and September ClimaScope proposal/context notes. RESAS D5-2 concerns climate change impacts on natural capital; the proposal suggests guided local adaptation and catchment summer water-stress workflows. These are proposed applications, not evidence of confirmed funding or validated decision tools.
- [7thSense's account of the Hutton suite](https://7thsense.one/story/immersive-visualisation-suite-james-hutton-institute-aberdeen): two media servers, live application capture and display distribution, nine WUXGA projectors, a 72 m² curved projection surface and an opening rear wall. This supports designing for shared discussion and multiple operating modes.

The recorded dimensions are **11,514 × 1,200, DPR 1** for open mode and **15,360 × 1,200** for full wrap. These come from July's suite documentation; verify they still describe the actual browser input configuration before installation. Projector pixel totals do not establish the browser canvas or panel boundaries.

The current wall is three metric groups, each containing baseline, near-future and later-future maps, a seasonal chart and three summary values. It already supports council/catchment selection, region masks and a locator. The current web viewer also has land cover, habitat, soil wetness analysis, LiDAR coverage, terrain, hillshade, combined filters and AOI/export workflows. The immersive assets largely remain at July's design.

Machars/Potree is a separate RRF Lot 3 application using the same venue. The suite notes explicitly exclude bringing it into ClimaScope. ClimaScope's existing terrain and LiDAR layers can provide relevant landscape context without reopening that integration.

## The overview layout

Keep three readable metric groups: **climate water balance**, **precipitation**, **mean daily maximum temperature**. Retain familiar short codes in secondary text and record the water-balance method in scene metadata.

For each group:

1. Centre the metric title over its three-map span, excluding the chart column.
2. Use one grid definition for the three maps and their numbers. Put each absolute regional mean directly below its map, with its unit. Add a smaller explicitly labelled change under future values where space permits.
3. Put one shared colour legend in the middle map's empty surround, outside Scotland/selected-region geometry. Mark it as applying to all three maps. Use an opaque enough backing for projection and a fallback position if the region overlaps it. There is one legend per metric group, not one for the entire wall.
4. Stack two landscape-shaped charts in the fourth column, with matching month positions and an obvious selected-month marker. Keep the three map columns equally sized. Test graph margins and labels at both real wall resolutions before changing column proportions.
5. Repeat month, selected region and ensemble context within each group in a compact form. A person looking at one curved-wall sector should not need to find a global heading behind them.

Avoid placing essential text in the lowest band: furniture and people obscure it in the recording. Alignment alone does not solve that. Keep a configurable safe area and test standing, seated and rear-of-room views. Use thicker lines and stronger label contrast on projection; the flat screenshot cannot determine appropriate physical font size.

The diagram in [LAYOUT.svg](LAYOUT.svg) shows the structural arrangement, not final styling, map geography or calibrated text size.

## What the two graphs should show

The first graph should answer **what is the seasonal climate like here?** Show January–December absolute regional means for all three periods, including 2020–2049, which the current chart omits. Use period colours consistently across metrics, reinforced with line styles/direct labels. Include zero for CWB interpretation. Label the chart as monthly climatology.

The second graph should initially answer **when is the largest change from baseline?** Show monthly differences for both future periods relative to the same 1990–2019 baseline, with a visible zero line. This helps distinguish an already wet/hot month from a month with a large projected change. Use °C for temperature, mm for CWB, and mm for precipitation by default; percentage precipitation change can be an explicitly labelled alternative with a near-zero-baseline guard. Do not calculate percentage change in CWB across a zero baseline.

These two graphs can be derived from existing regional monthly summaries, so a useful first version does not require a new analytical pipeline. However, those summaries are rounded to one decimal place: regenerate them with unrounded values before deriving displayed deltas. Subtracting the existing rounded temperature means gives a different tenth of a degree in the July example below.

For a focused summer-water scene, replace the second graph with **the fraction of valid climate cells below CWB = 0**, across months and periods. A further version can split overlap by land cover or habitat using their fractional areas. This gives new spatial information that the mean does not contain. It needs a new, checked summary; it cannot be reconstructed from regional means.

For a robustness scene, use distributions of regional summaries across the available ensemble members. Calculate the regional statistic for each member first, then its member spread. Do not average cellwise percentiles into a regional uncertainty interval. Label the displayed range and member count; ensemble spread is not a probability of impact or a complete account of uncertainty.

## A useful example from the current data

July, national ensemble mean, calculated from unrounded Parquet values. Each of these partitions contains **78,855 valid climate cells**, versus the documented geometric grid of 81,659 cells. The display needs valid-data coverage, not a blanket claim that every grid cell contributes.

| Summary | 1990–2019 | 2020–2049 | 2050–2079 |
|---|---:|---:|---:|
| Mean CWB PT, mm | +3.2 | −3.7 | −24.9 |
| Valid climate cells with CWB PT < 0 | 57.4% | 68.9% | 81.4% |
| Mean precipitation, mm | 94.5 | 94.8 | 82.3 |
| Mean daily maximum temperature, °C | 16.4 | 19.1 | 21.1 |

Later-period changes from baseline are approximately **−28.1 mm CWB**, **−12.2 mm precipitation (−12.9%)**, and **+4.8 °C mean daily maximum temperature**.

The CWB cell-share denominator is the valid climate cells, not Scotland's surveyed land area. These are monthly, period-averaged climate indicators, not weather forecasts. CWB below zero is an indicator threshold; it does not establish observed drought, river-flow deficit, crop damage or ecological loss. Mean daily maximum temperature is not a hottest-day extreme.

This is a promising explanatory scene because the national baseline CWB mean is near zero while more than half the valid cells are negative. The map and cell-share chart expose variation that the national number hides.

## Three operating modes, one coherent state

**Loop:** a curated sequence with an introduction, visible progress and clear scene boundaries. Start with a 2–4 minute candidate loop and tune it through observation. Suggested chapters: what is being compared; the annual national cycle; summer precipitation/temperature/water balance; a contrasting winter pattern; one explained regional example with landscape context; ensemble robustness when supported; return to overview. Use fixed editorial examples initially rather than automatically ranking hundreds of places. Every chapter should be understandable to someone who enters halfway through.

**Present:** scene buttons, next/back, month steps, pause, region selection and a private controller preview. A presenter can stop on a question and resume from that state. Do not let an idle timeout restart playback during a discussion.

**Explore:** take the current month/region/metric directly from a paused scene; change the area or comparison; show the question and selection context; provide an explicit return to the loop. A desktop link/QR can carry the exact selected state and sources for follow-up, once reproducible URLs exist.

The longer-term scene vocabulary should include national overview, one-metric focus, absolute-versus-change comparison, selected-place landscape context and ensemble robustness. A focused scene should concentrate the essential comparison in a comfortable viewing sector. Do not spread necessary paired values onto opposite sides of the room merely to occupy the full canvas.

## Autoplay requirements

- Start with roughly six seconds of dwell per fully rendered month as a test setting, adjustable by the operator. Hold explanatory scenes longer. Advance Jan → Dec → Jan with an obvious annual reset; never imply continuous observed-year progression.
- Fix each metric's absolute colour domain for the full scene/annual loop, across the three periods. The current range is recalculated per month, which confounds colour changes with value changes. Separate change-map domains, centre appropriate anomaly scales on zero and preserve domains during regional zoom. Consider fixed scene domains rather than forcing tiny local differences to disappear in a universal all-metric/member domain.
- Keep seasonal graph axes stable while the month marker moves. Use separate labelled axes for absolute and delta charts. Avoid changing metric, region and month simultaneously during an explanatory passage.
- Stage a complete frame and commit month label, map values, numbers and chart markers together. Dwell begins after map/data readiness, including vector-tile rendering. Pause and explain failures; do not leave old maps under a new month label.
- Use one playback authority, state revisions and readiness acknowledgements. Manual input pauses playback. Reconnect/reload restores the same scene and state. Hidden-controller timer throttling must not govern unattended playback.
- Bound prefetching and measure memory. The documented batch response is about 7.8 MB compressed and includes an unused ET metric. Aborting a browser request does not guarantee that server computation stops. Do not preload twelve parsed copies of every national payload by default. Begin with a bounded next-frame cache and smaller requested metric sets; consider static/compact playback packages if measured performance requires them.

## Meaning and consistency to resolve in the first increment

1. **Ensemble context:** maps change for a selected member, but the strip and charts are ensemble-mean-only. Initially make the overview mean-only or clearly label the fixed summaries. The preferred later behaviour is member-consistent maps, charts and numbers. The backend can also silently substitute the mean when a member file is missing: return availability/substitution metadata and never label substituted values as that member.
2. **Absolute versus change:** the existing wall deliberately uses `obs_value`/`proj_value`; the main viewer often uses `Change`. Keep these semantics explicit in requests, captions and legends. Remove the leading plus from positive absolute rainfall/temperature values; reserve signed formatting for changes, with negative absolute balances still shown correctly.
3. **Shared support:** compare periods on a documented common set of valid cells or expose differing support. Record cell counts and aggregation methods; the existing region summary is an unweighted mean of included climate cells, not a precisely clipped area-weighted catchment statistic.
4. **Landscape analysis:** the current `/api/coverage` implementation reads `Change` for its comparisons and thresholds. It must not be reused unmodified to report absolute CWB < 0 exposure. Define the quantity first, then build and reconcile the new aggregation against `obs_value`/`proj_value` and fractional land-cover/habitat data.
5. **Scope/provenance:** persist metric definition, unit, scenario, baseline, future periods, ensemble selection, data version, aggregation and coverage. Confirm scenario and exact climate definitions with the data producers; do not infer an RCP from general UKCP18 knowledge. Include enough context visibly, with details on the controller and follow-up output.
6. **Missing/unreliable data:** preserve gaps in chart lines, show no-data distinctly on maps, and stop or skip unavailable scenes visibly. Future CWR grid products remain unavailable because of the documented source error; the separate catchment dataset is a different product.

Land cover/habitat context describes which existing landscapes coincide with a climate indicator. Unless future land-use scenarios are supplied, hold that context fixed across projected periods and say so. LiDAR detail does not increase the resolution of a 1 km climate indicator or establish a mechanism of impact.

## Implementation sequence for an executing coding agent

**1. Overview and annual playback.** Work in the main app repo as the backend/frontend integration source. Refactor the group grid, align numbers, centre titles, relocate the shared legend and stack seasonal/delta charts. Create unrounded, versioned regional summaries. Resolve mean/member labelling and frame consistency, add stable scene domains, bounded next-frame loading and playback controls. Preserve the tile-floor constraint while checking Scotland and island coverage at both wall sizes. Update the immersive mirror from the tested integration rather than changing both independently.

**2. Guided scenes and control.** Introduce a versioned scene/state model covering mode, scene, metric set, month, region type/id, ensemble, quantity, colour domains and playback revision. Add presenter preview and explicit takeover/return. BroadcastChannel only connects contexts in the same browser storage partition; it cannot connect a separate iPad or laptop. If cross-device operation is required, use server-mediated state shared across Gunicorn workers, with room-scoped controller authorization and reconnect support. Polling is a reasonable first transport; SSE is an option if proxy buffering, heartbeats, connection lifetime and worker-thread use are addressed. A Python process-global dictionary is insufficient under the current multi-worker deployment.

**3. Natural-capital context and robustness.** Add checked monthly CWB-threshold summaries, fractional land-cover/habitat overlap and member distributions. Choose one national/regional summer-water story with climate colleagues and intended users. Use terrain/soil-wetness information selectively when it answers the scene's question. Avoid treating a threshold crossing as a validated impact classification.

**4. Room evaluation and release.** Run at both documented canvas sizes, then test the actual capture/display path, both room configurations and several audience positions. Verify readability, island visibility, legend clearance and safe text zones. Test delayed/missing data, rapid manual changes, takeover, reconnect and playback over several complete loops; record resource use. Check all new summaries against source Parquets and the correct quantity, common cell support and denominator. Rebuild the deployment image if assets are baked in, as recorded in `SUITE.md`; verify the actual current deployment first. No deployment is part of this review.

Success is comprehension: can a visitor identify the compared periods, say whether a number is absolute or a change, describe the seasonal pattern, locate the selected place, and explain what the indicator does and does not demonstrate? Test this with a small group of colleagues/users before extending the scene catalogue.

## Remaining context

There is enough context to design and build the first increment. The remaining installation details are the mapping between browser pixels and physical wall sectors/corners, safe areas and actual viewing distances, the current input/capture configuration, and where the controller will run. The remaining scientific details are the authoritative scenario, definitions and approved interpretation of the selected indicators. These should shape installation and final wording; they do not prevent the layout/playback prototype.
