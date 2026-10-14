# CC review follow-up, 14 October 2026

Immersive v4.2.2 addresses the six live issues in the [independent review](cc-followup-2026-10-14/CC_REVIEW.md).

## Wall and controller

- Na h-Eileanan Siar can be selected from the phone and desktop preview. The accepted west bound now includes St Kilda.
- A paired phone waiting for the wall says “Wall offline — waiting for connection”. The same-browser instruction is reserved for local control.
- Member spread keeps both median lines. Only the 2050–2079 range is shaded, and the subtitle says which period it represents.
- Change bars and land-cover bars have rectangular legend keys.
- The baseline caption names the selected region. Analytical scenes show the change beneath the change map, without repeating it beneath the future absolute map.
- The locator marker is placed inside the selected geometry, including island regions and polygons with holes. The inset still uses EPSG:27700.

The seven scenes, scene order, Month loop, Scene loop and numerical summaries are unchanged. Keep one Member spread stop in the scene loop. A twelve-member atlas is a candidate to replace that stop after it is integrated and checked in the suite; the current detailed charts remain useful for a presenter. There is no sequential member loop.

## Separate scene study

The [hosted study](https://climascope.hutton.ac.uk/static/immersive/scene-study/index.html) and its downloadable HTML were updated together. These remain proposals outside the live wall scene catalog.

The twelve-member view uses one July scale per metric, shared across all twelve members: water balance ±90 mm, precipitation ±70 mm, and Tmax ±7 °C. Limits use the 95th percentile of absolute July cell changes pooled across all members, rounded outward to 10 mm or 1 °C. End colours include values beyond those limits; affected legend ends use ≤ or ≥. The clipped shares are 3.12%, 4.42% and 0.24%, respectively. The year view retains its fixed annual scales.

The PT component map and chart now show **−change in PT evapotranspiration**, its contribution to water-balance change. Increased PT evapotranspiration therefore appears red and contributes a negative value. July reads −12.2 + (−15.9) = −28.1 mm. The component maps retain a common ±160 mm scale; the three-map study remains compact. The annual atlas is the first candidate for a wider production scene.

All 84 national mean figures, the 48 annual map frames, geometry and climate-data version are unchanged. The PT method name and final land-cover source-year link remain unconfirmed.

## Checks and deployment

See [checks and captures](cc-followup-2026-10-14/README.md). They cover both wall sizes, Western Isles selection, phone pairing and offline status, all seven scenes and the complete tour, preview isolation, chart coordinates, and locator points inside all 32 councils and 1,026 catchments. The standalone and hosted study each passed twelve view/metric/size combinations.

Deployed on `retina` using the normal Docker build/recreate flow. Container `app-climascope-1` runs image `sha256:9a37c427174aaff714afc923bda2e5a8430b496316440d0e4bea8a99347001a5`. All 52 checked runtime files match the tested sources; six public pages and ten public asset hashes passed. The public hosted study also passed its twelve combinations under the site CSP. See [deployment-checks.json](cc-followup-2026-10-14/deployment-checks.json).

The previous image is retained as `app-climascope:pre-cc-followup-20261014` (`sha256:681b1124e270502f1255dcf0daa6b531d7275906a33581733c5adf695b30db71`). To roll back, tag that image as `app-climascope:latest`, then run `docker compose up -d --no-build --force-recreate climascope` from the app directory on retina.

Refresh the wall and preview, then pair the phone again: the container-local relay database was recreated. Physical projection contrast and sector placement still need checking in the room.
