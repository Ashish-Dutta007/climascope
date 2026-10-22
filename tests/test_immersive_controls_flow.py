"""Controller selection order and postcode scene guidance in a browser."""
import os
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ControllerFlows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright
        cls.pw = sync_playwright().start()
        options = {"headless": True, "args": ["--no-sandbox"]}
        if os.environ.get("CLIMASCOPE_CHROMIUM"):
            options["executable_path"] = os.environ["CLIMASCOPE_CHROMIUM"]
        cls.browser = cls.pw.chromium.launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.page = self.browser.new_page()
        self.page.set_default_timeout(5000)
        self.addCleanup(self.page.close)
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def mount(self, preview=False):
        template = "immersive_preview.html" if preview else "immersive_control.html"
        html = (ROOT / "templates" / template).read_text()
        html = re.sub(r"<script\b[^>]*>.*?</script>|<link\b[^>]*>", "", html, flags=re.S)
        url = "http://climascope.test/immersive/" + ("preview" if preview else "control")
        self.page.route("http://climascope.test/**", lambda route: route.fulfill(
            content_type="text/html", body=html if route.request.url == url else "<!doctype html>"))
        self.page.goto(url)
        self.page.evaluate("""() => {
          window.commands = [];
          window.geometryReplies = [];
          window.geometryRequests = [];
          window.ClimaScopeRemoteChannel = class {
            constructor() { window.channel = this; }
            postMessage(message) {
              if (message.type === 'command') commands.push(structuredClone(message));
            }
          };
          const location = {kind:'cell', id:42, name:'Selected postcode',
            longitude:-3.5, latitude:56.5, council:'Council B', catchment:'Catchment A'};
          window.ClimaScopeProfile = {get:async () => location};
          window.fetch = (url) => {
            let body;
            if (url === '/api/councils') body = {features:[{properties:{council_name:'Council B'},
              geometry:{type:'Polygon',coordinates:[[[-4,56],[-3,56],[-3,57],[-4,57],[-4,56]]]}}]};
            else if (url === '/api/catchments') body = [{name:'Catchment A',bbox:{west:-4,south:56,east:-3,north:57}}];
            else if (url.includes('/geometry')) {
              geometryRequests.push(url);
              return new Promise(resolve => geometryReplies.push(() => resolve({ok:true,json:async () => ({
                features:[{geometry:{type:'Polygon',coordinates:[[[-4,56],[-3,56],[-3,57],[-4,57],[-4,56]]]}}]
              })})));
            } else throw new Error('Unexpected request: ' + url);
            return Promise.resolve({ok:true,json:async () => body});
          };
          window.report = (region = {kind:null,name:'All Scotland'}) => ({
            type:'wall',status:'ready',state:{month:7,member:'mean',region,
              scene:region.kind === 'cell' ? 'local-climate' : 'overview',focus:'CWBPT',
              dwell:6,playing:false,playback:'months',places:[],placeIndex:0},
            shown:{month:7,member:'mean',region:region.name,
              scene:region.kind === 'cell' ? 'local-climate' : 'overview'}
          });
        }""")
        for script in ("scenes.js", "places.js", "preview.js" if preview else "control.js"):
            self.page.add_script_tag(path=str(ROOT / "static/immersive" / script))
        self.page.wait_for_function("document.querySelector('#catchment-select').options.length === 2")
        if not preview:
            self.page.evaluate("channel.onmessage({data:report()})")

    def release_geometry(self):
        self.page.evaluate("Promise.all(geometryReplies.map(reply => reply()))")
        self.page.evaluate("Promise.resolve()")

    def test_slow_catchment_cannot_replace_a_newer_council(self):
        self.mount()
        self.page.select_option("#catchment-select", "Catchment A")
        self.page.select_option("#council-select", "Council B")
        self.release_geometry()
        self.assertEqual(self.page.evaluate("commands.map(c => c.region.name)"), ["Catchment A", "Council B"])
        self.assertEqual(self.page.evaluate("geometryRequests"), [])
        self.assertEqual(self.errors, [])

    def test_slow_catchment_cannot_replace_reset(self):
        self.mount()
        self.page.select_option("#catchment-select", "Catchment A")
        self.page.click("#reset-region")
        self.release_geometry()
        self.assertEqual(self.page.evaluate("commands.map(c => c.region.name)"), ["Catchment A", "All Scotland"])
        self.assertEqual(self.errors, [])

    def test_slow_catchment_cannot_replace_a_newer_postcode(self):
        self.mount()
        self.page.select_option("#catchment-select", "Catchment A")
        self.page.fill("#remote-postcode", "AB1 2CD")
        self.page.locator("#remote-postcode-form").evaluate("form => form.requestSubmit()")
        self.page.wait_for_function("commands.some(c => c.region?.kind === 'cell')")
        self.release_geometry()
        self.assertEqual(self.page.evaluate("commands.map(c => c.region.name)"), ["Catchment A", "Selected postcode"])
        self.assertEqual(self.errors, [])

    def test_preview_explains_disabled_scenes_and_clears_guidance_for_areas(self):
        self.mount(preview=True)
        self.page.wait_for_function("document.querySelector('#wall-frame').contentDocument?.readyState === 'complete'")
        self.page.evaluate("""() => {
          const frame = document.querySelector('#wall-frame');
          window.receive = region => dispatchEvent(new MessageEvent('message', {
            origin:location.origin, source:frame.contentWindow,
            data:{type:'climascope-preview-report', token:new URL(frame.src).searchParams.get('preview'), report:report(region)}
          }));
          receive({kind:'cell',id:42,name:'Selected postcode',longitude:-3.5,latitude:56.5,council:'Council B'});
        }""")
        self.assertEqual(self.page.locator("#scene-description").inner_text(),
                         "Choose Catchment or Council to use the other scenes.")
        self.assertTrue(self.page.locator('#scene-select option[value="overview"]').evaluate("option => option.disabled"))
        self.page.evaluate("receive({kind:'council',name:'Council B'})")
        self.assertEqual(self.page.locator("#scene-description").inner_text(),
                         "Three climate metrics and current land cover.")
        self.assertFalse(self.page.locator('#scene-select option[value="overview"]').evaluate("option => option.disabled"))
        self.assertEqual(self.errors, [])


if __name__ == "__main__":
    unittest.main()
