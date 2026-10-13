(function () {
  'use strict';
  var catalog = [
    { id: 'overview', title: 'Compare all metrics', kind: 'overview', description: 'Three climate indicators and three periods, with seasonal values and monthly changes.' },
    { id: 'focus-water', title: 'Water balance', kind: 'focus', metric: 'CWBPT', description: 'Where and when does climate water balance change?' },
    { id: 'focus-rain', title: 'Precipitation', kind: 'focus', metric: 'Prec_sum', description: 'Compare monthly precipitation patterns and changes.' },
    { id: 'focus-heat', title: 'Temperature', kind: 'focus', metric: 'Tmax_mean', description: 'Compare mean daily maximum temperatures, not hottest-day extremes.' },
    { id: 'water-extent', title: 'Beyond the regional mean', kind: 'extent', metric: 'CWBPT', description: 'What share of valid climate cells has monthly water balance below zero?' },
    { id: 'landscape', title: 'Landscape context', kind: 'landscape', metric: 'CWBPT', description: 'How does negative water balance coincide with existing land cover?' },
    { id: 'agreement', title: 'Ensemble agreement', kind: 'agreement', description: 'Compare changes in regional means across the twelve available ensemble members.' }
  ];
  var tour = [
    { scene: 'overview', month: 1, hold: 2 },
    { scene: 'focus-heat', month: 7, hold: 2 },
    { scene: 'focus-rain', month: 7, hold: 2 },
    { scene: 'focus-water', month: 7, hold: 2 },
    { scene: 'water-extent', month: 7, hold: 3 },
    { scene: 'landscape', month: 7, hold: 3 },
    { scene: 'agreement', focus: 'CWBPT', month: 7, hold: 3 },
    { scene: 'focus-water', month: 1, hold: 2 }
  ];
  function get(id) {
    return catalog.find(function (s) { return s.id === id; }) || catalog[0];
  }
  function valid(id) { return catalog.some(function (s) { return s.id === id; }); }
  function metric(scene, focus) { return get(scene).metric || focus || 'CWBPT'; }
  window.ClimaScopeScenes = { catalog: catalog, tour: tour, get: get, valid: valid, metric: metric };
})();
