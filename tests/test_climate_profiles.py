"""Source checks for the shared location/profile API."""
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

os.environ.setdefault("PREWARM_CATCHMENT", "0")
ROOT = Path(__file__).resolve().parents[1]


class ClimateProfiles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import app
        cls.module = app
        cls.client = app.app.test_client()
        cls.service = app.app.extensions["climate_profiles"]

    def test_postcode_resolves_without_a_second_cell_click(self):
        with patch("climate_profiles.lookup_postcode", return_value=(-3.422055, 56.402953)):
            response = self.client.get("/api/location?postcode=ph27hp")
        self.assertEqual(response.status_code, 200)
        location = response.json
        self.assertEqual(location["name"], "PH2 7HP")
        self.assertEqual(location["id"], 135422)
        self.assertEqual(location["scope"], "cell:135422")
        self.assertEqual(location["council"], "Perth and Kinross")
        with patch("climate_profiles.lookup_postcode", return_value=(-3.436785, 56.378874)):
            nearby = self.client.get("/api/location?postcode=ph20al").json
        self.assertEqual(nearby["name"], "PH2 0AL")
        self.assertEqual(nearby["id"], 66232)
        self.assertEqual(nearby["scope"], "cell:66232")
        self.assertEqual(nearby["council"], "Perth and Kinross")
        from shapely.geometry import Point, shape
        self.assertTrue(shape(location["geometry"]).covers(Point(location["longitude"], location["latitude"])))
        with patch("climate_profiles.lookup_postcode", return_value=(-2.158335,57.133332)):
            second = self.client.get("/api/location?postcode=AB158QH").json
        self.assertEqual(second['id'],168187)
        self.assertEqual(second['council'],'Aberdeen City')
        self.assertEqual(second['catchment'],'Hol Burn : 23244')

    def test_cell_values_and_member_ranges_match_source(self):
        import pyarrow.parquet as pq
        from climate_profiles import METRICS, MEMBERS, PERIODS
        profiles = {}
        for member in ("mean", "07"):
            response = self.client.get(f"/api/climate/profile?scope=cell:135422&member={member}")
            self.assertEqual(response.status_code, 200, response.json)
            profiles[member] = response.json
            for metric in METRICS:
                for period in PERIODS:
                    for month in (1, 7, 12):
                        source_member = "mean" if period == PERIODS[0] else member
                        folder = ROOT / "data/precomputed" / f"Metric={metric}" / f"Period={period}"
                        path = folder / (f"Month={month}.parquet" if source_member == "mean"
                                         else f"Month={month}/Member={source_member}.parquet")
                        col = "obs_value" if period == PERIODS[0] else "proj_value"
                        row = pq.read_table(path, columns=[col], filters=[("id_1km", "=", 135422)]).to_pylist()[0]
                        self.assertEqual(profiles[member]["metrics"][metric]["values"][period][month - 1], row[col])
        mean = profiles["mean"]["metrics"]
        for metric in METRICS:
            values = mean[metric]["values"]
            for period in PERIODS:
                self.assertEqual(len(values[period]), 12)
            self.assertEqual(profiles["07"]["metrics"][metric]["values"][PERIODS[0]], values[PERIODS[0]])
            for member in MEMBERS:
                path = ROOT / "data/precomputed" / f"Metric={metric}" / "Period=2050-2079" / "Month=7" / f"Member={member}.parquet"
                row = pq.read_table(path, columns=["proj_value", "obs_value"], filters=[("id_1km", "=", 135422)]).to_pylist()[0]
                self.assertEqual(mean[metric]["member_changes"]["2050-2079"][member][6], row["proj_value"] - row["obs_value"])
        self.assertEqual(sum(v[6] > 0 for v in mean["Tmax_mean"]["member_changes"]["2050-2079"].values()), 12)
        self.assertEqual(sum(v[6] > 0 for v in mean["Prec_sum"]["member_changes"]["2050-2079"].values()), 5)
        self.assertEqual(sum(v[6] < 0 for v in mean["CWBPT"]["member_changes"]["2050-2079"].values()), 12)

    def test_water_balance_identity(self):
        for scope in ("cell:135422", "national", "council:Perth and Kinross", "catchment:Annaty Burn : 6413"):
            for member in ("mean", "07"):
                response = self.client.get("/api/climate/profile", query_string={"scope":scope, "member":member})
                self.assertEqual(response.status_code, 200, response.json)
                metrics = response.json["metrics"]
                for period in response.json["periods"]:
                    for cwb, rain, et in zip(metrics["CWBPT"]["values"][period], metrics["Prec_sum"]["values"][period], metrics["ETPT_sum"]["values"][period]):
                        if all(v is not None for v in (cwb, rain, et)):
                            self.assertAlmostEqual(cwb, rain - et, delta=.0016)

    def test_cell_and_area_comparisons_share_a_source_version(self):
        for member in ('mean','07'):
            profiles = [self.client.get('/api/climate/profile',query_string={'scope':scope,'member':member}).json
                        for scope in ('cell:168187','council:Aberdeen City','catchment:Hol Burn : 23244')]
            self.assertTrue(profiles[0]['data_version'])
            self.assertEqual(len({p['data_version'] for p in profiles}),1)

    def test_cell_lookup_across_row_group_boundaries(self):
        import pyarrow.parquet as pq
        from climate_profiles import read_cell
        path = ROOT / 'data/place_profiles/mean.parquet'
        source = pq.ParquetFile(path)
        stamp = path.stat().st_mtime_ns
        for group in (0,1,source.num_row_groups-1):
            reference = source.read_row_group(group).to_pylist()
            for expected in (reference[0],reference[-1]):
                actual = dict(read_cell(str(path),stamp,expected['id_1km']))
                actual.pop('_data_version')
                self.assertEqual(actual,expected)
        first = source.read_row_group(0,columns=['id_1km']).column(0).to_pylist()[0]
        last = source.read_row_group(source.num_row_groups-1,columns=['id_1km']).column(0).to_pylist()[-1]
        self.assertIsNone(read_cell(str(path),stamp,first-1))
        self.assertIsNone(read_cell(str(path),stamp,last+1))

    def test_invalid_or_uncovered_selections_do_not_become_scotland(self):
        for path, status in (("/api/location?postcode=invalid",400),
                             ("/api/location?lat=nan&lon=-3",400),
                             ("/api/location?lat=51&lon=0",400),
                             ("/api/location?lat=61&lon=-8",404),
                             ("/api/climate/profile?scope=cell:99999999",404),
                             ("/api/climate/profile?scope=cell:1.2",400),
                             ("/api/climate/profile?scope=council:missing",400),
                             ("/api/climate/profile?scope=cell:135422&member=99",400)):
            self.assertEqual(self.client.get(path).status_code, status, path)

    def test_mixed_profile_versions_fail_instead_of_substituting(self):
        from climate_profiles import ProfileError
        def row(cell_id, member):
            return {"id_1km":cell_id, "_data_version":"old" if member == "07" else "new"}
        with patch.object(self.service, "cell_row", side_effect=row):
            with self.assertRaises(ProfileError) as error:
                self.service.profile("cell:135422", "mean")
        self.assertEqual(error.exception.status, 503)

    def test_upstream_errors_and_coverage(self):
        from climate_profiles import lookup_postcode, ProfileError
        from io import BytesIO
        from urllib.error import HTTPError
        lookup_postcode.cache_clear()
        with patch("climate_profiles.urlopen", side_effect=HTTPError('',404,'',{},None)):
            with self.assertRaises(ProfileError) as error:
                lookup_postcode("ZZ1 1ZZ")
            self.assertEqual(error.exception.status, 404)
        with patch("climate_profiles.urlopen", return_value=BytesIO(json.dumps({"result":{"country":"England"}}).encode())):
            with self.assertRaises(ProfileError) as error:
                lookup_postcode("SW1A 1AA")
            self.assertIn("Scotland", error.exception.message)
        with patch("climate_profiles.urlopen", side_effect=TimeoutError):
            with self.assertRaises(ProfileError) as error:
                lookup_postcode("PH2 7HP")
            self.assertEqual(error.exception.status, 502)
        with patch("climate_profiles.urlopen", return_value=BytesIO(b'{"result":[]}')):
            with self.assertRaises(ProfileError) as error:
                lookup_postcode("PH2 7HP")
            self.assertEqual(error.exception.status, 502)
        for lon, lat in ((-3, 100), (180, 56), (float("nan"), 56)):
            document = {"result": {"country": "Scotland", "longitude": lon, "latitude": lat}}
            with patch("climate_profiles.urlopen", return_value=BytesIO(json.dumps(document).encode())):
                with self.assertRaises(ProfileError) as error:
                    lookup_postcode("PH2 7HP")
                self.assertEqual(error.exception.status, 404)


if __name__ == "__main__":
    unittest.main()
