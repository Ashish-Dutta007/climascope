# Immersive v4 deployment, 13 October 2026

The combined overview/playback and paired phone controller are live at
`https://climascope.hutton.ac.uk/immersive` and `/immersive/control`.

- Application code commit: `be9ddc9`.
- Host/container: `ssh retina`, `app-climascope-1`.
- Shared source: `/mnt/shared/docker/climascope/app`.
- Rebuild: `docker compose up -d --build --force-recreate climascope`.
- Running image: `sha256:72736f2e5f7ecd1a5705c68a558d76f6f5cee9406aa2355124622642b1b08534`.
- Four Gunicorn workers, two threads each; running with zero restarts at verification.
- The previous image is retained locally as `app-climascope:pre-phone-20261013`
  (`sha256:9baaa1a1f5e5939a1a7ef760cc0be3ac02163341ac9d3a94bd68fbb5469f3155`).

Before deployment, all 14 automated tests passed: 12 relay protocol tests and
two real-data browser flows at the documented open/full-wrap resolutions.
The open flow includes annual reset, playback with the controller page absent,
manual pause, rapid selection, failed-data recovery, refresh and controller
takeover. See [validation/](validation/) and
[PHONE_REMOTE_2026-10-13.md](PHONE_REMOTE_2026-10-13.md).

Public HTTPS spot checks verified:

- The existing desktop viewer, wall and controller return HTTP 200.
- The wall/controller markup includes the new connection assets.
- The served remote script exactly matches the tested source.
- A temporary, isolated test room can be created and paired through the public
  reverse proxy, including its Origin check and Authorization headers.
- A controller command reaches that room's wall inbox, with no-store responses.

No automated tile sweep or full-wall browser flow was run against the public
proxy. The data-backed browser tests ran against the isolated local four-worker
staging server. A physical phone/projector trial remains: refresh the wall page,
select **Phone remote**, open `/immersive/control` on a phone and enter its code.
Check month/region changes, playback and readable text from room viewing positions.
