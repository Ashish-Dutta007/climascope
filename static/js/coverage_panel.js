'use strict';

const _CP_LC_PALETTE = [
  '#4ade80','#60a5fa','#f59e0b','#a78bfa','#34d399',
  '#f87171','#38bdf8','#fb923c','#c084fc','#2dd4bf',
];

const _CP_MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun',
                    'Jul','Aug','Sep','Oct','Nov','Dec'];

function _cpClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function _cpEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function _cpFmt(km2) {
  if (km2 === 0) return '0 km²';
  if (km2 >= 1000) return (km2 / 1000).toFixed(1) + 'k km²';
  return km2.toFixed(0) + ' km²';
}

// Linear interpolate between two hex colours; t in [0,1]
function _cpLerp(hex1, hex2, t) {
  const p = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  const [r1,g1,b1] = p(hex1), [r2,g2,b2] = p(hex2);
  return `rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)})`;
}

// Map normalised delta (delta / maxAbsDelta, range -1..1) to a fill colour.
// Balance / volume / precip: positive = wetter (blue), negative = drier (red).
// Temperature: positive = warmer (red), negative = cooler (blue).
function _cpDeltaColor(delta, type, maxAbsDelta) {
  if (delta === null || delta === undefined || maxAbsDelta === 0)
    return 'rgba(255,255,255,.12)';
  const t   = _cpClamp(delta / maxAbsDelta, -1, 1);
  const RED = '#d73027', WHITE = '#eeeeee', BLUE = '#4575b4';
  const [neg, pos] = type === 'temperature' ? [BLUE, RED] : [RED, BLUE];
  if (t < 0) return _cpLerp(WHITE, neg, -t);
  if (t > 0) return _cpLerp(WHITE, pos,  t);
  return WHITE;
}

// Map an absolute period value to the metric colour scale (for "Show periods" bars).
// Balance: fixed diverging domain [-150, 0, 150] via chroma.js
// Temperature / volume: normalised to the current axis range
function _cpPeriodValueColor(value, type, axisMin, axisMax) {
  if (value == null) return 'rgba(255,255,255,.12)';
  if (type === 'balance') {
    return chroma.scale(['#d73027','#f7f7f7','#4575b4']).domain([-150, 0, 150])(value).hex();
  }
  const t = _cpClamp((value - axisMin) / (axisMax - axisMin || 1), 0, 1);
  if (type === 'temperature') {
    return chroma.scale(['#4575b4','#ffffbf','#d73027'])(t).hex();
  }
  return chroma.scale(['#ffffcc','#41b6c4','#0c2c84'])(t).hex();
}

class CoveragePanel {
  constructor(containerEl, getMapState) {
    this.el           = containerEl;
    this.getMapState  = getMapState;
    this.data         = null;
    this.showPeriods  = false;
    this.currentMonth = 7;
    this.threshold    = 0;
    this.lastFetchKey = null;
    this.aoiCells     = null;
    this.period1      = '2020-2049';
    this.period2      = '2050-2079';
    this._build();
  }

