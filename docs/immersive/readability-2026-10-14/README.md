# Copy, member figures and locator checks

Four tests passed in 168.806 seconds: the two real-data scene/phone/preview flows at both wall sizes and two British National Grid projection tests. `checks.txt` contains the result. The scene loop completed with the controller closed; saved selections, preview isolation, failure recovery, mixed member directions and a rounded near-zero result were checked.

`member-source-audit.json` records an independent read of 336 climate partitions. July national CWB reductions range from 4.368 mm (member 05) to 49.682 mm (member 08). The largest difference between raw calculations and stored three-decimal agreement figures is below 0.001.

`chart-checks.json` records checks for July and October: both median lines, every shaded range boundary, all 24 individual-member dots and the selected-month markers match the source summaries. Yellow/dashed is 2020–2049; orange/solid is 2050–2079. The chart ordinate is change from the observed baseline.

`member-card.png` and `negative-balance-card.png` show the final wording at native size. The corrected inset is in `locator-aberdeenshire.png` and `.svg`. The PNG is a larger rendering of the SVG for inspection, using the same paths. The inset projection is EPSG:27700; no main-map or climate-data projection was changed.

`runtime-sha256.json` lists 52 deployed runtime/static files. All match the rebuilt container. `deployment-checks.json` records six public page checks, seven served-asset hashes, the container state and the new image. The isolated hosted design study remains available after the rebuild.

Room readability and projection contrast still need the suite itself.
