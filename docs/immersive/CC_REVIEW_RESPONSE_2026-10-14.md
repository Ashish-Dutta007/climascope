# CC review response, 14 October 2026

Historical record of the first layout trial. The follow-up review and final implementation are recorded in [Compact wall comparison](WALL_LAYOUT_2026-10-14.md).

This is an uncommitted local candidate over v4.1.0. Nothing from this review pass has been deployed or mirrored.

## Applied

- **Side panels:** 1,600 wall pixels each, retained only in Water balance, Precipitation and Mean daily maximum temperature. Each shows its 2050–2079 map, with all three period means once below it. The primary group is capped at 6,200 pixels and charts remain 820 pixels wide. Negative water balance, Land cover and Member spread now show only their three primary maps and two charts.
- **Land-cover headline:** the largest mapped class in the selected region, chosen by area rather than by climate result. The headline and chart share the same calculation and member-fallback handling. Scotland in July now reads Mountain, heath & bog, 73.8%, with the baseline 45.0% and change +28.8 percentage points. The all-cell 81.4% stays in Negative water balance.
- **Land-cover wording:** “Share of each class’s area in cells below zero” and “Current land cover, same for all periods”. This is the share of mapped class area on valid climate cells; it is not projected land-cover loss.
- **Member counts:** always show increases, decreases and values rounding to 0.0 at the displayed precision, with the total member count. The range and plots retain their underlying values. Dot-plot keys now use dots.
- **Other copy:** restored “Mean daily maximum temperature”; its description includes change from baseline. Removed the baseline-to-future values duplicated in the focus headline, and named the region instead of “Regional mean”. Visitor captions use “water balance”. The extent note says “Indicator, not a drought classification”. Initial chart and footer wording now match the rendered frame.

## Capture correction

CC was right: all six original wide captures repeat exactly at a horizontal offset of 8,192 pixels. The previous visual review did not validate the right-hand panel.

The replacement [gallery](review-2026-10-14/cc-fixes/tiles/index.html) captures all seven scenes at both wall sizes using a 4,096-pixel-wide parent window. The iframe remains 11,514 × 1,200 or 15,360 × 1,200, DPR 1. Scrolling the outer window exposes each part without changing the wall layout. The right-hand temperature panel is present in the new focus-water capture. The [capture script](../../tools/capture_immersive_wall.py) records tile positions and DOM measurements. All fourteen stitched captures were checked for the original 8,192-pixel repetition and none repeat; measurements are in `cc-fixes/capture-validation.json`.

## Verification

The two scene/preview browser flows passed in 147.3 seconds against local staging, with no uncaught page errors. They cover all seven scenes at both wall sizes, phone commands, the complete eight-stop loop without the phone, member/region reload, isolated preview state, failed and superseded requests, and an empty catchment. Visible maps painted after resizing; headline and side-summary boxes did not overflow.

Added checks cover the Scotland class headline, a member-specific class result in Midlothian, Angus's 6–6 precipitation split, and Falkirk's March +0.007 mm member appearing in the “round to 0.0 mm” count. Heap after garbage collection was 198.0 MB before the loop and 185.0 MB after it. JavaScript syntax, Python compilation and whitespace checks passed. Results are in `review-2026-10-14/cc-fixes/`.

## Still open

This is the small layout trial CC proposed. Removing repeated side content does not solve the repeated primary maps in the last three analytical scenes. The wider wall still has spare space; stretching the maps or graphs would not make that space useful.

- **Change maps:** put a future-minus-baseline map alongside the period maps in the main group, with a separate fixed, zero-centred change scale. Replacing the repeated headline card is a reasonable next trial.
- **Water balance:** evaluate PT evapotranspiration as the companion metric. CC reports the identity is exact; this pass did not independently verify it or expand the PT name.
- **Land-cover map:** the adjacent `data/lcm1km_pct_agg.vrt` references `gb2024lcm1km_percentage_aggregate.tif`. The README identifies UKCEH Land Cover Map, but the fractions Parquet has no dataset/year metadata, and the VRT alone does not establish the Parquet's lineage. Confirm that chain before publishing a year or adding a mapped land-cover scene.
- **Member maps:** twelve individual member change maps do not require a new spread statistic. That is distinct from a cell-wise spread/agreement map, which does. A later scene can use pre-rendered member maps to avoid adding twelve live WebGL contexts.

Physical room checks are still needed for viewing positions, reading distance and the bottom safe band. This candidate is not claimed as the final wall layout.
