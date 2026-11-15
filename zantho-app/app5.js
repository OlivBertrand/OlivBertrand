// Zantho V0.4 — UX terrain
state.version='0.4.0';
state.ui=state.ui||{};
state.activeHarvestSession=state.activeHarvestSession||null;
save();

function daysSince(s){
  if(!s) return null;
  return Math.floor((Date.now()-new Date(s).getTime())/86400000);
}
function latestObs(id){
  return state.observations.filter(o=>o.plantId===id).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0]||null;
}
function phenologyLevel(v){ return ['Absente','Faible','Moyenne','Forte'].indexOf(v); }
function statusTone(s){ return s==='Problème'?'danger':s==='À surveiller'?'watch':'ok'; }
function saveQuickObservation(plantId,vals,note=''){
  state.observations.push({
    id:uid('obs'),
    plantId,
    date:new Date().toISOString().slice(0,10),
    vigor:vals.vigor,
    health:vals.health,
    flowering:vals.flowering,
    fruiting:vals.fruiting,
    height:'',
    width:'',
    note,
    createdAt:nowISO(),
    updatedAt:nowISO()
  });
  save();
}
function defaultsForPlant(id){
  const p=state.plants.find(x=>x.id===id);
  const o=latestObs(id);
  return {
    vigor:o?.vigor||p?.vigor||'Correcte',
    health:o?.health||p?.status||'Sain',
    flowering:o?.flowering||'Absente',
    fruiting:o?.fruiting||'Absente'
  };
}
function seg(name,values,current){
  return '<div class="seg" data-seg="'+name+'">'+values.map(v=>'<button type="button" data-v="'+esc(v)+'" class="'+(v===current?'selected':'')+'">'+esc(v)+'</button>').join('')+'</div>';
}
function bindSeg(root){
  root.querySelectorAll('.seg').forEach(g=>g.querySelectorAll('button').forEach(b=>b.onclick=()=>{
    g.querySelectorAll('button').forEach(x=>x.classList.remove('selected'));
    b.classList.add('selected');
  }));
}
function segVal(root,name){ return root.querySelector('.seg[data-seg="'+name+'"] .selected')?.dataset.v||''; }

function renderDashboard(){
  const now=Date.now();
  const last30=new Set(state.observations.filter(o=>now-new Date(o.date).getTime()<=30*86400000).map(o=>o.plantId)).size;
  const issues=state.plants.filter(p=>['À surveiller','Problème'].includes(plantStatus(p)));
  const never=state.plants.filter(p=>!latestObs(p.id)).length;
  const active=state.activeHarvestSession && state.harvests.find(h=>h.id===state.activeHarvestSession.harvestId);
  const lastObsRows=state.observations.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,5);

  app.innerHTML=`
    ${active?`<div class="active-harvest">
      <div><strong>Récolte en cours</strong><div class="small-note">${esc(active.name)} · démarrée ${fmtDateTime(state.activeHarvestSession.start)}</div></div>
      <button class="btn" id="finishActive">Terminer</button>
    </div>`:''}

    <div class="hero-card">
      <div>
        <div class="eyebrow">Aujourd’hui</div>
        <h2>Que veux-tu faire ?</h2>
      </div>
      <div class="quick-grid">
        <button class="quick-action" id="startTour"><span>✓</span><strong>Tournée express</strong><small>Plant par plant</small></button>
        <button class="quick-action" id="findPlant"><span>⌕</span><strong>Trouver un plant</strong><small>ID ou espèce</small></button>
        <button class="quick-action" id="newHarvestHome"><span>◉</span><strong>Récolte</strong><small>Démarrer un lot</small></button>
        <button class="quick-action" id="addPhotoHome"><span>▣</span><strong>Photo</strong><small>Choisir le plant</small></button>
      </div>
    </div>

    <div class="grid kpis dashboard-kpis">
      <button class="card kpi tappable" id="issuesKpi"><strong>${issues.length}</strong><span>à surveiller</span></button>
      <div class="card kpi"><strong>${last30}</strong><span>vus sur 30 j</span></div>
      <div class="card kpi"><strong>${never}</strong><span>jamais observés</span></div>
      <div class="card kpi"><strong>${state.harvests.length}</strong><span>lots de récolte</span></div>
    </div>

    <div class="section-title"><h2>À regarder</h2></div>
    <div class="list compact-list">
      ${issues.length?issues.slice(0,6).map(p=>{
        const o=latestObs(p.id); const d=daysSince(o?.date);
        return `<button class="list-item" data-open-plant="${p.id}">
          <div><strong>${p.id}</strong><div class="small-note">${SPECIES[p.species].name}${d!==null?' · vu il y a '+d+' j':''}</div></div>
          <span class="status-dot ${statusTone(plantStatus(p))}">${esc(plantStatus(p))}</span>
        </button>`;
      }).join(''):'<div class="card calm">Aucun plant signalé à surveiller.</div>'}
    </div>

    <div class="section-title"><h2>Dernières saisies</h2></div>
    <div class="timeline">
      ${lastObsRows.length?lastObsRows.map(o=>`<button data-open-plant="${o.plantId}" class="timeline-row">
        <strong>${o.plantId}</strong>
        <span>${esc(o.health)} · ${esc(o.vigor)}</span>
        <small>${fmtDate(o.date)}</small>
      </button>`).join(''):'<div class="card muted">Aucune observation pour l’instant.</div>'}
    </div>`;

  document.querySelector('#startTour').onclick=()=>openTour();
  document.querySelector('#findPlant').onclick=()=>{currentView='plan';syncNav();render();setTimeout(()=>document.querySelector('#plantSearch')?.focus(),50);};
  document.querySelector('#newHarvestHome').onclick=()=>openHarvestModal();
  document.querySelector('#addPhotoHome').onclick=()=>openPlantPicker('photo');
  document.querySelector('#issuesKpi').onclick=()=>openIssueList();
  document.querySelectorAll('[data-open-plant]').forEach(b=>b.onclick=()=>openPlant(b.dataset.openPlant));
  if(active) document.querySelector('#finishActive').onclick=()=>finishHarvestTimer();
}

