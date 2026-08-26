/* Trishuli corridor map - MapLibre GL, live Esri raster, ClimaScope static vectors.
   No inline script: the page CSP is script-src 'self' unpkg jsdelivr. */
(function () {
  'use strict';
  var BASE = document.currentScript ? document.currentScript.dataset.base : '';
  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  var $ = function (id) { return document.getElementById(id); };

  var BASEMAPS = {
    img:  {name: 'World_Imagery',              label: 'Esri World Imagery'},
    topo: {name: 'World_Topo_Map',             label: 'Esri Topographic'},
    hs:   {name: 'Elevation/World_Hillshade',  label: 'Esri Hillshade'},
    terr: {name: 'World_Terrain_Base',         label: 'Esri Terrain'}
  };
  var ATTR = 'Esri, Vantor, Earthstar Geographics | OpenStreetMap contributors (ODbL) | Copernicus DEM';

  function rasterSource(key) {
    return {type: 'raster', tiles: [ESRI + BASEMAPS[key].name + '/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256, maxzoom: 19, attribution: ATTR};
  }
  var bsiCol = function (v) {
    return v >= 0.75 ? '#b8392e' : v >= 0.55 ? '#d99a2b' : v >= 0.30 ? '#2b8fab' : '#7d8b98';
  };
  var bsiLab = function (v) {
    return v >= 0.75 ? 'very high' : v >= 0.55 ? 'high' : v >= 0.30 ? 'moderate' : 'low';
  };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c];
    });
  };

  var map = new maplibregl.Map({
    container: 'map',
    style: {version: 8, sources: {base: rasterSource('img')},
            layers: [{id: 'base', type: 'raster', source: 'base'}]},
    center: [85.25, 28.07], zoom: 9.6, maxZoom: 18, minZoom: 6,
    attributionControl: false
  });
  map.addControl(new maplibregl.NavigationControl({visualizePitch: false}), 'top-right');
  map.addControl(new maplibregl.ScaleControl({maxWidth: 130, unit: 'metric'}), 'bottom-left');
  map.addControl(new maplibregl.AttributionControl({compact: true}), 'bottom-right');

  var DATA = null, currentBase = 'img';

  fetch(BASE + 'mapdata.json', {credentials: 'same-origin'})
    .then(function (r) {
      if (!r.ok) throw new Error('mapdata.json HTTP ' + r.status);
      return r.json();
    })
    .then(function (d) { DATA = d; if (map.isStyleLoaded()) build(); else map.on('load', build); })
    .catch(function (e) {
      var b = document.querySelector('.banner');
      if (b) { b.innerHTML = '<b>Vector layers failed to load.</b> ' + esc(e.message); }
    });

  function line(coords, props) {
    return {type: 'Feature', properties: props || {}, geometry: {type: 'LineString', coordinates: coords}};
  }
  function fc(features) { return {type: 'FeatureCollection', features: features}; }

  function nearestReach(lon, lat) {
    var best = DATA.reach[0], bd = Infinity;
    for (var i = 0; i < DATA.reach.length; i++) {
      var r = DATA.reach[i], d = (r[1] - lon) * (r[1] - lon) + (r[2] - lat) * (r[2] - lat);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  function build() {
    /* --- slope overlay, georeferenced image --- */
    var T = DATA.terrain;
    map.addSource('slope', {
      type: 'image', url: BASE + 'slope.png',
      coordinates: [[T.W, T.N], [T.E, T.N], [T.E, T.S], [T.W, T.S]]
    });
    map.addLayer({id: 'slope', type: 'raster', source: 'slope',
                  paint: {'raster-opacity': 0.62, 'raster-fade-duration': 0}});

    /* --- 250 m channel buffer (drawn as a wide translucent casing) --- */
    var stemFeatures = DATA.stem.map(function (l) { return line(l); });
    map.addSource('buf', {type: 'geojson', data: fc(stemFeatures)});
    map.addLayer({id: 'buf', type: 'line', source: 'buf',
      layout: {'line-cap': 'round', 'line-join': 'round', visibility: 'none'},
      paint: {'line-color': '#2b8fab', 'line-opacity': 0.28,
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 10, 4, 18, 260]}});

    /* --- tributaries / roads --- */
    map.addSource('trib', {type: 'geojson', data: fc(DATA.trib.map(function (l) { return line(l); }))});
    map.addLayer({id: 'trib', type: 'line', source: 'trib',
      paint: {'line-color': '#2b8fab', 'line-opacity': 0.62,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 2.4]}});

    map.addSource('rmin', {type: 'geojson', data: fc(DATA.road_minor.map(function (l) { return line(l); }))});
    map.addLayer({id: 'rmin', type: 'line', source: 'rmin', layout: {visibility: 'none'},
      paint: {'line-color': '#8a94a0', 'line-opacity': 0.75,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 2.2]}});

    map.addSource('rmaj', {type: 'geojson', data: fc(DATA.road_major.map(function (l) { return line(l); }))});
    map.addLayer({id: 'rmaj', type: 'line', source: 'rmaj',
      layout: {'line-cap': 'round', 'line-join': 'round'},
      paint: {'line-color': '#e8a33d',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.3, 16, 4.5]}});

    /* --- river, one feature per segment carrying its reach metrics --- */
    var segs = [];
    DATA.stem.forEach(function (l) {
      for (var i = 0; i < l.length - 1; i++) {
        var r = nearestReach(l[i][0], l[i][1]);
        segs.push(line([l[i], l[i + 1]], {
          col: bsiCol(r[4]), km: r[0], z: r[3], bsi: r[4], lab: bsiLab(r[4]),
          s45: r[5], relief: r[6], grad: r[7]
        }));
      }
    });
    map.addSource('stem', {type: 'geojson', data: fc(segs)});
    map.addLayer({id: 'stem', type: 'line', source: 'stem',
      layout: {'line-cap': 'round', 'line-join': 'round'},
      paint: {'line-color': ['get', 'col'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.2, 13, 5, 17, 11]}});

    /* --- buildings, coloured by distance to channel --- */
    map.addSource('bldg', {type: 'geojson', data: fc(DATA.bldg.map(function (b) {
      return {type: 'Feature', properties: {d: b[2]},
              geometry: {type: 'Point', coordinates: [b[0], b[1]]}};
    }))});
    map.addLayer({id: 'bldg', type: 'circle', source: 'bldg', minzoom: 11,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.1, 16, 3.4],
        'circle-color': ['step', ['get', 'd'], '#c9423a', 100, '#d68c36', 250, '#78848f'],
        'circle-opacity': 0.85}});

    /* --- point layers --- */
    function pts(key, arr, colour, radius, minz) {
      map.addSource(key, {type: 'geojson', data: fc(arr.map(function (p) {
        return {type: 'Feature',
                properties: {n: p.n || 'Unnamed', d: p.d,
                             t: p.high || p.amen || p.aero || p.plac || ''},
                geometry: {type: 'Point', coordinates: [p.x, p.y]}};
      }))});
      map.addLayer({id: key, type: 'circle', source: key, minzoom: minz || 0,
        paint: {'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, radius * 0.6, 16, radius * 1.7],
          'circle-color': colour, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1,
          'circle-opacity': 0.95}});
    }
    pts('plc', DATA.places, '#3b4956', 2.6, 10);
    pts('edu', DATA.edu, '#2b8fab', 3.2);
    pts('heli', DATA.helipad, '#d99a2b', 3.6);
    pts('hlth', DATA.health, '#2f7a5c', 4.2);
    pts('brg', DATA.bridges, '#b8392e', 3.6);

    /* --- anchor labels, snapped to the mapped channel --- */
    var ANCH = [[85.37700, 28.27805, 'Rasuwagadhi / Timure'], [85.32885, 28.15453, 'Syabrubesi'],
                [85.17084, 27.96316, 'Betrawati'], [85.13577, 27.92623, 'Bidur'],
                [85.11268, 27.86662, 'AOI limit']];
    ANCH.forEach(function (a) {
      var el = document.createElement('div');
      el.style.cssText = 'font:600 11.5px Archivo,sans-serif;color:#fff;white-space:nowrap;' +
        'text-shadow:0 0 3px #000,0 0 6px #000;pointer-events:none;transform:translateX(9px)';
      el.textContent = a[2];
      new maplibregl.Marker({element: el, anchor: 'left'}).setLngLat([a[0], a[1]]).addTo(map);
      var dot = document.createElement('div');
      dot.style.cssText = 'width:9px;height:9px;border-radius:50%;background:#fff;border:2px solid #131c25';
      new maplibregl.Marker({element: dot}).setLngLat([a[0], a[1]]).addTo(map);
    });

    fitCorridor();
    wireUI();
    wirePopups();
  }

  function fitCorridor() {
    var b = new maplibregl.LngLatBounds();
    DATA.stem.forEach(function (l) { l.forEach(function (p) { b.extend(p); }); });
    map.fitBounds(b, {padding: 46, duration: 0});
  }

  function popupHTML(title, kind, rows) {
    return '<h3>' + esc(title) + '</h3><div class="sub">' + esc(kind) + '</div><dl>' +
      rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>';
  }

  function wirePopups() {
    var POINTS = [['brg', 'Bridge'], ['hlth', 'Health facility'], ['edu', 'School'],
                  ['heli', 'Aeroway'], ['plc', 'Settlement']];
    POINTS.forEach(function (p) {
      map.on('click', p[0], function (e) {
        var f = e.features[0], c = f.geometry.coordinates;
        new maplibregl.Popup({closeButton: true, maxWidth: '280px'}).setLngLat(c)
          .setHTML(popupHTML(f.properties.n, p[1], [
            ['Latitude', c[1].toFixed(5)], ['Longitude', c[0].toFixed(5)],
            ['Distance to channel', f.properties.d + ' m'],
            ['Type', f.properties.t || '—']])).addTo(map);
      });
      map.on('mouseenter', p[0], function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', p[0], function () { map.getCanvas().style.cursor = ''; });
    });
    map.on('click', 'stem', function (e) {
      var pr = e.features[0].properties;
      new maplibregl.Popup({closeButton: true, maxWidth: '300px'}).setLngLat(e.lngLat)
        .setHTML(popupHTML('Chainage ' + pr.km + ' km', 'River reach', [
          ['Elevation', pr.z + ' m'],
          ['Blockage index', pr.bsi + ' (' + pr.lab + ')'],
          ['Slope &gt;45° within 500 m', pr.s45 + '%'],
          ['Relief within 500 m', pr.relief + ' m'],
          ['Channel gradient', pr.grad + ' m/km']])).addTo(map);
    });
    map.on('mouseenter', 'stem', function () { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'stem', function () { map.getCanvas().style.cursor = ''; });
  }

  function wireUI() {
    var segs = {'b-img': 'img', 'b-topo': 'topo', 'b-hs': 'hs', 'b-terr': 'terr'};
    Object.keys(segs).forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener('click', function () {
        currentBase = segs[id];
        map.getSource('base').setTiles([ESRI + BASEMAPS[currentBase].name + '/MapServer/tile/{z}/{y}/{x}']);
        Object.keys(segs).forEach(function (j) {
          var b = $(j); if (b) b.setAttribute('aria-pressed', String(j === id));
        });
      });
    });
    var boxes = {'l-slope': 'slope', 'l-stem': 'stem', 'l-trib': 'trib', 'l-rmaj': 'rmaj',
                 'l-rmin': 'rmin', 'l-bldg': 'bldg', 'l-brg': 'brg', 'l-edu': 'edu',
                 'l-hlth': 'hlth', 'l-heli': 'heli', 'l-plc': 'plc', 'l-buf': 'buf'};
    Object.keys(boxes).forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener('change', function () {
        map.setLayoutProperty(boxes[id], 'visibility', el.checked ? 'visible' : 'none');
      });
      if (map.getLayer(boxes[id])) {
        map.setLayoutProperty(boxes[id], 'visibility', el.checked ? 'visible' : 'none');
      }
    });
    var op = $('slopeop');
    if (op) op.addEventListener('input', function () {
      map.setPaintProperty('slope', 'raster-opacity', op.value / 100);
    });
    var pct = $('slopepct');
    if (pct) pct.textContent = (DATA.terrain.pct_over35 * 100).toFixed(0) + '% of area';

    var top = DATA.reach.slice().sort(function (a, b) { return b[4] - a[4]; }).slice(0, 5);
    var NAMES = {16.1: 'At Syabrubesi', 21.2: 'Below Syabrubesi', 27.2: 'Mid gorge',
                 7.1: 'Below Timure', 4: 'Upper Bhote Koshi', 20.1: 'Below Syabrubesi',
                 32.2: 'Lower gorge', 28.2: 'Mid gorge', 33.2: 'Lower gorge', 2: 'Near border'};
    var jump = $('jump');
    if (jump) {
      jump.innerHTML = top.map(function (r, i) {
        return '<button type="button" data-i="' + i + '"><b>' +
          esc(NAMES[r[0]] || ('Chainage ' + r[0] + ' km')) + '</b><br>' +
          '<span class="mono">km ' + r[0] + ' · ' + r[2].toFixed(4) + ', ' + r[1].toFixed(4) +
          '</span><br><span class="bs">index ' + r[4] + ' · ' + r[5] + '% over 45°</span></button>';
      }).join('');
      Array.prototype.forEach.call(jump.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () {
          var r = top[+b.dataset.i];
          map.flyTo({center: [r[1], r[2]], zoom: 14.2, duration: 900});
        });
      });
    }
    var fitBtn = $('fit');
    if (fitBtn) fitBtn.addEventListener('click', function () {
      fitCorridor();
    });
  }
})();
