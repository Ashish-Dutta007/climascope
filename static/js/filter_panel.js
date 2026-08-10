'use strict';

const _FP_METRICS = [
  { id: 'CWBPT',    label: 'CWB PT' },
  { id: 'CWBPM',    label: 'CWB PM' },
  { id: 'CWRPT',    label: 'CWR PT' },
  { id: 'CWRPM',    label: 'CWR PM' },
  { id: 'Prec_sum', label: 'Precip' },
  { id: 'ETPT_sum', label: 'ET PT' },
  { id: 'ETPM_sum', label: 'ET PM' },
  { id: 'Tmax_mean',label: 'Tmax' },
  { id: 'Tmin_mean',label: 'Tmin' },
];

const _FP_OPERATORS = [
  { id: 'gt',      label: '>'  },
  { id: 'lt',      label: '<'  },
  { id: 'gte',     label: '≥'  },
  { id: 'lte',     label: '≤'  },
  { id: 'between', label: '…'  },
];

const _FP_MO = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _FP_UNITS = {
  CWBPM: 'mm', CWBPT: 'mm', CWRPM: 'mm', CWRPT: 'mm',
  ETPM_sum: 'mm', ETPT_sum: 'mm', Prec_sum: 'mm',
  Tmax_mean: '°C', Tmin_mean: '°C',
};
const _FP_MAX_RULES = 5;

function _fpEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function _fpDownloadUrl(value) {
  const url = String(value ?? '');
  return /^\/download\/[0-9a-f]{8}\/[A-Za-z0-9_.-]+$/.test(url) ? url : '#';
}

// Helper used by upload handler
function _fpCollectCoords(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon')      return geom.coordinates.flat();
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat(2);
  return [];
}

function _fpBoundaryFeature(gj) {
  if (gj?.type === 'FeatureCollection') {
    if (!gj.features?.length) throw new Error('No features found');
    const polygons = [];
    for (const item of gj.features) {
      const geom = item?.geometry;
      if (geom?.type === 'Polygon') polygons.push(geom.coordinates);
      else if (geom?.type === 'MultiPolygon') polygons.push(...geom.coordinates);
      else throw new Error(`Unsupported boundary geometry: ${geom?.type || 'missing'}`);
    }
    return {
      type: 'Feature',
      properties: { source_feature_count: gj.features.length },
      geometry: polygons.length === 1
        ? { type: 'Polygon', coordinates: polygons[0] }
        : { type: 'MultiPolygon', coordinates: polygons },
    };
  }
  if (gj?.type === 'Feature') {
    if (!['Polygon', 'MultiPolygon'].includes(gj.geometry?.type))
      throw new Error(`Unsupported boundary geometry: ${gj.geometry?.type || 'missing'}`);
    return gj;
  }
  if (['Polygon', 'MultiPolygon'].includes(gj?.type))
    return { type: 'Feature', geometry: gj, properties: {} };
  throw new Error('Unsupported format — need Polygon/MultiPolygon');
}

class FilterPanel {
  constructor(containerEl, getMapState) {
    this.el           = containerEl;
    this.getMapState  = getMapState;
    this.rules        = [];
    this.logic        = 'AND';
    this.matchedIds   = null;
    this.maskMode     = 'none';
    this._lastApplied = null;
    this._lastScope   = 'national';
    this._lastMember  = 'mean';
    this._lcItems     = [];
    this._aoiGeoJSON   = null;
    this._aoiCells     = null;
    this._aoiActive    = false;
    this._drawPending  = false;
    this._aoiRevision  = 0;
    this._lastMapState = null;
    this._build();
    this._loadLcItems();

    document.addEventListener('climascope:draw:complete', e => {
      const feat = e.detail?.feature;
      if (feat) this._onDrawComplete(feat);
    });
    document.addEventListener('climascope:draw:disarmed', () => this._onDrawDisarmed());

    window.addEventListener('climascope:filter:maskcleared', () => {
      this.maskMode = 'none';
      this.el.querySelectorAll('[data-mask]').forEach(b =>
        b.classList.toggle('active', b.dataset.mask === 'none'));
      this._updateMaskHint();
    });
  }

  async _loadLcItems() {
    try {
      this._lcItems = await fetch('/api/landcover').then(r => r.json());
      this._renderRules();
    } catch {}
  }

