/* Fluorescence — a zero-dependency, local-first FPbase spectra viewer. */
const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'vubio.fluorescence.v1';
const DEFAULT = {library:[],panels:[],layout:'overlay',range:[300,850],manualRange:false,grid:true,fill:false,ruler:true,yMode:'normalized'};
let state, hasSavedState=false;
try { const saved=localStorage.getItem(STORAGE_KEY);hasSavedState=!!saved;state = {...DEFAULT,...JSON.parse(saved || '{}')}; } catch {state = {...DEFAULT};}
if (!Array.isArray(state.library)) state.library=[];
if (!Array.isArray(state.panels)) state.panels=[];
if(!['normalized','brightness'].includes(state.yMode))state.yMode='normalized';
let catalog=[], cached = new Map(), toastTimer, saveTimer, activeHover=null, sourceReady=false;
const esc = (s) => String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const labelId = (str) => String(str).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'');
const nfmt=(v,d=0)=>Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US',{maximumFractionDigits:d}):'—';
const clamp=(v,l,h)=>Math.min(h,Math.max(l,v));
const cleanCurve=(points)=> {if (!Array.isArray(points)) return [];const arr=points.map(p=>[Number(p[0]),Number(p[1])]).filter(p=>p.every(Number.isFinite)).sort((a,b)=>a[0]-b[0]);const max=Math.max(0,...arr.map(p=>p[1]));return max>0 ? arr.map(([x,y])=>[x,clamp(y/max,0,1)]):arr;};
function parseSourceSpectrum(obj){return {id:String(obj?.id||''),subtype:String(obj?.subtype||'').replace('A_2P','2P').toUpperCase(),data:cleanCurve(obj?.data||[]),owner:obj?.owner||{},category:obj?.category||''};}
function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch{toast('Browser storage is full. Export a backup or remove old probe curves.');}},220);}
function toast(t){const el=$('toast');el.textContent=t;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4100);}
function parseProbe(raw){
  const o=raw||{}, cs=o.curves||{};
  const curves={EX:cleanCurve(cs.EX||cs.ex||[]),EM:cleanCurve(cs.EM||cs.em||[])};
  const owner=o.owner||{};
  return {uid:String(o.uid||labelId(o.name||'probe')),name:String(o.name||'Unnamed probe'),category:o.category||'D',source:o.source||'FPbase',sourceUrl:o.sourceUrl||'',spectra:Array.isArray(o.spectra)?o.spectra:[],curves,exMax:numOrNull(o.exMax??owner.exMax),emMax:numOrNull(o.emMax??owner.emMax),qy:numOrNull(o.qy??owner.qy),extCoeff:numOrNull(o.extCoeff??owner.extCoeff),color:o.color||colorFromWavelength(o.emMax??owner.emMax),visible:o.visible!==false,showEx:o.showEx!==false,showEm:o.showEm!==false,pending:Boolean(o.pending),opacity:clamp(Number(o.opacity??100),0,100)};
}
function numOrNull(n){return n===null||n===undefined||n===''?null:(Number.isFinite(Number(n))?Number(n):null);}
function colorFromWavelength(n){const p=Number(n||550);if(p<420)return '#ad8cf9';if(p<480)return '#689bfa';if(p<520)return '#42c7ca';if(p<560)return '#57d99f';if(p<590)return '#d2cb65';if(p<625)return '#ffa362';if(p<670)return '#f37091';return '#d17afa';}
function brightness(p){return p.qy!=null && p.extCoeff!=null ? p.qy*p.extCoeff : null;}
function enabled(p){return p.visible && ((p.showEx&&p.curves.EX?.length>1)||(p.showEm&&p.curves.EM?.length>1));}
function activeProbes(){return state.library.filter(enabled);}
function seriesScale(p){return state.yMode==='brightness'? (brightness(p)==null?null:brightness(p)/1000):1;}
function plotValue(p,v){const k=seriesScale(p);return k==null||v==null?null:v*k;}
function activeSeries(){return activeProbes().filter(p=>seriesScale(p)!=null).flatMap(p=>[['EX',p.showEx],['EM',p.showEm]].filter(([t,on])=>on && p.curves[t]?.length>1).map(([type])=>({p,type,curve:p.curves[type]})));}
function plotYMax(){if(state.yMode==='normalized')return 1;const v=Math.max(0,...activeSeries().map(({p})=>seriesScale(p)));if(!v)return 1;const mag=Math.pow(10,Math.floor(Math.log10(v)));return Math.ceil((v/mag)*2)/2*mag;}
function render(){renderProbes();renderCharts();renderSavedPanels();renderBrightness();}
function renderProbes(){
  $('library-count').textContent=state.library.length;
  $('active-count').textContent=activeProbes().length+' active';
  const filter=$('search-input').value.toLowerCase().trim();
  const list=state.library.filter(p=>!filter||p.name.toLowerCase().includes(filter));
  $('probe-list').innerHTML=list.length?list.map(p=>`
   <div class="probe-row ${enabled(p)?'active':'inactive'} ${p.pending?'pending':''}" data-uid="${esc(p.uid)}">
    <div class="probe-main"><input class="check-box" type="checkbox" data-action="visible" aria-label="Display ${esc(p.name)}" ${p.visible?'checked':''}/>
      <span class="probe-color" style="background:${esc(p.color)};color:${esc(p.color)}"></span>
      <div class="probe-meta"><div class="probe-name"><span title="${esc(p.name)}">${esc(p.name)}</span></div><div class="probe-waves">${p.pending?"Awaiting cached spectra · ":""}${p.exMax!=null?'Ex '+nfmt(p.exMax)+' nm':'Ex n/a'} &nbsp;·&nbsp; ${p.emMax!=null?'Em '+nfmt(p.emMax)+' nm':'Em n/a'}</div></div>
      ${p.source==='FPbase'&&p.spectra?.length?`<a class="probe-link" title="Open original FPbase spectra" target="_blank" rel="noopener noreferrer" href="https://www.fpbase.org/spectra/?s=${encodeURIComponent(p.spectra.filter(s=>['EX','EM'].includes(s.subtype)).map(s=>s.id).join(','))}">↗</a>`:''}<button class="remove-probe" data-action="remove" title="Remove from library" aria-label="Remove ${esc(p.name)}">×</button>
    </div>
    <div class="probe-controls"><button class="curve-switch ${p.showEx?'on ex':''}" data-action="ex" aria-pressed="${p.showEx}">EX</button><button class="curve-switch ${p.showEm?'on em':''}" data-action="em" aria-pressed="${p.showEm}">EM</button><label for="op-${esc(p.uid)}">Opacity</label><input type="range" data-action="opacity" id="op-${esc(p.uid)}" value="${p.opacity}" min="0" max="100" step="5"/><span class="percent">${p.opacity}%</span>${p.pending ? '<button class="retry-probe" data-action="retry" title="Retry loading spectra">↻</button>' : ''}</div>
   </div>`).join('') : `<div class="empty-list">${state.library.length?'No library items match this search.':'Your saved probes will appear here.<br/>Search for one above to get started.'}</div>`;
}
$('probe-list').addEventListener('click',(e)=>{
  const row=e.target.closest('[data-uid]');if(!row)return;
  const p=state.library.find(p=>p.uid===row.dataset.uid);if(!p)return;
  const act=e.target.dataset.action;
  if(act==='retry'){retryProbe(p);return;}
  if(act==='ex') p.showEx=!p.showEx;
  else if(act==='em') p.showEm=!p.showEm;
  else if(act==='remove') {if(!confirm(`Remove ${p.name} from this browser's library? Saved panel presets keep its name, but not the removed curve data.`))return;state.library=state.library.filter(x=>x.uid!==p.uid);}
  else return;
  save();render();
});
$('probe-list').addEventListener('change',(e)=>{if(e.target.dataset.action!=='visible')return;const p=state.library.find(x=>x.uid===e.target.closest('[data-uid]').dataset.uid);if(p){p.visible=e.target.checked;save();render();}});
$('probe-list').addEventListener('input',(e)=>{if(e.target.dataset.action!=='opacity')return;const p=state.library.find(x=>x.uid===e.target.closest('[data-uid]').dataset.uid);if(!p)return;p.opacity=Number(e.target.value);e.target.nextElementSibling.textContent=p.opacity+'%';save();renderCharts();});
function addToCatalog(raw){const p=parseProbe(raw);if(!p.name)return;const key=p.uid;const prev=catalog.find(x=>x.uid===key);if(prev){const idx=catalog.indexOf(prev);catalog[idx]={...prev,...p,spectra:raw.spectra||prev.spectra,curves:p.curves.EX.length||p.curves.EM.length?p.curves:prev.curves};}else catalog.push(p);if(p.curves.EX.length||p.curves.EM.length)cached.set(key,p);}
async function bootstrap(){
  try{
    const res=await fetch('./data/fpbase-cache.json',{cache:'no-cache'});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const data=await res.json();
    for(const x of data.catalog||[]) addToCatalog(x);
    for(const x of data.probes||[]) addToCatalog(x);
    sourceReady=true;
    $('source-status').textContent=`FPbase catalogue · ${catalog.length.toLocaleString()} entries`;
    if(!state.library.length && !hasSavedState){
      for(const name of ['DAPI','Alexa Fluor 488','mCherry']){const p=catalog.find(x=>x.name.toLowerCase()===name.toLowerCase() && (x.curves.EX.length||x.curves.EM.length));if(p)state.library.push({...p});}
      if(state.library.length){setAutoRange();save();}
    }
  }catch{
    $('source-status').textContent='Live FPbase search · local cache not built';
    try{await fetchIndex();sourceReady=true;}catch{ $('source-status').textContent='Offline · import CSV or run FPbase sync';}
  }
  state.library=state.library.map(raw=>{const original=parseProbe(raw),fresh=cached.get(original.uid);if(fresh && !original.curves.EX.length && !original.curves.EM.length){return {...parseProbe(fresh),visible:original.visible,showEx:original.showEx,showEm:original.showEm,opacity:original.opacity,pending:false};}return original;});render();save();
}
async function graphql(query,variables){
  const url=new URL('https://www.fpbase.org/graphql/');url.searchParams.set('query',query);if(variables)url.searchParams.set('variables',JSON.stringify(variables));
  const res=await fetch(url.toString(),{method:'GET',mode:'cors',credentials:'omit',headers:{Accept:'application/json'}});
  if(!res.ok)throw new Error(`FPbase returned ${res.status}`);
  const result=await res.json();if(result.errors?.length)throw new Error(result.errors[0].message);return result.data;
}
async function fetchIndex(){
  const result=await graphql('{ spectra { id category subtype owner { id name slug } } }');
  const groups=new Map();
  for(const sp of result.spectra||[]){if(!['P','D'].includes(sp.category)||!sp.owner?.name)continue;const sub=String(sp.subtype).replace('A_2P','2P');if(!['EX','AB','EM'].includes(sub))continue;
    const uid=labelId(sp.owner.name);if(!groups.has(uid))groups.set(uid,{name:sp.owner.name,uid,category:sp.category,spectra:[],curves:{EX:[],EM:[]}});
    groups.get(uid).spectra.push({id:String(sp.id),subtype:sub});
  }
  for(const entry of groups.values())addToCatalog(entry);
  $('source-status').textContent=`Live FPbase · ${groups.size.toLocaleString()} fluorophores`;
}
const QUERY_SPECTRUM=`query Spectrum($id:Int!){spectrum(id:$id){id data category color subtype owner{id name slug ... on FluorophoreInterface{qy extCoeff exMax emMax}}}}`;
async function loadCurves(p){
  const c=cached.get(p.uid);if(c && (c.curves.EX.length||c.curves.EM.length))return {...c,visible:true,showEx:true,showEm:true,opacity:100};
  const ids={};for(const sp of p.spectra||[]){const sub=String(sp.subtype||'').toUpperCase();if(sub==='EX' && !ids.EX)ids.EX=sp.id;else if(sub==='EM' && !ids.EM)ids.EM=sp.id;}
  if(!ids.EX && !ids.EM)throw new Error('No excitation or emission spectrum is listed for that probe.');
  const next={...p,curves:{EX:[],EM:[]}};
  for(const type of ['EX','EM']){
    if(!ids[type])continue;
    const response=await graphql(QUERY_SPECTRUM,{id:Number(ids[type])});
    const sp=parseSourceSpectrum(response?.spectrum);next.curves[type]=sp.data;
    const own=sp.owner||{};next.exMax=next.exMax??numOrNull(own.exMax);next.emMax=next.emMax??numOrNull(own.emMax);next.qy=next.qy??numOrNull(own.qy);next.extCoeff=next.extCoeff??numOrNull(own.extCoeff);
  }
  next.color=colorFromWavelength(next.emMax);
  cached.set(next.uid,next);return next;
}
async function addProbe(source){
  let p=state.library.find(x=>x.uid===source.uid);
  if(p){p.visible=true;render();save();toast(`${p.name} is already in your library.`);return;}
  $('source-status').textContent=`Loading ${source.name}…`;
  try{
    p=await loadCurves(source);if(!p.curves.EX.length&&!p.curves.EM.length)throw new Error('No curve values were returned.');
    state.library.unshift(parseProbe(p));save();render();$('search-input').value='';hideSuggestions();if(!state.manualRange){setAutoRange();renderCharts();}toast(`${p.name} saved to your probe library.`);
  }catch(e){toast(`Could not fetch ${source.name}: ${e.message}. Try the CSV importer or build the GitHub cache.`);}
  finally{$('source-status').textContent=sourceReady?`FPbase catalogue · ${catalog.length.toLocaleString()} entries`:'Live FPbase search unavailable';}
}
const srch=$('search-input');let searchTimer;
srch.addEventListener('input',()=>{renderProbes();clearTimeout(searchTimer);searchTimer=setTimeout(()=>showSuggestions(srch.value),170);});
srch.addEventListener('focus',()=>{if(srch.value.trim())showSuggestions(srch.value);});
srch.addEventListener('keydown',e=>{if(e.key==='Escape'){hideSuggestions();srch.blur();}if(e.key==='Enter'){const b=$('search-results').querySelector('button.suggestion');if(b){e.preventDefault();b.click();}}});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!(e.target instanceof HTMLInputElement)&&!(e.target instanceof HTMLTextAreaElement)){e.preventDefault();srch.focus();}});
document.addEventListener('click',e=>{if(!e.target.closest('.search-box')&&!e.target.closest('#search-results'))hideSuggestions();});
function hideSuggestions(){$('search-results').hidden=true;}
async function showSuggestions(term){
  term=term.trim();if(!term){hideSuggestions();return;}
  if(!catalog.length){try{await fetchIndex();}catch{/* User can still import CSV */}}
  const matching=catalog.filter(p=>p.name.toLowerCase().includes(term.toLowerCase())).sort((a,b)=>a.name.toLowerCase().startsWith(term.toLowerCase())?-1:b.name.toLowerCase().startsWith(term.toLowerCase())?1:a.name.localeCompare(b.name)).slice(0,10);
  $('search-results').hidden=false;
  $('search-results').innerHTML=matching.length?matching.map(p=>`<button class="suggestion" data-uid="${esc(p.uid)}"><span class="probe-color" style="background:${esc(p.color)}"></span><span class="suggestion-body"><strong>${esc(p.name)}</strong><small>${p.category==='P'?'Fluorescent protein':'Dye'} · ${p.curves.EX?.length||p.curves.EM?.length?'Cached spectra':'FPbase'}${state.library.some(x=>x.uid===p.uid)?' · already in library':''}</small></span><span class="plus">＋</span></button>`).join(''):`<div class="hint-result">No matching FPbase entries in the current catalogue. Import custom CSV, or update the catalogue from GitHub Actions.</div>`;
}
$('search-results').addEventListener('click',e=>{const b=e.target.closest('button[data-uid]');if(!b)return;const p=catalog.find(p=>p.uid===b.dataset.uid);if(p)addProbe(p);});
$('all-on').addEventListener('click',()=>{state.library.forEach(p=>p.visible=true);save();render();});
$('all-off').addEventListener('click',()=>{state.library.forEach(p=>p.visible=false);save();render();});
$('select-all-btn').addEventListener('click',()=>{const next=!state.library.every(p=>p.visible);state.library.forEach(p=>p.visible=next);save();render();});
for(const [id,type,value] of [['ex-all','showEx',true],['ex-none','showEx',false],['em-all','showEm',true],['em-none','showEm',false]]){$(id).addEventListener('click',()=>{state.library.forEach(p=>{p[type]=value;});save();render();});}
function setAutoRange(){const curves=activeSeries().map(x=>x.curve).filter(c=>c.length);if(!curves.length){state.range=[300,850];state.manualRange=false;return;}
 const first=Math.min(...curves.map(c=>c[0][0])),last=Math.max(...curves.map(c=>c[c.length-1][0]));state.range=[Math.max(100,Math.floor((first-12)/10)*10),Math.ceil((last+12)/10)*10];state.manualRange=false;}
