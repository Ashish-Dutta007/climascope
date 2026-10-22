"""Catchment member selection, class-area means and drawn-area allocation."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

os.environ.setdefault('PREWARM_CATCHMENT', '0')


class CatchmentMembers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import app
        cls.module = app
        cls.client = app.app.test_client()

    def setUp(self):
        import pandas as pd
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.members = sorted(self.module._VALID_MEMBERS)
        rows = []
        for name, factor in [('A', 1), ('B', 2)]:
            for index, member in enumerate(self.members):
                rows.extend([
                    dict(catchment_name=name, Type='Cropland', Member=member, Month=7,
                         Scenario='Projected', **{'class': 'Strong Deficit', 'total_area_HA': factor * (index + 1) * 10.0}),
                    dict(catchment_name=name, Type='Cropland', Member=member, Month=7,
                         Scenario='Projected', **{'class': 'Moderate Surplus', 'total_area_HA': factor * 100.0}),
                ])
        self.frame = pd.DataFrame(rows)
        for metric in ('CWBPT', 'CWBPM', 'CWRPT', 'CWRPM'):
            folder = self.root / 'Variable=Land%20Use' / 'Period=2050-2079' / f'Metric={metric}'
            folder.mkdir(parents=True)
            self.frame.to_parquet(folder / 'source.parquet', index=False)
        for name, value in {
            'JESS_ROOT': str(self.root), 'JESS_CWR_ROOT': str(self.root),
            '_CATCHMENT_NAMES': frozenset(('A', 'B')),
            '_COUNCIL_CATCHMENTS': {'Test': ['A', 'B', 'A']},
            '_CATCHMENT_CELLS': {'A': frozenset((1, 2)), 'B': frozenset((3, 4))},
        }.items():
            patcher = patch.object(self.module, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.module._catchment_cached.cache_clear()
        self.addCleanup(self.module._catchment_cached.cache_clear)

    def get(self, **changes):
        params = dict(variable='Land Use', metric='CWRPT', month=7,
                      period='2050-2079', scope='national')
        params.update(changes)
        return self.client.get('/api/catchment', query_string=params)

    def post(self, **changes):
        body = dict(variable='Land Use', metric='CWRPT', month=7,
                    period='2050-2079', aoi_ids=[1])
        body.update(changes)
        return self.client.post('/api/catchment', json=body)

    def test_members_and_cache_are_separate_for_all_four_metrics(self):
        for metric in ('CWBPT', 'CWBPM', 'CWRPT', 'CWRPM'):
            for member in ('01', '08', '01'):
                response = self.get(metric=metric, member=member)
                self.assertEqual(response.status_code, 200, response.json)
                self.assertEqual(response.json['member'], member)
                classes = response.json['rows'][0]['classes']
                self.assertEqual(classes['Strong Deficit'], 30 * (self.members.index(member) + 1))
                self.assertEqual(classes['Moderate Surplus'], 300)
                self.assertEqual(classes['Strong Surplus'], 0)

    def test_default_mean_averages_twelve_members_including_zero_classes(self):
        response = self.get()
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json['member'], 'mean')
        self.assertEqual(response.json['ensemble_label'], 'Mean class areas · 12 members')
        row = response.json['rows'][0]
        self.assertEqual(row['classes']['Strong Deficit'], 195)
        self.assertEqual(row['total_ha'], sum(row['classes'].values()))
        # A class absent in eleven members still uses a divisor of twelve.
        extra = self.frame.iloc[[0]].copy()
        extra['class'] = 'Strong Surplus'
        extra['total_area_HA'] = 120.0
        import pandas as pd
        pd.concat([self.frame, extra]).to_parquet(
            self.root / 'Variable=Land%20Use/Period=2050-2079/Metric=CWRPT/source.parquet', index=False)
        self.module._catchment_cached.cache_clear()
        self.assertEqual(self.get().json['rows'][0]['classes']['Strong Surplus'], 10)

    def test_named_scopes_and_equal_size_drawn_areas_keep_their_own_figures(self):
        for member in ('01', '08', 'mean'):
            a = self.get(scope='catchment:A', member=member).json['rows'][0]
            council = self.get(scope='council:Test', member=member).json
            self.assertEqual(council['rows'][0]['classes']['Moderate Surplus'], 300)
            self.assertEqual(council['scope_label'], 'Catchments linked to Test')
            first = self.post(member=member, aoi_ids=[1]).json
            second = self.post(member=member, aoi_ids=[3]).json
            self.assertEqual(first['rows'][0]['classes']['Moderate Surplus'], 50)
            self.assertEqual(second['rows'][0]['classes']['Moderate Surplus'], 100)
            self.assertEqual(first['rows'][0]['classes']['Strong Deficit'], round(a['classes']['Strong Deficit'] / 2))
            self.assertIn('estimated', first['scope_label'])

    def test_council_without_linked_catchments_is_empty_not_unknown(self):
        # Dundee City is a real council with no catchments in the lookup.
        response = self.get(scope='council:Dundee City')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['rows'], [])
        self.assertEqual(response.json['scope_label'], 'Catchments linked to Dundee City')
        self.assertEqual(self.get(scope='council:Nowhere').status_code, 404)

    def test_missing_member_returns_an_error_instead_of_partial_mean(self):
        self.frame[self.frame.Member != '08'].to_parquet(
            self.root / 'Variable=Land%20Use/Period=2050-2079/Metric=CWRPT/source.parquet', index=False)
        for member in ('08', 'mean'):
            self.assertEqual(self.get(member=member).status_code, 503)
            self.assertEqual(self.post(member=member).status_code, 503)
        self.assertEqual(self.get(member='01').status_code, 200)

    def test_invalid_members_and_months_are_rejected_by_both_methods(self):
        for member in ('99', '', '1', 'MEAN'):
            self.assertEqual(self.get(member=member).status_code, 400)
        for member in ('99', '', None, [], {}):
            self.assertEqual(self.post(member=member).status_code, 400)
        for month in ('bad', 0, 13, 1.5, True):
            self.assertEqual(self.get(month=month).status_code, 400)
            self.assertEqual(self.post(month=month).status_code, 400)


if __name__ == '__main__':
    unittest.main()
