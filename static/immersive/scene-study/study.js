'use strict';
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const METRICS={CWBPT:{title:'Water balance',unit:'mm',limit:160},Prec_sum:{title:'Precipitation',unit:'mm',limit:160},Tmax_mean:{title:'Mean daily maximum temperature',unit:'°C',limit:6},ETPT_sum:{title:'PT evapotranspiration',unit:'mm',limit:160}};
const $=s=>document.querySelector(s), wall=$('#wall');
let DATA,bytes,coords,state={view:'components',metric:'CWBPT',month:6,member:'mean'};
const imageCache=new Map();
function signed(x){return (x<0?'−':x>0?'+':'')+Math.abs(x).toFixed(1)}
function colour(t,temperature){const white=[247,247,247],lo=temperature?[33,102,172]:[178,24,43],hi=temperature?[178,24,43]:[33,102,172],end=t<.5?lo:hi,f=Math.abs(t*2-1);return white.map((v,i)=>Math.round(v+(end[i]-v)*f))}
function mapCanvas(key,metric,effect=false){
 const c=document.createElement('canvas');c.width=DATA.grid.width;c.height=DATA.grid.height;c.setAttribute('role','img');c.setAttribute('aria-label',METRICS[metric].title+' change map');
 const ctx=c.getContext('2d');
 const cacheKey=key+(effect?':effect':'');if(imageCache.has(cacheKey)){ctx.drawImage(imageCache.get(cacheKey),0,0);return c}
 const frame=DATA.frames[key],im=ctx.createImageData(c.width,c.height),palette=Array.from({length:256},(_,i)=>i?colour(effect?1-(i-1)/254:(i-1)/254,metric==='Tmax_mean'):[78,84,100]);
 for(let i=0;i<DATA.grid.cells;i++){
  const idx=(coords[i*2+1]*c.width+coords[i*2])*4,col=palette[bytes[frame.offset+i]];
  im.data[idx]=col[0];im.data[idx+1]=col[1];im.data[idx+2]=col[2];im.data[idx+3]=255;
 }
 ctx.putImageData(im,0,0);imageCache.set(cacheKey,c);return c;
}
function legend(metric,frame,effect,atlas){const m=METRICS[metric],limit=frame.limit||m.limit,c=metric==='Tmax_mean'?'linear-gradient(to right,#2166ac,#f7f7f7,#b2182b)':'',low=effect?frame.clip_high:frame.clip_low,high=effect?frame.clip_low:frame.clip_high,label=atlas?(state.view==='members'?'July · shared member scale':'Same scale all months'):'Shared mm scale';return '<div class="legend"><div class="legend-title">'+label+'</div><div class="legend-bar" style="background:'+c+'"></div><div class="legend-numbers"><span>'+(low?'≤':'')+'−'+limit+'</span><span>0</span><span>'+(high?'≥':'')+'+'+limit+' '+m.unit+'</span></div></div>'}
function card({key,metric,title,context,atlas=false,selected=false,effect=false}){
 const d=document.createElement('article');d.className='card '+(atlas?'atlas':'component')+(selected?' selected':'');
 const value=DATA.frames[key].mean*(effect?-1:1);
 d.innerHTML=(atlas?'<div class="metric-title">'+METRICS[metric].title+'</div>':'')+'<h2>'+title+'</h2><p class="context">'+context+'</p>'+legend(metric,DATA.frames[key],effect,atlas)+'<div class="map-wrap"></div><p class="stat">'+signed(value)+' <span>'+METRICS[metric].unit+'</span></p><p class="stat-caption">'+(effect?'Scotland mean contribution':'Scotland mean change')+'</p>';
 d.querySelector('.map-wrap').append(mapCanvas(key,metric,effect));return d;
}
function chart(){
 const series=[{m:'Prec_sum',label:'Precipitation',c:'#77d1d5'},{m:'ETPT_sum',label:'PT contribution',c:'#f1c96a',effect:true},{m:'CWBPT',label:'Water balance',c:'#f4f6fa'}],W=1000,H=540,L=100,R=25,T=30,B=60,max=70;
 const x=i=>L+i*(W-L-R)/11,y=v=>T+(max-v)/(max*2)*(H-T-B);let s='';
 for(const n of [-60,-30,0,30,60])s+='<line x1="'+L+'" y1="'+y(n)+'" x2="'+(W-R)+'" y2="'+y(n)+'" stroke="'+(n===0?'#9eafc4':'#2b3446')+'" stroke-width="'+(n===0?3:2)+'"/><text x="'+(L-20)+'" y="'+(y(n)+11)+'" fill="#c5d3e4" font-size="32" text-anchor="end">'+(n>0?'+':'')+n+'</text>';
 s+='<rect x="'+(x(state.month)-24)+'" y="'+T+'" width="48" height="'+(H-T-B)+'" fill="#fff" opacity=".07"/>';
 for(const ss of series){const values=Array.from({length:12},(_,i)=>DATA.frames[ss.m+':mean:'+i].mean*(ss.effect?-1:1));s+='<polyline points="'+values.map((v,i)=>x(i)+','+y(v)).join(' ')+'" fill="none" stroke="'+ss.c+'" stroke-width="6"/>';s+='<circle cx="'+x(state.month)+'" cy="'+y(values[state.month])+'" r="9" fill="'+ss.c+'"/>'}
 for(let i=0;i<12;i++)s+='<text x="'+x(i)+'" y="'+(H-10)+'" fill="#c5d3e4" font-size="26" text-anchor="middle">'+MONTHS[i].slice(0,3)+'</text>';
 const d=document.createElement('aside');d.className='chart-card';d.innerHTML='<h2>Change by month</h2><p>Scotland · ensemble mean · mm</p><div class="chart-key">'+series.map(ss=>'<span style="--c:'+ss.c+'">'+ss.label+'</span>').join('')+'</div><svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Monthly contributions to water-balance change">'+s+'</svg><div class="formula">'+signed(DATA.frames['Prec_sum:mean:'+state.month].mean)+' + ('+signed(-DATA.frames['ETPT_sum:mean:'+state.month].mean)+')<br>= '+signed(DATA.frames['CWBPT:mean:'+state.month].mean)+' mm<small>'+MONTHS[state.month]+' mean change</small></div>';return d;
}
function render(){
 if(!DATA)return;
 wall.replaceChildren();const stage=document.createElement('div');stage.className='stage';wall.append(stage);
 document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===state.view)));
 $('#metric').disabled=state.view==='components';$('#month').disabled=state.view==='members';$('#metric').value=state.view==='components'?'CWBPT':state.metric;$('#month').value=String(state.view==='members'?6:state.month);
 const meta='2050–2079 − 1990–2019', footer=document.createElement('div');footer.className='wall-footer';
 if(state.view==='components'){
  for(const [i,m] of ['Prec_sum','ETPT_sum','CWBPT'].entries()){
   if(i){const op=document.createElement('div');op.className='operator';op.textContent=i===1?'+':'=';stage.append(op)}
   stage.append(card({key:m+':mean:'+state.month,metric:m,title:METRICS[m].title,context:MONTHS[state.month]+' · ensemble mean<br>'+meta+(m==='ETPT_sum'?'<br>Effect on water balance':''),effect:m==='ETPT_sum'}));
  }stage.append(chart());
  $('#explanation').innerHTML='<p><strong>Water balance:</strong> rainfall change + the PT evapotranspiration contribution = water-balance change. The PT contribution is the negative of the ET change, so increased ET lowers the balance.</p><p>All three maps share a ±160 mm scale. The compact arrangement keeps the calculation together.</p>';
  footer.innerHTML='<span>Scotland · '+MONTHS[state.month]+' · ensemble mean</span><span>Monthly 30-year climatologies · change in mm</span>';
 }else if(state.view==='months'){
  for(let i=0;i<12;i++){
   const c=card({key:state.metric+':mean:'+i,metric:state.metric,title:MONTHS[i],context:meta+'<br>Ensemble mean',atlas:true,selected:i===state.month});
   c.tabIndex=0;c.setAttribute('role','button');c.setAttribute('aria-pressed',String(i===state.month));
   const select=()=>{state.month=i;$('#month').value=String(i);render()};c.onclick=select;c.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select()}};stage.append(c);
  }
  $('#explanation').innerHTML='<p><strong>Twelve months:</strong> show the year at once, keeping the metric, region, ensemble and change scale fixed. Rainfall can switch sign through the year; temperature reveals how warming varies by month.</p><p>Click a month to highlight it. In the app this could open that month’s detailed comparison. The existing Month loop would remain available for the period-comparison scene.</p>';
  footer.innerHTML='<span>Scotland · ensemble mean · '+METRICS[state.metric].title+'</span><span>Same colour scale in every month · monthly 30-year climatologies</span>';
 }else{
  for(const member of DATA.members){const c=card({key:state.metric+':'+member+':6',metric:state.metric,title:'Member '+member,context:'July · '+meta,atlas:true,selected:state.member===member});c.tabIndex=0;c.setAttribute('role','button');c.setAttribute('aria-pressed',String(state.member===member));const select=()=>{state.member=member;render()};c.onclick=select;c.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select()}};stage.append(c)}
  $('#explanation').innerHTML='<p><strong>Twelve members:</strong> the same July comparison for all twelve runs. One July scale is shared across every member; its limits are labelled. The end colours include values beyond those limits.</p><p>Click a member to highlight it. This study includes July only.</p>';
  footer.innerHTML='<span>Scotland · July · '+METRICS[state.metric].title+'</span><span>12 ensemble members · same colour scale in every map</span>';
 }wall.append(footer);fit();
}
function fit(){const width=Number($('#size').value),s=$('#scale').value==='fit'?$('#viewport').clientWidth/width:Number($('#scale').value);wall.style.width=width+'px';wall.style.transform='scale('+s+')';$('#shell').style.width=width*s+'px';$('#shell').style.height=1200*s+'px';$('#viewport').style.maxHeight='75vh';$('#scale-note').textContent=Math.round(s*100)+'%';if(state.view==='components')$('#viewport').scrollLeft=Math.max(0,(width*s-$('#viewport').clientWidth)/2);}
MONTHS.forEach((m,i)=>$('#month').add(new Option(m,String(i))));$('#month').value='6';
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;$('#viewport').scrollLeft=0;render()});
$('#metric').onchange=e=>{state.metric=e.target.value;render()};$('#month').onchange=e=>{state.month=Number(e.target.value);render()};$('#size').onchange=fit;$('#scale').onchange=fit;window.addEventListener('resize',fit);
(async()=>{try{const response=await fetch('data.json');if(!response.ok)throw new Error('Study data is unavailable');const d=await response.json();const compressed=Uint8Array.from(atob(d.packed),c=>c.charCodeAt(0));const raw=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();bytes=new Uint8Array(raw,d.coordinateBytes);coords=new Uint16Array(raw,0,d.grid.cells*2);DATA=d;render();document.body.dataset.ready='true'}catch(e){$('#loading').textContent='Study could not load: '+e.message;console.error(e)}})();

