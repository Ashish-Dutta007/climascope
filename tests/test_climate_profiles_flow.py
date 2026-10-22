"""Opt-in browser checks for postcode profiles and the paired wall control."""
import json
import os
from pathlib import Path
import time
import unittest
import urllib.request
from urllib.parse import parse_qs, urlsplit, urlencode

BASE = os.environ.get('CLIMASCOPE_TEST_URL', '').rstrip('/')


@unittest.skipUnless(BASE, 'set CLIMASCOPE_TEST_URL to local staging')
class ProfileFlows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright
        cls.pw = sync_playwright().start()
        args = dict(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        if os.environ.get('CLIMASCOPE_CHROMIUM'):
            args['executable_path'] = os.environ['CLIMASCOPE_CHROMIUM']
        cls.browser = cls.pw.chromium.launch(**args)
        cls.artifacts = Path(os.environ.get('CLIMASCOPE_BROWSER_ARTIFACTS', '/tmp/climascope-profile-tests'))
        cls.artifacts.mkdir(parents=True, exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def wait(self, page, predicate, label, seconds=90):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if predicate():
                return
            page.wait_for_timeout(150)
        self.fail('Timed out: ' + label)

    def test_dashboard_tabs_location_scope_and_stale_response(self):
        context = self.browser.new_context(viewport={'width':1440,'height':1000})
        page = context.new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE + '/')
        page.click('#mode-dashboard')
        self.wait(page, lambda: page.locator('.profile-heading h2').count() == 1, 'national climate')
        page.fill('#climate-postcode', 'PH2 7HP')
        page.click('#dash-climate button[type=submit]')
        self.wait(page, lambda: page.locator('.profile-heading h2').inner_text() == 'PH2 7HP' and not page.locator('#dash-climate .profile-status').inner_text(), 'postcode cell')
        page.locator('#month').evaluate("e=>{e.value=7;e.dispatchEvent(new Event('input',{bubbles:true}));}")
        self.wait(page, lambda: 'July: 5.3 °C higher' in page.locator('#dash-climate').inner_text(), 'July data')
        self.assertIn('5 of 12 members higher · 7 lower', page.locator('#dash-climate').inner_text())
        self.assertIn('24.5', page.locator('#dash-climate [data-metric="Tmax_mean"] .cp-values').inner_text())
        page.screenshot(path=str(self.artifacts/'dashboard-location.png'))
        page.click('#dash-tab-land')
        self.assertTrue(page.locator('#dash-bottom').is_visible())
        self.assertFalse(page.locator('#dash-climate').is_visible())
        self.assertIn('PH2 7HP', page.locator('#dash-land-context').inner_text())
        self.assertIn('Perth and Kinross', page.locator('#dash-land-context').inner_text())
        page.wait_for_timeout(300)
        self.assertLessEqual(page.locator('#dash-bottom').evaluate('e=>e.getBoundingClientRect().bottom'),1001)
        page.click('#dash-tab-climate')
        page.get_by_role('button', name='Council', exact=True).click()
        self.wait(page, lambda: page.locator('.profile-heading h2').inner_text() == 'Perth and Kinross', 'council climate')
        page.get_by_role('button', name='This location', exact=True).click()
        self.wait(page, lambda: page.locator('.profile-heading h2').inner_text() == 'PH2 7HP', 'return to cell')
        page.select_option('#climate-member','07')
        self.wait(page, lambda: 'Member 07' in page.locator('.cp-footnote').inner_text(), 'selected member')
        # A delayed older scope must never replace a more recent selection.
        page.route('**/api/climate/profile?*', lambda route: (time.sleep(.4), route.continue_()))
        page.select_option('#council','Fife')
        page.select_option('#council','Angus')
        self.wait(page, lambda: page.locator('.profile-heading h2').count() and page.locator('.profile-heading h2').inner_text() == 'Angus', 'latest council')
        page.unroute('**/api/climate/profile?*')
        # Searching from the map also selects climate data, rather than only flying.
        page.fill('#search-input','PH2 7HP')
        page.get_by_role('option', name='PH2 7HP', exact=False).click()
        self.wait(page, lambda: page.locator('.profile-heading h2').inner_text() == 'PH2 7HP', 'map search selects profile')
        page.fill('#climate-postcode','bad')
        page.click('#dash-climate button[type=submit]')
        self.wait(page, lambda: 'full UK postcode' in page.locator('#dash-climate .profile-status').inner_text(), 'invalid postcode')
        self.assertEqual(page.locator('.profile-heading h2').inner_text(), 'PH2 7HP')
        page.fill('#climate-postcode','AB15 8QH')
        page.click('#dash-climate button[type=submit]')
        self.wait(page, lambda: page.locator('.profile-heading h2').inner_text() == 'AB15 8QH', 'second postcode')
        page.get_by_role('button',name='Catchment',exact=True).click()
        self.wait(page, lambda: page.locator('.profile-heading h2').inner_text() == 'Hol Burn : 23244', 'postcode catchment')
        page.get_by_role('button',name='This location',exact=True).click()
        self.wait(page, lambda: page.locator('.profile-heading h2').inner_text() == 'AB15 8QH', 'return from catchment')
        page.locator('#map').click(position={'x':650,'y':180})
        self.wait(page, lambda: page.locator('.profile-heading h2').inner_text() == 'Selected location', 'map click selects climate profile')
        page.set_viewport_size({'width':390,'height':844})
        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),390)
        self.assertEqual(errors, [])
        context.close()

    def test_remote_local_scene_playback_reload_and_preview_isolation(self):
        wall_context = self.browser.new_context(viewport={'width':11514,'height':1200})
        phone_context = self.browser.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True)
        wall, phone = wall_context.new_page(), phone_context.new_page()
        errors = []; calls = []
        wall.on('pageerror',lambda e: errors.append(str(e)))
        phone.on('pageerror',lambda e: errors.append(str(e)))
        wall.on('request',lambda r: calls.append(r.url))
        wall.goto(BASE + '/immersive?fresh=1&scene=local-climate&month=7')
        self.wait(wall, lambda: wall.locator('#local-climate .cp-card').count() == 3, 'local national view')
        self.assertFalse(any('/api/immersive_values' in url for url in calls))
        wall.get_by_role('button', name='Phone remote', exact=True).click()
        self.wait(wall, lambda: wall.locator('.remote-code').count() and len(wall.locator('.remote-code').inner_text().replace(' ','')) == 8, 'pairing code')
        phone.goto(BASE + '/immersive/control')
        phone.fill('#remote-code', wall.locator('.remote-code').inner_text())
        phone.get_by_role('button', name='Connect', exact=True).click()
        self.wait(phone, lambda: phone.evaluate("!!sessionStorage.getItem('climascope-phone-remote-controller')"), 'paired controller')
        credentials = phone.evaluate("JSON.parse(sessionStorage.getItem('climascope-phone-remote-controller'))")
        url = BASE + '/api/immersive/remote/rooms/' + credentials['room'] + '/messages'
        def report():
            with urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization':'Bearer '+credentials['token']}), timeout=10) as response:
                return json.load(response).get('report') or {}
        def ready(month=7, member='mean', name='PH2 7HP', scene='local-climate'):
            r = report(); shown = r.get('shown') or {}
            return r.get('status') == 'ready' and all(shown.get(k) == v for k,v in {'month':month,'member':member,'region':name,'scene':scene}.items())
        wall.get_by_role('button', name='Hide', exact=True).click()
        phone.fill('#remote-postcode','PH2 7HP')
        phone.click('#remote-postcode-form button[type=submit]')
        self.wait(wall, ready, 'phone search changes wall')
        with urllib.request.urlopen(BASE + '/api/location?lon=-3.436785&lat=56.378874',timeout=30) as response:
            nearby = json.load(response)
        nearby['name'] = 'PH2 0AL'
        held = []
        phone.route('**/api/location?postcode=PH20AL',lambda route:held.append(route))
        phone.fill('#remote-postcode','PH20AL')
        phone.click('#remote-postcode-form button[type=submit]')
        self.wait(phone,lambda:len(held)==1,'remote lookup held')
        phone.get_by_role('button',name='Council',exact=True).click()
        self.wait(wall,lambda:ready(name='Perth and Kinross'),'remote council supersedes lookup')
        held.pop().fulfill(status=200,content_type='application/json',body=json.dumps(nearby))
        phone.wait_for_timeout(1500)
        self.assertTrue(ready(name='Perth and Kinross'),'late postcode must not replace a manual council selection')
        phone.unroute('**/api/location?postcode=PH20AL')
        phone.get_by_role('button',name='This location',exact=True).click()
        self.wait(wall,ready,'return to confirmed postcode')
        for width in (11514,15360):
            wall.set_viewport_size({'width':width,'height':1200})
            wall.wait_for_timeout(400)
            dimensions = wall.locator('#local-climate').evaluate('e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,height:e.clientHeight,scroll:e.scrollHeight}}')
            self.assertLessEqual(dimensions['scroll'], dimensions['height'] + 2, dimensions)
            self.assertAlmostEqual(dimensions['left'], width-dimensions['right'],delta=2)
            for sector in ('.local-place','.local-content','.near-comparison'):
                wall.locator(sector).screenshot(path=str(self.artifacts/f'wall-local-{width}-{sector[1:]}.png'))
        self.assertTrue(phone.locator('#btn-tour').is_disabled())
        phone.click('.btn-month[data-month="12"]')
        self.wait(wall, lambda: ready(month=12), 'December')
        phone.click('#btn-next')
        self.wait(wall, lambda: ready(month=1), 'December to January')
        phone.click('.btn-member[data-member="07"]')
        self.wait(wall, lambda: ready(month=1,member='07'), 'member changes local figures')
        phone.select_option('#dwell-select','4')
        phone.click('#btn-annual')
        self.wait(wall,lambda:ready(month=2,member='07'),'local month loop')
        phone.click('#btn-play')
        self.wait(wall,lambda:not report().get('state',{}).get('playing',True),'paused')
        # Reload without fresh=1 restores the location and selected member.
        wall.goto(BASE + '/immersive')
        # The relay still holds the pre-reload report, so also wait for the new page.
        place = wall.locator('#local-climate .local-place')
        self.wait(wall,lambda:ready(month=2,member='07') and place.count() and place.locator('h1').inner_text() == 'PH2 7HP'
                  and place.locator('p').first.inner_text() == 'Feb · Member 07','location restored')
        # An unavailable target retains the previous frame and pauses.
        wall.route('**/api/climate/profile?*',lambda route:route.fulfill(status=503,content_type='application/json',body='{"error":"Test outage"}'))
        phone.click('.btn-member[data-member="01"]')
        self.wait(wall,lambda:report().get('status')=='error','injected outage')
        self.assertEqual(wall.locator('#local-climate h1').inner_text(),'PH2 7HP')
        self.assertFalse(report()['state']['playing'])
        wall.unroute('**/api/climate/profile?*')
        phone.get_by_role('button',name='Council',exact=True).click()
        self.wait(wall,lambda:ready(month=2,member='07',name='Perth and Kinross'),'council profile recovery')
        phone.click('.btn-scene[data-scene="focus-water"]')
        self.wait(wall,lambda:ready(month=2,member='07',name='Perth and Kinross',scene='focus-water'),'return to climate maps',120)
        self.assertTrue(wall.locator('#panels').is_visible())
        self.assertFalse(wall.locator('#local-climate').is_visible())
        self.assertEqual(wall.locator('.mapcell:visible').count(),6)
        preview = self.browser.new_page(viewport={'width':1440,'height':1000})
        preview.goto(BASE + '/immersive/preview?scene=local-climate&month=7')
        preview.fill('#preview-postcode','PH2 7HP')
        preview.click('#preview-postcode-form button[type=submit]')
        self.wait(preview,lambda:preview.locator('#preview-status').get_attribute('data-status')=='ready' and 'PH2 7HP' in preview.locator('#preview-status').inner_text(),'isolated postcode preview')
        preview.click('.places-save')
        self.wait(preview,lambda:preview.locator('.places-list li').count()==1,'preview saved place')
        self.assertEqual(report()['state']['places'],[])
        self.assertTrue(ready(month=2,member='07',name='Perth and Kinross',scene='focus-water'))
        held = []
        preview.route('**/api/location?postcode=PH20AL',lambda route:held.append(route))
        preview.fill('#preview-postcode','PH20AL'); preview.click('#preview-postcode-form button[type=submit]')
        self.wait(preview,lambda:len(held)==1,'preview lookup held')
        preview.select_option('#council-select','Fife')
        self.wait(preview,lambda:preview.locator('#preview-status').get_attribute('data-status')=='ready' and 'Fife' in preview.locator('#preview-status').inner_text(),'preview council supersedes lookup')
        held.pop().fulfill(status=200,content_type='application/json',body=json.dumps(nearby))
        preview.wait_for_timeout(1000)
        self.assertIn('Fife',preview.locator('#preview-status').inner_text())
        preview.unroute('**/api/location?postcode=PH20AL')
        preview.get_by_role('button',name='This location',exact=True).click()
        self.wait(preview,lambda:'PH2 7HP' in preview.locator('#preview-status').inner_text() and preview.locator('#preview-status').get_attribute('data-status')=='ready','preview confirmed postcode')
        copied = preview.url
        preview.goto(copied)
        self.wait(preview,lambda:'PH2 7HP' in preview.locator('#preview-status').inner_text(),'shared local preview URL')
        self.assertEqual(errors,[])
        preview.close(); phone_context.close(); wall_context.close()

    def test_divider_bars_and_postcode_selection_timing(self):
        locations = {}
        for postcode, lon, lat in [('PH2 7HP',-3.422055,56.402953), ('PH2 0AL',-3.436785,56.378874)]:
            with urllib.request.urlopen(BASE + f'/api/location?lon={lon}&lat={lat}',timeout=30) as response:
                location = json.load(response)
            location['name'] = postcode
            locations[postcode.replace(' ','')] = location
        context = self.browser.new_context(viewport={'width':1440,'height':1000})
        page = context.new_page(); errors = []; calls = []; held = []; hold = [False]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('request',lambda r:calls.append(r.url))
        def lookup(route):
            code = parse_qs(urlsplit(route.request.url).query)['postcode'][0].upper().replace(' ','')
            if hold[0]:
                held.append((route, locations[code]))
            else:
                route.fulfill(status=200,content_type='application/json',body=json.dumps(locations[code]))
        page.route('**/api/location?postcode=*',lookup)
        page.goto(BASE + '/')
        page.click('#mode-dashboard')
        self.wait(page,lambda:page.locator('.profile-heading h2').count()==1,'initial climate')
        area = page.locator('#map-area'); divider = page.locator('#dash-splitter')
        self.assertAlmostEqual(area.bounding_box()['height'],550,delta=2)
        divider.focus(); page.keyboard.press('ArrowUp')
        self.wait(page,lambda:abs(area.bounding_box()['height']-500)<2,'keyboard resize')
        handle = divider.bounding_box()
        page.mouse.move(handle['x']+handle['width']/2,handle['y']+handle['height']/2)
        page.mouse.down(); page.mouse.move(handle['x']+handle['width']/2,handle['y']-134,steps=10); page.mouse.up()
        self.wait(page,lambda:area.bounding_box()['height']<390,'drag resize')
        self.wait(page,lambda:abs(page.locator('#map canvas').bounding_box()['height']-area.bounding_box()['height'])<2,'map canvas follows divider')
        split = area.bounding_box()['height']
        page.reload(); page.click('#mode-dashboard')
        self.assertAlmostEqual(area.bounding_box()['height'],split,delta=2)
        page.select_option('#climate-month','7')
        for search in ('dashboard','map'):
            for code in ('PH2 7HP','PH2 0AL','PH2 7HP'):
                before = len(calls)
                if search == 'dashboard':
                    page.fill('#climate-postcode',code)
                    page.click('#dash-climate button[type=submit]')
                else:
                    page.fill('#search-input',code)
                    page.get_by_role('option',name=code,exact=False).click()
                cell_id = locations[code.replace(' ','')]['id']
                self.wait(page,lambda:page.locator('.profile-heading h2').inner_text()==code and
                          not page.locator('#dash-climate .profile-status').inner_text(),'cell '+code)
                self.assertEqual(page.get_by_role('button',name='This location',exact=True).get_attribute('aria-pressed'),'true')
                self.assertEqual(page.locator('#council').input_value(),'Perth and Kinross')
                self.assertTrue(page.locator('#map .maplibregl-marker').is_visible())
                profile_scopes = [parse_qs(urlsplit(url).query)['scope'][0] for url in calls[before:] if '/api/climate/profile?' in url]
                self.assertTrue(all(scope == f'cell:{cell_id}' for scope in profile_scopes),profile_scopes)
                self.assertLessEqual(len(profile_scopes),1,profile_scopes)
        rain = page.locator('#dash-climate [data-metric="Prec_sum"] svg')
        self.assertEqual(rain.locator('rect[fill]').count(),36)
        self.assertTrue(all('.0' not in label for label in rain.locator('text').all_text_contents()))
        self.assertEqual(page.locator('#dash-climate [data-metric="Tmax_mean"] svg circle').count(),3)
        # Updating the month must not discard an independent postcode lookup.
        hold[0] = True
        page.fill('#climate-postcode','PH2 0AL'); page.click('#dash-climate button[type=submit]')
        self.wait(page,lambda:len(held)==1,'held postcode')
        page.select_option('#climate-month','8')
        self.assertEqual(page.locator('#dash-climate .profile-status').inner_text(),'Finding location…')
        route, location = held.pop(); route.fulfill(status=200,content_type='application/json',body=json.dumps(location))
        self.wait(page,lambda:page.locator('.profile-heading h2').inner_text()=='PH2 0AL','lookup survives month update')
        # A deliberate area selection supersedes an earlier postcode search.
        page.fill('#climate-postcode','PH2 7HP'); page.click('#dash-climate button[type=submit]')
        self.wait(page,lambda:len(held)==1,'second held postcode')
        page.select_option('#council','Fife')
        self.wait(page,lambda:page.locator('.profile-heading h2').inner_text()=='Fife','manual area selection')
        route, location = held.pop(); route.fulfill(status=200,content_type='application/json',body=json.dumps(location))
        page.wait_for_timeout(500)
        self.assertEqual(page.locator('.profile-heading h2').inner_text(),'Fife')
        self.assertEqual(page.locator('#council').input_value(),'Fife')
        self.assertFalse(page.locator('#dash-climate').evaluate("e=>e.classList.contains('cp-loading')"))
        self.assertEqual(errors,[])
        context.close()


    def test_nearby_comparisons_and_saved_place_loop(self):
        locations = []
        for label, lon, lat in [('PH2 7HP',-3.422055,56.402953),('AB15 8QH',-2.158335,57.133332)]:
            with urllib.request.urlopen(BASE + f'/api/location?lon={lon}&lat={lat}',timeout=30) as response:
                place = json.load(response)
            place['name'] = label; locations.append(place)
        wall_context = self.browser.new_context(viewport={'width':11514,'height':1200})
        phone_context = self.browser.new_context(viewport={'width':390,'height':844})
        wall, phone = wall_context.new_page(), phone_context.new_page()
        errors = []
        wall.on('pageerror',lambda e:errors.append(str(e)))
        phone.on('pageerror',lambda e:errors.append(str(e)))
        wall.goto(BASE + '/immersive?fresh=1&scene=local-climate&month=7')
        self.wait(wall,lambda:wall.locator('.cp-card').count()==3,'initial profile')
        wall.get_by_role('button',name='Phone remote',exact=True).click()
        self.wait(wall,lambda:wall.locator('.remote-code').count() and len(wall.locator('.remote-code').inner_text().replace(' ',''))==8,'pair code')
        phone.goto(BASE + '/immersive/control')
        phone.fill('#remote-code',wall.locator('.remote-code').inner_text())
        phone.get_by_role('button',name='Connect',exact=True).click()
        self.wait(phone,lambda:phone.evaluate("!!sessionStorage.getItem('climascope-phone-remote-controller')"),'phone connection')
        credentials = phone.evaluate("JSON.parse(sessionStorage.getItem('climascope-phone-remote-controller'))")
        url = BASE + '/api/immersive/remote/rooms/' + credentials['room'] + '/messages'
        def report():
            with urllib.request.urlopen(urllib.request.Request(url,headers={'Authorization':'Bearer '+credentials['token']}),timeout=10) as response:
                return json.load(response).get('report') or {}
        def ready(name):
            r=report()
            return r.get('status') in ('ready','warning') and r.get('shown',{}).get('region')==name
        def show(place):
            # Use the paired phone, with geocoding fixed to an actual point fixture.
            phone.route('**/api/location?postcode=*',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps(place)))
            phone.fill('#remote-postcode',place['name']);phone.click('#remote-postcode-form button[type=submit]')
            self.wait(wall,lambda:ready(place['name']),'show '+place['name'])
            phone.unroute('**/api/location?postcode=*')
        for place in locations:
            show(place)
            scopes = ['cell:'+str(place['id'])] + [kind+':'+place[kind] for kind in ('catchment','council') if place.get(kind)]
            self.assertEqual(wall.locator('.near-area-key > div').count(),len(scopes))
            for scope in scopes:
                with urllib.request.urlopen(BASE+'/api/climate/profile?'+urlencode({'scope':scope,'member':'mean'}),timeout=30) as response:
                    data=json.load(response)
                for metric in ('Tmax_mean','Prec_sum','CWBPT'):
                    values=data['metrics'][metric]['values']; expected=values['2050-2079'][6]-values['1990-2019'][6]
                    actual=wall.locator('.near-metric[data-metric="'+metric+'"] [data-scope="'+scope+'"]').get_attribute('data-value')
                    self.assertAlmostEqual(float(actual),expected,places=8)
            self.assertEqual(wall.locator('.near-map canvas').count(),1)
            self.assertEqual(wall.locator('.near-map').get_attribute('data-cell'),str(place['id']))
            self.assertAlmostEqual(float(wall.locator('.near-map').get_attribute('data-longitude')),place['longitude'])
            self.assertAlmostEqual(float(wall.locator('.near-map').get_attribute('data-latitude')),place['latitude'])
            for width in (11514,15360):
                wall.set_viewport_size({'width':width,'height':1200});wall.wait_for_timeout(300)
                bounds=wall.locator('#local-climate').evaluate('e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,height:e.clientHeight,scroll:e.scrollHeight,children:[...e.children].map(c=>c.getBoundingClientRect().bottom)}}')
                self.assertLessEqual(bounds['scroll'],bounds['height']+2,bounds)
                self.assertAlmostEqual(bounds['left'],width-bounds['right'],delta=2)
                self.assertLessEqual(max(bounds['children']),1200-56-56+2,bounds)
            self.wait(phone,lambda:phone.locator('.places-save').is_enabled(),'place can be saved')
            phone.click('.places-save')
            self.wait(phone,lambda:phone.locator('.places-list li').count()==locations.index(place)+1,'saved place')
            self.assertTrue(phone.locator('.places-save').is_disabled())
        # Area and cell data update together for a selected member and month.
        phone.click('.btn-member[data-member="07"]');phone.click('.btn-month[data-month="8"]')
        self.wait(wall,lambda:ready('AB15 8QH') and report()['shown']['member']=='07' and report()['shown']['month']==8,'member and month comparison')
        self.assertIn('Aug change',wall.locator('.near-period').inner_text())
        self.assertIn('Member 07',wall.locator('.near-method').inner_text())
        wall.locator('.near-comparison').screenshot(path=str(self.artifacts/'nearby-comparison.png'))
        # The wall owns the place loop; month remains fixed and the phone can close.
        phone.select_option('#dwell-select','4');phone.click('.places-play')
        self.wait(wall,lambda:ready('PH2 7HP') and report()['state']['playback']=='places','place loop start')
        phone.close()
        self.wait(wall,lambda:ready('AB15 8QH') and report()['state']['placeIndex']==1,'place loop continues without phone')
        self.assertEqual(report()['shown']['month'],8)
        wall.goto(BASE+'/immersive')
        self.wait(wall,lambda:ready('AB15 8QH') and report()['state']['playing'],'place loop resumes after reload')
        # Pausing through the relay keeps the displayed place.
        request=urllib.request.Request(url,data=json.dumps({'nonce':'pause-places-0001','message':{'type':'command','cmd':'pause'}}).encode(),headers={'Authorization':'Bearer '+credentials['token'],'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=10) as response:
            self.assertEqual(response.status,200)
        self.wait(wall,lambda:not report()['state']['playing'],'pause place loop')
        before=wall.locator('.near-comparison').inner_text()
        # An area comparison outage must not mix a new place with old area figures.
        def area_outage(route):
            scope=parse_qs(urlsplit(route.request.url).query)['scope'][0]
            if scope.startswith('council:'):
                route.fulfill(status=503,content_type='application/json',body='{"error":"Comparison test outage"}')
            else:
                route.continue_()
        wall.route('**/api/climate/profile?*',area_outage)
        place=locations[0]
        request=urllib.request.Request(url,data=json.dumps({'nonce':'resume-places-0001','message':{'type':'command','cmd':'play'}}).encode(),headers={'Authorization':'Bearer '+credentials['token'],'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=10) as response: self.assertEqual(response.status,200)
        self.wait(wall,lambda:report().get('status')=='error','comparison outage')
        self.assertEqual(wall.locator('.local-place h1').inner_text(),'AB15 8QH')
        self.assertEqual(wall.locator('.near-comparison').inner_text(),before)
        self.assertEqual(report()['state']['placeIndex'],1)
        self.assertFalse(report()['state']['playing'])
        wall.unroute('**/api/climate/profile?*')
        # Reject a comparison assembled from a different source version too.
        with urllib.request.urlopen(BASE+'/api/climate/profile?'+urlencode({'scope':'council:Perth and Kinross','member':'01'}),timeout=30) as response:
            wrong_version=json.load(response)
        wrong_version['data_version']='test-old-source'
        def mismatched_area(route):
            if parse_qs(urlsplit(route.request.url).query)['scope'][0].startswith('council:'):
                route.fulfill(status=200,content_type='application/json',body=json.dumps(wrong_version))
            else:
                route.continue_()
        wall.route('**/api/climate/profile?*',mismatched_area)
        request=urllib.request.Request(url,data=json.dumps({'nonce':'new-place-0001','message':{'type':'command','cmd':'set','member':'01','region':place}}).encode(),headers={'Authorization':'Bearer '+credentials['token'],'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=10) as response:self.assertEqual(response.status,200)
        self.wait(wall,lambda:'rebuilt together' in report().get('message',''),'mixed source versions')
        self.assertEqual(wall.locator('.near-comparison').inner_text(),before)
        wall.unroute('**/api/climate/profile?*')
        request=urllib.request.Request(url,data=json.dumps({'nonce':'retry-place-0001','message':{'type':'command','cmd':'set','member':'01','region':place}}).encode(),headers={'Authorization':'Bearer '+credentials['token'],'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=10) as response:self.assertEqual(response.status,200)
        self.wait(wall,lambda:ready('PH2 7HP') and report()['shown']['member']=='01','comparison recovers after source versions agree')
        # Removing a saved place uses its identity, not an index that may have moved.
        remove={'type':'command','cmd':'remove-place','placeKey':str(place['id'])+'@'+format(place['longitude'],'.6f')+','+format(place['latitude'],'.6f')}
        request=urllib.request.Request(url,data=json.dumps({'nonce':'remove-place-0001','message':remove}).encode(),headers={'Authorization':'Bearer '+credentials['token'],'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=10) as response: self.assertEqual(response.status,200)
        self.wait(wall,lambda:len(report()['state']['places'])==1,'saved place removal')
        self.assertEqual(report()['state']['placeIndex'],0)
        # Remove the remaining saved place too.
        place=locations[1]
        remove['placeKey']=str(place['id'])+'@'+format(place['longitude'],'.6f')+','+format(place['latitude'],'.6f')
        request=urllib.request.Request(url,data=json.dumps({'nonce':'remove-place-0002','message':remove}).encode(),headers={'Authorization':'Bearer '+credentials['token'],'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=10) as response:self.assertEqual(response.status,200)
        self.wait(wall,lambda:not report()['state']['places'],'last saved place removal')
        self.assertEqual(report()['state']['playback'],'months')
        self.assertEqual(errors,[])
        phone_context.close();wall_context.close()


if __name__ == '__main__':
    unittest.main()
