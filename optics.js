/* Nominal laser/filter overlay; does not represent measured instrument transmission. */
(function opticsBootstrap(){
  "use strict";
  const KEY="vubio.fluorescence.optics.v1";
  const LASERS=[355,375,405,445,458,488,514,532,561,594,633,640,647];
  const FILTERS=["379/28","405/30","450/50","525/50","530/30","575/26","585/42","586/15","610/20","660/20","670/30","695/40","710/50","730/45","780/60"];
  // These are typical dye/channel examples, not instrument-specific assignments.
  const LASER_LABELS={"355":"UV · DAPI / Hoechst / BUV","375":"Near-UV · Hoechst / DAPI","405":"Violet · BV421 / CellTrace Violet","445":"Blue-violet · CFP / mTurquoise2","458":"Cyan · CFP / mCerulean","488":"Blue · FITC / GFP / Alexa 488","514":"Green · YFP / Venus","532":"Green · Cy3 / PE","561":"Yellow-green · PE / mCherry","594":"Orange · Alexa Fluor 594","633":"Red · APC / Cy5 / Alexa 647","640":"Red · APC / Cy5 / Alexa 647","647":"Red · Cy5 / Alexa 647"};
  const FILTER_LABELS={"379/28":"UV / Indo-1","405/30":"BUV395 / UV","450/50":"BV421 / DAPI / BFP","525/50":"FITC / GFP / Alexa 488","530/30":"FITC / GFP / Alexa 488","575/26":"PE / Cy3 / mOrange","585/42":"PE / Alexa 555 / dTomato","586/15":"PE / mOrange","610/20":"mCherry / PI / PE-Texas Red","660/20":"APC / Alexa 647 / Cy5","670/30":"APC / Alexa 647 / Cy5","695/40":"PerCP-Cy5.5 / DRAQ7","710/50":"PerCP-Cy5.5 / PE-Cy5.5","730/45":"Alexa 700 / APC-R700","780/60":"APC-Cy7 / PE-Cy7"};
  const parseFilter=s=>{const m=/^(\d{3,4})\/(\d{1,3})$/.exec(String(s));return m?{name:s,center:+m[1],width:+m[2]}:null;};
  let data={lasers:[],filters:[]};
  try{const x=JSON.parse(localStorage.getItem(KEY)||"{}");if(Array.isArray(x.lasers)&&Array.isArray(x.filters))data=x;}catch{}
  const el=id=>document.getElementById(id);
  function normalize(){
    data.lasers=[...new Set(data.lasers.map(Number).filter(v=>v>=200&&v<=1500))].sort((a,b)=>a-b).slice(0,15);
    data.filters=[...new Set(data.filters.map(String).filter(s=>{const f=parseFilter(s);return f&&f.center>=200&&f.center<=1500&&f.width>=1&&f.width<=400;}))].slice(0,20);
  }
  function redraw(){const e=el("grid-toggle");if(e)e.dispatchEvent(new Event("change",{bubbles:true}));}
  function persist(){normalize();try{localStorage.setItem(KEY,JSON.stringify(data));}catch{}renderTags();redraw();}
  function renderTags(){
    if(!el("optic-selected"))return;
    el("optic-selected").innerHTML=[
      ...data.lasers.map(n=>`<button class="optic-chip laser-chip" data-kind="laser" data-value="${n}" title="Remove ${n} nm laser"><span class="optic-chip-dot">│</span><strong>${n} nm</strong>${LASER_LABELS[n]?`<span class="optic-chip-name">${LASER_LABELS[n]}</span>`:""} <b>×</b></button>`),
      ...data.filters.map(n=>`<button class="optic-chip filter-chip" data-kind="filter" data-value="${n}" title="Remove ${n} filter"><span class="optic-chip-dot">▥</span><strong>${n} nm</strong>${FILTER_LABELS[n]?`<span class="optic-chip-name">${FILTER_LABELS[n]}</span>`:""} <b>×</b></button>`)
    ].join("")||'<span class="optics-empty">No optical guides selected.</span>';
  }
  function init(){
    const node=document.querySelector(".chart-settings");if(!node)return;
    const div=document.createElement("div");div.className="optics-toolbar";
    div.innerHTML=`<strong class="optics-title">Optical guides</strong><label>Laser <select id="optic-laser" aria-label="Add laser"><option value="">+ Select laser</option>${LASERS.map(x=>`<option value="${x}">${x} nm — ${LASER_LABELS[x]||"Laser"}</option>`).join("")}</select></label><label>Emission filter <select id="optic-filter" aria-label="Add filter"><option value="">+ Select filter</option>${FILTERS.map(x=>`<option value="${x}">${x} nm — ${FILTER_LABELS[x]||"Filter"}</option>`).join("")}</select></label><details class="optic-custom"><summary>Custom</summary><div class="optic-custom-form"><label>Laser nm<input id="optic-custom-laser" type="number" min="200" max="1500" placeholder="488"></label><button id="optic-add-laser" type="button">Add laser</button><label>Center<input id="optic-custom-center" type="number" min="200" max="1500" placeholder="530"></label><label>Width<input id="optic-custom-width" type="number" min="1" max="400" placeholder="30"></label><button id="optic-add-filter" type="button">Add filter</button></div></details><button id="optic-clear" class="optic-clear" type="button">Clear guides</button><div id="optic-selected" class="optic-selected" aria-label="Selected optical guides"></div><p class="optic-caption">Laser = excitation wavelength ruler · filter = nominal emission band. Names are common fluorophore/channel examples, not fixed assignments. Verify your instrument optics.</p>`;
    node.insertAdjacentElement("afterend",div);
    el("optic-laser").addEventListener("change",e=>{if(e.target.value){data.lasers.push(Number(e.target.value));e.target.value="";persist();}});
    el("optic-filter").addEventListener("change",e=>{if(e.target.value){data.filters.push(e.target.value);e.target.value="";persist();}});
    el("optic-selected").addEventListener("click",e=>{const b=e.target.closest("[data-kind]");if(!b)return;if(b.dataset.kind==="laser")data.lasers=data.lasers.filter(x=>x!==Number(b.dataset.value));else data.filters=data.filters.filter(x=>x!==b.dataset.value);persist();});
    el("optic-clear").addEventListener("click",()=>{data={lasers:[],filters:[]};persist();});
    el("optic-add-laser").addEventListener("click",()=>{const v=Number(el("optic-custom-laser").value);if(v>=200&&v<=1500){data.lasers.push(v);el("optic-custom-laser").value="";persist();}else alert("Use a wavelength from 200 to 1500 nm.");});
    el("optic-add-filter").addEventListener("click",()=>{const c=Number(el("optic-custom-center").value),w=Number(el("optic-custom-width").value);if(c>=200&&c<=1500&&w>=1&&w<=400){data.filters.push(`${c}/${w}`);el("optic-custom-center").value="";el("optic-custom-width").value="";persist();}else alert("Enter center 200–1500 nm and width 1–400 nm.");});
    normalize();renderTags();
  }
  function svg({lo,hi,px,top,bottom}){
    const parts=['<g class="optics-annotations" pointer-events="none">'];
    for(const entry of data.filters){
      const f=parseFilter(entry);if(!f)continue;
      const low=f.center-f.width/2,high=f.center+f.width/2;
      if(high<lo||low>hi)continue;
      const a=px(Math.max(lo,low)),b=px(Math.min(hi,high));
      parts.push(`<rect x="${a}" y="${top}" width="${Math.max(0,b-a)}" height="${bottom-top}" fill="#47bfe4" fill-opacity=".09"/>`);
      for(const v of [low,high])if(v>=lo&&v<=hi)parts.push(`<line x1="${px(v)}" x2="${px(v)}" y1="${top}" y2="${bottom}" stroke="#6bdcf3" stroke-width="1.4" stroke-dasharray="3 3" stroke-opacity=".9"/>`);
      if(f.center>=lo&&f.center<=hi)parts.push(`<text x="${px(f.center)}" y="${top+13}" text-anchor="middle" fill="#8fe5f5" font-size="10">${entry}</text>`);
    }
    for(const n of data.lasers){
      if(n<lo||n>hi)continue;const x=px(n);
      parts.push(`<line x1="${x}" x2="${x}" y1="${top}" y2="${bottom}" stroke="#f6cd69" stroke-width="2" stroke-dasharray="6 3" stroke-opacity=".95"/><text x="${x+4}" y="${top+27}" fill="#ffe29c" font-size="10">${n}</text>`);
    }
    return parts.join("")+"</g>";
  }
  function restore(x){if(!x||!Array.isArray(x.lasers)||!Array.isArray(x.filters))return;data={lasers:[...x.lasers],filters:[...x.filters]};persist();}
  window.FluorescenceOptics={svg,getState:()=>JSON.parse(JSON.stringify(data)),restore};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
