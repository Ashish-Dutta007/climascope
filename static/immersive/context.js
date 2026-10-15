(function () {
  'use strict';
  var palette = ['#4ade80','#60a5fa','#f59e0b','#a78bfa','#34d399','#f87171','#38bdf8','#fb923c','#c084fc','#2dd4bf'];
  var classNames = ['Strong Deficit','Moderate Deficit','Moderate Surplus','Strong Surplus'];
  var classColors = ['#b2182b','#ef8a62','#67a9cf','#2166ac'];
  var periods = ['1990-2019','2020-2049','2050-2079'];
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var land, cwr, landPromise, cwrFlight, cwrCache;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function scope(region) { return region && region.kind ? region.kind + ':' + region.name : 'national'; }
  function name(region) { return region && region.kind ? region.name : 'Scotland'; }
  function area(v) { return v.toLocaleString('en-GB', {maximumFractionDigits: v < 10 ? 1 : 0}); }
  function get(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error('Context data unavailable (HTTP ' + r.status + ')'); return r.json(); }); }
  function loadLand() {
    if (!landPromise) {
      landPromise = Promise.all([get('/api/landcover/dominant'), get('/static/immersive/summaries/landcover-v1.json')]);
      landPromise.catch(function () { landPromise = null; });
    }
    return landPromise;
  }
  function loadCWR(target, isCurrent) {
    var key = scope(target.region) + '|' + target.member;
    if (cwrCache && cwrCache.key === key) return Promise.resolve(cwrCache.data);
    if (cwrFlight && cwrFlight.key === key) return cwrFlight.promise;
    var wait = cwrFlight ? cwrFlight.promise.catch(function () {}) : Promise.resolve();
    return wait.then(function () {
      if (!isCurrent()) throw {superseded:true};
      if (cwrCache && cwrCache.key === key) return cwrCache.data;
      if (cwrFlight) return loadCWR(target, isCurrent);
      var p = get('/api/immersive/cwr?scope=' + encodeURIComponent(scope(target.region)) + '&member=' + target.member)
        .then(function (data) { cwrCache = {key:key, data:data}; return data; });
      cwrFlight = {key:key, promise:p};
      p.then(function () { cwrFlight = null; }, function () { cwrFlight = null; });
      return p;
    });
  }
  function load(target, isCurrent) {
    if (target.scene === 'overview' || target.scene === 'landscape') return loadLand().then(function (data) { return {land:data}; });
    if (target.scene === 'water-classes') return loadCWR(target, isCurrent).then(function (data) { return {cwr:data}; });
    return Promise.resolve(null);
  }
  function shell(container, cls) {
    var root = document.createElement('section'); root.className = 'context-panel ' + cls; root.hidden = true;
    root.innerHTML = '<div class="ctx"><span class="ctx-sel"></span><span class="ctx-chip"></span><span class="ctx-right"><span class="ctx-mode"></span></span><div class="ctx-bar-track"><div class="ctx-bar"></div></div></div>';
    container.appendChild(root); return root;
  }
  function build(container) {
    land = {root:shell(container, 'land-panel'), painted:false};
    land.root.innerHTML += '<div class="context-title">Current land cover</div><div class="context-label">Dominant cover per 1 km cell</div>' +
      '<div class="mapcell context-map"><div class="map-canvas" id="map-landcover"></div></div>' +
      '<div class="land-map-note">Fixed cover · same for all periods<br><span class="cover-nodata"></span>No cover data</div><div class="land-area"><h2>Land-cover area</h2><p>Estimated km² · colours match the map</p><div class="area-plot"></div><p class="area-total"></p></div>';
    cwr = {root:shell(container, 'cwr-panel')};
    cwr.root.innerHTML += '<div class="context-title">Climate water ratio · PT</div><div class="cwr-body"><aside class="cwr-key"></aside>' +
      periods.map(function (period) { return '<section class="cwr-period" data-period="'+period+'"><h2>'+period.replace('-', '–')+'</h2><h3>CWR PT · monthly class shares</h3><p>% of classified land-use area</p><div class="cwr-months"></div><h3 class="cwr-month-title"></h3><p>Classified land-use area · km²</p><div class="cwr-land-use"></div></section>'; }).join('') + '</div><p class="cwr-source">Land-use summaries · whole catchments</p>';
  }
  function createMap(makeMap) {
    return makeMap('map-landcover', [[0,'#4a4f66'],[1,'#4a4f66']]).then(function (map) {
      land.map = map;
      var expr = ['match',['coalesce',['feature-state','cover'],-1]];
      palette.forEach(function (color, i) { expr.push(i+1,color); }); expr.push('#4a4f66');
      map.setPaintProperty('cells-fill', 'fill-color', expr);
      return map;
    });
  }
  function layout(frame) {
    land.root.hidden = frame.scene !== 'overview' && frame.scene !== 'landscape';
    land.root.style.order = frame.scene === 'landscape' ? '3' : '4';
    cwr.root.hidden = frame.scene !== 'water-classes';
  }
  function landChart(data, region) {
    var classes = data._meta.classes, item = data.regions[scope(region)];
    if (!item) throw new Error('Land-cover area unavailable for '+name(region));
    var rows = classes.map(function (c,i) { return {code:c.code, name:c.name, value:item.areas_km2[i]}; }).sort(function (a,b) { return b.value-a.value; });
    var W=1200,H=900,L=25,R=180,top=15,band=85,max=Math.max.apply(null,rows.map(function (r) { return r.value; })) || 1;
    var svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Estimated land-cover area in '+esc(name(region))+'">';
    rows.forEach(function (r,i) { var y=top+i*band, color=palette[r.code-1];
      svg += '<g data-cover="'+r.code+'" data-area-km2="'+r.value+'"><rect x="'+L+'" y="'+y+'" width="24" height="24" fill="'+color+'"/>' +
        '<text x="'+(L+40)+'" y="'+(y+26)+'" fill="#e6ecfb" font-size="35">'+esc(r.name)+'</text>' +
        '<rect x="'+L+'" y="'+(y+40)+'" width="'+(W-L-R)+'" height="24" fill="#ffffff09"/>' +
        '<rect x="'+L+'" y="'+(y+40)+'" width="'+((W-L-R)*r.value/max)+'" height="24" fill="'+color+'"/>' +
        '<text x="'+(W-15)+'" y="'+(y+63)+'" text-anchor="end" fill="#e6ecfb" font-size="34">'+area(r.value)+'</text></g>';
    });
    land.root.querySelector('.area-plot').innerHTML=svg+'</svg>';
    land.root.querySelector('.area-total').textContent=name(region)+' · '+area(item.total_km2)+' km² mapped cover';
  }
  function monthlyChart(items, selected) {
    var W=1400,H=350,L=80,R=20,T=15,B=50,pw=W-L-R,ph=H-T-B,bw=pw/12;
    var svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Monthly CWR PT class shares">';
    [0,50,100].forEach(function (v) { var y=T+ph*(1-v/100); svg+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y+'" y2="'+y+'" stroke="#394354"/><text x="'+(L-12)+'" y="'+(y+10)+'" text-anchor="end" fill="#bdcce0" font-size="30">'+v+'</text>'; });
    items.forEach(function (item,i) { var bottom=T+ph,x=L+i*bw+bw*.12;
      item.classes_km2.forEach(function (value,j) { var h=item.total_km2 ? ph*value/item.total_km2 : 0; bottom-=h;
        svg+='<rect data-month="'+(i+1)+'" data-class="'+j+'" data-area-km2="'+value+'" x="'+x+'" y="'+bottom+'" width="'+bw*.76+'" height="'+h+'" fill="'+classColors[j]+'"/>'; });
      if(i===selected) svg+='<rect x="'+(x-4)+'" y="'+(T-4)+'" width="'+(bw*.76+8)+'" height="'+(ph+8)+'" fill="none" stroke="#f4f7fc" stroke-width="4"/>';
      svg+='<text x="'+(L+(i+.5)*bw)+'" y="'+(H-12)+'" text-anchor="middle" fill="'+(i===selected?'#fff':'#bdcce0')+'" font-size="30">'+months[i]+'</text>';
    }); return svg+'</svg>';
  }
  function landUseChart(item, types, max) {
    var W=1400,H=455,L=25,R=185,band=57,pw=W-L-R;
    var svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="CWR PT class areas by land use">';
    if(!item.total_km2) return svg+'<text x="25" y="100" fill="#bdcce0" font-size="36">No classified land-use areas</text></svg>';
    types.forEach(function (type,i) { var values=item.land_use[type]||[0,0,0,0],x=L,y=32+i*band,total=values.reduce(function (a,b) {return a+b;},0);
      svg+='<text x="'+L+'" y="'+y+'" fill="#e6ecfb" font-size="31">'+esc(type)+'</text>';
      values.forEach(function (v,j) { var width=pw*v/max; svg+='<rect data-use="'+esc(type)+'" data-class="'+j+'" data-area-km2="'+v+'" x="'+x+'" y="'+(y+10)+'" width="'+width+'" height="24" fill="'+classColors[j]+'"/>'; x+=width; });
      svg+='<text x="'+(W-10)+'" y="'+(y+32)+'" fill="#e6ecfb" text-anchor="end" font-size="31">'+area(total)+'</text>';
    });
    svg+='<text x="'+L+'" y="448" fill="#bdcce0" font-size="28">0</text><text x="'+(L+pw)+'" y="448" fill="#bdcce0" text-anchor="end" font-size="28">'+area(max)+' km² · same scale across months and periods</text>';
    return svg+'</svg>';
  }
  function render(frame) {
    if(frame.context && frame.context.land) {
      var dom=frame.context.land[0], summary=frame.context.land[1];
      if(!land.painted) { dom.ids.forEach(function (id,i) { land.map.setFeatureState({source:'cells-vt',sourceLayer:'cells',id:id},{cover:dom.codes[i]}); }); land.painted=true; }
      landChart(summary,frame.region);
    }
    if(frame.context && frame.context.cwr) {
      var data=frame.context.cwr, mi=frame.month-1, types=[], max=1;
      periods.forEach(function (p) { data.periods[p].forEach(function (item) { Object.keys(item.land_use).forEach(function (t) { if(types.indexOf(t)<0) types.push(t); }); }); });
      function annual(type) { return data.periods[periods[0]].reduce(function (s,item) { return s+(item.land_use[type]||[]).reduce(function (a,b) {return a+b;},0); },0); }
      types.sort(function (a,b) { return annual(b)-annual(a) || a.localeCompare(b); });
      periods.forEach(function (p) { data.periods[p].forEach(function (item) { types.forEach(function (t) { max=Math.max(max,(item.land_use[t]||[]).reduce(function (a,b) {return a+b;},0)); }); }); });
      cwr.root.querySelector('.cwr-key').innerHTML='<h2>Four classes</h2>'+classNames.map(function (c,i) {return '<p><span style="background:'+classColors[i]+'"></span>'+c+'</p>';}).join('') +
        '<div class="cwr-description">'+esc(data.ensemble_label)+'</div><div class="cwr-description">'+esc(data.scope_label)+'</div>';
      cwr.root.querySelectorAll('.cwr-period').forEach(function (node,i) {
        var items=data.periods[periods[i]], item=items[mi];
        node.querySelector('.cwr-months').innerHTML=monthlyChart(items,mi);
        node.querySelector('.cwr-month-title').textContent='CWR PT · '+months[mi]+' by land use';
        node.querySelector('.cwr-land-use').innerHTML=landUseChart(item,types,max);
      });
    }
  }
  function context(frame, status, mode) {
    [land,cwr].forEach(function (panel) {
      var label=frame ? name(frame.region) : 'Preparing display';
      if(frame && panel===land) label+=' · fixed cover';
      if(frame && panel===cwr && frame.context && frame.context.cwr) label=months[frame.month-1]+' · '+frame.context.cwr.scope_label+' · '+frame.context.cwr.ensemble_label;
      panel.root.querySelector('.ctx-sel').textContent=label;
      var chip=panel.root.querySelector('.ctx-chip'); chip.textContent=status.message || (status.kind==='loading'?'Loading…':''); chip.className='ctx-chip '+status.kind;
      panel.root.querySelector('.ctx-mode').textContent=mode;
    });
  }
  function dwell(seconds) {
    [land,cwr].forEach(function (panel) {var bar=panel.root.querySelector('.ctx-bar');bar.style.transition='none';bar.style.width='0%';void bar.offsetWidth;if(seconds>0){bar.style.transition='width '+seconds+'s linear';bar.style.width='100%';}});
  }
  window.ClimaScopeContext={build:build,createMap:createMap,load:load,layout:layout,render:render,context:context,dwell:dwell,
    activeMaps:function () {return land.map && !land.root.hidden ? [land.map] : [];}};
})();
