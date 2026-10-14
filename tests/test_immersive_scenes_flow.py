"""Opt-in real-data scene, tour and isolated preview checks on local staging."""
import base64
import json
import os
from pathlib import Path
import time
import unittest
import urllib.request
import uuid

BASE = os.environ.get("CLIMASCOPE_TEST_URL", "").rstrip("/")
ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(BASE, "set CLIMASCOPE_TEST_URL to a staging server")
class SceneFlows(unittest.TestCase):
    def setUp(self):
        from playwright.sync_api import sync_playwright
        self.pw = sync_playwright().start()
        args = {"headless": True, "args": ["--no-sandbox", "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-precise-memory-info"]}
        if os.environ.get("CLIMASCOPE_CHROMIUM"):
            args["executable_path"] = os.environ["CLIMASCOPE_CHROMIUM"]
        self.browser = self.pw.chromium.launch(**args)
        self.errors = []
        self.artifacts = Path(os.environ.get("CLIMASCOPE_BROWSER_ARTIFACTS", "/tmp/climascope-scenes-tests"))
        self.artifacts.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        self.browser.close()
        self.pw.stop()

    def watch(self, page):
        page.on("pageerror", lambda e: self.errors.append(str(e)))

    def wait(self, page, predicate, label, seconds=60):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            if predicate():
                return
            page.wait_for_timeout(200)
        self.fail("Timed out: " + label)

    def has_climate_pixels(self, page, canvas):
        capture = base64.b64encode(canvas.screenshot()).decode()
        return page.evaluate("""async png => {
          const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
          const image = await createImageBitmap(new Blob([bytes], {type:'image/png'}));
          const canvas = document.createElement('canvas');
          canvas.width = image.width; canvas.height = image.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close();
          const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data;
          let coloured = 0;
          for(let i=0;i<pixels.length;i+=4) {
            const high=Math.max(pixels[i],pixels[i+1],pixels[i+2]);
            const low=Math.min(pixels[i],pixels[i+1],pixels[i+2]);
            if(high>100 && high-low>45) coloured++;
          }
          return coloured>100;
        }""", capture)

    def test_scene_controls_and_complete_tour(self):
        wall = self.browser.new_context(viewport={"width": 11514, "height": 1200}).new_page()
        phone = self.browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True).new_page()
        self.watch(wall)
        self.watch(phone)
        wall.goto(BASE + "/immersive?fresh=1")
        self.wait(wall, lambda: wall.locator(".num-value").first.inner_text() == "3.2 mm" and
                  not wall.locator(".ctx-chip").first.inner_text(), "initial overview")
        wall.get_by_role("button", name="Phone remote", exact=True).click()
        self.wait(wall, lambda: len(wall.locator(".remote-code").inner_text().replace(" ", "")) == 8, "connection code")
        phone.goto(BASE + "/immersive/control")
        phone.locator("#remote-code").fill(wall.locator(".remote-code").inner_text())
        phone.get_by_role("button", name="Connect", exact=True).click()
        self.wait(wall, lambda: phone.evaluate("!!sessionStorage.getItem('climascope-phone-remote-controller')"), "paired phone")
        credentials = phone.evaluate("JSON.parse(sessionStorage.getItem('climascope-phone-remote-controller'))")
        url = BASE + "/api/immersive/remote/rooms/" + credentials["room"] + "/messages"
        headers = {"Authorization": "Bearer " + credentials["token"]}

        def report():
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=10) as response:
                return json.load(response).get("report") or {}

        def ready(scene=None, **selection):
            r = report()
            shown = r.get("shown") or {}
            return r.get("status") == "ready" and (scene is None or shown.get("scene") == scene) and all(shown.get(k) == v for k, v in selection.items())

        def send(command):
            data = json.dumps({"nonce": uuid.uuid4().hex, "message": {"type": "command", **command}}).encode()
            req = urllib.request.Request(url, headers={**headers, "Content-Type": "application/json"}, data=data)
            with urllib.request.urlopen(req, timeout=10) as response:
                self.assertEqual(response.status, 200)

        self.wait(wall, lambda: ready("focus-water", month=7), "pairing preserves the default focused scene")
        wall.get_by_role("button", name="Hide", exact=True).click()
        scenes = ["overview", "focus-water", "focus-rain", "focus-heat", "water-extent", "landscape", "agreement"]
        records = []
        for width in [11514, 15360]:
            wall.set_viewport_size({"width": width, "height": 1200})
            for scene in scenes:
                phone.locator('.btn-scene[data-scene="' + scene + '"]').click()
                self.wait(wall, lambda: ready(scene, month=7), scene)
                self.assertEqual(wall.locator(".mapcell:visible").count(),
                    9 if scene == "overview" else 6 if scene.startswith("focus-") else 3)
                self.assertEqual(wall.locator('.group:not([data-metric="ETPT_sum"]) .num:not(.change-num) .num-value').all_text_contents(),
                    ["3.2 mm", "−3.7 mm", "−24.9 mm", "94.5 mm", "94.8 mm", "82.3 mm", "16.4 °C", "19.1 °C", "21.1 °C"])
                overflow = wall.evaluate("""() => [...document.querySelectorAll('.scene-insight:not([hidden]),.support-summary:not([hidden])')]
                  .filter(e=>e.getClientRects().length && (e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2)).map(e=>e.className)""")
                self.assertEqual(overflow, [])
                if scene == "water-extent":
                    self.assertEqual(wall.locator(".focus-primary .insight-value").inner_text(), "81.4%")
                    self.assertEqual(wall.locator('.focus-primary .insight-detail').inner_text(), '1990–2019: 57.4%')
                    self.assertEqual(wall.locator('.focus-primary .insight-note').count(), 0)
                if scene == "agreement":
                    self.assertEqual(wall.locator('.focus-primary .member-count strong').all_text_contents(), ['12'])
                    self.assertEqual(wall.locator('.focus-primary .member-count span').inner_text(), 'of 12 show lower water balance')
                    self.assertEqual(wall.locator('.focus-primary .insight-detail').inner_text(), '4.4 to 49.7 mm lower')
                if scene == "landscape":
                    self.assertEqual(wall.locator(".focus-primary .scene-insight h2").inner_text(), "Mountain, heath & bog")
                    self.assertEqual(wall.locator(".focus-primary .insight-value").inner_text(), "73.8%")
                if scene == "focus-water":
                    self.assertEqual(wall.locator('.focus-support:visible').evaluate_all('(els)=>els.map(e=>e.dataset.metric)'), ['Prec_sum', 'ETPT_sum'])
                    self.assertEqual(wall.locator(".focus-support .num:visible").count(), 0)
                    for canvas in wall.locator(".focus-support canvas").all():
                        if canvas.is_visible():
                            self.assertTrue(self.has_climate_pixels(wall, canvas))
                if scene != "overview":
                    self.assertEqual(wall.locator('.focus-primary').evaluate('(e)=>Math.round(e.getBoundingClientRect().width)'), 4300)
                    self.assertEqual(wall.locator('.change-map:visible').count(), 1)
                    self.assertIn('Zero-centred', wall.locator('.change-map .legend').inner_text())
                    expected_change = {'focus-rain': '−12.2 mm', 'focus-heat': '+4.8 °C'}.get(scene, '−28.1 mm')
                    self.assertEqual(wall.locator('.change-num .num-value').inner_text(), expected_change)
                self.assertEqual(wall.locator('#panels').evaluate('(e)=>getComputedStyle(e).backgroundColor'), 'rgb(3, 4, 10)')
                records.append({"width": width, "scene": scene, "maps": wall.locator(".mapcell:visible").count()})
            phone.locator("#focus-select").select_option("Tmax_mean")
            self.wait(wall, lambda: ready("agreement", focus="Tmax_mean"), "agreement metric")

        phone.locator("#focus-select").select_option("Prec_sum")
        phone.locator("#council-select").select_option("Angus")
        self.wait(wall, lambda: ready("agreement", focus="Prec_sum", region="Angus"), "even member split")
        self.assertEqual(wall.locator(".focus-primary .member-count strong").all_text_contents(), ["6", "6"])
        self.assertEqual(wall.locator(".focus-primary .insight-caption").inner_text(), "July mean · 2050–2079 compared with 1990–2019")
        self.assertEqual(wall.locator(".focus-primary .chart-key").last.locator("circle").count(), 2)

        # Falkirk March includes a +0.007 mm member: show it at the same precision as the values.
        send({"cmd": "set", "month": 3, "region": {"kind": "council", "name": "Falkirk"}})
        self.wait(wall, lambda: ready("agreement", month=3, region="Falkirk"), "rounded near-zero member")
        self.assertEqual(wall.locator(".focus-primary .member-count strong").all_text_contents(), ["11", "1"])
        self.assertEqual(wall.locator(".focus-primary .member-count span").last.inner_text(), "of 12 show no change at 0.1 mm")
        send({"cmd": "set", "month": 7})
        self.wait(wall, lambda: ready("agreement", month=7), "return to July")

        phone.locator('.btn-member[data-member="07"]').click()
        phone.locator("#council-select").select_option("Midlothian")
        phone.locator('.btn-scene[data-scene="landscape"]').click()
        self.wait(wall, lambda: ready("landscape", member="07", region="Midlothian"), "member-specific landscape")
        baseline = json.loads((ROOT / "static/immersive/summaries/scenes-v1/mean.json").read_text())["regions"]["Midlothian"]
        member = json.loads((ROOT / "static/immersive/summaries/scenes-v1/member_07.json").read_text())["regions"]["Midlothian"]
        largest = max(baseline["landcover"], key=lambda c: baseline["landcover"][c]["weight"][6])
        expected = 100 * member["landcover"][largest]["below"]["2050-2079"][6] / baseline["landcover"][largest]["weight"][6]
        self.assertEqual(wall.locator(".focus-primary .insight-value").inner_text(), f"{expected:.1f}%")
        phone.reload()
        self.wait(wall, lambda: phone.locator('.btn-scene[data-scene="landscape"]').get_attribute("aria-pressed") == "true", "phone restores scene")
        wall.goto(BASE + "/immersive")
        self.wait(wall, lambda: ready("landscape", member="07", region="Midlothian"), "wall restores complete scene")
        self.assertEqual(wall.locator(".focus-primary .insight-value").inner_text(), f"{expected:.1f}%")

        phone.locator("#reset-region").click()
        phone.locator('.btn-member[data-member="mean"]').click()
        self.wait(wall, lambda: ready("landscape", member="mean", region="All Scotland"), "national reset")
        send({"cmd": "dwell", "seconds": 2})
        phone.locator("#btn-tour").click()
        self.wait(wall, lambda: ready("overview", month=1) and report()["state"]["playing"], "tour start")
        phone.goto("about:blank")
        cdp = wall.context.new_cdp_session(wall)
        cdp.send("HeapProfiler.collectGarbage")
        before = wall.evaluate("performance.memory.usedJSHeapSize")
        for index, scene in enumerate(["overview", "focus-heat", "focus-rain", "focus-water", "water-extent", "landscape", "agreement", "focus-water"]):
            month = 1 if index in [0, 7] else 7
            self.wait(wall, lambda: ready(scene, month=month) and report()["state"]["tourIndex"] == index, "tour chapter " + str(index + 1), 45)
            print("tour", index + 1, scene, flush=True)
        send({"cmd": "pause"})
        self.wait(wall, lambda: report()["state"]["playing"] is False, "tour pause")
        cdp.send("HeapProfiler.collectGarbage")
        after = wall.evaluate("performance.memory.usedJSHeapSize")
        self.assertLess(after, before + 80 * 1048576)
        self.assertEqual(self.errors, [])
        (self.artifacts / "scenes-flow.json").write_text(json.dumps({"scenes": records, "full_tour_without_phone": True,
            "member_region_reload": True, "heap_before_mb": round(before / 1048576, 1), "heap_after_mb": round(after / 1048576, 1), "errors": self.errors}, indent=2))

    def test_preview_isolation_failure_recovery_and_reproducible_url(self):
        for suffix, policy in [("/", "DENY"), ("/immersive", "DENY"), ("/immersive/control", "DENY"),
                               ("/immersive?preview=test", "SAMEORIGIN")]:
            with urllib.request.urlopen(BASE + suffix, timeout=15) as response:
                self.assertEqual(response.headers["X-Frame-Options"], policy)
                self.assertIn("frame-ancestors " + ("'self'" if policy == "SAMEORIGIN" else "'none'"), response.headers["Content-Security-Policy"])
        page = self.browser.new_context(viewport={"width": 1600, "height": 1000}).new_page()
        self.watch(page)
        relay_calls = []
        page.on("request", lambda request: relay_calls.append(request.url) if "/api/immersive/remote/" in request.url else None)
        page.goto(BASE + "/immersive/preview?width=15360&scene=focus-water&month=7")

        def ready(scene):
            return page.locator("#preview-status").get_attribute("data-status") == "ready" and page.locator("#scene-select").input_value() == scene

        self.wait(page, lambda: ready("focus-water"), "fitted preview")
        self.assertTrue(page.locator('#focus-control').is_hidden())
        self.assertEqual(page.locator('header p').count(), 0)
        frame = page.frame_locator("#wall-frame")
        self.assertEqual(frame.locator("body").evaluate("()=>[innerWidth,innerHeight,devicePixelRatio]"), [15360, 1200, 1])
        sentinel = '{"v":2,"month":3,"scene":"overview"}'
        page.evaluate("""value=>{localStorage.setItem('climascope-immersive-wall-v2',value);
          window.mainMessages=[];window.beacon=new BroadcastChannel('climascope-immersive');
          beacon.onmessage=e=>mainMessages.push(e.data);
          beacon.postMessage({type:'command',cmd:'set',month:12,scene:'overview'});} """, sentinel)
        page.wait_for_timeout(400)
        self.assertEqual(page.locator("#month-select").input_value(), "7")

        pattern = "**/static/immersive/summaries/scenes-v1/mean.json*"
        page.route(pattern, lambda route: route.fulfill(status=500, body="injected scene error"))
        page.select_option("#scene-select", "landscape")
        self.wait(page, lambda: page.locator("#preview-status").get_attribute("data-status") == "error", "scene failure")
        self.assertEqual(frame.locator("body").get_attribute("data-scene"), "focus-water")
        self.assertEqual(page.locator("#scene-select").input_value(), "focus-water")
        page.unroute(pattern)

        held = []
        page.route(pattern, lambda route: held.append(route))
        page.select_option("#scene-select", "water-extent")
        self.wait(page, lambda: len(held) == 1, "delayed scene request")
        page.select_option("#scene-select", "focus-heat")
        self.wait(page, lambda: ready("focus-heat"), "new scene wins")
        held[0].continue_()
        page.unroute(pattern)
        page.wait_for_timeout(400)
        self.assertEqual(frame.locator("body").get_attribute("data-scene"), "focus-heat")

        page.select_option("#scene-select", "landscape")
        self.wait(page, lambda: ready("landscape"), "scene retry")
        self.assertEqual(frame.locator(".focus-primary .insight-value").inner_text(), "73.8%")
        page.select_option("#member-select", "07")
        page.select_option("#council-select", "Midlothian")
        self.wait(page, lambda: ready("landscape") and "Midlothian" in page.locator("#preview-status").inner_text() and
                  "member=07" in page.url and "region=Midlothian" in page.url, "reproducible region/member link")
        saved_url = page.url
        page.reload()
        self.wait(page, lambda: ready("landscape") and page.locator("#council-select").input_value() == "Midlothian", "preview reload")
        self.assertEqual(page.url, saved_url)
        self.assertEqual(page.evaluate("localStorage.getItem('climascope-immersive-wall-v2')"), sentinel)
        self.assertEqual(relay_calls, [])
        page.select_option("#catchment-select", "Loch Huisinis : 100439")
        self.wait(page, lambda: ready("landscape") and "Loch Huisinis" in page.locator("#preview-status").inner_text(), "empty catchment")
        self.assertEqual(frame.locator(".focus-primary .insight-value").inner_text(), "—")
        self.assertIn("No mapped land cover", frame.locator(".focus-primary .chart-plot").last.inner_text())
        page.locator("#reset-region").click()
        page.select_option("#member-select", "mean")
        self.wait(page, lambda: ready("landscape") and "Scotland" in page.locator("#preview-status").inner_text() and
                  frame.locator(".focus-primary .insight-value").inner_text() == "73.8%" and
                  frame.locator(".num-value").first.inner_text() == "3.2 mm", "preview national reset")
        page.select_option("#wall-size", "11514")
        self.wait(page, lambda: frame.locator("body").evaluate("()=>innerWidth") == 11514, "open-mode viewport")
        for canvas in frame.locator(".mapcell:visible canvas").all():
            self.wait(page, lambda: self.has_climate_pixels(page, canvas), "resized national map paints", 20)
        self.assertEqual(self.errors, [])
        page.screenshot(path=str(self.artifacts / "live-preview.png"), full_page=True)
        (self.artifacts / "preview-flow.json").write_text(json.dumps({"viewport_sizes": [15360, 11514], "relay_calls": relay_calls,
            "preview_did_not_write_wall_state": True, "failed_scene_kept_previous_frame": True, "stale_scene_ignored": True,
            "share_link_reloaded": True, "empty_catchment": True, "all_three_visible_maps_painted_after_reset_and_resize": True,
            "errors": self.errors}, indent=2))


if __name__ == "__main__":
    unittest.main()
