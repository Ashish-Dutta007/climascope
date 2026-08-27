/* Trishuli corridor map - MapLibre GL, live Esri raster, ClimaScope static vectors.
   No inline script: the page CSP is script-src 'self' unpkg jsdelivr. */
(function () {
  'use strict';
  var BASE = document.currentScript ? document.currentScript.dataset.base : '';
  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  var $ = function (id) { return document.getElementById(id); };

  /* maxzoom is the deepest level that returns real tiles OVER THIS CORRIDOR, not the
     service's advertised LOD. Past it Esri serves a "map data not yet available"
     placeholder, so the source stops there and MapLibre upsamples the last good tile.
     World_Terrain_Base, NatGeo_World_Map and World_Physical_Map are deliberately
     absent: over Nepal they hit that placeholder from about z10. */
  var BASEMAPS = {
    img:    {name: 'World_Imagery',                 label: 'Esri World Imagery',    maxzoom: 18},
    topo:   {name: 'World_Topo_Map',                label: 'Esri Topographic',      maxzoom: 16},
    hs:     {name: 'Elevation/World_Hillshade',     label: 'Esri Hillshade',        maxzoom: 16},
    canvas: {name: 'Canvas/World_Light_Gray_Base',  label: 'Esri Light Gray Canvas', maxzoom: 16}
  };
  var ATTR = 'Esri, Vantor, Earthstar Geographics | OpenStreetMap contributors (ODbL) | Copernicus DEM | Nepal COD-AB (CC BY-IGO)';

  function rasterSource(key) {
    return {type: 'raster', tiles: [ESRI + BASEMAPS[key].name + '/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256, maxzoom: BASEMAPS[key].maxzoom, attribution: ATTR};
  }

  /* setTiles cannot change the maxzoom of a source, so switching basemap rebuilds it
     and re-inserts the layer beneath everything else. */
  function setBasemap(key) {
    currentBase = key;
    var below = map.getStyle().layers.filter(function (l) { return l.id !== 'base'; })[0];
    if (map.getLayer('base')) map.removeLayer('base');
    if (map.getSource('base')) map.removeSource('base');
    map.addSource('base', rasterSource(key));
    map.addLayer({id: 'base', type: 'raster', source: 'base'}, below ? below.id : undefined);
  }
  var steepCol = function (v) {
    return v >= 40 ? '#b8392e' : v >= 25 ? '#d99a2b' : v >= 10 ? '#2b8fab' : '#7d8b98';
  };
  var steepLab = function (v) {
    return v >= 40 ? '40% or more' : v >= 25 ? '25–40%' : v >= 10 ? '10–25%' : 'under 10%';
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

  var DATA = null, EVENT = null, DISTRICTS = null, currentBase = 'img';
  var districtMarkers = [], eventMarkers = [];

  Promise.all([
    fetch(BASE + 'mapdata.json', {credentials: 'same-origin'}),
    fetch(BASE + 'event_observations.geojson', {credentials: 'same-origin'}),
    fetch(BASE + 'districts.geojson', {credentials: 'same-origin'})
  ])
    .then(function (responses) {
      responses.forEach(function (r) { if (!r.ok) throw new Error(r.url + ' HTTP ' + r.status); });
      return Promise.all(responses.map(function (r) { return r.json(); }));
    })
    .then(function (d) {
      DATA = d[0]; EVENT = d[1]; DISTRICTS = d[2];
      if (map.isStyleLoaded()) build(); else map.on('load', build);
    })
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
    map.addLayer({id: 'slope', type: 'raster', source: 'slope', layout: {visibility: 'none'},
                  paint: {'raster-opacity': 0.62, 'raster-fade-duration': 0}});

    /* --- quiet district context: official Nepal COD ADM2 boundaries --- */
    map.addSource('districts', {type: 'geojson', data: DISTRICTS});
    map.addLayer({id: 'district-fill', type: 'fill', source: 'districts',
      paint: {
        'fill-color': ['match', ['get', 'name'], 'Rasuwa', '#2b8fab', 'Nuwakot', '#d99a2b', '#7d8b98'],
        'fill-opacity': 0.09
      }});
    map.addLayer({id: 'district-line', type: 'line', source: 'districts',
      paint: {
        'line-color': '#f7fafc', 'line-opacity': 0.78,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 13, 2.2]
      }});
    /* District names are HTML markers, not a symbol layer: the style declares no
       glyphs URL and connect-src forbids fetching one, so text-field cannot render.
       label_lon/label_lat come from the build script and sit inside the polygon. */
    DISTRICTS.features.forEach(function (feature) {
      var pr = feature.properties;
      if (pr.label_lon == null || pr.label_lat == null) return;
      var el = document.createElement('div');
      el.className = 'district-label';
      el.textContent = pr.name;
      districtMarkers.push(new maplibregl.Marker({element: el})
        .setLngLat([pr.label_lon, pr.label_lat]).addTo(map));
    });

    /* --- event evidence: reviewed source and public gauge observations --- */
    map.addSource('event', {type: 'geojson', data: EVENT});
    map.addLayer({id: 'event-gauges', type: 'circle', source: 'event',
      filter: ['==', ['get', 'kind'], 'gauge'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 7],
        'circle-color': ['match', ['get', 'role'], 'mainstem', '#131c25', '#8f5d10'],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-opacity': 0.95
      }});
    map.addLayer({id: 'event-source', type: 'circle', source: 'event',
      filter: ['==', ['get', 'kind'], 'source'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 8, 14, 13],
        'circle-color': '#962c24', 'circle-stroke-color': '#fff',
        'circle-stroke-width': 3, 'circle-opacity': 0.98
      }});

    /* --- 250 m channel buffer (drawn as a wide translucent casing) --- */
    var stemFeatures = DATA.stem.map(function (l) { return line(l); });
    map.addSource('buf', {type: 'geojson', data: fc(stemFeatures)});
    map.addLayer({id: 'buf', type: 'line', source: 'buf',
      layout: {'line-cap': 'round', 'line-join': 'round', visibility: 'none'},
      paint: {'line-color': '#2b8fab', 'line-opacity': 0.28,
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 10, 3.7, 18, 947]}});

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
      layout: {'line-cap': 'round', 'line-join': 'round', visibility: 'none'},
      paint: {'line-color': '#e8a33d',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.3, 16, 4.5]}});

    /* --- river, one feature per segment carrying its reach metrics --- */
    var segs = [];
    DATA.stem.forEach(function (l) {
      for (var i = 0; i < l.length - 1; i++) {
        var r = nearestReach(l[i][0], l[i][1]);
        segs.push(line([l[i], l[i + 1]], {
          col: steepCol(r[5]), km: r[0], z: r[3], steepLab: steepLab(r[5]),
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
      return {type: 'Feature', properties: {d: b[2], fresh: b[3] || 0},
              geometry: {type: 'Point', coordinates: [b[0], b[1]]}};
    }))});
    map.addLayer({id: 'bldg', type: 'circle', source: 'bldg', minzoom: 11,
      layout: {visibility: 'none'},
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.1, 16, 3.4],
        'circle-color': ['step', ['get', 'd'], '#c9423a', 100, '#d68c36', 250, '#78848f'],
        'circle-opacity': 0.85}});
    /* Buildings volunteers digitised since the flood, drawn over the rest so the
       live mapping effort is visible rather than buried in the base count. */
    map.addLayer({id: 'bldg-new', type: 'circle', source: 'bldg', minzoom: 10,
      filter: ['==', ['get', 'fresh'], 1],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.4, 16, 4],
        'circle-color': '#4de1a2', 'circle-opacity': 0.95,
        'circle-stroke-color': '#08301f', 'circle-stroke-width': 0.4}});

    /* --- point layers --- */
    function pts(key, arr, colour, radius, minz) {
      map.addSource(key, {type: 'geojson', data: fc(arr.map(function (p) {
        return {type: 'Feature',
                properties: {n: p.n || 'Unnamed', d: p.d,
                             t: p.high || p.amen || p.aero || p.plac || ''},
                geometry: {type: 'Point', coordinates: [p.x, p.y]}};
      }))});
      map.addLayer({id: key, type: 'circle', source: key, minzoom: minz || 0,
        layout: {visibility: 'none'},
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
    /* Anchors sit on the OSM name node where the extract has one; Syabrubesi has no
       name node, so it keeps its position from the 1 km river chainage sample. */
    var ANCH = [[85.37780, 28.27780, 'Rasuwagadhi / Timure'], [85.32885, 28.15453, 'Syabrubesi'],
                [85.18600, 27.97310, 'Betrawati'], [85.14650, 27.89530, 'Bidur'],
                [85.11010, 27.86000, 'Devighat']];
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
    EVENT.features.forEach(function (feature) {
      if (feature.properties.kind !== 'source') return;
      var el = document.createElement('div');
      el.className = 'event-label';
      el.innerHTML = '<b>USGS glacial-collapse source</b><span>08:37:10 NPT · 5,590 m</span>';
      eventMarkers.push(new maplibregl.Marker({element: el, anchor: 'right', offset: [-13, 0]})
        .setLngLat(feature.geometry.coordinates).addTo(map));
    });

    fitCorridor();
    wireUI();
    wirePopups();
  }

  function fitCorridor() {
    var b = new maplibregl.LngLatBounds();
    DATA.stem.forEach(function (l) { l.forEach(function (p) { b.extend(p); }); });
    EVENT.features.forEach(function (f) {
      if (f.geometry.type === 'Point') b.extend(f.geometry.coordinates);
    });
    map.fitBounds(b, {padding: 46, duration: 0});
  }

  function popupHTML(title, kind, rows) {
    return '<h3>' + esc(title) + '</h3><div class="sub">' + esc(kind) + '</div><dl>' +
      rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>';
  }

  function showEventPopup(feature, location) {
    var p = feature.properties, c = feature.geometry.coordinates;
    var rows = p.kind === 'source' ? [
      ['Time', p.time_npt], ['Elevation', p.elevation_m + ' m'],
      ['Evidence tier', p.evidence_tier], ['Geometry', 'Satellite-estimated source point']
    ] : [
      ['Last sample', p.last_time_npt], ['Last level', Number(p.last_level_m).toFixed(2) + ' m'],
      ['Warning level', Number(p.warning_m).toFixed(2) + ' m'],
      ['Interpretation', p.continued_after_event_window ?
        'Transmission continues beyond chart window' : 'Peak unobserved; no later returned sample']
    ];
    new maplibregl.Popup({closeButton: true, maxWidth: '340px'}).setLngLat(location || c)
      .setHTML(popupHTML(p.label, p.kind === 'source' ? 'USGS reviewed event' : 'Nepal DHM gauge', rows) +
        '<a class="popup-source" href="' + esc(p.source_url) + '">Open source record</a>')
      .addTo(map);
  }

  function wirePopups() {
    ['event-source', 'event-gauges'].forEach(function (layer) {
      map.on('click', layer, function (e) {
        showEventPopup(e.features[0]);
      });
      map.on('mouseenter', layer, function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, function () { map.getCanvas().style.cursor = ''; });
    });
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
          ['Terrain &gt;45° within 500 m', pr.s45 + '% (' + pr.steepLab + ')'],
          ['Relief within 500 m', pr.relief + ' m'],
          ['Channel gradient', pr.grad + ' m/km']])).addTo(map);
    });
    map.on('mouseenter', 'stem', function () { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'stem', function () { map.getCanvas().style.cursor = ''; });
  }

  function wireUI() {
    var segs = {'b-img': 'img', 'b-topo': 'topo', 'b-hs': 'hs', 'b-canvas': 'canvas'};
    Object.keys(segs).forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener('click', function () {
        setBasemap(segs[id]);
        Object.keys(segs).forEach(function (j) {
          var b = $(j); if (b) b.setAttribute('aria-pressed', String(j === id));
        });
      });
    });
    var boxes = {'l-district': ['district-fill', 'district-line'], 'l-bldgnew': 'bldg-new',
                 'l-slope': 'slope', 'l-stem': 'stem', 'l-trib': 'trib', 'l-rmaj': 'rmaj',
                 'l-rmin': 'rmin', 'l-bldg': 'bldg', 'l-brg': 'brg', 'l-edu': 'edu',
                 'l-hlth': 'hlth', 'l-heli': 'heli', 'l-plc': 'plc', 'l-buf': 'buf'};
    Object.keys(boxes).forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener('change', function () {
        var layers = Array.isArray(boxes[id]) ? boxes[id] : [boxes[id]];
        layers.forEach(function (layer) {
          map.setLayoutProperty(layer, 'visibility', el.checked ? 'visible' : 'none');
        });
      });
      var layers = Array.isArray(boxes[id]) ? boxes[id] : [boxes[id]];
      layers.forEach(function (layer) {
        if (map.getLayer(layer)) {
          map.setLayoutProperty(layer, 'visibility', el.checked ? 'visible' : 'none');
        }
      });
    });
    var districtBox = $('l-district');
    function syncDistrictLabels() {
      var shown = !districtBox || districtBox.checked;
      districtMarkers.forEach(function (marker) {
        marker.getElement().style.display = shown ? '' : 'none';
      });
    }
    if (districtBox) districtBox.addEventListener('change', syncDistrictLabels);
    syncDistrictLabels();

    var districtOp = $('districtop');
    function syncDistrictOpacity() {
      if (!districtOp) return;
      var v = districtOp.value / 100;
      map.setPaintProperty('district-fill', 'fill-opacity', v);
      map.setPaintProperty('district-line', 'line-opacity', Math.min(1, 0.20 + v * 3.2));
      var out = $('districtpct');
      if (out) out.textContent = districtOp.value + '%';
    }
    if (districtOp) districtOp.addEventListener('input', syncDistrictOpacity);
    syncDistrictOpacity();

    var eventBox = $('l-event');
    function syncEventLayer() {
      var shown = !eventBox || eventBox.checked;
      ['event-source', 'event-gauges'].forEach(function (layer) {
        map.setLayoutProperty(layer, 'visibility', shown ? 'visible' : 'none');
      });
      eventMarkers.forEach(function (marker) {
        marker.getElement().style.display = shown ? '' : 'none';
      });
    }
    if (eventBox) eventBox.addEventListener('change', syncEventLayer);
    syncEventLayer();
    var op = $('slopeop');
    if (op) op.addEventListener('input', function () {
      map.setPaintProperty('slope', 'raster-opacity', op.value / 100);
    });
    var osm = DATA.osm || {};
    var osmCount = $('osmcount');
    if (osmCount && osm.buildings) osmCount.textContent = osm.buildings.toLocaleString('en-GB');
    var osmNew = $('osmnew');
    if (osmNew && osm.buildings_new) osmNew.textContent = osm.buildings_new.toLocaleString('en-GB');
    var osmWhen = $('osmwhen');
    if (osmWhen && osm.snapshot) osmWhen.textContent = osm.snapshot.slice(0, 16) + ' UTC';
    function setCount(id, value) {
      var el = $(id);
      if (el && value != null) el.textContent = Number(value).toLocaleString('en-GB');
    }
    setCount('roadmajorcount', osm.road_major != null ? osm.road_major : DATA.road_major.length);
    setCount('roadminorcount', osm.road_minor != null ? osm.road_minor : DATA.road_minor.length);
    setCount('bridgecount', osm.bridges != null ? osm.bridges : DATA.bridges.length);
    setCount('educount', DATA.edu.length);
    setCount('healthcount', DATA.health.length);
    setCount('helicount', DATA.helipad.length);
    setCount('placecount', DATA.places.length);

    var pct = $('slopepct');
    if (pct) pct.textContent = (DATA.terrain.pct_over35 * 100).toFixed(0) + '% of area';

    var top = DATA.reach.slice().sort(function (a, b) { return b[5] - a[5]; }).slice(0, 5);
    var NAMES = {16.1: 'At Syabrubesi', 21.2: 'Below Syabrubesi', 27.2: 'Mid gorge',
                 7.1: 'Below Timure', 4: 'Upper Bhote Koshi', 20.1: 'Below Syabrubesi',
                 32.2: 'Lower gorge', 28.2: 'Mid gorge', 33.2: 'Lower gorge', 2: 'Near border'};
    var jump = $('jump');
    if (jump) {
      jump.innerHTML = top.map(function (r, i) {
        return '<button type="button" data-i="' + i + '"><b>' +
          esc(NAMES[r[0]] || ('Chainage ' + r[0] + ' km')) + '</b><br>' +
          '<span class="mono">km ' + r[0] + ' · ' + r[2].toFixed(4) + ', ' + r[1].toFixed(4) +
          '</span><br><span class="bs">' + r[5] + '% of nearby terrain over 45°</span></button>';
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
    var sourceBtn = $('source');
    if (sourceBtn) sourceBtn.addEventListener('click', function () {
      var source = EVENT.features.filter(function (f) { return f.properties.kind === 'source'; })[0];
      map.flyTo({center: source.geometry.coordinates, zoom: 12.7, duration: 900});
      map.once('moveend', function () { showEventPopup(source); });
    });
  }
})();
