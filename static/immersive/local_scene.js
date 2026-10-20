(function () {
  'use strict';
  var profile = window.ClimaScopeProfile;
  var metrics = ['Tmax_mean', 'Prec_sum', 'CWBPT'];
  var colours = ['#f4d06f', '#69d4bd', '#91b7ed'];
  var map, mapReady, mapNode, mapBox, mapHost, lastRegion;
  var tileFailed = false;
  var future = '2050-2079', baseline = '1990-2019';
  function esc(s) { return profile.escape(s); }
  function fmt(v) { return v == null ? '—' : (Math.abs(v) < .05 ? '0.0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1)); }
  function change(data, metric, month) {
    if (!data) return null;
    var values = data.metrics[metric].values, a = values[baseline][month - 1], b = values[future][month - 1];
    return a == null || b == null ? null : b - a;
  }
  function comparisons(region, member, local) {
    if (region.kind !== 'cell') return Promise.resolve([]);
    var areas = ['catchment', 'council'].filter(function (kind) { return region[kind]; })
      .map(function (kind) { return {kind:kind, name:region[kind], scope:kind + ':' + region[kind]}; });
    if (!areas.length) areas.push({kind:'national', name:'Scotland', scope:'national'});
    return Promise.all(areas.map(function (area) {
      return profile.load(area.scope, member).then(function (data) {
        if (!local.data_version || data.data_version !== local.data_version) {
          profile.forget(local.scope, member);
          profile.forget(area.scope, member);
          throw new Error('Cell and area climate summaries need to be rebuilt together');
        }
        return Object.assign({}, area, {data:data});
      }).catch(function (error) {
        if (error.status === 404) return Object.assign({}, area, {data:null});
        throw error;
      });
    }));
  }
  function dots(values, units, annual) {
    var finite = annual.filter(function (v) { return v != null; });
    var lo = Math.min.apply(null, [0].concat(finite)), hi = Math.max.apply(null, [0].concat(finite));
    var span = hi - lo || 1;
    if (lo < 0) lo -= span * .1;
    if (hi > 0) hi += span * .1;
    if (lo === hi) { lo -= .5; hi += .5; }
    function x(v) { return 65 + (v - lo) / (hi - lo) * 1070; }
    var html = '<svg class="near-dots" viewBox="0 0 1200 48" role="img" aria-label="Change from baseline in ' + esc(units) + '">' +
      '<path d="M65 15H1135" stroke="#506078" stroke-width="1"/>' +
      '<path d="M' + x(0) + ' 0V29" stroke="#c1ccdd" stroke-width="1"/>';
    values.forEach(function (v, i) {
      if (v == null) return;
      html += '<circle cx="' + x(v) + '" cy="' + (6 + i * 9) + '" r="' + (i === 0 ? 5 : 4) + '" fill="' + colours[i] + '" stroke="#101827" stroke-width="1"/>';
    });
    html += '<text x="65" y="44">' + fmt(lo) + '</text><text x="1135" y="44" text-anchor="end">' + fmt(hi) + ' ' + esc(units) + '</text>';
    if (x(0) > 165 && x(0) < 1035) html += '<text x="' + x(0) + '" y="44" text-anchor="middle">0</text>';
    return html + '</svg>';
  }
  function buildComparison(frame, data, areas) {
    var region = frame.region, month = frame.month;
    var root = document.createElement('section'); root.className = 'near-comparison';
    var entries = [{kind:'cell', name:region.name, data:data}].concat(areas);
    root.innerHTML = '<h2>Nearby comparison</h2><p class="near-period">' + profile.months[month - 1] +
      ' change · 2050–2079 minus 1990–2019</p>' +
      '<div class="near-area-key">' + entries.map(function (entry, i) {
        var label = entry.kind === 'cell' ? 'Here' : entry.kind === 'national' ? 'Scotland mean' : entry.kind === 'council' ? 'Council mean' : 'Catchment mean';
        return '<div style="color:' + colours[i] + '"><strong>' + label + '</strong><span>' + esc(entry.name) + '</span></div>';
      }).join('') + '</div>' +
      metrics.map(function (metric) {
        var m = data.metrics[metric];
        var values = entries.map(function (entry) { return change(entry.data, metric, month); });
        var annual = entries.flatMap(function (entry) {
          return profile.months.map(function (_, i) { return change(entry.data, metric, i + 1); });
        });
        return '<section class="near-metric" data-metric="' + metric + '"><h3>' + esc(m.label) + '</h3>' +
          '<div class="near-values">' + entries.map(function (entry, i) {
            var scope = entry.kind === 'cell' ? data.scope : entry.scope;
            return '<strong data-scope="' + esc(scope) + '" data-value="' + (values[i] == null ? '' : values[i]) +
              '" style="color:' + colours[i] + '">' + fmt(values[i]) + '<small> ' + esc(m.units) + '</small></strong>';
          }).join('') + '</div>' + dots(values, m.units, annual) + '</section>';
      }).join('') +
      '<p class="near-method">Area means: valid 1 km cells, equally weighted. ' +
      esc(frame.member === 'mean' ? 'Ensemble mean.' : 'Member ' + frame.member + '.') +
      (areas.some(function (area) { return !area.data; }) ? ' — No area data.' : '') + '</p>';
    root.style.setProperty('--near-columns', entries.length);
    return root;
  }
  function createMap() {
    mapNode = document.createElement('div'); mapNode.className = 'near-map-inner';
    mapHost = document.createElement('div'); mapHost.className = 'near-map-host';
    mapHost.appendChild(mapNode);
    map = new maplibregl.Map({container:mapNode, interactive:false, attributionControl:true, fadeDuration:0,
      style:{version:8, sources:{base:{type:'raster', tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],tileSize:256,attribution:'© Esri'},
        labels:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'],tileSize:256}},
        layers:[{id:'base',type:'raster',source:'base'},{id:'labels',type:'raster',source:'labels'}]},
      center:[-3.5,56.5],zoom:9});
    map.on('error',function () { tileFailed = true; });
    mapReady = new Promise(function (resolve) { map.once('style.load',resolve); });
  }
  function resize() {
    if (!map || !mapBox || !mapBox.isConnected || !mapBox.clientWidth) return;
    // Render at a smaller logical size so raster place labels remain readable
    // at wall scale. Climate geometry still uses its original coordinates.
    var scale = 3 * parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u'));
    scale = Math.max(.6, scale || 3);
    mapNode.style.width = mapBox.clientWidth / scale + 'px';
    mapNode.style.height = mapBox.clientHeight / scale + 'px';
    mapNode.style.transform = 'scale(' + scale + ')';
    map.resize();
    if (lastRegion) {
      var r = lastRegion;
      map.fitBounds([[r.longitude - .12,r.latitude - .065],[r.longitude + .12,r.latitude + .065]],{padding:12,duration:0});
    }
  }
  function paintMap(region, box, isCurrent) {
    mapBox = box;
    mapBox.dataset.cell = region.id;
    mapBox.dataset.longitude = region.longitude;
    mapBox.dataset.latitude = region.latitude;
    if (!map) createMap();
    mapBox.prepend(mapHost);
    return mapReady.then(function () {
      if (!isCurrent()) return {};
      lastRegion = region; tileFailed = false;
      var cell = {type:'Feature',properties:{},geometry:region.geometry};
      var point = {type:'Feature',properties:{},geometry:{type:'Point',coordinates:[region.longitude,region.latitude]}};
      if (!map.getSource('cell')) {
        map.addSource('cell',{type:'geojson',data:cell});
        map.addLayer({id:'cell-fill',type:'fill',source:'cell',paint:{'fill-color':'#f4d06f','fill-opacity':.16}});
        map.addLayer({id:'cell-line',type:'line',source:'cell',paint:{'line-color':'#f4d06f','line-width':2}});
        map.addSource('point',{type:'geojson',data:point});
        map.addLayer({id:'point',type:'circle',source:'point',paint:{'circle-radius':4,'circle-color':'#f4d06f','circle-stroke-width':2,'circle-stroke-color':'#101827'}});
      } else {
        map.getSource('cell').setData(cell); map.getSource('point').setData(point);
      }
      resize();
      return new Promise(function (resolve) {
        var timer = setTimeout(function () { finish(); },5000);
        function finish() { clearTimeout(timer); map.off('idle',finish); resolve({mapWarning:tileFailed}); }
        map.once('idle',finish); map.triggerRepaint();
      });
    });
  }
  function build(frame, data, areas, locator) {
    var region = frame.region;
    var place = document.createElement('aside'); place.className = 'local-place';
    place.innerHTML = '<h1>' + esc(region.kind ? region.name : 'Scotland') + '</h1><p>' +
      profile.months[frame.month - 1] + ' · ' + esc(frame.member === 'mean' ? 'Ensemble mean' : 'Member ' + frame.member) + '</p>' +
      '<p>' + esc(region.kind === 'cell' ? (region.distance_m ? 'Nearest 1 km climate cell, ' + region.distance_m + ' m away' : '1 km climate cell') + ' · ' + (region.council || 'Scotland') : data.method) + '</p>' +
      (region.kind === 'cell' ? '<div class="near-map"><div class="near-inset">' + locator + '</div></div>' : '<div class="local-locator">' + locator + '</div>') +
      (region.catchment ? '<p class="near-catchment">' + esc(region.catchment) + ' · catchment</p>' : '') +
      '<p class="local-status" role="status"></p>';
    var content = document.createElement('section'); content.className = 'local-content';
    profile.render(content, data, {month:frame.month,wall:true});
    return {nodes:region.kind === 'cell' ? [place, content, buildComparison(frame,data,areas)] : [place,content],
      drawMap:function (isCurrent) {
        if (region.kind !== 'cell') return Promise.resolve({});
        try { return paintMap(region,place.querySelector('.near-map'),isCurrent).catch(function () { return {mapWarning:true}; }); }
        catch (error) { return Promise.resolve({mapWarning:true}); }
      }};
  }
  window.ClimaScopeLocalScene = {comparisons:comparisons,build:build,resize:resize};
})();
