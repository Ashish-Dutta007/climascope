"""Wall context views, source-aligned SVG bars and recovery after a CWR error."""
import json
import unittest
import urllib.request

from tests import test_immersive_scenes_flow as scene_tools
BASE, ROOT = scene_tools.BASE, scene_tools.ROOT


@unittest.skipUnless(BASE, "set CLIMASCOPE_TEST_URL to local staging")
class ContextFlows(unittest.TestCase):
    setUp = scene_tools.SceneFlows.setUp
    tearDown = scene_tools.SceneFlows.tearDown
    watch = scene_tools.SceneFlows.watch
    wait = scene_tools.SceneFlows.wait
    has_climate_pixels = scene_tools.SceneFlows.has_climate_pixels

    def test_context_maps_areas_classes_and_recovery(self):
        page=self.browser.new_context(viewport={"width":1800,"height":1000}).new_page()
        self.watch(page)
        calls=[]
        page.on('request',lambda r:calls.append(r.url))
        page.goto(BASE+'/immersive/preview?scene=overview&width=11514&month=7')
        frame=page.frame_locator('#wall-frame')
        def ready(scene):
            return page.locator('#preview-status').get_attribute('data-status')=='ready' and frame.locator('body').get_attribute('data-scene')==scene
        self.wait(page,lambda:ready('overview'),'overview with cover',120)
        cover=json.loads((ROOT/'static/immersive/summaries/landcover-v1.json').read_text())
        with urllib.request.urlopen(BASE+'/api/immersive/cwr?scope=national&member=mean',timeout=120) as r: cwr=json.load(r)
        records=[]
        for width in [11514,15360]:
            page.select_option('#wall-size',str(width))
            self.wait(page,lambda:frame.locator('body').evaluate('()=>innerWidth')==width,'wall size')
            for scene in ['overview','landscape','water-classes']:
                page.select_option('#scene-select',scene)
                self.wait(page,lambda:ready(scene),scene,120)
                self.assertEqual(frame.locator('.mapcell:visible').count(),{'overview':10,'landscape':4,'water-classes':0}[scene])
                overflow=frame.locator('.context-panel:visible,.chart-head:visible').evaluate_all('''es=>es.filter(e=>e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2).map(e=>e.className)''')
                self.assertEqual(overflow,[])
                if scene=='water-classes':
                    self.assertEqual(page.locator('#member-select option').first.inner_text(),'Mean class areas')
                    self.assertEqual(frame.locator('.cwr-period').count(),3)
                    for period,items in cwr['periods'].items():
                        panel=frame.locator('.cwr-period[data-period="'+period+'"]')
                        bars=panel.locator('.cwr-months rect[data-class]').evaluate_all('es=>es.map(e=>({month:+e.dataset.month,cls:+e.dataset.class,value:+e.dataset.areaKm2,h:+e.getAttribute("height")}))')
                        self.assertEqual(len(bars),48)
                        for bar in bars:
                            item=items[bar['month']-1]
                            value=item['classes_km2'][bar['cls']]
                            self.assertAlmostEqual(bar['value'],value,places=6)
                            self.assertAlmostEqual(bar['h'],285*value/item['total_km2'],places=6)
                    self.assertIn('Mean class areas · 12 members',frame.locator('.cwr-key').inner_text())
                    self.assertTrue(frame.locator('.cwr-land-use svg').evaluate_all('es=>es.every(svg=>[...svg.querySelectorAll("text")].every(t=>t.getBBox().y>=0))'))
                    self.assertTrue(frame.locator('.cwr-land-use svg').evaluate_all('''es=>es.every(svg=>{
                      const bars=[...svg.querySelectorAll('rect')];
                      const last=Math.max(...bars.map(r=>+r.getAttribute('y') + +r.getAttribute('height')));
                      const axis=[...svg.querySelectorAll('text')].find(t=>t.textContent==='0');
                      return axis.getBBox().y>=last+8;
                    })'''))
                else:
                    values=frame.locator('.area-plot [data-cover]').evaluate_all('es=>es.map(e=>[+e.dataset.cover,+e.dataset.areaKm2])')
                    for code,value in values: self.assertAlmostEqual(value,cover['regions']['national']['areas_km2'][code-1],places=6)
                    self.assertTrue(self.has_climate_pixels(page,frame.locator('#map-landcover canvas')))
                page.screenshot(path=str(self.artifacts/f'{scene}-{width}-preview.png'))
                records.append({'width':width,'scene':scene,'maps':frame.locator('.mapcell:visible').count(),'overflow':overflow})
        # Changing month reuses the annual class payload and performs no grid query.
        before=len([u for u in calls if '/api/immersive/cwr?' in u or '/api/immersive_values?' in u])
        page.select_option('#month-select','10')
        self.wait(page,lambda:ready('water-classes') and frame.locator('.cwr-month-title').first.inner_text()=='CWR PT · Oct by land use','CWR month')
        after=len([u for u in calls if '/api/immersive/cwr?' in u or '/api/immersive_values?' in u])
        self.assertEqual(before,after)
        page.select_option('#member-select','08')
        self.wait(page,lambda:ready('water-classes') and 'Member 08' in frame.locator('.cwr-key').inner_text(),'CWR member',120)
        page.select_option('#council-select','Angus')
        self.wait(page,lambda:ready('water-classes') and 'Catchments linked to Angus' in frame.locator('.cwr-key').inner_text(),'CWR council',120)
        # A failed target must keep the previous class chart and its context.
        page.route('**/api/immersive/cwr?*',lambda route:route.fulfill(status=503,content_type='application/json',body='{}'))
        page.select_option('#council-select','Fife')
        self.wait(page,lambda:page.locator('#preview-status').get_attribute('data-status')=='error','CWR error')
        self.assertIn('Catchments linked to Angus',frame.locator('.cwr-key').inner_text())
        self.assertEqual(page.locator('#council-select').input_value(),'Angus')
        page.unroute('**/api/immersive/cwr?*')
        page.select_option('#scene-select','landscape')
        self.wait(page,lambda:ready('landscape'),'back to climate maps',120)
        self.assertEqual(page.locator('#member-select option').first.inner_text(),'Ensemble mean')
        self.assertIn('Angus',frame.locator('.area-total').inner_text())
        for code,value in frame.locator('.area-plot [data-cover]').evaluate_all('es=>es.map(e=>[+e.dataset.cover,+e.dataset.areaKm2])'):
            self.assertAlmostEqual(value,cover['regions']['council:Angus']['areas_km2'][code-1],places=6)
        self.assertIn('maximum temperature',frame.locator('[data-metric="Tmax_mean"] .chart-name').first.inner_text())
        # Capture the new content at native size, below Chromium's 8192px limit.
        wall=self.browser.new_context(viewport={'width':11514,'height':1200}).new_page()
        self.watch(wall)
        wall.goto(BASE+'/immersive?preview=native-context&fresh=1&scene=water-classes&month=7')
        self.wait(wall,lambda:'Mean class areas' in wall.locator('.cwr-key').inner_text(),'native CWR',120)
        wall.locator('.cwr-panel').screenshot(path=str(self.artifacts/'cwr-native.png'))
        self.assertEqual(self.errors,[])
        (self.artifacts/'context-flow.json').write_text(json.dumps({'views':records,'svg_values_match_source':True,'member_and_region_follow_selection':True,'month_reuses_class_payload':True,'error_preserves_previous_frame':True,'errors':self.errors},indent=2))


if __name__=='__main__': unittest.main()
