# Compact wall comparison, 14 October 2026

This update follows both CC reviews. It replaces the layout described in the v4.1 scene notes. See the [release record](FINAL_DEPLOYMENT_2026-10-14.md) for deployment and rollback.

The later [copy and locator update](READABILITY_2026-10-14.md) simplifies the analytical headlines and corrects the small Scotland inset.

## Layout and controls

The main comparison is 4,300 wall pixels wide in both room configurations. Groups touch, with thin borders; unused wall is nearly black (`#03040a`). Charts stay 820 pixels wide. The nine-map overview is unchanged apart from spacing, borders and wording.

- Water balance, Precipitation and Mean daily maximum temperature: three absolute period maps followed by a 2050–2079 minus 1990–2019 change map. The repeated headline card is removed. Two 1,600-pixel companion panels sit against the main group, giving six maps overall.
- Water balance's companions are precipitation and PT evapotranspiration. Their three means appear once beneath their later-period maps. PT remains abbreviated.
- Negative water balance, Land cover and Member spread: retain their distinct headline and charts, with baseline, 2050–2079 and change maps. The 2020–2049 values remain in the charts. No companion panels.
- Member counts show the non-empty higher/lower directions, name the metric and give the member total. A rounded zero row appears only when needed. The caption names the selected month and comparison periods.

The phone controller, month loop, scene loop and independent desktop preview use the existing URLs and saved selections. Manual selection pauses playback. The wall remains responsible for playback and readiness.

## Change maps and data

`/api/immersive_values?change=1` adds `2050-2079_change` for the requested metrics. The server subtracts raw `obs_value` from `proj_value` before rounding to 0.01. Missing operands stay missing. The change map uses the later period's member/fallback source and labels an ensemble-mean substitution.

Each metric has a separate change legend. Its scale is symmetric around zero, fixed across months, regions and members, using the outward-rounded 99.5th percentile of absolute ensemble-mean cell changes pooled over all months and both futures. Colour limits are CWB PT ±160 mm, precipitation ±160 mm, Tmax ±6 °C and ET PT ±30 mm. Values beyond a limit use the end colour. Absolute maps retain their existing independent scales.

The v2 regional generator now includes ETPT_sum and change domains; scene summaries were regenerated against the same four-metric source fingerprint. Regional values use the existing common-support method. The wall creates eleven maps: the nine overview maps, one ET companion and one shared change map moved between primary groups. Hidden maps are excluded from fit/readiness waits. The current month's change dictionaries are retained; fetch concurrency and next-month cache remain bounded.

CC verified CWB PT = precipitation − PT evapotranspiration in all 324 source partitions, with maximum residual 0.00006 mm. The added source-data test also checks the displayed regional identity and compares change responses against raw source subtraction, including cells where rounding operands first gives a different result.

## Land-cover provenance

CC's read-only check established that all 243,668 Parquet rows match `lcm1km_pct_agg_scotland.tif`, without missing or extra rows, and that this raster is an exact crop of `lcm1km_pct_agg.tif`. The latter has the grid/class structure of the VRT referencing `gb2024lcm1km_percentage_aggregate.tif`.

The original GB source file is absent, so the last identity link is still unconfirmed. The wall continues to say “Current land cover, same for all periods”; it does not publish 2024 as a confirmed year. The class headline is selected by mapped area, not by the climate result. This remains overlap with fixed cover, not projected habitat loss.

## Remaining room check

The browser checks use 11,514 × 1,200 and 15,360 × 1,200 at DPR 1. Physical sector placement, projection contrast, reading distance and the safe band still need checking in the suite. The analytical scenes share climate context; twelve individual member maps or a mapped land-cover view would be separate additions, not part of this release.

## Verification

All 18 current tests passed. See [test results and tiled captures](final-validation-2026-10-14/README.md). Both wall sizes were checked, including the complete scene loop, annual playback, phone takeover, reload, injected failure, preview isolation and no-data recovery. The source-data check covers raw subtraction before rounding and the regional PT identity.