  _build() {
    this.el.innerHTML = `
      <div class="cp-collapse-handle" id="cp-collapse-handle"></div>
      <div class="cp-header">
        <div class="cp-scope-row">
          <div class="cp-scope-left">
            <a class="cp-back-link hidden" id="cp-back-link" href="#">← Scotland</a>
            <span class="cp-scope-label" id="cp-scope-label">Scotland (national)</span>
          </div>
          <div class="cp-toggle">
            <button class="cp-toggle-btn active" data-scope="national">National</button>
            <button class="cp-toggle-btn" data-scope="council" disabled>Council</button>
            <button class="cp-toggle-btn" data-scope="catchment" disabled>Catchment</button>
          </div>
        </div>
        <div class="cp-subheader">
          <div class="cp-meta">
            <span class="cp-meta-tag" id="cp-metric-echo">—</span>
            <span class="cp-meta-tag" id="cp-month-echo">—</span>
            <span class="cp-meta-tag" id="cp-period-echo">—</span>
          </div>
          <button class="cp-period-btn" id="cp-period-btn">Show periods</button>
        </div>
        <div class="cp-period-pair">
          <span class="cp-pp-label">Compare</span>
          <select class="cp-pp-sel" id="cp-p1-sel">
            <option value="1990-2019">1990–2019</option>
            <option value="2020-2049" selected>2020–2049</option>
            <option value="2050-2079">2050–2079</option>
          </select>
          <span class="cp-pp-vs">vs</span>
          <select class="cp-pp-sel" id="cp-p2-sel">
            <option value="1990-2019">1990–2019</option>
            <option value="2020-2049">2020–2049</option>
            <option value="2050-2079" selected>2050–2079</option>
          </select>
        </div>
        <div class="cp-divider"></div>
      </div>
      <div class="cp-legend-strip" id="cp-legend-strip">
        <span class="cp-legend-item"><span class="cp-legend-swatch" style="background:#4575b4"></span>Wetter</span>
        <span class="cp-legend-item"><span class="cp-legend-swatch" style="background:#eeeeee"></span>No change</span>
        <span class="cp-legend-item"><span class="cp-legend-swatch" style="background:#d73027"></span>Drier</span>
      </div>
      <div class="cp-body" id="cp-body">
        <div class="cp-loading">Loading…</div>
      </div>
      <div class="cp-footer">
        <div id="cp-totals-row"></div>
      </div>`;

    this.el.querySelectorAll('.cp-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => this._onScopeToggle(btn.dataset.scope));
    });