function openIssueList(){
  const arr=state.plants.filter(p=>['À surveiller','Problème'].includes(plantStatus(p)));
  const m=openModal(`<h2>Plants à surveiller</h2><div class="list">${arr.map(p=>`<button class="list-item" data-p="${p.id}"><div><strong>${p.id}</strong><div class="small-note">${SPECIES[p.species].name}</div></div><span class="status-dot ${statusTone(plantStatus(p))}">${esc(plantStatus(p))}</span></button>`).join('')||'<div class="muted">Aucun.</div>'}</div>`);
  m.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{m.remove();openPlant(b.dataset.p);});
}
function openPlantPicker(mode='open'){
  const m=openModal(`<h2>Choisir un plant</h2><input class="search" id="pickSearch" placeholder="L4-03, Timut, japonais…"><div class="plant-picker" id="pickList"></div>`);
  const list=m.querySelector('#pickList');
  const draw=q=>{
    q=(q||'').toLowerCase().trim();
    const arr=state.plants.filter(p=>!q||(`${p.id} ${SPECIES[p.species].name} ${SPECIES[p.species].latin}`).toLowerCase().includes(q)).slice(0,30);
    list.innerHTML=arr.map(p=>`<button data-p="${p.id}"><strong>${p.id}</strong><span>${SPECIES[p.species].name}</span></button>`).join('');
    list.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{const id=b.dataset.p;m.remove(); mode==='photo'?openPhotoCapture(id,{remove:()=>{}}):openPlant(id);});
  };
  draw('');
  m.querySelector('#pickSearch').oninput=e=>draw(e.target.value);
}

