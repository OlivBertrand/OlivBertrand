const APP_VERSION = '0.5.5';
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
    planConfigured:true,
    plan:{sichuanLine2:17,sichuanLine3:23,sichuanLine4:6},
    planUpdatedAt: nowISO(),
    plants:buildPlants(17,23,6), observations:[], harvests:[], transformations:[], tastings:[], photoRefs:[],
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
  // Implantation réelle : L1 = 10 Tasmanie (2F-1M-4F-1M-2F), puis 12 Sansho japonais.
  pushLine(1,['tas_f','tas_f','tas_m','tas_f','tas_f','tas_f','tas_f','tas_m','tas_f','tas_f',...Array(12).fill('japanese')]);
  // L2 = 12 Sansho coréens, puis Sichuan.
  pushLine(2,[...Array(12).fill('korean'),...Array(l2).fill('sichuan')]);
  pushLine(3,[...Array(l3).fill('sichuan')]);
  pushLine(4,[...Array(l4).fill('sichuan'),...Array(10).fill('timut')]);
  pushLine(5,[...Array(7).fill('timut')]);
  return plants;
}

function enforceOfficialPlan(){
  const official={sichuanLine2:17,sichuanLine3:23,sichuanLine4:6};
  const target=buildPlants(17,23,6);
  const oldById=new Map((state.plants||[]).map(p=>[p.id,p]));
  const layoutMismatch=
    !state.planConfigured ||
    +state.plan?.sichuanLine2!==17 ||
    +state.plan?.sichuanLine3!==23 ||
    +state.plan?.sichuanLine4!==6 ||
    target.some(t=>{
      const old=oldById.get(t.id);
      return !old || old.species!==t.species || old.line!==t.line || old.position!==t.position;
    });

  if(!layoutMismatch) return;

  state.plants=target.map(t=>{
    const old=oldById.get(t.id)||{};
    return {
      ...t,
      ...old,
      id:t.id,
      line:t.line,
      position:t.position,
      species:t.species,
      plantedAt:old.plantedAt||t.plantedAt,
      createdAt:old.createdAt||t.createdAt
    };
  });
  state.planConfigured=true;
  state.plan=official;
  state.planUpdatedAt=nowISO();
  save();
}
enforceOfficialPlan();

// Hors-ligne : réseau d'abord, cache de secours.
if ('serviceWorker' in navigator) {
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v=0.5.5').catch(err=>console.warn('Service worker',err)));
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
  enforceOfficialPlan();
  currentView='plan';
  syncNav();
  renderPlan();
}

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
