// Zantho V0.4.1 — corrections, suppression contrôlée, rollback local

const _saveCoreV041=save;
save=function(){
  try{
    const previous=localStorage.getItem(STORAGE_KEY);
    if(previous) localStorage.setItem('zantho-state-backup-v1',previous);
  }catch{}
  _saveCoreV041();
};

function openPlant(id){
  const p=state.plants.find(x=>x.id===id); if(!p)return;
  const obs=state.observations.filter(o=>o.plantId===id).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const last=obs[0]; const age=daysSince(last?.date);
  const m=openModal(`<div class="plant-sheet">
    <div class="plant-sheet-head">
      <div><div class="eyebrow">Ligne ${p.line} · position ${p.position}</div><h2>${p.id}</h2><div class="muted">${SPECIES[p.species].name}<br><em>${SPECIES[p.species].latin}</em></div></div>
      <span class="status-dot ${statusTone(plantStatus(p))}">${esc(plantStatus(p))}</span>
    </div>
    <div class="last-observation">
      <strong>${last?'Dernière observation':'Pas encore observé'}</strong>
      ${last?`<span>${esc(last.vigor)} · floraison ${esc(last.flowering)} · fruits ${esc(last.fruiting)}</span><small>${fmtDate(last.date)}${age!==null?' · il y a '+age+' j':''}</small>`:''}
    </div>
    <div class="action-strip">
      <button class="btn" id="quickObsPlant">Saisie express</button>
      <button class="btn secondary" id="photoPlant">Photo</button>
      <button class="btn secondary" id="detailObsPlant">Détaillée</button>
    </div>
    <div class="section-title"><h3>Historique</h3><span class="badge">${obs.length}</span></div>
    <div class="timeline">${obs.length?obs.slice(0,12).map(o=>`<div class="timeline-row static observation-row">
      <strong>${fmtDate(o.date)}</strong>
      <span>${esc(o.health)} · ${esc(o.vigor)}</span>
      <small>Fleurs ${esc(o.flowering)} · fruits ${esc(o.fruiting)}${o.note?' · '+esc(o.note):''}</small>
      <button type="button" class="mini-delete" data-del-obs="${o.id}" aria-label="Supprimer cette observation">Suppr.</button>
    </div>`).join(''):'<div class="muted">Aucune observation.</div>'}</div>
    <div class="section-title"><h3>Photos</h3></div><div class="photo-grid" id="plantPhotos"></div>
  </div>`);
  m.querySelector('#quickObsPlant').onclick=()=>openQuickObs(id,()=>{m.remove();openPlant(id);});
  m.querySelector('#photoPlant').onclick=()=>openPhotoCapture(id,m);
  m.querySelector('#detailObsPlant').onclick=()=>openObservation(id,m);
  m.querySelectorAll('[data-del-obs]').forEach(b=>b.onclick=()=>{
    if(!confirm('Supprimer cette observation ?')) return;
    state.observations=state.observations.filter(o=>o.id!==b.dataset.delObs);
    save();
    m.remove();
    render();
    openPlant(id);
  });
  loadPlantPhotos(id,m.querySelector('#plantPhotos'));
}

