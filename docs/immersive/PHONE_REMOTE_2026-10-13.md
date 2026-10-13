# Integrated wall and phone control

13 October 2026. Combines the overview/annual playback in
[INCREMENT_1_2026-10-13.md](INCREMENT_1_2026-10-13.md) with a phone controller.
The ordinary desktop viewer at `/` remains separate.

The combined version is deployed; see [DEPLOYMENT_2026-10-13.md](DEPLOYMENT_2026-10-13.md) for the image and live checks.

## Using the live version

1. Keep `https://climascope.hutton.ac.uk/immersive` on the computer feeding the
   suite's one shared display source.
2. Select **Phone remote** on that page. A panel displays the remote URL and
   an eight-character connection code.
3. On a phone or tablet, open
   `https://climascope.hutton.ac.uk/immersive/control` and enter the code.
4. Change month, member, council/catchment, playback or dwell time on the phone.
   The phone sends commands; the wall runs and renders the display. The remote
   reports loading/displayed/error with the wall's actual selection.

Both devices need access to the same ClimaScope server. Public HTTPS access
allows the phone to use Wi-Fi or mobile data. No extra screen-sharing input,
native mobile app, websocket service or third-party messaging service is needed.

Codes expire after ten minutes and are single use. **New code** on the wall
allows a second phone to pair; successful pairing revokes the old controller.
Wall and phone refreshes preserve the connection in the same browser tab.
Closing that browser session may require pairing again. Sessions last twelve
hours, and a container restart clears them with the default database location.

**Use this browser only** keeps the original local-tab control option. A paired
wall uses its own room and stops listening to the global local-tab channel.

The initial phone connection uses a typed code; QR pairing is not included.

## Integration details

- `immersive_remote.py` supplies a SQLite message relay shared across all four
  Gunicorn workers. Connections are per request; commands have idempotency
  identifiers, a fifteen-second lifetime and room-specific credentials.
- `/api/immersive/remote/…` responses are not cached. Origin checks apply to
  writes, pairing attempts are rate limited across workers, and offline commands
  are rejected. Bearer credentials are sent in headers, never URLs.
- `static/immersive/remote.js` replaces the channel transport used by the two
  immersive pages. The existing `set`/`step`/`play`/`pause`/`dwell` commands and
  wall loading/ready/error reports are preserved.
- The wall remains the only playback authority. A closed/hidden controller does
  not run the annual clock. The relay polls only small commands/status, not
  climate-grid partitions. Existing bounded data loading and prefetch remain.
- `remote.css` adds pairing and phone-sized controls. The ordinary desktop
  viewer's template, scripts and styles are not changed by the remote feature.

The default SQLite path is `/dev/shm/climascope-remote.sqlite3` on Linux. This
uses local temporary storage shared by workers within one container. Override
with `IMMERSIVE_REMOTE_DB` only if needed; use local storage, not NFS. Multiple
container replicas would need a shared server-backed store or a single routed
relay. The present deployment is one container with multiple workers.

The earlier prototype is committed separately as `ffdda9c` on
`codex/immersive-phone-remote`. Its v3 wall/controller files should not replace
the newer increment-1 files. The integrated version keeps the stronger v4
renderer readiness and member-consistent summaries.

## Verification

Protocol tests are in `tests/test_immersive_remote.py`. They cover shared-worker
state, room isolation, role permissions, one-time/expired codes, replacement
controller codes, revocation, offline/stale commands, duplicate-step prevention,
coalesced full selections, renderer reports, invalid inputs, Origin checks and
shared pairing rate limits.

The real-data browser flow is in `tests/test_immersive_phone_flow.py`, with
separate wall/phone browser contexts and a 390 × 844 phone viewport. It uses the
actual Flask app, MapLibre, vector tiles and climate Parquets, without bypassing
the application's Content Security Policy.

Run the protocol suite:

```bash
venv/bin/python -m unittest discover -s tests -p test_immersive_remote.py -v
```

For the integrated flow, start a separate staging app, then run:

```bash
CLIMASCOPE_TEST_URL=http://127.0.0.1:18123 \
  venv/bin/python -m unittest discover -s tests -p test_immersive_phone_flow.py -v
```

Playwright/Chromium must be available. `CLIMASCOPE_CHROMIUM` optionally selects
the browser executable and `CLIMASCOPE_BROWSER_ARTIFACTS` saves screenshots and
results. The staging run used four Gunicorn workers and two threads each.
The browser tests exercise both 11,514 × 1,200 and 15,360 × 1,200 canvases;
the open-mode flow additionally covers annual reset without the controller,
manual pause, rapid selections, an injected HTTP failure, wall reload and a
second phone taking control. Results are in [validation/](validation/).

Browser automation is not a physical phone/projector trial. Confirm the actual
suite input, safe band, viewing distances and readable text after deployment.

## Deployment handoff

Docker is reached through `ssh retina`. The deployment host and this workspace
share `/mnt/shared/docker/climascope/app`; no rsync or alternate checkout is
needed. The container is `app-climascope-1`, publishing port 8123 to app port 8000.

On the existing deployment host, update the app checkout from the reviewed
commit while preserving its ignored runtime data, then run from the directory
containing its existing `docker-compose.yml`:

```bash
docker compose up -d --build --force-recreate climascope
docker compose ps
docker compose logs --tail=80 climascope
```

The image bakes in the backend, templates and static files. All thirteen
`static/immersive/summaries/v2/*.json` files must be present in the build. No new
Python dependency or mandatory environment variable is needed for the relay.
Check the reverse proxy preserves the public Host and Authorization headers and
does not cache the remote API. The public-host Origin check must agree with the
host the phone is using. SSE/websocket proxy settings are not required.

After the rebuild, check the existing desktop viewer, load `/immersive`, pair
an actual phone, change a month and region, start/pause playback, then verify
refresh and controller takeover. Update the front-end mirror from the committed
integration afterward; its README/context should describe the v4 assets and
its integration notes should point to the new backend relay.

The replacement summary generator is `tools/precompute_immersive_summaries.py`.
The retired `region_monthly.json` must not be regenerated or used by the wall;
the mirror's old `precompute_region_monthly.py` needs retiring when the mirror
is updated. Do not include `tools/generate_mdt_submission.py`, the room video,
CVs or proposal drafts in the source commit.
