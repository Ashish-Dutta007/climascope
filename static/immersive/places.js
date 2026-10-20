(function () {
  'use strict';
  function key(place) { return place.id + '@' + place.longitude.toFixed(6) + ',' + place.latitude.toFixed(6); }
  function mount(root, send) {
    root.innerHTML = '<div class="places-actions"><button type="button" class="places-save">Save this place</button>' +
      '<button type="button" class="places-play">Place loop</button><span class="places-progress" aria-live="polite"></span></div>' +
      '<ul class="places-list"></ul>';
    var save = root.querySelector('.places-save'), play = root.querySelector('.places-play');
    var list = root.querySelector('.places-list'), lastList = '';
    save.onclick = function () { send({cmd:'save-place'}); };
    play.onclick = function () { send({cmd:'places-play'}); };
    return function (report) {
      var s = report && report.state, places = s && s.places || [];
      var place = s && s.region, shown = report && report.shown;
      save.disabled = !s || (report.status !== 'ready' && report.status !== 'warning') || !shown ||
        place.kind !== 'cell' || shown.region !== place.name || places.length >= 8 ||
        places.some(function (entry) { return key(entry) === key(place); });
      play.disabled = !places.length;
      play.classList.toggle('active', !!s && s.playing && s.playback === 'places');
      root.querySelector('.places-progress').textContent = s && s.playback === 'places'
        ? 'Place ' + (s.placeIndex + 1) + ' of ' + places.length + (s.playing ? '' : ' · paused') : '';
      var nextList = JSON.stringify(places);
      if (nextList === lastList) return;
      lastList = nextList; list.replaceChildren();
      places.forEach(function (entry) {
        var row = document.createElement('li'), name = document.createElement('span'), remove = document.createElement('button');
        name.textContent = entry.name;
        remove.type = 'button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label','Remove ' + entry.name);
        remove.onclick = function () { send({cmd:'remove-place',placeKey:key(entry)}); };
        row.append(name,remove); list.appendChild(row);
      });
    };
  }
  window.ClimaScopePlaces = {mount:mount};
})();
