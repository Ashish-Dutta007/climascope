"""Opt-in checks for the light/dark page theme on local staging."""
import os
import time
import unittest

BASE = os.environ.get("CLIMASCOPE_TEST_URL", "").rstrip("/")
THEME = """() => ({theme: document.documentElement.dataset.theme,
  basemap: (document.querySelector('input[name=basemap]:checked') || {}).value,
  sidebar: getComputedStyle(document.getElementById('sidebar')).backgroundColor})"""


@unittest.skipUnless(BASE, "set CLIMASCOPE_TEST_URL to a staging server")
class ThemeFlows(unittest.TestCase):
    def setUp(self):
        from playwright.sync_api import sync_playwright
        self.pw = sync_playwright().start()
        args = {"headless": True, "args": ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]}
        if os.environ.get("CLIMASCOPE_CHROMIUM"):
            args["executable_path"] = os.environ["CLIMASCOPE_CHROMIUM"]
        self.browser = self.pw.chromium.launch(**args)
        self.errors = []

    def tearDown(self):
        self.browser.close()
        self.pw.stop()

    def wait(self, page, predicate, label, seconds=60):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            if predicate():
                return
            page.wait_for_timeout(200)
        self.fail("Timed out: " + label)

    def open(self, scheme):
        page = self.browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme=scheme).new_page()
        page.on("pageerror", lambda e: self.errors.append(str(e)))
        page.goto(BASE + "/")
        self.wait(page, lambda: page.evaluate(THEME)["basemap"] is not None, "page ready")
        return page

    def test_follows_the_device_until_switched_and_remembers_the_choice(self):
        dark = self.open("dark")
        self.assertEqual(dark.evaluate(THEME), {"theme": "dark", "basemap": "dark", "sidebar": "rgb(17, 24, 39)"})
        page = self.open("light")
        self.assertEqual(page.evaluate(THEME), {"theme": "light", "basemap": "light", "sidebar": "rgb(248, 249, 251)"})
        self.assertIn("Dark", page.locator("#theme-toggle").inner_text())
        page.click("#theme-toggle")
        self.wait(page, lambda: page.evaluate(THEME)["basemap"] == "dark", "dark basemap")
        self.assertEqual(page.evaluate(THEME)["theme"], "dark")
        page.reload()
        self.wait(page, lambda: page.evaluate(THEME)["basemap"] == "dark", "remembered dark")
        page.click("#theme-toggle")
        self.wait(page, lambda: page.evaluate(THEME)["basemap"] == "light", "light again")
        self.assertEqual(self.errors, [])

    def test_page_still_works_in_dark_if_the_proxy_refuses_theme_js(self):
        page = self.browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme="light").new_page()
        page.on("pageerror", lambda e: self.errors.append(str(e)))
        page.route("**/static/js/theme.js*", lambda route: route.fulfill(status=429, body="Too Many Requests"))
        page.goto(BASE + "/")
        page.click("#mode-dashboard")
        self.wait(page, lambda: page.locator("#dash-climate .cp-card").count() == 3, "climate cards without theme.js")
        page.click("#dash-tab-land")
        self.wait(page, lambda: page.locator("#kp-body canvas").count() == 1, "land-use chart without theme.js")
        self.assertEqual(page.evaluate(THEME)["sidebar"], "rgb(17, 24, 39)")
        self.assertEqual(page.locator("#theme-toggle").count(), 0)
        self.assertEqual(self.errors, [])

    def test_wall_stays_dark_on_a_light_device(self):
        page = self.browser.new_context(viewport={"width": 1920, "height": 1200}, color_scheme="light").new_page()
        page.goto(BASE + "/immersive?fresh=1&scene=local-climate&month=7")
        self.wait(page, lambda: page.locator("#local-climate .cp-period").count() >= 3, "local climate cards")
        self.assertIsNone(page.evaluate("document.documentElement.dataset.theme || null"))
        self.assertEqual(page.locator("#local-climate .cp-period").first.evaluate("e => getComputedStyle(e).color"), "rgb(167, 196, 232)")


if __name__ == "__main__":
    unittest.main()
