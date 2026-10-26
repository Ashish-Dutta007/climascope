(function () {
  'use strict';
  window.ClimateDashboard = class {
    constructor(el, getState, onScope) {
      this.el = el; this.getState = getState; this.onScope = onScope;
      this.location = null; this.data = null; this.key = null; this.sequence = 0;
      this.lookupSequence = 0; this.lookupPending = false; this.lookupAbort = null;
      el.innerHTML = `<form class="profile-search"><label for="climate-postcode">Postcode</label><input id="climate-postcode" name="postcode" autocomplete="postal-code" required maxlength="10"><button type="submit">Find climate</button></form><div class="profile-controls"><label>Month<select id="climate-month"></select></label><label>Compare with 1990–2019<select id="climate-period"></select></label><label>Ensemble<select id="climate-member"></select></label></div><p class="profile-status" role="status"></p><div class="profile-scopes" aria-label="Climate area"></div><div class="profile-heading"></div><div class="profile-content"></div>`;
      ['month','period','member'].forEach(name => {
        const control = el.querySelector('#climate-' + name);
        const main = document.getElementById(name);
        const options = name === 'month' ? ClimaScopeProfile.months.map((text, i) => ({value:i + 1,text})) : Array.from(main.options);
        options.forEach(item => control.add(new Option(item.text, item.value)));
        control.addEventListener('change', () => {
          main.value = control.value;
          main.dispatchEvent(new Event(name === 'month' ? 'input' : 'change', {bubbles:true}));
        });
      });
      this.status = el.querySelector('.profile-status');
      el.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        const postcode = el.querySelector('input').value.trim();
        this.locate('/api/location?' + new URLSearchParams({postcode}));
      });
    }
    async locate(url) {
      this.cancelLookup();
      const seq = this.lookupSequence;
      this.lookupAbort = new AbortController();
      this.lookupPending = true;
      this.status.textContent = 'Finding location…';
      try {
        const location = await ClimaScopeProfile.get(url, this.lookupAbort.signal);
        if (seq !== this.lookupSequence) return;
        this.lookupPending = false;
        this.lookupAbort = null;
        this.onScope('cell', location);
      } catch (e) {
        if (seq === this.lookupSequence) {
          this.lookupPending = false;
          this.lookupAbort = null;
          this.status.textContent = e.message;
        }
      }
    }
    cancelLookup() {
      this.lookupSequence++;
      this.lookupAbort?.abort();
      this.lookupAbort = null; this.lookupPending = false;
    }
    selectPoint(lon, lat) {
      this.locate('/api/location?' + new URLSearchParams({lon, lat}));
    }
    setLocation(location) {
      this.cancelLookup();
      this.location = location;
      this.el.querySelector('#climate-postcode').value = location.name === 'Selected location' ? '' : location.name;
    }
    async update(state, cellSelected) {
      const seq = ++this.sequence;
      const scope = state.scope === 'aoi' ? 'aoi' : cellSelected && this.location ? this.location.scope : state.scope;
      const key = scope + '|' + state.member;
      this.state = state; this.cellSelected = cellSelected && scope !== 'aoi';
      ['month','period','member'].forEach(name => {
        const control = this.el.querySelector('#climate-' + name);
        const main = document.getElementById(name);
        control.value = String(state[name]);
        control.disabled = main.disabled;
        control.title = main.title;
      });
      this.drawScopes();
      if (scope === 'aoi') {
        this.el.classList.remove('cp-loading');
        this.key = null;
        this.el.querySelector('.profile-content').innerHTML = '';
        this.el.querySelector('.profile-heading').textContent = 'Drawn area';
        this.status.textContent = 'Choose a location, council or catchment for monthly climate summaries.';
        return;
      }
      if (key === this.key && this.data) { this.draw(); return; }
      // Dim the previous place until the new one arrives, so old figures never read as current.
      this.el.classList.add('cp-loading');
      if (!this.lookupPending) this.status.textContent = 'Loading climate…';
      try {
        const data = await ClimaScopeProfile.load(scope, state.member);
        if (seq !== this.sequence) return;
        this.key = key; this.data = data;
        this.draw();
      } catch (e) {
        if (seq !== this.sequence) return;
        this.el.classList.remove('cp-loading');
        this.key = null; this.data = null;
        this.el.querySelector('.profile-content').innerHTML = '';
        this.el.querySelector('.profile-heading').textContent = '';
        if (!this.lookupPending) this.status.textContent = e.message;
      }
    }
    drawScopes() {
      const holder = this.el.querySelector('.profile-scopes');
      holder.replaceChildren();
      if (!this.location) return;
      [['cell', '1 km cell'], ['catchment', 'Catchment'], ['council', 'Council']].forEach(([kind, label]) => {
        if (kind !== 'cell' && !this.location[kind]) return;
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = label;
        const active = kind === 'cell' ? this.cellSelected : !this.cellSelected && this.state.scope === kind + ':' + this.location[kind];
        button.setAttribute('aria-pressed', String(active));
        button.onclick = () => this.onScope(kind, this.location);
        holder.appendChild(button);
      });
    }
    draw() {
      const {data, state} = this;
      this.el.classList.remove('cp-loading');
      if (!this.lookupPending) this.status.textContent = '';
      const name = this.cellSelected ? this.location.name : data.name;
      const where = this.location?.distance_m ? `Nearest 1 km climate cell, ${this.location.distance_m} m away` : '1 km climate cell at this location';
      const detail = this.cellSelected ? `${where} · ${this.location.council || 'Scotland'}` : data.method;
      this.el.querySelector('.profile-heading').innerHTML = `<h2>${ClimaScopeProfile.escape(name)}</h2><p>${ClimaScopeProfile.escape(detail)} · ${ClimaScopeProfile.months[state.month - 1]}</p>`;
      ClimaScopeProfile.render(this.el.querySelector('.profile-content'), data, {month:state.month, period:state.period});
    }
  };
})();
