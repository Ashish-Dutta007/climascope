'use strict';

function _dpChartDefaults() {
  const themed = window.ClimaScopeTheme?.chart();   // missing if the proxy refused theme.js
  if (!themed) return;
  Chart.defaults.color = themed.text;
  Chart.defaults.borderColor = themed.border;
  Chart.defaults.plugins.legend.labels.color = themed.text;
}
_dpChartDefaults();

const _DP_PALETTE = [
  '#4ade80','#60a5fa','#f59e0b','#a78bfa','#34d399',
  '#f87171','#38bdf8','#fb923c','#c084fc','#2dd4bf',
];

const _DP_VAR_LABELS = {
  'LCM':           'Land cover',
  'HABITAT':       'Habitat 2022',
  'Land Use':      'Land use · catchment-derived',
  'Farm Type':     'Farm type · catchment-derived',
  'LCA':           'LCA · catchment-derived',
  'Peat Condition':'Peat condition · catchment-derived',
};

class DashboardPie {
  constructor(containerEl, getMapState) {
    this.el             = containerEl;
    this.getMapState    = getMapState;
    this._chart         = null;
    this._lastScope     = null;
    this._lastVariable  = 'LCM';
    this.variable       = 'LCM';
    this._lcItems       = null;
    this._habitatItems  = null;
    this._pendingKey    = null;
    this._aoiCells      = null;
    this._requestRevision = 0;
    this._requestController = null;
    this._lastRender   = null;
    this._build();
    this._loadLcItems();
    this._loadHabitatItems();

    // Canvas charts keep the colours they were drawn with, so redraw on a theme switch.
    window.addEventListener('climascope:theme', () => {
      _dpChartDefaults();
      if (this._chart) { this._chart.destroy(); this._chart = null; }
      if (this._lastRender) this._render(...this._lastRender);
    });

    document.addEventListener('climascope:variable', e => {
      const v = e.detail?.variable || 'LCM';
      this.variable      = v;
      this._lastVariable = v;
      this._fetch(this._lastScope || 'national');
    });

    document.addEventListener('climascope:aoi:ready', () => {
      const state    = this.getMapState();
      this._aoiCells = state.aoiCells;
      this._lastScope = null;
      this._fetch('aoi');
    });
    document.addEventListener('climascope:aoi:clear', () => {
      this._aoiCells  = null;
      this._lastScope = null;
      const state = this.getMapState();
      this._fetch(state.scope || 'national');
    });
  }

  _build() {
    this.el.innerHTML = `
      <div class="dp-header">
        <div class="dp-heading">
          <div><span class="dp-title" id="dp-title">Land cover : </span>
          <span class="dp-scope-name" id="dp-scope-name">Scotland</span></div>
          <span class="dp-source" id="dp-source">Source: UKCEH LCM · 1 km cell fractions</span>
        </div>
      </div>
      <div class="dp-body" id="dp-body">
        <canvas id="dp-canvas"></canvas>
        <div class="dp-empty" id="dp-empty" style="display:none">No data</div>
      </div>`;
  }

  async _loadLcItems() {
    try {
      this._lcItems = await fetch('/api/landcover').then(r => r.json());
    } catch {}
  }

  async _loadHabitatItems() {
    try {
      const data = await fetch('/api/habitat').then(r => r.json());
      this._habitatItems = data.classes || [];
    } catch {}
  }

  onMapStateChange(state) {
    const scope    = state.scope || 'national';
    this._aoiCells = state.aoiCells || null;
    if (this._fetchKey(scope) === this._pendingKey) return;
    this._fetch(scope);
  }

  _fetchKey(scope) {
    return JSON.stringify([scope, this.variable, scope === 'aoi' ? this._aoiCells : null]);
  }

  _scopeLabel(scope) {
    const catchmentTotals = !['LCM', 'HABITAT'].includes(this.variable);
    if (!scope || scope === 'national') return catchmentTotals ? 'Scotland · available catchments' : 'Scotland';
    if (scope === 'aoi')                return `Drawn area (${(this._aoiCells?.length ?? 0).toLocaleString()} cells)`;
    if (scope.startsWith('council:'))   return (catchmentTotals ? 'Catchments linked to ' : '') + scope.slice(8);
    if (scope.startsWith('catchment:')) return scope.slice(10).split(' : ')[0];
    return scope;
  }

