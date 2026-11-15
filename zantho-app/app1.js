const APP_VERSION = '0.5.3';
const STORAGE_KEY = 'zantho-state-v1';
const PHOTO_DB = 'zantho-photos-v1';
const PHOTO_STORE = 'photos';

const SPECIES = {
  sichuan:{name:'Sichuan', latin:'Zanthoxylum simulans', color:'#e7682f'},
  korean:{name:'Sansho coréen', latin:'Zanthoxylum schinifolium', color:'#2c9a61'},
  japanese:{name:'Sansho japonais', latin:'Zanthoxylum piperitum', color:'#7e4bb0'},
  tas_f:{name:'Tasmanie ♀', latin:'Tasmannia lanceolata', color:'#3295b7'},
  tas_m:{name:'Tasmanie ♂', latin:'Tasmannia lanceolata', color:'#144d84'},
  timut:{name:'Timut', latin:'Zanthoxylum armatum', color:'#d9aa22'}
};

const nowISO = () => new Date().toISOString();
const uid = (p='id') => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
const fmtDate = s => s ? new Date(s).toLocaleDateString('fr-FR') : '—';
const fmtDateTime = s => s ? new Date(s).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}) : '—';
const esc = v => String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function defaultState(){
  return {
    version: APP_VERSION,
    createdAt: nowISO(), updatedAt: nowISO(),
    planConfigured:false,
    plan:{sichuanLine2:null,sichuanLine3:null,sichuanLine4:null},
    plants:[], observations:[], harvests:[], transformations:[], tastings:[], photoRefs:[],
    settings:{clientId:'', oneDriveFolder:'Zantho/ZanthoApp', syncEnabled:false, lastSync:null},
  };
}
function load(){ try { return {...defaultState(), ...JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')}; } catch { return defaultState(); } }
let state = load();
function save(){ state.updatedAt=nowISO(); localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); }

function buildPlants(l2,l3,l4){
  if([l2,l3,l4].some(v=>!Number.isInteger(v)||v<0) || l2+l3+l4!==46) throw new Error('La somme des Sichuan des lignes 2, 3 et 4 doit être 46.');
  const plants=[];
  const pushLine=(line, speciesArr)=> speciesArr.forEach((sp,i)=>plants.push({
    id:`L${line}-${String(i+1).padStart(2,'0')}`, line, position:i+1, species:sp,
    plantedAt:'2026-10-23', status:'Sain', vigor:'Correcte', flowering:'Absente', fruiting:'Absente', notes:'', createdAt:nowISO()
  }));
  // Ligne 1 : 12 japonais puis 10 Tasmanie dans l'ordre 2F-1M-4F-1M-2F
  pushLine(1,[...Array(12).fill('japanese'),'tas_f','tas_f','tas_m','tas_f','tas_f','tas_f','tas_f','tas_m','tas_f','tas_f']);
  pushLine(2,[...Array(l2).fill('sichuan'),...Array(12).fill('korean')]);
  pushLine(3,[...Array(l3).fill('sichuan')]);
  pushLine(4,[...Array(l4).fill('sichuan'),...Array(10).fill('timut')]);
  pushLine(5,[...Array(7).fill('timut')]);
  return plants;
}

// Hors-ligne : réseau d'abord, cache de secours.
if ('serviceWorker' in navigator) {
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v=0.5.3').catch(err=>console.warn('Service worker',err)));
}

const app=document.querySelector('#app');
let currentView='dashboard';
let qualityTab='transformations';

document.querySelectorAll('.bottom-nav button').forEach(b=>b.addEventListener('click',()=>{
  currentView=b.dataset.view; document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.toggle('active',x===b)); render();
}));

function speciesCounts(){
  const c={}; Object.keys(SPECIES).forEach(k=>c[k]=0); state.plants.forEach(p=>c[p.species]=(c[p.species]||0)+1); return c;
}
function latestObsForPlant(id){ return state.observations.filter(o=>o.plantId===id).sort((a,b)=>b.date.localeCompare(a.date))[0]; }
function plantStatus(p){ return latestObsForPlant(p.id)?.health || p.status || 'Sain'; }

function render(){
  document.querySelector('#syncPill').textContent=state.settings.lastSync?`Sync ${fmtDateTime(state.settings.lastSync)}`:'Local';
  if(!state.planConfigured){
    if(currentView==='plan') return renderPlanSetup();
    if(currentView==='dashboard') return renderPrePlanDashboard();
    if(currentView==='harvest') return renderPrePlanSection('Récoltes','Configure le plan avant de créer des lots de récolte.');
    if(currentView==='quality') return renderPrePlanSection('Qualité','Configure le plan avant de relier récoltes, transformations et dégustations.');
  }
  ({dashboard:renderDashboard,plan:renderPlan,harvest:renderHarvests,quality:renderQuality,settings:renderSettings}[currentView]||renderDashboard)();
}

function renderPrePlanDashboard(){
  app.innerHTML=`
    <div class="hero-card">
      <div class="eyebrow">Première configuration</div>
      <h2>Zantho est prêt</h2>
      <p>Il reste une seule donnée à renseigner : la répartition des 46 Sichuan entre les lignes 2, 3 et 4.</p>
      <button class="btn" id="goConfigurePlan">Configurer le plan</button>
    </div>
    <div class="grid two">
      <div class="card"><h3>Déjà connu</h3><p class="small-note">L1 : 12 Sansho japonais + 10 Tasmanie · L2 : 12 Sansho coréens après les Sichuan · L4 : 10 Timut · L5 : 7 Timut.</p></div>
      <div class="card"><h3>Pourquoi le demander ?</h3><p class="small-note">Je préfère te demander les 3 nombres exacts plutôt que d’inventer la position des Sichuan.</p></div>
    </div>`;
  document.querySelector('#goConfigurePlan').onclick=()=>{currentView='plan';syncNav();render();};
}

function renderPrePlanSection(title,message){
  app.innerHTML=`<div class="section-title"><h2>${title}</h2></div>
    <div class="card">
      <p>${message}</p>
      <button class="btn" id="goConfigurePlan">Configurer le plan</button>
    </div>`;
  document.querySelector('#goConfigurePlan').onclick=()=>{currentView='plan';syncNav();render();};
}

function renderPlanSetup(){
  app.innerHTML=`<div class="card"><h2>Calibrer le plan réel</h2>
  <p>Les 46 Sichuan sont répartis entre les lignes 2, 3 et 4. Renseigne seulement ces trois nombres : l’app vérifiera automatiquement que le total vaut 46.</p>
  <form id="setupForm" class="stack">
    <div class="field"><label>Sichuan — ligne 2</label><input type="number" id="l2" min="0" required></div>
    <div class="field"><label>Sichuan — ligne 3</label><input type="number" id="l3" min="0" required></div>
    <div class="field"><label>Sichuan — ligne 4</label><input type="number" id="l4" min="0" required></div>
    <div class="notice">Fixe déjà : L1 = 12 Sansho japonais + 10 Tasmanie ; L2 finit par 12 Sansho coréens ; L4 finit par 10 Timut ; L5 = 7 Timut.</div>
    <div id="setupErr" class="small-note"></div><button class="btn">Créer les 97 plants</button>
  </form></div>`;
  document.querySelector('#setupForm').addEventListener('submit',e=>{
    e.preventDefault(); const l2=+document.querySelector('#l2').value,l3=+document.querySelector('#l3').value,l4=+document.querySelector('#l4').value;
    try{ state.plants=buildPlants(l2,l3,l4); state.plan={sichuanLine2:l2,sichuanLine3:l3,sichuanLine4:l4}; state.planConfigured=true; state.planUpdatedAt=nowISO(); save(); render(); }
    catch(err){ document.querySelector('#setupErr').textContent=err.message; }
  });
}

function renderDashboard(){
  const counts=speciesCounts();
  const problem=state.plants.filter(p=>['À surveiller','Problème'].includes(plantStatus(p))).length;
  const flowering=state.plants.filter(p=>['Faible','Moyenne','Forte'].includes(latestObsForPlant(p.id)?.flowering)).length;
  const fruiting=state.plants.filter(p=>['Faible','Moyenne','Forte'].includes(latestObsForPlant(p.id)?.fruiting)).length;
  const totalFresh=state.harvests.flatMap(h=>h.sessions||[]).reduce((s,x)=>s+(+x.freshWeight||0),0);
  app.innerHTML=`
  <div class="grid kpis">
    <div class="card kpi"><strong>${state.plants.length}</strong><span>plants suivis</span></div>
    <div class="card kpi"><strong>${problem}</strong><span>à surveiller / problème</span></div>
    <div class="card kpi"><strong>${flowering}</strong><span>en floraison observée</span></div>
    <div class="card kpi"><strong>${fruiting}</strong><span>en fructification observée</span></div>
  </div>
  <div class="grid two" style="margin-top:12px">
    <div class="card"><h3>Plantation</h3>${Object.entries(counts).filter(([,n])=>n).map(([k,n])=>`<div class="row" style="justify-content:space-between"><span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${SPECIES[k].color};margin-right:7px"></i>${SPECIES[k].name}</span><strong>${n}</strong></div>`).join('')}</div>
    <div class="card"><h3>Production</h3><div class="row" style="justify-content:space-between"><span>Lots de récolte</span><strong>${state.harvests.length}</strong></div><div class="row" style="justify-content:space-between"><span>Poids frais cumulé</span><strong>${totalFresh?totalFresh.toFixed(1):'0'} g</strong></div><div class="row" style="justify-content:space-between"><span>Essais transformation</span><strong>${state.transformations.length}</strong></div><div class="row" style="justify-content:space-between"><span>Dégustations</span><strong>${state.tastings.length}</strong></div></div>
  </div>
  <div class="section-title"><h2>Accès rapide</h2></div>
  <div class="grid two"><button class="btn" id="quickPlan">Trouver un plant</button><button class="btn secondary" id="quickHarvest">Nouvelle récolte</button></div>`;
  document.querySelector('#quickPlan').onclick=()=>{currentView='plan';syncNav();render();};
  document.querySelector('#quickHarvest').onclick=()=>openHarvestModal();
}
function syncNav(){ document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===currentView)); }

function renderPlan(){
  const lines=[1,2,3,4,5].map(n=>state.plants.filter(p=>p.line===n).sort((a,b)=>a.position-b.position));
  app.innerHTML=`<div class="section-title"><h2>Plan des plants</h2><span class="badge">${state.plants.length} plants</span></div>
  <input class="search" id="plantSearch" placeholder="Rechercher L4-03, Timut, coréen…" />
  <div class="legend">${Object.entries(SPECIES).map(([k,s])=>`<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>
  <div class="plant-map">${lines.map((arr,i)=>`<div class="line"><div class="line-label">L${i+1}</div><div class="line-track">${arr.map(p=>plantDot(p)).join('')}</div></div>`).join('')}</div>
  <div class="small-note">Touchez un plant pour ouvrir sa fiche. Un halo jaune/rouge signale un plant à surveiller / en problème.</div>`;
  bindPlantDots();
  document.querySelector('#plantSearch').addEventListener('input',e=>{
    const q=e.target.value.trim().toLowerCase(); document.querySelectorAll('.plant-dot').forEach(el=>{
      const p=state.plants.find(x=>x.id===el.dataset.id); const hay=`${p.id} ${SPECIES[p.species].name} ${SPECIES[p.species].latin}`.toLowerCase(); el.style.opacity=!q||hay.includes(q)?'1':'.12';
    });
  });
}
function plantDot(p){ const status=plantStatus(p); const cls=status==='Problème'?'problem':status==='À surveiller'?'watch':''; return `<button class="plant-dot ${p.species==='tas_m'?'male':''} ${cls}" data-id="${p.id}" title="${p.id} — ${SPECIES[p.species].name}" style="background:${SPECIES[p.species].color}"></button>`; }
function bindPlantDots(){ document.querySelectorAll('.plant-dot[data-id]').forEach(el=>el.onclick=()=>openPlant(el.dataset.id)); }
