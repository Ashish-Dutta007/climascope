(function () {
  'use strict';

  // Wall controller. The wall (/immersive) owns state and playback; this page
  // sends commands and mirrors whatever the wall reports back, so it can be
  // closed, hidden or reloaded without disturbing what is on the wall.
  // The paired relay reaches other devices; local mode uses BroadcastChannel.

  var MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH_LONG  = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
  var MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  var MEMBERS = [{ id: 'mean', label: 'Ensemble mean' }].concat(
    ['01', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '15'].map(function (id) {
      return { id: id, label: 'Member ' + id };
    }));
  var DWELLS = [4, 6, 8, 10, 15, 20, 30];
  var SCENES = window.ClimaScopeScenes;

  var _wall = null;          // last report from the wall
  var _channel = null;
  var _councilItems = [];    // [{name, bounds, geometry}] sorted
  var _catchItems   = [];    // [{name, bounds}] sorted (geometry fetched on demand)
  var _catchGeom    = {};    // catchment name → geometry (cache)
  var _helloTimer   = null;
  var _lastSeen     = 0;     // the wall reports at least every 10 s

  function send(cmd) {
    if (!_channel) return;
    _channel.postMessage(Object.assign({ type: 'command' }, cmd));
  }

  // ── Mirror the wall's reported state ─────────────────────────────

  function render() {
    var s = _wall && _wall.state;
    document.querySelectorAll('.btn-month').forEach(function (btn) {
      btn.classList.toggle('active', !!s && +btn.dataset.month === s.month);
    });
    document.querySelectorAll('.btn-member').forEach(function (btn) {
      btn.classList.toggle('active', !!s && btn.dataset.member === s.member);
    });
    var play = document.getElementById('btn-play');
    play.textContent = s && s.playing ? '❚❚ Pause' : '▶ Play';
    play.classList.toggle('active', !!(s && s.playing));
    if (s) {
      document.querySelectorAll('.btn-scene').forEach(function (btn) {
        var active = btn.dataset.scene === (s.scene || 'overview');
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
      document.getElementById('scene-description').textContent = SCENES.get(s.scene).description;
      document.getElementById('focus-select').value = s.focus || 'CWBPT';
      document.getElementById('focus-select').disabled = s.scene !== 'agreement';
      document.getElementById('focus-control').hidden = s.scene !== 'agreement';
      document.getElementById('btn-tour').classList.toggle('active', s.playing && s.playback === 'tour');
      document.getElementById('btn-annual').classList.toggle('active', s.playing && s.playback !== 'tour');
      document.getElementById('tour-progress').textContent = s.playback === 'tour'
        ? 'Scene ' + ((s.tourIndex || 0) + 1) + ' of ' + SCENES.tour.length + (s.playing ? '' : ' · paused') : '';
      var dwellSel = document.getElementById('dwell-select');
      if (DWELLS.indexOf(s.dwell) < 0) addDwellOption(s.dwell);
      dwellSel.value = String(s.dwell);
      var kind = s.region && s.region.kind;
      _councilSel.value   = kind === 'council' ? s.region.name : '';
      _catchmentSel.value = kind === 'catchment' ? s.region.name : '';
      syncSelectStyles();
    }

    var el = document.getElementById('status');
    var text = document.getElementById('status-text');
    el.className = '';
    if (!_wall) {
      el.classList.add('offline');
      text.textContent = _channel && _channel.session ? 'Wall offline — waiting for connection' :
        (_channel && (_channel.local || !window.ClimaScopeRemoteChannel)
          ? 'Open /immersive in another window of this browser.' : 'Enter the code from the wall to connect.');
      return;
    }
    var shown = _wall.shown;
    var parts = [];
    parts.push(shown
      ? 'Wall shows ' + MONTH_LONG[shown.month] + ' · ' + (shown.region === 'All Scotland' ? 'Scotland' : shown.region) +
        ' · ' + (shown.member === 'mean' ? 'ensemble mean' : 'member ' + shown.member) +
        ' · ' + SCENES.get(shown.scene).title
      : 'Wall starting');
    if (_wall.status === 'loading') parts.push('loading ' + MONTH_LONG[s.month] + '…');
    else if (_wall.status === 'ready') parts.push(s.playing ? (s.playback === 'tour' ? 'scene loop' : s.dwell + ' s per month') : 'paused');
    if (_wall.message) parts.push(_wall.message);
    el.classList.add(_wall.status);
    text.textContent = parts.join(' · ');
  }

  // ── Region selects ───────────────────────────────────────────────

  function geomBbox(geometry) {
    if (!geometry || !geometry.coordinates) return null;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function visit(c) {
      if (!c || c.length === 0) return;
      if (typeof c[0] === 'number') {
        if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1];
      } else {
        for (var i = 0; i < c.length; i++) visit(c[i]);
      }
    }
    visit(geometry.coordinates);
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
    return [[minX, minY], [maxX, maxY]];
  }

  // Scotland WGS84 extent used for the sanity clamp.
  var SCOTLAND_EXTENT = { w: -9.0, s: 54.0, e: 0.5, n: 62.0 };

  function saneBounds(name, bounds) {
    if (!bounds) return null;
    // Widen tiny catchments to a minimum span instead of rejecting them.
    var cx = (bounds[0][0] + bounds[1][0]) / 2, cy = (bounds[0][1] + bounds[1][1]) / 2;
    var hx = Math.max(bounds[1][0] - bounds[0][0], 0.02) / 2, hy = Math.max(bounds[1][1] - bounds[0][1], 0.02) / 2;
    bounds = [[cx - hx, cy - hy], [cx + hx, cy + hy]];
    var w = bounds[0][0], s = bounds[0][1], e = bounds[1][0], n = bounds[1][1];
    var ok = isFinite(w) && isFinite(s) && isFinite(e) && isFinite(n)
             && (e - w) >= 0.01 && (n - s) >= 0.01
             && w >= SCOTLAND_EXTENT.w && e <= SCOTLAND_EXTENT.e
             && s >= SCOTLAND_EXTENT.s && n <= SCOTLAND_EXTENT.n;
    if (!ok) {
      console.error('[control] bounds for "' + name + '" failed sanity check: ' + JSON.stringify(bounds) +
        '. If values are 5–7 digit integers the source CRS is BNG (EPSG:27700), not WGS84.');
      return null;
    }
    return bounds;
  }

  var _councilSel   = document.getElementById('council-select');
  var _catchmentSel = document.getElementById('catchment-select');

  function syncSelectStyles() {
    _councilSel.classList.toggle('has-value', !!_councilSel.value);
    _catchmentSel.classList.toggle('has-value', !!_catchmentSel.value);
  }

  function sendRegion(kind, name, bounds, geometry) {
    var safe = saneBounds(name, bounds);
    if (bounds && !safe) { resetRegion(); return; }
    send({ cmd: 'set', region: { kind: kind, name: name, bounds: safe, geometry: safe ? geometry || null : null } });
  }

  function findItem(list, val) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === val) return list[i];
    }
    return null;
  }

  function resetRegion() {
    _councilSel.value   = '';
    _catchmentSel.value = '';
    syncSelectStyles();
    send({ cmd: 'set', region: { kind: null, name: 'All Scotland', bounds: null, geometry: null } });
  }

  _councilSel.addEventListener('change', function () {
    var val = _councilSel.value;
    if (!val) { resetRegion(); return; }
    _catchmentSel.value = '';   // one region at a time
    syncSelectStyles();
    var item = findItem(_councilItems, val);
    sendRegion('council', val, item ? item.bounds : null, item ? item.geometry : null);
  });

  _catchmentSel.addEventListener('change', function () {
    var val = _catchmentSel.value;
    if (!val) { resetRegion(); return; }
    _councilSel.value = '';
    syncSelectStyles();
    var item = findItem(_catchItems, val);
    if (!item) { resetRegion(); return; }
    // Catchment geometry isn't in /api/catchments — fetch it (cached) so the
    // wall can fit and clip in one step. The wall fetches it itself if absent.
    if (_catchGeom[val] !== undefined) {
      sendRegion('catchment', val, item.bounds, _catchGeom[val]);
      return;
    }
    fetch('/api/catchments/' + encodeURIComponent(val) + '/geometry')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (fc) {
        var geom = (fc && fc.features && fc.features[0]) ? fc.features[0].geometry : null;
        _catchGeom[val] = geom;
        sendRegion('catchment', val, item.bounds, geom);
      })
      .catch(function (e) {
        console.warn('[control] catchment geometry fetch failed:', e);
        sendRegion('catchment', val, item.bounds, null);
      });
  });

  document.getElementById('reset-region').addEventListener('click', resetRegion);

  Promise.all([
    fetch('/api/councils').then(function (r) { return r.ok ? r.json() : null; }),
    fetch('/api/catchments').then(function (r) { return r.ok ? r.json() : null; }),
  ]).then(function (results) {
    var councilsFC = results[0];
    var catchList  = results[1];
    if (councilsFC && councilsFC.features) {
      councilsFC.features.forEach(function (f) {
        var name = f.properties && f.properties.council_name;
        var bounds = name ? geomBbox(f.geometry) : null;
        if (bounds) _councilItems.push({ name: name, bounds: bounds, geometry: f.geometry });
      });
      _councilItems.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      _councilItems.forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = c.name;
        _councilSel.appendChild(opt);
      });
    } else {
      console.warn('[control] /api/councils response missing features:', councilsFC);
    }
    if (Array.isArray(catchList)) {
      catchList.forEach(function (c) {
        if (!c.name || !c.bbox) return;
        _catchItems.push({ name: c.name, bounds: [[c.bbox.west, c.bbox.south], [c.bbox.east, c.bbox.north]] });
      });
      _catchItems.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      _catchItems.forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = c.name;
        _catchmentSel.appendChild(opt);
      });
    } else {
      console.warn('[control] /api/catchments response is not an array:', catchList);
    }
    render();   // reapply the wall's region now that options exist
  }).catch(function (e) {
    console.warn('[control] failed to load region data:', e);
  });

  // ── Playback, month and member controls ──────────────────────────

  document.getElementById('btn-prev').addEventListener('click', function () { send({ cmd: 'step', delta: -1 }); });
  document.getElementById('btn-next').addEventListener('click', function () { send({ cmd: 'step', delta: 1 }); });
  document.getElementById('btn-play').addEventListener('click', function () {
    send({ cmd: _wall && _wall.state.playing ? 'pause' : 'play' });
  });
  document.getElementById('btn-tour').addEventListener('click', function () { send({ cmd: 'tour' }); });
  document.getElementById('btn-annual').addEventListener('click', function () { send({ cmd: 'play', playback: 'months' }); });
  document.getElementById('focus-select').addEventListener('change', function (e) { send({ cmd: 'set', focus: e.target.value }); });
  SCENES.catalog.forEach(function (scene) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ctrl-btn btn-scene';
    btn.dataset.scene = scene.id;
    btn.textContent = scene.title;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', function () { send({ cmd: 'set', scene: scene.id }); });
    document.getElementById('scene-grid').appendChild(btn);
  });

  var dwellSel = document.getElementById('dwell-select');
  function addDwellOption(sec) {
    var opt = document.createElement('option');
    opt.value = String(sec);
    opt.textContent = sec + ' s';
    dwellSel.appendChild(opt);
  }
  DWELLS.forEach(addDwellOption);
  dwellSel.value = '6';
  dwellSel.addEventListener('change', function () { send({ cmd: 'dwell', seconds: +dwellSel.value }); });

  var monthGrid = document.getElementById('month-grid');
  MONTHS.forEach(function (m) {
    var btn = document.createElement('button');
    btn.className     = 'ctrl-btn btn-month';
    btn.dataset.month = String(m);
    btn.textContent   = MONTH_NAMES[m];
    btn.addEventListener('click', function () { send({ cmd: 'set', month: m }); });
    monthGrid.appendChild(btn);
  });

  var memberGrid = document.getElementById('member-grid');
  MEMBERS.forEach(function (mb) {
    var btn = document.createElement('button');
    btn.className      = 'ctrl-btn btn-member' + (mb.id === 'mean' ? ' btn-mean' : '');
    btn.dataset.member = mb.id;
    btn.textContent    = mb.label;
    btn.addEventListener('click', function () { send({ cmd: 'set', member: mb.id }); });
    memberGrid.appendChild(btn);
  });

  // ── BroadcastChannel ─────────────────────────────────────────────

  function hello() {
    if (_channel) _channel.postMessage({ type: 'hello' });
    clearTimeout(_helloTimer);
    // No report within 2 s: assume no wall is open (it may appear later).
    _helloTimer = setTimeout(function () { if (!_wall) render(); }, 2000);
  }

  try {
    _channel = new (window.ClimaScopeRemoteChannel || window.BroadcastChannel)('climascope-immersive');
    _channel.onmessage = function (ev) {
      var msg = ev.data;
      if (!msg || msg.type !== 'wall') return;
      _wall = msg;
      _lastSeen = Date.now();
      render();
    };
    hello();
  } catch (e) {
    console.warn('[control] BroadcastChannel not available:', e);
    document.getElementById('status-text').textContent = 'BroadcastChannel not supported in this browser.';
  }

  setInterval(function () {
    if (_wall && Date.now() - _lastSeen > 25000) {
      _wall = null;
      render();
    }
  }, 5000);

  // Re-check when the controller tab becomes visible again.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) hello();
  });
})();