  _build() {
    this.el.innerHTML = `
      <div class="fp-spatial" id="fp-spatial">
        <div class="fp-section-heading">
          <span class="fp-step">1</span>
          <div class="fp-section-copy">
            <strong>Choose an area</strong>
            <span>Draw on the map or upload a boundary</span>
          </div>
          <button type="button" class="fp-clear-btn fp-sp-clear" id="fp-sp-clear" disabled>Clear</button>
        </div>
        <div class="fp-spatial-btns">
          <button type="button" class="fp-sp-btn fp-sp-primary" id="fp-draw-btn" title="Draw a polygon on the map">◻ Draw on map</button>
          <button type="button" class="fp-sp-btn" id="fp-upload-btn" title="Upload GeoJSON or a zipped Shapefile">⬆ Upload boundary</button>
          <input type="file" id="fp-file-input" accept=".geojson,.json,.zip" hidden/>
        </div>
        <div id="fp-sp-status" class="fp-sp-status hidden"></div>
      </div>
      <div class="fp-header">
        <div class="fp-section-heading fp-rules-heading">
          <span class="fp-step">2</span>
          <div class="fp-section-copy">
            <strong>Refine cells</strong>
            <span>Optional rules within the selected scope</span>
          </div>
        </div>
        <div class="fp-logic-row">
          <span class="fp-label">Match</span>
          <div class="fp-toggle" id="fp-logic-toggle">
            <button type="button" class="fp-toggle-btn active" data-logic="AND" title="Match cells where ALL rules are satisfied">AND</button>
            <button type="button" class="fp-toggle-btn" data-logic="OR" title="Match cells where ANY rule is satisfied">OR</button>
          </div>
          <button type="button" class="fp-clear-btn" id="fp-clear-btn">Clear rules</button>
        </div>
        <div class="fp-scope-row">
          <span class="fp-label">Filtering:</span>
          <span class="fp-scope-badge" id="fp-scope-badge">All Scotland</span>
        </div>
      </div>
      <div class="fp-rules" id="fp-rules"></div>
      <div class="fp-add-row">
        <button type="button" class="fp-add-btn" id="fp-add-btn">+ Add rule</button>
      </div>
      <div class="fp-footer">
        <button type="button" class="fp-apply-btn" id="fp-apply-btn">Apply filter</button>
        <div class="fp-cells-row">
          <div class="fp-result" id="fp-result"></div>
          <div id="fp-export-btns" class="fp-export-btns"></div>
        </div>
        <div class="fp-mask-row">
          <span class="fp-label">View</span>
          <div class="fp-toggle" id="fp-mask-toggle">
            <button class="fp-toggle-btn active" data-mask="none">All cells</button>
            <button class="fp-toggle-btn"        data-mask="show">Highlight matched</button>
            <button class="fp-toggle-btn"        data-mask="hide">Hide matched</button>
          </div>
          <span class="fp-mask-hint" id="fp-mask-hint"></span>
        </div>
      </div>
      <div id="fp-jobs-box" class="fp-jobs-box"></div>`;

    this.el.querySelector('#fp-draw-btn').addEventListener('click', () => this._startDraw());
    this.el.querySelector('#fp-upload-btn').addEventListener('click', () =>
      this.el.querySelector('#fp-file-input').click());
    this.el.querySelector('#fp-file-input').addEventListener('change', e => {
      if (e.target.files[0]) this._handleUpload(e.target.files[0]);
      e.target.value = '';
    });
    this.el.querySelector('#fp-sp-clear').addEventListener('click', () => this._clearAoi());

    this.el.querySelector('#fp-logic-toggle').addEventListener('click', e => {
      const btn = e.target.closest('[data-logic]');
      if (!btn) return;
      if (this.logic === btn.dataset.logic) return;
      this.logic = btn.dataset.logic;
      this.el.querySelectorAll('[data-logic]').forEach(b =>
        b.classList.toggle('active', b.dataset.logic === this.logic));
      this._invalidateAppliedResults();
    });

    this.el.querySelector('#fp-mask-toggle').addEventListener('click', e => {
      const btn = e.target.closest('[data-mask]');
      if (!btn) return;
      this.maskMode = btn.dataset.mask;
      this.el.querySelectorAll('[data-mask]').forEach(b =>
        b.classList.toggle('active', b.dataset.mask === this.maskMode));
      this._updateMaskHint();
      this._dispatchMask();
    });

    this.el.querySelector('#fp-add-btn').addEventListener('click', () => this._addRule());
    this.el.querySelector('#fp-clear-btn').addEventListener('click', () => this._clear());
    this.el.querySelector('#fp-apply-btn').addEventListener('click', () => this._apply());
    this._addRule();
    this._updateExportControls();
  }


  _startDraw() {
    this._drawPending = true;
    const btn = this.el.querySelector('#fp-draw-btn');
    if (btn) btn.classList.add('active');
    this._setSpStatus('Click map to draw polygon. Double-click to finish.', 'hint');
    document.dispatchEvent(new CustomEvent('climascope:draw:arm'));
  }

  _onDrawComplete(feature) {
    this._drawPending = false;
    const btn = this.el.querySelector('#fp-draw-btn');
    if (btn) btn.classList.remove('active');
    this._setAoi(feature, 'drawn polygon');
  }

  _onDrawDisarmed() {
    if (!this._drawPending) return;
    this._drawPending = false;
    const btn = this.el.querySelector('#fp-draw-btn');
    if (btn) btn.classList.remove('active');
    if (!this._aoiGeoJSON) this._setSpStatus('', null);
  }

