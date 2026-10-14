# Review captures

The six `before-*-wall.png` and `after-*-wall.png` files in this directory are **invalid beyond x = 8,192**. Their right-hand pixels repeat the left edge exactly. They are retained to identify the evidence CC reviewed, not as checks of the full wall. The original `copy-review.json` contains DOM measurements unaffected by that capture fault.

The current candidate is in [`cc-fixes/tiles/index.html`](cc-fixes/tiles/index.html). Each capture uses a 4,096-pixel-wide parent browser window, scrolls across an iframe at the true wall size, and saves separate tiles. `captures.json` records the dimensions, tile positions and panel text. `cc-fixes/` also contains the updated scene and preview test results.

To reproduce against local staging, with Playwright/Chromium available:

```bash
venv/bin/python tools/capture_immersive_wall.py --url http://127.0.0.1:18123 --output /tmp/climascope-wall-captures
```

`CLIMASCOPE_CHROMIUM` can select an installed browser binary. The gallery opens locally; click a tile for full resolution. The app's regular preview remains the interactive option.
