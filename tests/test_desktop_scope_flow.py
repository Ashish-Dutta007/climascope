"""Desktop checks for drawn-area selection and shared climate controls."""
import os
import time
import unittest

BASE = os.environ.get('CLIMASCOPE_TEST_URL', '').rstrip('/')


@unittest.skipUnless(BASE, 'set CLIMASCOPE_TEST_URL to local staging')
class DesktopScopeFlows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright
        cls.pw = sync_playwright().start()
        options = dict(headless=True, args=[
            '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        ])
        if os.environ.get('CLIMASCOPE_CHROMIUM'):
            options['executable_path'] = os.environ['CLIMASCOPE_CHROMIUM']
        cls.browser = cls.pw.chromium.launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.page = self.browser.new_page(viewport={'width': 1440, 'height': 1000})
        self.addCleanup(self.page.close)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.goto(BASE + '/')
        self.page.click('#mode-dashboard')
        self.wait(lambda: self.page.locator('.cp-card').count() == 3, 'national climate')

    def tearDown(self):
        self.assertEqual(self.errors, [])

    def wait(self, predicate, label, seconds=90):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if predicate():
                return
            self.page.wait_for_timeout(150)
        self.fail('Timed out: ' + label)

    def test_climate_member_control_tracks_baseline_and_future(self):
        page = self.page
        page.select_option('#climate-member', '08')
        self.wait(lambda: 'Member 08' in page.locator('.cp-footnote').inner_text(), 'member 08')
        page.select_option('#climate-period', '1990-2019')
        self.wait(lambda: 'Ensemble mean' in page.locator('.cp-footnote').inner_text(), 'baseline mean')
        for selector in ('#member', '#climate-member'):
            self.assertTrue(page.locator(selector).is_disabled())
            self.assertEqual(page.locator(selector).input_value(), 'mean')
        page.select_option('#climate-period', '2050-2079')
        for selector in ('#member', '#climate-member'):
            self.assertTrue(page.locator(selector).is_enabled())
        page.select_option('#climate-member', '08')
        self.wait(lambda: 'Member 08' in page.locator('.cp-footnote').inner_text(), 'future member 08')
        self.assertEqual(page.locator('#member').input_value(), '08')

    def test_drawing_replaces_postcode_climate_and_can_return_to_the_location(self):
        page = self.page
        page.fill('#climate-postcode', 'AB15 8QH')
        page.click('#dash-climate button[type=submit]')
        self.wait(lambda: page.locator('.profile-heading h2').count() == 1 and
                  page.locator('.profile-heading h2').inner_text() == 'AB15 8QH' and
                  not page.locator('.profile-status').inner_text(), 'postcode climate')
        self.assertEqual(page.locator('.maplibregl-marker').count(), 1)
        feature = {'type': 'Feature', 'properties': {}, 'geometry': {
            'type': 'Polygon', 'coordinates': [[
                [-3.49, 56.37], [-3.45, 56.37], [-3.45, 56.39],
                [-3.49, 56.39], [-3.49, 56.37],
            ]],
        }}
        page.evaluate('''feature => document.dispatchEvent(new CustomEvent(
            'climascope:draw:complete', {detail:{feature}}))''', feature)
        self.wait(lambda: page.locator('.profile-heading').inner_text() == 'Drawn area', 'drawn area')
        self.assertEqual(page.locator('.cp-card').count(), 0)
        self.assertEqual(page.locator('.maplibregl-marker').count(), 0)
        self.assertEqual(page.locator('#dash-land-context').inner_text(), '')
        self.assertIn('Choose a location', page.locator('.profile-status').inner_text())
        self.wait(lambda: 'Drawn area' in page.locator('#kp-scope-label').inner_text(), 'drawn catchment shares')
        page.get_by_role('button', name='1 km cell', exact=True).click()
        self.wait(lambda: page.locator('.profile-heading h2').count() == 1 and
                  page.locator('.profile-heading h2').inner_text() == 'AB15 8QH', 'return to postcode')
        self.assertEqual(page.locator('.cp-card').count(), 3)
        self.assertEqual(page.locator('.maplibregl-marker').count(), 1)

    def test_land_pie_names_the_council_catchment_coverage(self):
        page = self.page
        page.select_option('#council', 'Perth and Kinross')
        page.click('#dash-tab-land')
        page.locator('.kp-var-btn[data-var="Farm Type"]').click()
        self.wait(lambda: page.locator('#dp-scope-name').inner_text() ==
                  'Catchments linked to Perth and Kinross', 'catchment composition')
        self.assertNotIn('exact', page.locator('#dp-source').inner_text())
        page.evaluate("""() => document.dispatchEvent(new CustomEvent(
            'climascope:variable', {detail:{variable:'LCM'}}))""")
        self.wait(lambda: page.locator('#dp-title').text_content().startswith('Land cover') and
                  page.locator('#dp-scope-name').inner_text() == 'Perth and Kinross', 'land-cover composition')
        self.assertEqual(page.locator('#dp-source').inner_text(), 'Source: UKCEH LCM · 1 km cell fractions')

    def test_slow_drawn_map_clears_postcode_cards_and_cannot_reframe_a_new_selection(self):
        page = self.page
        page.fill('#climate-postcode', 'AB15 8QH')
        page.click('#dash-climate button[type=submit]')
        self.wait(lambda: page.locator('.profile-heading h2').count() == 1 and
                  page.locator('.profile-heading h2').inner_text() == 'AB15 8QH' and
                  not page.locator('.profile-status').inner_text(), 'postcode climate')
        held = []
        page.route('**/api/aoi/features', lambda route: held.append(route))
        feature = {'type': 'Feature', 'properties': {}, 'geometry': {
            'type': 'Polygon', 'coordinates': [[
                [-3.49, 56.37], [-3.45, 56.37], [-3.45, 56.39],
                [-3.49, 56.39], [-3.49, 56.37],
            ]],
        }}
        page.evaluate('''feature => document.dispatchEvent(new CustomEvent(
            'climascope:draw:complete', {detail:{feature}}))''', feature)
        self.wait(lambda: bool(held), 'held drawn map request')
        self.assertEqual(page.locator('.profile-heading').inner_text(), 'Drawn area')
        self.assertEqual(page.locator('.cp-card').count(), 0)
        page.evaluate('''() => {
            window.scopeFits = [];
            const fit = maplibregl.Map.prototype.fitBounds;
            maplibregl.Map.prototype.fitBounds = function (...args) {
                scopeFits.push(args[0]);
                return fit.apply(this, args);
            };
        }''')
        page.select_option('#council', 'Fife')
        self.wait(lambda: page.locator('.profile-heading h2').count() == 1 and
                  page.locator('.profile-heading h2').inner_text() == 'Fife' and
                  not page.locator('.profile-status').inner_text(), 'new council climate')
        fits = page.evaluate('() => scopeFits')
        held[0].fulfill(status=200, content_type='application/json',
                        body='{"type":"FeatureCollection","features":[]}')
        page.wait_for_timeout(400)
        self.assertEqual(page.evaluate('() => scopeFits'), fits)
        self.assertEqual(page.locator('.profile-heading h2').inner_text(), 'Fife')

    def test_postcodes_keep_their_cell_outline_and_council_context(self):
        page = self.page
        page.evaluate('''() => {
            const fit = maplibregl.Map.prototype.fitBounds;
            maplibregl.Map.prototype.fitBounds = function (...args) {
                window.selectedMap = this;
                return fit.apply(this, args);
            };
        }''')
        # A postcode inside a catchment and one outside must behave alike,
        # including revisiting a previous postcode and searching from the map.
        for postcode, council, search in (
            ('AB15 8QH', 'Aberdeen City', 'dashboard'),
            ('PH2 7HP', 'Perth and Kinross', 'dashboard'),
            ('AB15 8QH', 'Aberdeen City', 'map'),
            ('HS1 2BW', 'Na h-Eileanan Siar', 'dashboard'),
        ):
            with self.subTest(postcode=postcode, search=search):
                if search == 'dashboard':
                    page.fill('#climate-postcode', postcode)
                    page.click('#dash-climate button[type=submit]')
                else:
                    page.fill('#search-input', postcode)
                    page.get_by_role('option', name=postcode, exact=False).click()
                self.wait(lambda: page.locator('.profile-heading h2').count() and
                          page.locator('.profile-heading h2').inner_text() == postcode and
                          not page.locator('.profile-status').inner_text(), postcode)
                location = page.request.get(BASE + '/api/location', params={'postcode':postcode}).json()
                self.wait(lambda: page.evaluate('''geometry =>
                    JSON.stringify(selectedMap.getSource('climate-cell')._data.geometry) ===
                    JSON.stringify(geometry)''', location['geometry']), 'current outline')
                self.assertEqual(page.locator('#council').input_value(), council)
                self.assertEqual(page.locator('#catchment').input_value(), '')
                self.assertEqual(page.get_by_role('button', name='1 km cell', exact=True).get_attribute('aria-pressed'), 'true')
                self.assertIn(postcode, page.locator('.legend-selection').inner_text())
                self.wait(lambda: 'Context mean' in page.locator('#legend').inner_text(), 'map context')
                self.assertIn('Map context: ' + council, page.locator('#legend').inner_text())
                page.wait_for_timeout(700)  # includes delayed dashboard resizes
                view = page.evaluate('''location => {
                    const map = selectedMap, canvas = map.getCanvas();
                    const points = [...location.geometry.coordinates[0], [location.longitude, location.latitude]];
                    return {moving:map.isMoving(), zoom:map.getZoom(),
                        visible:points.every(point => { const p=map.project(point);
                            return p.x>0 && p.x<canvas.clientWidth && p.y>0 && p.y<canvas.clientHeight; })};
                }''', location)
                self.assertFalse(view['moving'])
                self.assertTrue(view['visible'])
                self.assertGreater(view['zoom'], 11)
        self.assertIn('Nearest 1 km climate cell', page.locator('.profile-heading').inner_text())

    def test_late_catchment_boundary_cannot_replace_a_postcode_council(self):
        page = self.page
        page.fill('#climate-postcode', 'AB15 8QH')
        page.click('#dash-climate button[type=submit]')
        self.wait(lambda: page.locator('.profile-heading h2').count() and
                  page.locator('.profile-heading h2').inner_text() == 'AB15 8QH', 'postcode')
        held = []
        page.route('**/api/catchments/*/geometry', lambda route: held.append(route))
        page.get_by_role('button', name='Catchment', exact=True).click()
        self.wait(lambda: bool(held), 'held boundary')
        page.get_by_role('button', name='1 km cell', exact=True).click()
        self.wait(lambda: page.locator('#catchment').input_value() == '', 'cell council context')
        page.evaluate('''() => {
            const resize = maplibregl.Map.prototype.resize;
            maplibregl.Map.prototype.resize = function (...args) {
                window.selectedMap=this; return resize.apply(this,args);
            };
        }''')
        page.dispatch_event('#dash-tab-climate', 'click')
        self.wait(lambda: page.evaluate('() => !!window.selectedMap'), 'map resize')
        for route in held:
            route.fulfill(json={'type':'FeatureCollection','features':[{
                'type':'Feature','properties':{},'geometry':{'type':'Point','coordinates':[0,0]}
            }]})
        page.wait_for_timeout(300)
        data = page.evaluate("() => selectedMap.getSource('catchment-boundary')._data")
        self.assertEqual(data['features'], [])

    def test_future_cwr_explains_its_missing_grid_for_catchment_and_drawn_area(self):
        page = self.page
        grid_requests = []
        page.on('request', lambda request: grid_requests.append(request.url)
                if '/api/aoi/features' in request.url or '/api/catchments/' in request.url
                and '/features?' in request.url else None)
        page.select_option('#catchment', 'Hol Burn : 23244')
        page.click('#layer-group-climate > summary')
        page.click('.metric-card[data-id="CWRPT"]')
        self.wait(lambda: page.locator('#map-unavail-msg').count() == 1, 'catchment CWR explanation')
        self.assertIn('Land & catchments', page.locator('#map-unavail-msg').inner_text())
        self.assertFalse(any('metric=CWRPT' in url for url in grid_requests))
        page.select_option('#period', '1990-2019')
        self.wait(lambda: page.locator('#map-unavail-msg').count() == 0 and
                  any('metric=CWRPT' in url for url in grid_requests), 'observed CWR grid request')
        page.select_option('#period', '2050-2079')
        self.wait(lambda: page.locator('#map-unavail-msg').count() == 1, 'future CWR explanation')
        grid_requests.clear()
        feature = {'type': 'Feature', 'properties': {}, 'geometry': {
            'type': 'Polygon', 'coordinates': [[
                [-2.17, 57.12], [-2.14, 57.12], [-2.14, 57.14],
                [-2.17, 57.14], [-2.17, 57.12],
            ]],
        }}
        page.evaluate('''feature => document.dispatchEvent(new CustomEvent(
            'climascope:draw:complete', {detail:{feature}}))''', feature)
        self.wait(lambda: page.locator('.profile-heading').inner_text() == 'Drawn area', 'drawn CWR area')
        self.assertEqual(page.locator('#map-unavail-msg').count(), 1)
        self.assertFalse(grid_requests)
        page.click('#dash-tab-land')
        self.wait(lambda: page.locator('#kp-metric-echo').inner_text() == 'CWRPT' and
                  page.locator('#kp-body canvas').count() == 1, 'catchment CWR chart remains available')


if __name__ == '__main__':
    unittest.main()