  async _fetch(scope) {
    const variable   = this.variable || 'LCM';
    const aoiCells = this._aoiCells;
    const revision = ++this._requestRevision;
    this._requestController?.abort();
    const controller = this._requestController = new AbortController();
    this._pendingKey = this._fetchKey(scope);
    this._lastScope = scope;
    this._lastVariable = variable;
    const empty = this.el.querySelector('#dp-empty');
    const canvas = this.el.querySelector('#dp-canvas');
    if (canvas) canvas.style.display = 'none';
    if (empty) { empty.textContent = 'Loading…'; empty.style.display = 'flex'; }
    try {
      let resp;
      if (scope === 'aoi') {
        if (!aoiCells?.length) { this._render({}, scope); return; }
        resp = await fetch('/api/landuse_composition', {
          method:  'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ aoi_ids: aoiCells, variable }),
        });
      } else {
        resp = await fetch(
          `/api/landuse_composition?scope=${encodeURIComponent(scope)}&variable=${encodeURIComponent(variable)}`,
          { signal: controller.signal }
        );
      }
      const data = await resp.json().catch(() => { throw new Error('Could not load land composition. Try again.'); });
      if (!resp.ok) throw new Error(data.error || 'Could not load land composition.');
      if (revision !== this._requestRevision) return;
      this._render(data, scope);
    } catch (error) {
      if (revision !== this._requestRevision || error.name === 'AbortError') return;
      this._pendingKey = null;
      if (empty) { empty.textContent = error.message; empty.style.display = 'flex'; }
    }
  }

  _render(data, scope) {
    this._lastRender = [data, scope];
    const nameEl = this.el.querySelector('#dp-scope-name');
    if (nameEl) nameEl.textContent = this._scopeLabel(scope);

    const titleEl = this.el.querySelector('#dp-title');
    if (titleEl) {
      const label = _DP_VAR_LABELS[this.variable] || this.variable;
      titleEl.textContent = label + ' : ';
    }

    const sourceEl = this.el.querySelector('#dp-source');
    if (sourceEl) {
      sourceEl.textContent = this.variable === 'HABITAT'
        ? 'Source: NatureScot HLCM 2022 · 20 m fractions grouped to 1 km'
        : this.variable === 'LCM'
          ? 'Source: UKCEH LCM · 1 km cell fractions'
          : scope === 'aoi'
            ? 'Catchment-derived totals · overlap-weighted AOI estimate'
            : 'Catchment-derived totals';
    }

    const emptyEl = this.el.querySelector('#dp-empty');
    const canvas = this.el.querySelector('#dp-canvas');
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);

    if (!entries.length) {
      if (emptyEl) { emptyEl.textContent = 'No data'; emptyEl.style.display = 'flex'; }
      if (canvas) canvas.style.display = 'none';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (canvas) canvas.style.display = 'block';

    const labels = entries.map(([k]) => k);
    const values = entries.map(([, v]) => v);
    const colors = labels.map((name, i) => {
      if (this.variable === 'HABITAT') {
        const habitat = this._habitatItems?.find(it => it.group_name === name);
        if (habitat?.color) return habitat.color;
      }
      const idx = this._lcItems ? this._lcItems.findIndex(it => it.lc_name === name) : -1;
      return _DP_PALETTE[idx >= 0 ? idx % _DP_PALETTE.length : i % _DP_PALETTE.length];
    });

    if (!canvas) return;

    if (this._chart) {
      this._chart.data.labels = labels;
      this._chart.data.datasets[0].data   = values;
      this._chart.data.datasets[0].backgroundColor = colors;
      this._chart.update('none');
      return;
    }

    const ctx = canvas.getContext('2d');
    const themed = window.ClimaScopeTheme?.chart() || {};
    this._chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderColor: themed.surface,
          borderWidth: 1.5,
          hoverBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '50%',
        plugins: {
          legend: {
            display: true,
            position: 'right',
            labels: {
              color: themed.text,
              font: { size: 11 },
              boxWidth: 9,
              boxHeight: 9,
              padding: 6,
              generateLabels(chart) {
                const { labels, datasets } = chart.data;
                return labels.map((label, i) => ({
                  text: `${label}  ${datasets[0].data[i].toFixed(1)}%`,
                  fillStyle: datasets[0].backgroundColor[i],
                  strokeStyle: 'transparent',
                  fontColor: themed.text,
                  hidden: false,
                  index: i,
                }));
              },
            },
          },
          tooltip: {
            backgroundColor: themed.tooltip,
            titleColor: themed.tooltipText,
            bodyColor: themed.tooltipText,
            borderColor: '#3b82f6',
            borderWidth: 1,
            callbacks: {
              label: ctx => ` ${ctx.label}: ${ctx.parsed.toFixed(1)}%`,
            },
          },
        },
      },
    });
  }
}
