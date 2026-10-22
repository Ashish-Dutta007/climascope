'use strict';

const _KP_CLASSES   = ['Strong Deficit', 'Moderate Deficit', 'Moderate Surplus', 'Strong Surplus'];
const _KP_COLORS    = { 'Strong Deficit': '#b2182b', 'Moderate Deficit': '#ef8a62',
                         'Moderate Surplus': '#67a9cf', 'Strong Surplus': '#2166ac' };
const _KP_VARIABLES = ['Land Use', 'Farm Type', 'LCA', 'Peat Condition'];
const _KP_MONTHS    = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _KP_COMPARE_PERIODS = ['1960-1989', '1990-2019', '2020-2049', '2050-2079'];
const _KP_PERIOD_LABELS   = {
  '1960-1989': '1960–1989', '1990-2019': '1990–2019', '2020-2049': '2020–2049', '2050-2079': '2050–2079'
};
const _CATCHMENT_METRICS = ['CWBPT', 'CWBPM', 'CWRPT', 'CWRPM'];

function _kpFmtHa(ha) {
  if (ha >= 1e6) return (ha / 1e6).toFixed(1) + 'M ha';
  if (ha >= 1e3) return (ha / 1e3).toFixed(0) + 'k ha';
  return ha + ' ha';
}

function _kpEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

class CatchmentPanel {
  constructor(containerEl, getMapState) {
    this.el           = containerEl;
    this.getMapState  = getMapState;
    this.variable     = 'Land Use';
    this.data         = null;
    this.compareData  = null;
    this.compareMode  = false;
    this.metricNote   = null;
    this.lastFetchKey = null;
    this._chart       = null;
    this._aoiCells    = null;
    this._requestRevision = 0;
    this._requestController = null;
    this._build();

    document.addEventListener('climascope:aoi:ready', () => {
      this._aoiCells    = this.getMapState().aoiCells;
      this.lastFetchKey = null;
      this._fetch();
    });
    document.addEventListener('climascope:aoi:clear', () => {
      this._aoiCells    = null;
      this.lastFetchKey = null;
      this._fetch();
    });
  }