$('layout-overlay').addEventListener('click',()=>{state.layout='overlay';save();renderCharts();});
$('layout-stack').addEventListener('click',()=>{state.layout='stacked';save();renderCharts();});
$('range-reset').addEventListener('click',()=>{setAutoRange();save();renderCharts();});
for(const k of ['x-min','x-max'])$(k).addEventListener('change',()=>{const lo=Number($('x-min').value),hi=Number($('x-max').value);if(lo>=100&&hi<=2000&&hi>lo+20){state.range=[lo,hi];state.manualRange=true;save();renderCharts();}else toast('Please enter a valid wavelength range (minimum difference: 20 nm).');});
for(const [id,key] of [['grid-toggle','grid'],['fill-toggle','fill'],['ruler-toggle','ruler']])$(id).addEventListener('change',e=>{state[key]=e.target.checked;save();renderCharts();});
function interpolate(curve,x){if(!curve||curve.length===0)return null;if(x<curve[0][0]||x>curve[curve.length-1][0])return null;let lo=0,hi=curve.length-1;while(hi-lo>1){const m=Math.floor((lo+hi)/2);if(curve[m][0]<x)lo=m;else hi=m;}const a=curve[lo],b=curve[hi];if(Math.abs(b[0]-a[0])<1e-8)return b[1];return a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]);}
const NS='http://www.w3.org/2000/svg';
function niceTicks(min,max,count=8){const raw=(max-min)/count;const pow=Math.pow(10,Math.floor(Math.log10(raw)));const m=[1,2,2.5,5,10].find(x=>raw/pow<=x)||10;const step=pow*m;const ticks=[];for(let v=Math.ceil(min/step)*step;v<=max+1e-6;v+=step)ticks.push(+v.toFixed(5));return ticks;}
function makeSVG(series,idx,stacked){const W=1040,H=stacked?222:433,left=54,right=20,top=stacked?14:24,bottom=37,ph=H-top-bottom,pw=W-left-right,lo=state.range[0],hi=state.range[1];
  const px=x=>left+(x-lo)/(hi-lo)*pw, py=y=>top+(1-y)*ph, ticks=niceTicks(lo,hi,9);const clip='clip-'+idx;
  let svg=`<svg class="plot-svg" viewBox="0 0 ${W} ${H}" data-plot="${idx}" data-w="${W}" data-h="${H}" data-l="${left}" data-r="${right}" data-t="${top}" data-b="${bottom}" role="img" aria-label="${stacked?'Single probe':'Overlaid'} fluorescence spectra chart"><defs><clipPath id="${clip}"><rect x="${left}" y="${top}" width="${pw}" height="${ph}" /></clipPath></defs>`;
  if(state.grid){for(const y of [0,.25,.5,.75,1])svg+=`<line x1="${left}" y1="${py(y)}" x2="${W-right}" y2="${py(y)}" stroke="#2c3850" stroke-width="1" opacity=".8"/>`;for(const t of ticks)svg+=`<line x1="${px(t)}" y1="${top}" x2="${px(t)}" y2="${H-bottom}" stroke="#2a344a" stroke-width="1" opacity=".7"/>`;}
  svg+=`<line x1="${left}" y1="${H-bottom}" x2="${W-right}" y2="${H-bottom}" stroke="#71829e" stroke-width="1" opacity=".65"/>`;
  for(const y of [0,.25,.5,.75,1])svg+=`<text x="${left-10}" y="${py(y)+4}" text-anchor="end" fill="#8295b5" font-size="11">${Math.round(y*100)}</text>`;
  for(const t of ticks)svg+=`<text x="${px(t)}" y="${H-14}" fill="#8fa1ba" font-size="11" text-anchor="middle">${t}</text>`;
  svg+=`<text x="${left+pw/2}" y="${H-1}" fill="#70819f" font-size="10" text-anchor="middle">Wavelength (nm)</text><g clip-path="url(#${clip})">`;
  for(const item of series){const {p,type,curve}=item;if(!curve?.length)continue;const path=curve.map(([x,y],i)=>`${i?'L':'M'}${px(x).toFixed(2)},${py(y).toFixed(2)}`).join(' ');const al=clamp(p.opacity/100,0,1);
    if(state.fill){svg+=`<path d="${path} L${px(curve[curve.length-1][0]).toFixed(2)},${py(0)} L${px(curve[0][0]).toFixed(2)},${py(0)}Z" fill="${p.color}" fill-opacity="${(al*.09).toFixed(2)}" />`;}
    svg+=`<path d="${path}" fill="none" stroke="${p.color}" stroke-width="${type==='EM'?3:2.5}" stroke-dasharray="${type==='EX'?'8 5':'none'}" stroke-opacity="${al}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  svg+='</g>';
  svg+=`<line class="hover-line" x1="0" y1="${top}" x2="0" y2="${H-bottom}" stroke="#f7f8fc" stroke-width="1.4" stroke-dasharray="5 4" opacity="0" pointer-events="none"/>`;
  for(const item of series){const {p,type}=item;svg+=`<circle class="hover-marker" data-uid="${esc(p.uid)}" data-type="${type}" cx="0" cy="0" r="4.6" stroke="#121c2c" stroke-width="1.6" fill="${p.color}" opacity="0" pointer-events="none"/>`;}
  svg+=`<rect class="pointer-surface" x="${left}" y="${top}" width="${pw}" height="${ph}" fill="transparent" />`;
  return svg+'</svg>';
}
function renderCharts(){
  $('layout-overlay').classList.toggle('selected',state.layout!=='stacked');$('layout-stack').classList.toggle('selected',state.layout==='stacked');
  $('layout-overlay').setAttribute('aria-pressed',String(state.layout!=='stacked'));$('layout-stack').setAttribute('aria-pressed',String(state.layout==='stacked'));
  $('x-min').value=state.range[0];$('x-max').value=state.range[1];
  for(const [id,key] of [['grid-toggle','grid'],['fill-toggle','fill'],['ruler-toggle','ruler']])$(id).checked=state[key];
  const probes=activeProbes(),series=activeSeries();$('chart-probe-count').textContent=probes.length;$('curve-count').textContent=series.length;
  if(!series.length){$('plot-content').innerHTML='<div class="empty-chart"><div class="empty-symbol">〰</div><h3>No active spectra</h3><p>Search FPbase or turn on a probe in the left library.</p></div>';return;}
  const stacked=state.layout==='stacked',chunks=stacked?probes.map(p=>series.filter(x=>x.p.uid===p.uid)):[series];
  $('plot-content').innerHTML=chunks.map((chunk,i)=>`<div class="plot-group ${stacked?'stacked':''}">${stacked?`<div class="plot-head"><strong><i class="swatch" style="background:${chunk[0].p.color}"></i>${esc(chunk[0].p.name)}</strong><span>${chunk.map(x=>x.type).join(' + ')}</span></div>`:''}${makeSVG(chunk,i,stacked)}</div>`).join('')+`<div id="hover-readout" class="readout hide"></div>`;
  document.querySelectorAll('.plot-svg').forEach(svg=>{svg.addEventListener('pointermove',pointerMove);svg.addEventListener('pointerleave',clearRuler);});
}
function pointerMove(e){if(!state.ruler)return;const svg=e.currentTarget,rect=svg.getBoundingClientRect(),W=+svg.dataset.w,left=+svg.dataset.l,right=+svg.dataset.r;
  const at=(e.clientX-rect.left)/rect.width*W;if(at<left||at>W-right){clearRuler();return;}
  const frac=clamp((at-left)/(W-left-right),0,1),x=state.range[0]+frac*(state.range[1]-state.range[0]);activeHover=x;
  for(const chart of document.querySelectorAll('.plot-svg')){
    const cw=Number(chart.dataset.w),l=Number(chart.dataset.l),r=Number(chart.dataset.r),top=Number(chart.dataset.t),h=Number(chart.dataset.h),b=Number(chart.dataset.b),xp=l+frac*(cw-l-r);
    const line=chart.querySelector('.hover-line');line.setAttribute('x1',xp);line.setAttribute('x2',xp);line.setAttribute('opacity','0.63');
    for(const marker of chart.querySelectorAll('.hover-marker')){const p=state.library.find(p=>p.uid===marker.dataset.uid);const y=p&&interpolate(p.curves[marker.dataset.type],x);marker.setAttribute('cx',xp);marker.setAttribute('cy',top+(1-(y??0))*(h-top-b));marker.setAttribute('opacity',y==null?'0':String(p.opacity/100));}
  }
  const read=$('hover-readout');if(!read)return;read.classList.remove('hide');let rows=activeSeries().map(({p,type,curve})=>({p,type,val:interpolate(curve,x)}));
  read.innerHTML=`<div class="readout-title">${nfmt(x,1)} nm</div>${rows.slice(0,13).map(o=>`<div class="readout-line"><span><i class="tiny" style="background:${o.p.color}"></i>${esc(o.p.name)} ${o.type}</span><b>${o.val==null?'—':nfmt(o.val*100,1)+'%'}</b></div>`).join('')}${rows.length>13?`<div class="readout-line">+${rows.length-13} more spectra</div>`:''}`;
}
function clearRuler(){activeHover=null;document.querySelectorAll('.hover-line,.hover-marker').forEach(x=>x.setAttribute('opacity','0'));$('hover-readout')?.classList.add('hide');}
function renderBrightness(){const probes=state.library.filter(p=>brightness(p)!=null);if(!probes.length){$('brightness-table').innerHTML='<div class="mini-empty">No EC and QY values are available for the current saved probes.</div>';return;}
 $('brightness-table').innerHTML=`<table><thead><tr><th>Probe</th><th>EC (M⁻¹cm⁻¹)</th><th>QY</th><th>EC × QY / 1000</th></tr></thead><tbody>${probes.map(p=>`<tr><td>${esc(p.name)}</td><td>${nfmt(p.extCoeff)}</td><td>${nfmt(p.qy,3)}</td><td>${nfmt(brightness(p)/1000,2)}</td></tr>`).join('')}</tbody></table>`;
}
function renderSavedPanels(){const items=state.panels||[];$('panel-list').innerHTML=items.length?items.map((p,i)=>`<div class="panel-chip"><button data-action="load" data-id="${i}" title="Load ${esc(p.name)}">◫ ${esc(p.name)} <small>(${p.probes?.length||0})</small></button><button class="delete-panel" data-action="delete" data-id="${i}" title="Delete panel">×</button></div>`).join(''):'<p class="mini-empty">Save the current selection to reopen an experiment in one click.</p>';}
$('save-panel-btn').addEventListener('click',()=>{if(!state.library.length){toast('Add at least one probe before saving a panel.');return;}$('panel-name').value='';$('panel-dialog').showModal();$('panel-name').focus();});
$('panel-form').addEventListener('submit',e=>{if(e.submitter?.value==='cancel')return;const name=$('panel-name').value.trim();if(!name){e.preventDefault();return;}
  const snapshot={name,at:new Date().toISOString(),layout:state.layout,range:[...state.range],manualRange:state.manualRange,probes:state.library.filter(p=>p.visible).map(p=>({uid:p.uid,showEx:p.showEx,showEm:p.showEm,opacity:p.opacity}))};state.panels.unshift(snapshot);save();renderSavedPanels();toast(`Panel “${name}” saved.`);});
$('panel-list').addEventListener('click',async e=>{const btn=e.target.closest('button[data-action]');if(!btn)return;const i=Number(btn.dataset.id),panel=state.panels[i];if(!panel)return;
 if(btn.dataset.action==='delete'){if(!confirm(`Delete saved panel “${panel.name}”?`))return;state.panels.splice(i,1);save();renderSavedPanels();return;}
 state.library.forEach(p=>p.visible=false);const missing=[];for(const setting of panel.probes||[]){let p=state.library.find(x=>x.uid===setting.uid);if(!p){const entry=catalog.find(x=>x.uid===setting.uid);if(entry){try{p=parseProbe(await loadCurves(entry));state.library.push(p);}catch{missing.push(setting.uid);}}else missing.push(setting.uid);}if(p){p.visible=true;p.showEx=setting.showEx;p.showEm=setting.showEm;p.opacity=setting.opacity;}}
 state.layout=panel.layout||'overlay';state.range=panel.range||[300,850];state.manualRange=panel.manualRange??false;save();render();toast(`Opened “${panel.name}”${missing.length?` (${missing.length} probe(s) unavailable)`:''}.`);
});
$('clear-panel-btn').addEventListener('click',()=>{state.library.forEach(p=>p.visible=false);save();render();});
function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}
$('backup-btn').addEventListener('click',()=>downloadBlob(new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),...state},null,2)],{type:'application/json'}),'fluorescence-library-'+new Date().toISOString().slice(0,10)+'.json'));
function exportSVG(){
 const plots=[...document.querySelectorAll('.plot-svg')];if(!plots.length){toast('No visible spectra to export.');return null;}
 const withHeaders=state.layout==='stacked',head=withHeaders?26:0;
 const totalH=plots.reduce((a,p)=>a+Number(p.dataset.h)+head,0);let y=0;
 const parts=plots.map((p,i)=>{
   const clone=p.cloneNode(true);clone.removeAttribute('class');clone.removeAttribute('data-plot');
   clone.querySelectorAll('.hover-line,.hover-marker,.pointer-surface').forEach(n=>n.remove());
   const height=Number(p.dataset.h);clone.setAttribute('width','1040');clone.setAttribute('height',String(height));
   clone.setAttribute('x','0');clone.setAttribute('y',String(y+head));
   const label=withHeaders?`<text x="54" y="${y+18}" font-size="14" font-weight="700" fill="#e9effc">${esc(p.closest('.plot-group')?.querySelector('.plot-head strong')?.textContent||'')}</text>`:'';
   y+=height+head;return label+new XMLSerializer().serializeToString(clone);
 });
 return `<svg xmlns="${NS}" width="1040" height="${totalH}" viewBox="0 0 1040 ${totalH}"><rect x="0" y="0" width="1040" height="${totalH}" fill="#111a2c"/>${parts.join('')}</svg>`;
}
$('svg-btn').addEventListener('click',()=>{const raw=exportSVG();if(raw)downloadBlob(new Blob([raw],{type:'image/svg+xml'}),'fluorescence-'+state.layout+'.svg');});
$('png-btn').addEventListener('click',()=>{const raw=exportSVG();if(!raw)return;const img=new Image(),u=URL.createObjectURL(new Blob([raw],{type:'image/svg+xml;charset=utf-8'}));img.onload=()=>{const canvas=document.createElement('canvas');canvas.width=2080;canvas.height=img.height*2;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,canvas.width,canvas.height);canvas.toBlob(blob=>{if(blob)downloadBlob(blob,'fluorescence-'+state.layout+'.png');},'image/png');URL.revokeObjectURL(u);};img.onerror=()=>{toast('PNG export failed; try SVG instead.');URL.revokeObjectURL(u);};img.src=u;});
$('import-btn').addEventListener('click',()=>{$('file-input').value='';$('file-input').click();});
$('csv-btn').addEventListener('click',()=>{$('file-input').value='';$('file-input').click();});
$('file-input').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;const text=await file.text();try{
 if(file.name.toLowerCase().endsWith('.json')){const data=JSON.parse(text);if(!Array.isArray(data.library))throw new Error('This does not look like a fluorescence library backup.');if(!confirm('Import this backup? This replaces the current library and saved panels. Export a backup first if needed.'))return;state={...DEFAULT,...data,library:data.library.map(parseProbe)};save();render();toast('Library and saved panels imported.');}
 else await importCSV(file.name,text);
 }catch(error){toast('Import failed: '+error.message);}
});
async function importCSV(fileName,content){const lines=content.trim().split(/\r?\n/).filter(Boolean),sep=lines[0].includes('\t')?'\t':lines[0].includes(';')?';':',';const rows=lines.map(l=>l.split(sep).map(c=>c.trim().replace(/^"|"$/g,'')));let headers=rows[0].map(s=>s.toLowerCase());let hasHeader=headers.some(h=>/[a-z]/.test(h));let dataRows=hasHeader?rows.slice(1):rows;
 let xCol=hasHeader?headers.findIndex(h=>/wave|nm|lambda/.test(h)):0;if(xCol<0)xCol=0;
 let exCol=hasHeader?headers.findIndex(h=>/excitation|\bex\b|absorb/.test(h)):-1;
 let emCol=hasHeader?headers.findIndex(h=>/emission|\bem\b|fluorescence/.test(h)):-1;
 if(exCol<0&&emCol<0){if(rows[0].length>=3){exCol=1;emCol=2;}else{const typ=(prompt('This CSV has two columns. Is it an excitation or emission spectrum? Enter EX or EM:','EM')||'EM').trim().toUpperCase();if(typ==='EX')exCol=xCol===0?1:0;else emCol=xCol===0?1:0;}}
 const make=(idx)=>idx>=0?cleanCurve(dataRows.map(r=>[Number(r[xCol]),Number(r[idx])]).filter(v=>v.every(Number.isFinite))):[];
 const EX=make(exCol),EM=make(emCol);if(EX.length<3&&EM.length<3)throw new Error('Need at least three wavelength/value rows. Expected wavelength + excitation and/or emission columns.');
 const name=(prompt('Name for this custom probe:',fileName.replace(/\.(csv|tsv)$/i,''))||'').trim();if(!name)return;
 const uid=labelId(name);const argmax=(arr)=>arr.length?arr.reduce((best,p)=>p[1]>best[1]?p:best,arr[0])[0]:null;
 const probe=parseProbe({uid,name,category:'D',source:'Custom CSV',sourceUrl:'',curves:{EX,EM},exMax:argmax(EX),emMax:argmax(EM),spectra:[]});
 const prev=state.library.findIndex(p=>p.uid===uid);if(prev>=0){if(!confirm(`Replace your existing ${name} spectra?`))return;state.library.splice(prev,1);}
 state.library.unshift(probe);addToCatalog(probe);if(!state.manualRange)setAutoRange();save();render();toast(`${name}: custom spectrum imported and saved.`);
}
bootstrap();