function renderPlan(){
  const lines=[1,2,3,4,5].map(n=>state.plants.filter(p=>p.line===n).sort((a,b)=>a.position-b.position));
  app.innerHTML=`<div class="section-title"><div><h2>Plan</h2><div class="small-note">Touchez un plant pour sa fiche</div></div><button class="btn small" id="tourFromPlan">Tournée</button></div>
  <input class="search" id="plantSearch" placeholder="Rechercher L4-03, Timut, coréen…">
  <div class="line-cards">${lines.map((arr,i)=>`<section class="line-card">
    <div class="line-card-head"><strong>Ligne ${i+1}</strong><span>${arr.length} plants</span></div>
    <div class="line-dots">${arr.map(p=>`<button class="plant-pill ${statusTone(plantStatus(p))}" data-id="${p.id}" style="--sp:${SPECIES[p.species].color}" title="${p.id}"><span></span><small>${p.position}</small></button>`).join('')}</div>
  </section>`).join('')}</div>
  <div class="legend">${Object.entries(SPECIES).map(([k,s])=>`<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>`;
  document.querySelector('#tourFromPlan').onclick=()=>openTour();
  document.querySelectorAll('.plant-pill').forEach(el=>el.onclick=()=>openPlant(el.dataset.id));
  document.querySelector('#plantSearch').oninput=e=>{
    const q=e.target.value.toLowerCase().trim();
    document.querySelectorAll('.plant-pill').forEach(el=>{
      const p=state.plants.find(x=>x.id===el.dataset.id);
      el.classList.toggle('dim',!!q && !(`${p.id} ${SPECIES[p.species].name} ${SPECIES[p.species].latin}`).toLowerCase().includes(q));
    });
  };
}

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
    <div class="timeline">${obs.length?obs.slice(0,12).map(o=>`<div class="timeline-row static"><strong>${fmtDate(o.date)}</strong><span>${esc(o.health)} · ${esc(o.vigor)}</span><small>Fleurs ${esc(o.flowering)} · fruits ${esc(o.fruiting)}${o.note?' · '+esc(o.note):''}</small></div>`).join(''):'<div class="muted">Aucune observation.</div>'}</div>
    <div class="section-title"><h3>Photos</h3></div><div class="photo-grid" id="plantPhotos"></div>
  </div>`);
  m.querySelector('#quickObsPlant').onclick=()=>openQuickObs(id,()=>{m.remove();openPlant(id);});
  m.querySelector('#photoPlant').onclick=()=>openPhotoCapture(id,m);
  m.querySelector('#detailObsPlant').onclick=()=>openObservation(id,m);
  loadPlantPhotos(id,m.querySelector('#plantPhotos'));
}

function openQuickObs(plantId,onDone=null){
  const p=state.plants.find(x=>x.id===plantId), d=defaultsForPlant(plantId);
  const m=openModal(`<div class="eyebrow">${p.id} · ${SPECIES[p.species].name}</div><h2>Saisie express</h2>
    <form id="quickObsForm" class="stack quick-form">
      <div><label class="quick-label">État</label>${seg('health',['Sain','À surveiller','Problème'],d.health)}</div>
      <div><label class="quick-label">Vigueur</label>${seg('vigor',['Faible','Correcte','Bonne','Très bonne'],d.vigor==='Très faible'?'Faible':d.vigor)}</div>
      <div><label class="quick-label">Floraison</label>${seg('flowering',['Absente','Faible','Moyenne','Forte'],d.flowering)}</div>
      <div><label class="quick-label">Fruits</label>${seg('fruiting',['Absente','Faible','Moyenne','Forte'],d.fruiting)}</div>
      <details><summary>Ajouter une note</summary><textarea name="note" placeholder="Facultatif"></textarea></details>
      <button class="btn big">Enregistrer</button>
    </form>`);
  bindSeg(m);
  m.querySelector('#quickObsForm').onsubmit=e=>{
    e.preventDefault();
    saveQuickObservation(plantId,{
      health:segVal(m,'health'),vigor:segVal(m,'vigor'),
      flowering:segVal(m,'flowering'),fruiting:segVal(m,'fruiting')
    },e.target.note.value.trim());
    m.remove(); if(onDone)onDone(); else render();
  };
}

function openTour(ids=null,index=0){
  ids=ids||state.plants.slice().sort((a,b)=>a.line-b.line||a.position-b.position).map(p=>p.id);
  if(index>=ids.length){ alert('Tournée terminée.'); render(); return; }
  const id=ids[index], p=state.plants.find(x=>x.id===id), d=defaultsForPlant(id);
  const m=openModal(`<div class="tour-head"><div><div class="eyebrow">Tournée · ${index+1}/${ids.length}</div><h2>${id}</h2><div class="muted">${SPECIES[p.species].name} · ligne ${p.line}</div></div><progress max="${ids.length}" value="${index+1}"></progress></div>
    <form id="tourForm" class="stack quick-form">
      <div><label class="quick-label">État</label>${seg('health',['Sain','À surveiller','Problème'],d.health)}</div>
      <div><label class="quick-label">Vigueur</label>${seg('vigor',['Faible','Correcte','Bonne','Très bonne'],d.vigor==='Très faible'?'Faible':d.vigor)}</div>
      <div><label class="quick-label">Floraison</label>${seg('flowering',['Absente','Faible','Moyenne','Forte'],d.flowering)}</div>
      <div><label class="quick-label">Fruits</label>${seg('fruiting',['Absente','Faible','Moyenne','Forte'],d.fruiting)}</div>
      <details><summary>Note</summary><textarea name="note" placeholder="Facultatif"></textarea></details>
      <div class="grid two"><button type="button" class="btn secondary" id="skipTour">Passer</button><button class="btn">Valider & suivant</button></div>
    </form>`);
  bindSeg(m);
  m.querySelector('#skipTour').onclick=()=>{m.remove();openTour(ids,index+1);};
  m.querySelector('#tourForm').onsubmit=e=>{
    e.preventDefault();
    saveQuickObservation(id,{
      health:segVal(m,'health'),vigor:segVal(m,'vigor'),
      flowering:segVal(m,'flowering'),fruiting:segVal(m,'fruiting')
    },e.target.note.value.trim());
    m.remove(); openTour(ids,index+1);
  };
}

