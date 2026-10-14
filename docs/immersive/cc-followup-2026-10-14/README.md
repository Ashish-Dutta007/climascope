# CC follow-up checks

The supplied [read-only review](CC_REVIEW.md) checked the source numbers and identified six live UI issues. This folder records the follow-up to those issues and two prototype colour fixes. See [release notes](../CC_FOLLOWUP_2026-10-14.md).

- **Locator:** four tests passed, including Pyproj reference points, metre-scale aspect, concave/holed/island shapes, and points strictly inside all 32 councils and 1,026 catchments. See `locator-checks.json`.
- **Wall/phone/preview:** the scene/phone test and preview-isolation test passed. All seven scenes were exercised at 11,514 × 1,200 and 15,360 × 1,200, including the full eight-chapter tour without a phone, member and region changes, Western Isles selection, reload, injected failure and empty catchments. See `scenes-flow.json` and `preview-flow.json`.
- **Offline phone:** the first run's new test asserted before the existing real-time interval fired after advancing a fake clock. The test now waits for that interval. The corrected test passed, with the paired phone showing the offline message and no same-browser advice. The original run is retained in `browser-checks.txt`; the passing rerun is in `offline-check.txt`. No runtime change was made for that test timing correction.
- **Charts:** July and October SVG coordinates match both source medians, all 24 individual member dots, selected-month markers and the later-period low/high range. There is exactly one shaded range. See `chart-checks.json` and the native card/chart captures.
- **Study data:** all 84 mean figures and 48 annual map frames are unchanged, as are geometry and climate version. The twelve-member domains are shared and documented in `study-data-checks.json` and the study's `sources.json`.
- **Standalone study:** twelve view/metric/wall-size combinations, selection, fit/scroll and direct-file loading passed. The July PT contribution map has negative red cells and its mean is −15.9 mm. See `../scene-study-2026-10-14/browser-checks.json` and refreshed study captures.
- **Hosted study on staging:** twelve combinations passed under the app's CSP, with matching exported data/HTML, no page or CSP errors, and no climate API or relay requests. See `hosted-checks.json`.

Staging ran on 127.0.0.1:18123 with a separate relay database. The public hosted-study check is also recorded in `../scene-study-2026-10-14/hosted-checks.json` after deployment. Container/source and public asset checks are in `deployment-checks.json`.
