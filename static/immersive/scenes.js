(function () {
  'use strict';
  var catalog = [
    { id: 'overview', title: 'Overview', kind: 'overview', description: 'Three climate metrics and current land cover.' },
    { id: 'focus-water', title: 'Water balance', kind: 'focus', metric: 'CWBPT', description: 'Monthly water balance and change from 1990–2019.' },
    { id: 'focus-rain', title: 'Precipitation', kind: 'focus', metric: 'Prec_sum', description: 'Monthly precipitation and change from 1990–2019.' },
    { id: 'focus-heat', title: 'Mean daily maximum temperature', kind: 'focus', metric: 'Tmax_mean', description: 'Mean daily maximum temperature and change from 1990–2019.' },
    { id: 'water-extent', title: 'Negative water balance', kind: 'extent', metric: 'CWBPT', description: 'Share of valid cells with water balance below zero.' },
    { id: 'landscape', title: 'Land cover', kind: 'landscape', metric: 'CWBPT', description: 'Water balance below zero within each land-cover class.' },
    { id: 'water-classes', title: 'Water ratio classes', kind: 'cwr', metric: 'CWBPT', description: 'CWR PT: monthly land-use areas in four classes.' },
    { id: 'agreement', title: 'Member spread', kind: 'agreement', description: 'Changes in regional means across 12 ensemble members.' },
    { id: 'local-climate', title: 'Climate near you', kind: 'local', description: 'A location’s monthly climate and changes in the surrounding area.' }
  ];
  var tour = [
    { scene: 'overview', month: 1, hold: 2 },
    { scene: 'focus-heat', month: 7, hold: 2 },
    { scene: 'focus-rain', month: 7, hold: 2 },
    { scene: 'focus-water', month: 7, hold: 2 },
    { scene: 'water-extent', month: 7, hold: 3 },
    { scene: 'landscape', month: 7, hold: 3 },
    { scene: 'water-classes', month: 7, hold: 3 },
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
