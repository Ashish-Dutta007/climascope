(function () {
  'use strict';

  // British National Grid for the small overview. The OSGB36 datum transform
  // supplied by Proj4js is sufficient at the inset's kilometre-scale pixels.
  var toGrid = proj4('EPSG:4326', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 ' +
    '+x_0=400000 +y_0=-100000 +datum=OSGB36 +units=m +no_defs');

  function grid(coord) { return toGrid.forward(coord); }

  // Intersect a horizontal scanline with each polygon, including its holes.
  // The midpoint of the widest inside interval stays on the region. Work in
  // the source geometry's coordinates, then project the resulting point.
  function interiorPoint(geometry) {
    if (!geometry) return null;
    var polygons = geometry.type === 'Polygon' ? [geometry.coordinates] :
      geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
    function area(ring) {
      var sum = 0;
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      }
      return Math.abs(sum) / 2;
    }
    polygons = polygons.filter(function (poly) { return poly && poly[0] && poly[0].length >= 3; })
      .sort(function (a, b) { return area(b[0]) - area(a[0]); });
    for (var p = 0; p < polygons.length; p++) {
      var rings = polygons[p], south = Infinity, north = -Infinity;
      if (!rings.length || rings[0].length < 3) continue;
      rings[0].forEach(function (c) { south = Math.min(south, c[1]); north = Math.max(north, c[1]); });
      var y = (south + north) / 2, intersections = [];
      rings.forEach(function (ring) {
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          var a = ring[j], b = ring[i];
          if ((a[1] > y) !== (b[1] > y)) intersections.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
      });
      intersections.sort(function (a, b) { return a - b; });
      var point = null, widest = 0;
      for (var k = 0; k + 1 < intersections.length; k += 2) {
        var width = intersections[k + 1] - intersections[k];
        if (width > widest) { widest = width; point = [(intersections[k] + intersections[k + 1]) / 2, y]; }
      }
      if (point) return point;
    }
    return null;
  }

  function create(rings, size) {
    var bounds = [Infinity, Infinity, -Infinity, -Infinity];
    (rings || []).forEach(function (ring) {
      ring.forEach(function (coord) {
        var p = grid(coord);
        bounds[0] = Math.min(bounds[0], p[0]); bounds[1] = Math.min(bounds[1], p[1]);
        bounds[2] = Math.max(bounds[2], p[0]); bounds[3] = Math.max(bounds[3], p[1]);
      });
    });
    if (!isFinite(bounds[0])) bounds = [0, 530000, 500000, 1230000];
    var width = Math.max(1, bounds[2] - bounds[0]), height = Math.max(1, bounds[3] - bounds[1]);
    var usableW = size.w - size.pad * 2, usableH = size.h - size.pad * 2;
    var scale = Math.min(usableW / width, usableH / height);
    var ox = size.pad + (usableW - width * scale) * 0.5;
    var oy = size.pad + (usableH - height * scale) * 0.5;
    return {
      point: function (coord) {
        var p = grid(coord);
        return [ox + (p[0] - bounds[0]) * scale, oy + (bounds[3] - p[1]) * scale];
      }
    };
  }

  window.ClimaScopeLocator = { grid: grid, create: create, interiorPoint: interiorPoint, crs: 'EPSG:27700' };
})();