function renderHarvests(){
  const active=state.activeHarvestSession && state.harvests.find(h=>h.id===state.activeHarvestSession.harvestId);
  app.innerHTML=`<div class="section-title"><div><h2>Récoltes</h2><div class="small-note">Lots et temps de récolte</div></div><button class="btn small" id="newHarvest">Nouveau lot</button></div>
  ${active?`<div class="active-harvest"><div><strong>Session en cours</strong><div class="small-note">${esc(active.name)} · ${fmtDateTime(state.activeHarvestSession.start)}</div></div><button class="btn" id="finishActiveHarvest">Terminer</button></div>`:''}
  <div class="list">${state.harvests.length?state.harvests.slice().reverse().map(h=>{
    const w=(h.sessions||[]).reduce((s,x)=>s+(+x.freshWeight||0),0);
    const mins=(h.sessions||[]).reduce((s,x)=>s+Math.max(0,(new Date(x.end)-new Date(x.start))/60000||0),0);
    return `<button class="list-item harvest-row" data-harvest="${h.id}"><div><strong>${esc(h.name)}</strong><div class="small-note">${SPECIES[h.species]?.name||h.species} · ${h.sessions?.length||0} session(s) · ${Math.round(mins)} min</div></div><strong>${w.toFixed(0)} g</strong></button>`;
  }).join(''):'<div class="card muted">Aucune récolte enregistrée.</div>'}</div>`;
  document.querySelector('#newHarvest').onclick=()=>openHarvestModal();
  document.querySelectorAll('[data-harvest]').forEach(x=>x.onclick=()=>openHarvest(x.dataset.harvest));
  if(active) document.querySelector('#finishActiveHarvest').onclick=()=>finishHarvestTimer();
}

function openHarvest(id){
  const h=state.harvests.find(x=>x.id===id); if(!h)return;
  const total=(h.sessions||[]).reduce((s,x)=>s+(+x.freshWeight||0),0);
  const duration=(h.sessions||[]).reduce((s,x)=>s+Math.max(0,(new Date(x.end)-new Date(x.start))/3600000||0),0);
  const isActive=state.activeHarvestSession?.harvestId===id;
  const m=openModal(`<div class="section-title"><div><div class="eyebrow">${SPECIES[h.species].name}</div><h2>${esc(h.name)}</h2></div><span class="badge">${total.toFixed(0)} g</span></div>
    <div class="grid two mini-stats"><div class="card"><strong>${h.sessions.length}</strong><span>sessions</span></div><div class="card"><strong>${duration.toFixed(1)} h</strong><span>temps cumulé</span></div></div>
    <div class="action-strip">
      ${isActive?'<button class="btn" id="timerBtn">Terminer la session</button>':'<button class="btn" id="timerBtn">▶ Démarrer maintenant</button>'}
      <button class="btn secondary" id="manualSession">Saisie manuelle</button>
      <button class="btn secondary" id="editHarvestPlants">Plants</button>
    </div>
    <div class="section-title"><h3>Sessions</h3></div>
    <div class="timeline">${h.sessions.length?h.sessions.slice().reverse().map(s=>`<div class="timeline-row static"><strong>${(+s.freshWeight||0).toFixed(0)} g</strong><span>${fmtDateTime(s.start)} → ${fmtDateTime(s.end)}</span><small>${s.note?esc(s.note):''}</small></div>`).join(''):'<div class="muted">Aucune session.</div>'}</div>`);
  m.querySelector('#timerBtn').onclick=()=>{m.remove(); isActive?finishHarvestTimer():startHarvestTimer(id);};
  m.querySelector('#manualSession').onclick=()=>openSession(id,m);
  m.querySelector('#editHarvestPlants').onclick=()=>openHarvestPlantSelection(id,m);
}
function startHarvestTimer(hid){
  if(state.activeHarvestSession && state.activeHarvestSession.harvestId!==hid){
    return alert('Une autre session de récolte est déjà en cours.');
  }
  const h=state.harvests.find(x=>x.id===hid);
  state.activeHarvestSession={harvestId:hid,start:nowISO(),plantIds:[...(h.plantIds||[])]};
  save(); render(); openHarvest(hid);
}
function finishHarvestTimer(){
  const a=state.activeHarvestSession; if(!a)return;
  const h=state.harvests.find(x=>x.id===a.harvestId); if(!h){state.activeHarvestSession=null;save();render();return;}
  const m=openModal(`<div class="eyebrow">Session démarrée ${fmtDateTime(a.start)}</div><h2>Terminer la récolte</h2>
    <form id="finishHarvestForm" class="stack">
      <div class="field"><label>Poids frais (g)</label><input type="number" min="0" step="0.1" inputmode="decimal" name="weight" required autofocus></div>
      <div class="field"><label>Note (facultatif)</label><textarea name="note" placeholder="Ex. pluie, fruits très mûrs…"></textarea></div>
      <button class="btn big">Enregistrer la session</button>
    </form>`);
  m.querySelector('#finishHarvestForm').onsubmit=e=>{
    e.preventDefault();
    h.sessions.push({id:uid('session'),start:a.start,end:nowISO(),freshWeight:e.target.weight.value,note:e.target.note.value.trim(),plantIds:a.plantIds||h.plantIds,createdAt:nowISO(),updatedAt:nowISO()});
    h.updatedAt=nowISO(); state.activeHarvestSession=null; save(); m.remove(); currentView='harvest';syncNav();render();openHarvest(h.id);
  };
}

