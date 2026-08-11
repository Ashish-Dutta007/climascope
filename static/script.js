document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  const _ukCalendarMonth = () => Number(new Intl.DateTimeFormat('en-GB', {
    month: 'numeric', timeZone: 'Europe/London'
  }).format(new Date()));
  const _defaultMonth = _ukCalendarMonth();
  const _html = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);

  const _mobileSidebarQuery = window.matchMedia('(max-width: 767px)');
  const _appShell = $('app');
  const _sidebarOpenBtn = $('sidebar-open');
  const _sidebarCloseBtn = $('sidebar-close');
  function _setMobileSidebar(collapsed, moveFocus = false) {
    if (!_appShell) return;
    const isMobile = _mobileSidebarQuery.matches;
    _appShell.classList.toggle('sidebar-collapsed', isMobile && collapsed);
    _sidebarOpenBtn?.setAttribute('aria-expanded', String(isMobile && !collapsed));
    if (moveFocus && isMobile) (collapsed ? _sidebarOpenBtn : _sidebarCloseBtn)?.focus();
  }
  _sidebarOpenBtn?.addEventListener('click', () => _setMobileSidebar(false, true));
  _sidebarCloseBtn?.addEventListener('click', () => _setMobileSidebar(true, true));
  $('sidebar-scrim')?.addEventListener('click', () => _setMobileSidebar(true));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _mobileSidebarQuery.matches && !_appShell?.classList.contains('sidebar-collapsed'))
      _setMobileSidebar(true, true);
  });
  const _syncMobileSidebar = () => _setMobileSidebar(_mobileSidebarQuery.matches);
  _mobileSidebarQuery.addEventListener?.('change', _syncMobileSidebar);
  _syncMobileSidebar();

  /* Download a blob as a file.
     The anchor must be attached to the document — Firefox ignores click() on a
     detached element, so downloads silently did nothing there. The object URL
     must also outlive the click; revoking it synchronously races the browser
     starting the download and can cancel it. */
  function _saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 30000);
  }

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
      month:         parseInt($('month')?.value || _defaultMonth),
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

  const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
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

  const HABITAT_FILL_OPACITY = ['interpolate', ['linear'],
    ['coalesce', ['feature-state', 'habf'], 0], 0.2, 0.35, 1, 0.85];

  function buildHabitatFillColor(classes) {
    const expr = ['match', ['coalesce', ['feature-state', 'hab'], -1]];
    (classes || []).forEach(c => expr.push(c.group_code, c.color));
    expr.push('rgba(0,0,0,0)');
    return expr;
  }

  // LiDAR coverage coloured by acquisition phase (legend/colours come from the API).
  // `enabled` (a Set of phase codes) filters which phases render — unchecked ones
  // fall through to transparent.
  function buildLidarFillColor(legend, enabled) {
    const pairs = [];
    (legend || []).forEach(p => { if (!enabled || enabled.has(p.code)) pairs.push(p.code, p.color); });
    if (!pairs.length) return 'rgba(0,0,0,0)';
    return ['match', ['coalesce', ['feature-state', 'lphase'], 0], ...pairs, 'rgba(0,0,0,0)'];
  }
  let _lidarEnabled = null;   // Set of phase codes currently shown (null = all)

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
  let _currentViewExportBtn = null;
  let aoiGeoJSON      = null;       // drawn / uploaded AOI (kept for map layer)
  let refreshTimer    = null;
  let _layerLoadRevision = 0;
  let currentBasemap   = 'dark';
  let _lastLayerState  = { geojson: null, dataMin: null, dataMax: null };
  let _filterMaskState = { ids: null, mode: 'none' };
  let _filterCellsGJ   = null;   // persisted filter-cells GeoJSON for basemap-switch re-apply
  let _vtValues        = null;   // { id_1km_str: value } — cache for basemap-switch re-apply
  let climateOpacity   = 0.85;
  let contextOpacity   = 0.85;
  let basemapOpacity   = 1.0;
  let _savedClimateOpacity = climateOpacity;
  let _contextWasActive = false;
  let activeMember     = 'mean';
  let lcOverlayOn      = false;
  let _lcDominant      = null;   // cached /api/landcover/dominant payload
  let habitatOverlayOn = false;
  let _habitatDominant = null;   // cached /api/habitat/dominant payload
  let lidarOverlayOn   = false;
  let _lidarCov        = null;   // cached /api/lidar/coverage payload
  let terrainOverlayOn = false;
  let hillshadeOn      = false;
  let hillshadeOpacity = 0.9;
  let _hillshadeInfo   = null;   // { minzoom, maxzoom, bounds } from /api/terrain/hillshade_info
  let terrainVar       = 'elevation';
  const _terrainCache  = {};     // var -> { data:{id:val}, min, max }
  let _terrainApplied  = false;  // whether feature-states are currently set

  function _setCurrentViewData(gj) {
    currentGJ = gj;
    if (!_currentViewExportBtn) return;
    const scoped = Boolean(activeCouncil || activeCatchment || aoiGeoJSON);
    const available = scoped && Boolean(gj?.features?.length);
    _currentViewExportBtn.disabled = !available;
    _currentViewExportBtn.title = scoped
      ? (available ? 'Export the currently displayed scoped cells' : 'No scoped cell data is loaded')
      : 'National cell export is unavailable; select a council, catchment, or AOI';
  }

  // Whole-of-Scotland framing including the island groups. Bounds adapt better
  // than a fixed zoom across desktop, laptop, and mobile map sizes.
  const SCOTLAND_BOUNDS = [[-8.2, 54.4], [-0.4, 61.05]];
  const SCOTLAND_FIT_OPTIONS = { padding: 34, maxZoom: 5.35 };

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
    bounds: SCOTLAND_BOUNDS,
    fitBoundsOptions: { ...SCOTLAND_FIT_OPTIONS, duration: 0 }
  });

  function _fitScotland(duration = 700) {
    map.fitBounds(SCOTLAND_BOUNDS, { ...SCOTLAND_FIT_OPTIONS, duration });
  }

  function _fitActiveScope(duration = 700) {
    if (activeCatchment) {
      const selected = catchmentsData.find(c => c.name === activeCatchment);
      if (selected?.bbox) {
        const b = selected.bbox;
        map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: 40, duration });
        return;
      }
    }
    if (activeCouncil && councilsGJ) {
      const feature = councilsGJ.features.find(f => f.properties.council_name === activeCouncil);
      const bounds = feature ? geomBbox(feature.geometry) : null;
      if (bounds) {
        map.fitBounds(bounds, { padding: 40, duration });
        return;
      }
    }
    _fitScotland(duration);
  }

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  // ===== ACTIVE LAYERS PANEL =====
  // Lists what's currently on the map (the active data layer + hillshade) with a
  // per-layer opacity slider. Foundation of the layer-manager model.
  const _alEl = document.createElement('div');
  _alEl.id = 'active-layers';
  _alEl.setAttribute('role', 'region');
  _alEl.setAttribute('aria-label', 'Active map layers');
  map.getContainer().appendChild(_alEl);

  function _activeContextLayerName() {
    if (terrainOverlayOn) return (TERRAIN_LABELS[terrainVar]?.[0] || 'Terrain');
    if (lidarOverlayOn)   return 'LiDAR coverage';
    if (habitatOverlayOn) return 'Habitat · NatureScot 2022';
    if (lcOverlayOn)      return 'Land cover';
    return null;
  }

  function _activeClimateLayerName() {
    return (typeof METRIC_LABELS !== 'undefined' && activeMetric && METRIC_LABELS[activeMetric.id])
      || activeMetric?.short || activeMetric?.id || 'Climate';
  }

  function _setCatalogueStatus(id, text, active) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('has-active', active);
  }

  function _syncLayerCatalogueState() {
    const states = {
      landcover: lcOverlayOn,
      habitat: habitatOverlayOn,
      lidar: lidarOverlayOn,
      terrain: terrainOverlayOn,
      hillshade: hillshadeOn,
    };
    document.querySelectorAll('.layer-item[data-layer]').forEach(item => {
      item.classList.toggle('is-active', Boolean(states[item.dataset.layer]));
    });
    document.querySelectorAll('input[name="basemap"]').forEach(input => {
      input.checked = input.value === currentBasemap;
    });

    const landName = habitatOverlayOn ? 'Habitat' : lcOverlayOn ? 'Land cover' : 'None active';
    const terrainName = terrainOverlayOn
      ? (TERRAIN_LABELS[terrainVar]?.[0] || 'Terrain')
      : lidarOverlayOn ? 'LiDAR coverage' : 'None active';
    const reliefName = `${BASEMAPS[currentBasemap]?.label || 'Basemap'}${hillshadeOn ? ' + hillshade' : ''}`;
    _setCatalogueStatus('climate-layer-current', _activeClimateLayerName(), true);
    _setCatalogueStatus('land-layer-current', landName, lcOverlayOn || habitatOverlayOn);
    _setCatalogueStatus('terrain-layer-current', terrainName, lidarOverlayOn || terrainOverlayOn);
    _setCatalogueStatus('relief-layer-current', reliefName, true);
  }

  function _renderActiveLayers() {
    const rows = [];
    const contextName = _activeContextLayerName();
    if (contextName) rows.push({ key: 'context', name: contextName, op: contextOpacity });
    rows.push({ key: 'climate', name: _activeClimateLayerName(), op: climateOpacity });
    if (hillshadeOn) rows.push({ key: 'hillshade', name: 'Hillshade', op: hillshadeOpacity });
    rows.push({ key: 'basemap', name: `${BASEMAPS[currentBasemap]?.label || 'Basemap'} basemap`, op: basemapOpacity });
    _alEl.innerHTML = `<div class="al-title">Active layers</div>` + rows.map(r =>
      `<div class="al-row">
         <span class="al-name" title="${_html(r.name)}">${_html(r.name)}</span>
         <input type="range" class="al-op" data-key="${r.key}" min="0" max="1" step="0.05" value="${r.op}"
                aria-label="${_html(r.name)} opacity" aria-valuetext="${Math.round(r.op * 100)} percent">
         <span class="al-value" aria-hidden="true">${Math.round(r.op * 100)}%</span>
       </div>`).join('');
    _alEl.querySelectorAll('.al-op').forEach(sl =>
      sl.addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        e.target.setAttribute('aria-valuetext', `${Math.round(v * 100)} percent`);
        const valueEl = e.target.closest('.al-row')?.querySelector('.al-value');
        if (valueEl) valueEl.textContent = `${Math.round(v * 100)}%`;
        if (e.target.dataset.key === 'hillshade') {
          hillshadeOpacity = v;
          try { map.setPaintProperty('terrain-hs-layer', 'raster-opacity', v); } catch(_) {}
        } else if (e.target.dataset.key === 'basemap') {
          basemapOpacity = v;
          _applyBasemapOpacity();
        } else if (e.target.dataset.key === 'context') {
          contextOpacity = v;
          _applyDataOpacity();
        } else {
          climateOpacity = v;
          if (_anyCellOverlayOn()) _savedClimateOpacity = v;
          _applyDataOpacity();
        }
      }));
    _syncLayerCatalogueState();
  }

  // Context activation makes the climate underlay explicit and temporarily dims
  // it to 12%. Its previous opacity is restored when the context is removed.
  function _anyCellOverlayOn() { return lcOverlayOn || habitatOverlayOn || lidarOverlayOn || terrainOverlayOn; }
  function _syncClimateUnderlayOpacity() {
    const contextActive = _anyCellOverlayOn();
    if (contextActive && !_contextWasActive) {
      _savedClimateOpacity = climateOpacity;
      climateOpacity = 0.12;
    } else if (!contextActive && _contextWasActive) {
      climateOpacity = _savedClimateOpacity;
    }
    _contextWasActive = contextActive;
  }
  function _applyBasemapOpacity() {
    for (const id of ['carto', 'esri-satellite']) {
      try { if (map.getLayer(id)) map.setPaintProperty(id, 'raster-opacity', basemapOpacity); } catch(_) {}
    }
  }
  function _applyDataOpacity() {
    _syncClimateUnderlayOpacity();
    if (terrainOverlayOn) { try { map.setPaintProperty('terrain-fill', 'fill-opacity', contextOpacity); } catch(_) {} }
    if (lidarOverlayOn)   { try { map.setPaintProperty('lidar-fill',   'fill-opacity', contextOpacity); } catch(_) {} }
    if (habitatOverlayOn) { _applyHabitatOpacity(); }
    if (lcOverlayOn)      { _applyLcOpacity(); }
    if (hillshadeOn)      { try { map.setPaintProperty('terrain-hs-layer', 'raster-opacity', hillshadeOpacity); } catch(_) {} }
    try { map.setPaintProperty('grid-fill',  'fill-opacity', climateOpacity); } catch(_) {}
    try { map.setPaintProperty('cells-fill', 'fill-opacity', climateOpacity); } catch(_) {}
  }

  document.querySelectorAll('input[name="basemap"]').forEach(input => {
    input.addEventListener('change', () => {
      const bm = input.value;
      if (bm === currentBasemap) return;
      switchBasemap(bm);
      _renderActiveLayers();
    });
  });

  // ===== CONTEXT LAYERS (markup lives in the sidebar, see index.html) =====
  // The cell overlays are mutually exclusive — two feature-state fills on the same
  // cells would muddy each other, so turning one on clears the other.
  document.getElementById('lc-overlay-cb').addEventListener('change', e => {
    if (e.target.checked) { _setHabitatOverlay(false, false); _setLidarOverlay(false); _setTerrainOverlay(false); }
    toggleLcOverlay(e.target.checked);
  });
  document.getElementById('habitat-overlay-cb').addEventListener('change', e => {
    if (e.target.checked) { _setLcOverlay(false); _setLidarOverlay(false); _setTerrainOverlay(false); }
    toggleHabitatOverlay(e.target.checked);
  });
  document.getElementById('lidar-overlay-cb').addEventListener('change', e => {
    if (e.target.checked) { _setLcOverlay(false); _setHabitatOverlay(false); _setTerrainOverlay(false); }
    toggleLidarOverlay(e.target.checked);
  });
  function _setTerrainSelectorVisible(visible) {
    document.getElementById('terrain-var-control')?.classList.toggle('hidden', !visible);
  }
  document.getElementById('terrain-overlay-cb').addEventListener('change', e => {
    if (e.target.checked) { _setLcOverlay(false); _setHabitatOverlay(false); _setLidarOverlay(false); }
    _setTerrainSelectorVisible(e.target.checked);
    toggleTerrainOverlay(e.target.checked);
  });
  document.getElementById('terrain-var').addEventListener('change', e => {
    terrainVar = e.target.value;
    if (terrainOverlayOn) { loadTerrainVar(terrainVar); _renderActiveLayers(); }
  });
  // If the dashboard moves back to a JESS/land-cover composition, do not leave
  // a mismatched habitat map visible.
  document.addEventListener('climascope:variable', e => {
    if (habitatOverlayOn && e.detail?.variable !== 'HABITAT') _setHabitatOverlay(false, false);
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
  // Keep this optional data layer honest when the derived parquet is not mounted.
  (async () => {
    const cb = document.getElementById('habitat-overlay-cb');
    const lbl = cb?.closest('label');
    try {
      const info = await fetch('/api/habitat').then(r => r.json());
      if (!info.available) {
        cb.disabled = true;
        if (lbl) { lbl.style.opacity = '.45'; lbl.title = 'Habitat data not available'; }
      }
    } catch(_) { if (cb) cb.disabled = true; }
  })();

  // Hillshade raster layer — independent base terrain (renders under the data).
  document.getElementById('hillshade-cb').addEventListener('change', e => toggleHillshade(e.target.checked));
  const _hillshadeExportWrap = document.getElementById('hillshade-export');
  const _hillshadeExportBtn = document.getElementById('hillshade-export-btn');
  const _hillshadeExportStatus = document.getElementById('hillshade-export-status');

  function _aoiOverlapsHillshade() {
    if (!aoiGeoJSON?.geometry || !_hillshadeInfo?.bounds) return false;
    const coords = aoiGeoJSON.geometry.type === 'Polygon'
      ? aoiGeoJSON.geometry.coordinates.flat()
      : aoiGeoJSON.geometry.type === 'MultiPolygon'
        ? aoiGeoJSON.geometry.coordinates.flat(2)
        : [];
    if (!coords.length) return false;
    const xs = coords.map(c => c[0]), ys = coords.map(c => c[1]);
    const [w, s, e, n] = _hillshadeInfo.bounds.split(',').map(Number);
    return Math.max(...xs) >= w && Math.min(...xs) <= e
      && Math.max(...ys) >= s && Math.min(...ys) <= n;
  }

  function _updateHillshadeExportControl() {
    const show = Boolean(_hillshadeInfo?.export_available && _aoiOverlapsHillshade());
    _hillshadeExportWrap?.classList.toggle('hidden', !show);
    if (!show && _hillshadeExportStatus) {
      _hillshadeExportStatus.textContent = '';
      _hillshadeExportStatus.classList.remove('error');
    }
    if (_hillshadeExportBtn && show) {
      const maxArea = Number(_hillshadeInfo.export_max_area_km2 || 100);
      _hillshadeExportBtn.title = `Clipped georeferenced GeoTIFF · maximum ${maxArea.toLocaleString()} km²`;
    }
  }

  async function _downloadHillshadeAoi() {
    if (!aoiGeoJSON?.geometry || !_hillshadeExportBtn) return;
    _hillshadeExportBtn.disabled = true;
    _hillshadeExportBtn.textContent = 'Preparing GeoTIFF…';
    if (_hillshadeExportStatus) {
      _hillshadeExportStatus.textContent = 'Full detail · tightly limited export';
      _hillshadeExportStatus.classList.remove('error');
    }
    try {
      const resp = await fetch('/api/terrain/hillshade_export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry: aoiGeoJSON.geometry }),
      });
      if (!resp.ok) {
        const detail = await resp.json().catch(() => ({}));
        throw new Error(detail.error || `Export failed (${resp.status})`);
      }
      _saveBlob(await resp.blob(), 'climascope_hillshade_aoi.tif');
      if (_hillshadeExportStatus) _hillshadeExportStatus.textContent = 'GeoTIFF downloaded';
    } catch (error) {
      if (_hillshadeExportStatus) {
        _hillshadeExportStatus.textContent = error.message;
        _hillshadeExportStatus.classList.add('error');
      }
    } finally {
      _hillshadeExportBtn.disabled = false;
      _hillshadeExportBtn.textContent = '↓ Export AOI GeoTIFF';
    }
  }
  _hillshadeExportBtn?.addEventListener('click', _downloadHillshadeAoi);

  (async () => {
    const cb = document.getElementById('hillshade-cb');
    const lbl = cb?.closest('label');
    try {
      const info = await fetch('/api/terrain/hillshade_info').then(r => r.json());
      if (!info.available) {
        cb.disabled = true;
        if (lbl) { lbl.style.opacity = '.45'; lbl.title = 'Hillshade not available yet'; }
      } else {
        _hillshadeInfo = info;   // { minzoom, maxzoom, bounds:"w,s,e,n" }
        _updateHillshadeExportControl();
      }
    } catch(_) { if (cb) cb.disabled = true; }
  })();
  function _setLcOverlay(on) {
    const cb = document.getElementById('lc-overlay-cb');
    if (cb && cb.checked !== on) { cb.checked = on; toggleLcOverlay(on); }
  }
  function _setHabitatOverlay(on, restoreDashboard = true) {
    const cb = document.getElementById('habitat-overlay-cb');
    if (cb && cb.checked !== on) { cb.checked = on; toggleHabitatOverlay(on, restoreDashboard); }
  }
  function _setLidarOverlay(on) {
    const cb = document.getElementById('lidar-overlay-cb');
    if (cb && cb.checked !== on) { cb.checked = on; toggleLidarOverlay(on); }
  }
  function _setTerrainOverlay(on) {
    const cb = document.getElementById('terrain-overlay-cb');
    if (cb && cb.checked !== on) {
      cb.checked = on;
      _setTerrainSelectorVisible(on);
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
  let _lcScopedActive = false;   // whether lc-fill is currently scope-clipped

  // lc-fill opacity is data-driven (washed-out weak cells, 0 for out-of-scope);
  // scale the whole expression by the slider so the opacity control affects it too.
  function _applyLcOpacity() {
    const base = _lcScopedActive ? LC_SCOPED_OPACITY : LC_FILL_OPACITY;
    try { map.setPaintProperty('lc-fill', 'fill-opacity', ['*', contextOpacity, base]); } catch(_) {}
  }

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
      _lcScopedActive = false;
      _applyLcOpacity();
      _renderLcLegend(null);
      return;
    }
    for (const id of _lcScopeApplied) if (!ids.has(id)) map.setFeatureState(fs(id), { lcs: false });
    for (const id of ids) if (!_lcScopeApplied.has(id)) map.setFeatureState(fs(id), { lcs: true });
    _lcScopeApplied = ids;
    _lcScopedActive = true;
    _applyLcOpacity();
    _renderLcLegend(ids);
  }

  // Dim the climate choropleth while an overlay is on so the two fills don't fight
  function _syncLcDimming() { _applyDataOpacity(); }

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
    if (on) document.dispatchEvent(new CustomEvent('climascope:variable', { detail: { variable: 'LCM' } }));
    _renderActiveLayers();
  }
  // ===== END LAND-COVER OVERLAY =====

  // ===== NATURESCOT HABITAT 2022 OVERLAY =====
  function _applyHabitatStates() {
    if (!_habitatDominant) return;
    const { ids, codes, fracs } = _habitatDominant;
    for (let i = 0; i < ids.length; i++) {
      map.setFeatureState(
        { source: 'cells-vt', sourceLayer: 'cells', id: ids[i] },
        { hab: codes[i], habf: fracs[i] }
      );
    }
  }

  function _renderHabitatLegend(scopeIds) {
    if (!_habitatDominant) return;
    let leg = document.getElementById('habitat-legend');
    if (!leg) {
      leg = document.createElement('div');
      leg.id = 'habitat-legend';
      map.getContainer().appendChild(leg);
    }
    let present = null;
    if (scopeIds) {
      present = new Set();
      const { ids, codes } = _habitatDominant;
      for (let i = 0; i < ids.length; i++) if (scopeIds.has(ids[i])) present.add(codes[i]);
    }
    const rows = _habitatDominant.classes
      .filter(c => !present || present.has(c.group_code))
      .map(c => `<div class="lc-legend-row"><span class="lc-swatch" style="background:${c.color}"></span>${_html(c.group_name)}</div>`)
      .join('');
    leg.innerHTML = `<div class="legend-title">Dominant habitat <span style="opacity:.35;font-weight:400">2022 · 1 km</span></div>${rows}`;
  }

  const HABITAT_SCOPED_OPACITY = ['case', ['boolean', ['feature-state', 'habs'], false], HABITAT_FILL_OPACITY, 0];
  let _habitatScopeApplied = new Set();
  let _habitatScopedActive = false;

  function _applyHabitatOpacity() {
    const base = _habitatScopedActive ? HABITAT_SCOPED_OPACITY : HABITAT_FILL_OPACITY;
    try { map.setPaintProperty('habitat-fill', 'fill-opacity', ['*', contextOpacity, base]); } catch(_) {}
  }

  function _updateHabitatScope() {
    if (!habitatOverlayOn || !map.getLayer('habitat-fill')) return;
    const fs = id => ({ source: 'cells-vt', sourceLayer: 'cells', id });
    const ids = _lcScopeIds();
    if (ids === null) {
      for (const id of _habitatScopeApplied) map.setFeatureState(fs(id), { habs: false });
      _habitatScopeApplied = new Set();
      _habitatScopedActive = false;
      _applyHabitatOpacity();
      _renderHabitatLegend(null);
      return;
    }
    for (const id of _habitatScopeApplied) if (!ids.has(id)) map.setFeatureState(fs(id), { habs: false });
    for (const id of ids) if (!_habitatScopeApplied.has(id)) map.setFeatureState(fs(id), { habs: true });
    _habitatScopeApplied = ids;
    _habitatScopedActive = true;
    _applyHabitatOpacity();
    _renderHabitatLegend(ids);
  }

  async function toggleHabitatOverlay(on, restoreDashboard = true) {
    habitatOverlayOn = on;
    if (on && !_habitatDominant) {
      try {
        const resp = await fetch('/api/habitat/dominant');
        if (!resp.ok) throw new Error(resp.status);
        _habitatDominant = await resp.json();
        if (!_habitatDominant.available) throw new Error('not available');
      } catch(_) {
        habitatOverlayOn = false;
        const cb = document.getElementById('habitat-overlay-cb');
        if (cb) cb.checked = false;
        return;
      }
      map.setPaintProperty('habitat-fill', 'fill-color', buildHabitatFillColor(_habitatDominant.classes));
      _applyHabitatStates();
    }
    try { map.setLayoutProperty('habitat-fill', 'visibility', on ? 'visible' : 'none'); } catch(_) {}
    if (on) _updateHabitatScope();
    _applyDataOpacity();
    const leg = document.getElementById('habitat-legend');
    if (leg) leg.style.display = on ? 'block' : 'none';
    if (on) document.dispatchEvent(new CustomEvent('climascope:variable', { detail: { variable: 'HABITAT' } }));
    else if (restoreDashboard) document.dispatchEvent(new CustomEvent('climascope:variable', { detail: { variable: 'LCM' } }));
    _renderActiveLayers();
  }
  // ===== END NATURESCOT HABITAT 2022 OVERLAY =====

  // ===== LIDAR COVERAGE OVERLAY =====
  function _applyLidarStates() {
    if (!_lidarCov) return;
    const { ids, phases } = _lidarCov;
    for (let i = 0; i < ids.length; i++) {
      map.setFeatureState({ source: 'cells-vt', sourceLayer: 'cells', id: ids[i] }, { lphase: phases[i] });
    }
  }

  function _renderLidarLegend() {
    let leg = document.getElementById('lidar-legend');
    if (!leg) {
      leg = document.createElement('div');
      leg.id = 'lidar-legend';
      map.getContainer().appendChild(leg);
    }
    const legendItems = _lidarCov?.legend || [];
    if (!_lidarEnabled) _lidarEnabled = new Set(legendItems.map(p => p.code));
    const s = _lidarCov?.summary;
    const pct = (s && s.total) ? Math.round(100 * s.any / s.total) : 0;
    const rows = legendItems.map(p =>
      `<label class="lc-legend-row lc-legend-check">`
      + `<input type="checkbox" data-code="${p.code}"${_lidarEnabled.has(p.code) ? ' checked' : ''}>`
      + `<span class="lc-swatch" style="background:${p.color}"></span>${p.label}</label>`
    ).join('');
    leg.innerHTML = `<div class="legend-title">LiDAR by phase `
      + `<span style="opacity:.35;font-weight:400">${pct}% of grid</span></div>${rows}`;
    leg.querySelectorAll('input[type="checkbox"]').forEach(cb =>
      cb.addEventListener('change', () => {
        const code = +cb.dataset.code;
        if (cb.checked) _lidarEnabled.add(code); else _lidarEnabled.delete(code);
        try { map.setPaintProperty('lidar-fill', 'fill-color',
              buildLidarFillColor(_lidarCov.legend, _lidarEnabled)); } catch(_) {}
      }));
  }

  function _syncLidarDimming() { _applyDataOpacity(); }

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
      try { map.setPaintProperty('lidar-fill', 'fill-color', buildLidarFillColor(_lidarCov.legend, _lidarEnabled)); } catch(_) {}
      _applyLidarStates();
      _renderLidarLegend();
    }
    try { map.setLayoutProperty('lidar-fill', 'visibility', on ? 'visible' : 'none'); } catch(_) {}
    _syncLidarDimming();
    const leg = document.getElementById('lidar-legend');
    if (leg) leg.style.display = on ? 'block' : 'none';
    _renderActiveLayers();
  }
  // ===== END LIDAR COVERAGE OVERLAY =====

  // ===== TERRAIN OVERLAY (Phase 1) =====
  const TERRAIN_LABELS = {
    elevation: ['Elevation', 'm'], slope: ['Slope', '°'],
    ruggedness: ['Ruggedness', 'm'], canopy: ['Canopy height', 'm'],
  };
  // Render a complete baseline stack even if the catalogue request later fails.
  _renderActiveLayers();

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

  function _renderTerrainLegend(varId, lo, hi, cov) {
    let leg = document.getElementById('terrain-legend');
    if (!leg) { leg = document.createElement('div'); leg.id = 'terrain-legend'; map.getContainer().appendChild(leg); }
    const [label, units] = TERRAIN_LABELS[varId] || [varId, ''];
    const ramp = TERRAIN_RAMPS[varId] || TERRAIN_RAMPS.slope;
    const grad = `linear-gradient(to right, ${ramp.join(',')})`;
    // LiDAR covers only part of Scotland. Without saying so, a choropleth over
    // 41% of the country reads as a national picture, and the ramp's max reads
    // as the national maximum (it isn't — e.g. Ben Nevis has no LiDAR).
    const partial = cov && cov.coverage_pct != null && cov.coverage_pct < 100;
    const covNote = partial
      ? `<div class="legend-coverage" title="Only cells with LiDAR terrain data are coloured. `
        + `Uncoloured cells have no LiDAR and are not zero — the range below is the range of `
        + `surveyed cells only, not of all Scotland.">`
        + `⚠ Surveyed area only · ${cov.count.toLocaleString()} of ${cov.scope_total.toLocaleString()} cells `
        + `(${cov.coverage_pct}%)</div>`
      : '';
    leg.innerHTML =
      `<div class="legend-title">${label} <span style="opacity:.35;font-weight:400">${units}</span></div>`
      + `<div class="legend-subtitle">LiDAR-derived · 1km</div>`
      + covNote
      + `<div class="legend-ramp" style="background:${grad}"></div>`
      + `<div class="legend-labels"><span>${lo.toFixed(lo<10?1:0)}</span><span>${hi.toFixed(hi<10?1:0)}</span></div>`;
    leg.style.display = 'block';
  }

  function _syncTerrainDimming() { _applyDataOpacity(); }

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
    if (entry.cov === undefined) {
      // National coverage, matching the national ramp below. Cached per var;
      // a failure just omits the caveat rather than blocking the layer.
      try {
        const r = await fetch(`/api/terrain/range?var=${encodeURIComponent(varId)}`);
        entry.cov = r.ok ? await r.json() : null;
      } catch(_) { entry.cov = null; }
    }
    _clearTerrainStates();
    map.setPaintProperty('terrain-fill', 'fill-color', buildTerrainColor(entry.min, entry.max, varId));
    _applyTerrainStates(entry.data);
    _renderTerrainLegend(varId, entry.min, entry.max, entry.cov);
    return true;
  }

  async function toggleTerrainOverlay(on) {
    terrainOverlayOn = on;
    if (on) {
      const ok = await loadTerrainVar(terrainVar);
      if (!ok) {
        terrainOverlayOn = false;
        const cb = document.getElementById('terrain-overlay-cb');
        if (cb) { cb.checked = false; _setTerrainSelectorVisible(false); }
        return;
      }
    }
    try { map.setLayoutProperty('terrain-fill', 'visibility', on ? 'visible' : 'none'); } catch(_) {}
    _syncTerrainDimming();
    const leg = document.getElementById('terrain-legend');
    if (leg) leg.style.display = on ? 'block' : 'none';
    _renderActiveLayers();
  }
  // ===== END TERRAIN OVERLAY =====

  // ===== HILLSHADE RASTER LAYER =====
  function _addHillshadeLayer() {
    if (!map.getSource('terrain-hs')) {
      const src = {
        type: 'raster',
        tiles: [window.location.origin + '/terrain_tiles/{z}/{x}/{y}.png'],
        tileSize: 256,
        // match the mbtiles' real zoom range + footprint so MapLibre never
        // requests tiles that don't exist (avoids 204/decode spam + 429s)
        minzoom: _hillshadeInfo?.minzoom ?? 10,
        maxzoom: _hillshadeInfo?.maxzoom ?? 14,
        attribution: 'Terrain © Scottish Government LiDAR',
      };
      const b = _hillshadeInfo?.bounds;
      if (b) { const p = b.split(',').map(Number); if (p.length === 4) src.bounds = p; }
      map.addSource('terrain-hs', src);
    }
    if (!map.getLayer('terrain-hs-layer')) {
      // insert under the lowest data layer so choropleth/overlays sit on top
      const before = ['grid-fill', 'cells-fill', 'grid-line'].find(id => map.getLayer(id));
      map.addLayer({
        id: 'terrain-hs-layer', type: 'raster', source: 'terrain-hs',
        layout: { visibility: hillshadeOn ? 'visible' : 'none' },
        paint: { 'raster-opacity': hillshadeOpacity },
      }, before);
    } else {
      map.setLayoutProperty('terrain-hs-layer', 'visibility', hillshadeOn ? 'visible' : 'none');
    }
  }

  function toggleHillshade(on) {
    hillshadeOn = on;
    _addHillshadeLayer();
    try { map.setLayoutProperty('terrain-hs-layer', 'visibility', on ? 'visible' : 'none'); } catch(_) {}
    try { map.setPaintProperty('terrain-hs-layer', 'raster-opacity', hillshadeOpacity); } catch(_) {}
    _applyDataOpacity();
    _renderActiveLayers();
    // With the near-national hillshade, fitting its full footprint would zoom
    // away from the user's area. Keep their centre and only move to the first
    // useful tile zoom when the current view is still too far out.
    if (on && _hillshadeInfo?.bounds) {
      const p = _hillshadeInfo.bounds.split(',').map(Number);
      const minz = _hillshadeInfo.minzoom ?? 8;
      if (p.length === 4 && map.getZoom() < minz) {
        const centre = map.getCenter();
        const centreInFootprint = centre.lng >= p[0] && centre.lng <= p[2]
          && centre.lat >= p[1] && centre.lat <= p[3];
        if (centreInFootprint) map.easeTo({ zoom: minz, duration: 700 });
      }
    }
  }
  // ===== END HILLSHADE RASTER LAYER =====

  // ===== PLACE SEARCH =====
  (function() {
    const _srchEl = document.createElement('div');
    _srchEl.id = 'map-search';
    _srchEl.innerHTML =
      '<input type="search" id="search-input" placeholder="Search a place …" aria-label="Search councils, catchments, places, or OS grid references" role="combobox" aria-autocomplete="list" aria-controls="search-results" aria-expanded="false" autocomplete="off">' +
      '<div id="search-results" role="listbox" aria-label="Search results"></div>';
    map.getContainer().appendChild(_srchEl);

    const input   = document.getElementById('search-input');
    const results = document.getElementById('search-results');
    let _debounce = null;
    let _activeSearchIndex = -1;

    function clearResults() {
      results.innerHTML = '';
      results.classList.remove('open');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      _activeSearchIndex = -1;
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

    function _escHtml(s) { return _html(s); }

    // OS grid ref (e.g. "NX3545") -> BNG bbox [minE,minN,maxE,maxN], or null.
    // Handles 1km (4 digits), 10km (2 digits), 100m (6 digits) etc.
    function osRefToBng(q) {
      const ref = String(q).toUpperCase().replace(/\s+/g, '');
      const m = ref.match(/^([A-Z])([A-Z])(\d+)$/);
      if (!m) return null;
      let l1 = m[1].charCodeAt(0) - 65, l2 = m[2].charCodeAt(0) - 65;
      if (l1 === 8 || l2 === 8) return null;         // 'I' is not used
      if (l1 > 8) l1--; if (l2 > 8) l2--;
      const e100 = ((l1 - 2) % 5) * 5 + (l2 % 5);
      const n100 = (19 - Math.floor(l1 / 5) * 5) - Math.floor(l2 / 5);
      if (e100 < 0 || e100 > 6 || n100 < 0 || n100 > 12) return null;
      const digits = m[3];
      if (digits.length % 2) return null;            // must be even (E then N)
      const half = digits.length / 2, mult = Math.pow(10, 5 - half);
      const e = e100 * 100000 + parseInt(digits.slice(0, half), 10) * mult;
      const n = n100 * 100000 + parseInt(digits.slice(half), 10) * mult;
      return [e, n, e + mult, n + mult];
    }

    // STEP 1 — local councils + catchments (in memory from startup, no network).
    // Councils first, then catchments, max 4 of each.
    function _localHits(q) {
      const lower = q.toLowerCase();
      const hits = [];
      const bbox = osRefToBng(q);   // OS tile ref -> show first (most specific)
      if (bbox) hits.push({ kind: 'tile', name: q.toUpperCase().replace(/\s+/g, ''), bbox });
      const councils = (councilsGJ?.features || [])
        .map(f => f.properties.council_name)
        .filter(name => name && name.toLowerCase().includes(lower))
        .slice(0, 4)
        .map(name => ({ kind: 'council', name }));
      const catchments = (catchmentsData || [])
        .filter(c => c.name && c.name.toLowerCase().includes(lower))
        .slice(0, 4)
        .map(c => ({ kind: 'catchment', name: c.name }));
      return hits.concat(councils, catchments);
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
        const label = h.kind === 'tile' ? 'Tile' : h.kind === 'council' ? 'Council' : 'Catchment';
        html += `<div class="search-result">${_escHtml(h.name)}${tag(h.kind, label)}</div>`;
      });
      placeHits.forEach(g => {
        html += `<div class="search-result">${_escHtml(g.NAME1)}${tag('place', 'Place')}</div>`;
      });
      results.innerHTML = html;
      results.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
      _activeSearchIndex = -1;

      results.querySelectorAll('.search-result').forEach((el, idx) => {
        el.setAttribute('role', 'option');
        el.setAttribute('aria-selected', 'false');
        el.id = `search-option-${idx}`;
        el.addEventListener('mousedown', ev => {
          ev.preventDefault();
          clearTimeout(_debounce);
          if (idx < localHits.length) {
            const h = localHits[idx];
            if (h.kind === 'tile') {
              const [e0, n0, e1, n1] = h.bbox;
              const sw = bngToWgs84(e0, n0), ne = bngToWgs84(e1, n1);
              map.fitBounds([[sw[0], sw[1]], [ne[0], ne[1]]], { padding: 180, maxZoom: 13, duration: 900 });
            } else {
              _selectSidebar(h.kind === 'council' ? 'council' : 'catchment', h.name);
            }
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
        const resp = await fetch(`/api/search/places?q=${encodeURIComponent(q)}`);
        if (resp.ok) {
          const data = await resp.json();
          placeHits = (data.results || [])
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

    input.addEventListener('keydown', event => {
      const options = [...results.querySelectorAll('.search-result')];
      if (event.key === 'Escape') { clearResults(); return; }
      if (!options.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Enter') {
        if (_activeSearchIndex >= 0) {
          options[_activeSearchIndex].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        }
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      _activeSearchIndex = (_activeSearchIndex + step + options.length) % options.length;
      options.forEach((option, idx) => {
        const active = idx === _activeSearchIndex;
        option.classList.toggle('active', active);
        option.setAttribute('aria-selected', String(active));
      });
      input.setAttribute('aria-activedescendant', options[_activeSearchIndex].id);
      options[_activeSearchIndex].scrollIntoView({ block: 'nearest' });
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
      paint: { 'fill-color': buildFillColor(), 'fill-opacity': climateOpacity }
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
      paint: { 'fill-antialias': false, 'fill-color': buildFillColorFromFeatureState(-100, 100), 'fill-opacity': climateOpacity }
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

    map.addLayer({
      id: 'habitat-fill', type: 'fill', source: 'cells-vt', 'source-layer': 'cells',
      layout: { visibility: habitatOverlayOn ? 'visible' : 'none' },
      paint: {
        'fill-antialias': false,
        'fill-color': _habitatDominant ? buildHabitatFillColor(_habitatDominant.classes) : 'rgba(0,0,0,0)',
        'fill-opacity': HABITAT_FILL_OPACITY
      }
    });

    // LiDAR coverage overlay — availability tier per cell (see LIDAR COVERAGE OVERLAY)
    map.addLayer({
      id: 'lidar-fill', type: 'fill', source: 'cells-vt', 'source-layer': 'cells',
      layout: { visibility: lidarOverlayOn ? 'visible' : 'none' },
      paint: { 'fill-antialias': false,
               'fill-color': _lidarCov ? buildLidarFillColor(_lidarCov.legend, _lidarEnabled) : 'rgba(0,0,0,0)',
               'fill-opacity': contextOpacity }
    });

    // Terrain overlay — continuous LiDAR-derived values (see TERRAIN OVERLAY)
    map.addLayer({
      id: 'terrain-fill', type: 'fill', source: 'cells-vt', 'source-layer': 'cells',
      layout: { visibility: 'none' },
      paint: { 'fill-antialias': false, 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': contextOpacity }
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

  function showLoading(on) {
    $('loading-bar').classList.toggle('hidden', !on);
    $('map-area').setAttribute('aria-busy', String(on));
  }

  function _showMapUnavailMsg() {
    if (document.getElementById('map-unavail-msg')) return;
    const el = document.createElement('div');
    el.id = 'map-unavail-msg';
    el.innerHTML =
      '<button type="button" class="map-unavail-close" title="Dismiss" aria-label="Dismiss message">×</button>' +
      '<p class="map-unavail-title">Map view not available for CWR</p>' +
      '<p class="map-unavail-sub">Use the Dashboard or Catchment tab to explore CWR data</p>';
    el.querySelector('.map-unavail-close').addEventListener('click', () => el.remove());
    document.getElementById('map-area').appendChild(el);
  }

  function _hideMapUnavailMsg() {
    document.getElementById('map-unavail-msg')?.remove();
  }

  async function _paintAoiFeature(feature, revision = ++_layerLoadRevision) {
    _setCurrentViewData(null);
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
      if (revision !== _layerLoadRevision || !resp.ok) return;
      const gj = await resp.json();
      if (revision !== _layerLoadRevision) return;
      _setCurrentViewData(gj);
      setData(SRC.grid, gj);
      const vals = gj.features.map(f => +f.properties.Change).filter(v => !isNaN(v));
      const dMin = vals.length ? Math.min(...vals) : null;
      const dMax = vals.length ? Math.max(...vals) : null;
      map.setPaintProperty('grid-fill', 'fill-color', buildFillColor(dMin, dMax));
      _lastLayerState = { geojson: gj, dataMin: dMin, dataMax: dMax };
      updateLegend(gj);
      _updateLcScope();
      _updateHabitatScope();
    } catch(err) { console.error('_paintAoiFeature failed:', err); }
    finally { if (revision === _layerLoadRevision) showLoading(false); }
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
        paint:{ 'fill-color': buildFillColor(_lastLayerState.dataMin, _lastLayerState.dataMax), 'fill-opacity': climateOpacity } });
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
        paint:{ 'fill-antialias': false, 'fill-color': buildFillColorFromFeatureState(lastDataRange.min, lastDataRange.max), 'fill-opacity': climateOpacity } });
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

    if (!map.getLayer('habitat-fill'))
      map.addLayer({ id:'habitat-fill', type:'fill', source:'cells-vt', 'source-layer':'cells',
        layout:{ visibility: habitatOverlayOn ? 'visible' : 'none' },
        paint:{ 'fill-antialias': false,
                'fill-color': _habitatDominant ? buildHabitatFillColor(_habitatDominant.classes) : 'rgba(0,0,0,0)',
                'fill-opacity': HABITAT_FILL_OPACITY } });
    else
      map.setLayoutProperty('habitat-fill', 'visibility', habitatOverlayOn ? 'visible' : 'none');
    if (habitatOverlayOn) {
      _applyHabitatStates();
      _habitatScopeApplied = new Set();
      _updateHabitatScope();
      _applyDataOpacity();
    }

    if (!map.getLayer('lidar-fill'))
      map.addLayer({ id:'lidar-fill', type:'fill', source:'cells-vt', 'source-layer':'cells',
        layout:{ visibility: lidarOverlayOn ? 'visible' : 'none' },
        paint:{ 'fill-antialias': false,
                'fill-color': _lidarCov ? buildLidarFillColor(_lidarCov.legend, _lidarEnabled) : 'rgba(0,0,0,0)',
                'fill-opacity': contextOpacity } });
    else
      map.setLayoutProperty('lidar-fill', 'visibility', lidarOverlayOn ? 'visible' : 'none');
    if (lidarOverlayOn) {
      if (_lidarCov) { try { map.setPaintProperty('lidar-fill', 'fill-color', buildLidarFillColor(_lidarCov.legend, _lidarEnabled)); } catch(_) {} }
      _applyLidarStates();            // feature-states dropped on basemap switch
      _syncLidarDimming();
    }

    if (!map.getLayer('terrain-fill'))
      map.addLayer({ id:'terrain-fill', type:'fill', source:'cells-vt', 'source-layer':'cells',
        layout:{ visibility: terrainOverlayOn ? 'visible' : 'none' },
        paint:{ 'fill-antialias': false, 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': contextOpacity } });
    else
      map.setLayoutProperty('terrain-fill', 'visibility', terrainOverlayOn ? 'visible' : 'none');
    if (terrainOverlayOn) {
      _terrainApplied = false;        // feature-states dropped on basemap switch
      loadTerrainVar(terrainVar);
      _syncTerrainDimming();
    }

    _addHillshadeLayer();             // raster source/layer dropped on basemap switch

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
    _applyBasemapOpacity();
    _applyDataOpacity();
    _renderActiveLayers();
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

  function _setRightPanel(collapsed, tab) {
    const rp = $('right-panel');
    const inner = $('right-panel-inner');
    const toggle = $('rp-toggle');
    if (!rp) return;

    const selected = tab || rp.querySelector('.rp-tab.active')?.dataset.tab || 'coverage';
    rp.classList.toggle('rp-collapsed', collapsed);
    if (inner) {
      inner.setAttribute('aria-hidden', String(collapsed));
      inner.toggleAttribute('inert', collapsed);
    }

    rp.querySelectorAll('.rp-tab').forEach(btn => {
      const active = btn.dataset.tab === selected;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
      btn.setAttribute('aria-expanded', String(active && !collapsed));
      btn.tabIndex = active ? 0 : -1;
    });
    const coveragePane = $('coverage-panel');
    const filterPane = $('filter-panel');
    if (coveragePane) coveragePane.classList.toggle('hidden', selected !== 'coverage');
    if (filterPane) filterPane.classList.toggle('hidden', selected !== 'filter');

    if (toggle) {
      toggle.textContent = collapsed ? '‹' : '›';
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', collapsed ? 'Expand analysis panel' : 'Collapse analysis panel');
      toggle.title = collapsed ? 'Expand panel' : 'Collapse panel';
    }
    setTimeout(() => map.resize(), 240);
  }

  function initMode(m, skipLoad = false) {
    mode = m;
    $('mode-explore').classList.toggle('active',   m === 'explore');
    $('mode-dashboard').classList.toggle('active', m === 'dashboard');
    $('mode-explore').setAttribute('aria-pressed', String(m === 'explore'));
    $('mode-dashboard').setAttribute('aria-pressed', String(m === 'dashboard'));

    document.body.classList.toggle('dashboard-mode', m === 'dashboard');

    try { map.setLayoutProperty('grid-fill', 'visibility', 'visible'); } catch(_) {}
    try { map.setLayoutProperty('grid-line', 'visibility', 'visible'); } catch(_) {}

    if (m === 'dashboard') {
      _setRightPanel(true);
      _initDashboard();
    }
    // explore: leave the right panel as-is (collapsed by default; the user
    // opens Coverage/Filter from the persistent dock) — reclaims space up front.
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
      _setRightPanel(!rp.classList.contains('rp-collapsed'));
    });
  }
  document.querySelectorAll('.rp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const rp = $('right-panel');
      const isOpenActive = !rp.classList.contains('rp-collapsed') && btn.classList.contains('active');
      _setRightPanel(isOpenActive, btn.dataset.tab);
    });
    btn.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll('.rp-tab')];
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(tabs.indexOf(btn) + step + tabs.length) % tabs.length];
      _setRightPanel(false, next.dataset.tab);
      next.focus();
    });
  });

  function updateMonthLabel(slider, labelEl) {
    if (slider && labelEl) {
      const month = MONTH_NAMES[+slider.value] || slider.value;
      labelEl.textContent = month;
      slider.setAttribute('aria-valuetext', month);
    }
  }
  let _calendarMonth = Number($('month')?.dataset.calendarDefault || _defaultMonth);
  let _monthWasManuallySelected = false;
  $('month').addEventListener('input', () => {
    _monthWasManuallySelected = true;
    updateMonthLabel($('month'), $('monthLabel'));
    loadLayer(true);
    _emitStateChange();
  });
  // A long-open dashboard follows the calendar only while the user has left
  // Month on its automatic default. A deliberate selection is never replaced.
  setInterval(() => {
    const nextMonth = _ukCalendarMonth();
    if (nextMonth === _calendarMonth) return;
    const slider = $('month');
    const stillAutomatic = !_monthWasManuallySelected || Number(slider?.value) === _calendarMonth;
    _calendarMonth = nextMonth;
    if (!slider || !stillAutomatic) return;
    slider.value = String(nextMonth);
    slider.dataset.calendarDefault = String(nextMonth);
    updateMonthLabel(slider, $('monthLabel'));
    loadLayer(true);
    _emitStateChange();
  }, 60_000);

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
      _renderActiveLayers();

      grid.innerHTML = '';
      catalogue.forEach(m => {
        const avail         = m.available !== false;
        const catchmentOnly = avail && m.map_available === false;
        const mapPeriods    = m.map_available_periods || [];
        const card  = document.createElement('button');
        card.type = 'button';
        card.className = 'metric-card' + (m.id === activeMetric.id ? ' active' : '') + (avail ? '' : ' metric-card--unavailable');
        card.dataset.id = m.id;
        card.disabled = !avail;
        card.setAttribute('role', 'radio');
        card.setAttribute('aria-checked', String(m.id === activeMetric.id));
        card.tabIndex = m.id === activeMetric.id ? 0 : -1;
        card.setAttribute('aria-label', `${m.label || m.short}${avail ? `, ${m.units}` : ', data pending'}`);
        card.title = avail
          ? `${m.label || m.short}. Climate data on Scotland's 1 km grid; units: ${m.units}.`
          : `${m.label || m.short}: data pending`;
        let badgeHtml = '';
        if (catchmentOnly) {
          badgeHtml = mapPeriods.length > 0
            ? `<br><span class="metric-catchment-only">Map: ${mapPeriods.map(_html).join(', ')} only</span>`
            : '<br><span class="metric-catchment-only">Catchment only</span>';
        }
        const unitsHtml = avail
          ? _html(m.units) + badgeHtml
          : '<span class="metric-unavail">pending</span>';
        card.innerHTML =
          '<div class="metric-card-swatch" style="background:'+(SWATCH[m.colorscale]||SWATCH.diverging)+'"></div>'+
          '<div class="metric-card-short">'+_html(m.short)+'</div>'+
          '<div class="metric-card-units">'+unitsHtml+'</div>';
        if (avail) card.addEventListener('click', () => selectMetric(m, card));
        if (avail) card.addEventListener('keydown', e => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault();
          const choices = [...grid.querySelectorAll('.metric-card:not(:disabled)')];
          const offset = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1;
          const next = choices[(choices.indexOf(card) + offset + choices.length) % choices.length];
          const nextMetric = catalogue.find(item => item.id === next?.dataset.id);
          if (next && nextMetric) { selectMetric(nextMetric, next); next.focus(); }
        });
        grid.appendChild(card);
      });

      loadLayer();
      _emitStateChange();
    } catch(e) { console.warn('loadMetrics:', e); }
  }

  function selectMetric(m, cardEl) {
    activeMetric = m;
    document.querySelectorAll('.metric-card').forEach(c => {
      c.classList.remove('active');
      c.setAttribute('aria-checked', 'false');
      c.tabIndex = -1;
    });
    cardEl.classList.add('active');
    cardEl.setAttribute('aria-checked', 'true');
    cardEl.tabIndex = 0;
    updateLayerPaint();
    loadLayer();
    _emitStateChange();
    _renderActiveLayers();
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
      _fitActiveScope();
      if (_clearAoiForScopeChange()) return;
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

    if (_clearAoiForScopeChange()) return;
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
      _fitActiveScope();
      if (_clearAoiForScopeChange()) return;
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

    if (_clearAoiForScopeChange()) return;
    loadLayer();
    _emitStateChange();
  });

  function _clearAoiForScopeChange() {
    if (!aoiGeoJSON && !filterPanel?._aoiGeoJSON) return false;
    if (filterPanel?._clearAoi) {
      filterPanel._clearAoi();
    } else {
      aoiGeoJSON = null;
      document.dispatchEvent(new CustomEvent('climascope:aoi:clear'));
    }
    return true;
  }


  async function loadLayer(debounce = false) {
    if (debounce) {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => loadLayer(false), 300);
      return;
    }

    const revision = ++_layerLoadRevision;
    // A new selection must never leave the previous scope available to the
    // export control while its replacement is loading (or after an error).
    _setCurrentViewData(null);

    if (aoiGeoJSON?.geometry) {
      await _paintAoiFeature(aoiGeoJSON, revision);
      return;
    }

    const metric = activeMetric.id;
    const period = $('period').value || '2050-2079';
    const month  = parseInt($('month').value || _defaultMonth);

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
        if (revision !== _layerLoadRevision) return;
        if (!resp.ok) {
          setData(SRC.grid, emptyFC());
          updateLegend(null);
          return;
        }
        const gj = await resp.json();
        if (revision !== _layerLoadRevision) return;
        _setCurrentViewData(gj);
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
        _updateHabitatScope();
      } catch(e) {
        console.error('loadLayer catchment:', e);
      } finally {
        if (revision === _layerLoadRevision) showLoading(false);
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
      await loadValues(metric, period, month, revision);
      if (revision !== _layerLoadRevision) return;
      _updateLcScope();
      _updateHabitatScope();
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
      if (revision !== _layerLoadRevision) return;
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        console.warn('features error:', err.detail || err.error);
        setData(SRC.grid, emptyFC());
        updateLegend(null);
        return;
      }
      const gj = await resp.json();
      if (revision !== _layerLoadRevision) return;
      _setCurrentViewData(gj);
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
      _updateHabitatScope();
    } catch(e) {
      console.error('loadLayer:', e);
    } finally {
      if (revision === _layerLoadRevision) showLoading(false);
    }
  }

  $('load').onclick = () => loadLayer();

  async function loadValues(metric, period, month, revision) {
    showLoading(true);
    try {
      const memberParam = (activeMember && activeMember !== 'mean') ? `&member=${activeMember}` : '';
      const url  = `/api/values?metric=${metric}&period=${encodeURIComponent(period)}&month=${month}${memberParam}`;
      const resp = await fetch(url);
      if (revision !== _layerLoadRevision) return;
      if (!resp.ok) { updateLegend(null); return; }
      const data = await resp.json();
      if (revision !== _layerLoadRevision) return;
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
      _applyDataOpacity();   // apply current slider value to national cells-fill
    } catch(e) {
      console.error('loadValues:', e);
    } finally {
      if (revision === _layerLoadRevision) showLoading(false);
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
    const scopeLabel = aoiGeoJSON ? 'AOI 1 km cells'
      : activeCouncil ? `${activeCouncil} 1 km cells`
      : activeCatchment ? `${activeCatchment.split(' : ')[0]} 1 km cells`
      : 'Scotland 1 km cells';
    const memberLabel = activeMember && activeMember !== 'mean' ? `Member ${activeMember}` : 'Ensemble mean';
    const valueContext = isBaseline
      ? 'Observed values (1990–2019 baseline)'
      : `${memberLabel} · Change from 1990–2019 baseline`;
    const subtitle = `${scopeLabel} · ${valueContext}`;
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
      legend.innerHTML = `<div class="legend-title">${label} <span style="opacity:.35;font-weight:400">${units}</span></div>
        <div class="legend-subtitle">${subtitle}</div>`;
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
    // Keep the current scope visible while drawing. If drawing is cancelled,
    // users return to exactly the map they started from.
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
    _updateHillshadeExportControl();
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
    _updateHillshadeExportControl();
    _drawActive = false;
    if (map.hasControl(draw)) {
      try { draw.deleteAll(); draw.changeMode('simple_select'); } catch(_) {}
      map.removeControl(draw);
    }
    setData(SRC.aoi, emptyFC());
    map.getCanvas().style.cursor = '';
    _updateLcScope();
    _updateHabitatScope();
    _fitActiveScope();
    loadLayer();
    _emitStateChange();
  });

  function exportCurrentView() {
    const { metric, period, month, member, scope, councilName, catchmentName } = _getMapState();
    if (scope === 'national') {
      alert('National cell export is unavailable. Select a council, catchment, or draw an AOI first.');
      return;
    }
    if (!currentGJ?.features?.length) { alert('No scoped data loaded yet.'); return; }
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
    _saveBlob(blob, `climascope_${metric}_${period}_${month}${memberSuffix}.geojson`);
  }

  const exportBtn = document.createElement('div');
  exportBtn.className = 'section';
  exportBtn.innerHTML = `<button id="btn-export" class="draw-btn" style="width:100%;justify-content:center">
    ⬇&nbsp;&nbsp;Export scoped view (GeoJSON)
  </button>`;
  $('panel-explore').appendChild(exportBtn);
  _currentViewExportBtn = exportBtn.querySelector('#btn-export');
  _currentViewExportBtn.addEventListener('click', exportCurrentView);
  _setCurrentViewData(currentGJ);

  // ----- context-aware popups (localized to the active overlay) -----
  let _lcById = null, _lcCodeName = null, _habitatById = null, _habitatCodeName = null,
      _lidarPhaseById = null, _lidarPhaseName = null;
  function _buildLcLookup() {
    if (!_lcDominant) return;
    _lcById = new Map(); _lcCodeName = new Map(_lcDominant.classes.map(c => [c.lc_code, c.lc_name]));
    _lcDominant.ids.forEach((id, i) => _lcById.set(id, { code: _lcDominant.codes[i], frac: _lcDominant.fracs[i] }));
  }
  function _buildLidarLookup() {
    if (!_lidarCov) return;
    _lidarPhaseById = new Map();
    _lidarCov.ids.forEach((id, i) => _lidarPhaseById.set(id, _lidarCov.phases[i]));
    _lidarPhaseName = new Map((_lidarCov.legend || []).map(p => [p.code, p.label]));
  }
  function _buildHabitatLookup() {
    if (!_habitatDominant) return;
    _habitatById = new Map();
    _habitatCodeName = new Map(_habitatDominant.classes.map(c => [c.group_code, c.group_name]));
    _habitatDominant.ids.forEach((id, i) =>
      _habitatById.set(id, { code: _habitatDominant.codes[i], frac: _habitatDominant.fracs[i] }));
  }
  function _activeContext() {
    if (terrainOverlayOn) return 'terrain';
    if (lidarOverlayOn)   return 'lidar';
    if (habitatOverlayOn) return 'habitat';
    if (lcOverlayOn)      return 'landcover';
    return 'climate';
  }
  function _cellClimateVal(f, id) {
    if (f.properties && 'Change' in f.properties) return +f.properties.Change;
    return _vtValues ? _vtValues[String(id)] : null;
  }

  // one-line summary from in-memory data (no fetch) — for the hover tooltip
  function _ctxSummary(id, climateVal, isBase) {
    const ctx = _activeContext();
    if (ctx === 'terrain') {
      const v = _terrainCache[terrainVar]?.data?.[id];
      const [lab, un] = TERRAIN_LABELS[terrainVar] || [terrainVar, ''];
      return v == null ? `${lab}: no data` : `${lab}: <strong>${v} ${un}</strong>`;
    }
    if (ctx === 'lidar') {
      if (!_lidarPhaseById) _buildLidarLookup();
      const p = _lidarPhaseById?.get(id);
      return p ? `<strong>${_html(_lidarPhaseName.get(p) || 'LiDAR')}</strong>` : 'No LiDAR here';
    }
    if (ctx === 'landcover') {
      if (!_lcById) _buildLcLookup();
      const r = _lcById?.get(id);
      const name = r ? _lcCodeName.get(r.code) : null;
      return name ? `<strong>${_html(name)}</strong> (${Math.round(r.frac * 100)}%)` : 'No land-cover data';
    }
    if (ctx === 'habitat') {
      if (!_habitatById) _buildHabitatLookup();
      const r = _habitatById?.get(id);
      const name = r ? _habitatCodeName.get(r.code) : null;
      return name ? `<strong>${_html(name)}</strong> (${Math.round(r.frac * 100)}%)` : 'No habitat data';
    }
    if (climateVal == null) return `${METRIC_LABELS[activeMetric.id] || activeMetric.id}: N/A`;
    const un = METRIC_UNITS[activeMetric.id] || '';
    const period = $('period')?.value || '';
    const member = activeMember && activeMember !== 'mean' ? `member ${activeMember}` : 'ensemble mean';
    const context = isBase ? 'observed 1990–2019' : `${period}, ${member}`;
    const d = isBase ? `${(+climateVal).toFixed(1)} ${un}` : `${+climateVal >= 0 ? '+' : ''}${(+climateVal).toFixed(1)} ${un}`;
    return `${METRIC_LABELS[activeMetric.id] || activeMetric.id} (${context}): <strong>${d}</strong>`;
  }

  // cache cell_lidar per id so the header tile + body share one request
  const _cellInfoCache = {};
  function _getCellInfo(id) {
    if (!_cellInfoCache[id])
      _cellInfoCache[id] = fetch(`/api/cell_lidar?id_1km=${id}`).then(r => r.json()).catch(() => ({}));
    return _cellInfoCache[id];
  }
  function _loadCellTile(id) {
    _getCellInfo(id).then(d => {
      const el = document.getElementById(`tile-${id}`);
      if (el && d.tile) el.textContent = d.tile;
    });
  }

  function _openCellClick(id, lngLat, climateVal, col, month, isBase) {
    const ctx = _activeContext();
    const header = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">`
      + `<div style="width:10px;height:10px;border-radius:2px;background:${col};flex-shrink:0"></div>`
      + `<strong style="font-size:13px">Cell ${id}</strong>`
      + `<span id="tile-${id}" class="popup-tile"></span></div>`;
    if (ctx === 'climate') {
      const un = METRIC_UNITS[activeMetric.id] || '';
      const period = $('period')?.value || '';
      const member = activeMember && activeMember !== 'mean' ? `Member ${activeMember}` : 'Ensemble mean';
      const context = isBase ? 'Observed 1990–2019' : `${period} · ${member}`;
      const valDisplay = climateVal == null ? 'N/A'
        : isBase ? `${(+climateVal).toFixed(2)} ${un} (observed)`
                 : `${+climateVal >= 0 ? '+' : ''}${(+climateVal).toFixed(2)} ${un} (change)`;
      new maplibregl.Popup({ maxWidth: '320px' }).setLngLat(lngLat).setHTML(`
        <div style="min-width:270px">${header}
          <div style="font-size:11px;opacity:.6;margin-bottom:6px">${MONTH_NAMES[month] || month} &nbsp;·&nbsp; ${context}<br>
            ${METRIC_LABELS[activeMetric.id] || activeMetric.id}: <strong style="color:#e2e8f4">${valDisplay}</strong></div>
          <div id="wet-${id}" style="font-size:11px;opacity:.6;margin-bottom:6px">Soil wetness: loading…</div>
          <canvas id="ts-${id}" width="260" height="110"></canvas>
        </div>`).addTo(map);
      setTimeout(() => { loadTS(id); loadWetness(id); _loadCellTile(id); }, 0);
    } else {
      new maplibregl.Popup({ maxWidth: '300px' }).setLngLat(lngLat).setHTML(
        `<div style="min-width:210px">${header}<div id="ctxbody-${id}" style="font-size:12px;opacity:.85;line-height:1.6">loading…</div></div>`
      ).addTo(map);
      setTimeout(() => { _fillCtxBody(id, ctx); _loadCellTile(id); }, 0);
    }
  }

  async function _fillCtxBody(id, ctx) {
    const el = document.getElementById(`ctxbody-${id}`); if (!el) return;
    if (ctx === 'habitat') {
      if (!_habitatById) _buildHabitatLookup();
      const r = _habitatById?.get(id);
      if (!r) { el.textContent = 'No habitat data'; return; }
      el.innerHTML = `<strong style="color:#a3c95b">Dominant:</strong> ${_html(_habitatCodeName.get(r.code))} (${Math.round(r.frac * 100)}%)`;
      try {
        const comp = await fetch('/api/landuse_composition', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aoi_ids: [id], variable: 'HABITAT' }) }).then(r => r.json());
        const rows = Object.entries(comp).sort((a, b) => b[1] - a[1]).slice(0, 6)
          .map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:12px"><span>${_html(k)}</span><span style="opacity:.65">${v.toFixed(0)}%</span></div>`).join('');
        if (rows) el.innerHTML += `<div style="margin-top:6px">${rows}</div>`;
        el.innerHTML += `<div style="margin-top:7px;font-size:10px;opacity:.5">NatureScot HLCM 2022 · 20 m grouped to 1 km</div>`;
      } catch {}
      return;
    }
    if (ctx === 'landcover') {
      if (!_lcById) _buildLcLookup();
      const r = _lcById?.get(id);
      if (!r) { el.textContent = 'No land-cover data'; return; }
      el.innerHTML = `<strong style="color:#4ade80">Dominant:</strong> ${_html(_lcCodeName.get(r.code))} (${Math.round(r.frac * 100)}%)`;
      try {
        const comp = await fetch('/api/landuse_composition', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aoi_ids: [id], variable: 'LCM' }) }).then(r => r.json());
        const rows = Object.entries(comp).sort((a, b) => b[1] - a[1]).slice(0, 6)
          .map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:12px"><span>${_html(k)}</span><span style="opacity:.65">${v.toFixed(0)}%</span></div>`).join('');
        if (rows) el.innerHTML += `<div style="margin-top:6px">${rows}</div>`;
      } catch {}
      return;
    }
    try {
      const d = await _getCellInfo(id);
      if (ctx === 'terrain') {
        const t = d.terrain;
        if (!t || t.elevation == null) { el.textContent = 'No terrain data for this cell'; return; }
        el.innerHTML = [['Elevation', t.elevation, 'm'], ['Slope', t.slope, '°'], ['Ruggedness', t.ruggedness, ''], ['Canopy height', t.canopy, 'm']]
          .filter(r => r[1] != null)
          .map(([k, v, u]) => `<div style="display:flex;justify-content:space-between;gap:12px"><span>${k}</span><span style="color:#e2e8f4">${v} ${u}</span></div>`).join('');
      } else {
        if (!d.has_lidar) { el.textContent = 'No LiDAR coverage here'; return; }
        const avail = []; if (d.dtm) avail.push('DTM'); if (d.dsm) avail.push('DSM'); if (d.point_cloud) avail.push('point cloud');
        el.innerHTML = (d.collections ? `<div><strong style="color:#7dd3fc">Phase:</strong> ${_html(d.collections)}</div>` : '')
          + `<div style="margin-top:4px"><strong style="color:#7dd3fc">Captured:</strong> ${avail.join(' · ') || '—'}</div>`;
      }
    } catch { el.textContent = 'error'; }
  }

  // Hover tooltip — active-context value, from memory (no fetch). Measure it
  // after rendering and clamp it to the map rather than relying on MapLibre's
  // half-map anchor heuristic, which can clip long text on narrow maps.
  const _hoverTip = document.createElement('div');
  _hoverTip.className = 'hover-tip';
  _hoverTip.hidden = true;
  _hoverTip.setAttribute('aria-hidden', 'true');
  map.getContainer().appendChild(_hoverTip);

  function _positionHoverTip(point) {
    const pad = 8, gap = 10;
    const mapEl = map.getContainer();
    const tipW = _hoverTip.offsetWidth, tipH = _hoverTip.offsetHeight;
    let left = point.x + gap;
    let top  = point.y - tipH - gap;
    if (left + tipW > mapEl.clientWidth - pad) left = point.x - tipW - gap;
    if (top < pad) top = point.y + gap;
    left = Math.max(pad, Math.min(left, mapEl.clientWidth - tipW - pad));
    top  = Math.max(pad, Math.min(top, mapEl.clientHeight - tipH - pad));
    _hoverTip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function _hideHoverTip() {
    _hoverTip.hidden = true;
  }

  function _onCellHover(e) {
    if (_drawActive) { _hideHoverTip(); return; }
    const f = e.features[0];
    // Prefer the real cell ID from properties. Vector-tile cells promote id_1km
    // onto f.id, but AOI/council GeoJSON comes from GeoPandas to_json(), whose
    // feature "id" is the row index (0,1,2…) — using that would look up a
    // nonexistent cell and report "no data" for every hovered cell.
    const rawId = f.properties?.id_1km ?? f.id;
    const id = (rawId != null && isFinite(+rawId)) ? Math.trunc(+rawId) : rawId;
    if (id == null || (f.properties?.catchment_name && f.properties?.id_1km == null)) { _hideHoverTip(); return; }
    const isBase = ($('period')?.value || '') === '1990-2019';
    _hoverTip.innerHTML = `Cell ${id} · ${_ctxSummary(id, _cellClimateVal(f, id), isBase)}`;
    _hoverTip.hidden = false;
    _positionHoverTip(e.point);
    map.getCanvas().style.cursor = 'crosshair';
  }
  function _offCellHover() { _hideHoverTip(); map.getCanvas().style.cursor = ''; }

  function attachPopup() {
    map.on('click', 'grid-fill', e => {
      if (_drawActive) return;
      const f = e.features[0];
      if (f.properties?.catchment_name && f.properties?.id_1km == null) {
        const sel = $('catchment');
        if (sel) { sel.value = f.properties.catchment_name; sel.dispatchEvent(new Event('change')); }
        return;
      }
      const id = f.properties?.id_1km;
      const m  = f.properties?.Month ?? +($('month')?.value || _defaultMonth);
      const rawVal = +(f.properties?.Change ?? 0);
      _openCellClick(id, e.lngLat, rawVal, valueToColor(rawVal), m, ($('period')?.value || '') === '1990-2019');
    });

    map.on('click', 'cells-fill', e => {
      if (_drawActive) return;
      const f = e.features[0];
      const id = f.id;  // promoted from id_1km via promoteId
      const value = _vtValues ? _vtValues[String(id)] : null;
      const col = value != null ? valueToColor(+value) : '#888888';
      _openCellClick(id, e.lngLat, value, col, parseInt($('month')?.value || _defaultMonth), ($('period')?.value || '') === '1990-2019');
    });

    map.on('mousemove', 'grid-fill', _onCellHover);
    map.on('mouseleave', 'grid-fill', _offCellHover);
    map.on('mousemove', 'cells-fill', _onCellHover);
    map.on('mouseleave', 'cells-fill', _offCellHover);

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

  // LiDAR availability + collection/phase + terrain metrics for the clicked cell
  async function loadCellLidar(id) {
    const el = document.getElementById(`lidar-${id}`);
    if (!el) return;
    try {
      const d = await fetch(`/api/cell_lidar?id_1km=${id}`).then(r=>r.json());
      const parts = [];
      if (d.has_lidar) {
        const avail = [];
        if (d.dtm) avail.push('DTM'); if (d.dsm) avail.push('DSM');
        if (d.point_cloud) avail.push('point cloud');
        let s = '<strong style="color:#7dd3fc;opacity:1">LiDAR</strong>';
        if (d.collections) s += ` · ${_html(d.collections)}`;
        if (avail.length) s += `<br><span style="opacity:.7">${avail.join(' · ')}</span>`;
        parts.push(s);
      }
      const t = d.terrain;
      if (t && t.elevation != null) {
        const tp = [`Elev ${t.elevation} m`];
        if (t.slope != null)  tp.push(`Slope ${t.slope}°`);
        if (t.canopy != null) tp.push(`Canopy ${t.canopy} m`);
        parts.push(`<span style="opacity:.8">${tp.join(' · ')}</span>`);
      }
      if (!parts.length) { el.style.display = 'none'; return; }
      el.innerHTML = parts.join('<br>');
    } catch { el.style.display = 'none'; }
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
        _fitScotland();
        if (_clearAoiForScopeChange()) return;
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
    // Avoid requesting/serialising national-scale GeoJSON merely for outlines.
    // The vector-tile mask still shows the filtered result at this scale.
    if (ids.length > 35000) {
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
