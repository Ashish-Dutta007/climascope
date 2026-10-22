(function () {
  'use strict';
  var SCENES = window.ClimaScopeScenes, query = new URLSearchParams(location.search);
  var token = Array.prototype.join.call(crypto.getRandomValues(new Uint32Array(4)), '-');
  var frame = document.getElementById('wall-frame'), loaded = false, pending = null, report = null;
  var selectedLocation = null, locationSequence = 0;
  var pendingLocation = null;
  function sameLocation(a, b) {
    return a && b && a.id === b.id && a.name === b.name &&
      a.longitude === b.longitude && a.latitude === b.latitude;
  }
  function locationScopes() {
    var holder = node('preview-location-scopes'); holder.replaceChildren();
    if (!selectedLocation) return;
    [['cell','This location'],['catchment','Catchment'],['council','Council']].forEach(function (entry) {
      var kind = entry[0]; if (kind !== 'cell' && !selectedLocation[kind]) return;
      var button = document.createElement('button'); button.type = 'button'; button.textContent = entry[1];
      button.onclick = function () { send({cmd:'set', scene:'local-climate', region:kind === 'cell' ? selectedLocation : {kind:kind,name:selectedLocation[kind]}}); };
      holder.appendChild(button);
    });
  }
  node('preview-postcode-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var seq = ++locationSequence; node('preview-location-status').textContent = 'Finding location…';
    ClimaScopeProfile.get('/api/location?' + new URLSearchParams({postcode:node('preview-postcode').value.trim()}))
      .then(function (place) {
        if (seq !== locationSequence) return;
        selectedLocation = place; pendingLocation = place; locationScopes();
        node('preview-location-status').textContent = place.name;
        send({cmd:'set', scene:'local-climate', region:place}, true);
      }).catch(function (e) { if (seq === locationSequence) node('preview-location-status').textContent = e.message; });
  });
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var metrics = ['CWBPT','Prec_sum','Tmax_mean'], members = ['01','04','05','06','07','08','09','10','11','12','13','15'];
  function node(id) { return document.getElementById(id); }
  function option(select, value, text) { var o = document.createElement('option'); o.value = value; o.textContent = text; select.appendChild(o); }
  SCENES.catalog.forEach(function (s) { option(node('scene-select'), s.id, s.title); });
  months.forEach(function (m, i) { option(node('month-select'), i + 1, m); });
  members.forEach(function (m) { option(node('member-select'), m, 'Member ' + m); });
  node('wall-size').value = query.get('width') === '15360' ? '15360' : '11514';
  node('scene-select').value = SCENES.valid(query.get('scene')) ? query.get('scene') : 'focus-water';
  node('month-select').value = /^[1-9]$|^1[0-2]$/.test(query.get('month') || '') ? query.get('month') : '7';
  node('member-select').value = members.indexOf(query.get('member')) >= 0 ? query.get('member') : 'mean';
  node('focus-select').value = metrics.indexOf(query.get('focus')) >= 0 ? query.get('focus') : 'CWBPT';
  function send(command, fromLookup) {
    if (!fromLookup && ((command.cmd === 'set' && (command.region || command.scene)) || command.cmd === 'places-play')) {
      locationSequence++;
      pendingLocation = null;
      if (node('preview-location-status').textContent === 'Finding location…') node('preview-location-status').textContent = '';
    }
    if (!loaded) { pending = {command:command, fromLookup:fromLookup}; return; }
    frame.contentWindow.postMessage({ type: 'climascope-preview-command', token: token, command: command }, location.origin);
  }
  var renderPlaces = ClimaScopePlaces.mount(node('saved-places'), send);
  renderPlaces(null);
  function describe() {
    node('member-select').options[0].textContent = node('scene-select').value === 'water-classes' ? 'Mean class areas' : 'Ensemble mean';
    node('scene-description').textContent = report && report.state.region.kind === 'cell'
      ? 'Choose Catchment or Council to use the other scenes.' : SCENES.get(node('scene-select').value).description;
    node('focus-select').disabled = node('scene-select').value !== 'agreement';
    node('focus-control').hidden = node('scene-select').value !== 'agreement';
  }
  function fit() {
    var width = +node('wall-size').value, mode = node('preview-scale').value;
    var scale = mode === 'fit' ? Math.min(1, (node('viewport').clientWidth - 2) / width) : +mode;
    frame.style.width = width + 'px'; frame.style.height = '1200px'; frame.style.transform = 'scale(' + scale + ')';
    node('frame-space').style.width = width * scale + 'px'; node('frame-space').style.height = 1200 * scale + 'px';
    node('dimensions').textContent = width.toLocaleString() + ' × 1,200 logical wall pixels · preview ' + Math.round(scale * 100) + '%';
  }
  function viewURL() {
    var q = new URLSearchParams({ width: node('wall-size').value, scene: node('scene-select').value, focus: node('focus-select').value,
      month: node('month-select').value, member: node('member-select').value });
    var state = report && report.state;
    if (state && state.region && state.region.kind) { q.set('kind', state.region.kind); q.set('region', state.region.name); }
    if (state && state.region.kind === 'cell') {
      q.set('cell', state.region.id); q.set('lon', state.region.longitude); q.set('lat', state.region.latitude);
    }
    return location.origin + location.pathname + '?' + q.toString();
  }
  ['scene-select','month-select','member-select','focus-select'].forEach(function (id) {
    node(id).addEventListener('change', function () {
      var cmd = { cmd: 'set' };
      cmd[{ 'scene-select': 'scene', 'month-select': 'month', 'member-select': 'member', 'focus-select': 'focus' }[id]] = id === 'month-select' ? +node(id).value : node(id).value;
      describe(); send(cmd);
    });
  });
  node('wall-size').addEventListener('change', fit); node('preview-scale').addEventListener('change', fit);
  node('prev-month').onclick = function () { send({ cmd: 'step', delta: -1 }); };
  node('next-month').onclick = function () { send({ cmd: 'step', delta: 1 }); };
  node('play-pause').onclick = function () { send({ cmd: report && report.state.playing ? 'pause' : 'play' }); };
  node('annual').onclick = function () { send({ cmd: 'play', playback: 'months' }); };
  node('tour').onclick = function () { send({ cmd: 'tour' }); };
  node('dwell-select').onchange = function () { send({ cmd: 'dwell', seconds: +node('dwell-select').value }); };
  node('reset-region').onclick = function () { send({ cmd: 'set', region: { kind: null, name: 'All Scotland' } }); };
  ['council','catchment'].forEach(function (kind) {
    node(kind + '-select').onchange = function () {
      send({ cmd: 'set', region: { kind: node(kind + '-select').value ? kind : null, name: node(kind + '-select').value || 'All Scotland' } });
    };
  });
  Promise.all([fetch('/api/councils').then(function (r) { if (!r.ok) throw new Error(); return r.json(); }),
    fetch('/api/catchments').then(function (r) { if (!r.ok) throw new Error(); return r.json(); })]).then(function (items) {
      items[0].features.map(function (f) { return f.properties.council_name; }).sort().forEach(function (name) { option(node('council-select'), name, name); });
      items[1].map(function (c) { return c.name; }).sort().forEach(function (name) { option(node('catchment-select'), name, name); });
      if (report) mirror(report);
    }).catch(function () { node('dimensions').textContent += ' · Region list unavailable'; });
  function mirror(r) {
    var s = r.state;
    renderPlaces(r);
    if (s.region.kind === 'cell' && (!pendingLocation || sameLocation(pendingLocation, s.region))) {
      selectedLocation = s.region;
      if (r.status === 'ready' && r.shown && r.shown.region === s.region.name) pendingLocation = null;
    }
    locationScopes();
    node('tour').disabled = s.region.kind === 'cell';
    Array.prototype.forEach.call(node('scene-select').options, function (option) { option.disabled = s.region.kind === 'cell' && option.value !== 'local-climate'; });
    node('scene-select').value = s.scene; node('focus-select').value = s.focus;
    node('month-select').value = String(s.month); node('member-select').value = s.member;
    node('council-select').value = s.region.kind === 'council' ? s.region.name : '';
    node('catchment-select').value = s.region.kind === 'catchment' ? s.region.name : '';
    node('play-pause').textContent = s.playing ? 'Pause' : 'Play';
    node('tour').classList.toggle('active', s.playing && s.playback === 'tour');
    node('annual').classList.toggle('active', s.playing && s.playback === 'months');
    if (!Array.prototype.some.call(node('dwell-select').options, function (o) { return +o.value === s.dwell; })) option(node('dwell-select'), s.dwell, s.dwell);
    node('dwell-select').value = String(s.dwell);
    var shown = r.shown, text = shown ? 'Displaying ' + SCENES.get(shown.scene).title + ' · ' + months[shown.month - 1] + ' · ' + shown.region : 'Preparing the wall';
    if (r.status === 'loading') text += ' · Updating…';
    if (s.playback === 'tour') text += ' · Scene ' + (s.tourIndex + 1) + '/' + SCENES.tour.length;
    if (s.playback === 'places') text += ' · Place ' + (s.placeIndex + 1) + '/' + s.places.length;
    if (r.message) text += ' · ' + r.message;
    node('preview-status').textContent = text; node('preview-status').className = r.status === 'error' ? 'error' : '';
    node('preview-status').dataset.status = r.status;
    describe();
    if (r.status === 'ready') history.replaceState(null, '', viewURL());
  }
  addEventListener('message', function (e) {
    if (e.origin !== location.origin || e.source !== frame.contentWindow || !e.data || e.data.type !== 'climascope-preview-report' || e.data.token !== token) return;
    report = e.data.report; mirror(report);
  });
  node('copy-link').onclick = function () {
    var link = viewURL();
    function fallback() { node('view-link').hidden = false; node('view-link').value = link; node('view-link').select(); }
    if (!navigator.clipboard) { fallback(); return; }
    navigator.clipboard.writeText(link).then(function () { node('copy-link').textContent = 'Copied'; setTimeout(function () { node('copy-link').textContent = 'Copy this view'; }, 1500); })
      .catch(fallback);
  };
  frame.onload = function () { loaded = true; if (pending) { var item = pending; pending = null; send(item.command, item.fromLookup); } };
  var initial = new URLSearchParams({ preview: token, fresh: '1', scene: node('scene-select').value, focus: node('focus-select').value,
    month: node('month-select').value, member: node('member-select').value });
  if (query.get('region') && ['council','catchment'].indexOf(query.get('kind')) >= 0) { initial.set('region', query.get('region')); initial.set('kind', query.get('kind')); }
  if (query.get('kind') === 'cell') ['kind','region','cell','lon','lat'].forEach(function (key) { if (query.has(key)) initial.set(key, query.get(key)); });
  fit(); describe(); frame.src = '/immersive?' + initial.toString(); addEventListener('resize', fit);
})();
