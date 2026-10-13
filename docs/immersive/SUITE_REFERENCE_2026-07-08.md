> Reference copied on 13 October 2026 from climascope-immersive, commit `4cb3f4016b59a278d449d1abf8cd94ad6370571b`. This is the July snapshot; deployment details need current verification.

# ClimaScope Immersive Suite — context snapshot

State as of tag `immersive-v3.9.1` (2026-07-08). One-stop context for new
sessions. Deeper detail: `README.md` (overview), `NOTES.md` (integration
points + full changelog).

## What & where

- Wall display at `/immersive`, controller at `/immersive/control`, both served
  by the main ClimaScope Flask/Gunicorn app.
- Production: `climascope.hutton.ac.uk` — Docker container `app-climascope-1`
  on the retina Mac (port 8123→8000). All code/assets are baked into the image
  (`COPY . .`), so **every change needs `docker compose up -d --build`** there;
  a browser refresh alone never picks up changes.
- Working tree: `/mnt/shared/docker/climascope/app`. Mirror repo:
  `github.com/Ashish-Dutta007/climascope-immersive` (front-end only; `app.py`
  integration snippets documented in NOTES).

## Dimensions

| Display | Resolution |
|---|---|
| Standard wall (open mode) | 11 514 × 1 200 px |
| Extended wall (full wrap) | 15 360 × 1 200 px |

- dpr 1, fullscreen, no browser chrome. Layout is `100vw × 100vh` flex:
  selection strip 52px · panel header 84px · period label 46px · stats strip
  122px · footer 38px; maps fill the rest (~858px tall).
- 3 panels × (3 maps + 1 chart) = **12 columns**, ≈960px each at open mode,
  ≈1280px at full wrap. Fluid widths — no fixed px.
- Test in DevTools device mode at the real resolutions. Small windows have
  known guards, not bugs: seasonal chart drops to a text-free compact mode
  below ~340px cell width, and the camera is clamped to `minZoom: 5` because
  the tileset has no tiles below z5 (below that the maps would render empty).

## Functionality (current)

- **Panels (default 3):** CWBPT, Prec_sum, Tmax_mean. ETPT_sum exists in the
  data/endpoint but is off by default — re-add a row to `PANELS` in
  `immersive.js` to restore.
- **Per panel:** three MapLibre maps — Observed baseline 1990-2019
  (`obs_value`) | 2020-2049 | 2050-2079 (`proj_value`), absolute values on a
  shared national colour domain — plus a 12-month seasonal SVG chart
  (baseline vs 2050-2079, ensemble mean, selected month marked) and a bottom
  strip of the three period means.
- **Strip + chart data:** static `static/immersive/region_monthly.json`
  (1059 regions × 4 metrics × 3 periods × 12 months, ensemble mean;
  regenerate with `precompute_region_monthly.py` after any precompute
  refresh). Reconciles exactly with the wall's aggregation method.
- **Controller:** month (Jan–Dec), ensemble member (mean + 12 sparse ids
  01,04–13,15), region (council + catchment dropdowns, mutually exclusive,
  "Reset to Scotland" button).
- **Sync:** `BroadcastChannel("climascope-immersive")` — same-origin tabs
  only. Message `{type:'state', month, member, region:{name,bounds,geometry}}`;
  wall pings on load, controller replies. Planned v4 replacement:
  server-mediated SSE (`POST /immersive/state` + `GET /immersive/stream`) so
  other devices/machines can control the wall — see NOTES §4c (gunicorn
  multi-worker shared-state caveats documented there).
- **Region select:** camera `fitBounds` (1200 ms), data clipped to the region
  polygon (world-minus-region mask above the cells), per-panel metric scale
  bar, and a locator inset (Scotland context + region highlight). Colour
  scales stay national — no rescaling on zoom.
- **Map data:** `/api/immersive_values` batch endpoint (all metrics × periods,
  one request, brotli ~7.8 MB) + `/tiles/{z}/{x}/{y}.pbf` vector tiles
  (MBTiles, z5–14 only). Member selection changes maps only; strip/chart stay
  ensemble-mean by design.

## Machars / Potree viewer — separate project, shared venue only

The Machars LiDAR viewer (https://soils4unc.hutton.ac.uk/machars/) is part of
the **RRF Lot 3 LiDAR project** (SoilForUNC webapp at
`/mnt/shared/projects/jhi/soils/202411_SoilForUNC/webapp/`). It is **not part
of ClimaScope** and is not being integrated into this suite — the only thing
shared is the physical wall it will be displayed on (dims above). Its wall
adaptation happens in the soils webapp, not here.

Historical note: a self-hosted `/immersive/lidar` view existed briefly inside
ClimaScope and was removed at v3.9 (recoverable at tag `immersive-v3.8.1` +
app-repo `e53a57e`; `potree_libs/` and `data/potree/` still on disk, inert).
Also verified 2026-07-08: soils4unc sends `X-Frame-Options: SAMEORIGIN`
(no iframing from other origins) and, being a different origin, cannot share
a BroadcastChannel with ClimaScope pages.

## Version timeline (tags)

`immersive-v2` layout → `v3` remote controller → `v3.1` batch endpoint +
AbortController → `v3.2.x` region zoom / shape clip / reset UX → `v3.3` scale
bar (+ Esri labels, later retired) → locator inset → `v3.5` region_monthly
artifact → `v3.6` per-region strip → `v3.7` 3 panels + seasonal chart →
`v3.8` chart legibility → `v3.8.1` LiDAR view snapshot + security pass →
`v3.9` LiDAR view removed → `v3.9.1` minZoom tile-floor clamp.
