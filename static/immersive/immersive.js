(function () {
  'use strict';

  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun',
                       'Jul','Aug','Sep','Oct','Nov','Dec'];

  // Three periods shown left→right in each panel.
  // col: which parquet column to request for this period.
  //   obs_value  — fixed per-cell observed baseline constant (absolute)
  //   proj_value — projected period mean (absolute), same quantity as obs_value
  // All three maps show the same physical quantity so the shared colour domain
  // and trend readout are directly comparable for ensemble mean and members.
  const PERIODS = [
    { id: '1990-2019', label: 'Observed baseline', col: 'obs_value',  baseline: true  },
    { id: '2020-2049', label: '2020–2049',          col: 'proj_value', baseline: false },
    { id: '2050-2079', label: '2050–2079',          col: 'proj_value', baseline: false },
  ];

  // Default 3 panels. ETPT_sum dropped from the default (the batch endpoint
  // still returns it; it is simply not rendered). Re-add the row to restore it.
  const PANELS = [
    { id: 'CWBPT',    label: 'CWB PT',        units: 'mm', type: 'balance'     },
    { id: 'Prec_sum', label: 'Precipitation', units: 'mm', type: 'volume'      },
    { id: 'Tmax_mean',label: 'Tmax',          units: '°C', type: 'temperature' },
  ];

  // Chart line colours, fixed across every panel so the mapping is learned once.
  const CHART_BASE_COLOR   = '#8fb0e0';  // muted light blue = 1990-2019
  const CHART_FUTURE_COLOR = '#ff6b35';  // strong orange    = 2050-2079

  const SCOTLAND_BOUNDS = [[-7.7, 54.6], [-0.7, 60.9]];
  const BG_COLOR = '#0d0f1a';

  // World ring used as the outer boundary of every mask feature.
  const WORLD_RING = [[-180,-90],[-180,90],[180,90],[180,-90],[-180,-90]];

  // World polygon with Scotland bbox as a hole — the default ("All Scotland")
  // mask: suppresses Norway/England/Denmark and everything outside Scotland.
  const FOG_FEATURE = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        WORLD_RING,
        [[-7.7,54.6],[-0.7,54.6],[-0.7,60.9],[-7.7,60.9],[-7.7,54.6]],  // Scotland bbox hole
      ],
    },
  };

  // Collect every exterior ring from a Polygon / MultiPolygon geometry.
  // (Region interior holes are ignored for now — councils rarely have them.)
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

  // Build a mask fill feature that covers the whole world EXCEPT the region:
  // the world ring is the boundary, each region exterior ring is punched out
  // as a hole, so only the region's interior shows the data layer beneath.
  // Falls back to the Scotland mask when the geometry has no usable rings.
  function buildMaskFeature(geometry) {
    var rings = exteriorRings(geometry);
    if (!rings.length) return FOG_FEATURE;
    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [WORLD_RING].concat(rings),
      },
    };
  }

  // ── Locator inset ────────────────────────────────────────────────

  const LOCATOR_BOX = { w: -7.9, s: 54.55, e: -0.55, n: 60.95 };
  const LOCATOR_SIZE = { w: 182, h: 232, pad: 8 };

  var _locatorContextPath = '';

  function projectLocator(coord) {
    var usableW = LOCATOR_SIZE.w - LOCATOR_SIZE.pad * 2;
    var usableH = LOCATOR_SIZE.h - LOCATOR_SIZE.pad * 2;
    var scale = Math.min(
      usableW / (LOCATOR_BOX.e - LOCATOR_BOX.w),
      usableH / (LOCATOR_BOX.n - LOCATOR_BOX.s)
    );
    var usedW = (LOCATOR_BOX.e - LOCATOR_BOX.w) * scale;
    var usedH = (LOCATOR_BOX.n - LOCATOR_BOX.s) * scale;
    var ox = LOCATOR_SIZE.pad + (usableW - usedW) * 0.5;
    var oy = LOCATOR_SIZE.pad + (usableH - usedH) * 0.5;
    return [
      ox + (coord[0] - LOCATOR_BOX.w) * scale,
      oy + (LOCATOR_BOX.n - coord[1]) * scale,
    ];
  }

  function ringToPath(ring) {
    if (!ring || ring.length < 2) return '';
    var parts = [];
    ring.forEach(function (coord, i) {
      var p = projectLocator(coord);
      parts.push((i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1));
    });
    return parts.join(' ') + ' Z';
  }

  function geometryToPath(geometry) {
    return exteriorRings(geometry).map(ringToPath).filter(Boolean).join(' ');
  }

  function locatorCenter(bounds, geometry) {
    var b = bounds;
    if (!b && geometry) {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      exteriorRings(geometry).forEach(function (ring) {
        ring.forEach(function (coord) {
          minX = Math.min(minX, coord[0]); maxX = Math.max(maxX, coord[0]);
          minY = Math.min(minY, coord[1]); maxY = Math.max(maxY, coord[1]);
        });
      });
      if (isFinite(minX)) b = [[minX, minY], [maxX, maxY]];
    }
    if (!b) return null;
    return projectLocator([(b[0][0] + b[1][0]) * 0.5, (b[0][1] + b[1][1]) * 0.5]);
  }

  function renderLocator() {
    var el = document.getElementById('locator-inset');
    if (!el) return;
    var active = _state.region.bounds && _state.region.name !== 'All Scotland';
    el.classList.toggle('active', !!active);
    if (!active) {
      el.innerHTML = '';
      return;
    }

    var regionPath = geometryToPath(_state.region.geometry);
    var center = locatorCenter(_state.region.bounds, _state.region.geometry);
    var dot = center
      ? '<circle class="locator-ring" cx="' + center[0].toFixed(1) + '" cy="' + center[1].toFixed(1) + '" r="8.5"></circle>' +
        '<circle class="locator-dot" cx="' + center[0].toFixed(1) + '" cy="' + center[1].toFixed(1) + '" r="4.2"></circle>'
      : '';

    el.innerHTML =
      '<svg viewBox="0 0 ' + LOCATOR_SIZE.w + ' ' + LOCATOR_SIZE.h + '" role="img" aria-label="Selected region location in Scotland">' +
        (_locatorContextPath ? '<path class="locator-context" d="' + _locatorContextPath + '"></path>' : '') +
        (regionPath ? '<path class="locator-region" d="' + regionPath + '"></path>' : '') +
        dot +
      '</svg>';
  }

  function loadLocatorContext() {
    fetch('/api/councils')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (fc) {
        if (!fc || !fc.features) return;
        _locatorContextPath = fc.features.map(function (f) {
          return geometryToPath(f.geometry);
        }).filter(Boolean).join(' ');
        renderLocator();
      })
      .catch(function (e) {
        console.warn('[immersive] locator context fetch failed:', e);
      });
  }

  // ── Colour helpers ────────────────────────────────────────────────

  function buildColorExpr(type, lo, hi) {
    var fs = ['feature-state', 'value'];
    var interp;
    if (type === 'balance') {
      if      (hi <= 0) interp = ['interpolate',['linear'],fs, lo,'#d73027', hi,'#f7f7f7'];
      else if (lo >= 0) interp = ['interpolate',['linear'],fs, lo,'#f7f7f7', hi,'#4575b4'];
      else              interp = ['interpolate',['linear'],fs, lo,'#d73027', 0,'#f7f7f7', hi,'#4575b4'];
    } else if (type === 'temperature') {
      if      (hi <= 0) interp = ['interpolate',['linear'],fs, lo,'#4575b4', hi,'#ffffbf'];
      else if (lo >= 0) interp = ['interpolate',['linear'],fs, lo,'#ffffbf', hi,'#d73027'];
      else              interp = ['interpolate',['linear'],fs, lo,'#4575b4', 0,'#ffffbf', hi,'#d73027'];
    } else {
      var mid = lo + (hi - lo) * 0.5;
      interp = ['interpolate',['linear'],fs, lo,'#ffffcc', mid,'#41b6c4', hi,'#0c2c84'];
    }
    return ['case', ['==', fs, null], BG_COLOR, interp];
  }

  function buildLegendGradient(type, lo, hi) {
    var range = (hi - lo) || 1;
    if (type === 'balance') {
      if (hi <= 0)  return 'linear-gradient(to right,#d73027,#f7f7f7)';
      if (lo >= 0)  return 'linear-gradient(to right,#f7f7f7,#4575b4)';
      var pct = ((0 - lo) / range * 100).toFixed(1);
      return 'linear-gradient(to right,#d73027 0%,#f7f7f7 ' + pct + '%,#4575b4 100%)';
    }
    if (type === 'temperature') {
      if (hi <= 0)  return 'linear-gradient(to right,#4575b4,#ffffbf)';
      if (lo >= 0)  return 'linear-gradient(to right,#ffffbf,#d73027)';
      var pct2 = ((0 - lo) / range * 100).toFixed(1);
      return 'linear-gradient(to right,#4575b4 0%,#ffffbf ' + pct2 + '%,#d73027 100%)';
    }
    return 'linear-gradient(to right,#ffffcc,#41b6c4,#0c2c84)';
  }

  function fmtVal(v) {
    if (v === null || v === undefined) return '—';
    var abs = Math.abs(v).toFixed(1);
    return (v >= 0 ? '+' : '−') + abs;
  }

  function renderLegend(el, panel, lo, hi) {
    var gradient = buildLegendGradient(panel.type, lo, hi);
    var range    = (hi - lo) || 1;
    var zeroHtml = '';
    if (lo < 0 && hi > 0) {
      var pct = ((0 - lo) / range * 100).toFixed(1);
      zeroHtml = '<div class="legend-zero" style="left:' + pct + '%"></div>';
    }
    el.innerHTML =
      '<div class="legend-ramp-wrap">' +
        '<div class="legend-ramp" style="background:' + gradient + '"></div>' +
        zeroHtml +
      '</div>' +
      '<div class="legend-minmax">' +
        '<span>' + fmtVal(lo) + '</span>' +
        '<span class="legend-units">' + panel.units + '</span>' +
        '<span>' + fmtVal(hi) + '</span>' +
      '</div>';
  }

  function renderStats(el, panel, means) {
    el.innerHTML = '';
    PERIODS.forEach(function (p, i) {
      var group = document.createElement('div');
      group.className = 'stat-group';
      group.innerHTML =
        '<div class="stat-value">' + fmtVal(means[i]) + '</div>' +
        '<div class="stat-period">' + p.label + '</div>';
      el.appendChild(group);
      if (i < PERIODS.length - 1) {
        var arrow = document.createElement('div');
        arrow.className = 'stat-arrow';
        arrow.textContent = '→';
        el.appendChild(arrow);
      }
    });
    var units = document.createElement('div');
    units.className = 'stat-units';
    units.textContent = panel.units;
    el.appendChild(units);
  }

  // ── Map management ────────────────────────────────────────────────

  function createMap(containerId, type, domain, data) {
    var map = new maplibregl.Map({
      container:          containerId,
      style: {
        version: 8,
        sources: {
          basemap: {
            type:        'raster',
            tiles:       ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
            tileSize:    256,
            attribution: '© Esri',
          },
        },
        layers: [{
          id:     'basemap',
          type:   'raster',
          source: 'basemap',
          paint:  { 'raster-opacity': 0.28 },
        }],
      },
      center:             [-4.2, 57.0],
      zoom:               6,
      scrollZoom:         false,
      boxZoom:            false,
      dragRotate:         false,
      dragPan:            false,
      keyboard:           false,
      doubleClickZoom:    false,
      touchZoomRotate:    false,
      touchPitch:         false,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.once('style.load', function () {
      map.addSource('cells-vt', {
        type:      'vector',
        tiles:     [window.location.origin + '/tiles/{z}/{x}/{y}.pbf'],
        minzoom:   5,
        maxzoom:   14,
        promoteId: { cells: 'id_1km' },
      });

      map.addLayer({
        id:             'cells-fill',
        type:           'fill',
        source:         'cells-vt',
        'source-layer': 'cells',
        paint: {
          'fill-antialias': false,
          'fill-color':     buildColorExpr(type, domain.min, domain.max),
          'fill-opacity':   1.0,
        },
      });

      // Mask sits ABOVE the cells so it can hide cells that fall inside the
      // region's bbox but outside its shape. Full opacity = clean clip.
      // Data reflects the active region (or the Scotland default).
      var maskData = _state.region.geometry
        ? buildMaskFeature(_state.region.geometry)
        : FOG_FEATURE;
      map.addSource('fog', { type: 'geojson', data: maskData });
      map.addLayer({
        id:     'fog',
        type:   'fill',
        source: 'fog',
        paint:  { 'fill-color': BG_COLOR, 'fill-opacity': 1.0 },
      });

      // Force container measurement before fitting bounds.
      // Use the current region bounds if a zoom is active (fitBounds respects _state.region).
      map.resize();
      map.fitBounds(_state.region.bounds || SCOTLAND_BOUNDS, { padding: 20, duration: 0 });

      if (data) {
        var ids = Object.keys(data);
        for (var i = 0; i < ids.length; i++) {
          var v = data[ids[i]];
          if (v != null && isFinite(v)) {
            map.setFeatureState(
              { source: 'cells-vt', sourceLayer: 'cells', id: +ids[i] },
              { value: v }
            );
          }
        }
      }
    });

    return map;
  }

  // Update an already-initialised map with new domain and data.
  // All setFeatureState calls are batched by MapLibre and applied in the next
  // render frame, so overwriting old states is visually atomic.
  function updateMapData(map, type, domain, data) {
    map.setPaintProperty('cells-fill', 'fill-color', buildColorExpr(type, domain.min, domain.max));
    map.removeFeatureState({ source: 'cells-vt', sourceLayer: 'cells' });
    if (data) {
      var ids = Object.keys(data);
      for (var i = 0; i < ids.length; i++) {
        var v = data[ids[i]];
        if (v != null && isFinite(v)) {
          map.setFeatureState(
            { source: 'cells-vt', sourceLayer: 'cells', id: +ids[i] },
            { value: v }
          );
        }
      }
    }
  }

  // ── State management ─────────────────────────────────────────────

  var _state      = { month: 7, member: 'mean', region: { name: 'All Scotland', bounds: null, geometry: null } };
  var _channel    = null;
  var _controller = null;  // AbortController for the current in-flight batch fetch
  var _stateVer   = 0;     // incremented per fetchAll; guards superseded .then() callbacks

  var _panelStates = [];

  // Per-region monthly ensemble means (drives the bottom strip). Loaded once.
  var _regionMonthly = null;

  function currentRegionId() {
    return (_state.region.name && _state.region.name !== 'All Scotland')
      ? _state.region.name : 'national';
  }

  // Strip values for one metric: [baseline, 2020-2049, 2050-2079] for the
  // current region + month. null where data is absent (e.g. Loch Huisinis).
  function regionMeans(metricId) {
    var mi  = _state.month - 1;
    var rec = _regionMonthly && _regionMonthly[currentRegionId()] && _regionMonthly[currentRegionId()][metricId];
    return PERIODS.map(function (p) {
      var arr = rec && rec[p.id];
      var v   = arr ? arr[mi] : null;
      return (v == null || !isFinite(v)) ? null : v;
    });
  }

  function refreshStrips() {
    _panelStates.forEach(function (ps) {
      if (ps.statsEl) renderStats(ps.statsEl, ps.panel, regionMeans(ps.panel.id));
    });
  }

  // 12-month seasonal chart: baseline (1990-2019) vs 2050-2079, ensemble mean,
  // read only from _regionMonthly. Hand-rolled inline SVG, no library.
  function buildChartSVG(base, fut, unit, selIdx, W, H) {
    var f  = Math.max(22, Math.min(38, W / 27));  // axis font, sized for distance
    var cf = Math.max(18, f - 7);                 // caption font
    var L = Math.round(f * 4.4), R = Math.round(f * 0.9);
    var T = Math.round(f * 1.3), B = Math.round(f * 3.2);
    var pw = W - L - R, ph = H - T - B;
    var frame = '<rect x="' + L + '" y="' + T + '" width="' + pw + '" height="' + ph +
                '" fill="none" stroke="rgba(150,170,210,0.32)" stroke-width="1.5"/>';

    function xAt(i) { return L + (i / 11) * pw; }

    // 4 month ticks only (Jan / Apr / Jul / Oct); all 12 data points still plotted.
    var monthY = (H - B) + f + 6, months = '';
    [0, 3, 6, 9].forEach(function (i) {
      months += '<text x="' + xAt(i).toFixed(1) + '" y="' + monthY.toFixed(1) +
        '" text-anchor="middle" font-size="' + f.toFixed(0) + '" font-weight="600"' +
        ' fill="rgba(205,217,242,0.78)">' + MONTH_NAMES[i + 1] + '</text>';
    });

    var vals = [];
    [base, fut].forEach(function (s) {
      if (s) s.forEach(function (v) { if (v != null && isFinite(v)) vals.push(v); });
    });
    if (!vals.length) {
      return '<svg width="100%" height="100%" viewBox="0 0 ' + W + ' ' + H + '">' + frame + months +
        '<text x="' + (W / 2) + '" y="' + (T + ph / 2) + '" text-anchor="middle" font-size="' +
        f.toFixed(0) + '" fill="rgba(205,217,242,0.5)">no data</text></svg>';
    }

    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var pad = (mx - mn) * 0.18 || Math.abs(mx) * 0.18 || 1;  // ~13% visual breathing room top/bottom
    var lo = mn - pad, hi = mx + pad;
    function yAt(v) { return T + (1 - (v - lo) / (hi - lo)) * ph; }

    function poly(series, color) {
      if (!series) return '';
      var pts = [];
      for (var i = 0; i < 12; i++) {
        var v = series[i];
        if (v != null && isFinite(v)) pts.push(xAt(i).toFixed(1) + ',' + yAt(v).toFixed(1));
      }
      return pts.length ? '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color +
        '" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>' : '';
    }

    var grid = '', ticks = [hi, (lo + hi) / 2, lo];
    ticks.forEach(function (tv, k) {
      var y = yAt(tv);
      grid += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (L + pw) + '" y2="' + y.toFixed(1) +
        '" stroke="rgba(150,170,210,0.15)" stroke-width="1.5"/>';
      var lbl = (Math.abs(hi - lo) >= 10 ? Math.round(tv) : tv.toFixed(1));
      grid += '<text x="' + (L - 14) + '" y="' + (y + f * 0.34).toFixed(1) + '" text-anchor="end" font-size="' +
        f.toFixed(0) + '" fill="rgba(205,217,242,0.82)">' + lbl + (k === 0 ? ' ' + unit : '') + '</text>';
    });

    var mx0 = xAt(selIdx).toFixed(1);
    var marker = '<line x1="' + mx0 + '" y1="' + T + '" x2="' + mx0 + '" y2="' + (T + ph) +
      '" stroke="rgba(255,255,255,0.5)" stroke-width="4"/>';
    var dotR = Math.round(f * 0.36) + 2;
    function dot(series, color) {
      var v = series ? series[selIdx] : null;
      if (v == null || !isFinite(v)) return '';
      return '<circle cx="' + mx0 + '" cy="' + yAt(v).toFixed(1) + '" r="' + dotR +
        '" fill="' + color + '" stroke="#0a0c1b" stroke-width="3"/>';
    }

    // One caption line below the month labels, clear of the plot.
    var charW = cf * 0.6, sw = Math.round(cf * 1.3), gap = charW * 0.8;
    var parts = [
      { sw: CHART_BASE_COLOR }, { t: '1990-2019', c: '#cdd9f2' },
      { t: 'vs', c: 'rgba(205,217,242,0.6)' },
      { sw: CHART_FUTURE_COLOR }, { t: '2050-2079', c: '#cdd9f2' },
      { t: '· ensemble mean', c: 'rgba(205,217,242,0.6)' },
    ];
    var totalW = 0;
    parts.forEach(function (p) { totalW += (p.sw ? sw : p.t.length * charW) + gap; });
    var cx = Math.max(L, (W - totalW) / 2), cy = H - Math.round(f * 0.5), caption = '';
    parts.forEach(function (p) {
      if (p.sw) {
        caption += '<line x1="' + cx + '" y1="' + (cy - cf * 0.3) + '" x2="' + (cx + sw) + '" y2="' + (cy - cf * 0.3) +
          '" stroke="' + p.sw + '" stroke-width="6" stroke-linecap="round"/>';
        cx += sw + gap;
      } else {
        caption += '<text x="' + cx.toFixed(1) + '" y="' + cy + '" font-size="' + cf.toFixed(0) +
          '" fill="' + p.c + '">' + p.t + '</text>';
        cx += p.t.length * charW + gap;
      }
    });

    return '<svg width="100%" height="100%" viewBox="0 0 ' + W + ' ' + H + '">' +
      grid + frame + marker +
      poly(base, CHART_BASE_COLOR) + poly(fut, CHART_FUTURE_COLOR) +
      dot(base, CHART_BASE_COLOR) + dot(fut, CHART_FUTURE_COLOR) +
      months + caption + '</svg>';
  }

  function renderChart(ps) {
    var el = ps.chartEl;
    if (!el) return;
    var W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    var rec  = _regionMonthly && _regionMonthly[currentRegionId()] && _regionMonthly[currentRegionId()][ps.panel.id];
    var base = rec ? rec['1990-2019'] : null;
    var fut  = rec ? rec['2050-2079'] : null;
    el.innerHTML = buildChartSVG(base, fut, ps.panel.units, _state.month - 1, W, H);
  }

  function redrawCharts() {
    _panelStates.forEach(renderChart);
  }

  function loadRegionMonthly() {
    fetch('/static/immersive/region_monthly.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { _regionMonthly = j || {}; refreshStrips(); redrawCharts(); })
      .catch(function (e) {
        console.warn('[immersive] region_monthly load failed:', e);
        _regionMonthly = {};
      });
  }

  function updateSelectionStrip() {
    var el = document.getElementById('selection-strip');
    if (!el) return;
    var mLabel  = MONTH_NAMES[_state.month] || 'Month ' + _state.month;
    var mbLabel = _state.member === 'mean' ? 'Ensemble mean' : 'Member ' + _state.member;
    var text    = mLabel + ' · ' + mbLabel;
    if (_state.region.name !== 'All Scotland') text += ' · ' + _state.region.name;
    el.textContent = text;
  }

  // ── Batched fetch: one request covers all 4 metrics × 3 periods ──

  function fetchAll(isInitial) {
    // Abort any in-flight request from the previous state; treat AbortError as silent.
    if (_controller) {
      try { _controller.abort(); } catch (e) {}
    }
    _controller = new AbortController();
    var ver    = ++_stateVer;
    var signal = _controller.signal;

    _panelStates.forEach(function (ps) {
      ps.panelEl.classList.add('updating');
    });

    var url = '/api/immersive_values?month=' + _state.month +
      (_state.member && _state.member !== 'mean' ? '&member=' + _state.member : '');

    fetch(url, { signal: signal })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (allData) {
        // Guard: a newer applyState may have already started its own fetch
        if (_stateVer !== ver) return;

        PANELS.forEach(function (panel, pi) {
          var ps = _panelStates[pi];
          ps.needsRefetch = false;

          var panelData = allData[panel.id] || {};
          var datasets = PERIODS.map(function (p) {
            var d = panelData[p.id];
            return (d && Object.keys(d).length) ? d : null;
          });

          // On updates (maps already exist): keep old data if any period is missing
          var isUpdate = ps.maps.some(function (m) { return m !== null; });
          if (isUpdate && datasets.some(function (d) { return d === null; })) {
            console.warn('[immersive] missing data for', panel.id, '— keeping old data');
            ps.panelEl.classList.remove('updating');
            return;
          }

          var allVals = [];
          datasets.forEach(function (d) {
            if (!d) return;
            var vals = Object.values(d);
            for (var i = 0; i < vals.length; i++) {
              var v = vals[i];
              if (v != null && isFinite(v)) allVals.push(v);
            }
          });

          if (!allVals.length) {
            console.warn('[immersive] no data for', panel.id);
            ps.panelEl.classList.remove('updating');
            return;
          }

          var domain = {
            min: allVals.reduce(function (a, b) { return b < a ? b : a; }, Infinity),
            max: allVals.reduce(function (a, b) { return b > a ? b : a; }, -Infinity),
          };

          // Strip means come from the per-region precompute, not the cell data.
          renderLegend(ps.legendEl, ps.panel, domain.min, domain.max);
          renderStats(ps.statsEl, ps.panel, regionMeans(ps.panel.id));

          datasets.forEach(function (data, j) {
            if (ps.maps[j] && ps.mapReady[j]) {
              // Map is live — update in place
              updateMapData(ps.maps[j], ps.panel.type, domain, data);
            } else if (!ps.maps[j]) {
              // Initial creation.
              // isInitial: stagger across all 12 slots (pi*3+j)*160 ms.
              // Update path: short per-map delay so 3 maps in a panel don't all init at once.
              if (!data) return;
              var delay = isInitial ? (pi * 3 + j) * 160 : j * 80;
              (function (d_, j_, ver_) {
                setTimeout(function () {
                  // If state changed while waiting in the queue, skip this creation
                  if (_stateVer !== ver_) return;
                  var m = createMap(ps.mapIds[j_], ps.panel.type, domain, d_);
                  ps.maps[j_] = m;
                  m.once('style.load', function () {
                    ps.mapReady[j_] = true;
                    if (j_ === 0 && !ps.scaleCtrl) {
                      var scale = new maplibregl.ScaleControl({ maxWidth: 160, unit: 'metric' });
                      m.addControl(scale, 'bottom-left');
                      ps.scaleCtrl = scale;
                      ps.scaleEl = m.getContainer().querySelector('.maplibregl-ctrl-bottom-left');
                      if (ps.scaleEl) ps.scaleEl.style.display = _state.region.bounds ? '' : 'none';
                    }
                    // If a state change arrived while this map was initialising,
                    // trigger a fresh fetch once the whole panel is ready.
                    if (ps.needsRefetch && ps.mapReady.every(function (r) { return r; })) {
                      ps.needsRefetch = false;
                      fetchAll(false);
                    }
                  });
                }, delay);
              })(data, j, ver);
            } else {
              // Map exists but style not loaded — mark for re-fetch once it's ready
              ps.needsRefetch = true;
            }
          });

          setTimeout(function () {
            ps.panelEl.classList.remove('updating');
          }, 150);
        });
      })
      .catch(function (err) {
        // AbortError means applyState fired a newer fetch — no action needed
        if (err && err.name === 'AbortError') return;
        console.warn('[immersive] batch fetch failed:', err);
        _panelStates.forEach(function (ps) {
          ps.panelEl.classList.remove('updating');
        });
      });
  }

  function applyState(month, member) {
    if (_state.month === month && _state.member === member) return;
    _state.month  = month;
    _state.member = member;
    updateSelectionStrip();
    fetchAll(false);
    redrawCharts();
  }

  // Animate all ready maps to the given bounds. null → Scotland default.
  function fitBoundsAll(bounds) {
    var target = bounds || SCOTLAND_BOUNDS;
    console.log('[immersive] fitBoundsAll target:', JSON.stringify(target));
    var logged = false;
    _panelStates.forEach(function (ps) {
      ps.maps.forEach(function (map, j) {
        if (map && ps.mapReady[j]) {
          try {
            map.fitBounds(target, { padding: 20, duration: 1200 });
            if (!logged) {
              logged = true;
              map.once('moveend', function () {
                var c = map.getCenter();
                var b = map.getBounds();
                console.log('[immersive] after fit: zoom=' + map.getZoom().toFixed(2)
                  + ' center=' + c.lng.toFixed(4) + ',' + c.lat.toFixed(4)
                  + ' visible w=' + b.getWest().toFixed(4) + ' s=' + b.getSouth().toFixed(4)
                  + ' e=' + b.getEast().toFixed(4) + ' n=' + b.getNorth().toFixed(4)
                  + ' canvas=' + map.getCanvas().width + 'x' + map.getCanvas().height);
              });
            }
          } catch (e) {
            console.error('[immersive] fitBounds failed:', e);
          }
        } else {
          console.warn('[immersive] map skipped (not ready):', ps.panel.id, 'col', j);
        }
      });
    });
  }

  // Same sanity clamp as the controller — defense in depth on the receive side.
  function regionBoundsSane(name, bounds) {
    var w = bounds[0] && bounds[0][0], s = bounds[0] && bounds[0][1];
    var e = bounds[1] && bounds[1][0], n = bounds[1] && bounds[1][1];
    var ok = isFinite(w) && isFinite(s) && isFinite(e) && isFinite(n)
             && (e - w) >= 0.01 && (n - s) >= 0.01
             && w >= -8.0 && e <= 0.5 && s >= 54.0 && n <= 62.0;
    if (!ok) {
      console.error('[immersive] bad region bounds for "' + name + '": '
        + JSON.stringify(bounds) + ' — ignoring message');
    }
    return ok;
  }

  // Update the mask on one map: region geometry → world-with-region-holes,
  // null → the Scotland default. Reuses the single 'fog' source (no stacking).
  function updateMask(map, geometry) {
    var src = map.getSource('fog');
    if (!src) return;
    src.setData(geometry ? buildMaskFeature(geometry) : FOG_FEATURE);
  }

  function maskAll(geometry) {
    _panelStates.forEach(function (ps) {
      ps.maps.forEach(function (map, j) {
        if (map && ps.mapReady[j]) updateMask(map, geometry);
      });
    });
  }

  // Scale bar is tied to the same selection state as mask/fitBounds.
  function decorateAll(active) {
    _panelStates.forEach(function (ps) {
      if (ps.scaleEl) ps.scaleEl.style.display = active ? '' : 'none';
    });
  }

  function applyRegion(name, bounds, geometry) {
    if (_state.region.name === name) return;
    if (bounds && !regionBoundsSane(name, bounds)) return;
    console.log('[immersive] applyRegion:', name,
      bounds ? JSON.stringify(bounds) : '(All Scotland)',
      geometry ? '(masked: ' + geometry.type + ')' : '(no geometry)');
    _state.region = { name: name, bounds: bounds || null, geometry: geometry || null };
    updateSelectionStrip();
    fitBoundsAll(_state.region.bounds);
    maskAll(_state.region.geometry);
    decorateAll(!!_state.region.bounds);
    renderLocator();
    refreshStrips();
    redrawCharts();
  }

  // ── BroadcastChannel ─────────────────────────────────────────────

  try {
    _channel = new BroadcastChannel('climascope-immersive');
    _channel.onmessage = function (ev) {
      var msg = ev.data;
      if (!msg || msg.type !== 'state') return;
      var m  = parseInt(msg.month, 10);
      var mb = String(msg.member || 'mean');
      if (m >= 1 && m <= 12) applyState(m, mb);
      if (msg.region && typeof msg.region.name === 'string') {
        console.log('[immersive] region msg received:', msg.region.name,
          JSON.stringify(msg.region.bounds),
          msg.region.geometry ? '(+geometry)' : '(no geometry)');
        applyRegion(msg.region.name, msg.region.bounds || null, msg.region.geometry || null);
      }
    };
    // Ping the controller after a short delay to let listeners settle.
    // If the controller is open it will reply with its current state and
    // applyState() will update the wall accordingly.
    setTimeout(function () {
      _channel.postMessage({ type: 'ping' });
    }, 100);
  } catch (e) {
    console.warn('[immersive] BroadcastChannel not available:', e);
  }

  // ── Build DOM & kick off initial fetch ───────────────────────────

  var container = document.getElementById('panels');
  loadLocatorContext();
  loadRegionMonthly();

  PANELS.forEach(function (panel, pi) {
    var ps = {
      panel:        panel,
      panelEl:      null,
      legendEl:     null,
      statsEl:      null,
      mapIds:       [],
      maps:         [null, null, null],
      mapReady:     [false, false, false],
      needsRefetch: false,
      chartEl:      null,
    };
    _panelStates.push(ps);

    // Panel shell
    var panelEl = document.createElement('div');
    panelEl.className = 'panel';

    // Header: metric name (left) + shared legend (right)
    var header   = document.createElement('div');
    header.className = 'panel-header';
    var metricEl = document.createElement('span');
    metricEl.className = 'panel-metric';
    metricEl.textContent = panel.label;
    var legendEl = document.createElement('div');
    legendEl.className = 'panel-legend';
    header.appendChild(metricEl);
    header.appendChild(legendEl);

    // Maps row: three map columns
    var mapsRow = document.createElement('div');
    mapsRow.className = 'panel-maps-row';

    PERIODS.forEach(function (p) {
      var col    = document.createElement('div');
      col.className = 'map-col';
      var plabel = document.createElement('div');
      plabel.className = 'period-label' + (p.baseline ? ' baseline' : '');
      plabel.textContent = p.label;
      var wrap   = document.createElement('div');
      wrap.className = 'map-wrap';
      var canvas = document.createElement('div');
      canvas.className = 'map-canvas';
      canvas.id = 'map-' + panel.id + '-' + p.id;
      ps.mapIds.push(canvas.id);
      wrap.appendChild(canvas);
      col.appendChild(plabel);
      col.appendChild(wrap);
      mapsRow.appendChild(col);
    });

    // Chart cell: 4th column at the end of the maps row (same sizing as a map).
    var chartCol = document.createElement('div');
    chartCol.className = 'map-col chart-col';
    var clabel = document.createElement('div');
    clabel.className = 'period-label';
    clabel.textContent = 'Seasonal';
    var cwrap = document.createElement('div');
    cwrap.className = 'map-wrap chart-wrap';
    chartCol.appendChild(clabel);
    chartCol.appendChild(cwrap);
    mapsRow.appendChild(chartCol);
    ps.chartEl = cwrap;

    // Stats strip
    var statsEl = document.createElement('div');
    statsEl.className = 'stats-strip';

    panelEl.appendChild(header);
    panelEl.appendChild(mapsRow);
    panelEl.appendChild(statsEl);
    container.appendChild(panelEl);

    ps.panelEl  = panelEl;
    ps.legendEl = legendEl;
    ps.statsEl  = statsEl;
  });

  // One fetch covers all 4 panels × 3 periods
  fetchAll(true);
  updateSelectionStrip();

})();
