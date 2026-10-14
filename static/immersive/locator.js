(function () {
  'use strict';

  // British National Grid for the small overview. The OSGB36 datum transform
  // supplied by Proj4js is sufficient at the inset's kilometre-scale pixels.
  var toGrid = proj4('EPSG:4326', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 ' +
    '+x_0=400000 +y_0=-100000 +datum=OSGB36 +units=m +no_defs');

  function grid(coord) { return toGrid.forward(coord); }

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

  window.ClimaScopeLocator = { grid: grid, create: create, crs: 'EPSG:27700' };
})();
