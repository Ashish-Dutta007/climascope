"""Reconcile fixed-cover areas and CWR class areas with their separate sources."""
import json
import os
from pathlib import Path
import unittest
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get("CLIMASCOPE_TEST_URL", "").rstrip("/")


class LandcoverAreas(unittest.TestCase):
    def test_boundary_clipping_fractional_area_and_no_climate_filter(self):
        import geopandas as gpd
        import numpy as np
        import pandas as pd
        data = json.loads((ROOT/"static/immersive/summaries/landcover-v1.json").read_text())
        self.assertEqual(len(data["regions"]), 1059)
        grid = gpd.read_parquet(ROOT/"data/grid.parquet").to_crs(27700)
        cover = pd.read_parquet(ROOT/"data/landcover_fractions.parquet")
        councils = gpd.read_file(ROOT/"data/councils.gpkg").to_crs(27700)
        catchments = gpd.read_file(ROOT/"data/catchments.gpkg").to_crs(27700)
        field = next(c for c in ["council_name","LAD22NM","name","Name"] if c in councils)
        examples = [("national", councils.geometry.union_all()),
                    ("council:Angus", councils.loc[councils[field]=="Angus"].geometry.iloc[0]),
                    ("council:Na h-Eileanan Siar", councils.loc[councils[field]=="Na h-Eileanan Siar"].geometry.iloc[0])]
        tiny = catchments.loc[catchments.geometry.area.idxmin()]
        examples.append(("catchment:"+tiny.catchment_name, tiny.geometry))
        for key, geometry in examples:
            indices = grid.sindex.query(geometry, predicate="intersects")
            cells = grid.iloc[indices].copy()
            cells["km2"] = cells.geometry.intersection(geometry).area/1e6
            joined = cover.merge(cells[["id_1km","km2"]], on="id_1km")
            expected = (joined.frac*joined.km2).groupby(joined.lc_code).sum()
            actual = data["regions"][key]
            for i, c in enumerate(data["_meta"]["classes"]):
                self.assertAlmostEqual(actual["areas_km2"][i], expected.get(c["code"],0), places=5, msg=key)
            self.assertAlmostEqual(actual["total_km2"], expected.sum(), places=5)
            self.assertLessEqual(actual["grid_footprint_km2"], actual["region_km2"]+1e-5)
        self.assertFalse(data["_meta"]["climate_filter"])
        # The smallest catchment must not become a whole 1 km climate cell.
        self.assertLess(data["regions"][examples[-1][0]]["total_km2"], .05)


@unittest.skipUnless(BASE, "set CLIMASCOPE_TEST_URL to local staging")
class CWRSource(unittest.TestCase):
    def get(self, scope, member):
        query=urllib.parse.urlencode({"scope":scope,"member":member})
        with urllib.request.urlopen(BASE+"/api/immersive/cwr?"+query,timeout=120) as r:
            return json.load(r)

    def test_real_source_classes_members_and_scope(self):
        import duckdb
        import pandas as pd
        lookup=pd.read_csv(ROOT/"data/catchment_council_lookup.csv")
        catchment=lookup.loc[lookup.council=="Angus","catchment_name"].iloc[0]
        cases=[("national","01"),("national","mean"),("council:Angus","08"),("catchment:"+catchment,"mean")]
        with duckdb.connect() as db:
            for scope,member in cases:
                data=self.get(scope,member)
                for period in ["1990-2019","2020-2049","2050-2079"]:
                    paths=list((ROOT/"data/jess/parquet_cwr/Variable=Land%20Use"/f"Period={period}"/"Metric=CWRPT").glob("*.parquet"))
                    raw=db.execute("select Member,Month,catchment_name,Type,class,total_area_HA from read_parquet(?,hive_partitioning=false)",[str(paths[0])]).fetchdf()
                    raw["total_area_HA"] = raw.total_area_HA.astype(float)
                    if member != "mean": raw=raw[raw.Member==member]
                    if scope.startswith("council:"): raw=raw[raw.catchment_name.isin(lookup.loc[lookup.council==scope[8:],"catchment_name"])]
                    if scope.startswith("catchment:"): raw=raw[raw.catchment_name==scope[10:]]
                    divisor=1200 if member=="mean" else 100
                    for month in [1,7,12]:
                        item=data["periods"][period][month-1]
                        selected=raw[raw.Month==month]
                        expected=selected.groupby("class").total_area_HA.sum()/divisor
                        for ci,category in enumerate(data["classes"]):
                            self.assertAlmostEqual(item["classes_km2"][ci],expected.get(category,0),places=6)
                        self.assertAlmostEqual(sum(item["classes_km2"]),item["total_km2"],places=6)
                        self.assertAlmostEqual(sum(sum(v) for v in item["land_use"].values()),item["total_km2"],places=6)
                if scope.startswith("council:"): self.assertIn("Catchments linked to",data["scope_label"])
                if member=="mean": self.assertEqual(data["ensemble_label"],"Mean class areas · 12 members")

    def test_invalid_selections_are_rejected(self):
        for scope,member in [("national","99"),("council:missing","mean"),("catchment:' OR true--","01")]:
            with self.assertRaises(urllib.error.HTTPError) as error: self.get(scope,member)
            self.assertEqual(error.exception.code,400)


if __name__ == "__main__":
    unittest.main()
