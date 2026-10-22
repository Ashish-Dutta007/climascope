"""Local-map extent, chart zeros and plain error messages."""
import json
import os
from pathlib import Path
import subprocess
import unittest

from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
NODE = ROOT / 'venv/lib/python3.12/site-packages/playwright/driver/node'


class LocalMapExtent(unittest.TestCase):
    def test_extent_keeps_the_cell_and_coastal_point_with_local_context(self):
        inverse = Transformer.from_crs(27700, 4326, always_xy=True)
        forward = Transformer.from_crs(4326, 27700, always_xy=True)
        cases = []
        for east, north, offset in ((350000, 720000, 500), (440000, 1140000, 1800)):
            corners = [inverse.transform(east+x, north+y) for x,y in ((0,0),(1000,0),(1000,1000),(0,1000),(0,0))]
            cases.append({'geometry': {'type':'Polygon', 'coordinates':[corners]},
                          'point': inverse.transform(east+offset, north+500)})
        script = r'''
          const fs=require('fs'),vm=require('vm');
          const ctx={window:{},proj4:require('./static/immersive/vendor/proj4-2.22.0.js')};
          vm.runInNewContext(fs.readFileSync('./static/immersive/locator.js','utf8'),ctx);
          const cases=JSON.parse(fs.readFileSync(0,'utf8'));
          process.stdout.write(JSON.stringify(cases.map(item =>
            ctx.window.ClimaScopeLocator.contextBounds(item.geometry,item.point,1500))));
        '''
        result = subprocess.run([str(NODE), '-e', script], cwd=ROOT, text=True,
                                input=json.dumps(cases), capture_output=True, check=True)
        for case, bounds in zip(cases, json.loads(result.stdout)):
            (west,south),(east,north) = bounds
            for lon,lat in [case['point'], *case['geometry']['coordinates'][0]]:
                self.assertTrue(west < lon < east and south < lat < north)
            projected = [forward.transform(lon,lat) for lon in (west,east) for lat in (south,north)]
            width = max(p[0] for p in projected)-min(p[0] for p in projected)
            height = max(p[1] for p in projected)-min(p[1] for p in projected)
            self.assertTrue(3900 < width < 6500, width)
            self.assertTrue(3900 < height < 6500, height)


class ProfileDisplay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright
        cls.pw = sync_playwright().start()
        options = {'headless':True, 'args':['--no-sandbox']}
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
        self.page.set_content('<main></main>')
        self.page.add_script_tag(path=str(ROOT / 'static/js/climate_profile.js'))
        self.page.evaluate('''() => {
          const values={'1990-2019':Array(12).fill(0), '2020-2049':Array(12).fill(0),
            '2050-2079':Array(12).fill(.03)};
          const metric={label:'Precipitation', units:'mm', values,
            member_changes:{'2050-2079':{'01':Array(12).fill(-1),'08':Array(12).fill(-2)}}};
          window.data={kind:'cell',member:'mean',source:'30-year monthly averages',metrics:{
            Tmax_mean:{...metric,label:'Mean daily maximum temperature',units:'°C'},
            Prec_sum:metric,CWBPT:{...metric,label:'Water balance'},ETPT_sum:metric}};
          ClimaScopeProfile.render(document.querySelector('main'),data,{month:7});
        }''')

    def test_zero_rainfall_has_no_visible_bar(self):
        heights = self.page.locator('[data-metric="Prec_sum"] svg rect[fill]').evaluate_all(
            'nodes => nodes.map(node => Number(node.getAttribute("height")))')
        self.assertEqual(heights[:24], [0]*24)
        self.assertTrue(all(height > 0 for height in heights[24:]))
        self.assertEqual(self.page.locator('[data-metric="Prec_sum"] h4').inner_text(), 'Mean monthly totals')

    def test_small_change_and_member_counts_read_without_empty_counts(self):
        self.assertEqual(self.page.locator('[data-metric="Prec_sum"] .cp-caption').inner_text(),
                         'July: less than 0.1 mm change from 1990–2019 to 2050–2079.')
        text = self.page.locator('[data-metric="Prec_sum"] .cp-spread').inner_text()
        self.assertIn('2 of 2 members lower', text)
        self.assertNotIn('0 of', text)
        self.assertNotIn('members higher', text)

    def test_html_proxy_error_is_reported_as_a_load_error(self):
        result = self.page.evaluate('''async () => {
          window.fetch=async () => ({status:503,ok:false,json:async () => {throw new SyntaxError('Unexpected token <')}});
          try {await ClimaScopeProfile.get('/api/climate/profile');}
          catch(error) {return {message:error.message,status:error.status};}
        }''')
        self.assertEqual(result, {'message':'Could not load climate data. Try again.', 'status':503})


if __name__ == '__main__':
    unittest.main()