  _build() {
    this.el.innerHTML = `
      <div class="kp-header">
        <div class="kp-scope-row">
          <span class="kp-scope-label" id="kp-scope-label">Scotland (national)</span>
          <button class="kp-compare-btn" id="kp-compare-btn"
                  title="Compare all 4 time periods side by side">◑ Compare</button>
        </div>
        <div class="kp-var-tabs" id="kp-var-tabs">
          ${_KP_VARIABLES.map(v =>
            `<button class="kp-var-btn${v === 'Land Use' ? ' active' : ''}"
                     data-var="${v}"${v === 'LCA' ? ' title="Land Capability for Agriculture"' : ''}>${v}</button>`
          ).join('')}
        </div>
        <div class="kp-source-note">Catchment-derived totals; AOIs use an overlap-weighted estimate</div>
        <div class="kp-meta">
          <span class="kp-meta-tag" id="kp-metric-echo">—</span>
          <span class="kp-meta-tag" id="kp-month-echo">—</span>
          <span class="kp-meta-tag" id="kp-period-echo">—</span>
          <span class="kp-meta-tag" id="kp-member-echo">—</span>
        </div>
      </div>
      <div class="kp-legend">
        ${_KP_CLASSES.map(c =>
          `<span class="kp-legend-item">
            <span class="kp-legend-dot" style="background:${_KP_COLORS[c]}"></span>${c}
           </span>`
        ).join('')}
        <span class="kp-legend-note">height = total area</span>
      </div>
      <div class="kp-body" id="kp-body">
        <div class="kp-loading">Loading…</div>
      </div>`;

    this.el.querySelectorAll('.kp-var-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.variable = btn.dataset.var;
        this.el.querySelectorAll('.kp-var-btn').forEach(b =>
          b.classList.toggle('active', b.dataset.var === this.variable));
        document.dispatchEvent(new CustomEvent('climascope:variable', { detail: { variable: this.variable } }));
        this._fetch();
      });
    });

    this.el.querySelector('#kp-compare-btn').addEventListener('click', () => {
      this.compareMode = !this.compareMode;
      this.el.querySelector('#kp-compare-btn').classList.toggle('active', this.compareMode);
      this._fetch();
    });
  }

  async load() {
    await this._fetch();
  }

  _selection(state = this.getMapState()) {
    const rawMetric = state.metric || 'CWBPT';
    return {
      scope: state.scope || 'national',
      metric: _CATCHMENT_METRICS.includes(rawMetric) ? rawMetric : 'CWBPT',
      month: state.month || Number(document.getElementById('month')?.value) || new Date().getMonth() + 1,
      period: state.period || '2050-2079',
      member: state.member || 'mean',
      variable: this.variable,
      compare: this.compareMode,
      aoiCells: state.aoiCells || [],
    };
  }

  _fetchKey(selection) {
    return JSON.stringify([
      selection.variable, selection.metric, selection.month, selection.member,
      selection.scope, selection.compare, selection.compare ? null : selection.period,
      selection.scope === 'aoi' ? selection.aoiCells : null,
    ]);
  }

  onMapStateChange(state) {
    if (this._fetchKey(this._selection(state)) !== this.lastFetchKey) this._fetch();
  }

  async _fetchPeriod(selection, period, signal) {
    const { scope, variable, metric, month, member, aoiCells } = selection;
    const values = { variable, metric, month, period, member };
    const response = scope === 'aoi'
      ? await fetch('/api/catchment', {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...values, aoi_ids: aoiCells }),
        })
      : await fetch('/api/catchment?' + new URLSearchParams({ ...values, scope }), { signal });
    const data = await response.json().catch(() => { throw new Error('Could not load catchment data. Try again.'); });
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  async _fetch() {
    const selection = this._selection();
    const revision = ++this._requestRevision;
    this._requestController?.abort();
    const controller = this._requestController = new AbortController();
    this.lastFetchKey = this._fetchKey(selection);
    this._setMeta(selection.metric, selection.month, selection.compare ? null : selection.period, selection.member);
    this._setScopeLabel(selection.scope, selection.aoiCells);
    this._setLoading(true);
    if (selection.scope === 'aoi' && !selection.aoiCells.length) {
      this._showNoData();
      return;
    }
    try {
      const periods = selection.compare ? _KP_COMPARE_PERIODS : [selection.period];
      const results = await Promise.all(periods.map(period => this._fetchPeriod(selection, period, controller.signal)));
      if (revision !== this._requestRevision) return;
      this.metricNote = null;
      const scopeLabel = this.el.querySelector('#kp-scope-label');
      if (scopeLabel && results[0].scope_label) scopeLabel.textContent = results[0].scope_label;
      if (selection.compare) {
        this.compareData = results;
        this._renderCompare();
      } else {
        this.data = results[0];
        this._renderRows();
      }
    } catch (error) {
      if (revision !== this._requestRevision || error.name === 'AbortError') return;
      controller.abort();
      this.lastFetchKey = null;
      this._showError(error.message);
    }
  }

  _destroyChart() {
    if (this._chart) { this._chart.destroy(); this._chart = null; }
  }

  _setLoading(on) {
    const body = this.el.querySelector('#kp-body');
    if (on && body) { this._destroyChart(); body.innerHTML = '<div class="kp-loading">Loading…</div>'; }
  }

  _showError(msg) {
    const body = this.el.querySelector('#kp-body');
    this._destroyChart();
    if (body) body.innerHTML = `<div class="kp-error">${_kpEsc(msg)}</div>`;
  }

  _showNoData() {
    const body = this.el.querySelector('#kp-body');
    this._destroyChart();
    if (body) body.innerHTML = `<div class="kp-empty">No catchment data for this selection.</div>`;
  }

  _setMeta(metric, month, period, member) {
    const mEl = this.el.querySelector('#kp-metric-echo');
    const mo  = this.el.querySelector('#kp-month-echo');
    const pe  = this.el.querySelector('#kp-period-echo');
    if (mEl) mEl.textContent = metric || '—';
    if (mo)  mo.textContent  = _KP_MONTHS[month] || String(month);
    if (pe)  pe.textContent  = period || 'All periods';
    const me = this.el.querySelector('#kp-member-echo');
    if (me) me.textContent = member === 'mean' ? 'Mean class areas · 12 members' : 'Member ' + member;
  }

  _setScopeLabel(scope, aoiCells) {
    const el = this.el.querySelector('#kp-scope-label');
    if (!el) return;
    if (!scope || scope === 'national')      el.textContent = 'Scotland (national)';
    else if (scope === 'aoi')               el.textContent = `AOI (${(aoiCells?.length ?? 0).toLocaleString()} cells)`;
    else if (scope.startsWith('council:'))  el.textContent = scope.slice(8);
    else                                    el.textContent = scope;
  }

  _renderRows() {
    const body = this.el.querySelector('#kp-body');
    if (!body || !this.data) return;

    const rows = this.data.rows;
    if (!rows || rows.length === 0) {
      this._destroyChart();
      body.innerHTML = '<div class="kp-empty">No data for this selection.</div>';
      return;
    }

    const sorted   = [...rows].sort((a, b) => b.total_ha - a.total_ha);
    const labels   = sorted.map(r => r.type);
    const datasets = _KP_CLASSES.map(cls => ({
      label: cls,
      data: sorted.map(r => r.classes[cls] || 0),
      backgroundColor: _KP_COLORS[cls],
      borderWidth: 0,
    }));

    // Re-use existing chart if canvas is already present
    if (this._chart) {
      this._chart.data.labels = labels;
      this._chart.data.datasets.forEach((ds, i) => { ds.data = datasets[i].data; });
      this._chart.update('none');
      return;
    }

    this._destroyChart();
    body.innerHTML = (this.metricNote
      ? `<div class="kp-metric-note">${this.metricNote}</div>` : '')
      + '<div class="kp-chart-wrap"><canvas></canvas></div>';

    const canvas = body.querySelector('canvas');
    this._chart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(13,16,24,0.95)',
            titleColor: '#e2e8f4',
            bodyColor: '#e2e8f4',
            borderColor: '#3b82f6',
            borderWidth: 1,
            callbacks: {
              label: ctx => {
                const ha  = Math.round(ctx.parsed.y);
                const tot = ctx.chart.data.datasets
                  .reduce((s, ds) => s + (ds.data[ctx.dataIndex] || 0), 0);
                const pct = tot > 0 ? Math.round(ha / tot * 100) : 0;
                return ` ${ctx.dataset.label}: ${_kpFmtHa(ha)} (${pct}%)`;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: 'rgba(226,232,244,.7)', font: { size: 10 }, maxRotation: 40 },
            grid:   { color: 'rgba(255,255,255,.04)' },
          },
          y: {
            stacked: true,
            title:  { display: true, text: 'Area (Ha)', color: 'rgba(226,232,244,.5)', font: { size: 10 } },
            ticks:  { color: 'rgba(226,232,244,.6)', font: { size: 10 }, callback: v => _kpFmtHa(v) },
            grid:   { color: 'rgba(255,255,255,.04)' },
          },
        },
      },
    });
  }

  _renderCompare() {
    const body = this.el.querySelector('#kp-body');
    if (!body) return;
    this._destroyChart();
    const results = this.compareData;
    const first = results?.find(r => r?.rows?.length);
    if (!first) {
      body.innerHTML = '<div class="kp-empty">No data for this selection.</div>';
      return;
    }

    const types = [...new Set(results.flatMap(result => result.rows.map(row => row.type)))];
    const referenceArea = type => results.find(result => result.rows.some(row => row.type === type))
      .rows.find(row => row.type === type).total_ha;
    types.sort((a, b) => referenceArea(b) - referenceArea(a));

    let html = this.metricNote
      ? `<div class="kp-metric-note">${this.metricNote}</div>`
      : '';

    types.forEach(type => {
      const refRow = results.flatMap(result => result.rows).find(row => row.type === type);
      // Scale bars within each group to that group's own maximum across periods
      const groupMax = Math.max(
        ...results.map(res => res?.rows?.find(r => r.type === type)?.total_ha || 0)
      ) || 1;

      html += `<div class="kp-compare-group">
        <div class="kp-cg-header">
          <span class="kp-type-name">${_kpEsc(type)}</span>
          <span class="kp-type-area">${_kpFmtHa(refRow?.total_ha || 0)}</span>
        </div>`;

      results.forEach((result, i) => {
        const period  = _KP_COMPARE_PERIODS[i];
        const label   = _KP_PERIOD_LABELS[period];
        const row     = result?.rows?.find(r => r.type === type);
        const barPct  = row ? (row.total_ha / groupMax * 100).toFixed(2) : '0';

        const tooltip = row ? _KP_CLASSES
          .map(c => {
            const ha = row.classes[c] || 0;
            if (!ha) return null;
            const pct = row.total_ha > 0 ? Math.round(ha / row.total_ha * 100) : 0;
            return `${c}: ${_kpFmtHa(ha)} (${pct}%)`;
          })
          .filter(Boolean).join(' · ') : '';

        const segments = row ? _KP_CLASSES.map(c => {
          const ha = row.classes[c] || 0;
          const w  = row.total_ha > 0 ? ((ha / row.total_ha) * 100).toFixed(2) : 0;
          return `<div class="kp-seg" style="width:${w}%;background:${_KP_COLORS[c]}"></div>`;
        }).join('') : '';

        html += `<div class="kp-cg-row">
          <span class="kp-cg-period">${label}</span>
          <div class="kp-cg-bar-wrap">
            <div class="kp-bar" style="width:${barPct}%" title="${_kpEsc(tooltip)}">${segments}</div>
          </div>
        </div>`;
      });

      html += `</div>`;
    });

    body.innerHTML = `<div class="kp-scroll-wrap">${html}</div>`;
  }
}
