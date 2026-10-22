"""Browser checks for member changes, redraws and out-of-order chart replies."""
import os
from pathlib import Path
import unittest
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
CLASSES = ['Strong Deficit', 'Moderate Deficit', 'Moderate Surplus', 'Strong Surplus']


class CatchmentChartFlows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright
        cls.pw = sync_playwright().start()
        options = dict(headless=True, args=['--no-sandbox'])
        if os.environ.get('CLIMASCOPE_CHROMIUM'):
            options['executable_path'] = os.environ['CLIMASCOPE_CHROMIUM']
        cls.browser = cls.pw.chromium.launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.page = self.browser.new_page()
        self.addCleanup(self.page.close)
        self.page.set_content('<div id="panel"></div>')
        self.page.evaluate('''() => {
          window.state = {scope:'national', metric:'CWRPT', month:7,
            period:'2050-2079', member:'01', aoiCells:null};
          window.pending = [];
          window.fetch = (url, options = {}) => {
            if (url === '/api/landcover') return Promise.resolve({json: async () => []});
            if (url === '/api/habitat') return Promise.resolve({json: async () => ({classes:[]})});
            // Let aborted requests finish too: a reply may already be arriving.
            return new Promise(resolve => pending.push({url, options, resolve}));
          };
          window.Chart = class {
            static defaults = {plugins:{legend:{labels:{}}}};
            constructor(context, config) { this.data = config.data; }
            destroy() {}
            update() {}
          };
        }''')

    def create(self, pie=False):
        self.page.add_script_tag(path=str(ROOT / 'static/js' / ('dashboard.js' if pie else 'catchment_panel.js')))
        name = 'DashboardPie' if pie else 'CatchmentPanel'
        self.page.evaluate(f"window.panel = new {name}(document.querySelector('#panel'), () => state)")

    def change(self, **values):
        self.page.evaluate('(values) => { Object.assign(state, values); panel.onMapStateChange(state); }', values)

    def reply(self, index, label='Current', value=100, status=200):
        data = {'rows': [{'type': label, 'total_ha': value,
                         'classes': {name: value if i == 0 else 0 for i, name in enumerate(CLASSES)}}]}
        if status != 200:
            data = {'error': label}
        self.page.evaluate('''({index, data, status}) => {
          pending[index].resolve({ok:status === 200, status, json:async () => data});
        }''', dict(index=index, data=data, status=status))

    def test_member_change_requests_and_shows_the_selected_member(self):
        self.create()
        self.change(member='01')
        self.change(member='08')
        requests = self.page.evaluate('pending.map(p => p.url)')
        self.assertEqual([parse_qs(urlsplit(url).query)['member'][0] for url in requests], ['01', '08'])
        self.reply(1)
        self.page.wait_for_function("panel._chart?.data.labels[0] === 'Current'")
        self.reply(0, label='Old')
        self.assertEqual(self.page.evaluate('panel._chart.data.labels'), ['Current'])
        self.assertEqual(self.page.locator('#kp-member-echo').inner_text(), 'Member 08')

    def test_returning_to_an_earlier_selection_ignores_its_old_reply_and_error(self):
        self.create()
        for member in ('01', '08', '01'):
            self.change(member=member)
        self.reply(2)
        self.page.wait_for_function("panel._chart?.data.labels[0] === 'Current'")
        self.reply(0, label='Old')
        self.reply(1, label='Old error', status=503)
        self.assertEqual(self.page.evaluate('panel._chart.data.labels'), ['Current'])
        self.assertNotIn('Old error', self.page.locator('#panel').inner_text())

    def test_redrawing_the_same_cell_count_loads_the_new_area(self):
        self.create()
        self.change(scope='aoi', aoiCells=[1, 2])
        self.change(aoiCells=[3, 4])
        self.assertEqual(self.page.evaluate('pending.map(p => JSON.parse(p.options.body).aoi_ids)'), [[1, 2], [3, 4]])
        self.reply(1)
        self.page.wait_for_function("panel._chart?.data.labels[0] === 'Current'")
        self.reply(0, label='Old error', status=503)
        self.assertEqual(self.page.evaluate('panel._chart.data.labels'), ['Current'])

    def test_failed_comparison_shows_an_error_and_can_retry(self):
        self.create()
        self.page.evaluate('panel.compareMode = true; void panel._fetch()')
        for index in (0, 1, 3):
            self.reply(index)
        self.reply(2, label='Missing member data', status=503)
        self.page.wait_for_function("document.querySelector('#kp-body').textContent.includes('Missing member data')")
        self.assertIsNone(self.page.evaluate('panel.lastFetchKey'))
        self.change(member='mean')
        for index in range(4, 8):
            self.reply(index)
        self.page.wait_for_function("document.querySelectorAll('.kp-compare-group').length === 1")
        requests = self.page.evaluate('pending.slice(4).map(p => p.url)')
        self.assertTrue(all(parse_qs(urlsplit(url).query)['member'] == ['mean'] for url in requests))
        self.assertIn('Mean class areas', self.page.locator('#kp-member-echo').inner_text())

    def test_comparison_includes_types_present_only_in_a_later_period(self):
        self.create()
        self.page.evaluate('panel.compareMode = true; void panel._fetch()')
        for index in range(4):
            self.reply(index, label='New cover' if index == 3 else 'Existing cover')
        self.page.wait_for_function("document.querySelectorAll('.kp-compare-group').length === 2")
        self.assertEqual(set(self.page.locator('.kp-type-name').all_text_contents()), {'Existing cover', 'New cover'})
        self.assertEqual(self.page.locator('.kp-cg-period').all_text_contents()[:4],
                         ['1960–1989', '1990–2019', '2020–2049', '2050–2079'])

    def test_html_proxy_errors_have_plain_messages_in_both_charts(self):
        for pie, selector, expected in ((False, '#kp-body', 'Could not load catchment data.'),
                                         (True, '#dp-empty', 'Could not load land composition.')):
            with self.subTest(pie=pie):
                self.create(pie=pie)
                self.change(scope='national')
                self.page.evaluate('''() => pending.at(-1).resolve({ok:false,status:502,
                  json:async () => {throw new SyntaxError('Unexpected token <');}})''')
                self.page.wait_for_function('''({selector, expected}) =>
                  document.querySelector(selector).textContent.includes(expected)''',
                  arg={'selector':selector, 'expected':expected})
                self.assertNotIn('Unexpected token', self.page.locator(selector).inner_text())

    def test_land_composition_redraw_and_variable_change_keep_the_aoi(self):
        self.create(pie=True)
        self.change(scope='aoi', aoiCells=[1, 2])
        self.change(aoiCells=[3, 4])
        self.page.evaluate("document.dispatchEvent(new CustomEvent('climascope:variable', {detail:{variable:'Farm Type'}}))")
        requests = self.page.evaluate('pending.map(p => ({url:p.url, body:JSON.parse(p.options.body)}))')
        self.assertEqual(len(requests), 3)
        self.assertTrue(all(item['url'] == '/api/landuse_composition' for item in requests))
        self.assertEqual(requests[-1]['body'], {'aoi_ids':[3, 4], 'variable':'Farm Type'})
        self.page.evaluate("pending[2].resolve({ok:true,json:async () => ({Current:100})})")
        self.page.wait_for_function("panel._chart?.data.labels[0] === 'Current'")
        self.page.evaluate("pending[0].resolve({ok:true,json:async () => ({Old:100})})")
        self.assertEqual(self.page.evaluate('panel._chart.data.labels'), ['Current'])
        self.assertEqual(self.page.locator('#dp-scope-name').inner_text(), 'AOI (2 cells)')


if __name__ == '__main__':
    unittest.main()
