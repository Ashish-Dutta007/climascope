(function () {
  'use strict';

  /*
   * ClimaScope wall display (/immersive).
   *
   * The wall is the single authority for what is shown and for playback. The
   * controller (/immersive/control) sends commands over the paired remote relay and
   * mirrors the state the wall reports back, so a hidden or throttled
   * controller tab never drives unattended playback.
   *
   * Every change is staged: map values, regional summaries and region geometry
   * are loaded first, then committed together with the month / region /
   * ensemble labels. A frame counts as ready only once all nine maps have
   * rendered; playback dwell starts from that point. On failure the previous
   * frame stays up with its own labels, and playback pauses with a message.
   *
   * Kiosk URL options:
   *   ?safe=<px>   bottom band kept clear of essential text (default 56)
   *   ?dwell=<s>   seconds per month during playback (default 6)
   *   ?autoplay=1  start playing on load
   *   ?fresh=1     ignore the state saved from the last session
   */

  var MONTH_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH_LONG  = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

  // Three periods left→right in each group. Colours and dash patterns are
  // shared by every chart on the wall so the mapping is learned once.
  var BASELINE_ID = '1990-2019';
  var PERIODS = [
    { id: '1990-2019', label: 'Observed baseline · 1990–2019', short: '1990–2019', color: '#9db7e8', dash: null },
    { id: '2020-2049', label: '2020–2049 projection',          short: '2020–2049', color: '#f2c94c', dash: '3 2.2' },
    { id: '2050-2079', label: '2050–2079 projection',          short: '2050–2079', color: '#ff6b35', dash: null },
  ];
  var FUTURES = PERIODS.slice(1);

  // method records how the water balance was derived (PT); it is kept as the
  // short code on the wall because the method expansion is not yet confirmed.
  var PANELS = [
    { id: 'CWBPT',     title: 'Climate water balance',          code: 'CWB PT', method: 'PT',
      units: 'mm', per: 'mm per month', type: 'balance' },
    { id: 'Prec_sum',  title: 'Precipitation',                  code: 'Prec',
      units: 'mm', per: 'mm per month', type: 'volume' },
    { id: 'Tmax_mean', title: 'Mean daily maximum temperature', code: 'Tmax',
      units: '°C', per: '°C',           type: 'temperature' },
  ];

  var VALID_MEMBERS = ['01', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '15'];
  var SUMMARY_BASE  = '/static/immersive/summaries/v2/';
  var SUMMARY_V     = document.body.getAttribute('data-summary-v') || '0';
  var CHANNEL_NAME  = 'climascope-immersive';
  var STORE_KEY     = 'climascope-immersive-wall-v2';
  var READY_TIMEOUT_MS = 20000;

  var SCOTLAND_BOUNDS = [[-7.7, 54.6], [-0.7, 60.9]];
  var BG_COLOR     = '#0d0f1a';
  var NODATA_COLOR = '#4a4f66';

  // World ring used as the outer boundary of every mask feature.
  var WORLD_RING = [[-180, -90], [-180, 90], [180, 90], [180, -90], [-180, -90]];

  // World polygon with the Scotland bbox as a hole — the default mask.
  var FOG_FEATURE = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        WORLD_RING,
        [[-7.7, 54.6], [-0.7, 54.6], [-0.7, 60.9], [-7.7, 60.9], [-7.7, 54.6]],
      ],
    },
  };

  var SCOTLAND_REGION = { kind: null, name: 'All Scotland', bounds: null, geometry: null };

  var params = new URLSearchParams(window.location.search);
  function numParam(name, dflt, lo, hi) {
    var v = parseFloat(params.get(name));
    return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
  }

  // ── Scale ──────────────────────────────────────────────────────────
  // Sizes are authored for a 1200 px tall wall (u = 1). Smaller windows scale
  // proportionally so the layout can be previewed; the wall itself is 1:1.

  var _u = 1;
  function applyScale() {
    _u = Math.min(1, window.innerHeight / 1200, window.innerWidth / 11514);
    var root = document.documentElement.style;
    root.setProperty('--u', _u.toFixed(4) + 'px');
    root.setProperty('--safe', String(numParam('safe', 56, 0, 400)));
  }

  // ── Geometry helpers ───────────────────────────────────────────────

  // Exterior rings of a Polygon / MultiPolygon (holes ignored: councils and
  // catchments rarely have them, and the mask only needs the outline).
  function exteriorRings(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') {
      return geometry.coordinates.length ? [geometry.coordinates[0]] : [];
    }
    if (geometry.type === 'MultiPolygon') {
      var rings = [];
      geometry.coordinates.forEach(function (poly) {
        if (poly.length) rings.push(poly[0]);
      });
      return rings;
    }
    return [];
  }

  // Mask feature covering the world except the region.
  function buildMaskFeature(geometry) {
    var rings = exteriorRings(geometry);
    if (!rings.length) return FOG_FEATURE;
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [WORLD_RING].concat(rings) },
    };
  }

  function geomBbox(geometry) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    exteriorRings(geometry).forEach(function (ring) {
      ring.forEach(function (c) {
        if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1];
      });
    });
    return isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
  }

  // Rings with their bboxes, for point-in-polygon tests during overlay placement.
  function indexRings(geometries) {
    var out = [];
    geometries.forEach(function (g) {
      exteriorRings(g).forEach(function (ring) {
        var b = geomBbox({ type: 'Polygon', coordinates: [ring] });
        if (b) out.push({ ring: ring, b: b });
      });
    });
    return out;
  }

  function insideAny(lng, lat, rings) {
    for (var k = 0; k < rings.length; k++) {
      var r = rings[k], b = r.b;
      if (lng < b[0][0] || lng > b[1][0] || lat < b[0][1] || lat > b[1][1]) continue;
      var ring = r.ring, inside = false;
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }

  // Small catchments (79 are under 0.01°) are widened to a minimum span
  // around their centre so they can still be framed.
  function padBounds(bounds, minSpan) {
    if (!bounds || !bounds[0] || !bounds[1]) return bounds;
    var w = bounds[0][0], s = bounds[0][1], e = bounds[1][0], n = bounds[1][1];
    var cx = (w + e) / 2, cy = (s + n) / 2;
    var hx = Math.max(e - w, minSpan) / 2, hy = Math.max(n - s, minSpan) / 2;
    return [[cx - hx, cy - hy], [cx + hx, cy + hy]];
  }

  // Same sanity clamp as the controller — defence in depth on the receive side.
  function regionBoundsSane(bounds) {
    var w = bounds && bounds[0] && bounds[0][0], s = bounds && bounds[0] && bounds[0][1];
    var e = bounds && bounds[1] && bounds[1][0], n = bounds && bounds[1] && bounds[1][1];
    return isFinite(w) && isFinite(s) && isFinite(e) && isFinite(n)
      && (e - w) >= 0.01 && (n - s) >= 0.01
      && w >= -8.0 && e <= 0.5 && s >= 54.0 && n <= 62.0;
  }

  // ── Formatting ─────────────────────────────────────────────────────

  function round1(v) {
    var r = Math.round(v * 10) / 10;
    return r === 0 ? 0 : r;   // no "−0.0"
  }

  // Absolute values: no leading plus; negative balances keep their sign.
  function fmtAbs(v) {
    if (v == null || !isFinite(v)) return '—';
    var r = round1(v);
    return (r < 0 ? '−' : '') + Math.abs(r).toFixed(1);
  }

  // Changes are always signed.
  function fmtDelta(v) {
    if (v == null || !isFinite(v)) return '—';
    var r = round1(v);
    if (r === 0) return '0.0';
    return (r > 0 ? '+' : '−') + Math.abs(r).toFixed(1);
  }

  function fmtTick(v, step, signed) {
    var dp = step < 1 ? (step < 0.1 ? 2 : 1) : 0;
    var r = Number(v.toFixed(dp));
    if (r === 0) return '0';
    var s = Math.abs(r).toFixed(dp);
    return (r < 0 ? '−' : (signed ? '+' : '')) + s;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function niceStep(span, n) {
    var raw = span / Math.max(1, n);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var r = raw / mag;
    return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
  }

  // ── Colour scales: fixed per metric for the whole annual loop ──────
  // Domains come from the summaries artifact (ensemble-mean cells over all
  // months and periods); values beyond them are drawn at the end colour.

  function colorStops(panel, dom) {
    var lo = dom.lo, hi = dom.hi, mid = dom.median;
    var stops;
    if (panel.type === 'balance' && lo < 0 && hi > 0) {
      stops = [[lo, '#b2182b'], [lo / 2, '#ef8a62'], [0, '#f7f7f7'],
               [hi * 0.15, '#92c5de'], [hi * 0.45, '#4393c3'], [hi, '#2166ac']];
    } else if (panel.type === 'temperature') {
      stops = [[lo, '#313695'], [(lo + mid) / 2, '#74add1'], [mid, '#ffffbf'],
               [(mid + hi) / 2, '#f46d43'], [hi, '#a50026']];
    } else {
      stops = [[lo, '#ffffcc'], [(lo + mid) / 2, '#a1dab4'], [mid, '#41b6c4'],
               [(mid + hi) / 2, '#225ea8'], [hi, '#0c2c84']];
    }
    return stops.filter(function (s, i) { return i === 0 || s[0] > stops[i - 1][0]; });
  }

  function buildColorExpr(stops) {
    var fs = ['feature-state', 'value'];
    var interp = ['interpolate', ['linear'], fs];
    stops.forEach(function (s) { interp.push(s[0], s[1]); });
    return ['case', ['==', fs, null], NODATA_COLOR, interp];
  }

  function legendHTML(panel, dom) {
    var stops = colorStops(panel, dom);
    var lo = dom.lo, hi = dom.hi, span = hi - lo;
    function pct(v) { return ((v - lo) / span * 100); }
    var grad = 'linear-gradient(to right,' + stops.map(function (s) {
      return s[1] + ' ' + pct(s[0]).toFixed(1) + '%';
    }).join(',') + ')';

    var step = niceStep(span, 4);
    var loLabel = fmtTick(lo, step), hiLabel = fmtTick(hi, step);
    // Label extents in % of the bar (~13 px per 22 px digit on a ~350 px bar).
    function halfW(label) { return label.length * 1.9; }
    var taken = [[0, 2 * halfW(loLabel) + 2], [100 - 2 * halfW(hiLabel) - 2, 100]];
    function fits(t) {
      var a = pct(t) - halfW(fmtTick(t, step)) - 1.5, b = pct(t) + halfW(fmtTick(t, step)) + 1.5;
      return taken.every(function (r) { return b < r[0] || a > r[1]; }) && (taken.push([a, b]), true);
    }
    var cands = [];
    if (panel.type === 'balance' && lo < 0 && hi > 0) cands.push(0);   // zero first
    for (var t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) {
      if (Math.abs(t) > 1e-9 || cands.indexOf(0) < 0) cands.push(t);
    }
    var ticks = cands.filter(function (t) { return t > lo && t < hi && fits(t); });
    var html = '<span class="lg-tick lg-end" style="left:0%">' + loLabel + '</span>';
    ticks.forEach(function (t) {
      html += '<span class="lg-tick' + (Math.abs(t) < 1e-9 ? ' lg-zero' : '') + '" style="left:' + pct(t).toFixed(1) + '%">' +
              fmtTick(t, step) + '</span>';
    });
    html += '<span class="lg-tick lg-end lg-right" style="left:100%">' + hiLabel + '</span>';
    var zero = (panel.type === 'balance' && lo < 0 && hi > 0)
      ? '<span class="lg-zero-mark" style="left:' + pct(0).toFixed(1) + '%"></span>' : '';
    // Arrow caps mark ends where some cells lie beyond the fixed scale.
    var caps = (dom.data_min < lo ? '<span class="lg-cap lg-cap-l" style="border-right-color:' + stops[0][1] + '"></span>' : '') +
               (dom.data_max > hi ? '<span class="lg-cap lg-cap-r" style="border-left-color:' + stops[stops.length - 1][1] + '"></span>' : '');

    return '<div class="lg-title">Shared colour scale · ' + esc(panel.units) + '</div>' +
      '<div class="lg-subtitle">All three maps · every month</div>' +
      '<div class="lg-bar-wrap"><div class="lg-bar" style="background:' + grad + '"></div>' + zero + caps + '</div>' +
      '<div class="lg-ticks">' + html + '</div>' +
      '<div class="lg-foot"><span class="lg-nodata"></span>No data' +
        (caps ? '<span class="lg-note">▸ beyond scale</span>' : '') + '</div>';
  }

  // ── State ──────────────────────────────────────────────────────────

  var _state = {
    rev:     0,
    month:   7,
    member:  'mean',
    region:  SCOTLAND_REGION,
    playing: false,
    dwell:   6,
  };
  var _status = { kind: 'loading', message: '' };   // loading | ready | warning | error
  var _shown  = null;      // committed frame {month, member, region, rid, subs, missing, annualReset}
  var _channel = null;
  var _panels  = [];       // per-group DOM + maps
  var _maps    = [];       // flat list of all nine maps
  var _mapsReady = null;   // Promise resolved when every map style has loaded
  var _stageSeq  = 0;
  var _dwellTimer = null;
  var _annualReset = false;

  // Regional summaries: the mean is kept; one member file at a time (bounded).
  var _sum = { mean: null, memberId: null, member: null, pending: {} };

  // Council geometry for the locator, region resolution and overlay tests.
  var _councilGeom = {};
  // Until council outlines load, the Scotland bbox stands in for the land.
  var _scotlandRings = indexRings([{ type: 'Polygon', coordinates: [FOG_FEATURE.geometry.coordinates[1]] }]);
  var _locatorContextPath = '';
  var _councilsReady = null;

  function regionId(region) {
    return region && region.kind ? region.name : 'national';
  }

  function regionLabel(region) {
    if (!region || !region.kind) return 'Scotland';
    return region.name + (region.kind === 'council' ? ' · council area' : ' · catchment');
  }

  function ensembleLabel(member) {
    return member === 'mean' ? 'Ensemble mean' : 'Ensemble member ' + member;
  }

  function persist() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({
        v: 2,
        rev: _state.rev,
        month: _state.month,
        member: _state.member,
        region: _state.region.kind
          ? { kind: _state.region.kind, name: _state.region.name, bounds: _state.region.bounds }
          : null,
        playing: _state.playing,
        dwell: _state.dwell,
      }));
    } catch (e) { /* storage unavailable: state simply is not restored */ }
  }

  function restore() {
    var saved = null;
    if (params.get('fresh') !== '1') {
      try { saved = JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { saved = null; }
    }
    if (saved && saved.v === 2) {
      if (saved.rev > 0) _state.rev = saved.rev;
      if (saved.month >= 1 && saved.month <= 12) _state.month = saved.month;
      if (saved.member === 'mean' || VALID_MEMBERS.indexOf(saved.member) >= 0) _state.member = saved.member;
      if (saved.region && saved.region.name && (saved.region.kind === 'council' || saved.region.kind === 'catchment')) {
        _state.region = {
          kind: saved.region.kind, name: saved.region.name,
          bounds: regionBoundsSane(saved.region.bounds) ? saved.region.bounds : null,
          geometry: null,
        };
      }
      _state.playing = !!saved.playing;
      if (saved.dwell >= 2 && saved.dwell <= 60) _state.dwell = saved.dwell;
    }
    if (params.has('dwell')) _state.dwell = numParam('dwell', 6, 2, 60);
    if (params.get('autoplay') === '1') _state.playing = true;
  }

  // ── Reporting to the controller ────────────────────────────────────

  function heapMB() {
    var m = window.performance && window.performance.memory;
    return m ? Math.round(m.usedJSHeapSize / 1048576) : null;
  }

  function report() {
    if (!_channel) return;
    _channel.postMessage({
      type: 'wall',
      rev: _state.rev,
      state: {
        month: _state.month,
        member: _state.member,
        region: { kind: _state.region.kind, name: _state.region.name },
        playing: _state.playing,
        dwell: _state.dwell,
      },
      status: _status.kind,
      message: _status.message,
      shown: _shown ? { month: _shown.month, member: _shown.member, region: _shown.region.name } : null,
      heapMB: heapMB(),
    });
  }

  function setStatus(kind, message) {
    _status = { kind: kind, message: message || '' };
    renderContext();
    report();
  }

  function bump() {
    _state.rev++;
    persist();
  }

  // ── Summaries ──────────────────────────────────────────────────────

  function loadSummary(ens) {
    if (ens === 'mean' && _sum.mean) return Promise.resolve(_sum.mean);
    if (ens !== 'mean' && _sum.memberId === ens && _sum.member) return Promise.resolve(_sum.member);
    if (_sum.pending[ens]) return _sum.pending[ens];
    var file = ens === 'mean' ? 'mean.json' : 'member_' + ens + '.json';
    var p = fetch(SUMMARY_BASE + file + '?v=' + encodeURIComponent(SUMMARY_V))
      .then(function (r) {
        if (!r.ok) throw new Error('summaries for ' + ensembleLabel(ens).toLowerCase() + ' unavailable (HTTP ' + r.status + ')');
        return r.json();
      })
      .then(function (j) {
        if (!j || !j.regions || !j._meta) throw new Error('summaries for ' + ens + ' malformed');
        if (ens === 'mean') {
          _sum.mean = j;
        } else {
          _sum.memberId = ens;
          _sum.member = j;
        }
        return j;
      });
    _sum.pending[ens] = p;
    p.then(function () { delete _sum.pending[ens]; }, function () { delete _sum.pending[ens]; });
    return p;
  }

  // 12-month series for one region / metric / period. Baseline values are
  // observed and shared by every member; a member→mean substitution in the
  // map data is honoured here too so maps, numbers and charts agree.
  function seriesFor(frame, metric, periodId) {
    var useMean = periodId === BASELINE_ID || frame.member === 'mean' ||
                  frame.subs.indexOf(metric + '|' + periodId) >= 0;
    var file = useMean ? _sum.mean : _sum.member;
    var r = file && file.regions[frame.rid];
    var m = r && r[metric];
    return (m && m[periodId]) || null;
  }

  function cellCount(frame, metric) {
    var n = _sum.mean && _sum.mean.n_cells && _sum.mean.n_cells[frame.rid];
    return n && n[metric] ? n[metric][frame.month - 1] : null;
  }

  // ── Map payloads: one request in flight, one next frame cached ─────
  // Aborting a fetch does not stop the server's work, so superseded requests
  // are allowed to finish and only the latest target is requested next.

  var _inflight = null;   // {key, promise}
  var _nextCache = null;  // {key, data} — at most one parsed payload

  function payloadKey(month, member) { return month + '|' + member; }

  function startFetch(month, member) {
    var key = payloadKey(month, member);
    var url = '/api/immersive_values?month=' + month +
      '&metrics=' + PANELS.map(function (p) { return p.id; }).join(',') +
      (member !== 'mean' ? '&member=' + member : '');
    var t0 = performance.now();
    var p = fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('map data for ' + MONTH_LONG[month] + ' unavailable (HTTP ' + r.status + ')');
        return r.json();
      })
      .then(function (data) {
        console.log('[immersive] payload ' + key + ' in ' + Math.round(performance.now() - t0) + ' ms');
        return data;
      });
    _inflight = { key: key, promise: p };
    p.then(function () { if (_inflight && _inflight.promise === p) _inflight = null; },
           function () { if (_inflight && _inflight.promise === p) _inflight = null; });
    return p;
  }

  function getPayload(month, member, isCurrent) {
    var key = payloadKey(month, member);
    if (_nextCache && _nextCache.key === key) {
      var d = _nextCache.data;
      _nextCache = null;
      return Promise.resolve(d);
    }
    if (_inflight && _inflight.key === key) return _inflight.promise;
    var wait = _inflight ? _inflight.promise.catch(function () {}) : Promise.resolve();
    return wait.then(function () {
      if (!isCurrent()) throw { superseded: true };
      if (_nextCache && _nextCache.key === key) {
        var d2 = _nextCache.data;
        _nextCache = null;
        return d2;
      }
      if (_inflight && _inflight.key === key) return _inflight.promise;
      return startFetch(month, member);
    });
  }

  function prefetchNext() {
    if (!_state.playing || _inflight) return;
    var month = _state.month % 12 + 1;
    var key = payloadKey(month, _state.member);
    if (_nextCache && _nextCache.key === key) return;
    _nextCache = null;
    startFetch(month, _state.member).then(function (data) {
      if (payloadKey(_state.month % 12 + 1, _state.member) === key) _nextCache = { key: key, data: data };
    }, function (e) {
      console.warn('[immersive] prefetch failed:', e);
    });
  }

  // ── Region geometry ────────────────────────────────────────────────

  function loadCouncils() {
    _councilsReady = fetch('/api/councils')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (fc) {
        if (!fc || !fc.features) return;
        var geoms = [];
        fc.features.forEach(function (f) {
          var name = f.properties && f.properties.council_name;
          if (name && f.geometry) { _councilGeom[name] = f.geometry; geoms.push(f.geometry); }
        });
        _scotlandRings = indexRings(geoms);
        _locatorContextPath = geoms.map(geometryToPath).filter(Boolean).join(' ');
      })
      .catch(function (e) { console.warn('[immersive] council geometry fetch failed:', e); });
    return _councilsReady;
  }

  // Fill in kind / geometry / bounds for a region named by the controller or
  // restored from storage.
  function resolveRegion(region) {
    if (!region || !region.name || region.name === 'All Scotland') return Promise.resolve(SCOTLAND_REGION);
    if (region.kind && region.geometry && region.bounds) return Promise.resolve(region);
    return _councilsReady.then(function () {
      var kind = region.kind || (_councilGeom[region.name] ? 'council' : 'catchment');
      if (region.geometry) {
        return { kind: kind, name: region.name, geometry: region.geometry,
                 bounds: region.bounds || geomBbox(region.geometry) };
      }
      if (kind === 'council') {
        var g = _councilGeom[region.name];
        if (!g) throw new Error('unknown council area "' + region.name + '"');
        return { kind: kind, name: region.name, geometry: g, bounds: geomBbox(g) };
      }
      return fetch('/api/catchments/' + encodeURIComponent(region.name) + '/geometry')
        .then(function (r) {
          if (!r.ok) throw new Error('catchment "' + region.name + '" geometry unavailable');
          return r.json();
        })
        .then(function (fc) {
          var geom = fc && fc.features && fc.features[0] ? fc.features[0].geometry : null;
          if (!geom) throw new Error('catchment "' + region.name + '" has no geometry');
          return { kind: kind, name: region.name, geometry: geom, bounds: region.bounds || geomBbox(geom) };
        });
    }).then(function (r) {
      r.bounds = padBounds(r.bounds, 0.02);
      if (!regionBoundsSane(r.bounds)) throw new Error('region "' + r.name + '" bounds outside Scotland');
      return r;
    });
  }

  // ── Locator inset ──────────────────────────────────────────────────

  var LOCATOR_BOX  = { w: -7.9, s: 54.55, e: -0.55, n: 60.95 };
  var LOCATOR_SIZE = { w: 182, h: 232, pad: 8 };

  function projectLocator(coord) {
    var usableW = LOCATOR_SIZE.w - LOCATOR_SIZE.pad * 2;
    var usableH = LOCATOR_SIZE.h - LOCATOR_SIZE.pad * 2;
    var scale = Math.min(usableW / (LOCATOR_BOX.e - LOCATOR_BOX.w), usableH / (LOCATOR_BOX.n - LOCATOR_BOX.s));
    var ox = LOCATOR_SIZE.pad + (usableW - (LOCATOR_BOX.e - LOCATOR_BOX.w) * scale) * 0.5;
    var oy = LOCATOR_SIZE.pad + (usableH - (LOCATOR_BOX.n - LOCATOR_BOX.s) * scale) * 0.5;
    return [ox + (coord[0] - LOCATOR_BOX.w) * scale, oy + (LOCATOR_BOX.n - coord[1]) * scale];
  }

  function ringToPath(ring) {
    if (!ring || ring.length < 2) return '';
    return ring.map(function (coord, i) {
      var p = projectLocator(coord);
      return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    }).join(' ') + ' Z';
  }

  function geometryToPath(geometry) {
    return exteriorRings(geometry).map(ringToPath).filter(Boolean).join(' ');
  }

  function locatorSVG(region) {
    var b = region.bounds;
    var c = b ? projectLocator([(b[0][0] + b[1][0]) * 0.5, (b[0][1] + b[1][1]) * 0.5]) : null;
    var dot = c
      ? '<circle class="locator-ring" cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="8.5"></circle>' +
        '<circle class="locator-dot" cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="4.2"></circle>'
      : '';
    var regionPath = geometryToPath(region.geometry);
    return '<svg viewBox="0 0 ' + LOCATOR_SIZE.w + ' ' + LOCATOR_SIZE.h + '" role="img" aria-label="Selected region location in Scotland">' +
      (_locatorContextPath ? '<path class="locator-context" d="' + _locatorContextPath + '"></path>' : '') +
      (regionPath ? '<path class="locator-region" d="' + regionPath + '"></path>' : '') +
      dot + '</svg>';
  }

  // ── Overlay placement ──────────────────────────────────────────────
  // Legend and locator sit in a map's empty surround: try candidate positions
  // in order and take the first whose sample points miss the region outline
  // (or Scotland's councils), else the one with the fewest hits.

  function placeOverlay(map, el, candidates, rings) {
    var box = map.getContainer();
    var W = box.clientWidth, H = box.clientHeight;
    var w = el.offsetWidth, h = el.offsetHeight;
    if (!W || !H || !w || !h) return;
    var m = Math.round(16 * _u);
    var pos = {
      'top-left':     [m, m],
      'top-right':    [W - w - m, m],
      'left-mid':     [m, (H - h) * 0.4],
      'right-mid':    [W - w - m, (H - h) * 0.4],
      'bottom-left':  [m, H - h - m],
      'bottom-right': [W - w - m, H - h - m],
      'top-center':   [(W - w) / 2, m],
    };
    var best = null;
    for (var c = 0; c < candidates.length; c++) {
      var xy = pos[candidates[c]];
      if (!xy || xy[0] < 0 || xy[1] < 0) continue;
      var hits = 0;
      for (var i = 0; i < 7; i++) {
        for (var j = 0; j < 4; j++) {
          var ll = map.unproject([xy[0] + w * (i + 0.5) / 7, xy[1] + h * (j + 0.5) / 4]);
          if (insideAny(ll.lng, ll.lat, rings)) hits++;
        }
      }
      if (!best || hits < best.hits) best = { name: candidates[c], x: xy[0], y: xy[1], hits: hits };
      if (hits === 0) break;
    }
    if (!best) return;
    el.style.left = Math.round(best.x) + 'px';
    el.style.top = Math.round(best.y) + 'px';
    el.dataset.position = best.name;
    el.classList.toggle('overlaps', best.hits > 0);
    el.classList.add('placed');
  }

  function placeOverlays() {
    var rings = _state.region.geometry ? indexRings([_state.region.geometry]) : _scotlandRings;
    _panels.forEach(function (ps) {
      if (ps.maps[1]) {
        placeOverlay(ps.maps[1], ps.legendEl,
          ['top-left', 'left-mid', 'top-right', 'right-mid', 'bottom-right', 'bottom-left', 'top-center'], rings);
      }
      if (ps.maps[0] && ps.locatorEl.classList.contains('active')) {
        // bottom-left is reserved for the scale bar
        placeOverlay(ps.maps[0], ps.locatorEl,
          ['top-left', 'top-right', 'right-mid', 'left-mid', 'bottom-right'], rings);
      }
    });
  }

  // ── Charts ─────────────────────────────────────────────────────────
  // Hand-rolled inline SVG. Axes depend only on the region and ensemble
  // selection (all twelve months), so they stay fixed while the month moves.

  function buildChart(o) {
    var W = o.W, H = o.H, u = _u;
    var f  = Math.max(9, 24 * u);
    var L = Math.round(f * 3.4), R = Math.round(f * 0.9);
    var T = Math.round(f * 0.9), B = Math.round(f * 1.9);
    var pw = W - L - R, ph = H - T - B;
    if (pw < 40 || ph < 30) return '';
    var band = pw / 12;
    function xAt(i) { return L + (i + 0.5) * band; }

    var vals = [];
    o.series.forEach(function (s) {
      (s.values || []).forEach(function (v) { if (v != null && isFinite(v)) vals.push(v); });
    });
    var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';

    // Selected-month band first so it sits under the lines.
    svg += '<rect x="' + (L + o.sel * band).toFixed(1) + '" y="' + T + '" width="' + band.toFixed(1) +
           '" height="' + ph + '" fill="rgba(255,255,255,0.11)"/>';

    var monthY = H - B + f * 1.25;
    var allMonths = band > f * 2.0;
    for (var i = 0; i < 12; i++) {
      if (!allMonths && i % 3 && i !== o.sel) continue;
      var selected = i === o.sel;
      svg += '<text x="' + xAt(i).toFixed(1) + '" y="' + monthY.toFixed(1) + '" text-anchor="middle" font-size="' +
             f.toFixed(1) + '" font-weight="' + (selected ? 800 : 500) + '" fill="' +
             (selected ? '#ffffff' : 'rgba(205,217,242,0.72)') + '">' + MONTH_SHORT[i + 1] + '</text>';
    }

    if (!vals.length) {
      return svg + '<text x="' + (L + pw / 2) + '" y="' + (T + ph / 2) + '" text-anchor="middle" font-size="' +
        f.toFixed(1) + '" fill="rgba(205,217,242,0.6)">No data for this selection</text></svg>';
    }

    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (o.zero) { mn = Math.min(mn, 0); mx = Math.max(mx, 0); }
    if (mx === mn) { mx += 1; mn -= 1; }
    var step = niceStep(mx - mn, 4);
    var lo = Math.floor(mn / step) * step, hi = Math.ceil(mx / step) * step;
    function yAt(v) { return T + (1 - (v - lo) / (hi - lo)) * ph; }

    for (var t = lo; t <= hi + step * 1e-6; t += step) {
      var y = yAt(t).toFixed(1);
      var isZero = Math.abs(t) < step * 1e-6;
      svg += '<line x1="' + L + '" y1="' + y + '" x2="' + (L + pw) + '" y2="' + y + '" stroke="' +
             (isZero && o.zero ? 'rgba(235,240,255,0.75)' : 'rgba(150,170,210,0.18)') + '" stroke-width="' +
             (isZero && o.zero ? Math.max(1.5, 3 * u) : Math.max(1, 1.5 * u)) + '"/>';
      svg += '<text x="' + (L - f * 0.5).toFixed(1) + '" y="' + (yAt(t) + f * 0.34).toFixed(1) +
             '" text-anchor="end" font-size="' + f.toFixed(1) + '" fill="rgba(205,217,242,0.85)"' +
             (isZero && o.zero ? ' font-weight="700"' : '') + '>' + fmtTick(t, step, o.signed) + '</text>';
    }
    svg += '<rect x="' + L + '" y="' + T + '" width="' + pw + '" height="' + ph +
           '" fill="none" stroke="rgba(150,170,210,0.3)" stroke-width="' + Math.max(1, 1.5 * u) + '"/>';

    var sw = Math.max(2, 5 * u);
    o.series.forEach(function (s) {
      if (!s.values) return;
      var d = '', pen = false;
      for (var i = 0; i < 12; i++) {
        var v = s.values[i];
        if (v == null || !isFinite(v)) { pen = false; continue; }   // gaps stay gaps
        d += (pen ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1);
        pen = true;
      }
      if (!d) return;
      var dash = s.dash ? s.dash.split(' ').map(function (x) { return (parseFloat(x) * sw).toFixed(1); }).join(' ') : null;
      svg += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + sw.toFixed(1) +
             '" stroke-linejoin="round" stroke-linecap="' + (dash ? 'butt' : 'round') + '"' +
             (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>';
    });
    var r = Math.max(3, 9 * u);
    o.series.forEach(function (s) {
      var v = s.values ? s.values[o.sel] : null;
      if (v == null || !isFinite(v)) return;
      svg += '<circle cx="' + xAt(o.sel).toFixed(1) + '" cy="' + yAt(v).toFixed(1) + '" r="' + r.toFixed(1) +
             '" fill="' + s.color + '" stroke="#0a0c1b" stroke-width="' + Math.max(1, 3 * u).toFixed(1) + '"/>';
    });
    return svg + '</svg>';
  }

  function keyHTML(periods) {
    return periods.map(function (p) {
      var dash = p.dash ? ' stroke-dasharray="' + p.dash.split(' ').map(function (x) { return parseFloat(x) * 5; }).join(' ') + '"' : '';
      return '<span class="key-item"><svg viewBox="0 0 48 12" class="key-swatch"><line x1="2" y1="6" x2="46" y2="6" stroke="' +
        p.color + '" stroke-width="5"' + dash + '/></svg>' + p.short + '</span>';
    }).join('');
  }

  function renderCharts(ps, frame) {
    var mi = frame.month - 1;
    var abs = PERIODS.map(function (p) {
      return { values: seriesFor(frame, ps.panel.id, p.id), color: p.color, dash: p.dash };
    });
    var base = abs[0].values;
    var delta = FUTURES.map(function (p, k) {
      var fut = abs[k + 1].values;
      var vals = null;
      if (base && fut) {
        vals = fut.map(function (v, i) {
          return (v == null || base[i] == null) ? null : v - base[i];
        });
      }
      return { values: vals, color: p.color, dash: p.dash };
    });
    [[ps.absPlot, abs, false], [ps.deltaPlot, delta, true]].forEach(function (c) {
      var el = c[0];
      var W = el.clientWidth, H = el.clientHeight;
      if (!W || !H) return;
      el.innerHTML = buildChart({
        W: W, H: H, series: c[1], sel: mi,
        zero: ps.panel.type === 'balance' || c[2],
        signed: c[2],
      });
    });
  }

  // ── Context line (repeated in every group) ─────────────────────────

  function renderContext() {
    var frame = _shown;
    _panels.forEach(function (ps) {
      if (frame) {
        ps.ctxSel.textContent = MONTH_LONG[frame.month] + ' · ' + regionLabel(frame.region) +
          ' · ' + ensembleLabel(frame.member);
      }
      var ticks = ps.ctxTicks.children;
      for (var i = 0; i < ticks.length; i++) {
        ticks[i].classList.toggle('on', !!frame && i === frame.month - 1);
        ticks[i].classList.toggle('past', !!frame && i < frame.month - 1);
      }
      var chip = '', cls = '';
      if (_status.kind === 'loading') {
        chip = 'Loading ' + MONTH_LONG[_state.month] + '…';
        cls = 'loading';
      } else if (_status.kind === 'error' || _status.kind === 'warning') {
        chip = _status.message;
        cls = _status.kind;
      } else if (frame && frame.annualReset) {
        chip = '↺ New annual cycle';
        cls = 'cycle';
      }
      ps.ctxChip.textContent = chip;
      ps.ctxChip.className = 'ctx-chip ' + cls;
      ps.ctxMode.textContent = _state.playing ? '▶ Auto · ' + _state.dwell + ' s per month' : '❚❚ Paused';
      ps.ctxMode.classList.toggle('playing', _state.playing);
    });
  }

  function startDwellBars(seconds) {
    _panels.forEach(function (ps) {
      var bar = ps.ctxBar;
      bar.style.transition = 'none';
      bar.style.width = '0%';
      void bar.offsetWidth;   // restart the transition
      if (seconds > 0) {
        bar.style.transition = 'width ' + seconds + 's linear';
        bar.style.width = '100%';
      }
    });
  }

  // ── Maps ───────────────────────────────────────────────────────────

  function createMap(containerId, stops) {
    return new Promise(function (resolve) {
      var map = new maplibregl.Map({
        container: containerId,
        style: {
          version: 8,
          sources: {
            basemap: {
              type: 'raster',
              tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
              tileSize: 256,
              attribution: '© Esri',
            },
          },
          layers: [{ id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 0.28 } }],
        },
        center: [-4.2, 57.0],
        zoom: 6,
        // Tileset has no tiles below z5 (MBTiles floor). In small windows the
        // All-Scotland fit would land below that and load nothing — clamp the
        // camera so cells always resolve. On the wall the fit is ~z6.5; no-op.
        minZoom: 5,
        scrollZoom: false, boxZoom: false, dragRotate: false, dragPan: false,
        keyboard: false, doubleClickZoom: false, touchZoomRotate: false, touchPitch: false,
        attributionControl: false,
        fadeDuration: 0,
      });
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      map.once('style.load', function () {
        map.addSource('cells-vt', {
          type: 'vector',
          tiles: [window.location.origin + '/tiles/{z}/{x}/{y}.pbf'],
          minzoom: 5,
          maxzoom: 14,
          promoteId: { cells: 'id_1km' },
        });
        map.addLayer({
          id: 'cells-fill', type: 'fill', source: 'cells-vt', 'source-layer': 'cells',
          paint: { 'fill-antialias': false, 'fill-color': buildColorExpr(stops), 'fill-opacity': 1.0 },
        });
        // Mask above the cells clips everything outside the region outline.
        map.addSource('fog', { type: 'geojson', data: FOG_FEATURE });
        map.addLayer({ id: 'fog', type: 'fill', source: 'fog', paint: { 'fill-color': BG_COLOR, 'fill-opacity': 1.0 } });
        map.resize();
        map.fitBounds(SCOTLAND_BOUNDS, { padding: 20, duration: 0 });
        resolve(map);
      });
    });
  }

  function applyValues(map, data) {
    map.removeFeatureState({ source: 'cells-vt', sourceLayer: 'cells' });
    if (!data) return;
    for (var id in data) {
      var v = data[id];
      if (v != null && isFinite(v)) {
        map.setFeatureState({ source: 'cells-vt', sourceLayer: 'cells', id: +id }, { value: v });
      }
    }
  }

  function waitIdle(map) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { finish(false); }, READY_TIMEOUT_MS);
      function finish(ok) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ok);
      }
      map.once('idle', function () { finish(true); });
      map.triggerRepaint();
    });
  }

  function fitAll(bounds, duration) {
    _maps.forEach(function (map) {
      map.fitBounds(bounds || SCOTLAND_BOUNDS, { padding: 20, duration: duration });
    });
  }

  // ── Frame staging and commit ───────────────────────────────────────

  function stage() {
    var seq = ++_stageSeq;
    function isCurrent() { return seq === _stageSeq; }
    clearTimeout(_dwellTimer);
    startDwellBars(0);
    var target = { month: _state.month, member: _state.member, region: _state.region };
    var needMaps = !_shown || _shown.month !== target.month || _shown.member !== target.member;
    var t0 = performance.now();
    setStatus('loading');

    Promise.all([
      _mapsReady,
      loadSummary('mean'),
      target.member !== 'mean' ? loadSummary(target.member) : null,
      needMaps ? getPayload(target.month, target.member, isCurrent) : null,
      resolveRegion(target.region),
    ]).then(function (res) {
      if (!isCurrent()) return null;
      var region = res[4];
      if (_state.region.name === region.name) _state.region = region;
      var payload = res[3];
      var frame = {
        month: target.month,
        member: target.member,
        region: region,
        rid: regionId(region),
        subs: payload ? payload._meta.substituted.map(function (s) { return s.metric + '|' + s.period; })
                      : (_shown ? _shown.subs : []),
        missing: payload ? missingMaps(payload) : (_shown ? _shown.missing : []),
        annualReset: _annualReset && target.month === 1,
      };
      _annualReset = false;
      var regionChanged = !_shown || _shown.region.name !== region.name;
      commit(frame, payload, region, regionChanged);
      return Promise.all(_maps.map(waitIdle)).then(function (ok) {
        return { frame: frame, slow: ok.indexOf(false) >= 0 };
      });
    }).then(function (r) {
      if (!r || !isCurrent()) return;
      placeOverlays();
      var ms = Math.round(performance.now() - t0);
      console.log('[immersive] frame ' + MONTH_SHORT[r.frame.month] + ' · ' + r.frame.member + ' · ' +
        r.frame.region.name + ' ready in ' + ms + ' ms' + (heapMB() ? ' · JS heap ' + heapMB() + ' MB' : ''));
      if (r.frame.missing.length) {
        _state.playing = false;
        bump();
        setStatus('warning', 'No map data: ' + r.frame.missing.join(', ') + ' — playback paused');
      } else if (r.slow) {
        setStatus('warning', 'Map tiles slow to render');
        scheduleDwell();
      } else {
        setStatus('ready');
        scheduleDwell();
      }
      prefetchNext();
    }).catch(function (err) {
      if (err && err.superseded) return;
      if (!isCurrent()) return;
      console.error('[immersive] frame failed:', err);
      // Keep the previous frame and its labels; requested state reverts to it.
      if (_shown) {
        _state.month = _shown.month;
        _state.member = _shown.member;
        _state.region = _shown.region;
      }
      _state.playing = false;
      bump();
      setStatus('error', 'Could not show ' + MONTH_LONG[target.month] + ': ' +
        (err && err.message ? err.message : 'unknown error') + ' — playback paused');
      renderContext();
    });
  }

  function missingMaps(payload) {
    var out = [];
    PANELS.forEach(function (panel) {
      PERIODS.forEach(function (p) {
        var d = payload[panel.id] && payload[panel.id][p.id];
        if (!d || !Object.keys(d).length) out.push(panel.code + ' ' + p.short);
      });
    });
    return out;
  }

  function commit(frame, payload, region, regionChanged) {
    _shown = frame;
    var mi = frame.month - 1;

    _panels.forEach(function (ps) {
      var metric = ps.panel.id;
      var series = PERIODS.map(function (p) { return seriesFor(frame, metric, p.id); });
      var base = series[0] ? series[0][mi] : null;
      var n = cellCount(frame, metric);

      PERIODS.forEach(function (p, j) {
        if (payload) applyValues(ps.maps[j], payload[metric] ? payload[metric][p.id] : null);

        var label = p.label, warn = false;
        if (frame.missing.indexOf(ps.panel.code + ' ' + p.short) >= 0) {
          label = p.short + ' · no map data';
          warn = true;
        } else if (j > 0 && frame.subs.indexOf(metric + '|' + p.id) >= 0) {
          label = p.short + ' · ensemble mean (member ' + frame.member + ' unavailable)';
          warn = true;
        }
        ps.periodEls[j].textContent = label;
        ps.periodEls[j].classList.toggle('warn', warn);

        var v = series[j] ? series[j][mi] : null;
        var cell = ps.numEls[j];
        cell.value.innerHTML = esc(fmtAbs(v)) + (v == null ? '' : ' <span class="num-unit">' + esc(ps.panel.units) + '</span>');
        if (j === 0) {
          cell.sub.textContent = v == null ? 'No climate cells in this region'
            : 'Regional mean' + (n ? ' · ' + n.toLocaleString('en-GB') + ' cells' : '');
        } else {
          cell.sub.textContent = (v == null || base == null) ? ''
            : 'Δ ' + fmtDelta(v - base) + ' ' + ps.panel.units + ' from baseline';
        }
      });

      if (regionChanged) {
        ps.locatorEl.classList.toggle('active', !!region.kind);
        ps.locatorEl.classList.remove('placed');
        ps.locatorEl.innerHTML = region.kind ? locatorSVG(region) : '';
        ps.legendEl.classList.remove('placed');
      }
      renderCharts(ps, frame);
    });

    if (regionChanged) {
      _maps.forEach(function (map) {
        var src = map.getSource('fog');
        if (src) src.setData(region.geometry ? buildMaskFeature(region.geometry) : FOG_FEATURE);
      });
      fitAll(region.bounds, _firstCommitDone ? 1200 : 0);
      _panels.forEach(function (ps) {
        if (ps.scaleEl) ps.scaleEl.style.display = region.kind ? '' : 'none';
      });
    }
    _firstCommitDone = true;
    renderContext();
  }
  var _firstCommitDone = false;

  // ── Playback ───────────────────────────────────────────────────────

  function scheduleDwell() {
    clearTimeout(_dwellTimer);
    if (!_state.playing || !_shown) {
      startDwellBars(0);
      return;
    }
    startDwellBars(_state.dwell);
    _dwellTimer = setTimeout(function () {
      if (!_state.playing) return;
      _state.month = _state.month % 12 + 1;
      if (_state.month === 1) _annualReset = true;
      bump();
      stage();
    }, _state.dwell * 1000);
  }

  // ── Commands from the controller ───────────────────────────────────

  function handleCommand(msg) {
    var restage = false;
    switch (msg.cmd) {
      case 'set': {
        // Any manual selection pauses playback so a presenter keeps control.
        _state.playing = false;
        var m = parseInt(msg.month, 10);
        if (m >= 1 && m <= 12 && m !== _state.month) { _state.month = m; restage = true; }
        if (msg.member != null) {
          var mb = String(msg.member);
          if ((mb === 'mean' || VALID_MEMBERS.indexOf(mb) >= 0) && mb !== _state.member) {
            _state.member = mb;
            restage = true;
          }
        }
        if (msg.region && typeof msg.region.name === 'string' && msg.region.name !== _state.region.name) {
          var r = msg.region;
          if (!r.name || r.name === 'All Scotland') {
            _state.region = SCOTLAND_REGION;
          } else if (r.bounds && !regionBoundsSane(padBounds(r.bounds, 0.02))) {
            console.error('[immersive] bad region bounds for "' + r.name + '" — ignored');
          } else {
            _state.region = {
              kind: r.kind === 'council' || r.kind === 'catchment' ? r.kind : null,
              name: r.name, bounds: r.bounds ? padBounds(r.bounds, 0.02) : null, geometry: r.geometry || null,
            };
          }
          restage = true;
        }
        break;
      }
      case 'step': {
        _state.playing = false;
        var d = msg.delta < 0 ? -1 : 1;
        _state.month = (_state.month - 1 + d + 12) % 12 + 1;
        restage = true;
        break;
      }
      case 'play':
        _state.playing = true;
        break;
      case 'pause':
        _state.playing = false;
        break;
      case 'dwell': {
        var s = parseFloat(msg.seconds);
        if (s >= 2 && s <= 60) _state.dwell = s;
        break;
      }
      default:
        return;
    }
    bump();
    if (restage) {
      stage();
    } else {
      if (_status.kind === 'ready' || _status.kind === 'warning') scheduleDwell();
      if (_state.playing && _status.kind === 'error' && _shown) stage();
      renderContext();
      report();
    }
  }

  function onMessage(ev) {
    var msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') {
      report();
    } else if (msg.type === 'command') {
      handleCommand(msg);
    } else if (msg.type === 'state') {
      // v3 controller: absolute state, treated as a manual selection.
      handleCommand({ cmd: 'set', month: msg.month, member: msg.member, region: msg.region });
    }
  }

  // ── Build DOM ──────────────────────────────────────────────────────

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function buildPanels() {
    var container = document.getElementById('panels');
    PANELS.forEach(function (panel, pi) {
      var ps = { panel: panel, maps: [], mapIds: [], periodEls: [], numEls: [] };
      var root = el('section', 'group');

      // Context: month · region · ensemble, month progress, playback mode.
      var ctx = el('div', 'ctx');
      ps.ctxSel = el('span', 'ctx-sel');
      ps.ctxChip = el('span', 'ctx-chip');
      var right = el('span', 'ctx-right');
      ps.ctxMode = el('span', 'ctx-mode');
      ps.ctxTicks = el('span', 'ctx-ticks');
      for (var m = 1; m <= 12; m++) ps.ctxTicks.appendChild(el('span', 'ctx-tick', MONTH_SHORT[m].charAt(0)));
      right.appendChild(ps.ctxTicks);
      right.appendChild(ps.ctxMode);
      ctx.appendChild(ps.ctxSel);
      ctx.appendChild(ps.ctxChip);
      ctx.appendChild(right);
      var barTrack = el('div', 'ctx-bar-track');
      ps.ctxBar = el('div', 'ctx-bar');
      barTrack.appendChild(ps.ctxBar);
      ctx.appendChild(barTrack);
      root.appendChild(ctx);

      var title = el('div', 'title');
      title.appendChild(el('span', 'title-main', panel.title));
      title.appendChild(el('span', 'title-code', panel.code + ' · ' + panel.per));
      root.appendChild(title);

      PERIODS.forEach(function (p, j) {
        var lbl = el('div', 'plabel' + (j === 0 ? ' baseline' : ''), p.label);
        lbl.style.gridColumn = String(j + 1);
        root.appendChild(lbl);
        ps.periodEls.push(lbl);

        var wrap = el('div', 'mapcell');
        wrap.style.gridColumn = String(j + 1);
        var canvas = el('div', 'map-canvas');
        canvas.id = 'map-' + panel.id + '-' + p.id;
        wrap.appendChild(canvas);
        ps.mapIds.push(canvas.id);
        if (j === 0) {
          ps.locatorEl = el('div', 'locator');
          wrap.appendChild(ps.locatorEl);
        }
        if (j === 1) {
          ps.legendEl = el('div', 'legend');
          wrap.appendChild(ps.legendEl);
        }
        root.appendChild(wrap);

        var num = el('div', 'num' + (j === 0 ? ' baseline' : ''));
        num.style.gridColumn = String(j + 1);
        var value = el('div', 'num-value', '—');
        var sub = el('div', 'num-sub');
        num.appendChild(value);
        num.appendChild(sub);
        root.appendChild(num);
        ps.numEls.push({ value: value, sub: sub });
      });

      var charts = el('div', 'charts');
      function chartBox(titleText, periods) {
        var box = el('div', 'chart-box');
        var head = el('div', 'chart-head');
        var t = el('div', 'chart-title');
        t.appendChild(el('span', 'chart-name', titleText));
        var sub = el('span', 'chart-sub');
        t.appendChild(sub);
        head.appendChild(t);
        var key = el('div', 'chart-key');
        key.innerHTML = keyHTML(periods);
        head.appendChild(key);
        var plot = el('div', 'chart-plot');
        box.appendChild(head);
        box.appendChild(plot);
        charts.appendChild(box);
        return { plot: plot, sub: sub };
      }
      var a = chartBox('Seasonal values', PERIODS);
      a.sub.textContent = 'Monthly climatology · ' + panel.units;
      var d = chartBox('Change from 1990–2019 baseline', FUTURES);
      d.sub.textContent = 'Future − baseline · ' + panel.units;
      ps.absPlot = a.plot;
      ps.deltaPlot = d.plot;
      root.appendChild(charts);

      container.appendChild(root);
      _panels.push(ps);
    });
  }

  function createMaps() {
    var jobs = [];
    _panels.forEach(function (ps, pi) {
      var stops = colorStops(ps.panel, _sum.mean._meta.domains[ps.panel.id]);
      ps.legendEl.innerHTML = legendHTML(ps.panel, _sum.mean._meta.domains[ps.panel.id]);
      ps.mapIds.forEach(function (id, j) {
        // Stagger WebGL context creation across the nine maps.
        jobs.push(new Promise(function (r) { setTimeout(r, (pi * 3 + j) * 120); })
          .then(function () { return createMap(id, stops); })
          .then(function (map) {
            ps.maps[j] = map;
            if (j === 0) {
              var scale = new maplibregl.ScaleControl({ maxWidth: 160, unit: 'metric' });
              map.addControl(scale, 'bottom-left');
              ps.scaleEl = map.getContainer().querySelector('.maplibregl-ctrl-bottom-left');
              if (ps.scaleEl) ps.scaleEl.style.display = _state.region.kind ? '' : 'none';
            }
            return map;
          }));
      });
    });
    return Promise.all(jobs).then(function () {
      _maps = [];
      _panels.forEach(function (ps) { ps.maps.forEach(function (m) { _maps.push(m); }); });
    });
  }

  var _resizeTimer = null;
  function onResize() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function () {
      applyScale();
      if (!_shown) return;
      _maps.forEach(function (m) { m.resize(); });
      fitAll(_state.region.bounds, 0);
      _panels.forEach(function (ps) { renderCharts(ps, _shown); });
      Promise.all(_maps.map(waitIdle)).then(placeOverlays);
    }, 250);
  }

  // ── Boot ───────────────────────────────────────────────────────────

  applyScale();
  restore();
  buildPanels();
  renderContext();
  loadCouncils();

  _mapsReady = loadSummary('mean').then(function (mean) {
    var meta = mean._meta;
    var foot = document.getElementById('footer-method');
    if (foot) {
      foot.textContent = 'Regional values: unweighted mean of valid 1 km climate cells · summaries v' +
        meta.version + ' · data ' + meta.data_version.slice(0, 8);
    }
    return createMaps();
  });
  _mapsReady.catch(function (e) {
    console.error('[immersive] startup failed:', e);
    setStatus('error', 'Wall data unavailable: ' + (e && e.message ? e.message : e));
  });

  // Commands are accepted only once _mapsReady exists (stage() waits on it).
  try {
    _channel = new (window.ClimaScopeRemoteChannel || window.BroadcastChannel)(CHANNEL_NAME);
    _channel.onmessage = onMessage;
  } catch (e) {
    console.warn('[immersive] BroadcastChannel not available:', e);
  }

  window.addEventListener('resize', onResize);
  setInterval(report, 10000);   // heartbeat so a controller notices a closed wall
  stage();
})();
