# Immersive v4.1 deployment, 13 October 2026

Dynamic scenes, guided playback and the independent live preview are deployed:

- Wall: https://climascope.hutton.ac.uk/immersive
- Phone: https://climascope.hutton.ac.uk/immersive/control
- Desktop preview: https://climascope.hutton.ac.uk/immersive/preview

Application code commit: `3e461c4`. Immersive mirror code commit: `ec59979`,
tag `immersive-v4.1.0`. Both main branches and the mirror tag were pushed.

## Deployment

Host/container: `ssh retina`, `app-climascope-1`. Rebuilt and recreated from the
shared `/mnt/shared/docker/climascope/app` checkout with:

```bash
ssh retina 'cd /mnt/shared/docker/climascope/app && docker compose up -d --build --force-recreate climascope'
```

Running image:
`sha256:8c0fd43d194ba7a8add5a8ccf7b94057ee01ec78745ba17912b750a4c30d58ad`.
Four Gunicorn workers booted at 15:46 UTC. Container was running with zero
restarts at verification. All 45 runtime files (app, relay, immersive static
assets/summaries and templates) were hashed inside the container and matched
the tested source checkout.

The previously running v4 image is retained as `app-climascope:pre-scenes-20261013`:
`sha256:72736f2e5f7ecd1a5705c68a558d76f6f5cee9406aa2355124622642b1b08534`.
The older pre-phone image remains available separately.

To restore v4 if needed, run on retina from the app directory:

```bash
docker image tag app-climascope:pre-scenes-20261013 app-climascope:latest
docker compose up -d --no-build --force-recreate climascope
```

## Verification

All 17 automated tests passed on local staging with four workers, real climate
data and Chromium at both 11,514 × 1,200 and 15,360 × 1,200. The final preview
check additionally verified coloured climate pixels in all five visible maps
after an empty-catchment reset and viewport resize. See
[scene methods and operation](SCENES_2026-10-13.md) and
[validation artifacts](scenes-validation-2026-10-13/).

Public HTTPS spot checks passed without a public tile sweep:

- Existing desktop viewer, wall, controller and new preview return HTTP 200.
- Ordinary pages retain DENY framing; only the preview wall allows same-origin embedding.
- Wall/controller templates include the shared scene catalog.
- Served wall, scene-catalog and preview JavaScript exactly match the tested source.
- A newly created isolated room paired through the public proxy; scene and tour commands reached its wall inbox, with no-store responses.

Results are recorded in
[deployment-checks.json](scenes-validation-2026-10-13/deployment-checks.json).

## First use

Refresh the wall and controller and pair them again. Recreating the container
replaces its in-memory-filesystem relay database, so previous pairing credentials
are no longer valid. Saved wall selections remain in browser storage.

Use the phone's scene buttons or Guided tour. The old nine-map overview is still
available. A fresh wall defaults to focused water balance; a returning wall
restores its saved scene. The desktop preview has its own controls and does not
steer the paired suite wall.

The new layouts still need physical-room checks for sector placement, projection
contrast, safe bands and readability at actual audience positions.