    const backLink = this.el.querySelector('#cp-back-link');
    if (backLink) {
      backLink.addEventListener('click', e => {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('climascope:setscope', { detail: { type: 'national' } }));
      });
    }

    const periodBtn = this.el.querySelector('#cp-period-btn');
    if (periodBtn) {
      periodBtn.addEventListener('click', () => {
        this.showPeriods = !this.showPeriods;
        periodBtn.classList.toggle('active', this.showPeriods);
        this._updateLegend();
        this._renderRows();
      });
    }

    const handle = this.el.querySelector('#cp-collapse-handle');
    if (handle) handle.addEventListener('click', () => this.el.classList.toggle('collapsed'));

    const p1Sel = this.el.querySelector('#cp-p1-sel');
    const p2Sel = this.el.querySelector('#cp-p2-sel');
    if (p1Sel) p1Sel.addEventListener('change', () => {
      // Never let both sides show the same period — swap the other one
      if (p1Sel.value === this.period2) { this.period2 = this.period1; if (p2Sel) p2Sel.value = this.period2; }
      this.period1 = p1Sel.value;
      this._reloadPeriods();
    });
    if (p2Sel) p2Sel.addEventListener('change', () => {
      if (p2Sel.value === this.period1) { this.period1 = this.period2; if (p1Sel) p1Sel.value = this.period1; }
      this.period2 = p2Sel.value;
      this._reloadPeriods();
    });
  }

  _reloadPeriods() {
    this.lastFetchKey = null;
    this.load();
  }

  _onScopeToggle(scopeType) {
    document.dispatchEvent(new CustomEvent('climascope:setscope', { detail: { type: scopeType } }));
  }

  _updateLegend() {
    const strip = this.el.querySelector('#cp-legend-strip');
    if (!strip) return;
    if (this.showPeriods) {
      const p1 = (this.data?.period_1 || this.period1).replace('-', '–');
      const p2 = (this.data?.period_2 || this.period2).replace('-', '–');
      strip.innerHTML = `
        <span class="cp-legend-item"><span class="cp-legend-swatch" style="background:#aaa;opacity:.35"></span>${p1}</span>
        <span class="cp-legend-item"><span class="cp-legend-swatch" style="background:#aaa"></span>${p2}</span>
        <span class="cp-legend-item" style="margin-left:4px;opacity:.4">· colour = value  bar = area × change</span>`;
    } else {
      strip.innerHTML = `
        <span class="cp-legend-item"><span class="cp-legend-swatch" style="background:#4575b4"></span>Wetter</span>
        <span class="cp-legend-item"><span class="cp-legend-swatch" style="background:#eeeeee"></span>No change</span>
        <span class="cp-legend-item"><span class="cp-legend-swatch" style="background:#d73027"></span>Drier</span>`;
    }
  }


  async load() {
    const state = this.getMapState();
    this.currentMonth = state.month;
    const scope    = state.scope  || 'national';
    const metric   = state.metric || 'CWBPT';
    const member   = state.member || 'mean';
    const isAoi    = scope === 'aoi' && state.aoiCells?.length > 0;
    this.aoiCells  = state.aoiCells || null;

    const periods  = `${this.period1}~${this.period2}`;
    const fetchKey = isAoi
      ? `${metric}|aoi:${state.aoiCells.length}:${state.aoiCells[0]}|${periods}|${member}`
      : `${metric}|${scope}|${periods}|${member}`;
    this.lastFetchKey = fetchKey;

    this._setMeta(metric, state.month, state.period);
    this._setScopeLabel(scope, state.aoiCells);
    this._updateToggle(scope, state.councilName, state.catchmentName, isAoi);
    this._setLoading(true);

    try {
      let resp;
      if (isAoi) {
        resp = await fetch('/api/coverage', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            metric, threshold: this.threshold, cell_ids: state.aoiCells,
            period_1: this.period1, period_2: this.period2,
            ...(member !== 'mean' ? { member } : {}),
          }),
        });
      } else {
        const memberParam = member !== 'mean' ? `&member=${encodeURIComponent(member)}` : '';
        const url = `/api/coverage?metric=${encodeURIComponent(metric)}`
                  + `&scope=${encodeURIComponent(scope)}`
                  + `&threshold=${this.threshold}`
                  + `&period_1=${encodeURIComponent(this.period1)}`
                  + `&period_2=${encodeURIComponent(this.period2)}`
                  + memberParam;
        resp = await fetch(url);
      }
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        this._showError(err.error || `HTTP ${resp.status}`);
        return;
      }
      this.data = await resp.json();
      this._renderRows();
    } catch (e) {
      this._showError(e.message);
    } finally {
      this._setLoading(false);
    }
  }

  onMapStateChange(newState) {
    this.currentMonth = newState.month;
    const isAoi    = newState.scope === 'aoi' && newState.aoiCells?.length > 0;
    const member   = newState.member || 'mean';
    const periods  = `${this.period1}~${this.period2}`;
    const fetchKey = isAoi
      ? `${newState.metric}|aoi:${newState.aoiCells.length}:${newState.aoiCells[0]}|${periods}|${member}`
      : `${newState.metric}|${newState.scope}|${periods}|${member}`;

    this._setMeta(newState.metric, newState.month, newState.period);
    this._setScopeLabel(newState.scope, newState.aoiCells);
    this._updateToggle(newState.scope, newState.councilName, newState.catchmentName, isAoi);

    if (fetchKey !== this.lastFetchKey) {
      this.lastFetchKey = fetchKey;
      this.load();
    } else {
      this._renderRows();
    }
  }


  _setLoading(on) {
    const body = this.el.querySelector('#cp-body');
    if (body && on) body.innerHTML = '<div class="cp-loading">Loading…</div>';
  }

  _showError(msg) {
    const body = this.el.querySelector('#cp-body');
    if (body) body.innerHTML = `<div class="cp-error">${_cpEsc(msg)}</div>`;
  }

  _setMeta(metric, month, period) {
    const mEl = this.el.querySelector('#cp-metric-echo');
    const mo  = this.el.querySelector('#cp-month-echo');
    const pe  = this.el.querySelector('#cp-period-echo');
    if (mEl) mEl.textContent = metric || '—';
    if (mo)  mo.textContent  = _CP_MONTHS[month] || String(month);
    if (pe)  pe.textContent  = period ? period.replace('-', '–') : '—';
  }

  _setScopeLabel(scope, aoiCells) {
    const el = this.el.querySelector('#cp-scope-label');
    if (!el) return;
    if (scope === 'aoi') {
      const n = aoiCells?.length ?? 0;
      el.textContent = `AOI (${n.toLocaleString()} cells)`;
      return;
    }
    if (!scope || scope === 'national') { el.textContent = 'Scotland (national)'; return; }
    if (scope.startsWith('council:'))   { el.textContent = scope.slice(8);  return; }
    if (scope.startsWith('catchment:')) { el.textContent = scope.slice(10).split(' : ')[0]; return; }
    el.textContent = scope;
  }

  _updateToggle(scope, councilName, catchmentName, isAoi) {
    const natBtn   = this.el.querySelector('[data-scope="national"]');
    const conBtn   = this.el.querySelector('[data-scope="council"]');
    const catBtn   = this.el.querySelector('[data-scope="catchment"]');
    const backLink = this.el.querySelector('#cp-back-link');
    if (!natBtn || !conBtn) return;
    if (isAoi) {
      // AOI overrides scope — disable all scope buttons
      [natBtn, conBtn, catBtn].forEach(b => b && (b.disabled = true) && b.classList.remove('active'));
      if (backLink) backLink.classList.add('hidden');
      return;
    }
    [natBtn, conBtn, catBtn].forEach(b => b && (b.disabled = false));
    const isCatchment = scope?.startsWith('catchment:');
    const isCouncil   = scope?.startsWith('council:');
    const isNat       = !isCatchment && !isCouncil;
    natBtn.classList.toggle('active', isNat);
    conBtn.classList.toggle('active', isCouncil);
    if (catBtn) {
      catBtn.classList.toggle('active', isCatchment);
      catBtn.disabled = !catchmentName;
    }
    conBtn.disabled = !councilName;
    if (backLink) backLink.classList.toggle('hidden', isNat);
  }

  _getMonthData(entry, month) {
    return entry.months && entry.months[month - 1];
  }


  _renderRows() {
    const d = this.data;
    if (!d) return;

    const body = this.el.querySelector('#cp-body');
    if (!body) return;

    const m     = this.currentMonth;
    const type  = d.metric.type;
    const units = d.metric.units || '';
    const thr   = d.threshold || 0;

    // Area filter
    const visible = d.classes.filter(cls => cls.area_km2 >= 0.1);

    if (visible.length === 0) {
      body.innerHTML = '<div class="cp-loading">No coverage data for this scope.</div>';
      const te = this.el.querySelector('#cp-totals-row');
      if (te) te.innerHTML = '';
      return;
    }

    // Collect delta values for colour scaling
    const deltas = visible.map(cls => {
      const md = this._getMonthData(cls, m);
      return (md?.delta?.mean !== undefined && md?.delta?.mean !== null) ? md.delta.mean : null;
    }).filter(v => v !== null);

    const maxAbsDelta = deltas.length > 0 ? Math.max(...deltas.map(Math.abs), 0.001) : 1;

    // impact = area × |delta| — used for bar width and sort order
    const impactOf  = cls => cls.area_km2 * Math.abs(this._getMonthData(cls, m)?.delta?.mean ?? 0);
    const maxImpact = Math.max(...visible.map(impactOf), 1);

    // Axis and bar-width scale for "Show periods" mode
    let axisMin = 0, axisMax = 1, maxAbsVal = 1;
    if (this.showPeriods) {
      const means = [];
      visible.forEach(cls => {
        const md = this._getMonthData(cls, m);
        if (!md) return;
        if (md.current.mean != null) means.push(md.current.mean);
        if (md.future.mean  != null) means.push(md.future.mean);
      });
      if (means.length > 0) {
        if (type === 'balance') {
          const dev = Math.max(...means.map(v => Math.abs(v - thr)));
          axisMin = thr - dev; axisMax = thr + dev;
        } else {
          axisMin = Math.min(...means); axisMax = Math.max(...means);
        }
        if (axisMax === axisMin) axisMax = axisMin + 1;
        maxAbsVal = Math.max(...means.map(Math.abs), 1);
      }
    }

    const sorted = [...visible].sort((a, b) => impactOf(b) - impactOf(a));

    let html = '';
    if (visible.length > 0 && visible.length < 3) {
      html += `<div class="cp-sparse-msg">Limited landcover variation in this ${d.scope?.type || 'area'}</div>`;
    }

    sorted.forEach(cls => {
      const i  = d.classes.indexOf(cls);
      const md = this._getMonthData(cls, m);
      const lcName = String(cls.lc_name ?? '');

      const barHtml = !md
        ? '<div class="cp-bar-empty"></div>'
        : this.showPeriods
          ? this._buildPeriodBars(md, type, thr, axisMin, axisMax, lcName, this.period1, this.period2, units, cls.area_km2, impactOf(cls), maxAbsVal)
          : this._buildDeltaColorBar(md, type, cls.area_km2, impactOf(cls), maxImpact, maxAbsDelta, lcName, units, this.period1, this.period2);

      const deltaHtml = (!md || md.delta.mean == null)
        ? '<span class="cp-dash">—</span>'
        : this._buildDeltaLabel(md.delta.mean, type);

      html += `<div class="cp-row">
        <div class="cp-row-label">
          <div class="cp-lc-dot" style="background:${_CP_LC_PALETTE[i % _CP_LC_PALETTE.length]}"></div>
          <div class="cp-lc-info">
            <div class="cp-lc-name">${_cpEsc(lcName)}</div>
            <div class="cp-lc-area">${_cpFmt(cls.area_km2)}</div>
          </div>
        </div>
        <div class="cp-bar-cell">${barHtml}</div>
        <div class="cp-delta-cell">${deltaHtml}</div>
      </div>`;
    });
    body.innerHTML = html;

    // Totals row
    const totalsEl  = this.el.querySelector('#cp-totals-row');
    const totalMd   = this._getMonthData({ months: d.totals.months }, m);
    const totalArea = visible.reduce((s, c) => s + c.area_km2, 0) || d.totals.area_km2;

    if (totalsEl && totalMd) {
      const totalImpact = totalArea * Math.abs(totalMd.delta.mean ?? 0);
      const tBar = this.showPeriods
        ? this._buildPeriodBars(totalMd, type, thr, axisMin, axisMax, 'All land covers', this.period1, this.period2, units, totalArea, totalImpact, maxAbsVal)
        : this._buildDeltaColorBar(totalMd, type, totalArea, totalImpact, maxImpact, maxAbsDelta, 'All land covers', units, this.period1, this.period2);
      const tDelta = totalMd.delta.mean != null
        ? this._buildDeltaLabel(totalMd.delta.mean, type)
        : '<span class="cp-dash">—</span>';
      totalsEl.innerHTML = `<div class="cp-row cp-row-totals">
        <div class="cp-row-label">
          <div class="cp-lc-dot" style="background:rgba(255,255,255,.28)"></div>
          <div class="cp-lc-info">
            <div class="cp-lc-name">All land covers</div>
            <div class="cp-lc-area">${_cpFmt(totalArea)}</div>
          </div>
        </div>
        <div class="cp-bar-cell">${tBar}</div>
        <div class="cp-delta-cell">${tDelta}</div>
      </div>`;
    } else if (totalsEl) {
      totalsEl.innerHTML = '';
    }
  }


  // Default: bar width = impact (area × |delta|); fill = delta colour
  _buildDeltaColorBar(md, type, area_km2, impact, maxImpact, maxAbsDelta, lcName, units, p1Label, p2Label) {
    const W    = 200, H = 16;
    const barW = _cpClamp((impact / maxImpact) * W, 2, W);
    const col  = _cpDeltaColor(md.delta.mean, type, maxAbsDelta);
    const dv   = md.delta.mean != null ? md.delta.mean.toFixed(1) : '—';
    const sign = md.delta.mean != null && md.delta.mean >= 0 ? '+' : '';
    const ifmt = v => v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'k' : v.toFixed(0);
    const impactUnits = units ? `km²·${units}` : 'km²';
    const tip  = `${_cpEsc(lcName)}\nChange: ${sign}${dv} ${units}\nArea: ${_cpFmt(area_km2)}\nTotal impact: ${ifmt(impact)} ${impactUnits}\n${p1Label} → ${p2Label}`;
    return `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <title>${tip}</title>
      <rect x="0" y="4" width="${W}" height="8" rx="2" fill="rgba(255,255,255,.06)"/>
      <rect x="0" y="4" width="${barW.toFixed(1)}" height="8" rx="2" fill="${col}"/>
    </svg>`;
  }

  // "Show periods": two stacked bars — width = impact, colour = value, opacity = period
  // top bar (period1/current): opacity 0.35 · bottom bar (period2/future): opacity 1.0
  _buildPeriodBars(md, type, thr, axisMin, axisMax, lcName, p1Label, p2Label, units, areaKm2, impact, maxAbsVal) {
    const W     = 200, H = 24;
    const v1    = md.current.mean ?? 0;
    const v2    = md.future.mean  ?? 0;
    const currW = _cpClamp((Math.abs(v1) / maxAbsVal) * W, 2, W);
    const futW  = _cpClamp((Math.abs(v2) / maxAbsVal) * W, 2, W);
    const col1  = _cpPeriodValueColor(v1, type, axisMin, axisMax);
    const col2  = _cpPeriodValueColor(v2, type, axisMin, axisMax);
    const diff  = v2 - v1;
    const sign  = diff >= 0 ? '+' : '';
    const ifmt  = v => v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'k' : v.toFixed(0);
    const impactUnits = units ? `km²·${units}` : 'km²';
    const tip   = `${_cpEsc(lcName)}\n${p1Label}: ${v1.toFixed(1)} ${units}\n${p2Label}: ${v2.toFixed(1)} ${units}\nΔ ${sign}${diff.toFixed(1)} ${units}\nArea: ${_cpFmt(areaKm2)}\nTotal impact: ${ifmt(impact)} ${impactUnits}`;
    return `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <title>${tip}</title>
      <rect x="0" y="2"  width="${W}" height="9" rx="2" fill="rgba(255,255,255,.06)"/>
      <rect x="0" y="13" width="${W}" height="9" rx="2" fill="rgba(255,255,255,.06)"/>
      <rect x="0" y="2"  width="${currW.toFixed(1)}" height="9" rx="2" fill="${col1}" fill-opacity="0.3" stroke="rgba(255,255,255,.55)" stroke-width="1" vector-effect="non-scaling-stroke"/>
      <rect x="0" y="13" width="${futW.toFixed(1)}"  height="9" rx="2" fill="${col2}"/>
    </svg>`;
  }


  _buildDeltaLabel(deltaVal, type) {
    if (deltaVal === null) return '<span class="cp-dash">—</span>';
    const abs = Math.abs(deltaVal).toFixed(1);
    let arrow, cls;
    if (type === 'balance') {
      arrow = deltaVal < 0 ? '▼' : '▲';
      cls   = deltaVal < 0 ? 'cp-delta-bad' : 'cp-delta-good';
    } else {
      arrow = deltaVal > 0 ? '▲' : '▼';
      cls   = 'cp-delta-neutral';
    }
    return `<span class="${cls}">${arrow}&nbsp;${abs}</span>`;
  }
}
