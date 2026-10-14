"""Capture local wall previews in tiles without a wall-width browser surface.

Run with the app's Playwright environment. The iframe retains the true wall
viewport; only the outer preview is scrolled. Output includes a tiled HTML gallery
and layout measurements. No production relay connection is made.
"""
import argparse
import html
import json
import os
from pathlib import Path
from urllib.parse import urlencode, urlparse

from playwright.sync_api import sync_playwright

SCENES = ["overview", "focus-water", "focus-rain", "focus-heat", "water-extent", "landscape", "agreement"]
TILE_WIDTH = 4096


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:18123")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--width", type=int, choices=[11514, 15360], action="append")
    parser.add_argument("--scene", choices=SCENES, action="append")
    args = parser.parse_args()
    if urlparse(args.url).hostname not in {"localhost", "127.0.0.1", "::1"}:
        parser.error("Use a local staging server for these captures.")
    args.output.mkdir(parents=True, exist_ok=True)
    records, errors = [], []
    with sync_playwright() as pw:
        options = {"headless": True, "args": ["--no-sandbox", "--use-angle=swiftshader",
                   "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]}
        if os.environ.get("CLIMASCOPE_CHROMIUM"):
            options["executable_path"] = os.environ["CLIMASCOPE_CHROMIUM"]
        browser = pw.chromium.launch(**options)
        try:
            page = browser.new_page(viewport={"width": TILE_WIDTH, "height": 1240}, device_scale_factor=1)
            page.on("pageerror", lambda error: errors.append(str(error)))
            query = urlencode({"width": (args.width or [11514])[0], "scene": "focus-water", "month": 7})
            page.goto(args.url.rstrip("/") + "/immersive/preview?" + query)
            page.wait_for_function("()=>document.querySelector('#preview-status').dataset.status==='ready'", timeout=90000)
            page.select_option("#preview-scale", "1")
            # Change only the surrounding preview shell, never the wall's CSS.
            page.add_style_tag(content="""
                header,main > :not(#viewport){display:none} main{padding:0}
                #viewport{position:fixed;left:0;top:0;width:4096px;height:1220px;max-height:none;border:0}
            """)
            frame = page.frame_locator("#wall-frame")
            for width in args.width or [11514, 15360]:
                page.select_option("#wall-size", str(width), force=True)
                page.wait_for_timeout(600)  # The wall's resize handler is debounced by 250 ms.
                for scene in args.scene or SCENES:
                    page.select_option("#scene-select", scene, force=True)
                    page.wait_for_function("""scene => document.querySelector('#preview-status').dataset.status==='ready'
                        && document.querySelector('#wall-frame').contentDocument.body.dataset.scene===scene""", arg=scene, timeout=90000)
                    viewport = frame.locator("body").evaluate("()=>[innerWidth,innerHeight,devicePixelRatio]")
                    assert viewport == [width, 1200, 1], viewport
                    layout = frame.locator("body").evaluate("""() => ({
                        panels:[...document.querySelectorAll('.group:not([hidden])')].map(e=>({
                            primary:e.classList.contains('focus-primary'),text:e.innerText,
                            x:e.getBoundingClientRect().x,width:e.getBoundingClientRect().width})),
                        overflows:[...document.querySelectorAll('.scene-insight,.support-summary')]
                            .filter(e=>e.getClientRects().length && (e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2))
                            .map(e=>e.className)
                    })""")
                    assert not layout["overflows"], (width, scene, layout["overflows"])
                    record = {"width": width, "height": 1200, "scene": scene, "layout": layout, "tiles": []}
                    for x in range(0, width, TILE_WIDTH):
                        actual = page.locator("#viewport").evaluate("(e,x)=>{e.scrollLeft=x;return e.scrollLeft}", x)
                        page.wait_for_timeout(150)
                        tile_width = min(TILE_WIDTH, width - x)
                        name = f"{width}-{scene}-{x}.png"
                        page.screenshot(path=str(args.output / name),
                            clip={"x": x - actual, "y": 0, "width": tile_width, "height": 1200})
                        record["tiles"].append({"file": name, "x": x, "width": tile_width})
                    records.append(record)
                    print(width, scene, "captured", flush=True)
            assert not errors, errors
        finally:
            browser.close()
    (args.output / "captures.json").write_text(json.dumps({"records": records, "errors": errors}, indent=2))
    sections = []
    for record in records:
        tiles = "".join(f'<a style="width:{tile["width"] / record["width"] * 100}%" href="{html.escape(tile["file"])}">'
                        f'<img src="{html.escape(tile["file"])}"></a>' for tile in record["tiles"])
        sections.append(f'<h2>{html.escape(record["scene"])} · {record["width"]} × 1200</h2><div class="strip">{tiles}</div>')
    (args.output / "index.html").write_text('''<!doctype html><meta charset="utf-8"><title>ClimaScope wall captures</title>
        <style>body{background:#e9eff2;color:#183747;font:16px system-ui;margin:24px}
        h2{font-size:18px}.strip{display:flex;width:100%}.strip a{display:block}.strip img{display:block;width:100%}</style>
        <h1>ClimaScope wall captures</h1><p>Local review candidate. Click a tile for full resolution.</p>
        <p>The wall renders at its stated dimensions inside a 4,096-pixel-wide scrolling preview.</p>''' + "".join(sections))


if __name__ == "__main__":
    main()
