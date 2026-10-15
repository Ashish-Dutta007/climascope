# Feedback checks

See [release and methods](../JESS_FEEDBACK_2026-10-15.md).

- **Source and relay:** 16 distinct tests. The initial run passed 15; one independent comparison accumulated source float32 values at float32 precision. Promoting those source values to float64 fixed the test and allowed a tighter six-decimal check; the rerun passed. Runtime calculations already summed in double precision. Logs: `source-and-relay-tests.txt`, `source-test-rerun.txt`.
- **Land-cover source:** independently checked fractional, clipped areas for Scotland, Angus, Na h-Eileanan Siar and the smallest catchment. All 1,059 regions and ten classes are in the generated artifact, without a climate-support filter.
- **CWR source:** national member 01, national mean, Angus member 08 and a catchment mean were reconciled against raw source rows for January, July and December in all three periods. Class totals and land-use sums agree; invalid selections are rejected. Source fingerprints: `cwr-sources.json`.
- **Existing browser flows:** three tests passed, including all eight scenes at both sizes, the complete nine-chapter tour without a phone, pairing, reload, member/region selection, offline advice, preview isolation, failure and no-data recovery. Log: `browser-tests.txt`; results: `scenes-flow.json`, `preview-flow.json`.
- **New context browser flow:** passed at both wall sizes. Checks painted land-cover pixels, all ten area bars, CWR SVG values/heights, three periods × twelve months × four classes, member/council changes, cached month changes, and preservation of the previous frame after HTTP 503. Plot labels stay inside their SVG and the lower axis clears the last bar. See `context-browser-final.txt` and `context-flow.json`. The earlier `context-browser-tests.txt` also ran imported tests before the harness import was corrected; they passed.
- **Captures:** fitted previews at both sizes and native land-cover, CWR and later-period CWR detail. Native captures remain below Chromium's 8,192 px capture limit.
- **Public deployment:** 57 container files match the tested checkout. Six pages, nine public assets and all 36 CWR month/period summaries were checked against staging. See `deployment-checks.json` and `runtime-sha256.json`.
- **Public browser:** the isolated CWR preview loads its three period charts and 144 monthly class bars, with no page errors, remote-relay or climate-grid calls. Map tile requests were fulfilled locally during this check to avoid a production tile sweep. See `public-browser-checks.json`.

Staging used 127.0.0.1:18123 and a separate relay database. Existing unrelated document deletions in the app worktree were left untouched.
