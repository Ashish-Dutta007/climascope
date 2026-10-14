"""Check the inset's British National Grid transform and metric aspect ratio."""
import json
from pathlib import Path
import subprocess
import unittest

from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
NODE = ROOT / 'venv/lib/python3.12/site-packages/playwright/driver/node'


class LocatorProjection(unittest.TestCase):
    def run_locator(self, points, rings=None):
        source = r'''
          const fs=require('fs'),vm=require('vm');
          const context={window:{},proj4:require('./static/immersive/vendor/proj4-2.22.0.js')};
          vm.runInNewContext(fs.readFileSync('./static/immersive/locator.js','utf8'),context);
          const input=JSON.parse(fs.readFileSync(0,'utf8')),locator=context.window.ClimaScopeLocator;
          const projection=locator.create(input.rings,{w:182,h:232,pad:8});
          process.stdout.write(JSON.stringify({crs:locator.crs,grid:input.points.map(locator.grid),
            pixels:input.points.map(projection.point)}));
        '''
        result = subprocess.run([str(NODE), '-e', source], cwd=ROOT,
                                input=json.dumps({'points': points, 'rings': rings}),
                                text=True, capture_output=True, check=True)
        return json.loads(result.stdout)

    def test_transform_matches_pyproj_at_scottish_locations(self):
        points = [[-2.0943, 57.1497], [-3.1883, 55.9533], [-1.1456, 60.1551], [-8.58, 57.81]]
        result = self.run_locator(points)
        reference = Transformer.from_crs('EPSG:4326', 'EPSG:27700', always_xy=True)
        self.assertEqual(result['crs'], 'EPSG:27700')
        for point, actual in zip(points, result['grid']):
            expected = reference.transform(*point)
            # Helmert versus grid-based OSGB36 transformations can differ by a
            # few metres, much less than a pixel in this Scotland locator.
            for a, e in zip(actual, expected):
                self.assertAlmostEqual(a, e, delta=5)

    def test_locator_preserves_metres_in_both_axes(self):
        inverse = Transformer.from_crs('EPSG:27700', 'EPSG:4326', always_xy=True)
        points = [inverse.transform(*p) for p in [(100000,600000),(500000,600000),(500000,1200000),(100000,1200000)]]
        result = self.run_locator(points, [points + [points[0]]])
        pixels = result['pixels']
        width = pixels[1][0] - pixels[0][0]
        height = pixels[0][1] - pixels[3][1]
        self.assertAlmostEqual(width / height, 400000 / 600000, delta=0.00001)
        self.assertGreater(pixels[0][1], pixels[3][1])
        self.assertTrue(all(8 - 0.01 <= x <= 174 + 0.01 and 8 - 0.01 <= y <= 224 + 0.01 for x, y in pixels))
