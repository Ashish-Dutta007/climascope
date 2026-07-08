(function () {
  'use strict';

  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun',
                       'Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTHS = [1,2,3,4,5,6,7,8,9,10,11,12];
  const MEMBERS = [
    { id: 'mean', label: 'Ensemble mean' },
    { id: '01',  label: 'Member 01' },
    { id: '04',  label: 'Member 04' },
    { id: '05',  label: 'Member 05' },
    { id: '06',  label: 'Member 06' },
    { id: '07',  label: 'Member 07' },
    { id: '08',  label: 'Member 08' },
    { id: '09',  label: 'Member 09' },
    { id: '10',  label: 'Member 10' },
    { id: '11',  label: 'Member 11' },
    { id: '12',  label: 'Member 12' },
    { id: '13',  label: 'Member 13' },
    { id: '15',  label: 'Member 15' },
  ];

  var _state        = { month: 7, member: 'mean', region: { name: 'All Scotland', bounds: null, geometry: null } };
  var _channel      = null;
  var _councilItems = [];   // [{name, bounds, geometry}] sorted
  var _catchItems   = [];   // [{name, bounds}] sorted (geometry fetched on demand)
  var _catchGeom    = {};   // catchment name → geometry (cache)

  function broadcast() {
    if (_channel) {
      _channel.postMessage({
        type:   'state',
        month:  _state.month,
        member: _state.member,
        region: _state.region,
      });
    }
  }

  function updateStatus() {
    var el = document.getElementById('status');
    if (!el) return;
    var mLabel  = MONTH_NAMES[_state.month] || 'Month ' + _state.month;
    var mbLabel = _state.member === 'mean' ? 'Ensemble mean' : 'Member ' + _state.member;
    el.innerHTML = '<span class="status-dot"></span>';
    el.appendChild(document.createTextNode(
      'Broadcasting: ' + mLabel + ' · ' + mbLabel + ' · ' + _state.region.name));
  }

  function highlight() {
    document.querySelectorAll('.btn-month').forEach(function (btn) {
      btn.classList.toggle('active', +btn.dataset.month === _state.month);
    });
    document.querySelectorAll('.btn-member').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.member === _state.member);
    });
  }

  function setMonth(m) {
    _state.month = m;
    highlight();
    updateStatus();
    broadcast();
  }

  function setMember(mb) {
    _state.member = mb;
    highlight();
    updateStatus();
    broadcast();
  }

  // ── Region selects ───────────────────────────────────────────────

  // Compute WGS84 bbox from a GeoJSON geometry object.
  // Returns [[minLng, minLat], [maxLng, maxLat]] or null if geometry is invalid.
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
  var SCOTLAND_EXTENT = { w: -8.0, s: 54.0, e: 0.5, n: 62.0 };

  function saneBounds(name, bounds) {
    if (!bounds) return null;
    var w = bounds[0][0], s = bounds[0][1], e = bounds[1][0], n = bounds[1][1];
    var dLng = e - w, dLat = n - s;
    var ok = isFinite(w) && isFinite(s) && isFinite(e) && isFinite(n)
             && dLng >= 0.01 && dLat >= 0.01
             && w >= SCOTLAND_EXTENT.w && e <= SCOTLAND_EXTENT.e
             && s >= SCOTLAND_EXTENT.s && n <= SCOTLAND_EXTENT.n;
    if (!ok) {
      console.error('[control] bounds for "' + name + '" failed sanity check — '
        + 'w=' + w + ' s=' + s + ' e=' + e + ' n=' + n
        + ' spanLng=' + dLng.toFixed(4) + ' spanLat=' + dLat.toFixed(4)
        + ' — falling back to All Scotland. '
        + 'If values are 5–7 digit integers the source CRS is BNG (EPSG:27700), not WGS84.');
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

  function setRegion(name, bounds, geometry) {
    var safeBounds = saneBounds(name, bounds);
    if (bounds && !safeBounds) {
      // Bounds failed sanity — reset the selects to avoid a misleading highlight
      _councilSel.value   = '';
      _catchmentSel.value = '';
      name     = 'All Scotland';
      geometry = null;
    }
    console.log('[control] setRegion:', name,
      safeBounds
        ? 'w=' + safeBounds[0][0].toFixed(4) + ' s=' + safeBounds[0][1].toFixed(4)
          + ' e=' + safeBounds[1][0].toFixed(4) + ' n=' + safeBounds[1][1].toFixed(4)
          + ' spanLng=' + (safeBounds[1][0] - safeBounds[0][0]).toFixed(4)
          + ' spanLat=' + (safeBounds[1][1] - safeBounds[0][1]).toFixed(4)
        : '(null — using All Scotland)',
      geometry ? '(+' + geometry.type + ' mask)' : '(no mask)');
    _state.region = { name: name, bounds: safeBounds, geometry: safeBounds ? (geometry || null) : null };
    syncSelectStyles();
    updateStatus();
    broadcast();
  }

  function findItem(list, val) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === val) return list[i];
    }
    return null;
  }

  // Return to the full Scotland view: clear BOTH dropdowns so neither can show
  // a stale region, and broadcast the region reset (bounds/geometry null).
  function resetRegion() {
    _councilSel.value   = '';
    _catchmentSel.value = '';
    setRegion('All Scotland', null, null);
  }

  _councilSel.addEventListener('change', function () {
    var val = _councilSel.value;
    if (!val) { resetRegion(); return; }
    // Only one region active at a time — selecting a council clears the catchment.
    _catchmentSel.value = '';
    var item = findItem(_councilItems, val);
    // Council geometry is preloaded from /api/councils — broadcast immediately.
    setRegion(val, item ? item.bounds : null, item ? item.geometry : null);
  });

  _catchmentSel.addEventListener('change', function () {
    var val = _catchmentSel.value;
    if (!val) { resetRegion(); return; }
    // Only one region active at a time — selecting a catchment clears the council.
    _councilSel.value = '';
    var item = findItem(_catchItems, val);
    if (!item) { resetRegion(); return; }
    // Catchment geometry isn't in /api/catchments — fetch it (cached), then
    // broadcast bounds + mask together so the wall fits and clips in one step.
    if (_catchGeom[val] !== undefined) {
      setRegion(val, item.bounds, _catchGeom[val]);
      return;
    }
    fetch('/api/catchments/' + encodeURIComponent(val) + '/geometry')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (fc) {
        var geom = (fc && fc.features && fc.features[0]) ? fc.features[0].geometry : null;
        _catchGeom[val] = geom;
        if (!geom) console.warn('[control] no geometry for catchment "' + val + '" — camera only');
        setRegion(val, item.bounds, geom);
      })
      .catch(function (e) {
        console.warn('[control] catchment geometry fetch failed:', e);
        _catchGeom[val] = null;
        setRegion(val, item.bounds, null);  // camera only, no mask
      });
  });

  var _resetBtn = document.getElementById('reset-region');
  if (_resetBtn) _resetBtn.addEventListener('click', resetRegion);

  // Populate both selects from API
  Promise.all([
    fetch('/api/councils').then(function (r) { return r.ok ? r.json() : null; }),
    fetch('/api/catchments').then(function (r) { return r.ok ? r.json() : null; }),
  ]).then(function (results) {
    var councilsFC = results[0];
    var catchList  = results[1];

    if (councilsFC && councilsFC.features) {
      var nullGeomCount = 0;
      councilsFC.features.forEach(function (f) {
        var name = f.properties && f.properties.council_name;
        if (!name) return;
        var bounds = null;
        try {
          bounds = geomBbox(f.geometry);
        } catch (e) {
          console.warn('[control] geomBbox threw for council "' + name + '":', e);
          nullGeomCount++;
          return;
        }
        if (!bounds) { nullGeomCount++; return; }
        _councilItems.push({ name: name, bounds: bounds, geometry: f.geometry });
      });
      _councilItems.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      _councilItems.forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = c.name;
        _councilSel.appendChild(opt);
      });
      if (nullGeomCount) {
        console.warn('[control] ' + nullGeomCount + ' council(s) skipped (null/invalid geometry)');
      }

      // Debug: log bounds for a couple of known councils
      ['Clackmannanshire', 'Highland'].forEach(function (target) {
        var item = null;
        for (var i = 0; i < _councilItems.length; i++) {
          if (_councilItems[i].name === target) { item = _councilItems[i]; break; }
        }
        if (item) {
          console.log('[control] ' + target + ' bounds:',
            'w=' + item.bounds[0][0].toFixed(4), 's=' + item.bounds[0][1].toFixed(4),
            'e=' + item.bounds[1][0].toFixed(4), 'n=' + item.bounds[1][1].toFixed(4),
            'spanLng=' + (item.bounds[1][0] - item.bounds[0][0]).toFixed(4),
            'spanLat=' + (item.bounds[1][1] - item.bounds[0][1]).toFixed(4));
        } else {
          console.warn('[control] ' + target + ' not found in council list');
        }
      });
      console.log('[control] loaded', _councilItems.length, 'councils');
    } else {
      console.warn('[control] /api/councils response missing features:', councilsFC);
    }

    if (Array.isArray(catchList)) {
      catchList.forEach(function (c) {
        if (!c.name || !c.bbox) return;
        _catchItems.push({
          name:   c.name,
          bounds: [[c.bbox.west, c.bbox.south], [c.bbox.east, c.bbox.north]],
        });
      });
      _catchItems.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      _catchItems.forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = c.name;
        _catchmentSel.appendChild(opt);
      });
      console.log('[control] loaded', _catchItems.length, 'catchments');
    } else {
      console.warn('[control] /api/catchments response is not an array:', catchList);
    }
  }).catch(function (e) {
    console.warn('[control] failed to load region data:', e);
  });

  // ── Month buttons ────────────────────────────────────────────────

  var monthGrid = document.getElementById('month-grid');
  MONTHS.forEach(function (m) {
    var btn = document.createElement('button');
    btn.className     = 'ctrl-btn btn-month';
    btn.dataset.month = String(m);
    btn.textContent   = MONTH_NAMES[m];
    btn.addEventListener('click', function () { setMonth(m); });
    monthGrid.appendChild(btn);
  });

  // ── Member buttons ───────────────────────────────────────────────

  var memberGrid = document.getElementById('member-grid');
  MEMBERS.forEach(function (mb) {
    var btn = document.createElement('button');
    btn.className      = 'ctrl-btn btn-member' + (mb.id === 'mean' ? ' btn-mean' : '');
    btn.dataset.member = mb.id;
    btn.textContent    = mb.label;
    btn.addEventListener('click', function () { setMember(mb.id); });
    memberGrid.appendChild(btn);
  });

  // ── BroadcastChannel ─────────────────────────────────────────────

  try {
    _channel = new BroadcastChannel('climascope-immersive');
    _channel.onmessage = function (ev) {
      if (ev.data && ev.data.type === 'ping') broadcast();
    };
  } catch (e) {
    console.warn('[control] BroadcastChannel not available:', e);
    var statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = 'BroadcastChannel not supported in this browser.';
  }

  highlight();
  updateStatus();
  broadcast();

})();
