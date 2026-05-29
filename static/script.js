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
    center: [-4.2, 56.8],
    zoom: 6.2
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  const _opEl = document.createElement('div');
  _opEl.id = 'opacity-ctrl';
  _opEl.innerHTML = '<label for="layer-opacity">Opacity</label>'
    + '<input type="range" id="layer-opacity" min="0" max="1" step="0.05" value="0.85">';
  map.getContainer().appendChild(_opEl);

  document.getElementById('layer-opacity').addEventListener('input', e => {
    layerOpacity = parseFloat(e.target.value);
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

    // Filter-results highlight layer (independent source)
    map.addSource(SRC.filterCells, { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'filter-cells-fill', type: 'fill', source: SRC.filterCells,
      paint: { 'fill-color': '#60a5fa', 'fill-opacity': 0.5 }
    });
    map.addLayer({
      id: 'filter-cells-line', type: 'line', source: SRC.filterCells,
      paint: { 'line-color': '#60a5fa', 'line-width': 1.5 }
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

    if (!map.getLayer('filter-cells-fill'))
      map.addLayer({ id:'filter-cells-fill', type:'fill', source:SRC.filterCells,
        paint:{ 'fill-color':'#60a5fa', 'fill-opacity':0.5 } });
    if (!map.getLayer('filter-cells-line'))
      map.addLayer({ id:'filter-cells-line', type:'line', source:SRC.filterCells,
        paint:{ 'line-color':'#60a5fa', 'line-width':1.5 } });

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

  $('period').addEventListener('change', () => { loadLayer(); _emitStateChange(); });

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
        const url = `/api/catchments/${encodeURIComponent(activeCatchment)}/features`
                  + `?metric=${metric}&period=${encodeURIComponent(period)}&month=${month}`;
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
      const url  = `/api/councils/${encodeURIComponent(activeCouncil)}/features`
                 + `?metric=${metric}&period=${encodeURIComponent(period)}&month=${month}`;
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
      const url  = `/api/values?metric=${metric}&period=${encodeURIComponent(period)}&month=${month}`;
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
      legend.innerHTML = `<div class="legend-title">${label} <span style="opacity:.35;font-weight:400">${units}</span></div>
        <div class="legend-subtitle">${_isNat ? 'Individual 1km cells' : isBaseline ? 'Observed values (1990-2019 baseline)' : 'Projected change from 1990-2019 baseline'}</div>`;
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
    const subtitle = isNational ? 'Individual 1km cells' : isBaseline ? 'Observed values (1990-2019 baseline)' : 'Projected change from 1990-2019 baseline';
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
    _emitStateChange();
  });

  function exportCurrentView() {
    if (!currentGJ?.features?.length) { alert('No data loaded yet.'); return; }
    const { metric, period, month } = _getMapState();
    const colName = `${metric}_${period}_${month}`;
    const exported = {
      ...currentGJ,
      features: currentGJ.features.map(f => {
        const { Change, ...rest } = f.properties || {};
        return { ...f, properties: { ...rest, [colName]: Change } };
      }),
    };
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `climascope_${metric}_${period}_${month}.geojson`;
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
      const ts = await fetch(`/api/timeseries?metric=${activeMetric.id}&period=${encodeURIComponent(period)}&id_1km=${id}`).then(r=>r.json());
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