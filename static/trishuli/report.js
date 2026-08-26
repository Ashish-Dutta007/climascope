/* Trishuli corridor report - charts and tables. External file: page CSP forbids inline script. */
(function(){
'use strict';
var BASE = document.currentScript ? document.currentScript.dataset.base : '';
var T = {"sinuosity":1.19,"nodes":[{"node":"Rasuwagadhi / Timure (border)","river_km":0.0,"elev":1800,"h_fast":0.0,"h_mid":0.0,"h_slow":0.0},{"node":"Syabrubesi","river_km":15.9,"elev":1462,"h_fast":0.6,"h_mid":0.9,"h_slow":1.5},{"node":"Dhunche turn-off / Ramche","river_km":30.2,"elev":1056,"h_fast":1.0,"h_mid":1.7,"h_slow":2.8},{"node":"Betrawati","river_km":47.5,"elev":602,"h_fast":1.6,"h_mid":2.6,"h_slow":4.4},{"node":"Bidur / Trishuli Bazaar","river_km":61.3,"elev":462,"h_fast":2.1,"h_mid":3.4,"h_slow":5.7},{"node":"Devighat HEP","river_km":66.5,"elev":440,"h_fast":2.3,"h_mid":3.7,"h_slow":6.2},{"node":"Benighat (Budhi Gandaki confl.)","river_km":110.6,"elev":300,"h_fast":3.8,"h_mid":6.1,"h_slow":10.2},{"node":"Mugling","river_km":140.3,"elev":240,"h_fast":4.9,"h_mid":7.8,"h_slow":13.0},{"node":"Narayangadh / Devghat","river_km":166.2,"elev":180,"h_fast":5.8,"h_mid":9.2,"h_slow":15.4},{"node":"Gaindakot / Nawalparasi","river_km":167.6,"elev":175,"h_fast":5.8,"h_mid":9.3,"h_slow":15.5},{"node":"Tribeni (Nepal-India border)","river_km":234.9,"elev":110,"h_fast":8.2,"h_mid":13.0,"h_slow":21.7}]};
fetch(BASE + 'payload.json', {credentials:'same-origin'})
  .then(function(r){ if(!r.ok) throw new Error('payload.json HTTP '+r.status); return r.json(); })
  .then(function(payload){ render(payload, T); })
  .catch(function(e){
    var n=document.getElementById('rainchart');
    if(n) n.textContent='Figures failed to load: '+e.message;
  });

function render(P, T){

const $ = id => document.getElementById(id);
const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const NS = 'http://www.w3.org/2000/svg';

/* ---------- live counters ---------- */
const ONSET = Date.UTC(2026,7,26,2,45,0);          // ~08:30 NPT
const PASS  = Date.UTC(2026,7,28,12,21,41);        // orbit 85 ASC
function ticks(){
  const now = Date.now();
  const h = (now-ONSET)/3.6e6;
  $('elapsed').textContent = h>=48 ? (h/24).toFixed(1)+' d' : h.toFixed(1)+' h';
  const d = (PASS-now)/3.6e6;
  $('nextpass').textContent = d>0 ? '~'+d.toFixed(0)+' h' : 'due now';
}
ticks(); setInterval(ticks, 60000);

/* ---------- tooltip ---------- */
const tip = $('tip');
function bind(el, text){
  el.style.cursor='crosshair';
  el.addEventListener('pointerenter', e=>{ tip.textContent=text; tip.style.opacity='1'; });
  el.addEventListener('pointermove', e=>{
    const w=tip.offsetWidth, h=tip.offsetHeight;
    tip.style.left = Math.min(e.clientX+14, innerWidth-w-8)+'px';
    tip.style.top  = Math.max(e.clientY-h-12, 8)+'px';
  });
  el.addEventListener('pointerleave', ()=>{ tip.style.opacity='0'; });
}
function mk(tag, attrs){ const e=document.createElementNS(NS,tag);
  for(const k in attrs) e.setAttribute(k, attrs[k]); return e; }
function svg(w,h){ const s=mk('svg',{viewBox:`0 0 ${w} ${h}`, width:'100%', role:'img'}); return s; }

/* ---------- BSI colour bands ---------- */
function bsiCol(v){
  if(v>=0.75) return 'var(--crit)';
  if(v>=0.55) return 'var(--amber)';
  if(v>=0.30) return 'var(--accent)';
  return 'var(--muted)';
}
function bsiLab(v){ return v>=0.75?'very high':v>=0.55?'high':v>=0.30?'moderate':'low'; }

/* ================= 1. RAIN CHART ================= */
(function(){
  const rows = P.rain_tibet.map(r=>({...r, grp:'Tibetan source catchment'}))
             .concat(P.rain_corridor.map(r=>({...r, grp:'Nepal corridor'})));
  const W=880, rowH=25, padL=196, padR=112, top=54, H=top+rows.length*rowH+50;
  const s=svg(W,H); const max=Math.max(...rows.map(r=>r.p72))*1.06;
  const x=v=>padL+(v/max)*(W-padL-padR);
  s.appendChild(Object.assign(mk('text',{x:padL,y:20,fill:'var(--ink)','font-size':'12.5','font-weight':'600','font-family':'Archivo, sans-serif'}),{textContent:'Precipitation in the 72 hours before onset (mm)'}));
  [0,10,20,30,40,50,60].filter(v=>v<=max).forEach(v=>{
    s.appendChild(mk('line',{x1:x(v),x2:x(v),y1:top-10,y2:top+rows.length*rowH+4,stroke:'var(--line)','stroke-width':1}));
    s.appendChild(Object.assign(mk('text',{x:x(v),y:top+rows.length*rowH+22,fill:'var(--muted)','font-size':'10.5','text-anchor':'middle','font-family':'IBM Plex Mono, monospace'}),{textContent:v}));
  });
  let last='';
  rows.forEach((r,i)=>{
    const y=top+i*rowH;
    if(r.grp!==last){ last=r.grp;
      s.appendChild(Object.assign(mk('text',{x:6,y:y-7,fill:'var(--accent-ink)','font-size':'10','font-weight':'600','letter-spacing':'1.4','font-family':'Archivo, sans-serif'}),{textContent:r.grp.toUpperCase()}));
    }
    const dry = r.p72 < 2;
    const bar=mk('rect',{x:padL,y:y+5,width:Math.max(x(r.p72)-padL,1.5),height:13,rx:1.5,
      fill: dry?'var(--good)':'var(--accent)', opacity: dry?0.95:0.75});
    bind(bar, `${r.site}\nelev ${r.elev} m  (${r.lat}, ${r.lon})\n24 h  ${r.p24} mm\n72 h  ${r.p72} mm\n7 d   ${r.p168} mm\nnext 72 h forecast  ${r.fwd72} mm`);
    s.appendChild(bar);
    s.appendChild(Object.assign(mk('text',{x:padL-9,y:y+16,fill:'var(--ink-2)','font-size':'11.5','text-anchor':'end','font-family':'Archivo, sans-serif'}),{textContent:r.site}));
    s.appendChild(Object.assign(mk('text',{x:x(r.p72)+7,y:y+16,fill:dry?'var(--good)':'var(--ink)','font-size':'11','font-weight':dry?'600':'400','font-family':'IBM Plex Mono, monospace'}),{textContent:r.p72.toFixed(1)}));
  });
  $('rainchart').appendChild(s);
})();

/* ================= 2. LONG PROFILE ================= */
(function(){
  const R=P.reaches, W=880, H=330, padL=56, padR=18, top=30, plotH=196, stripeY=top+plotH+22;
  const s=svg(W,H);
  const xs=v=>padL+(v/62.5)*(W-padL-padR);
  const zmin=400, zmax=1850, ys=v=>top+plotH-((v-zmin)/(zmax-zmin))*plotH;
  [500,900,1300,1700].forEach(v=>{
    s.appendChild(mk('line',{x1:padL,x2:W-padR,y1:ys(v),y2:ys(v),stroke:'var(--line)','stroke-width':1}));
    s.appendChild(Object.assign(mk('text',{x:padL-8,y:ys(v)+4,fill:'var(--muted)','font-size':'10.5','text-anchor':'end','font-family':'IBM Plex Mono, monospace'}),{textContent:v}));
  });
  s.appendChild(Object.assign(mk('text',{x:padL-8,y:top-12,fill:'var(--muted)','font-size':'10','text-anchor':'end','font-family':'Archivo, sans-serif'}),{textContent:'m'}));
  const area=R.map(r=>`${xs(r.km)},${ys(r.z)}`).join(' ');
  s.appendChild(mk('polygon',{points:`${padL},${top+plotH} ${area} ${xs(62.5)},${top+plotH}`,fill:'var(--accent)',opacity:'0.11'}));
  s.appendChild(mk('polyline',{points:area,fill:'none',stroke:'var(--accent)','stroke-width':2,'stroke-linejoin':'round'}));
  // BSI stripe
  const bw=(W-padL-padR)/R.length;
  R.forEach((r,i)=>{
    const g=mk('g',{});
    g.appendChild(mk('rect',{x:padL+i*bw,y:stripeY,width:bw+0.6,height:22,fill:bsiCol(r.bsi),opacity:0.25+0.72*r.bsi}));
    g.appendChild(mk('rect',{x:padL+i*bw,y:top,width:bw+0.6,height:plotH,fill:'transparent'}));
    bind(g, `chainage ${r.km} km   elev ${r.z} m\n(${r.lat}, ${r.lon})\nchannel gradient ${r.grad} m/km\nslope >45 deg within 500 m: ${r.s45}%\nrelief within 500 m: ${r.relief} m\nblockage index ${r.bsi}  (${bsiLab(r.bsi)})`);
    s.appendChild(g);
  });
  s.appendChild(Object.assign(mk('text',{x:padL,y:stripeY-6,fill:'var(--muted)','font-size':'9.5','letter-spacing':'1.2','font-family':'Archivo, sans-serif'}),{textContent:'BLOCKAGE SUSCEPTIBILITY'}));
  // labels
  [[0,'Rasuwagadhi'],[15.9,'Syabrubesi'],[30.2,'Ramche'],[47.5,'Betrawati'],[61.3,'Bidur']].forEach(([k,n])=>{
    s.appendChild(mk('line',{x1:xs(k),x2:xs(k),y1:top,y2:top+plotH,stroke:'var(--ink-2)','stroke-width':0.8,'stroke-dasharray':'2 3',opacity:0.5}));
    s.appendChild(Object.assign(mk('text',{x:xs(k)+4,y:top+11,fill:'var(--ink-2)','font-size':'10','font-family':'Archivo, sans-serif'}),{textContent:n}));
  });
  [0,10,20,30,40,50,60].forEach(k=>
    s.appendChild(Object.assign(mk('text',{x:xs(k),y:H-12,fill:'var(--muted)','font-size':'10.5','text-anchor':'middle','font-family':'IBM Plex Mono, monospace'}),{textContent:k})));
  s.appendChild(Object.assign(mk('text',{x:W-padR,y:H-12,fill:'var(--muted)','font-size':'10','text-anchor':'end','font-family':'Archivo, sans-serif'}),{textContent:'river km downstream of border'}));
  $('profile').appendChild(s);
})();


/* ================= 3. CORRIDOR MAP ================= */
(function(){
  const stem=P.stem, W=880, H=560, pad=40;
  let lo=[999,999], hi=[-999,-999];
  stem.forEach(l=>l.forEach(([x,y])=>{lo[0]=Math.min(lo[0],x);lo[1]=Math.min(lo[1],y);hi[0]=Math.max(hi[0],x);hi[1]=Math.max(hi[1],y);}));
  const midLat=(lo[1]+hi[1])/2, kx=Math.cos(midLat*Math.PI/180);
  const dx=(hi[0]-lo[0])*kx, dy=hi[1]-lo[1];
  const sc=Math.min((W-2*pad)/dx,(H-2*pad)/dy);
  const ox=(W-dx*sc)/2, oy=(H-dy*sc)/2;
  const px=(x,y)=>[ox+(x-lo[0])*kx*sc, oy+(hi[1]-y)*sc];
  const s=svg(W,H);
  s.appendChild(mk('rect',{x:0,y:0,width:W,height:H,fill:'var(--surface-2)',rx:3}));
  // stem coloured by nearest reach BSI
  const R=P.reaches;
  function nearestBSI(x,y){ let best=null,bd=1e9;
    for(const r of R){ const d=(r.lon-x)**2+((r.lat-y)*1.0)**2; if(d<bd){bd=d;best=r;} } return best; }
  stem.forEach(line=>{
    for(let i=0;i<line.length-1;i++){
      const a=px(...line[i]), b=px(...line[i+1]);
      const r=nearestBSI(line[i][0],line[i][1]);
      const seg=mk('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],stroke:bsiCol(r.bsi),
        'stroke-width':4.2,'stroke-linecap':'round',opacity:0.45+0.55*r.bsi});
      bind(seg,`chainage ~${r.km} km  elev ${r.z} m\nblockage index ${r.bsi} (${bsiLab(r.bsi)})\nslope >45 deg: ${r.s45}%   relief ${r.relief} m`);
      s.appendChild(seg);
    }
  });
  // markers
  function plot(list, sym, fill, label, size){
    list.forEach(o=>{
      if(o.d>1500) return;
      const [X,Y]=px(o.lon,o.lat);
      let e;
      if(sym==='sq'){ e=mk('rect',{x:X-size,y:Y-size,width:size*2,height:size*2,fill:fill,stroke:'var(--surface)','stroke-width':0.9}); }
      else if(sym==='tri'){ e=mk('polygon',{points:`${X},${Y-size*1.2} ${X-size},${Y+size*0.8} ${X+size},${Y+size*0.8}`,fill:fill,stroke:'var(--surface)','stroke-width':0.9}); }
      else { e=mk('circle',{cx:X,cy:Y,r:size,fill:fill,stroke:'var(--surface)','stroke-width':0.9}); }
      bind(e, `${label}: ${o.name||'unnamed'}\n${o.lat}, ${o.lon}\n${o.d} m from channel`);
      s.appendChild(e);
    });
  }
  plot(P.places.filter(p=>p.d<1500), 'dot','var(--muted)','Settlement',2.1);
  plot(P.education,'sq','var(--accent)','School',2.4);
  plot(P.bridges,'dot','var(--crit)','Bridge',2.8);
  plot(P.helipads,'tri','var(--amber)','Aeroway',3.2);
  plot(P.health,'sq','var(--good)','Health facility',3.6);
  // named anchors
  [[85.3780,28.2760,'Rasuwagadhi / Timure'],[85.3350,28.1620,'Syabrubesi'],
   [85.1830,27.9720,'Betrawati'],[85.1600,27.8700,'Bidur']].forEach(([x,y,n])=>{
    const [X,Y]=px(x,y);
    s.appendChild(mk('circle',{cx:X,cy:Y,r:4.6,fill:'none',stroke:'var(--ink)','stroke-width':1.5}));
    s.appendChild(Object.assign(mk('text',{x:X+9,y:Y+4,fill:'var(--ink)','font-size':'11.5','font-weight':'600','font-family':'Archivo, sans-serif'}),{textContent:n}));
  });
  // north arrow + scale
  s.appendChild(Object.assign(mk('text',{x:W-26,y:34,fill:'var(--ink-2)','font-size':'13','font-weight':'600','text-anchor':'middle','font-family':'Archivo, sans-serif'}),{textContent:'N'}));
  s.appendChild(mk('path',{d:`M ${W-26} 40 L ${W-26} 58 M ${W-26} 40 L ${W-30} 47 M ${W-26} 40 L ${W-22} 47`,stroke:'var(--ink-2)','stroke-width':1.4,fill:'none'}));
  const kmpx=sc*(1/111.32); const barw=kmpx*5;
  s.appendChild(mk('line',{x1:20,y1:H-24,x2:20+barw,y2:H-24,stroke:'var(--ink-2)','stroke-width':2.2}));
  s.appendChild(Object.assign(mk('text',{x:20,y:H-30,fill:'var(--ink-2)','font-size':'10.5','font-family':'IBM Plex Mono, monospace'}),{textContent:'5 km'}));
  // legend
  const L=[['var(--crit)','dot','Bridge (69)'],['var(--accent)','sq','School (58)'],
           ['var(--good)','sq','Health (6)'],['var(--amber)','tri','Helipad / aeroway'],
           ['var(--muted)','dot','Settlement']];
  L.forEach((l,i)=>{
    const y=H-108+i*17;
    if(l[1]==='sq') s.appendChild(mk('rect',{x:17,y:y-4,width:7,height:7,fill:l[0]}));
    else if(l[1]==='tri') s.appendChild(mk('polygon',{points:`20.5,${y-5} 16,${y+3} 25,${y+3}`,fill:l[0]}));
    else s.appendChild(mk('circle',{cx:20.5,cy:y,r:3.4,fill:l[0]}));
    s.appendChild(Object.assign(mk('text',{x:32,y:y+4,fill:'var(--ink-2)','font-size':'11','font-family':'Archivo, sans-serif'}),{textContent:l[2]}));
  });
  $('map').appendChild(s);
})();

/* ================= 4. SATELLITE TIMELINE ================= */
(function(){
  const acq=[
    {d:'2026-08-04T12:21',lab:'orbit 85 ASC',type:'S1',fut:0},
    {d:'2026-08-07T00:10',lab:'orbit 121 DESC',type:'S1',fut:0},
    {d:'2026-08-12T00:18',lab:'orbit 19 DESC',type:'S1',fut:0},
    {d:'2026-08-16T12:21',lab:'orbit 85 ASC  PRE-PAIR',type:'S1',fut:0,key:1},
    {d:'2026-08-19T00:10',lab:'orbit 121 DESC  PRE-PAIR',type:'S1',fut:0,key:1},
    {d:'2026-08-24T00:18',lab:'orbit 19 DESC  PRE-PAIR',type:'S1',fut:0,key:1},
    {d:'2026-08-28T12:21',lab:'orbit 85 ASC  FIRST POST-EVENT',type:'S1',fut:1,key:2},
    {d:'2026-08-31T00:10',lab:'orbit 121 DESC',type:'S1',fut:1},
    {d:'2026-09-05T00:18',lab:'orbit 19 DESC',type:'S1',fut:1},
    {d:'2026-08-12T04:57',lab:'S2C  cloud 18.7%',type:'S2',fut:0,cc:18.7},
    {d:'2026-08-17T04:57',lab:'S2B  cloud 97.1%',type:'S2',fut:0,cc:97.1},
    {d:'2026-08-22T04:57',lab:'S2C  cloud 78.2%',type:'S2',fut:0,cc:78.2},
    {d:'2026-08-24T05:02',lab:'S2A  cloud 51.0%',type:'S2',fut:0,cc:51},
    {d:'2026-08-27T04:57',lab:'S2B  next R119 pass',type:'S2',fut:1}
  ];
  const t0=Date.parse('2026-08-03T00:00Z'), t1=Date.parse('2026-09-07T00:00Z');
  const W=880, padL=112, padR=20, H=250;
  const s=svg(W,H);
  const x=d=>padL+((Date.parse(d+'Z')-t0)/(t1-t0))*(W-padL-padR);
  const lanes={S1:{y:70,lab:'SENTINEL-1 SAR'},S2:{y:170,lab:'SENTINEL-2 OPTICAL'}};
  // event line
  const ex=x('2026-08-26T02:45');
  s.appendChild(mk('rect',{x:ex,y:24,width:W-padR-ex,height:H-52,fill:'var(--crit)',opacity:0.055}));
  s.appendChild(mk('line',{x1:ex,x2:ex,y1:24,y2:H-28,stroke:'var(--crit)','stroke-width':1.8}));
  s.appendChild(Object.assign(mk('text',{x:ex+6,y:20,fill:'var(--crit)','font-size':'10.5','font-weight':'600','font-family':'Archivo, sans-serif'}),{textContent:'FLOOD ONSET 26 AUG'}));
  for(const k in lanes){ const L=lanes[k];
    s.appendChild(mk('line',{x1:padL,x2:W-padR,y1:L.y,y2:L.y,stroke:'var(--line)','stroke-width':1.4}));
    s.appendChild(Object.assign(mk('text',{x:padL-10,y:L.y+4,fill:'var(--ink-2)','font-size':'10','font-weight':'600','text-anchor':'end','letter-spacing':'0.9','font-family':'Archivo, sans-serif'}),{textContent:L.lab}));
  }
  acq.forEach((a,i)=>{
    const L=lanes[a.type], X=x(a.d);
    const col = a.key===2?'var(--crit)': a.key===1?'var(--accent)': a.fut?'var(--muted)':'var(--ink-2)';
    const g=mk('g',{});
    if(a.fut) g.appendChild(mk('circle',{cx:X,cy:L.y,r:a.key===2?7:5,fill:'var(--surface)',stroke:col,'stroke-width':2,'stroke-dasharray':a.key===2?'':'2.5 2'}));
    else g.appendChild(mk('circle',{cx:X,cy:L.y,r:a.key?5.5:4,fill:col}));
    const up = a.type==='S1' ? (i%2===0?-1:1) : (i%2===0?1:-1);
    const ly = L.y + up*(a.key===2?30:20);
    g.appendChild(mk('line',{x1:X,y1:L.y+up*7,x2:X,y2:ly-up*3,stroke:col,'stroke-width':0.9,opacity:0.55}));
    g.appendChild(Object.assign(mk('text',{x:X,y:ly+(up<0?0:8),fill:col,'font-size':a.key===2?'10.5':'9.5','font-weight':a.key?'600':'400','text-anchor':'middle','font-family':'Archivo, sans-serif'}),{textContent:a.lab}));
    bind(g, `${a.d.replace('T',' ')} UTC\n${a.type==='S1'?'Sentinel-1 GRD':'Sentinel-2 L2A'}\n${a.lab}${a.fut?'\n(projected from 12-day repeat)':'\n(indexed in catalogue)'}`);
    s.appendChild(g);
  });
  ['2026-08-05','2026-08-12','2026-08-19','2026-08-26','2026-09-02'].forEach(d=>{
    s.appendChild(Object.assign(mk('text',{x:x(d+'T00:00'),y:H-10,fill:'var(--muted)','font-size':'10','text-anchor':'middle','font-family':'IBM Plex Mono, monospace'}),{textContent:d.slice(5)}));
  });
  $('timeline').appendChild(s);
})();

/* ================= 5. TABLES ================= */
(function(){
  $('exptbl').innerHTML = P.exposure.map(r=>
    `<tr><td><strong>${esc(r.layer)}</strong></td><td class="num">${r.total.toLocaleString()}</td>
     <td class="num">${r.b100.toLocaleString()}</td><td class="num">${r.b250.toLocaleString()}</td>
     <td class="num">${r.b500.toLocaleString()}</td></tr>`).join('')
   + `<tr><td><strong>Major roads (km)</strong></td><td class="num">${P.roads.maj_km}</td>
      <td class="num">&mdash;</td><td class="num">${P.roads.maj_250}</td><td class="num">${P.roads.maj_500}</td></tr>`
   + `<tr><td><strong>All roads (km)</strong></td><td class="num">${P.roads.all_km}</td>
      <td class="num">&mdash;</td><td class="num">${P.roads.all_250}</td><td class="num">${P.roads.all_500}</td></tr>`;

  const onsetNPT = 8.5;
  const fmt = h => { let t=onsetNPT+h; const d=t>=24?' +1d':''; t=t%24;
    const hh=Math.floor(t), mm=Math.round((t-hh)*60);
    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}${d}`; };
  $('tttbl').innerHTML = T.nodes.map(n=>
    `<tr><td><strong>${esc(n.node)}</strong></td><td class="num">${n.river_km}</td><td class="num">${n.elev}</td>
     <td class="num">${n.h_fast} h</td><td class="num">${n.h_mid} h</td><td class="num">${n.h_slow} h</td>
     <td class="mono" style="white-space:nowrap;font-size:12.5px">${fmt(n.h_fast)} &ndash; ${fmt(n.h_slow)}</td></tr>`).join('');
})();

}
})();