const oldOpenHarvestModal=openHarvestModal;
openHarvestModal=function(){
  const year=new Date().getFullYear();
  const counts={};
  state.harvests.forEach(h=>counts[h.species]=(counts[h.species]||0)+1);
  const speciesOpts=['sichuan','korean','japanese','timut'].map(k=>`<option value="${k}">${SPECIES[k].name}</option>`).join('');
  const m=openModal(`<h2>Nouveau lot</h2><form id="harvestFormV4" class="stack">
    <div class="field"><label>Espèce</label><select name="species">${speciesOpts}</select></div>
    <div class="field"><label>Nom du lot</label><input name="name" required></div>
    <div class="field"><label>Plants</label><select name="selection"><option value="all">Tous les plants de l’espèce</option><option value="custom">Choisir</option></select></div>
    <details><summary>Ajouter une note</summary><textarea name="note"></textarea></details>
    <button class="btn">Créer le lot</button>
  </form>`);
  const form=m.querySelector('#harvestFormV4'), name=form.name, species=form.species;
  const autoName=()=>{const k=species.value; name.value=`${SPECIES[k].name} ${year} — ${String((counts[k]||0)+1).padStart(2,'0')}`;};
  species.onchange=autoName; autoName();
  form.onsubmit=e=>{
    e.preventDefault();
    const f=Object.fromEntries(new FormData(form).entries());
    const ids=state.plants.filter(p=>p.species===f.species).map(p=>p.id);
    const h={id:uid('lot'),name:f.name,species:f.species,plantIds:ids,note:f.note||'',sessions:[],createdAt:nowISO(),updatedAt:nowISO()};
    state.harvests.push(h); save(); m.remove(); currentView='harvest';syncNav();render();
    if(f.selection==='custom')openHarvestPlantSelection(h.id); else openHarvest(h.id);
  };
};

function renderTransformationsBody(){
  const el=document.querySelector('#qualityBody');
  el.innerHTML=`<div class="section-title"><div><h2>Transformation</h2><div class="small-note">Rendements et essais</div></div><button class="btn small" id="newTrans">Nouvel essai</button></div>
  <div class="list">${state.transformations.length?state.transformations.slice().reverse().map(t=>{
    const input=+t.inputWeight||0, dry=+t.dryWeight||0, fin=+t.finalWeight||0;
    const dryPct=input?Math.round(dry/input*100):null, finPct=input?Math.round(fin/input*100):null;
    return `<div class="list-item"><div><strong>${esc(t.name)}</strong><div class="small-note">${esc(t.equipment||'Matériel non renseigné')} · ${t.temperature||'—'} °C · ${t.duration||'—'} h</div></div><div class="yield-box"><strong>${fin||'—'} g</strong><small>${finPct!==null?finPct+' % final':''}${dryPct!==null?' · '+dryPct+' % sec':''}</small></div></div>`;
  }).join(''):'<div class="card muted">Aucun essai.</div>'}</div>`;
  document.querySelector('#newTrans').onclick=openTransformation;
}

render();
