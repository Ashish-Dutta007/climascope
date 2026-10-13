"""Opt-in integration check against a running, data-backed staging app.

Uses real MapLibre, vector tiles, climate Parquets and independent wall/phone
browser contexts. No CSP bypass. Run with CLIMASCOPE_TEST_URL set.
"""
import json
import os
from pathlib import Path
import time
import unittest
import urllib.request


BASE = os.environ.get("CLIMASCOPE_TEST_URL", "").rstrip("/")


@unittest.skipUnless(BASE, "set CLIMASCOPE_TEST_URL to a staging server")
class ImmersivePhoneFlow(unittest.TestCase):
    def test_open_wall(self):
        self.flow(11514, full=True)

    def test_wrap_wall(self):
        self.flow(15360, full=False)

    def flow(self, width, full):
        from playwright.sync_api import sync_playwright

        def wait(predicate, label, seconds=45):
            until = time.monotonic() + seconds
            while time.monotonic() < until:
                if predicate():
                    return
                # Pump Playwright callbacks too (notably injected route failures).
                wall.wait_for_timeout(200)
            self.fail("Timed out: " + label)

        errors, checks = [], []
        with sync_playwright() as p:
            options = {"headless": True, "args": ["--no-sandbox", "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-precise-memory-info"]}
            if os.environ.get("CLIMASCOPE_CHROMIUM"):
                options["executable_path"] = os.environ["CLIMASCOPE_CHROMIUM"]
            browser = p.chromium.launch(**options)
            wall_context = browser.new_context(viewport={"width": width, "height": 1200}, ignore_https_errors=True)
            phone_context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, ignore_https_errors=True)
            wall, phone = wall_context.new_page(), phone_context.new_page()
            wall.on("pageerror", lambda e: errors.append(str(e)))
            phone.on("pageerror", lambda e: errors.append(str(e)))
            concurrent = {"current": 0, "max": 0}

            def start(request):
                if "/api/immersive_values?" in request.url:
                    concurrent["current"] += 1
                    concurrent["max"] = max(concurrent["max"], concurrent["current"])

            def finish(request):
                if "/api/immersive_values?" in request.url:
                    concurrent["current"] -= 1

            wall.on("request", start)
            wall.on("requestfinished", finish)
            wall.on("requestfailed", finish)
            try:
                wall.goto(BASE + "/immersive?fresh=1&scene=overview")
                wait(lambda: "July" in wall.locator(".ctx-sel").first.inner_text() and
                     not wall.locator(".ctx-chip").first.inner_text(), "initial real-data frame")
                self.assertEqual(wall.locator("canvas").count(), 9)
                self.assertEqual(wall.locator(".num-value").all_text_contents(),
                    ["3.2 mm", "−3.7 mm", "−24.9 mm", "94.5 mm", "94.8 mm", "82.3 mm", "16.4 °C", "19.1 °C", "21.1 °C"])
                checks.append("real July data, nine maps, six charts")

                wall.get_by_role("button", name="Phone remote", exact=True).click()
                wait(lambda: len(wall.locator(".remote-code").inner_text().replace(" ", "")) == 8, "wall pairing code")
                code = wall.locator(".remote-code").inner_text()
                phone.goto(BASE + "/immersive/control")
                phone.locator("#remote-code").fill(code)
                phone.get_by_role("button", name="Connect", exact=True).click()
                wait(lambda: phone.evaluate("!!sessionStorage.getItem('climascope-phone-remote-controller')"), "phone session")
                credentials = phone.evaluate("JSON.parse(sessionStorage.getItem('climascope-phone-remote-controller'))")

                def packet():
                    req = urllib.request.Request(BASE + "/api/immersive/remote/rooms/" + credentials["room"] + "/messages",
                        headers={"Authorization": "Bearer " + credentials["token"]})
                    with urllib.request.urlopen(req, timeout=10) as r:
                        return json.load(r)

                def report():
                    return packet().get("report") or {}

                def ready(month=None, region=None, member=None):
                    r = report()
                    return r.get("status") == "ready" and all(value is None or (r.get("shown") or {}).get(key) == value
                        for key, value in [("month", month), ("region", region), ("member", member)])

                wait(lambda: ready(7), "phone sees existing wall frame")
                self.assertIn("July", phone.locator(".remote-status").inner_text())
                wall.get_by_role("button", name="Hide", exact=True).click()
                checks.append("pairing does not reset the wall")

                phone.locator('.btn-month[data-month="8"]').click()
                wait(lambda: ready(8), "August via phone")
                wait(lambda: "August" in phone.locator(".remote-status").inner_text(), "phone render confirmation")
                self.assertIn("August", wall.locator(".ctx-sel").first.inner_text())
                checks.append("phone month command and displayed confirmation")

                phone.locator("#council-select").select_option("Midlothian")
                wait(lambda: ready(8, "Midlothian"), "council via phone")
                baseline = wall.locator(".num-value").first.inner_text()
                future = wall.locator(".num-value").nth(2).inner_text()
                phone.locator('.btn-member[data-member="07"]').click()
                wait(lambda: ready(8, "Midlothian", "07"), "member via phone")
                self.assertEqual(wall.locator(".num-value").first.inner_text(), baseline)
                self.assertNotEqual(wall.locator(".num-value").nth(2).inner_text(), future)
                checks.append("region/member commands and member-consistent values")

                phone.reload()
                wait(lambda: phone.locator('.btn-month[data-month="8"]').evaluate("e=>e.classList.contains('active')"), "phone refresh mirrors month")
                wait(lambda: phone.locator("#council-select").input_value() == "Midlothian", "phone refresh mirrors region")
                self.assertEqual(phone.locator("#member-grid .active").get_attribute("data-member"), "07")
                self.assertLessEqual(phone.evaluate("document.documentElement.scrollWidth"), 390)
                checks.append("phone refresh, state restoration and mobile fit")

                if full:
                    phone.locator("#reset-region").click()
                    wait(lambda: ready(8, "All Scotland", "07"), "reset Scotland")
                    phone.locator('.btn-member[data-member="mean"]').click()
                    wait(lambda: ready(8, "All Scotland", "mean"), "ensemble mean")
                    phone.locator('.btn-month[data-month="12"]').click()
                    wait(lambda: ready(12), "December")
                    phone.locator("#dwell-select").select_option("4")
                    wait(lambda: report().get("state", {}).get("dwell") == 4, "phone dwell command")
                    phone.locator("#btn-play").click()
                    wait(lambda: report().get("state", {}).get("playing"), "phone play command")
                    phone.goto("about:blank")
                    wait(lambda: ready(1), "Dec to Jan with no controller page running", seconds=25)
                    checks.append("wall-owned playback and annual reset without controller")
                    phone.goto(BASE + "/immersive/control")
                    wait(lambda: "Pause" in phone.locator("#btn-play").inner_text(), "phone resumes playback status")
                    phone.locator("#btn-play").click()
                    wait(lambda: report().get("state", {}).get("playing") is False, "phone pause command")
                    for month in [2, 3, 4, 5]:
                        phone.locator('.btn-month[data-month="' + str(month) + '"]').click()
                        time.sleep(.1)
                    wait(lambda: ready(5), "latest rapid phone selection")
                    self.assertLessEqual(concurrent["max"], 1)
                    checks.append("rapid commands retain one climate request in flight")

                    wall.route("**/api/immersive_values?month=10*", lambda route: route.fulfill(status=500, body="test failure"))
                    phone.locator('.btn-month[data-month="10"]').click()
                    wait(lambda: report().get("status") == "error", "injected data error")
                    r = report()
                    self.assertEqual(r["shown"]["month"], 5)
                    self.assertFalse(r["state"]["playing"])
                    self.assertIn("May", wall.locator(".ctx-sel").first.inner_text())
                    wall.unroute("**/api/immersive_values?month=10*")
                    checks.append("failure keeps last displayed frame and pauses")

                    # ?fresh=1 intentionally ignores saved state; ordinary kiosk
                    # reloads use the normal URL when checking restoration.
                    wall.goto(BASE + "/immersive")
                    wait(lambda: "May" in wall.locator(".ctx-sel").first.inner_text() and ready(5), "wall reload preserves selection and session")
                    checks.append("wall refresh retains remote session and shown state")

                    # Pair a second independent phone and verify explicit takeover.
                    wall.get_by_role("button", name="New code", exact=True).click()
                    wait(lambda: len(wall.locator(".remote-code").inner_text().replace(" ", "")) == 8, "replacement code")
                    new_code = wall.locator(".remote-code").inner_text()
                    second_context = browser.new_context(viewport={"width":390,"height":844}, ignore_https_errors=True)
                    second = second_context.new_page()
                    second.goto(BASE + "/immersive/control")
                    second.locator("#remote-code").fill(new_code)
                    second.get_by_role("button", name="Connect", exact=True).click()
                    wait(lambda: not second.locator(".remote-disconnect").evaluate("e=>e.hidden"), "second phone pairs")
                    wait(lambda: not phone.locator(".remote-pair-form").evaluate("e=>e.hidden"), "old phone revoked")
                    wait(lambda: second.locator('.btn-month[data-month="5"]').evaluate("e=>e.classList.contains('active')"), "second phone mirrors wall")
                    credentials = second.evaluate("JSON.parse(sessionStorage.getItem('climascope-phone-remote-controller'))")
                    second.locator('.btn-month[data-month="6"]').click()
                    wait(lambda: ready(6), "second phone controls wall")
                    checks.append("second phone takeover revokes first phone")
                    second_context.close()

                self.assertEqual(errors, [])
                checks.append("no uncaught browser exceptions")
                artifacts = os.environ.get("CLIMASCOPE_BROWSER_ARTIFACTS")
                if artifacts:
                    out = Path(artifacts)
                    out.mkdir(parents=True, exist_ok=True)
                    (out / ("flow_" + str(width) + ".json")).write_text(json.dumps({"width":width,"height":1200,"checks":checks}, indent=2) + "\n")
                    if not full:
                        phone.screenshot(path=str(out / "phone-integrated.png"), full_page=True)
                        wall.locator(".group").first.screenshot(path=str(out / "wall-group-integrated.png"))
                print(str(width) + " × 1200: " + "; ".join(checks), flush=True)
            finally:
                browser.close()


if __name__ == "__main__":
    unittest.main()
