"""Unlinked councils, empty CWR charts and recovery to populated data."""
import os
from pathlib import Path
import tempfile
import unittest

from flask import Flask
import pandas as pd

from immersive_context import CLASSES, MEMBERS, PERIODS, create_context_blueprint


ROOT = Path(__file__).resolve().parents[1]


class CWRFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="climascope-cwr-")
        root = Path(cls.temp.name)
        for pi, period in enumerate(PERIODS, 1):
            rows = []
            for mi, member in enumerate(MEMBERS, 1):
                for month in range(1, 13):
                    for category, area in ((CLASSES[0], mi * 100), (CLASSES[2], 200)):
                        rows.append({"Member":member, "Month":month, "Type":"Arable",
                                     "catchment_name":"Catchment A", "class":category,
                                     "total_area_HA":area * pi * month})
            path = root / "Variable=Land%20Use" / ("Period=" + period) / "Metric=CWRPT"
            path.mkdir(parents=True)
            pd.DataFrame(rows).to_parquet(path / "data.parquet", index=False)
        app = Flask(__name__)
        app.config["TESTING"] = True
        app.register_blueprint(create_context_blueprint(root, {
            "Dundee City":[], "North Lanarkshire":[], "Linked council":["Catchment A"]
        }, {"Catchment A"}))
        cls.client = app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def get(self, scope, member="mean"):
        return self.client.get("/api/immersive/cwr", query_string={"scope":scope, "member":member})


class EmptyCWRData(CWRFixture):
    def test_valid_unlinked_councils_return_empty_months_for_mean_and_member(self):
        for council in ("Dundee City", "North Lanarkshire"):
            for member in ("mean", "08"):
                with self.subTest(council=council, member=member):
                    response = self.get("council:" + council, member)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json["scope_label"], "Catchments linked to " + council)
                    for period in PERIODS:
                        self.assertEqual(len(response.json["periods"][period]), 12)
                        for item in response.json["periods"][period]:
                            self.assertEqual(item, {"total_km2":0, "classes_km2":[0]*4,
                                                    "land_use":{}, "members":0})

    def test_populated_scope_totals_and_twelve_member_mean_are_unchanged(self):
        for scope in ("national", "council:Linked council", "catchment:Catchment A"):
            for member in ("mean", "08"):
                data = self.get(scope, member).json
                for pi, period in enumerate(PERIODS, 1):
                    for month, item in enumerate(data["periods"][period], 1):
                        factor = pi * month
                        deficit = 6.5 if member == "mean" else 6
                        self.assertEqual(item["classes_km2"], [deficit*factor, 0, 2*factor, 0])
                        self.assertEqual(item["total_km2"], (deficit+2)*factor)
                        self.assertEqual(item["land_use"], {"Arable":item["classes_km2"]})
                        self.assertEqual(item["members"], 12 if member == "mean" else 1)

    def test_unknown_scopes_and_members_still_fail(self):
        for scope, member in (("council:Unknown", "mean"), ("catchment:Unknown", "08"),
                              ("council:Dundee City", "99")):
            self.assertEqual(self.get(scope, member).status_code, 400)


class EmptyCWRDisplay(CWRFixture):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        from playwright.sync_api import sync_playwright
        cls.pw = sync_playwright().start()
        options = {"headless":True, "args":["--no-sandbox"]}
        if os.environ.get("CLIMASCOPE_CHROMIUM"):
            options["executable_path"] = os.environ["CLIMASCOPE_CHROMIUM"]
        cls.browser = cls.pw.chromium.launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        super().tearDownClass()

    def test_empty_charts_explain_missing_data_and_recover(self):
        page = self.browser.new_page()
        self.addCleanup(page.close)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.set_content('<main id="panels"></main>')
        page.add_script_tag(path=str(ROOT / "static/immersive/context.js"))
        page.evaluate("ClimaScopeContext.build(document.querySelector('#panels'))")

        def render(scope):
            data = self.get(scope).json
            page.evaluate("""data => {
              const frame = {scene:'water-classes', month:7, member:'mean',
                region:{kind:'council',name:data.scope.slice(8)}, context:{cwr:data}};
              ClimaScopeContext.layout(frame);
              ClimaScopeContext.render(frame);
            }""", data)
            return data

        for scope in ("council:Dundee City", "council:Linked council", "council:North Lanarkshire"):
            data = render(scope)
            if scope == "council:Linked council":
                bars = page.locator(".cwr-months rect[data-class]").count()
                self.assertEqual(bars, 3*12*4)
                heights = page.locator('.cwr-period[data-period="1990-2019"] .cwr-months rect[data-class]').evaluate_all(
                    'nodes => nodes.map(node => Number(node.getAttribute("height")))')
                for month in range(12):
                    item = data["periods"][PERIODS[0]][month]
                    for ci, area in enumerate(item["classes_km2"]):
                        self.assertAlmostEqual(heights[month*4+ci], 285*area/item["total_km2"])
            else:
                self.assertEqual(page.locator(".cwr-months rect,.cwr-months line").count(), 0)
                self.assertEqual(page.locator(".cwr-land-use rect").count(), 0)
                for chart in page.locator(".cwr-months,.cwr-land-use").all():
                    self.assertEqual(chart.inner_text(), "No classified land-use data")
            self.assertIn(data["scope_label"], page.locator(".cwr-key").inner_text())
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
