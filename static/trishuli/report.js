/* Trishuli living brief: small, data-backed figures only. */
(function () {
  'use strict';
  var BASE = document.currentScript ? document.currentScript.dataset.base : '';
  var PASS = Date.UTC(2026, 7, 28, 12, 21, 41);
  var NS = 'http://www.w3.org/2000/svg';

  function $(id) { return document.getElementById(id); }
  function mk(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (key) { el.setAttribute(key, attrs[key]); });
    return el;
  }
  function svg(width, height, title) {
    var el = mk('svg', {viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': title});
    var t = mk('title', {});
    t.textContent = title;
    el.appendChild(t);
    return el;
  }
  function textNode(parent, value, attrs) {
    var el = mk('text', attrs);
    el.textContent = value;
    parent.appendChild(el);
    return el;
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"]/g, function (c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c];
    });
  }
  function steepColour(value) {
    return value >= 40 ? '#a83b32' : value >= 25 ? '#d28b35' : value >= 10 ? '#25839d' : '#7d8994';
  }
  function updateCountdown() {
    var el = $('nextpass');
    if (!el) return;
    var hours = (PASS - Date.now()) / 3600000;
    if (hours > 1) el.textContent = Math.round(hours) + ' hours';
    else if (hours > 0) el.textContent = Math.max(1, Math.round(hours * 60)) + ' minutes';
    else el.textContent = 'Acquisition window passed';
  }
  updateCountdown();
  setInterval(updateCountdown, 60000);

  fetch(BASE + 'payload.json', {credentials: 'same-origin'})
    .then(function (response) {
      if (!response.ok) throw new Error('payload.json HTTP ' + response.status);
      return response.json();
    })
    .then(render)
    .catch(function (error) {
      ['exposure', 'profile', 'rainchart'].forEach(function (id) {
        var el = $(id);
        if (el) el.textContent = 'Figure unavailable: ' + error.message;
      });
    });

  function render(data) {
    renderExposure(data);
    renderProfile(data);
    renderRain(data);
  }

  function renderExposure(data) {
    var root = $('exposure');
    if (!root) return;
    var wanted = ['Buildings (OSM)', 'Bridges', 'Schools', 'Health facilities'];
    var rows = data.exposure.filter(function (row) { return wanted.indexOf(row.layer) !== -1; });
    root.innerHTML = rows.map(function (row) {
      var pct = row.total ? Math.min(100, row.b250 / row.total * 100) : 0;
      return '<div class="ex-row">' +
        '<div class="ex-name">' + esc(row.layer.replace(' (OSM)', '')) + '</div>' +
        '<div class="ex-track" title="' + row.b250.toLocaleString() + ' of ' + row.total.toLocaleString() + ' mapped features within 250 m">' +
          '<span class="ex-total" style="width:100%"></span>' +
          '<span class="ex-near" style="width:' + pct.toFixed(1) + '%"></span>' +
        '</div>' +
        '<div class="ex-value">' + row.b250.toLocaleString() + ' <small>/ ' + row.total.toLocaleString() + '</small></div>' +
      '</div>';
    }).join('');
  }

  function renderProfile(data) {
    var root = $('profile');
    if (!root) return;
    var rows = data.reaches;
    var W = 920, H = 300, L = 58, R = 18, T = 28, plotH = 180, stripY = 232;
    var maxKm = Math.max.apply(null, rows.map(function (d) { return d.km; }));
    var x = function (v) { return L + v / maxKm * (W - L - R); };
    var y = function (v) { return T + plotH - (v - 400) / (1850 - 400) * plotH; };
    var chart = svg(W, H, 'Elevation profile and nearby steep terrain along the mapped river corridor');

    [500, 900, 1300, 1700].forEach(function (v) {
      chart.appendChild(mk('line', {x1:L, x2:W-R, y1:y(v), y2:y(v), stroke:'var(--line)', 'stroke-width':1}));
      textNode(chart, v, {x:L-8, y:y(v)+4, fill:'var(--muted)', 'font-size':10, 'text-anchor':'end', 'font-family':'Plex Mono, monospace'});
    });
    var points = rows.map(function (d) { return x(d.km) + ',' + y(d.z); }).join(' ');
    chart.appendChild(mk('polygon', {points:L+','+(T+plotH)+' '+points+' '+x(maxKm)+','+(T+plotH), fill:'var(--accent)', opacity:.12}));
    chart.appendChild(mk('polyline', {points:points, fill:'none', stroke:'var(--accent)', 'stroke-width':2}));

    var bw = (W-L-R) / rows.length;
    rows.forEach(function (d, i) {
      var rect = mk('rect', {x:L+i*bw, y:stripY, width:bw+.5, height:18, fill:steepColour(d.s45)});
      var title = mk('title', {});
      title.textContent = 'River km ' + d.km + ': ' + d.s45 + '% of nearby terrain above 45 degrees; relief ' + d.relief + ' m';
      rect.appendChild(title);
      chart.appendChild(rect);
    });
    textNode(chart, 'SHARE OF TERRAIN >45 DEGREES WITHIN 500 M', {x:L, y:stripY-7, fill:'var(--muted)', 'font-size':9, 'font-family':'Archivo, sans-serif'});
    [0, 10, 20, 30, 40, 50, 60].forEach(function (v) {
      textNode(chart, v, {x:x(v), y:H-12, fill:'var(--muted)', 'font-size':10, 'text-anchor':'middle', 'font-family':'Plex Mono, monospace'});
    });
    [['Rasuwagadhi',0], ['Syabrubesi',16.1], ['Betrawati',45.3], ['Bidur',61.4]].forEach(function (item) {
      chart.appendChild(mk('line', {x1:x(item[1]), x2:x(item[1]), y1:T, y2:T+plotH, stroke:'var(--ink-2)', 'stroke-width':.7, 'stroke-dasharray':'2 3', opacity:.5}));
      textNode(chart, item[0], {x:x(item[1])+4, y:T+12, fill:'var(--ink-2)', 'font-size':9.5, 'font-family':'Archivo, sans-serif'});
    });
    textNode(chart, 'river km downstream of border', {x:W-R, y:H-12, fill:'var(--muted)', 'font-size':9.5, 'text-anchor':'end', 'font-family':'Archivo, sans-serif'});
    root.appendChild(chart);
  }

  function renderRain(data) {
    var root = $('rainchart');
    if (!root) return;
    var source = data.rain_tibet.map(function (d) { return Object.assign({}, d, {group:'Sampled source area'}); });
    var corridor = data.rain_corridor.slice(0, 5).map(function (d) { return Object.assign({}, d, {group:'Nepal corridor'}); });
    var rows = source.concat(corridor);
    var W = 920, rowH = 24, L = 175, R = 72, T = 42, H = T + rows.length * rowH + 36;
    var max = Math.max.apply(null, rows.map(function (d) { return d.p72; }));
    var x = function (v) { return L + v / max * (W-L-R); };
    var chart = svg(W, H, 'Archived model forecast precipitation at sampled source and corridor grid locations');

    [0, 10, 20, 30, 40, 50, 60].filter(function (v) { return v <= max; }).forEach(function (v) {
      chart.appendChild(mk('line', {x1:x(v), x2:x(v), y1:T-8, y2:T+rows.length*rowH, stroke:'var(--line)', 'stroke-width':1}));
      textNode(chart, v, {x:x(v), y:H-10, fill:'var(--muted)', 'font-size':10, 'text-anchor':'middle', 'font-family':'Plex Mono, monospace'});
    });
    var group = '';
    rows.forEach(function (d, i) {
      var y = T + i * rowH;
      if (d.group !== group) {
        group = d.group;
        textNode(chart, group.toUpperCase(), {x:4, y:y-7, fill:'var(--muted)', 'font-size':9, 'font-family':'Archivo, sans-serif'});
      }
      textNode(chart, d.site, {x:L-9, y:y+15, fill:'var(--ink-2)', 'font-size':10.5, 'text-anchor':'end', 'font-family':'Archivo, sans-serif'});
      var bar = mk('rect', {x:L, y:y+5, width:Math.max(2, x(d.p72)-L), height:12, fill:d.group === 'Nepal corridor' ? 'var(--accent)' : 'var(--amber)', opacity:.82});
      var title = mk('title', {});
      title.textContent = d.site + ': ' + d.p72 + ' mm in 72 hours; model grid at ' + d.lat + ', ' + d.lon;
      bar.appendChild(title);
      chart.appendChild(bar);
      textNode(chart, d.p72.toFixed(1), {x:x(d.p72)+6, y:y+15, fill:'var(--ink)', 'font-size':10, 'font-family':'Plex Mono, monospace'});
    });
    textNode(chart, 'modelled precipitation in 72 hours (mm)', {x:L, y:17, fill:'var(--ink)', 'font-size':11, 'font-family':'Archivo, sans-serif'});
    root.appendChild(chart);
  }
})();
