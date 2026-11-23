const APP_VERSION = '0.6.5';
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

const PLANT_NICKNAMES = {
  'L1-TAS-01':'Yvette','L1-TAS-02':'Léonce','L1-TAS-03':'Alexandre','L1-TAS-04':'Annick','L1-TAS-05':'Estelle',
  'L1-TAS-06':'Micheline','L1-TAS-07':'Georgette','L1-TAS-08':'Jean','L1-TAS-09':'Marie-France','L1-TAS-10':'Yvonne',
  'L1-JAP-01':'Oufti','L1-JAP-02':'Mazette','L1-JAP-03':'Crapôde','L1-JAP-04':'Di Djaal','L1-JAP-05':'Macrâle',
  'L1-JAP-06':'Li Porè','L1-JAP-07':'Crompir','L1-JAP-08':'Rawète','L1-JAP-09':'Téch’tu','L1-JAP-10':'Sacwè',
  'L1-JAP-11':'Qué Novel ?','L1-JAP-12':'Drache',
  'L2-COR-01':'Renaud','L2-COR-02':'Jacques Brel','L2-COR-03':'Léo Ferré','L2-COR-04':'Jean Ferrat',
  'L2-COR-05':'Francis Cabrel','L2-COR-06':'Laurent Voulzy','L2-COR-07':'Stromae','L2-COR-08':'Ben Mazué',
  'L2-COR-09':'Pomme','L2-COR-10':'Solann','L2-COR-11':'Lara Fabian','L2-COR-12':'Céline Dion',
  'L2-SIC-01':'René Magritte','L2-SIC-02':'James Ensor','L2-SIC-03':'Jean-Michel Folon','L2-SIC-04':'Kevin De Bruyne',
  'L2-SIC-05':'Hergé','L2-SIC-06':'André Franquin','L2-SIC-07':'Georges Simenon','L2-SIC-08':'François Damiens',
  'L2-SIC-09':'Atomium','L2-SIC-10':'Jean-Baptiste « Toots » Thielemans','L2-SIC-11':'Manneken Pis',
  'L2-SIC-12':'Peter Paul Rubens','L2-SIC-13':'Pieter Bruegel L’Ancien','L2-SIC-14':'Gérard Mercator',
  'L2-SIC-15':'Adolphe Sax','L2-SIC-16':'Benoît Poelvoorde','L2-SIC-17':'Teddy Bear',
  'L3-SIC-01':'Bruxelles','L3-SIC-02':'Liège','L3-SIC-03':'Namur','L3-SIC-04':'Mons','L3-SIC-05':'Charleroi',
  'L3-SIC-06':'Gand','L3-SIC-07':'Ostende','L3-SIC-08':'Tilff','L3-SIC-09':'Kasteel','L3-SIC-10':'Chimay',
  'L3-SIC-11':'Orval','L3-SIC-12':'Chicon','L3-SIC-13':'Craquelin','L3-SIC-14':'Gaufre','L3-SIC-15':'Gueuze',
  'L3-SIC-16':'Roi Philippe','L3-SIC-17':'Cougnou','L3-SIC-18':'Spéculoos','L3-SIC-19':'Mitraillette',
  'L3-SIC-20':'Cramique','L3-SIC-21':'Sauce Lapin','L3-SIC-22':'Peket','L3-SIC-23':'Fricadelle',
  'L4-SIC-01':'Tintin','L4-SIC-02':'Milou','L4-SIC-03':'Gaston','L4-SIC-04':'Spirou','L4-SIC-05':'Marsupilami','L4-SIC-06':'Lucky Luke',
  'L4-TIM-01':'Fernande','L4-TIM-02':'Cupidon S’en Fout','L4-TIM-03':'Le Roi Boiteux','L4-TIM-04':'Le Roi Des Cons',
  'L4-TIM-05':'Les Copains D’Abord','L4-TIM-06':'Je Me Suis Fait Tout Petit','L4-TIM-07':'J’Ai Rendez-Vous Avec Vous',
  'L4-TIM-08':'Les Passantes','L4-TIM-09':'Brave Margot','L4-TIM-10':'Hécatombe',
  'L5-TIM-01':'La Chasse Aux Papillons','L5-TIM-02':'La Non-Demande En Mariage','L5-TIM-03':'Saturne',
  'L5-TIM-04':'Les Sabots D’Hélène','L5-TIM-05':'Misogynie À Part','L5-TIM-06':'La Ronde Des Jurons','L5-TIM-07':'Trompettes De La Renommée'
};

const NICKNAME_UNIVERSES = {
  'L1-TAS':'Prénoms Désuets',
  'L1-JAP':'Wallonie — Mots & Expressions',
  'L2-COR':'Chanson Francophone',
  'L2-SIC':'Belgique — Artistes & Culture',
  'L3-SIC':'Belgique — Villes, Saveurs & Clins D’Œil',
  'L4-SIC':'Belgique — Personnages De BD',
  'L4-TIM':'Georges Brassens — Chansons',
  'L5-TIM':'Georges Brassens — Chansons'
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

  // Code terrain lisible, sans modifier l'identifiant technique historique.
  const family=sp=>sp==='tas_f'||sp==='tas_m'?'TAS':sp==='japanese'?'JAP':sp==='korean'?'COR':sp==='sichuan'?'SIC':sp==='timut'?'TIM':'AUT';
  const counters={};
  plants.forEach(p=>{
    const fam=family(p.species);
    const key=`L${p.line}-${fam}`;
    counters[key]=(counters[key]||0)+1;
    p.groupCode=key;
    p.code=`${key}-${String(counters[key]).padStart(2,'0')}`;
    p.nickname=PLANT_NICKNAMES[p.code]||'';
    p.nicknameUniverse=NICKNAME_UNIVERSES[p.groupCode]||'';
  });
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
      return !old || old.species!==t.species || old.line!==t.line || old.position!==t.position || old.code!==t.code || old.groupCode!==t.groupCode || old.nickname!==t.nickname || old.nicknameUniverse!==t.nicknameUniverse;
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
      nickname:t.nickname,
      nicknameUniverse:t.nicknameUniverse,
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
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v=0.6.5').catch(err=>console.warn('Service worker',err)));
}

const app=document.querySelector('#app');
let currentView='plan';
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
