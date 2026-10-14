# Final checks, 14 October 2026

All 18 current tests passed: 13 relay tests, one raw-source/change-domain test,
two scene/preview flows and two wall/phone flows. The first combined browser run
passed both scene flows but found an obsolete total-canvas assertion in the phone
tests (nine overview canvases became eleven reusable canvases). That assertion
now checks the nine visible overview maps; both phone flows then passed.

- `source-and-relay-tests.txt`: 14 passed in 7.0 s.
- `browser-tests-initial.txt`: scene flows passed; old phone assertion failures retained.
- `phone-tests-final.txt`: both updated phone flows passed in 84.4 s.
- `scenes-flow.json`, `preview-flow.json`: all scenes at both sizes, complete loop,
  preview isolation, recovery and no-data checks. Heap: 213.0 → 217.5 MB after GC.
- `tiles/index.html`: all seven views at both documented wall sizes.
- `capture-validation.json`: no 8,192-pixel repetition in any of the 14 tiled captures.
- `summary-generation.txt`, `scene-generation.txt`: source reconciliation and fingerprints.

The four-metric monthly map payload, including change arrays, was 6,251,234 bytes
with Brotli on local staging (July ensemble mean). Playback still has one data
request in flight and one next-frame cache. No public browser/tile sweep was run.

Physical room checks remain outstanding. Local staging is stopped after release.