  async _handleUpload(file) {
    this._setSpStatus('Reading file…', 'hint');
    try {
      let gj;
      if (file.name.endsWith('.zip')) {
        const buf = await file.arrayBuffer();
        gj = await shp(buf);
      } else {
        const text = await file.text();
        gj = JSON.parse(text);
      }
      const feature = _fpBoundaryFeature(gj);

      const coords = _fpCollectCoords(feature.geometry);
      let bbox = null;
      if (coords.length) {
        const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1]);
        bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
      }
      document.dispatchEvent(new CustomEvent('climascope:aoi:update', { detail: { geojson: feature, bbox } }));
      const count = Number(feature.properties?.source_feature_count || 1);
      const label = count > 1 ? `${file.name} (${count} features)` : file.name;
      this._setAoi(feature, label);
    } catch(e) {
      this._setSpStatus('✗ ' + e.message, 'error');
    }
  }

  async _setAoi(feature, name) {
    const revision = ++this._aoiRevision;
    this._aoiGeoJSON = feature;
    this._setSpStatus('Computing cells…', 'hint');
    const ids = await this._resolveAoiCells(feature);
    if (revision !== this._aoiRevision) return;
    if (ids !== null) {
      this._invalidateAppliedResults();
      this._aoiCells  = ids;
      this._aoiActive = true;
      const clearBtn  = this.el.querySelector('#fp-sp-clear');
      if (clearBtn) clearBtn.disabled = false;
      this._setSpStatus(`✓ ${name} · ${ids.length.toLocaleString()} cells`, 'ok');
      this._updateScopeBadge();
      this._updateExportControls();
      // Scope string stays 'aoi' when redrawing, so onMapStateChange won't fire;
      // refresh terrain ranges here so they track the new area.
      this._refreshTerrainRanges();
      document.dispatchEvent(new CustomEvent('climascope:aoi:ready', { detail: { feature } }));
    } else {
      this._aoiCells  = null;
      this._aoiActive = false;
      this._setSpStatus('✗ Could not resolve AOI cells', 'error');
    }
  }

  async _resolveAoiCells(feature) {
    try {
      const resp = await fetch('/api/aoi/cells', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ geometry: feature.geometry }),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.ids;
    } catch { return null; }
  }

  _clearAoi() {
    this._aoiRevision += 1;
    this._aoiGeoJSON  = null;
    this._aoiCells    = null;
    this._aoiActive   = false;
    this._drawPending = false;
    document.dispatchEvent(new CustomEvent('climascope:draw:disarm'));
    document.dispatchEvent(new CustomEvent('climascope:aoi:clear'));
    const clearBtn = this.el.querySelector('#fp-sp-clear');
    const drawBtn  = this.el.querySelector('#fp-draw-btn');
    if (clearBtn) clearBtn.disabled = true;
    if (drawBtn)  drawBtn.classList.remove('active');
    this._setSpStatus('', null);
    this._updateScopeBadge();
    this._updateExportControls();
    this._refreshTerrainRanges();
  }

  _setSpStatus(msg, type) {
    const el = this.el.querySelector('#fp-sp-status');
    if (!el) return;
    if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.classList.remove('hidden');
    el.textContent = msg;
    el.className = 'fp-sp-status' + (type === 'error' ? ' fp-sp-error' : type === 'ok' ? ' fp-sp-ok' : '');
  }


  async _runZonalStats() {
    if (!this._aoiGeoJSON) return;
    const jobsBox = this.el.querySelector('#fp-jobs-box');
    const wrap    = this.el.querySelector('#fp-export-btns');
    if (wrap) wrap.innerHTML = '<button class="fp-export-btn" disabled>⏳ Running…</button>';

    const state   = this.getMapState();
    const payload = {
      aoi_geojson: this._aoiGeoJSON,
      metric:    state.metric,
      period:    state.period,
      month:     state.month,
      operation: 'zonal_stats',
    };

    try {
      const resp = await fetch('/api/jobs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const out = await resp.json();
      this._addJobCard(jobsBox, out, state);
    } catch(e) {
      this._addJobCard(jobsBox, { status:'error', error: e.message });
    } finally {
      this._updateExportControls();
    }
  }

  _addJobCard(container, out, state) {
    if (!container) return;
    const card = document.createElement('div');
    card.className = 'fp-job-card';
    if (out.status === 'done') {
      const s  = out.stats;
      const ts = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
      let contextLine = '';
      if (state) {
        const m     = _FP_METRICS.find(x => x.id === state.metric);
        const label = m ? m.label : state.metric;
        const units = _FP_UNITS[state.metric] || '';
        const mo    = _FP_MO[state.month] || state.month;
        contextLine = `${_fpEsc(label)}${units ? ` (${_fpEsc(units)})` : ''} — Period: ${_fpEsc(state.period)} · Month: ${_fpEsc(mo)}<br>`;
      }
      card.innerHTML = `
        <strong>AOI analysis · ${ts}</strong><br>
        ${contextLine}Mean: ${s.weighted_mean_change_mm.toFixed(2)} &nbsp;·&nbsp; Min: ${s.min_change_mm.toFixed(1)} &nbsp;·&nbsp; Max: ${s.max_change_mm.toFixed(1)} &nbsp;·&nbsp; Cells: ${s.n_cells ?? '?'}<br>
        <div class="fp-job-links">
          <a class="fp-job-dl" href="${_fpDownloadUrl(out.files?.csv)}"        target="_blank" rel="noopener">⬇ CSV</a>
          <a class="fp-job-dl" href="${_fpDownloadUrl(out.files?.geojson)}"    target="_blank" rel="noopener">⬇ GeoJSON</a>
          <a class="fp-job-dl" href="${_fpDownloadUrl(out.files?.provenance)}" target="_blank" rel="noopener">⬇ Prov</a>
        </div>`;
    } else {
      card.innerHTML = `<span class="fp-job-error">Error: ${_fpEsc(out.error || JSON.stringify(out))}</span>`;
    }
    container.prepend(card);
  }

  _updateScopeBadge() {
    const badge = this.el.querySelector('#fp-scope-badge');
    if (!badge) return;
    const s = this._lastMapState;
    const memberSuffix = (s?.member && s.member !== 'mean') ? ` · Member ${s.member}` : '';
    if (this._aoiActive && this._aoiCells) {
      badge.textContent = `AOI (${this._aoiCells.length.toLocaleString()} cells)${memberSuffix}`;
    } else {
      if (s?.catchmentName)   badge.textContent = s.catchmentName.split(' : ')[0] + memberSuffix;
      else if (s?.councilName) badge.textContent = s.councilName + memberSuffix;
      else                      badge.textContent = 'All Scotland' + memberSuffix;
    }
  }


  onMapStateChange(state) {
    this._lastMapState = state;
    // Update scope badge (AOI overrides when active)
    this._updateScopeBadge();

    // Invalidate results when scope or member changes
    if (state.scope !== this._lastScope || state.member !== this._lastMember) {
      this._lastScope  = state.scope;
      this._lastMember = state.member;
      this._invalidateAppliedResults(false);
      // Re-fetch range hints for all rules with new scope/member
      this.rules.forEach((_, i) => {
        this.rules[i].rangeMin = null;
        this.rules[i].rangeMax = null;
      });
      this._renderRules();
      this.rules.forEach((_, i) => this._fetchRange(i));
    }

    // Sync first auto-rule to map metric/period/month
    if (this.rules.length > 0 && !this.rules[0]._userEdited) {
      const r = this.rules[0];
      if (r.metric !== state.metric || r.period !== state.period || r.month !== state.month) {
        this._invalidateAppliedResults();
        r.metric   = state.metric;
        r.period   = state.period;
        r.month    = state.month;
        r.rangeMin = null;
        r.rangeMax = null;
        this._renderRules();
        this._fetchRange(0);
      }
    }
  }

  _addRule() {
    if (this.rules.length >= _FP_MAX_RULES) return;
    this._invalidateAppliedResults();
    const s = this.getMapState();
    this.rules.push({
      type:        'climate',
      metric:      s.metric || 'CWBPT',
      period:      s.period || '2050-2079',
      month:       s.month || Number(document.getElementById('month')?.value) || new Date().getMonth() + 1,
      operator:    'lt',
      value:       '',
      valueB:      '',
      rangeMin:    null,
      rangeMax:    null,
      lc_class:    '',
      threshold:   50,
      _userEdited: false,
    });
    this._renderRules();
    this._fetchRange(this.rules.length - 1);
  }

  _removeRule(idx) {
    this._invalidateAppliedResults();
    this.rules.splice(idx, 1);
    this._renderRules();
  }

  _renderRules() {
    const container = this.el.querySelector('#fp-rules');
    if (!container) return;
    const addBtn = this.el.querySelector('#fp-add-btn');
    if (addBtn) addBtn.disabled = this.rules.length >= _FP_MAX_RULES;

    container.innerHTML = '';
    this.rules.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'fp-rule-row';

      const isLC = r.type === 'landcover';
      const isTerr = r.type === 'terrain';

      const typeOpts =
        `<option value="climate"${(!isLC && !isTerr) ? ' selected' : ''}>Climate</option>` +
        `<option value="landcover"${isLC ? ' selected' : ''}>Landcover</option>` +
        `<option value="terrain"${isTerr ? ' selected' : ''}>Terrain (LiDAR)</option>`;

      let bodyHtml;
      if (isTerr) {
        const tvOpts = [['elevation','Elevation (m)'],['slope','Slope (°)'],['ruggedness','Ruggedness'],['canopy','Canopy (m)']]
          .map(([v,l]) => `<option value="${v}"${v === r.terrain_var ? ' selected' : ''}>${l}</option>`).join('');
        const opOpts = _FP_OPERATORS.map(op =>
          `<option value="${op.id}"${op.id === r.operator ? ' selected' : ''}>${op.label}</option>`).join('');
        const valHtml = r.operator === 'between'
          ? `<input class="fp-val" type="number" step="any" data-key="value"  placeholder="lo" value="${r.value}">` +
            `<span class="fp-between-sep">–</span>` +
            `<input class="fp-val" type="number" step="any" data-key="valueB" placeholder="hi" value="${r.valueB}">`
          : `<input class="fp-val fp-val-single" type="number" step="any" data-key="value" value="${r.value}">`;
        const tRangeText = (r.rangeMin != null && r.rangeMax != null)
          ? `data range: ${r.rangeMin.toFixed(1)} – ${r.rangeMax.toFixed(1)}`
          : 'LiDAR-derived, 1km cell mean';
        const tHintId = r.rangeMin == null ? `id="fp-rh-${i}"` : '';
        bodyHtml = `
          <div class="fp-rule-bot">
            <select class="fp-sel" data-key="terrain_var" style="flex:1">${tvOpts}</select>
            <select class="fp-sel fp-op-sel" data-key="operator">${opOpts}</select>
          </div>
          <div class="fp-rule-bot">${valHtml}</div>
          <div class="fp-rule-hint" ${tHintId} title="LiDAR-derived, 1km cell mean. Data range across cells in the current scope that have LiDAR terrain data.">${tRangeText}</div>`;
      } else if (isLC) {
        const lcOpts = this._lcItems.map(it =>
          `<option value="${it.lc_name}"${it.lc_name === r.lc_class ? ' selected' : ''}>${it.lc_name}</option>`
        ).join('');
        bodyHtml = `
          <div class="fp-rule-bot">
            <select class="fp-sel fp-lc-sel" data-key="lc_class" style="flex:1">${lcOpts}</select>
            <span class="fp-between-sep">≥</span>
            <input class="fp-val" type="number" min="0" max="100" step="1" data-key="threshold"
                   value="${r.threshold}" style="width:44px" placeholder="50"
                   title="Cells where this class makes up at least this % of the cell area. Use 0 to include any presence.">
            <span class="fp-between-sep">%</span>
          </div>
          <div class="fp-rule-hint">fraction of 1km cell covered by this LC class</div>`;
      } else {
        const isBetween = r.operator === 'between';
        const mOpts = _FP_METRICS.map(m =>
          `<option value="${m.id}"${m.id === r.metric ? ' selected' : ''}>${m.label}</option>`
        ).join('');
        const pOpts =
          `<option value="1990-2019"${r.period === '1990-2019' ? ' selected' : ''}>1990–2019</option>` +
          `<option value="2020-2049"${r.period === '2020-2049' ? ' selected' : ''}>2020–49</option>` +
          `<option value="2050-2079"${r.period === '2050-2079' ? ' selected' : ''}>2050–79</option>`;
        const moOpts = Array.from({length: 12}, (_, k) =>
          `<option value="${k+1}"${(k+1) === +r.month ? ' selected' : ''}>${_FP_MO[k+1]}</option>`
        ).join('');
        const opOpts = _FP_OPERATORS.map(op =>
          `<option value="${op.id}"${op.id === r.operator ? ' selected' : ''}>${op.label}</option>`
        ).join('');
        const rangeText = (r.rangeMin != null && r.rangeMax != null)
          ? `data range: ${r.rangeMin.toFixed(1)} – ${r.rangeMax.toFixed(1)}`
          : '';
        const hintId = r.rangeMin == null ? `id="fp-rh-${i}"` : '';
        const valHtml = isBetween
          ? `<input class="fp-val" type="number" step="any" data-key="value"  placeholder="lo" value="${r.value}">` +
            `<span class="fp-between-sep">–</span>` +
            `<input class="fp-val" type="number" step="any" data-key="valueB" placeholder="hi" value="${r.valueB}">`
          : `<input class="fp-val fp-val-single" type="number" step="any" data-key="value" value="${r.value}">`;

        bodyHtml = `
          <div class="fp-rule-bot">
            <select class="fp-sel fp-metric-sel" data-key="metric">${mOpts}</select>
            <select class="fp-sel fp-period-sel" data-key="period">${pOpts}</select>
            <select class="fp-sel fp-month-sel"  data-key="month">${moOpts}</select>
          </div>
          <div class="fp-rule-bot">
            <select class="fp-sel fp-op-sel" data-key="operator">${opOpts}</select>
            ${valHtml}
          </div>
          <div class="fp-rule-hint" ${hintId} title="Full data range across all cells for this metric/period/month">${rangeText}</div>`;
      }

      row.innerHTML = `
        <div class="fp-rule-top">
          <select class="fp-sel fp-type-sel" data-key="type">${typeOpts}</select>
          <button class="fp-remove-btn" title="Remove rule">×</button>
        </div>
        ${bodyHtml}`;

      row.querySelector('.fp-remove-btn').addEventListener('click', () => this._removeRule(i));

      row.querySelectorAll('.fp-sel').forEach(sel => {
        sel.addEventListener('change', e => {
          this._invalidateAppliedResults();
          const key = e.target.dataset.key;
          this.rules[i][key] = key === 'month' ? parseInt(e.target.value) : e.target.value;
          this.rules[i]._userEdited = true;
          if (key === 'type') {
            this.rules[i].rangeMin = null;
            this.rules[i].rangeMax = null;
            if (e.target.value === 'terrain') {
              const rr = this.rules[i];
              rr.terrain_var = rr.terrain_var || 'elevation';
              rr.operator = rr.operator || 'gt';
            }
            this._renderRules();
            this._fetchRange(i);
          } else if (key === 'terrain_var') {
            this.rules[i].rangeMin = null;
            this.rules[i].rangeMax = null;
            this._renderRules();
            this._fetchTerrainRange(i);
          } else if (['metric', 'period', 'month'].includes(key)) {
            this.rules[i].rangeMin = null;
            this.rules[i].rangeMax = null;
            this._renderRules();
            this._fetchRange(i);
          } else if (key === 'operator') {
            this._renderRules();
          }
        });
      });

      row.querySelectorAll('.fp-val').forEach(inp => {
        inp.addEventListener('input', e => {
          this._invalidateAppliedResults();
          this.rules[i][e.target.dataset.key] = e.target.value;
          this.rules[i]._userEdited = true;
        });
      });

      container.appendChild(row);
    });
  }

  async _fetchRange(idx) {
    const r = this.rules[idx];
    if (!r) return;
    if (r.type === 'terrain') return this._fetchTerrainRange(idx);
    if (r.type === 'landcover') return;
    const { metric, period, month } = r;
    const state  = this.getMapState();
    const scope  = state.scope;
    const member = state.member || 'mean';
    const memberParam = member !== 'mean' ? `&member=${encodeURIComponent(member)}` : '';
    try {
      const resp = await fetch(
        `/api/filter/range?metric=${encodeURIComponent(metric)}&period=${encodeURIComponent(period)}&month=${month}&scope=${encodeURIComponent(scope)}${memberParam}`
      );
      if (!resp.ok) return;
      const data = await resp.json();
      const cur = this.rules[idx];
      if (!cur || cur.metric !== metric || cur.period !== period || cur.month !== month) return;
      cur.rangeMin = data.min;
      cur.rangeMax = data.max;
      const span = this.el.querySelector(`#fp-rh-${idx}`);
      if (span) {
        span.textContent = `data range: ${data.min.toFixed(1)} – ${data.max.toFixed(1)}`;
        span.removeAttribute('id');
      }
    } catch {}
  }

  _refreshTerrainRanges() {
    const idxs = this.rules
      .map((r, i) => (r.type === 'terrain' ? i : -1))
      .filter(i => i >= 0);
    if (!idxs.length) return;
    idxs.forEach(i => { this.rules[i].rangeMin = null; this.rules[i].rangeMax = null; });
    this._renderRules();
    idxs.forEach(i => this._fetchTerrainRange(i));
  }

  async _fetchTerrainRange(idx) {
    const r = this.rules[idx];
    if (!r || r.type !== 'terrain') return;
    const tvar  = r.terrain_var || 'elevation';
    const state = this.getMapState();
    // Post the AOI cell IDs so a drawn/uploaded area reports its own range;
    // otherwise the council/catchment/national scope string is enough.
    const payload = { var: tvar, scope: state.scope };
    if (state.scope === 'aoi' && state.aoiCells?.length) payload.ids = state.aoiCells;
    try {
      const resp = await fetch('/api/terrain/range', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const cur = this.rules[idx];
      if (!cur || cur.type !== 'terrain' || (cur.terrain_var || 'elevation') !== tvar) return;
      const span = this.el.querySelector(`#fp-rh-${idx}`);
      if (data.min == null || data.max == null) {
        cur.rangeMin = null;
        cur.rangeMax = null;
        if (span) {
          span.textContent = 'no LiDAR terrain data here — this rule will match 0 cells';
          span.classList.add('fp-hint-partial');
          span.title = 'None of the cells in the current scope have LiDAR terrain data.';
        }
        return;
      }
      cur.rangeMin = data.min;
      cur.rangeMax = data.max;
      if (span) {
        const units = data.units ? ` ${data.units}` : '';
        const pct   = data.coverage_pct;
        // LiDAR is partial, so state the coverage the range came from — a bare
        // range reads as if it described every cell in view.
        const cov = (data.scope_total && pct != null)
          ? ` · from ${data.count.toLocaleString()} of ${data.scope_total.toLocaleString()} cells with LiDAR (${pct}%)`
          : '';
        span.textContent =
          `data range: ${data.min.toFixed(1)} – ${data.max.toFixed(1)}${units}${cov}`;
        span.classList.toggle('fp-hint-partial', pct != null && pct < 100);
        span.title = (pct != null && pct < 100)
          ? `Range covers only the ${data.count.toLocaleString()} cells here that have LiDAR terrain data `
            + `(${pct}% of ${data.scope_total.toLocaleString()}). Cells without LiDAR are excluded from this `
            + `range and cannot match a terrain rule.`
          : 'Range across all cells in the current scope.';
        span.removeAttribute('id');
      }
    } catch {}
  }

  async _apply() {
    const btn      = this.el.querySelector('#fp-apply-btn');
    const resultEl = this.el.querySelector('#fp-result');
    if (!this.rules.length) { resultEl.textContent = 'Add at least one rule.'; return; }

    const rules = [];
    for (let i = 0; i < this.rules.length; i++) {
      const r = this.rules[i];
      if (r.type === 'landcover') {
        if (!r.lc_class) { resultEl.textContent = `Rule ${i+1}: select a landcover class.`; return; }
        const thr = parseFloat(r.threshold);
        if (isNaN(thr) || thr < 0 || thr > 100) { resultEl.textContent = `Rule ${i+1}: threshold must be 0–100.`; return; }
        rules.push({ type: 'landcover', lc_class: r.lc_class, threshold: thr });
      } else if (r.type === 'terrain') {
        const base = { type: 'terrain', terrain_var: r.terrain_var || 'elevation', operator: r.operator };
        if (r.operator === 'between') {
          const lo = parseFloat(r.value), hi = parseFloat(r.valueB);
          if (isNaN(lo) || isNaN(hi)) { resultEl.textContent = `Rule ${i+1}: enter two numbers for between.`; return; }
          base.value = [lo, hi];
        } else {
          const v = parseFloat(r.value);
          if (isNaN(v)) { resultEl.textContent = `Rule ${i+1}: enter a number.`; return; }
          base.value = v;
        }
        rules.push(base);
      } else {
        const base = { type: 'climate', metric: r.metric, period: r.period, month: parseInt(r.month), operator: r.operator };
        if (r.operator === 'between') {
          const lo = parseFloat(r.value), hi = parseFloat(r.valueB);
          if (isNaN(lo) || isNaN(hi)) { resultEl.textContent = `Rule ${i+1}: enter two numbers for between.`; return; }
          base.value = [lo, hi];
        } else {
          const v = parseFloat(r.value);
          if (isNaN(v)) { resultEl.textContent = `Rule ${i+1}: enter a number.`; return; }
          base.value = v;
        }
        rules.push(base);
      }
    }

    btn.disabled    = true;
    btn.textContent = 'Running…';
    resultEl.textContent = '';

    try {
      const mapState   = this.getMapState();
      const underlying = mapState.scope;
      const scope      = this._aoiActive ? 'aoi' : underlying;
      const member     = mapState.member || 'mean';
      const body       = { rules, logic: this.logic, scope, member };
      if (this._aoiActive && this._aoiCells) body.aoi_ids = this._aoiCells;
      const resp = await fetch('/api/filter/query', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) { resultEl.textContent = data.error || `Error ${resp.status}`; return; }
      this.matchedIds = data.matched_ids;
      this._lastApplied = { rules, logic: this.logic, scope, member };
      if (this._aoiActive && this._aoiCells) this._lastApplied.aoi_ids = this._aoiCells;
      resultEl.innerHTML = `<span class="fp-match-count">${this.matchedIds.length.toLocaleString()} cells matched</span>`;
      // Auto-activate "Highlight matched" after every Apply
      this.maskMode = 'show';
      this.el.querySelectorAll('[data-mask]').forEach(b =>
        b.classList.toggle('active', b.dataset.mask === 'show'));
      this._updateMaskHint();
      this._dispatchMask();
      document.dispatchEvent(new CustomEvent('climascope:filter:zoom', { detail: { ids: this.matchedIds } }));
      this._updateExportControls();
    } catch (e) {
      resultEl.textContent = e.message;
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Apply filter';
    }
  }

  _updateMaskHint() {
    const hint = this.el.querySelector('#fp-mask-hint');
    if (!hint) return;
    hint.textContent = (this.matchedIds && this.maskMode !== 'none')
      ? `${this.matchedIds.length.toLocaleString()} ids`
      : '';
  }

  _invalidateAppliedResults(showMessage = true) {
    const hadApplied = this.matchedIds !== null || this._lastApplied !== null;
    this.matchedIds   = null;
    this._lastApplied = null;
    this.maskMode     = 'none';
    this.el.querySelectorAll('[data-mask]').forEach(b =>
      b.classList.toggle('active', b.dataset.mask === 'none'));
    const resultEl = this.el.querySelector('#fp-result');
    if (resultEl) {
      resultEl.textContent = hadApplied && showMessage
        ? 'Rules changed — apply filter again.'
        : '';
    }
    this._dispatchMask();
    this._updateExportControls();
  }

  _dispatchMask() {
    document.dispatchEvent(new CustomEvent('climascope:filter:mask', {
      detail: { ids: this.matchedIds, mode: this.maskMode }
    }));
    // Cell outline layer follows the mask: show outlines only when highlighting
    document.dispatchEvent(new CustomEvent('climascope:filter:cells', {
      detail: { ids: this.maskMode === 'show' ? this.matchedIds : null }
    }));
  }

  _clear() {
    this.rules      = [];
    this.matchedIds = null;
    this.maskMode   = 'none';
    this.el.querySelectorAll('[data-mask]').forEach(b =>
      b.classList.toggle('active', b.dataset.mask === 'none'));
    this.el.querySelector('#fp-result').textContent = '';
    this._lastApplied = null;
    this._addRule();
    this._dispatchMask();
    this._updateExportControls();
  }

  /* Trigger a file download from a blob.
     The anchor MUST be in the document: Firefox ignores click() on a detached
     element, so downloads silently did nothing there. The object URL must also
     outlive the click — revoking it synchronously races the browser starting
     the download and can cancel it. */
  _saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 30000);
  }

  _exportError(msg) {
    const resultEl = this.el.querySelector('#fp-result');
    if (resultEl) resultEl.textContent = msg;
  }

  async _downloadAoiExport(fmt) {
    if (!this._aoiCells) return;
    const wrap = this.el.querySelector('#fp-export-btns');
    if (wrap) wrap.innerHTML = '<button class="fp-export-btn" disabled>⏳ …</button>';
    try {
      const state = this.getMapState();
      const resp = await fetch('/api/aoi/export', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          aoi_ids: this._aoiCells,
          metric:  state.metric,
          period:  state.period,
          month:   state.month,
          ...(state.member && state.member !== 'mean' ? { member: state.member } : {}),
          fmt,
        }),
      });
      if (!resp.ok) {
        // Was a silent return — a failed export looked identical to a working one.
        const detail = await resp.json().catch(() => null);
        this._exportError(`Export failed (${resp.status})${detail?.error ? ': ' + detail.error : ''}`);
        return;
      }
      this._saveBlob(await resp.blob(),
        fmt === 'geojson' ? 'climascope_aoi.geojson' : 'climascope_aoi.csv');
    } catch (e) {
      this._exportError(`Export failed: ${e.message}`);
    }
    finally {
      this._updateExportControls();
    }
  }

  async _downloadFilterExport(fmt) {
    if (!this._lastApplied) return;
    const wrap = this.el.querySelector('#fp-export-btns');
    if (wrap) wrap.innerHTML = '<button class="fp-export-btn" disabled>⏳ …</button>';
    try {
      // Export the already-matched cell IDs rather than re-running the rules.
      // The old /api/filter/export re-ran them but understood climate rules
      // only, so it 400'd on any terrain/landcover rule; it has been removed.
      // /api/aoi/export takes plain IDs and enriches them with terrain +
      // LiDAR phase columns.
      const state = this.getMapState();
      const ids   = this.matchedIds;
      if (!ids?.length) { this._exportError('Nothing to export — apply a filter first.'); return; }
      if (ids.length > 35000) {
        this._exportError(`Too many cells to export (${ids.length.toLocaleString()}; limit 35,000). Narrow the filter.`);
        return;
      }
      const resp = await fetch('/api/aoi/export', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          aoi_ids: ids,
          metric:  state.metric,
          period:  state.period,
          month:   state.month,
          ...(state.member && state.member !== 'mean' ? { member: state.member } : {}),
          fmt,
        }),
      });
      if (!resp.ok) {
        const detail = await resp.json().catch(() => null);
        this._exportError(`Export failed (${resp.status})${detail?.error ? ': ' + detail.error : ''}`);
        return;
      }
      this._saveBlob(await resp.blob(),
        fmt === 'geojson' ? 'climascope_filter.geojson' : 'climascope_filter.csv');
    } catch (e) {
      this._exportError(`Export failed: ${e.message}`);
    }
    finally {
      this._updateExportControls();
    }
  }

  _updateExportControls() {
    const wrap = this.el.querySelector('#fp-export-btns');
    if (!wrap) return;
    const hasAoi     = this._aoiActive && this._aoiCells?.length > 0;
    const hasMatched = this.matchedIds?.length > 0;

    wrap.innerHTML = '';

    if (!hasAoi && !hasMatched) {
      const btn = document.createElement('button');
      btn.className   = 'fp-export-btn';
      btn.disabled    = true;
      btn.textContent = 'Export';
      wrap.appendChild(btn);
      return;
    }

    const mkGroup = (icon, label, count, onCsv, onGeoJSON) => {
      const grp = document.createElement('div');
      grp.className = 'fp-export-group';
      const lbl = document.createElement('span');
      lbl.className   = 'fp-export-label';
      lbl.textContent = `${icon} ${label} (${count.toLocaleString()})`;
      grp.appendChild(lbl);
      const csvBtn = document.createElement('button');
      csvBtn.className   = 'fp-export-btn';
      csvBtn.textContent = 'CSV';
      csvBtn.addEventListener('click', onCsv);
      grp.appendChild(csvBtn);
      const gjBtn = document.createElement('button');
      gjBtn.className   = 'fp-export-btn';
      gjBtn.textContent = 'GeoJSON';
      gjBtn.addEventListener('click', onGeoJSON);
      grp.appendChild(gjBtn);
      return grp;
    };

    if (hasAoi) {
      wrap.appendChild(mkGroup(
        '⬥', 'AOI', this._aoiCells.length,
        () => this._downloadAoiExport('csv'),
        () => this._downloadAoiExport('geojson'),
      ));
    }
    if (hasMatched) {
      wrap.appendChild(mkGroup(
        '⬇', 'Matched', this.matchedIds.length,
        () => this._downloadFilterExport('csv'),
        () => this._downloadFilterExport('geojson'),
      ));
    }
  }
}
