"""Theme changes must preserve the selected scope and pending profile state."""
import os
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ThemeDashboardState(unittest.TestCase):
    def test_theme_switch_keeps_drawn_area_and_pending_area_selection(self):
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            options = dict(headless=True, args=['--no-sandbox'])
            if os.environ.get('CLIMASCOPE_CHROMIUM'):
                options['executable_path'] = os.environ['CLIMASCOPE_CHROMIUM']
            browser = pw.chromium.launch(**options)
            page = browser.new_page()
            page.set_content('''<select id="month"><option value="7">July</option></select>
                <select id="period"><option>2050-2079</option></select>
                <select id="member"><option>mean</option></select><main></main>''')
            page.evaluate('''() => {
                window.ClimaScopeProfile = {
                    months: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
                    escape: value => value,
                    load: scope => scope === 'national' ? Promise.resolve({name:'Scotland'}) :
                        new Promise(resolve => {window.finishProfile=resolve;}),
                    render: (holder,data) => {holder.textContent=data.name;window.drawCount++;}
                };
                window.drawCount=0;
                window.state={scope:'national',member:'mean',month:7,period:'2050-2079'};
            }''')
            page.add_script_tag(path=str(ROOT / 'static/js/dashboard_climate.js'))
            page.evaluate('''async () => {
                window.panel=new ClimateDashboard(document.querySelector('main'),()=>state,()=>{});
                await panel.update(state,false);
                state={...state,scope:'council:Fife'};
                window.pendingUpdate=panel.update(state,false);
                window.dispatchEvent(new CustomEvent('climascope:theme'));
            }''')
            self.assertIn('cp-loading', page.locator('main').get_attribute('class'))
            self.assertEqual(page.locator('.profile-status').inner_text(), 'Loading climate…')
            self.assertEqual(page.locator('.profile-content').inner_text(), 'Scotland')
            page.evaluate('''async () => {
                finishProfile({name:'Fife'});await pendingUpdate;
                state={...state,scope:'aoi'};
                await panel.update(state,false);
                window.dispatchEvent(new CustomEvent('climascope:theme'));
            }''')
            self.assertEqual(page.locator('.profile-heading').inner_text(), 'Drawn area')
            self.assertEqual(page.locator('.profile-content').inner_text(), '')
            self.assertIn('Choose a location', page.locator('.profile-status').inner_text())
            page.evaluate('''() => {
                state={...state,scope:'council:Angus'};
                window.pendingUpdate=panel.update(state,false);
                window.dispatchEvent(new CustomEvent('climascope:theme'));
            }''')
            self.assertIn('cp-loading', page.locator('main').get_attribute('class'))
            self.assertEqual(page.locator('.profile-status').inner_text(), 'Loading climate…')
            self.assertEqual(page.locator('.profile-content').inner_text(), '')
            page.evaluate('''async () => {
                finishProfile({name:'Angus'});await pendingUpdate;
                window.dispatchEvent(new CustomEvent('climascope:theme'));
            }''')
            self.assertEqual(page.locator('.profile-heading h2').inner_text(), 'Angus')
            self.assertEqual(page.locator('.profile-content').inner_text(), 'Angus')
            self.assertEqual(page.evaluate('drawCount'), 4)
            browser.close()


if __name__ == '__main__':
    unittest.main()
