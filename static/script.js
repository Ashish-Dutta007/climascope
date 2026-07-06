document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);

  // Coverage panel — mounted after map state is initialised
  let coveragePanel      = null;
  let filterPanel        = null;
  let dashCatchmentPanel = null;
  let dashPiePanel       = null;
  function _getMapState() {
    const hasAoi = filterPanel?._aoiActive && filterPanel?._aoiCells?.length > 0;
    const scope = hasAoi
      ? 'aoi'
      : activeCatchment
        ? `catchment:${activeCatchment}`
        : activeCouncil
          ? `council:${activeCouncil}`
          : 'national';
    return {
      metric:        activeMetric.id,
      month:         parseInt($('month')?.value || 7),
      period:        $('period')?.value || '2050-2079',
      scope,
      member:        activeMember || 'mean',
      aoiCells:      hasAoi ? filterPanel._aoiCells : null,
      councilName:   activeCouncil   || null,
      catchmentName: activeCatchment || null,
    };
  }
  function _emitStateChange() {
    const state = _getMapState();
    if (coveragePanel)      coveragePanel.onMapStateChange(state);
    if (filterPanel)        filterPanel.onMapStateChange(state);
    if (dashCatchmentPanel) dashCatchmentPanel.onMapStateChange(state);
    if (dashPiePanel)       dashPiePanel.onMapStateChange(state);
  }

  const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const SWATCH = {
    diverging:       'linear-gradient(to right,#d73027,#f7f7f7,#4575b4)',
    sequential_warm: 'linear-gradient(to right,#ffffcc,#41b6c4,#0c2c84)',
    sequential_heat: 'linear-gradient(to right,#4575b4,#ffffbf,#d73027)',
  };
  let activeMetric = { id:'CWBPT', colorscale:'diverging', units:'mm', short:'Δ CWB PT', label:'Climate Water Balance (PT)' };

  const METRIC_DISPLAY = {
    CWBPT:     { short: 'Δ CWB PT', units: 'mm' },
    CWBPM:     { short: 'Δ CWB PM', units: 'mm' },
    CWRPT:     { short: 'Δ CWR PT', units: 'ratio' },
    CWRPM:     { short: 'Δ CWR PM', units: 'ratio' },
    Prec_sum:  { short: 'Δ Precipitation', units: 'mm' },
    ETPT_sum:  { short: 'Δ ET PT', units: 'mm' },
    ETPM_sum:  { short: 'Δ ET PM', units: 'mm' },
    Tmax_mean: { short: 'Δ Tmax', units: '°C' },
    Tmin_mean: { short: 'Δ Tmin', units: '°C' }
  };

  const METRIC_UNITS = {
    CWBPT: 'mm', CWBPM: 'mm', CWRPT: 'ratio', CWRPM: 'ratio',
    Prec_sum: 'mm', ETPT_sum: 'mm', ETPM_sum: 'mm',
    Tmax_mean: '°C', Tmin_mean: '°C'
  };
  const METRIC_LABELS = {
    CWBPT: 'CWB PT', CWBPM: 'CWB PM', CWRPT: 'CWR PT', CWRPM: 'CWR PM',
    Prec_sum: 'Precipitation', ETPT_sum: 'ET PT', ETPM_sum: 'ET PM',
    Tmax_mean: 'Tmax', Tmin_mean: 'Tmin'
  };

  const BASEMAPS = {
    dark:      { label:'Dark',      tiles:'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',  type:'raster' },
    light:     { label:'Light',     tiles:'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', type:'raster' },
    satellite: { label:'Satellite', tiles:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', type:'raster' }
  };

  const BALANCE_METRICS = new Set(['CWBPT','CWBPM','CWRPT','CWRPM']);
  const TEMP_METRICS    = new Set(['Tmax_mean','Tmin_mean']);
  function getMetricType(id) {
    if (BALANCE_METRICS.has(id)) return 'balance';
    if (TEMP_METRICS.has(id))    return 'temperature';
    return 'volume';
  }

  const METRIC_RANGES = {
    CWBPT: {min:-200,max:50}, CWBPM: {min:-200,max:50},
    CWRPT: {min:-1,max:0.3},  CWRPM: {min:-1,max:0.3},
    Prec_sum: {min:-250,max:200},
    ETPT_sum: {min:0,max:400}, ETPM_sum: {min:0,max:400},
    Tmax_mean: {min:0,max:6},  Tmin_mean: {min:0,max:6},
  };
  let lastDataRange = { min: -100, max: 100 };

  function buildFillColor(dataMin, dataMax) {
    const r  = METRIC_RANGES[activeMetric.id] || { min: -100, max: 100 };
    const lo = (dataMin != null) ? dataMin : r.min;
    const hi = (dataMax != null) ? dataMax : r.max;
    const mtype = getMetricType(activeMetric.id);
    if (mtype === 'balance') {
      if (hi <= 0) return ['interpolate',['linear'],['get','Change'], lo,'#d73027', hi,'#f7f7f7'];
      if (lo >= 0) return ['interpolate',['linear'],['get','Change'], lo,'#f7f7f7', hi,'#4575b4'];
      return ['interpolate',['linear'],['get','Change'], lo,'#d73027', 0,'#f7f7f7', hi,'#4575b4'];
    }
    if (mtype === 'temperature') {
      if (hi <= 0) return ['interpolate',['linear'],['get','Change'], lo,'#4575b4', hi,'#ffffbf'];
      if (lo >= 0) return ['interpolate',['linear'],['get','Change'], lo,'#ffffbf', hi,'#d73027'];
      return ['interpolate',['linear'],['get','Change'], lo,'#4575b4', 0,'#ffffbf', hi,'#d73027'];
    }
    const mid = lo + (hi - lo) * 0.5;
    return ['interpolate',['linear'],['get','Change'], lo,'#ffffcc', mid,'#41b6c4', hi,'#0c2c84'];
  }

  function buildFillColorFromFeatureState(lo, hi) {
    const mtype = getMetricType(activeMetric.id);
    const bg    = '#1a1a2e';
    const fs    = ['feature-state', 'value'];
    let interp;
    if (mtype === 'balance') {
      if (hi <= 0)      interp = ['interpolate',['linear'],fs, lo,'#d73027', hi,'#f7f7f7'];
      else if (lo >= 0) interp = ['interpolate',['linear'],fs, lo,'#f7f7f7', hi,'#4575b4'];
      else              interp = ['interpolate',['linear'],fs, lo,'#d73027', 0,'#f7f7f7', hi,'#4575b4'];
    } else if (mtype === 'temperature') {
      if (hi <= 0)      interp = ['interpolate',['linear'],fs, lo,'#4575b4', hi,'#ffffbf'];
      else if (lo >= 0) interp = ['interpolate',['linear'],fs, lo,'#ffffbf', hi,'#d73027'];
      else              interp = ['interpolate',['linear'],fs, lo,'#4575b4', 0,'#ffffbf', hi,'#d73027'];
    } else {
      const mid = lo + (hi - lo) * 0.5;
      interp = ['interpolate',['linear'],fs, lo,'#ffffcc', mid,'#41b6c4', hi,'#0c2c84'];
    }
    return ['case', ['==', fs, null], bg, interp];
  }

  function valueToColor(val) {
    const lo = lastDataRange.min, hi = lastDataRange.max;
    const t  = Math.max(0, Math.min(1, (val - lo) / ((hi - lo) || 1)));
    const mtype = getMetricType(activeMetric.id);
    if (mtype === 'balance')     return chroma.scale(['#d73027','#f7f7f7','#4575b4'])(t).hex();
    if (mtype === 'temperature') return chroma.scale(['#4575b4','#ffffbf','#d73027'])(t).hex();
    return chroma.scale(['#ffffcc','#41b6c4','#0c2c84'])(t).hex();
  }

  const LC_PALETTE = [
    '#4ade80','#60a5fa','#f59e0b','#a78bfa','#34d399',
    '#f87171','#38bdf8','#fb923c','#c084fc','#2dd4bf'
  ];

  // Land-cover overlay: cells with a weak dominant class render washed-out
  const LC_FILL_OPACITY = ['interpolate', ['linear'],
    ['coalesce', ['feature-state', 'lcf'], 0], 0.2, 0.35, 1, 0.85];

  function buildLcFillColor(classes) {
    const expr = ['match', ['coalesce', ['feature-state', 'lc'], -1]];
    classes.forEach((c, i) => expr.push(c.lc_code, LC_PALETTE[i % LC_PALETTE.length]));
    expr.push('rgba(0,0,0,0)');
    return expr;
  }

  // LiDAR coverage tiers: 1=point cloud, 2=terrain (DTM/DSM), 3=both
  const LIDAR_TIERS = [
    { tier: 3, color: '#0e7490', label: 'Terrain + point cloud' },
    { tier: 2, color: '#22d3ee', label: 'Terrain (DTM/DSM)' },
    { tier: 1, color: '#a5f3fc', label: 'Point cloud only' },
  ];
  const LIDAR_FILL_COLOR = ['match', ['coalesce', ['feature-state', 'lcov'], 0],
    3, '#0e7490', 2, '#22d3ee', 1, '#a5f3fc', 'rgba(0,0,0,0)'];

  // Terrain: sequential ramps per variable, driven by feature-state 'tval'
  const TERRAIN_RAMPS = {
    elevation:  ['#2c7bb6', '#78c679', '#fdae61', '#8c510a', '#f7f7f7'],
    slope:      ['#ffffcc', '#fd8d3c', '#bd0026'],
    ruggedness: ['#ffffcc', '#fd8d3c', '#bd0026'],
    canopy:     ['#f7fcf5', '#74c476', '#238b45', '#00441b'],
  };
  function _terrainStops(lo, hi, ramp) {
    const n = ramp.length, out = [];
    for (let i = 0; i < n; i++) out.push(lo + (hi - lo) * i / (n - 1), ramp[i]);
    return out;
  }
  function buildTerrainColor(lo, hi, varId) {
    const ramp = TERRAIN_RAMPS[varId] || TERRAIN_RAMPS.slope;
    const fs = ['feature-state', 'tval'];
    return ['case', ['==', fs, null], 'rgba(0,0,0,0)',
      ['interpolate', ['linear'], fs, ..._terrainStops(lo, hi, ramp)]];
  }

  let mode            = 'explore';
  let _drawActive     = false;
  let activeCouncil   = null;
  let activeCatchment = null;
  let catchmentsData  = [];        // [{name, category, bbox}] from /api/catchments
  let councilsGJ      = null;
  let currentGJ       = null;
  let aoiGeoJSON      = null;       // drawn / uploaded AOI (kept for map layer)
  let refreshTimer    = null;
  let currentBasemap   = 'dark';
  let _lastLayerState  = { geojson: null, dataMin: null, dataMax: null };
  let _filterMaskState = { ids: null, mode: 'none' };
  let _filterCellsGJ   = null;   // persisted filter-cells GeoJSON for basemap-switch re-apply
  let _vtValues        = null;   // { id_1km_str: value } — cache for basemap-switch re-apply
  let layerOpacity     = 0.85;
  let activeMember     = 'mean';
  let lcOverlayOn      = false;
  let _lcDominant      = null;   // cached /api/landcover/dominant payload
  let lidarOverlayOn   = false;
  let _lidarCov        = null;   // cached /api/lidar/coverage payload
  let terrainOverlayOn = false;
  let terrainVar       = 'elevation';
  const _terrainCache  = {};     // var -> { data:{id:val}, min, max }
  let _terrainApplied  = false;  // whether feature-states are currently set

  // Whole-of-Scotland framing incl. Orkney & Shetland — reused on load and on "All Scotland" reset
  const SCOTLAND_VIEW = { center: [-4.0, 57.9], zoom: 5.5 };

  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        'carto': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
          ],
          tileSize: 256,
          attribution: '© Esri'
        }
      },
      layers: [{ id:'carto', type:'raster', source:'carto' }]
    },
    center: SCOTLAND_VIEW.center,
    zoom: SCOTLAND_VIEW.zoom
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  const _opEl = document.createElement('div');
  _opEl.id = 'opacity-ctrl';
  _opEl.innerHTML = '<label for="layer-opacity">Opacity</label>'
    + '<input type="range" id="layer-opacity" min="0" max="1" step="0.05" value="0.85">';
  map.getContainer().appendChild(_opEl);

  document.getElementById('layer-opacity').addEventListener('input', e => {
    layerOpacity = parseFloat(e.target.value);
    if (lcOverlayOn) { _syncLcDimming(); return; }
    try { map.setPaintProperty('grid-fill', 'fill-opacity', layerOpacity); } catch(_) {}
  });

  const _bmEl = document.createElement('div');
  _bmEl.id = 'basemap-toggle';
  _bmEl.innerHTML =
    '<button class="bm-btn bm-active" data-bm="dark">Dark</button>' +
    '<button class="bm-btn" data-bm="light">Light</button>' +
    '<button class="bm-btn" data-bm="satellite">Satellite</button>';
  map.getContainer().appendChild(_bmEl);

  document.querySelectorAll('.bm-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const bm = btn.dataset.bm;
      if (bm === currentBasemap) return;
      document.querySelectorAll('.bm-btn').forEach(b => b.classList.remove('bm-active'));
      btn.classList.add('bm-active');
      switchBasemap(bm);
    });
  });

  // ===== OVERLAYS GROUP (collapsible) =====
  const _ovEl = document.createElement('div');
  _ovEl.id = 'overlay-ctrl';
  _ovEl.innerHTML = `
    <button id="overlay-head" type="button">
      <span>Overlays</span><span id="overlay-caret">▾</span>
    </button>
    <div id="overlay-body">
      <label><input type="checkbox" id="lc-overlay-cb"> Land cover</label>
      <label><input type="checkbox" id="lidar-overlay-cb"> LiDAR coverage</label>
      <label><input type="checkbox" id="terrain-overlay-cb"> Terrain</label>
      <select id="terrain-var" class="overlay-select" style="display:none">
        <option value="elevation">Elevation</option>
        <option value="slope">Slope</option>
        <option value="ruggedness">Ruggedness</option>
        <option value="canopy">Canopy height</option>
      </select>
    </div>`;
  map.getContainer().appendChild(_ovEl);
  document.getElementById('overlay-head').addEventListener('click', () => {
    _ovEl.classList.toggle('collapsed');
    document.getElementById('overlay-caret').textContent =
      _ovEl.classList.contains('collapsed') ? '▸' : '▾';
  });
  // Overlays are mutually exclusive — two feature-state fills on the same cells
  // would muddy each other, so turning one on clears the other.
  document.getElementById('lc-overlay-cb').addEventListener('change', e => {
    if (e.target.checked) { _setLidarOverlay(false); _setTerrainOverlay(false); }
    toggleLcOverlay(e.target.checked);
  });
  document.getElementById('lidar-overlay-cb').addEventListener('change', e => {
    if (e.target.checked) { _setLcOverlay(false); _setTerrainOverlay(false); }
    toggleLidarOverlay(e.target.checked);
  });
  document.getElementById('terrain-overlay-cb').addEventListener('change', e => {
    if (e.target.checked) { _setLcOverlay(false); _setLidarOverlay(false); }
    document.getElementById('terrain-var').style.display = e.target.checked ? 'block' : 'none';
    toggleTerrainOverlay(e.target.checked);
  });
  document.getElementById('terrain-var').addEventListener('change', e => {
    terrainVar = e.target.value;
    if (terrainOverlayOn) loadTerrainVar(terrainVar);
  });
  // Terrain data may not be present — disable the toggle with a hint until it is.
  (async () => {
    const cb = document.getElementById('terrain-overlay-cb');
    const lbl = cb?.closest('label');
    try {
      const info = await fetch('/api/terrain/vars').then(r => r.json());
      if (!info.available) {
        cb.disabled = true;
        if (lbl) { lbl.style.opacity = '.45'; lbl.title = 'Terrain data not available yet'; }
      }
    } catch(_) {
      if (cb) cb.disabled = true;
    }
  })();
  function _setLcOverlay(on) {
    const cb = document.getElementById('lc-overlay-cb');
    if (cb && cb.checked !== on) { cb.checked = on; toggleLcOverlay(on); }
  }
  function _setLidarOverlay(on) {
    const cb = document.getElementById('lidar-overlay-cb');
    if (cb && cb.checked !== on) { cb.checked = on; toggleLidarOverlay(on); }
  }
  function _setTerrainOverlay(on) {
    const cb = document.getElementById('terrain-overlay-cb');
    if (cb && cb.checked !== on) {
      cb.checked = on;
      document.getElementById('terrain-var').style.display = on ? 'block' : 'none';
      toggleTerrainOverlay(on);
    }
  }

  // ===== LAND-COVER OVERLAY =====

  function _applyLcStates() {
    if (!_lcDominant) return;
    const { ids, codes, fracs } = _lcDominant;
    for (let i = 0; i < ids.length; i++) {
      map.setFeatureState(
        { source: 'cells-vt', sourceLayer: 'cells', id: ids[i] },
        { lc: codes[i], lcf: fracs[i] }
      );
    }
  }

  // scopeIds null → national: list every class; otherwise only classes that are
  // dominant in at least one in-scope cell
  function _renderLcLegend(scopeIds) {
    if (!_lcDominant) return;
    let leg = document.getElementById('lc-legend');
    if (!leg) {
      leg = document.createElement('div');
      leg.id = 'lc-legend';
      map.getContainer().appendChild(leg);
    }
    let present = null;
    if (scopeIds) {
      present = new Set();
      const { ids, codes } = _lcDominant;
      for (let i = 0; i < ids.length; i++) if (scopeIds.has(ids[i])) present.add(codes[i]);
    }
    const rows = _lcDominant.classes
      .map((c, i) => ({ c, color: LC_PALETTE[i % LC_PALETTE.length] }))
      .filter(x => !present || present.has(x.c.lc_code))
      .map(x => `<div class="lc-legend-row"><span class="lc-swatch" style="background:${x.color}"></span>${x.c.lc_name}</div>`)
      .join('');
    leg.innerHTML = `<div class="legend-title">Dominant land cover <span style="opacity:.35;font-weight:400">1km</span></div>${rows}`;
  }

  // Scope the overlay to the active council/catchment/AOI — outside cells render fully
  // transparent via the 'lcs' feature-state; national scope lifts the restriction.
  const LC_SCOPED_OPACITY = ['case', ['boolean', ['feature-state', 'lcs'], false], LC_FILL_OPACITY, 0];
  let _lcScopeApplied = new Set();

  function _lcScopeIds() {
    if (filterPanel?._aoiActive && filterPanel?._aoiCells?.length)
      return new Set(filterPanel._aoiCells.map(Number));
    if ((activeCouncil || activeCatchment || aoiGeoJSON) && currentGJ?.features)
      return new Set(currentGJ.features.map(f => +f.properties.id_1km));
    return null;
  }

  function _updateLcScope() {
    if (!lcOverlayOn || !map.getLayer('lc-fill')) return;
    const fs  = id => ({ source: 'cells-vt', sourceLayer: 'cells', id });
    const ids = _lcScopeIds();
    if (ids === null) {
      for (const id of _lcScopeApplied) map.setFeatureState(fs(id), { lcs: false });
      _lcScopeApplied = new Set();
      map.setPaintProperty('lc-fill', 'fill-opacity', LC_FILL_OPACITY);
      _renderLcLegend(null);
      return;
    }
    for (const id of _lcScopeApplied) if (!ids.has(id)) map.setFeatureState(fs(id), { lcs: false });
    for (const id of ids) if (!_lcScopeApplied.has(id)) map.setFeatureState(fs(id), { lcs: true });
    _lcScopeApplied = ids;
    map.setPaintProperty('lc-fill', 'fill-opacity', LC_SCOPED_OPACITY);
    _renderLcLegend(ids);
  }

  // Dim the climate choropleth while the overlay is on so the two fills don't fight
  function _syncLcDimming() {
    try { map.setPaintProperty('cells-fill', 'fill-opacity', lcOverlayOn ? 0.15 : 1.0); } catch(_) {}
    try { map.setPaintProperty('grid-fill', 'fill-opacity', lcOverlayOn ? Math.min(layerOpacity, 0.15) : layerOpacity); } catch(_) {}
  }

  async function toggleLcOverlay(on) {
    lcOverlayOn = on;
    if (on && !_lcDominant) {
      try {
        const resp = await fetch('/api/landcover/dominant');
        if (!resp.ok) throw new Error(resp.status);
        _lcDominant = await resp.json();
      } catch(_) {
        lcOverlayOn = false;
        const cb = document.getElementById('lc-overlay-cb');
        if (cb) cb.checked = false;
        return;
      }
      map.setPaintProperty('lc-fill', 'fill-color', buildLcFillColor(_lcDominant.classes));
      _applyLcStates();
    }
    try { map.setLayoutProperty('lc-fill', 'visibility', on ? 'visible' : 'none'); } catch(_) {}
    if (on) _updateLcScope();
    _syncLcDimming();
    const leg = document.getElementById('lc-legend');
    if (leg) leg.style.display = on ? 'block' : 'none';
  }
  // ===== END LAND-COVER OVERLAY =====

  // ===== LIDAR COVERAGE OVERLAY =====
  function _applyLidarStates() {
    if (!_lidarCov) return;
    const { ids, tiers } = _lidarCov;
    for (let i = 0; i < ids.length; i++) {
      map.setFeatureState({ source: 'cells-vt', sourceLayer: 'cells', id: ids[i] }, { lcov: tiers[i] });
    }
  }

  function _renderLidarLegend() {
    let leg = document.getElementById('lidar-legend');
    if (!leg) {
      leg = document.createElement('div');
      leg.id = 'lidar-legend';
      map.getContainer().appendChild(leg);
    }
    const s = _lidarCov?.summary;
    const pct = s ? Math.round(100 * s.any / s.total) : 0;
    const rows = LIDAR_TIERS.map(t =>
      `<div class="lc-legend-row"><span class="lc-swatch" style="background:${t.color}"></span>${t.label}</div>`
    ).join('');
    leg.innerHTML = `<div class="legend-title">LiDAR coverage `
      + `<span style="opacity:.35;font-weight:400">${pct}% of grid</span></div>${rows}`;
  }

  function _syncLidarDimming() {
    try { map.setPaintProperty('cells-fill', 'fill-opacity', lidarOverlayOn ? 0.15 : 1.0); } catch(_) {}
    try { map.setPaintProperty('grid-fill', 'fill-opacity', lidarOverlayOn ? Math.min(layerOpacity, 0.15) : layerOpacity); } catch(_) {}
  }

  async function toggleLidarOverlay(on) {
    lidarOverlayOn = on;
    if (on && !_lidarCov) {
      try {
        const resp = await fetch('/api/lidar/coverage');
        if (!resp.ok) throw new Error(resp.status);
        _lidarCov = await resp.json();
      } catch(_) {
        lidarOverlayOn = false;
        const cb = document.getElementById('lidar-overlay-cb');
        if (cb) cb.checked = false;
        return;
      }
      _applyLidarStates();
      _renderLidarLegend();
    }
    try { map.setLayoutProperty('lidar-fill', 'visibility', on ? 'visible' : 'none'); } catch(_) {}
    _syncLidarDimming();
    const leg = document.getElementById('lidar-legend');
    if (leg) leg.style.display = on ? 'block' : 'none';
  }
  // ===== END LIDAR COVERAGE OVERLAY =====

  // ===== TERRAIN OVERLAY (Phase 1) =====
  const TERRAIN_LABELS = {
    elevation: ['Elevation', 'm'], slope: ['Slope', '°'],
    ruggedness: ['Ruggedness', 'm'], canopy: ['Canopy height', 'm'],
  };

  function _applyTerrainStates(data) {
    for (const id in data) {
      map.setFeatureState({ source: 'cells-vt', sourceLayer: 'cells', id: +id }, { tval: data[id] });
    }
    _terrainApplied = true;
  }
  function _clearTerrainStates() {
    if (!_terrainApplied) return;
    const cur = _terrainCache[terrainVar];
    if (cur) for (const id in cur.data)
      map.setFeatureState({ source: 'cells-vt', sourceLayer: 'cells', id: +id }, { tval: null });
    _terrainApplied = false;
  }

  function _renderTerrainLegend(varId, lo, hi) {
    let leg = document.getElementById('terrain-legend');
    if (!leg) { leg = document.createElement('div'); leg.id = 'terrain-legend'; map.getContainer().appendChild(leg); }
    const [label, units] = TERRAIN_LABELS[varId] || [varId, ''];
    const ramp = TERRAIN_RAMPS[varId] || TERRAIN_RAMPS.slope;
    const grad = `linear-gradient(to right, ${ramp.join(',')})`;
    leg.innerHTML =
      `<div class="legend-title">${label} <span style="opacity:.35;font-weight:400">${units}</span></div>`
      + `<div class="legend-subtitle">LiDAR-derived · 1km</div>`
      + `<div class="legend-ramp" style="background:${grad}"></div>`
      + `<div class="legend-labels"><span>${lo.toFixed(lo<10?1:0)}</span><span>${hi.toFixed(hi<10?1:0)}</span></div>`;
    leg.style.display = 'block';
  }

  function _syncTerrainDimming() {
    try { map.setPaintProperty('cells-fill', 'fill-opacity', terrainOverlayOn ? 0.1 : 1.0); } catch(_) {}
    try { map.setPaintProperty('grid-fill', 'fill-opacity', terrainOverlayOn ? Math.min(layerOpacity, 0.1) : layerOpacity); } catch(_) {}
  }

  async function loadTerrainVar(varId) {
    let entry = _terrainCache[varId];
    if (!entry) {
      try {
        const resp = await fetch(`/api/terrain?var=${encodeURIComponent(varId)}`);
        if (!resp.ok) throw new Error(resp.status);
        const data = await resp.json();
        const vals = Object.values(data).filter(v => v != null && isFinite(v));
        if (!vals.length) throw new Error('empty');
        entry = { data, min: Math.min(...vals), max: Math.max(...vals) };
        _terrainCache[varId] = entry;
      } catch(_) { return false; }
    }
    _clearTerrainStates();
    map.setPaintProperty('terrain-fill', 'fill-color', buildTerrainColor(entry.min, entry.max, varId));
    _applyTerrainStates(entry.data);
    _renderTerrainLegend(varId, entry.min, entry.max);
    return true;
  }

  async function toggleTerrainOverlay(on) {
    terrainOverlayOn = on;
    if (on) {
      const ok = await loadTerrainVar(terrainVar);
      if (!ok) {
        terrainOverlayOn = false;
        const cb = document.getElementById('terrain-overlay-cb');
        if (cb) { cb.checked = false; document.getElementById('terrain-var').style.display = 'none'; }
        return;
      }
    }
    try { map.setLayoutProperty('terrain-fill', 'visibility', on ? 'visible' : 'none'); } catch(_) {}
    _syncTerrainDimming();
    const leg = document.getElementById('terrain-legend');
    if (leg) leg.style.display = on ? 'block' : 'none';
  }
  // ===== END TERRAIN OVERLAY =====

  // ===== PLACE SEARCH =====
  (function() {
    const _srchEl = document.createElement('div');
    _srchEl.id = 'map-search';
    _srchEl.innerHTML =
      '<input type="text" id="search-input" placeholder="Search a place …">' +
      '<div id="search-results"></div>';
    map.getContainer().appendChild(_srchEl);

    // ── OS Names API (place search) ──
    const OS_NAMES_ENDPOINT = 'https://api.os.uk/search/names/v1/find';
    const OS_NAMES_KEY      = 'My3J0Pob0dAqt6HWbOPpisj8imEDCgNq';   // OS Data Hub project API key
    const OS_NAMES_BOUNDS   = '0,530000,470000,1220000'; // Scotland extent in BNG/EPSG:27700 (minE,minN,maxE,maxN)

    const input   = document.getElementById('search-input');
    const results = document.getElementById('search-results');
    let _debounce = null;

    function clearResults() {
      results.innerHTML = '';
      results.classList.remove('open');
    }

    // BNG (EPSG:27700) easting/northing → WGS84 [lng, lat].
    // Airy 1830 inverse transverse Mercator + Helmert datum shift to WGS84
    // (~metre accuracy, ample for a flyTo). No proj4 dependency.
    function bngToWgs84(E, N) {
      const a = 6377563.396, b = 6356256.909;            // Airy 1830
      const F0 = 0.9996012717;
      const lat0 = 49 * Math.PI / 180, lon0 = -2 * Math.PI / 180;
      const N0 = -100000, E0 = 400000;
      const e2 = 1 - (b * b) / (a * a);
      const n = (a - b) / (a + b), n2 = n * n, n3 = n * n * n;

      let lat = lat0, M = 0;
      do {
        lat = (N - N0 - M) / (a * F0) + lat;
        const Ma = (1 + n + 1.25 * n2 + 1.25 * n3) * (lat - lat0);
        const Mb = (3 * n + 3 * n2 + 2.625 * n3) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
        const Mc = (1.875 * n2 + 1.875 * n3) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0));
        const Md = (35 / 24) * n3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
        M = b * F0 * (Ma - Mb + Mc - Md);
      } while (Math.abs(N - N0 - M) >= 0.00001);

      const sinLat = Math.sin(lat), cosLat = Math.cos(lat), tanLat = Math.tan(lat);
      const nu  = a * F0 / Math.sqrt(1 - e2 * sinLat * sinLat);
      const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
      const eta2 = nu / rho - 1;
      const tan2 = tanLat * tanLat, tan4 = tan2 * tan2, secLat = 1 / cosLat;
      const VII  = tanLat / (2 * rho * nu);
      const VIII = tanLat / (24 * rho * nu ** 3) * (5 + 3 * tan2 + eta2 - 9 * tan2 * eta2);
      const IX   = tanLat / (720 * rho * nu ** 5) * (61 + 90 * tan2 + 45 * tan4);
      const X    = secLat / nu;
      const XI   = secLat / (6 * nu ** 3) * (nu / rho + 2 * tan2);
      const XII  = secLat / (120 * nu ** 5) * (5 + 28 * tan2 + 24 * tan4);
      const XIIA = secLat / (5040 * nu ** 7) * (61 + 662 * tan2 + 1320 * tan4 + 720 * tan2 * tan4);
      const dE = E - E0;
      const latA = lat - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6;
      const lonA = lon0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7;

      // OSGB36 (Airy) geodetic → cartesian
      const sinA = Math.sin(latA), cosA = Math.cos(latA);
      const nuA = a / Math.sqrt(1 - e2 * sinA * sinA);
      const x1 = nuA * cosA * Math.cos(lonA);
      const y1 = nuA * cosA * Math.sin(lonA);
      const z1 = (1 - e2) * nuA * sinA;

      // Helmert OSGB36 → WGS84
      const tx = 446.448, ty = -125.157, tz = 542.060, s = -20.4894e-6;
      const rx = 0.1502 / 3600 * Math.PI / 180;
      const ry = 0.2470 / 3600 * Math.PI / 180;
      const rz = 0.8421 / 3600 * Math.PI / 180;
      const x2 = tx + (1 + s) * x1 - rz * y1 + ry * z1;
      const y2 = ty + rz * x1 + (1 + s) * y1 - rx * z1;
      const z2 = tz - ry * x1 + rx * y1 + (1 + s) * z1;

      // WGS84 cartesian → geodetic
      const aW = 6378137.0, bW = 6356752.314245;
      const e2W = 1 - (bW * bW) / (aW * aW);
      const p = Math.sqrt(x2 * x2 + y2 * y2);
      let latW = Math.atan2(z2, p * (1 - e2W)), prev;
      do {
        prev = latW;
        const sinW = Math.sin(latW);
        const nuW = aW / Math.sqrt(1 - e2W * sinW * sinW);
        latW = Math.atan2(z2 + e2W * nuW * sinW, p);
      } while (Math.abs(latW - prev) >= 1e-11);
      const lonW = Math.atan2(y2, x2);

      return [lonW * 180 / Math.PI, latW * 180 / Math.PI];
    }

    function _escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

    // STEP 1 — local councils + catchments (in memory from startup, no network).
    // Councils first, then catchments, max 4 of each.
    function _localHits(q) {
      const lower = q.toLowerCase();
      const councils = (councilsGJ?.features || [])
        .map(f => f.properties.council_name)
        .filter(name => name && name.toLowerCase().includes(lower))
        .slice(0, 4)
        .map(name => ({ kind: 'council', name }));
      const catchments = (catchmentsData || [])
        .filter(c => c.name && c.name.toLowerCase().includes(lower))
        .slice(0, 4)
        .map(c => ({ kind: 'catchment', name: c.name }));
      return councils.concat(catchments);
    }

    // Replicate the left-sidebar dropdown change exactly: set value + fire 'change'
    // so the existing handler runs (state, fitBounds, loadLayer, _emitStateChange).
    function _selectSidebar(selId, name) {
      const sel = $(selId);
      if (!sel) return;
      sel.value = name;
      sel.dispatchEvent(new Event('change'));
    }

    function _renderResults(localHits, placeHits) {
      if (!localHits.length && !placeHits.length) { clearResults(); return; }
      const tag = (kind, label) =>
        `<span class="search-type search-tag search-tag-${kind}">${label}</span>`;
      let html = '';
      localHits.forEach(h => {
        const label = h.kind === 'council' ? 'Council' : 'Catchment';
        html += `<div class="search-result">${_escHtml(h.name)}${tag(h.kind, label)}</div>`;
      });
      placeHits.forEach(g => {
        html += `<div class="search-result">${_escHtml(g.NAME1)}${tag('place', 'Place')}</div>`;
      });
      results.innerHTML = html;
      results.classList.add('open');

      results.querySelectorAll('.search-result').forEach((el, idx) => {
        el.addEventListener('mousedown', ev => {
          ev.preventDefault();
          clearTimeout(_debounce);
          if (idx < localHits.length) {
            const h = localHits[idx];
            _selectSidebar(h.kind === 'council' ? 'council' : 'catchment', h.name);
            input.value = h.name;
          } else {
            const g = placeHits[idx - localHits.length];
            const [lng, lat] = bngToWgs84(g.GEOMETRY_X, g.GEOMETRY_Y);
            map.flyTo({ center: [lng, lat], zoom: 10 });
            input.value = g.NAME1;
          }
          clearResults();
        });
      });
    }

    // STEP 2 — OS Names (async); appended below the local results.
    async function doSearch(q) {
      const localHits = _localHits(q);
      let placeHits = [];
      try {
        const url = OS_NAMES_ENDPOINT
          + `?query=${encodeURIComponent(q)}`
          + `&key=${OS_NAMES_KEY}`
          + `&bounds=${OS_NAMES_BOUNDS}`
          + `&maxresults=8`;
        const resp = await fetch(url);
        if (resp.ok) {
          const data = await resp.json();
          placeHits = (data.results || [])
            .map(r => r.GAZETTEER_ENTRY)
            .filter(g => g && g.GEOMETRY_X != null && g.GEOMETRY_Y != null);
        }
      } catch { /* keep local-only results */ }

      if (input.value.trim() !== q) return;   // stale response — query moved on
      _renderResults(localHits, placeHits);
    }

    input.addEventListener('input', () => {
      clearTimeout(_debounce);
      const q = input.value.trim();
      if (!q) { clearResults(); return; }
      _renderResults(_localHits(q), []);              // STEP 1: instant, local only
      _debounce = setTimeout(() => doSearch(q), 400); // STEP 2: OS Names appended
    });

    input.addEventListener('blur', () => { setTimeout(clearResults, 200); });
  })();
  // ===== END PLACE SEARCH =====

  const draw = new MapboxDraw({
    displayControlsDefault: false,   // hide built-in buttons (they were unclickable due to z-index)
    controls: {}
  });

  // Source / layer IDs
  const SRC = { grid:'grid', council:'council-boundary', catchment:'catchment-boundary', aoi:'aoi', upload:'upload', filterCells:'filter-cells' };

  map.once('style.load', async () => {
    // GeoJSON source for 1km grid cells — populated on council selection
    map.addSource(SRC.grid, { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'grid-fill', type: 'fill', source: SRC.grid,
      paint: { 'fill-color': buildFillColor(), 'fill-opacity': layerOpacity }
    });
    map.addLayer({
      id: 'grid-line', type: 'line', source: SRC.grid,
      paint: { 'line-color': 'rgba(0,0,0,0.2)', 'line-width': 0.3 }
    });
    map.addLayer({
      id: 'grid-fill-mask', type: 'fill', source: SRC.grid,
      paint: { 'fill-color': '#0d1018', 'fill-opacity': 0.75 },
      filter: ['boolean', false]
    });

    map.addSource('cells-vt', {
      type: 'vector',
      tiles: [window.location.origin + '/tiles/{z}/{x}/{y}.pbf'],
      minzoom: 5,
      maxzoom: 14,
      promoteId: { 'cells': 'id_1km' }
    });
    map.addLayer({
      id: 'cells-fill', type: 'fill', source: 'cells-vt', 'source-layer': 'cells',
      layout: { visibility: 'none' },
      paint: { 'fill-antialias': false, 'fill-color': buildFillColorFromFeatureState(-100, 100), 'fill-opacity': 1.0 }
    });
    map.addLayer({
      id: 'cells-line', type: 'line', source: 'cells-vt', 'source-layer': 'cells',
      layout: { visibility: 'none' },
      paint: {
        'line-color': 'rgba(255,255,255,0.15)',
        'line-width': 0.4,
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 9, 1]
      }
    });

    // Land-cover context overlay — dominant class per cell, above the choropleth,
    // below filter outlines and boundaries. Toggled via the map checkbox.
    map.addLayer({
      id: 'lc-fill', type: 'fill', source: 'cells-vt', 'source-layer': 'cells',
      layout: { visibility: lcOverlayOn ? 'visible' : 'none' },
      paint: {
        'fill-antialias': false,
        'fill-color': _lcDominant ? buildLcFillColor(_lcDominant.classes) : 'rgba(0,0,0,0)',
        'fill-opacity': LC_FILL_OPACITY
      }
    });

    // LiDAR coverage overlay — availability tier per cell (see LIDAR COVERAGE OVERLAY)
    map.addLayer({
      id: 'lidar-fill', type: 'fill', source: 'cells-vt', 'source-layer': 'cells',
      layout: { visibility: lidarOverlayOn ? 'visible' : 'none' },
      paint: { 'fill-antialias': false, 'fill-color': LIDAR_FILL_COLOR, 'fill-opacity': 0.8 }
    });

    // Terrain overlay — continuous LiDAR-derived values (see TERRAIN OVERLAY)
    map.addLayer({
      id: 'terrain-fill', type: 'fill', source: 'cells-vt', 'source-layer': 'cells',
      layout: { visibility: 'none' },
      paint: { 'fill-antialias': false, 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 0.9 }
    });

    // Filter-results outline layer (independent source). Matched cells keep their
    // real choropleth colour — no fill — and get a thin neutral border; non-matched
    // cells are dimmed via grid-fill-mask.
    map.addSource(SRC.filterCells, { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'filter-cells-line', type: 'line', source: SRC.filterCells,
      paint: { 'line-color': 'rgba(255,255,255,0.85)', 'line-width': 0.8 }
    });

    // Council boundary overlay
    map.addSource(SRC.council, { type:'geojson', data:emptyFC() });
    map.addLayer({
      id:'council-fill', type:'fill', source:SRC.council,
      paint:{ 'fill-color':'#5b83f0', 'fill-opacity':0.04 }
    });
    map.addLayer({
      id:'council-line', type:'line', source:SRC.council,
      paint:{ 'line-color':'#5b83f0', 'line-width':1.5, 'line-dasharray':[3,2] }
    });

    // Catchment boundary overlay (orange)
    map.addSource(SRC.catchment, { type:'geojson', data:emptyFC() });
    map.addLayer({
      id:'catchment-fill', type:'fill', source:SRC.catchment,
      paint:{ 'fill-color':'#f59e0b', 'fill-opacity':0.04 }
    });
    map.addLayer({
      id:'catchment-line', type:'line', source:SRC.catchment,
      paint:{ 'line-color':'#f59e0b', 'line-width':1.5, 'line-dasharray':[3,2] }
    });

    // AOI (uploaded / drawn)
    map.addSource(SRC.aoi, { type:'geojson', data:emptyFC() });
    map.addLayer({
      id:'aoi-fill', type:'fill', source:SRC.aoi,
      paint:{ 'fill-color':'#00d4ff', 'fill-opacity':0.08 }
    });
    map.addLayer({
      id:'aoi-line', type:'line', source:SRC.aoi,
      paint:{ 'line-color':'#00d4ff', 'line-width':1.8 }
    });

    // Reference labels overlay — always on top; fades in from zoom 8→9
    // World_Dark_Gray_Reference has light text that reads on dark, satellite, and light basemaps
    map.addSource('esri-labels', {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '© Esri'
    });
    map.addLayer({
      id: 'esri-labels-layer',
      type: 'raster',
      source: 'esri-labels',
      paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 9, 0.9] }
    });

    attachPopup();
    initMode('explore', true);  // skip loadLayer — loadMetrics() is the sole first-render trigger
    await loadMetrics();       // sets activeMetric, calls loadLayer() once data is confirmed
    loadCouncils();
    loadCatchments();
    updateLegend(null);
  });

  function emptyFC() { return { type:'FeatureCollection', features:[] }; }
  function setData(srcId, data) { map.getSource(srcId)?.setData(data || emptyFC()); }
  function geomBbox(geom) {
    const flat = geom.type === 'Polygon'      ? geom.coordinates.flat(1)
               : geom.type === 'MultiPolygon' ? geom.coordinates.flat(2)
               : [];
    if (!flat.length) return null;
    const lngs = flat.map(c => c[0]), lats = flat.map(c => c[1]);
    return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
  }

  function showLoading(on) { $('loading-bar').classList.toggle('hidden', !on); }

  function _showMapUnavailMsg() {
    if (document.getElementById('map-unavail-msg')) return;
    const el = document.createElement('div');
    el.id = 'map-unavail-msg';
    el.innerHTML =
      '<button class="map-unavail-close" title="Dismiss">×</button>' +
      '<p class="map-unavail-title">Map view not available for CWR</p>' +
      '<p class="map-unavail-sub">Use the Dashboard or Catchment tab to explore CWR data</p>';
    el.querySelector('.map-unavail-close').addEventListener('click', () => el.remove());
    document.getElementById('map-area').appendChild(el);
  }

  function _hideMapUnavailMsg() {
    document.getElementById('map-unavail-msg')?.remove();
  }

  async function _paintAoiFeature(feature) {
    map.setLayoutProperty('cells-fill', 'visibility', 'none');
    map.setLayoutProperty('cells-line', 'visibility', 'none');
    map.setLayoutProperty('grid-fill',  'visibility', 'visible');
    map.setLayoutProperty('grid-line',  'visibility', 'visible');
    showLoading(true);
    try {
      const state = _getMapState();
      const resp = await fetch('/api/aoi/features', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geometry: feature.geometry,
          metric:   state.metric,
          period:   state.period,
          month:    state.month,
          ...(state.member && state.member !== 'mean' ? { member: state.member } : {}),
        }),
      });
      if (!resp.ok) return;
      const gj = await resp.json();
      currentGJ = gj;
      setData(SRC.grid, gj);
      const vals = gj.features.map(f => +f.properties.Change).filter(v => !isNaN(v));
      const dMin = vals.length ? Math.min(...vals) : null;
      const dMax = vals.length ? Math.max(...vals) : null;
      map.setPaintProperty('grid-fill', 'fill-color', buildFillColor(dMin, dMax));
      _lastLayerState = { geojson: gj, dataMin: dMin, dataMax: dMax };
      updateLegend(gj);
      _updateLcScope();
    } catch(err) { console.error('_paintAoiFeature failed:', err); }
    finally { showLoading(false); }
  }

  function reapplyLayer() {
    const gj = currentGJ || _lastLayerState.geojson;

    // sources must be added before any layer references them
    if (!map.getSource(SRC.grid))        map.addSource(SRC.grid,        { type:'geojson', data: gj || emptyFC() });
    else                                  setData(SRC.grid, gj || emptyFC());
    if (!map.getSource(SRC.filterCells)) map.addSource(SRC.filterCells, { type:'geojson', data: _filterCellsGJ || emptyFC() });
    else if (_filterCellsGJ)             setData(SRC.filterCells, _filterCellsGJ);
    if (!map.getSource(SRC.council))     map.addSource(SRC.council,     { type:'geojson', data: emptyFC() });
    if (!map.getSource(SRC.catchment))   map.addSource(SRC.catchment,   { type:'geojson', data: emptyFC() });
    if (!map.getSource(SRC.aoi))         map.addSource(SRC.aoi,         { type:'geojson', data: emptyFC() });

    const _isNationalVT = !activeCouncil && !activeCatchment && !aoiGeoJSON;
    if (!map.getSource('cells-vt')) {
      map.addSource('cells-vt', {
        type: 'vector',
        tiles: [window.location.origin + '/tiles/{z}/{x}/{y}.pbf'],
        minzoom: 5, maxzoom: 14,
        promoteId: { 'cells': 'id_1km' }
      });
    }

    // layer order: grid, mask, cells-vt, filter-cells, council, aoi
    if (!map.getLayer('grid-fill'))
      map.addLayer({ id:'grid-fill', type:'fill', source:SRC.grid,
        paint:{ 'fill-color': buildFillColor(_lastLayerState.dataMin, _lastLayerState.dataMax), 'fill-opacity': layerOpacity } });
    else
      map.setPaintProperty('grid-fill', 'fill-color', buildFillColor(_lastLayerState.dataMin, _lastLayerState.dataMax));

    if (!map.getLayer('grid-line'))
      map.addLayer({ id:'grid-line', type:'line', source:SRC.grid,
        paint:{ 'line-color':'rgba(0,0,0,0.2)', 'line-width':0.3 } });

    if (!map.getLayer('grid-fill-mask'))
      map.addLayer({ id:'grid-fill-mask', type:'fill', source:SRC.grid,
        paint:{ 'fill-color':'#0d1018', 'fill-opacity':0.75 },
        filter: ['boolean', false] });
    _applyFilterMask(_filterMaskState.ids, _filterMaskState.mode);

    const _vtVis = _isNationalVT ? 'visible' : 'none';
    const _gjVis = _isNationalVT ? 'none'    : 'visible';
    map.setLayoutProperty('grid-fill', 'visibility', _gjVis);
    map.setLayoutProperty('grid-line', 'visibility', _gjVis);
    if (!map.getLayer('cells-fill')) {
      map.addLayer({ id:'cells-fill', type:'fill', source:'cells-vt', 'source-layer':'cells',
        layout:{ visibility: _vtVis },
        paint:{ 'fill-antialias': false, 'fill-color': buildFillColorFromFeatureState(lastDataRange.min, lastDataRange.max), 'fill-opacity': 1.0 } });
    } else {
      map.setLayoutProperty('cells-fill', 'visibility', _vtVis);
      map.setPaintProperty('cells-fill', 'fill-color', buildFillColorFromFeatureState(lastDataRange.min, lastDataRange.max));
    }
    if (!map.getLayer('cells-line')) {
      map.addLayer({ id:'cells-line', type:'line', source:'cells-vt', 'source-layer':'cells',
        layout:{ visibility: _vtVis },
        paint:{ 'line-color':'rgba(255,255,255,0.15)', 'line-width':0.4,
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 9, 1] } });
    } else {
      map.setLayoutProperty('cells-line', 'visibility', _vtVis);
    }
    if (_isNationalVT && _vtValues) {
      for (const [id, value] of Object.entries(_vtValues)) {
        map.setFeatureState({ source:'cells-vt', sourceLayer:'cells', id:+id }, { value });
      }
    }

    if (!map.getLayer('lc-fill'))
      map.addLayer({ id:'lc-fill', type:'fill', source:'cells-vt', 'source-layer':'cells',
        layout:{ visibility: lcOverlayOn ? 'visible' : 'none' },
        paint:{ 'fill-antialias': false,
                'fill-color': _lcDominant ? buildLcFillColor(_lcDominant.classes) : 'rgba(0,0,0,0)',
                'fill-opacity': LC_FILL_OPACITY } });
    else
      map.setLayoutProperty('lc-fill', 'visibility', lcOverlayOn ? 'visible' : 'none');
    if (lcOverlayOn) {
      _applyLcStates();               // feature-states are dropped on basemap switch
      _lcScopeApplied = new Set();    // scope flags were dropped too — reapply from scratch
      _updateLcScope();
      _syncLcDimming();
    }

    if (!map.getLayer('lidar-fill'))
      map.addLayer({ id:'lidar-fill', type:'fill', source:'cells-vt', 'source-layer':'cells',
        layout:{ visibility: lidarOverlayOn ? 'visible' : 'none' },
        paint:{ 'fill-antialias': false, 'fill-color': LIDAR_FILL_COLOR, 'fill-opacity': 0.8 } });
    else
      map.setLayoutProperty('lidar-fill', 'visibility', lidarOverlayOn ? 'visible' : 'none');
    if (lidarOverlayOn) {
      _applyLidarStates();            // feature-states dropped on basemap switch
      _syncLidarDimming();
    }

    if (!map.getLayer('terrain-fill'))
      map.addLayer({ id:'terrain-fill', type:'fill', source:'cells-vt', 'source-layer':'cells',
        layout:{ visibility: terrainOverlayOn ? 'visible' : 'none' },
        paint:{ 'fill-antialias': false, 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': 0.9 } });
    else
      map.setLayoutProperty('terrain-fill', 'visibility', terrainOverlayOn ? 'visible' : 'none');
    if (terrainOverlayOn) {
      _terrainApplied = false;        // feature-states dropped on basemap switch
      loadTerrainVar(terrainVar);
      _syncTerrainDimming();
    }

    if (!map.getLayer('filter-cells-line'))
      map.addLayer({ id:'filter-cells-line', type:'line', source:SRC.filterCells,
        paint:{ 'line-color':'rgba(255,255,255,0.85)', 'line-width':0.8 } });

    if (!map.getLayer('council-fill'))
      map.addLayer({ id:'council-fill', type:'fill', source:SRC.council,
        paint:{ 'fill-color':'#5b83f0', 'fill-opacity':0.04 } });
    if (!map.getLayer('council-line'))
      map.addLayer({ id:'council-line', type:'line', source:SRC.council,
        paint:{ 'line-color':'#5b83f0', 'line-width':1.5, 'line-dasharray':[3,2] } });

    if (!map.getLayer('catchment-fill'))
      map.addLayer({ id:'catchment-fill', type:'fill', source:SRC.catchment,
        paint:{ 'fill-color':'#f59e0b', 'fill-opacity':0.04 } });
    if (!map.getLayer('catchment-line'))
      map.addLayer({ id:'catchment-line', type:'line', source:SRC.catchment,
        paint:{ 'line-color':'#f59e0b', 'line-width':1.5, 'line-dasharray':[3,2] } });

    if (!map.getLayer('aoi-fill'))
      map.addLayer({ id:'aoi-fill', type:'fill', source:SRC.aoi,
        paint:{ 'fill-color':'#00d4ff', 'fill-opacity':0.08 } });
    if (!map.getLayer('aoi-line'))
      map.addLayer({ id:'aoi-line', type:'line', source:SRC.aoi,
        paint:{ 'line-color':'#00d4ff', 'line-width':1.8 } });

    // Labels always last — on top of every data layer
    if (!map.getSource('esri-labels'))
      map.addSource('esri-labels', {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri'
      });
    if (!map.getLayer('esri-labels-layer'))
      map.addLayer({ id:'esri-labels-layer', type:'raster', source:'esri-labels',
        paint:{ 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 9, 0.9] } });

    if (activeCatchment) {
      fetch(`/api/catchments/${encodeURIComponent(activeCatchment)}/geometry`)
        .then(r => r.ok ? r.json() : emptyFC()).then(gj => setData(SRC.catchment, gj)).catch(() => {});
    }
    if (activeCouncil && councilsGJ) {
      const feat = councilsGJ.features.find(f => f.properties.council_name === activeCouncil);
      if (feat) setData(SRC.council, { type:'FeatureCollection', features:[feat] });
    }
    if (aoiGeoJSON) setData(SRC.aoi, { type:'FeatureCollection', features:[aoiGeoJSON] });

    updateLegend(gj);
    if (!gj) loadLayer();

    if (_filterMaskState && _filterMaskState.ids &&
        _filterMaskState.ids.length > 0 &&
        _filterMaskState.mode !== 'off') {
      _applyFilterMask(_filterMaskState.ids, _filterMaskState.mode);
    }
  }

  function switchBasemap(bm) {
    const cfg = BASEMAPS[bm];
    const style = cfg.type === 'style' ? cfg.tiles : {
      version: 8,
      sources: { 'esri-satellite': { type:'raster', tiles:[cfg.tiles], tileSize:256, attribution: bm === 'satellite' ? '© Esri, Maxar' : '© Esri' } },
      layers:  [{ id:'esri-satellite', type:'raster', source:'esri-satellite' }]
    };
    map.once('style.load', reapplyLayer);
    map.setStyle(style, { diff: false });
    currentBasemap = bm;
  }

  function initMode(m, skipLoad = false) {
    mode = m;
    $('mode-explore').classList.toggle('active',   m === 'explore');
    $('mode-dashboard').classList.toggle('active', m === 'dashboard');

    document.body.classList.toggle('dashboard-mode', m === 'dashboard');

    try { map.setLayoutProperty('grid-fill', 'visibility', 'visible'); } catch(_) {}
    try { map.setLayoutProperty('grid-line', 'visibility', 'visible'); } catch(_) {}

    const rp       = $('right-panel');
    const rpToggle = $('rp-toggle');
    if (m === 'dashboard') {
      rp?.classList.add('rp-collapsed');
      if (rpToggle) rpToggle.textContent = '▶';
      _initDashboard();
    } else {
      rp?.classList.remove('rp-collapsed');
      if (rpToggle) rpToggle.textContent = '◀';
    }
    setTimeout(() => map.resize(), 220);
    if (!skipLoad) loadLayer();
  }

  function _initDashboard() {
    if (!dashCatchmentPanel) {
      const barsEl = $('dash-bars');
      if (barsEl && typeof CatchmentPanel !== 'undefined') {
        dashCatchmentPanel = new CatchmentPanel(barsEl, _getMapState);
      }
    }
    if (!dashPiePanel) {
      const pieEl = $('dash-pie');
      if (pieEl && typeof DashboardPie !== 'undefined') {
        dashPiePanel = new DashboardPie(pieEl, _getMapState);
      }
    }
    _emitStateChange();
  }

  $('mode-explore').onclick   = () => initMode('explore');
  $('mode-dashboard').onclick = () => initMode('dashboard');

  const _rpToggle = $('rp-toggle');
  if (_rpToggle) {
    _rpToggle.addEventListener('click', () => {
      const rp = $('right-panel');
      const collapsed = rp.classList.toggle('rp-collapsed');
      _rpToggle.textContent = collapsed ? '▶' : '◀';
      setTimeout(() => map.resize(), 220);
    });
  }

  function updateMonthLabel(slider, labelEl) {
    if (slider && labelEl) labelEl.textContent = MONTH_NAMES[+slider.value] || slider.value;
  }
  $('month').addEventListener('input', () => {
    updateMonthLabel($('month'), $('monthLabel'));
    loadLayer(true);
    _emitStateChange();
  });

  $('period').addEventListener('change', () => {
    const isObserved = $('period').value === '1990-2019';
    const memberEl = $('member');
    if (memberEl) {
      memberEl.disabled = isObserved;
      memberEl.title = isObserved ? 'Observed baseline has no ensemble members' : '';
      if (isObserved) { activeMember = 'mean'; memberEl.value = 'mean'; }
    }
    loadLayer();
    _emitStateChange();
  });

  $('member').addEventListener('change', () => {
    activeMember = $('member').value;
    loadLayer();
    _emitStateChange();
  });

  async function loadMetrics() {
    const grid = $('metric-grid');
    if (!grid) return;
    try {
      const catalogue = await fetch('/api/layers').then(r => r.json());
      const firstAvailable = catalogue.find(m => m.available !== false);

      if (!firstAvailable) {
        grid.innerHTML = '<div style="color:rgba(255,255,255,.4);font-size:11px;padding:4px 0">No data available yet</div>';
        return;
      }

      // Silently set default metric to first available (no change-event cascade)
      activeMetric = firstAvailable;
      updateLayerPaint();

      grid.innerHTML = '';
      catalogue.forEach(m => {
        const avail         = m.available !== false;
        const catchmentOnly = avail && m.map_available === false;
        const mapPeriods    = m.map_available_periods || [];
        const card  = document.createElement('div');
        card.className = 'metric-card' + (m.id === activeMetric.id ? ' active' : '') + (avail ? '' : ' metric-card--unavailable');
        card.dataset.id = m.id;
        card.title = '';
        let badgeHtml = '';
        if (catchmentOnly) {
          badgeHtml = mapPeriods.length > 0
            ? `<br><span class="metric-catchment-only">Map: ${mapPeriods.join(', ')} only</span>`
            : '<br><span class="metric-catchment-only">Catchment only</span>';
        }
        const unitsHtml = avail
          ? m.units + badgeHtml
          : '<span class="metric-unavail">pending</span>';
        card.innerHTML =
          '<div class="metric-card-swatch" style="background:'+(SWATCH[m.colorscale]||SWATCH.diverging)+'"></div>'+
          '<div class="metric-card-short">'+m.short+'</div>'+
          '<div class="metric-card-units">'+unitsHtml+'</div>';
        if (avail) card.addEventListener('click', () => selectMetric(m, card));
        grid.appendChild(card);
      });

      loadLayer();
      _emitStateChange();
    } catch(e) { console.warn('loadMetrics:', e); }
  }

  function selectMetric(m, cardEl) {
    activeMetric = m;
    document.querySelectorAll('.metric-card').forEach(c=>c.classList.remove('active'));
    cardEl.classList.add('active');
    updateLayerPaint();
    loadLayer();
    _emitStateChange();
  }

  function updateLayerPaint() {
    try { map.setPaintProperty('grid-fill', 'fill-color', buildFillColor()); } catch(_) {}
  }

  async function loadCouncils() {
    const badge = $('council-status');
    try {
      const res = await fetch('/api/councils');
      if (!res.ok) throw new Error();
      const fc = await res.json();
      if (fc.error) throw new Error(fc.detail);
      councilsGJ = fc;
      const sel = $('council');
      fc.features
        .map(f => f.properties.council_name)
        .filter(Boolean)
        .sort()
        .forEach(name => {
          const o = document.createElement('option');
          o.value = name; o.textContent = name;
          sel.appendChild(o);
        });
      if (badge) { badge.textContent='32 loaded'; badge.className='status-badge ok'; }
    } catch {
      if (badge) { badge.textContent='unavailable'; badge.className='status-badge error'; }
    }
  }

  $('council').addEventListener('change', () => {
    activeCouncil = $('council').value || null;

    if (activeCouncil && activeCatchment) {
      activeCatchment = null;
      if ($('catchment')) $('catchment').value = '';
      setData(SRC.catchment, emptyFC());
    }

    if (!activeCouncil) {
      setData(SRC.council, emptyFC());
      loadLayer();
      _emitStateChange();
      return;
    }

    if (councilsGJ) {
      const feat = councilsGJ.features.find(f => f.properties.council_name === activeCouncil);
      if (feat) {
        setData(SRC.council, { type:'FeatureCollection', features:[feat] });
        const bb = geomBbox(feat.geometry);
        if (bb) map.fitBounds(bb, { padding: 40, duration: 700 });
      }
    }

    loadLayer();
    _emitStateChange();
  });

  async function loadCatchments() {
    const badge = $('catchment-status');
    try {
      const res = await fetch('/api/catchments');
      if (!res.ok) throw new Error();
      catchmentsData = await res.json();
      const sel = $('catchment');
      catchmentsData.forEach(c => {
        const o = document.createElement('option');
        o.value = c.name; o.textContent = c.name;
        sel.appendChild(o);
      });
      if (badge) { badge.textContent = catchmentsData.length; badge.className = 'status-badge ok'; }
    } catch {
      if (badge) { badge.textContent = 'unavailable'; badge.className = 'status-badge error'; }
    }
  }

  $('catchment').addEventListener('change', () => {
    activeCatchment = $('catchment').value || null;

    if (activeCatchment && activeCouncil) {
      activeCouncil = null;
      if ($('council')) $('council').value = '';
      setData(SRC.council, emptyFC());
    }

    if (!activeCatchment) {
      setData(SRC.catchment, emptyFC());
      loadLayer();
      _emitStateChange();
      return;
    }

    const cd = catchmentsData.find(c => c.name === activeCatchment);
    if (cd?.bbox) {
      const b = cd.bbox;
      map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 40, duration: 700 });
    }

    fetch(`/api/catchments/${encodeURIComponent(activeCatchment)}/geometry`)
      .then(r => r.ok ? r.json() : emptyFC())
      .then(gj => setData(SRC.catchment, gj))
      .catch(() => setData(SRC.catchment, emptyFC()));

    loadLayer();
    _emitStateChange();
  });


  async function loadLayer(debounce = false) {
    if (debounce) {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => loadLayer(false), 300);
      return;
    }

    if (aoiGeoJSON?.geometry) {
      await _paintAoiFeature(aoiGeoJSON);
      return;
    }

    const metric = activeMetric.id;
    const period = $('period').value || '2050-2079';
    const month  = parseInt($('month').value || 5);

    const _mapAvailPeriods = activeMetric.map_available_periods || [];
    const _mapUnavail = activeMetric.map_available === false
      && !_mapAvailPeriods.includes(period);

    if (activeCatchment) {
      _hideMapUnavailMsg();
      map.setLayoutProperty('cells-fill', 'visibility', 'none');
      map.setLayoutProperty('cells-line', 'visibility', 'none');
      map.setLayoutProperty('grid-fill',  'visibility', 'visible');
      map.setLayoutProperty('grid-line',  'visibility', 'visible');
      showLoading(true);
      try {
        const _catchMemberP = activeMember !== 'mean' ? `&member=${activeMember}` : '';
        const url = `/api/catchments/${encodeURIComponent(activeCatchment)}/features`
                  + `?metric=${metric}&period=${encodeURIComponent(period)}&month=${month}${_catchMemberP}`;
        const resp = await fetch(url);
        if (!resp.ok) {
          setData(SRC.grid, emptyFC());
          updateLegend(null);
          return;
        }
        const gj = await resp.json();
        currentGJ = gj;
        setData(SRC.grid, gj);
        const vals = gj.features.map(f => +f.properties.Change).filter(v => !isNaN(v));
        const cMin = vals.length ? Math.min(...vals) : null;
        const cMax = vals.length ? Math.max(...vals) : null;
        map.setPaintProperty('grid-fill', 'fill-color', buildFillColor(cMin, cMax));
        map.setPaintProperty('grid-line', 'line-color', 'rgba(0,0,0,0.2)');
        map.setPaintProperty('grid-line', 'line-width', 0.3);
        _lastLayerState = { geojson: gj, dataMin: cMin, dataMax: cMax };
        updateLegend(gj);
        _updateLcScope();
      } catch(e) {
        console.error('loadLayer catchment:', e);
      } finally {
        showLoading(false);
      }
      return;
    }

    if (!activeCouncil) {
      if (_mapUnavail) {
        map.setLayoutProperty('cells-fill', 'visibility', 'none');
        map.setLayoutProperty('cells-line', 'visibility', 'none');
        map.setLayoutProperty('grid-fill',  'visibility', 'none');
        map.setLayoutProperty('grid-line',  'visibility', 'none');
        _showMapUnavailMsg();
        return;
      }
      _hideMapUnavailMsg();
      map.setLayoutProperty('cells-fill', 'visibility', 'visible');
      map.setLayoutProperty('cells-line', 'visibility', 'visible');
      map.setLayoutProperty('grid-fill',  'visibility', 'none');
      map.setLayoutProperty('grid-line',  'visibility', 'none');
      await loadValues(metric, period, month);
      _updateLcScope();
      return;
    }

    if (_mapUnavail) {
      map.setLayoutProperty('cells-fill', 'visibility', 'none');
      map.setLayoutProperty('cells-line', 'visibility', 'none');
      map.setLayoutProperty('grid-fill',  'visibility', 'none');
      map.setLayoutProperty('grid-line',  'visibility', 'none');
      _showMapUnavailMsg();
      return;
    }
    _hideMapUnavailMsg();
    map.setLayoutProperty('cells-fill', 'visibility', 'none');
    map.setLayoutProperty('cells-line', 'visibility', 'none');
    map.setLayoutProperty('grid-fill',  'visibility', 'visible');
    map.setLayoutProperty('grid-line',  'visibility', 'visible');
    showLoading(true);
    try {
      const _councilMemberP = activeMember !== 'mean' ? `&member=${activeMember}` : '';
      const url  = `/api/councils/${encodeURIComponent(activeCouncil)}/features`
                 + `?metric=${metric}&period=${encodeURIComponent(period)}&month=${month}${_councilMemberP}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        console.warn('features error:', err.detail || err.error);
        setData(SRC.grid, emptyFC());
        updateLegend(null);
        return;
      }
      const gj = await resp.json();
      currentGJ = gj;
      setData(SRC.grid, gj);
      const _cVals = gj.features.map(f => +f.properties.Change).filter(v => !isNaN(v));
      const _cMin  = _cVals.length ? Math.min(..._cVals) : null;
      const _cMax  = _cVals.length ? Math.max(..._cVals) : null;
      map.setPaintProperty('grid-fill', 'fill-color', buildFillColor(_cMin, _cMax));
      map.setPaintProperty('grid-line', 'line-color', 'rgba(0,0,0,0.2)');
      map.setPaintProperty('grid-line', 'line-width', 0.3);
      _lastLayerState = { geojson: gj, dataMin: _cMin, dataMax: _cMax };
      updateLegend(gj);
      _updateLcScope();
    } catch(e) {
      console.error('loadLayer:', e);
    } finally {
      showLoading(false);
    }
  }

  $('load').onclick = () => loadLayer();

  async function loadValues(metric, period, month) {
    showLoading(true);
    try {
      const memberParam = (activeMember && activeMember !== 'mean') ? `&member=${activeMember}` : '';
      const url  = `/api/values?metric=${metric}&period=${encodeURIComponent(period)}&month=${month}${memberParam}`;
      const resp = await fetch(url);
      if (!resp.ok) { updateLegend(null); return; }
      const data = await resp.json();
      _vtValues  = data;

      const vals = Object.values(data).filter(v => v != null && isFinite(v));
      if (!vals.length) { updateLegend(null); return; }
      const dMin  = Math.min(...vals);
      const dMax  = Math.max(...vals);
      const dMean = vals.reduce((a, b) => a + b, 0) / vals.length;
      lastDataRange = { min: dMin, max: dMax };

      map.setPaintProperty('cells-fill', 'fill-color', buildFillColorFromFeatureState(dMin, dMax));

      for (const [id, value] of Object.entries(data)) {
        map.setFeatureState(
          { source: 'cells-vt', sourceLayer: 'cells', id: +id },
          { value }
        );
      }

      updateLegend(null, { min: dMin, max: dMax, mean: dMean, count: vals.length });
    } catch(e) {
      console.error('loadValues:', e);
    } finally {
      showLoading(false);
    }
  }

  function updateLegend(gj, stats) {
    const legend = $('legend');
    if (!legend) return;
    const display = METRIC_DISPLAY[activeMetric.id] || activeMetric;
    const units = METRIC_UNITS[activeMetric.id] || display.units || activeMetric.units || '';
    const label = METRIC_LABELS[activeMetric.id] || display.short || activeMetric.short || activeMetric.id;
    const period     = $('period')?.value || '';
    const isBaseline = period === '1990-2019';
    let minVal = null, maxVal = null, mean = null, cellCount = null;

    if (stats) {
      minVal = stats.min; maxVal = stats.max; mean = stats.mean;
      cellCount = stats.count ?? null;
      lastDataRange = { min: minVal, max: maxVal };
    } else if (gj?.features?.length) {
      const vals = gj.features.map(f => +f.properties.Change).filter(v => !isNaN(v));
      if (vals.length) {
        minVal = Math.min(...vals);
        maxVal = Math.max(...vals);
        mean   = vals.reduce((a,b) => a+b, 0) / vals.length;
        cellCount = gj.features.length;
        lastDataRange = { min: minVal, max: maxVal };
      }
    }

    if (minVal === null) {
      const _isNat = !activeCouncil && !activeCatchment;
      const _memberLabel = activeMember && activeMember !== 'mean' ? `Member ${activeMember}` : 'Ensemble mean';
      legend.innerHTML = `<div class="legend-title">${label} <span style="opacity:.35;font-weight:400">${units}</span></div>
        <div class="legend-subtitle">${_isNat ? 'Individual 1km cells' : isBaseline ? 'Observed values (1990-2019 baseline)' : `${_memberLabel} : Change from 1990-2019 baseline`}</div>`;
      return;
    }

    const mtype = getMetricType(activeMetric.id);
    const range = (maxVal - minVal) || 1;
    let gradientCss, zeroTickHtml = '', labelsHtml;

    if (mtype === 'balance' || mtype === 'temperature') {
      const colors = mtype === 'balance'
        ? { lo:'#d73027', mid:'#f7f7f7', hi:'#4575b4' }
        : { lo:'#4575b4', mid:'#ffffbf', hi:'#d73027' };
      const zeroInRange = minVal < 0 && maxVal > 0;
      const zeroPct     = zeroInRange ? ((0 - minVal) / range * 100).toFixed(1) : null;

      if (maxVal <= 0) {
        gradientCss = `linear-gradient(to right,${colors.lo},${colors.mid})`;
      } else if (minVal >= 0) {
        gradientCss = `linear-gradient(to right,${colors.mid},${colors.hi})`;
      } else {
        gradientCss = `linear-gradient(to right,${colors.lo} 0%,${colors.mid} ${zeroPct}%,${colors.hi} 100%)`;
      }

      if (zeroPct !== null && !isBaseline) {
        zeroTickHtml = `<div class="legend-zero-tick" style="left:${zeroPct}%"></div>`;
        labelsHtml = `<span>${minVal.toFixed(1)}</span>
          <span style="position:absolute;left:${zeroPct}%;transform:translateX(-50%)">0</span>
          <span>${maxVal.toFixed(1)}</span>`;
      } else {
        labelsHtml = `<span>${minVal.toFixed(1)}</span><span>${maxVal.toFixed(1)}</span>`;
      }
    } else {
      gradientCss = 'linear-gradient(to right,#ffffcc,#41b6c4,#0c2c84)';
      labelsHtml  = `<span>${minVal.toFixed(1)}</span><span>${maxVal.toFixed(1)}</span>`;
    }

    const isNational = !activeCouncil && !activeCatchment;
    const _memberLabel = activeMember && activeMember !== 'mean' ? `Member ${activeMember}` : 'Ensemble mean';
    const subtitle = isNational ? 'Individual 1km cells' : isBaseline ? 'Observed values (1990-2019 baseline)' : `${_memberLabel} : Change from 1990-2019 baseline`;
    legend.innerHTML = `
      <div class="legend-title">${label} <span style="opacity:.35;font-weight:400">${units}</span></div>
      <div class="legend-subtitle">${subtitle}</div>
      <div class="legend-ramp-wrap">
        <div class="legend-ramp" style="background:${gradientCss}"></div>
        ${zeroTickHtml}
      </div>
      <div class="legend-labels" style="position:relative">
        ${labelsHtml}
      </div>
      ${mean!==null?`<div class="legend-stats">
        Period: <span>${period}</span><br>
        ${cellCount!=null?`Cells: <span>${cellCount.toLocaleString()}</span><br>`:''}
        Mean: <span>${mean.toFixed(1)} ${units}</span><br>
        Range: <span>${minVal.toFixed(1)} – ${maxVal.toFixed(1)}</span>
      </div>`:''}`;
  }

  map.on('draw.create', e => {
    const feat = e.features?.[0];
    if (!feat) return;
    _drawActive = false;
    aoiGeoJSON = feat;
    setData(SRC.aoi, { type:'FeatureCollection', features:[feat] });
    document.dispatchEvent(new CustomEvent('climascope:draw:complete', { detail: { feature: feat } }));
  });

  map.on('draw.update', e => {
    const feat = e.features?.[0];
    if (!feat) return;
    _drawActive = false;
    aoiGeoJSON = feat;
    setData(SRC.aoi, { type:'FeatureCollection', features:[feat] });
    document.dispatchEvent(new CustomEvent('climascope:draw:complete', { detail: { feature: feat } }));
  });

  map.on('draw.modechange', e => {
    if (e.mode !== 'draw_polygon') {
      _drawActive = false;
      map.getCanvas().style.cursor = '';
      document.dispatchEvent(new CustomEvent('climascope:draw:disarmed'));
    }
  });

  document.addEventListener('climascope:draw:arm', () => {
    _drawActive = true;
    setData(SRC.grid, emptyFC());
    setData(SRC.aoi, emptyFC());
    aoiGeoJSON = null;
    currentGJ  = null;
    _lastLayerState = { geojson: null, dataMin: null, dataMax: null };
    updateLegend(null);
    // Hide VT national layers immediately (setData doesn't affect tile sources)
    try { map.setLayoutProperty('cells-fill', 'visibility', 'none'); } catch(_) {}
    try { map.setLayoutProperty('cells-line', 'visibility', 'none'); } catch(_) {}
    if (!map.hasControl(draw)) map.addControl(draw, 'top-left');
    draw.changeMode('draw_polygon');
    map.getCanvas().style.cursor = 'crosshair';
  });

  document.addEventListener('climascope:draw:disarm', () => {
    if (map.hasControl(draw)) {
      try { draw.changeMode('simple_select'); } catch(_) {}
      map.removeControl(draw);
    }
    map.getCanvas().style.cursor = '';
  });

  document.addEventListener('climascope:aoi:update', e => {
    const { geojson, bbox } = e.detail || {};
    if (!geojson) return;
    aoiGeoJSON = geojson;
    setData(SRC.aoi, { type:'FeatureCollection', features:[geojson] });
    if (bbox) map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding:40, duration:700 });
  });

  document.addEventListener('climascope:aoi:ready', async e => {
    const feature = e.detail?.feature;
    if (!feature?.geometry) return;
    await _paintAoiFeature(feature);
    const _geom   = feature.geometry;
    const _coords = _geom?.type === 'Polygon'      ? _geom.coordinates.flat()
                  : _geom?.type === 'MultiPolygon' ? _geom.coordinates.flat(2)
                  : [];
    if (_coords.length) {
      const lngs = _coords.map(c => c[0]), lats = _coords.map(c => c[1]);
      map.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 40, duration: 700 }
      );
    }
    _emitStateChange();
  });

  document.addEventListener('climascope:aoi:clear', () => {
    aoiGeoJSON = null;
    _drawActive = false;
    if (map.hasControl(draw)) {
      try { draw.deleteAll(); draw.changeMode('simple_select'); } catch(_) {}
      map.removeControl(draw);
    }
    setData(SRC.aoi, emptyFC());
    map.getCanvas().style.cursor = '';
    _updateLcScope();
    _emitStateChange();
  });

  function exportCurrentView() {
    if (!currentGJ?.features?.length) { alert('No data loaded yet.'); return; }
    const { metric, period, month, member, scope, councilName, catchmentName } = _getMapState();
    const memberLabel = member && member !== 'mean' ? member : 'mean';
    const memberSuffix = memberLabel !== 'mean' ? `_member_${memberLabel}` : `_ensemble_mean`;
    const colName = `${metric}_${period}_${month}${memberSuffix}`;
    const exported = {
      ...currentGJ,
      properties: {
        ...(currentGJ.properties || {}),
        metric,
        period,
        month,
        ensemble_member: memberLabel,
        scope,
        council: councilName,
        catchment: catchmentName,
        value_field: colName,
      },
      features: currentGJ.features.map(f => {
        const { Change, ...rest } = f.properties || {};
        return {
          ...f,
          properties: {
            ...rest,
            metric,
            period,
            month,
            ensemble_member: memberLabel,
            [colName]: Change,
          },
        };
      }),
    };
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `climascope_${metric}_${period}_${month}${memberSuffix}.geojson`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const exportBtn = document.createElement('div');
  exportBtn.className = 'section';
  exportBtn.innerHTML = `<button id="btn-export" class="draw-btn" style="width:100%;justify-content:center">
    ⬇&nbsp;&nbsp;Export current view (GeoJSON)
  </button>`;
  $('panel-explore').appendChild(exportBtn);
  exportBtn.querySelector('#btn-export').addEventListener('click', exportCurrentView);

  function attachPopup() {
    map.on('click', 'grid-fill', e => {
      if (_drawActive) return;
      const f = e.features[0];

        if (f.properties?.catchment_name && f.properties?.id_1km == null) {
        const name = f.properties.catchment_name;
        const sel  = $('catchment');
        if (sel) { sel.value = name; sel.dispatchEvent(new Event('change')); }
        return;
      }

      const id      = f.properties?.id_1km;
      const m       = f.properties?.Month ?? +($('month')?.value || 5);
      const rawVal  = +(f.properties?.Change ?? 0);
      const col     = valueToColor(rawVal);
      const _isBase = ($('period')?.value || '') === '1990-2019';
      const units_  = METRIC_UNITS[activeMetric.id] || '';
      const valDisplay = _isBase
        ? `${rawVal.toFixed(2)} ${units_} (observed)`
        : `${rawVal >= 0 ? '+' : ''}${rawVal.toFixed(2)} ${units_} (change)`;

      new maplibregl.Popup({ maxWidth:'320px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="min-width:270px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <div style="width:10px;height:10px;border-radius:2px;background:${col};flex-shrink:0"></div>
              <strong style="font-size:13px">Cell ${id}</strong>
            </div>
            <div style="font-size:11px;opacity:.6;margin-bottom:6px">
              ${MONTH_NAMES[m] || m} &nbsp;·&nbsp;
              ${METRIC_LABELS[activeMetric.id] || activeMetric.id}: <strong style="color:#e2e8f4">${valDisplay}</strong>
            </div>
            <div id="wet-${id}" style="font-size:11px;opacity:.6;margin-bottom:6px">Soil wetness: loading…</div>
            <canvas id="ts-${id}" width="260" height="110"></canvas>
          </div>
        `)
        .addTo(map);

      setTimeout(() => { loadTS(id); loadWetness(id); }, 0);
    });

    map.on('mouseenter', 'grid-fill', () => map.getCanvas().style.cursor = 'crosshair');
    map.on('mouseleave', 'grid-fill', () => map.getCanvas().style.cursor = '');

    map.on('click', 'cells-fill', e => {
      if (_drawActive) return;
      const f   = e.features[0];
      const id  = f.id;  // promoted from id_1km via promoteId
      const value   = _vtValues ? _vtValues[String(id)] : null;
      const col     = value != null ? valueToColor(+value) : '#888888';
      const _isBase = ($('period')?.value || '') === '1990-2019';
      const units_  = METRIC_UNITS[activeMetric.id] || '';
      const valDisplay = value != null
        ? _isBase
          ? `${(+value).toFixed(2)} ${units_} (observed)`
          : `${+value >= 0 ? '+' : ''}${(+value).toFixed(2)} ${units_} (change)`
        : 'N/A';
      const m    = parseInt($('month')?.value || 7);

      new maplibregl.Popup({ maxWidth: '320px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="min-width:270px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <div style="width:10px;height:10px;border-radius:2px;background:${col};flex-shrink:0"></div>
              <div>
                <div id="ctx-${id}" style="font-size:13px;font-weight:600">…</div>
                <div style="font-size:10px;opacity:.4;margin-top:1px">id: ${id}</div>
              </div>
            </div>
            <div style="font-size:11px;opacity:.6;margin-bottom:6px">
              ${MONTH_NAMES[m] || m} &nbsp;·&nbsp;
              ${METRIC_LABELS[activeMetric.id] || activeMetric.id}: <strong style="color:#e2e8f4">${valDisplay}</strong>
            </div>
            <div id="wet-${id}" style="font-size:11px;opacity:.6;margin-bottom:6px">Soil wetness: loading…</div>
            <canvas id="ts-${id}" width="260" height="110"></canvas>
          </div>
        `)
        .addTo(map);

      setTimeout(() => { loadTS(id); loadWetness(id); loadCellContext(id); }, 0);
    });

    map.on('mouseenter', 'cells-fill', () => map.getCanvas().style.cursor = 'crosshair');
    map.on('mouseleave', 'cells-fill', () => map.getCanvas().style.cursor = '');

    map.on('click', e => {
      if (_drawActive) return;
      if (_filterMaskState.mode === 'none') return;
      const hits = map.queryRenderedFeatures(e.point, { layers: ['cells-fill', 'grid-fill'] });
      if (hits.length === 0) {
        _filterCellsGJ = null;
        _applyFilterMask([], 'none');
        setData(SRC.filterCells, emptyFC());
        window.dispatchEvent(new CustomEvent('climascope:filter:maskcleared'));
      }
    });
  }

  async function loadTS(id) {
    const canvas = document.getElementById(`ts-${id}`);
    if (!canvas) return;
    try {
      const period = $('period').value || '2050-2079';
      const _tsMemberP = (activeMember && activeMember !== 'mean') ? `&member=${activeMember}` : '';
      const ts = await fetch(`/api/timeseries?metric=${activeMetric.id}&period=${encodeURIComponent(period)}&id_1km=${id}${_tsMemberP}`).then(r=>r.json());
      const ctx = canvas.getContext('2d');
      if (canvas._chart) canvas._chart.destroy();
      const activeM = +($('month')?.value || 0);
      canvas._chart = new Chart(ctx, {
        type:'line',
        data:{
          labels: (ts.months||[]).map(m => MONTH_NAMES[m]||m),
          datasets:[{
            data: ts.values,
            borderColor:'rgba(91,131,240,.8)',
            borderWidth:1.5,
            pointRadius:3,
            pointBackgroundColor:(ts.months||[]).map(m => m===activeM ? '#ff6b6b' : 'rgba(91,131,240,.5)'),
            tension:.4, fill:true,
            backgroundColor:'rgba(61,99,212,.07)'
          }]
        },
        options:{
          plugins:{ legend:{ display:false } },
          scales:{
            x:{ ticks:{ color:'rgba(226,232,244,.35)', font:{size:9} }, grid:{ color:'rgba(255,255,255,.04)' } },
            y:{ ticks:{ color:'rgba(226,232,244,.35)', font:{size:9} }, grid:{ color:'rgba(255,255,255,.04)' } }
          }
        }
      });
    } catch {}
  }

  async function loadWetness(id) {
    const div = document.getElementById(`wet-${id}`);
    if (!div) return;
    try {
      const w = await fetch(`/api/wetness?id=${id}`).then(r=>r.json());
      if (!w?.classes?.length) { div.textContent='Soil wetness: no data'; return; }
      const top = w.classes.slice(0,2).map(c=>`${c.label} (${c.pct}%)`).join(', ');
      div.innerHTML = `<strong style="opacity:1">Soil wetness:</strong> ${top}`;
    } catch { div.textContent='Soil wetness: error'; }
  }

  async function loadCellContext(id) {
    const el = document.getElementById(`ctx-${id}`);
    if (!el) return;
    try {
      const ctx = await fetch(`/api/cell/${id}/context`).then(r => r.json());
      const parts = [ctx.catchment, ctx.council].filter(Boolean);
      el.textContent = parts.length ? parts.join(' · ') : `Cell ${id}`;
    } catch { el.textContent = `Cell ${id}`; }
  }

  document.querySelectorAll('.rp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.rp-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === tab));
      const coveragePane = document.getElementById('coverage-panel');
      const filterPane   = document.getElementById('filter-panel');
      if (coveragePane) coveragePane.classList.toggle('hidden', tab !== 'coverage');
      if (filterPane)   filterPane.classList.toggle('hidden',   tab !== 'filter');
    });
  });

  const cpEl = document.getElementById('coverage-panel');
  if (cpEl && typeof CoveragePanel !== 'undefined') {
    coveragePanel = new CoveragePanel(cpEl, _getMapState);
    // initial render is deferred to loadMetrics() so map and panel share the same resolved state

    document.addEventListener('climascope:setscope', e => {
      const { type } = e.detail;
      if (type === 'national') {
        activeCouncil   = null;
        activeCatchment = null;
        if ($('council'))   $('council').value   = '';
        if ($('catchment')) $('catchment').value = '';
        setData(SRC.council,   emptyFC());
        setData(SRC.catchment, emptyFC());
        map.easeTo({ center: SCOTLAND_VIEW.center, zoom: SCOTLAND_VIEW.zoom, duration: 700 });
        loadLayer();
        _emitStateChange();
      }
    });
  }

  const fpEl = document.getElementById('filter-panel');
  if (fpEl && typeof FilterPanel !== 'undefined') {
    filterPanel = new FilterPanel(fpEl, _getMapState);
  }

  function _applyFilterMask(ids, mode) {
    _filterMaskState = { ids, mode };
    if (!map.getLayer('grid-fill-mask')) return;
    if (!ids || !ids.length || mode === 'none') {
      map.setFilter('grid-fill-mask', ['boolean', false]);
      return;
    }
    if (mode === 'show') {
      map.setFilter('grid-fill-mask', ['!', ['in', ['get', 'id_1km'], ['literal', ids]]]);
    } else {
      map.setFilter('grid-fill-mask', ['in', ['get', 'id_1km'], ['literal', ids]]);
    }
  }

  document.addEventListener('climascope:filter:mask', e => {
    _applyFilterMask(e.detail.ids, e.detail.mode);
  });

  document.addEventListener('climascope:filter:zoom', async e => {
    const ids = e.detail.ids;
    if (!ids || !ids.length) return;
    try {
      const resp = await fetch('/api/filter/bbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!resp.ok) return;
      const bb = await resp.json();
      map.once('moveend', () => { if (map.getZoom() < 9) map.setZoom(9); });
      map.fitBounds([[bb.west, bb.south], [bb.east, bb.north]], { padding: 40, duration: 700 });
    } catch {}
  });

  document.addEventListener('climascope:filter:cells', async e => {
    const { ids } = e.detail;
    if (!ids || !ids.length) {
      _filterCellsGJ = null;
      setData(SRC.filterCells, emptyFC());
      return;
    }
    try {
      const resp = await fetch('/api/filter/cells', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!resp.ok) return;
      const gj = await resp.json();
      _filterCellsGJ = gj;
      setData(SRC.filterCells, gj);
    } catch {}
  });

});
