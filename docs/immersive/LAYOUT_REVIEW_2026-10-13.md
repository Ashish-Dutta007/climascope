# Wall layout review, 13 October 2026

The deployed wall is a useful comparison overview. It should remain available, but a focused scene is a better candidate for the default presenter and unattended experience. A desktop preview identifies layout problems; it does not establish physical readability or sightlines in the curved room.

## Visual comparison

Open [comparison.html](layout-review-2026-10-13/comparison.html) in Brave. This is one self-contained HTML file with embedded map images and national data, so it also works after downloading. Select the layout and room size, then use Fit, 25% or 50% to inspect. The focus metric can change in the proposed scene. All examples are fixed to **July, All Scotland, ensemble mean**. There are no live wall commands or API requests in this artifact.

The current and tighter overviews are screenshots from the real app on a temporary local staging server. The focused scene uses actual July map snapshots and the existing unrounded monthly summary artifact, data version `6868e67dc989a24d`. Geographic images retain their aspect ratio. It is a visual design prototype, not an implementation of scene transitions, remote selection or region-aware overlay placement.

## What the measurements show

The current CSS gives each metric four equal columns: three maps and one chart stack. Height remains fixed when the room gets wider. The plotted region, excluding axes and labels, measures:

| Layout | Room | Plot width | Plot height | Width / height |
|---|---|---:|---:|---:|
| Current | Open | 849 px | 389 px | 2.18 |
| Current | Full wrap | 1,170 px | 389 px | 3.01 |
| Tighter, seasonal | Both | 714 px | 382 px | 1.87 |
| Tighter, monthly change | Both | 714 px | 350 px | 2.04 |

See [geometry.json](layout-review-2026-10-13/geometry.json) for all three groups. The current open layout is not an extreme chart shape; the full-wrap layout is appreciably flatter. The SVG is drawn at its measured dimensions, so this is a plot proportion issue rather than a stretched screenshot or distorted font.

There is no universal correct chart aspect ratio. Shape affects which trends are perceptually prominent, as demonstrated in [Heer and Agrawala's primary research](https://idl.uw.edu/papers/banking). For these twelve-month comparisons, stable landscape proportions around 2:1 are a practical trial, not a research-established optimum. Keep the month positions aligned between paired charts and keep axes stable as the selected month advances.

## A modest improvement

The tighter overview retains the nine maps and six charts. It caps each metric group at 3,600 px and gives the chart stack an 820 px column. Context text is larger, and the repeated twelve-month tick strip is removed from the header because the charts already carry month positions. The two chart questions, aligned period values, middle-map legend and selected-month marker remain.

This solves unrestricted chart widening. It deliberately leaves more separation between groups in full wrap. It does not make Scotland larger simply by allocating more width: the available vertical height constrains a portrait-shaped national map. Narrowing charts and giving every saved pixel to maps would mostly add map surround.

This is the appropriate limited change if simultaneous comparison of every metric and period is the primary task.

## The stronger direction

The focus prototype makes one metric the main question and retains the other two as supporting context:

- Main area: three period maps, a short interpretation, a prominent explicitly labelled later-period change, and two bounded charts.
- Supporting areas: one later-period map for each other metric, the three absolute period means, and a labelled change from baseline.
- Repeated region, month and ensemble context within each area. Numbers stay associated with their maps. Keep essential information above the safe band.
- Seasonal absolute values remain lines. The second chart trials paired monthly change bars, which emphasize sign and magnitude rather than repeating the same line-chart appearance.

This reduces the default scene from nine maps and six charts to five maps and two charts. The complete overview remains one remote action away. An explicit focus control can switch the primary metric. The displayed layout must be oriented to the actual audience-facing wall sector, rather than assuming the midpoint of the browser canvas is physically in front of the group.

The example question is **how does July water balance change, and when in the year is the change largest?** The national July mean changes from 3.2 mm to −24.9 mm in 2050–2079, a −28.1 mm difference. Supporting context shows −12.2 mm precipitation and +4.8 °C mean daily maximum temperature. These are monthly climatological comparisons, not forecasts for a particular July or a validated attribution of drought impact.

The focus view still needs room evaluation. It introduces a hierarchy and more explicit interpretation, but snapshot maps cannot respond to a region and their hand-positioned legends are not a replacement for the production overlap checks. A physically readable overview may remain preferable for some group exploration tasks. [Large-display research](https://arxiv.org/abs/2212.04346) describes both small multiples and focused views; the task and physical navigation matter, so the design should support both.

## What would add useful information

Two charts should answer two questions, rather than fill two boxes. Seasonal values plus monthly change are useful now, although the second is mathematically derived from the first.

For a later summer-water scene, the stronger second measure is the **share of valid climate cells with CWB below zero**, shown by month and period. The earlier data review found 57.4% in the national July baseline and 81.4% in 2050–2079, even though the baseline regional mean is near zero. A mean alone hides that distribution. This needs a new versioned summary computed from cell values with a checked denominator; it cannot be inferred from the existing regional means.

Next, fractional land-cover/habitat overlap and ensemble-member spread can answer the natural-capital questions. Describe these as coincidence with an indicator and projection agreement. They do not establish future habitat loss, probability of impact or hydrological drought.

For unattended use, introduce a question, show the seasonal pattern, hold a summer example, contrast winter, then return to overview. Avoid simultaneously changing metric, region and month without an explanatory scene boundary. Presenter and exploration modes should pause on the same scene state.

## Suggested next increment

1. Keep the current production overview until a candidate is reviewed. Add a preview route with actual wall-size presets and automatic fitting, avoiding repeated DevTools setup.
2. Add a bounded overview variant and one focused summer-water scene, using existing data and the same frame/readiness and phone-control mechanisms.
3. Support explicit Overview / Focus actions in the remote. Manual exploration stays paused until the operator resumes.
4. Check both room modes, national and selected-region views, all map/legend clearances, seated and standing readability, and three audience positions. Confirm which browser coordinates map to the front wall.
5. Add threshold shares and landscape/ensemble scenes only after their summaries reconcile against the source data.

No production assets were changed by this review. The temporary local server was used for captures only. The prototype was checked in Chromium at both logical wall sizes and all three focus metrics; the result is recorded in [prototype-checks.json](layout-review-2026-10-13/prototype-checks.json).
