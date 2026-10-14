# Hosted scene study

The later readability deployment also includes these assets in Docker image
`sha256:681b1124e270502f1255dcf0daa6b531d7275906a33581733c5adf695b30db71`.
Their container hashes and public HTML were verified after that rebuild. The
initial static-only hosting steps below are retained for reference.

Published on 14 October 2026 at:

https://climascope.hutton.ac.uk/static/immersive/scene-study/index.html

The existing current-wall preview is:

https://climascope.hutton.ac.uk/immersive/preview

The latter renders the current seven wall scenes in an independent iframe, with month, metric, member, region and playback controls. It does not mirror or control a paired suite session. A direct link to the current member charts is:

https://climascope.hutton.ac.uk/immersive/preview?scene=agreement&focus=CWBPT&month=7

## Source and hosting

`export_hosted.py` converts the standalone study into three files in `static/immersive/scene-study/`: `index.html`, `study.js` and `data.json`. The hosted version uses an external script and same-origin data fetch to comply with the current Content Security Policy. No headers were relaxed. Links back to the current wall preview distinguish the proposals from the current wall software.

Export:

```bash
cd /mnt/shared/docker/climascope/app
python3 docs/immersive/scene-study-2026-10-14/export_hosted.py
```

The new static directory was copied into the running container:

```bash
ssh retina 'docker cp /mnt/shared/docker/climascope/app/static/immersive/scene-study app-climascope-1:/app/static/immersive/'
```

The application and container were not restarted; the running v4.2 image remains `sha256:3506baa0b397a3bca4f97fcf28033cedcd33a0e3b337742374e5ae5bca64377f`, started at `2026-10-14T10:32:09.01674534Z`, with zero restarts at verification. No wall renderer, phone control, relay database or existing preview files changed. The source static assets are also present for the next normal Docker build; recreating from the previous image without rebuilding would omit this new directory.

The study remains a separate national design study. The twelve-member view includes July only. It does not change what Jess will see on `/immersive`.

## Verification

Real Chromium loaded the public study under the actual site CSP, with no CSP override. Twelve view/metric/wall-size combinations, month and member selection, map counts and content overflow checks passed. There were no uncaught page errors or CSP errors. The study makes no climate API or remote-relay requests.

The public HTML and data hashes matched the local exported files. The current preview returned 200, exposed scene/ensemble/playback controls, and its public scene catalog matched the current local source. See `hosted-checks.json` and `hosted-study.png`.
