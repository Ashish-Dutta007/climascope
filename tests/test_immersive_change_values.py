"""Real-source checks for change maps and the PT water-balance companion."""
import json
import os
from pathlib import Path
import unittest
import urllib.request

BASE = os.environ.get("CLIMASCOPE_TEST_URL", "").rstrip("/")
ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(BASE, "set CLIMASCOPE_TEST_URL to local staging")
class ChangeValues(unittest.TestCase):
    def test_source_changes_and_fixed_domains(self):
        import duckdb
        mean = json.loads((ROOT / "static/immersive/summaries/v2/mean.json").read_text())
        con = duckdb.connect()
        try:
            for member in ["mean", "07"]:
                query = "?month=7&metrics=CWBPT,ETPT_sum&change=1&member=" + member
                with urllib.request.urlopen(BASE + "/api/immersive_values" + query, timeout=60) as response:
                    payload = json.load(response)
                for metric in ["CWBPT", "ETPT_sum"]:
                    folder = ROOT / "data/precomputed" / ("Metric=" + metric) / "Period=2050-2079"
                    path = folder / ("Month=7.parquet" if member == "mean" else "Month=7/Member=07.parquet")
                    expected = dict(con.execute('''SELECT cast(id_1km as varchar),
                        CASE WHEN isfinite(proj_value) AND isfinite(obs_value)
                        THEN round(cast(proj_value as double)-cast(obs_value as double),2) ELSE NULL END
                        FROM read_parquet(?)''', [str(path)]).fetchall())
                    self.assertEqual(payload[metric]["2050-2079_change"], expected)
                    # Ensure the check includes cells where differencing rounded operands is wrong.
                    count = con.execute('''SELECT count(*) FROM read_parquet(?) WHERE
                        abs(round(cast(proj_value as double)-cast(obs_value as double),2)
                            - (round(cast(proj_value as double),2)-round(cast(obs_value as double),2))) > 0.005''', [str(path)]).fetchone()[0]
                    self.assertGreater(count, 100)
                    domain = mean["_meta"]["change_domains"][metric]
                    self.assertEqual(domain["lo"], -domain["hi"])
                    self.assertEqual(domain["median"], 0)
                    self.assertGreater(domain["hi"], 0)
            for rid, metrics in mean["regions"].items():
                for period in ["1990-2019", "2020-2049", "2050-2079"]:
                    for cwb, rain, et in zip(metrics["CWBPT"][period], metrics["Prec_sum"][period], metrics["ETPT_sum"][period]):
                        if cwb is not None:
                            self.assertAlmostEqual(cwb, rain-et, delta=0.0016, msg=(rid, period))
        finally:
            con.close()


if __name__ == "__main__":
    unittest.main()
