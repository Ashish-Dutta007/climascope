/* Trishuli event reconstruction: figures are rendered from the evidence ledger. */
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
  function chart(width, height, title) {
    var el = mk('svg', {viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': title});
    var t = mk('title'); t.textContent = title; el.appendChild(t);
    return el;
  }
  function label(parent, value, attrs) {
    var el = mk('text', attrs); el.textContent = value; parent.appendChild(el); return el;
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"]/g, function (c) {
      return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c];
    });
  }
  function n(value) { return Number(value).toLocaleString('en-GB'); }
  function clock(iso, seconds) {
    var d = new Date(iso);
    return d.toLocaleTimeString('en-GB', {timeZone:'Asia/Kathmandu', hour:'2-digit', minute:'2-digit', second:seconds ? '2-digit' : undefined, hour12:false});
  }
  function minutes(iso) {
    var d = new Date(iso);
    return d.getUTCHours() * 60 + d.getUTCMinutes() + 345;
  }

  function updateCountdown() {
    var el = $('nextpass'); if (!el) return;
    var hours = (PASS - Date.now()) / 3600000;
    if (hours > 1) el.textContent = Math.round(hours) + ' hours';
    else if (hours > 0) el.textContent = Math.max(1, Math.round(hours * 60)) + ' minutes';
    else el.textContent = 'Acquisition window passed';
  }
  updateCountdown(); setInterval(updateCountdown, 60000);

  fetch(BASE + 'event_evidence.json', {credentials:'same-origin'})
    .then(function (response) {
      if (!response.ok) throw new Error('event_evidence.json HTTP ' + response.status);
      return response.json();
    })
    .then(render)
    .catch(function (error) {
      ['reliefchart', 'telemetrychart', 'gauge-table'].forEach(function (id) {
        if ($(id)) $(id).textContent = 'Evidence figure unavailable: ' + error.message;
      });
    });

  function render(data) {
    $('event-time').textContent = clock(data.event.time_npt, true) + ' NPT';
    $('source-elevation').textContent = n(data.event.source_elevation_m) + ' m';
    $('source-relief').textContent = n(data.event.relief_to_rasuwagadhi_m) + ' m';
    renderRelief(data.event);
    renderTelemetry(data);
    renderGaugeTable(data.gauges);
  }

  function renderRelief(event) {
    var root = $('reliefchart'); if (!root) return;
    var W = 920, H = 300, L = 75, R = 55, T = 36, B = 54;
    var plotH = H - T - B;
    var y = function (elev) { return T + (6000 - elev) / 5000 * plotH; };
    var sourceX = L + 65, borderX = W - R - 65;
    var svg = chart(W, H, 'Endpoint elevation comparison between the USGS landslide source and Rasuwagadhi gauge');

    [1000, 2000, 3000, 4000, 5000, 6000].forEach(function (v) {
      svg.appendChild(mk('line', {x1:L, x2:W-R, y1:y(v), y2:y(v), stroke:'var(--line)', 'stroke-width':1}));
      label(svg, n(v), {x:L-10, y:y(v)+4, fill:'var(--muted)', 'font-size':10, 'text-anchor':'end', 'font-family':'Plex Mono, monospace'});
    });
    svg.appendChild(mk('polygon', {
      points:sourceX+','+y(event.source_elevation_m)+' '+borderX+','+y(event.rasuwagadhi_elevation_m)+' '+borderX+','+y(1000)+' '+sourceX+','+y(1000),
      fill:'var(--accent)', opacity:.12
    }));
    svg.appendChild(mk('line', {x1:sourceX, y1:y(event.source_elevation_m), x2:borderX, y2:y(event.rasuwagadhi_elevation_m), stroke:'var(--accent)', 'stroke-width':3, 'stroke-dasharray':'8 6'}));
    [[sourceX, y(event.source_elevation_m), 'var(--crit)'], [borderX, y(event.rasuwagadhi_elevation_m), 'var(--accent)']].forEach(function (p) {
      svg.appendChild(mk('circle', {cx:p[0], cy:p[1], r:7, fill:p[2], stroke:'var(--panel)', 'stroke-width':3}));
    });

    label(svg, 'USGS LANDSLIDE SOURCE', {x:sourceX, y:y(event.source_elevation_m)-18, fill:'var(--ink)', 'font-size':11, 'text-anchor':'middle', 'font-family':'Archivo, sans-serif'});
    label(svg, n(event.source_elevation_m)+' m', {x:sourceX, y:y(event.source_elevation_m)+25, fill:'var(--crit)', 'font-size':15, 'font-weight':600, 'text-anchor':'middle', 'font-family':'Plex Mono, monospace'});
    label(svg, 'RASUWAGADHI GAUGE', {x:borderX, y:y(event.rasuwagadhi_elevation_m)-18, fill:'var(--ink)', 'font-size':11, 'text-anchor':'middle', 'font-family':'Archivo, sans-serif'});
    label(svg, n(event.rasuwagadhi_elevation_m)+' m', {x:borderX, y:y(event.rasuwagadhi_elevation_m)+25, fill:'var(--accent-ink)', 'font-size':15, 'font-weight':600, 'text-anchor':'middle', 'font-family':'Plex Mono, monospace'});

    var midX = (sourceX + borderX) / 2, midY = (y(event.source_elevation_m) + y(event.rasuwagadhi_elevation_m)) / 2;
    svg.appendChild(mk('rect', {x:midX-105, y:midY-26, width:210, height:52, fill:'var(--panel)', stroke:'var(--line)'}));
    label(svg, n(event.relief_to_rasuwagadhi_m)+' m RELIEF', {x:midX, y:midY-3, fill:'var(--ink)', 'font-size':15, 'font-weight':600, 'text-anchor':'middle', 'font-family':'Plex Mono, monospace'});
    label(svg, event.straight_distance_to_rasuwagadhi_km+' km straight-line separation', {x:midX, y:midY+16, fill:'var(--muted)', 'font-size':10, 'text-anchor':'middle', 'font-family':'Archivo, sans-serif'});
    label(svg, 'Schematic endpoint connection only - not an inferred flow path', {x:(L+W-R)/2, y:H-13, fill:'var(--muted)', 'font-size':10, 'text-anchor':'middle', 'font-family':'Archivo, sans-serif'});
    root.appendChild(svg);
  }

  function renderTelemetry(data) {
    var root = $('telemetrychart'); if (!root) return;
    var gauges = data.gauges;
    var W = 920, rowH = 37, L = 180, R = 34, T = 48, H = T + gauges.length * rowH + 38;
    var start = 8*60+30, end = 9*60+30;
    var x = function (m) { return L + (m-start)/(end-start)*(W-L-R); };
    var svg = chart(W, H, 'Last received Nepal DHM gauge samples around the 26 August mass movement');
    [510, 525, 540, 555, 570].forEach(function (m) {
      svg.appendChild(mk('line', {x1:x(m), x2:x(m), y1:T-12, y2:T+gauges.length*rowH, stroke:'var(--line)', 'stroke-width':1}));
      label(svg, String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'), {x:x(m), y:20, fill:'var(--muted)', 'font-size':10, 'text-anchor':'middle', 'font-family':'Plex Mono, monospace'});
    });
    var eventMinute = 8*60+37+10/60;
    svg.appendChild(mk('line', {x1:x(eventMinute), x2:x(eventMinute), y1:T-18, y2:T+gauges.length*rowH, stroke:'var(--crit)', 'stroke-width':2}));
    label(svg, 'USGS 08:37:10', {x:x(eventMinute)+6, y:35, fill:'var(--crit)', 'font-size':10, 'font-weight':600, 'font-family':'Plex Mono, monospace'});

    gauges.forEach(function (g, i) {
      var yy = T + i*rowH + 14;
      var last = minutes(g.last_sample.time_npt);
      var colour = g.role === 'mainstem' ? 'var(--accent)' : 'var(--amber)';
      label(svg, g.name, {x:L-12, y:yy+4, fill:'var(--ink-2)', 'font-size':11, 'text-anchor':'end', 'font-family':'Archivo, sans-serif'});
      svg.appendChild(mk('line', {x1:x(start), x2:x(last), y1:yy, y2:yy, stroke:colour, 'stroke-width':5}));
      svg.appendChild(mk('rect', {x:x(last), y:yy-5, width:Math.max(0,x(end)-x(last)), height:10, fill:'var(--line-soft)'}));
      svg.appendChild(mk('circle', {cx:x(last), cy:yy, r:6, fill:colour, stroke:'var(--panel)', 'stroke-width':2}));
      label(svg, clock(g.last_sample.time_npt, false)+'  '+g.last_sample.level_m.toFixed(2)+' m', {x:Math.min(x(last)+9,W-R-95), y:yy+4, fill:'var(--ink)', 'font-size':10, 'font-family':'Plex Mono, monospace'});
    });
    label(svg, 'received samples', {x:L, y:H-10, fill:'var(--accent-ink)', 'font-size':9.5, 'font-family':'Archivo, sans-serif'});
    label(svg, 'no later sample in DHM response', {x:W-R, y:H-10, fill:'var(--muted)', 'font-size':9.5, 'text-anchor':'end', 'font-family':'Archivo, sans-serif'});
    root.appendChild(svg);
  }

  function renderGaugeTable(gauges) {
    var root = $('gauge-table'); if (!root) return;
    root.innerHTML = '<div class="g-row g-head"><span>Station</span><span>Last sample</span><span>Level</span><span>Warning</span></div>' +
      gauges.map(function (g) {
        return '<div class="g-row"><span><b>'+esc(g.name)+'</b><small>'+esc(g.role)+'</small></span>'+
          '<span class="mono">'+esc(clock(g.last_sample.time_npt, false))+' NPT</span>'+
          '<span class="mono">'+g.last_sample.level_m.toFixed(2)+' m</span>'+
          '<span class="mono">'+Number(g.warning_m).toFixed(2)+' m</span></div>';
      }).join('');
  }
})();