function openHarvest(id){
  const h=state.harvests.find(x=>x.id===id); if(!h)return;
  const total=(h.sessions||[]).reduce((s,x)=>s+(+x.freshWeight||0),0);
  const duration=(h.sessions||[]).reduce((s,x)=>s+Math.max(0,(new Date(x.end)-new Date(x.start))/3600000||0),0);
  const isActive=state.activeHarvestSession?.harvestId===id;
  const sessions=(h.sessions||[]).slice().reverse();

  const m=openModal(`<div class="section-title"><div><div class="eyebrow">${SPECIES[h.species].name}</div><h2>${esc(h.name)}</h2></div><span class="badge">${total.toFixed(0)} g</span></div>
    <div class="grid two mini-stats">
      <div class="card"><strong>${h.sessions.length}</strong><span>sessions</span></div>
      <div class="card"><strong>${duration.toFixed(1)} h</strong><span>temps cumulé</span></div>
    </div>
    <div class="action-strip">
      ${isActive?'<button class="btn" id="timerBtn">Terminer la session</button>':'<button class="btn" id="timerBtn">▶ Démarrer maintenant</button>'}
      <button class="btn secondary" id="manualSession">Saisie manuelle</button>
      <button class="btn secondary" id="editHarvestPlants">Plants</button>
    </div>
    <div class="section-title"><h3>Sessions</h3></div>
    <div class="timeline">${sessions.length?sessions.map(s=>`<div class="timeline-row static harvest-session-row">
      <strong>${(+s.freshWeight||0).toFixed(0)} g</strong>
      <span>${fmtDateTime(s.start)} → ${fmtDateTime(s.end)}</span>
      <small>${s.note?esc(s.note):''}</small>
      <button type="button" class="mini-delete" data-del-session="${s.id}" aria-label="Supprimer cette session">Suppr.</button>
    </div>`).join(''):'<div class="muted">Aucune session.</div>'}</div>
    <details class="danger-zone"><summary>Options du lot</summary><button type="button" class="btn danger small" id="deleteHarvest">Supprimer ce lot</button></details>`);

  m.querySelector('#timerBtn').onclick=()=>{m.remove(); isActive?finishHarvestTimer():startHarvestTimer(id);};
  m.querySelector('#manualSession').onclick=()=>openSession(id,m);
  m.querySelector('#editHarvestPlants').onclick=()=>openHarvestPlantSelection(id,m);

  m.querySelectorAll('[data-del-session]').forEach(b=>b.onclick=()=>{
    if(!confirm('Supprimer cette session de récolte ?')) return;
    h.sessions=(h.sessions||[]).filter(s=>s.id!==b.dataset.delSession);
    h.updatedAt=nowISO();
    save();
    m.remove();
    render();
    openHarvest(id);
  });

  m.querySelector('#deleteHarvest').onclick=()=>{
    const linked=state.transformations.filter(t=>t.harvestId===id).length;
    if(linked) return alert('Ce lot est utilisé par '+linked+' essai(s) de transformation. Supprime ou rattache ces essais avant.');
    if(!confirm('Supprimer définitivement ce lot et toutes ses sessions ?')) return;
    if(state.activeHarvestSession?.harvestId===id) state.activeHarvestSession=null;
    state.harvests=state.harvests.filter(x=>x.id!==id);
    save();
    m.remove();
    render();
  };
}

const _renderSettingsV041=renderSettings;
renderSettings=function(){
  _renderSettingsV041();
  const box=document.createElement('div');
  box.className='card safety-card';
  box.innerHTML=`<h3>Sécurité locale</h3>
    <p class="small-note">Avant chaque modification, Zantho garde automatiquement l’état local précédent. Cela ne remplace pas la synchronisation OneDrive.</p>
    <button class="btn secondary" id="restorePrevious">Revenir à l’état précédent</button>`;
  app.appendChild(box);
  box.querySelector('#restorePrevious').onclick=()=>{
    const raw=localStorage.getItem('zantho-state-backup-v1');
    if(!raw) return alert('Aucune sauvegarde précédente disponible.');
    if(!confirm('Revenir à l’état précédent ?')) return;
    try{
      state={...defaultState(),...JSON.parse(raw),version:'0.4.1'};
      _saveCoreV041();
      render();
    }catch{
      alert('La sauvegarde précédente est illisible.');
    }
  };
};

function refreshConnectivity(){
  const pill=document.querySelector('#syncPill');
  if(!pill) return;
  if(!navigator.onLine){
    pill.textContent='Hors ligne';
    pill.classList.add('offline');
  }else{
    pill.classList.remove('offline');
    pill.textContent=state.settings.lastSync?'Sync '+fmtDateTime(state.settings.lastSync):'Local';
  }
}
const _renderConnectivityV041=render;
render=function(){
  _renderConnectivityV041();
  refreshConnectivity();
};
window.addEventListener('online',refreshConnectivity);
window.addEventListener('offline',refreshConnectivity);

state.version='0.4.1';
_saveCoreV041();
render();
