# Immersive v4.2 deployment, 14 October 2026

Historical v4.2 deployment. The later [CC follow-up](CC_FOLLOWUP_2026-10-14.md) supersedes the running-image details below; the [readability patch](READABILITY_2026-10-14.md) records the intermediate v4.2.1 changes.

The compact layout, change maps, PT evapotranspiration companion and reviewed wording are live.

- Wall: https://climascope.hutton.ac.uk/immersive
- Phone: https://climascope.hutton.ac.uk/immersive/control
- Desktop preview: https://climascope.hutton.ac.uk/immersive/preview

Canonical application code: `d2b2141`. Mirror code: `554b196`. Mirror release tag: `immersive-v4.2.0`.

## Deployment

Rebuilt on `retina` from `/mnt/shared/docker/climascope/app`, then recreated with:

```bash
docker compose build climascope
docker compose up -d --no-build --force-recreate climascope
```

Container `app-climascope-1` runs image
`sha256:3506baa0b397a3bca4f97fcf28033cedcd33a0e3b337742374e5ae5bca64377f`.
It was running with zero restarts at verification. All 45 runtime files inside
the container matched the tested checkout by SHA-256. Public desktop, wall,
controller and preview pages returned 200; six served UI assets matched source.
Ordinary pages retained DENY framing; the preview iframe retained SAMEORIGIN.
See [deployment checks](final-validation-2026-10-14/deployment-checks.json).

Eighteen current tests passed on local staging, including real source-data
reconciliation and both wall sizes. See [validation](final-validation-2026-10-14/README.md)
and [layout/data notes](WALL_LAYOUT_2026-10-14.md). Final wide captures use a
4,096-pixel scrolling viewport and were checked for the earlier repetition fault.

## Reconnect and room check

Refresh the wall and controller, then pair again: the recreated container has a
new relay database. Saved browser selections remain. The independent preview
can be used from a laptop without controlling the suite wall.

Sector placement, projection contrast, font sizes and the bottom safe band still
need a physical-room check. The land-cover year remains unconfirmed pending the
last GB source-file link; the wall does not label it as 2024.

## Rollback

The previous v4.1 image is retained as `app-climascope:pre-compact-20261014`,
SHA-256 `8c0fd43d194ba7a8add5a8ccf7b94057ee01ec78745ba17912b750a4c30d58ad`.
Run on retina from the app directory:

```bash
docker image tag app-climascope:pre-compact-20261014 app-climascope:latest
docker compose up -d --no-build --force-recreate climascope
```

This restores the old baked-in code and summaries. Reload and re-pair after rollback.
