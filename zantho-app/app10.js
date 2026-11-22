// Zantho V0.6.4 — édition généralisée et gestion complète des photos

async function deletePhotoLocal(photoId){return photoTransaction('readwrite',store=>store.delete(photoId));}

function valAttr(v){ return esc(v??''); }

async function openPhotoDetail(photoId,plantId,parent=null){
  const photo=await getPhoto(photoId);
  if(!photo) return alert('Photo introuvable sur cet appareil.');
  const ref=(state.photoRefs||[]).find(x=>x.id===photoId)||{};
  const url=URL.createObjectURL(photo.blob);
  const m=openModal(`
    <div class="eyebrow">${esc(state.plants.find(x=>x.id===plantId)?.code||plantId)}</div>
    <h2>Photo de suivi</h2>
    <img src="${url}" alt="Photo ${esc(plantId)}" style="width:100%;max-height:55vh;object-fit:contain;border-radius:14px;background:#111">
    <form id="photoEditForm" class="stack" style="margin-top:12px">
      <div class="field"><label>Commentaire</label><input name="note" value="${valAttr(photo.note||ref.note||'')}" placeholder="Facultatif"></div>
      <button class="btn">Enregistrer les modifications</button>
    </form>
    <details class="danger-zone">
      <summary>Options</summary>
      <button type="button" class="btn danger small" id="deletePhoto">Supprimer cette photo</button>
    </details>
  `);

  m.querySelector('#photoEditForm').onsubmit=async e=>{
    e.preventDefault();
    const note=e.target.note.value.trim();
    const updatedAt=nowISO();
    photo.note=note;
    photo.updatedAt=updatedAt;
    await putPhoto(photo);
    state.photoRefs=zMergeById(state.photoRefs||[],[{
      id:photo.id,plantId:photo.plantId,name:photo.name,type:photo.type,
      note,createdAt:photo.createdAt,updatedAt,drivePath:ref.drivePath||photo.drivePath||null
    }]);
    save();
    URL.revokeObjectURL(url);
    m.remove();
    if(parent?.remove) parent.remove();
    openPlant(plantId);
  };

  m.querySelector('#deletePhoto').onclick=async()=>{
    if(!confirm('Supprimer définitivement cette photo ?')) return;
    const drivePath=ref.drivePath||photo.drivePath||`photo-${photo.id}.${photoFormat(photo).ext}`;
    state.deleted=zDeletedShape(state.deleted);
    state.deleted.photoRefs=zMergeDeletes(state.deleted.photoRefs||[],[{
      id:photoId,deletedAt:nowISO(),drivePath
    }]);
    state.photoRefs=(state.photoRefs||[]).filter(x=>x.id!==photoId);
    await deletePhotoLocal(photoId);
    save();
    URL.revokeObjectURL(url);
    m.remove();
    if(parent?.remove) parent.remove();
    openPlant(plantId);
  };

  const obs=new MutationObserver(()=>{
    if(!m.isConnected){
      URL.revokeObjectURL(url);
      obs.disconnect();
    }
  });
  obs.observe(document.body,{childList:true,subtree:true});
}

loadPlantPhotos=async function(id,el){
  const photos=await getPhotosByPlant(id);
  if(!photos.length){
    el.innerHTML='<div class="muted">Aucune photo.</div>';
    return;
  }
  const urls=[];
  el.innerHTML=photos.map(p=>{
    const url=URL.createObjectURL(p.blob);
    urls.push(url);
    return `<div class="photo-item">
      <button type="button" class="photo-open" data-photo="${p.id}" aria-label="Ouvrir cette photo">
        <img alt="Photo ${esc(id)}" src="${url}">
      </button>
      <button type="button" class="mini-edit photo-edit" data-photo="${p.id}">Modifier</button>
    </div>`;
  }).join('');
  el.querySelectorAll('img').forEach(image=>{image.onerror=()=>{
    image.hidden=true;const note=document.createElement('span');
    note.textContent='Original conservé. Aperçu indisponible sur cet appareil.';
    image.parentNode.appendChild(note);
  };});
  el.querySelectorAll('[data-photo]').forEach(b=>b.onclick=()=>openPhotoDetail(b.dataset.photo,id,el.closest('.modal-backdrop')));
  const obs=new MutationObserver(()=>{
    if(!el.isConnected){
      urls.forEach(u=>URL.revokeObjectURL(u));
      obs.disconnect();
    }
  });
  obs.observe(document.body,{childList:true,subtree:true});
};

function openEditObservation(obsId,parent){
  const o=state.observations.find(x=>x.id===obsId); if(!o)return;
  const p=state.plants.find(x=>x.id===o.plantId);
  const opts=(values,current)=>values.map(x=>`<option ${x===current?'selected':''}>${x}</option>`).join('');
  let html;
  if(o.kind==='note'){
    html=`<div class="eyebrow">${esc(p?.code||o.plantId)}</div><h2>Modifier l’information</h2>
      <form id="editObsForm" class="stack">
        <div class="field"><label>Date</label><input type="date" name="date" value="${valAttr(o.date)}"></div>
        <div class="field"><label>Type</label><select name="category">${opts(['Note','Intervention','Incident','Entretien / taille','Mesure'],o.category||'Note')}</select></div>
        <div class="field"><label>Information</label><textarea name="note" required>${esc(o.note||'')}</textarea></div>
        <button class="btn">Enregistrer</button>
      </form>`;
  }else{
    html=`<div class="eyebrow">${esc(p?.code||o.plantId)}</div><h2>Modifier l’observation</h2>
      <form id="editObsForm" class="stack">
        <div class="field"><label>Date</label><input type="date" name="date" value="${valAttr(o.date)}"></div>
        <div class="field"><label>Vigueur</label><select name="vigor">${opts(['Très faible','Faible','Correcte','Bonne','Très bonne'],o.vigor)}</select></div>
        <div class="field"><label>État sanitaire</label><select name="health">${opts(['Sain','À surveiller','Problème'],o.health)}</select></div>
        <div class="field"><label>Floraison</label><select name="flowering">${opts(['Absente','Faible','Moyenne','Forte'],o.flowering)}</select></div>
        <div class="field"><label>Fructification</label><select name="fruiting">${opts(['Absente','Faible','Moyenne','Forte'],o.fruiting)}</select></div>
        <div class="grid two">
          <div class="field"><label>Hauteur (cm)</label><input type="number" min="0" name="height" value="${valAttr(o.height)}"></div>
          <div class="field"><label>Largeur (cm)</label><input type="number" min="0" name="width" value="${valAttr(o.width)}"></div>
        </div>
        <div class="field"><label>Commentaire</label><textarea name="note">${esc(o.note||'')}</textarea></div>
        <button class="btn">Enregistrer</button>
      </form>`;
  }
  const m=openModal(html);
  m.querySelector('#editObsForm').onsubmit=e=>{
    e.preventDefault();
    const f=Object.fromEntries(new FormData(e.target).entries());
    Object.assign(o,f,{updatedAt:nowISO()});
    save();
    m.remove();
    if(parent?.remove) parent.remove();
    render();
    openPlant(o.plantId);
  };
}

openPlant=function(id){
  const p=state.plants.find(x=>x.id===id); if(!p)return;
  const obs=state.observations.filter(o=>o.plantId===id).sort((a,b)=>String(b.createdAt||b.date).localeCompare(String(a.createdAt||a.date)));
  const last=obs[0]; const age=daysSince(last?.date);

  const m=openModal(`<div class="plant-sheet plant-sheet-v6">
    <div class="plant-sheet-head">
      <div>
        <div class="eyebrow">Ligne ${p.line} · ${esc(p.code||p.id)}</div>
        <h2>${esc(p.nickname||p.code||p.id)}</h2>
        <div class="plant-species">${esc(familyLabel(p))}</div>
        ${p.nicknameUniverse?`<div class="small-note">${esc(p.nicknameUniverse)}</div>`:''}
        <div class="muted"><em>${esc(SPECIES[p.species].latin)}</em>${p.species==='tas_f'?' · femelle':p.species==='tas_m'?' · mâle':''}</div>
      </div>
      <span class="status-dot ${statusTone(plantStatus(p))}">${esc(plantStatus(p))}</span>
    </div>

    <div class="plant-primary-actions">
      <button class="primary-tile" id="addInfoPlant"><span>＋</span><strong>Ajouter une info</strong></button>
      <button class="primary-tile" id="photoPlant"><span>▣</span><strong>Ajouter une photo</strong></button>
    </div>

    <div class="last-observation">
      <strong>${last?'Dernière information':'Aucune information enregistrée'}</strong>
      ${last?`
        <span>${last.kind==='note'?esc((last.category||'Note')+' · '+(last.note||'')):esc(last.health+' · '+last.vigor)}</span>
        <small>${fmtDate(last.date)}${age!==null?' · il y a '+age+' j':''}</small>
      `:''}
    </div>

    <div class="section-title"><h3>Historique</h3><span class="badge">${obs.length}</span></div>
    <div class="timeline plant-history">
      ${obs.length?obs.slice(0,20).map(o=>{
        const note=o.note?esc(o.note):'';
        const body=o.kind==='note'
          ? `${esc(o.category||'Note')}${note?' · '+note:''}`
          : `${esc(o.health)} · ${esc(o.vigor)} · fleurs ${esc(o.flowering)} · fruits ${esc(o.fruiting)}${note?' · '+note:''}`;
        return `<div class="timeline-row static observation-row">
          <strong>${fmtDate(o.date)}</strong>
          <span>${body}</span>
          <div class="inline-actions">
            <button type="button" class="mini-edit" data-edit-obs="${o.id}">Modifier</button>
            <button type="button" class="mini-delete" data-del-obs="${o.id}">Suppr.</button>
          </div>
        </div>`;
      }).join(''):'<div class="card muted">Aucun historique pour ce plant.</div>'}
    </div>

    <div class="section-title"><h3>Photos</h3><button class="text-button" id="photoPlant2">+ Ajouter</button></div>
    <div class="photo-grid" id="plantPhotos"></div>
  </div>`);

  m.querySelector('#addInfoPlant').onclick=()=>openAddPlantInfo(id,m);
  m.querySelector('#photoPlant').onclick=()=>openPhotoCapture(id,m);
  m.querySelector('#photoPlant2').onclick=()=>openPhotoCapture(id,m);
  m.querySelectorAll('[data-edit-obs]').forEach(b=>b.onclick=()=>openEditObservation(b.dataset.editObs,m));
  m.querySelectorAll('[data-del-obs]').forEach(b=>b.onclick=()=>{
    if(!confirm('Supprimer cette information ?')) return;
    if(typeof markDeleted==='function') markDeleted('observations',b.dataset.delObs);
    state.observations=state.observations.filter(o=>o.id!==b.dataset.delObs);
    save();
    m.remove();
    render();
    openPlant(id);
  });
  loadPlantPhotos(id,m.querySelector('#plantPhotos'));
};

function openEditHarvest(id,parent){
  const h=state.harvests.find(x=>x.id===id); if(!h)return;
  const canChangeSpecies=!(h.sessions||[]).length && state.activeHarvestSession?.harvestId!==id;
  const speciesOpts=['sichuan','korean','japanese','timut'].map(k=>`<option value="${k}" ${k===h.species?'selected':''}>${SPECIES[k].name}</option>`).join('');
  const m=openModal(`<h2>Modifier le lot</h2><form id="editHarvestForm" class="stack">
    <div class="field"><label>Nom du lot</label><input name="name" value="${valAttr(h.name)}" required></div>
    <div class="field"><label>Espèce</label><select name="species" ${canChangeSpecies?'':'disabled'}>${speciesOpts}</select></div>
    ${canChangeSpecies?'':'<div class="small-note">L’espèce est verrouillée dès qu’une session existe, afin de préserver la cohérence de l’historique.</div>'}
    <div class="field"><label>Commentaire</label><textarea name="note">${esc(h.note||'')}</textarea></div>
    <button class="btn">Enregistrer</button>
  </form>`);
  m.querySelector('#editHarvestForm').onsubmit=e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const nextSpecies=canChangeSpecies?fd.get('species'):h.species;
    if(nextSpecies!==h.species){
      h.species=nextSpecies;
      h.plantIds=state.plants.filter(p=>p.species===nextSpecies).map(p=>p.id);
    }
    h.name=fd.get('name').trim();
    h.note=fd.get('note').trim();
    h.updatedAt=nowISO();
    save();
    m.remove();
    if(parent?.remove) parent.remove();
    render();
    openHarvest(id);
  };
}

function openEditSession(hid,sid,parent){
  const h=state.harvests.find(x=>x.id===hid); if(!h)return;
  const s=(h.sessions||[]).find(x=>x.id===sid); if(!s)return;
  const selected=new Set(s.plantIds||h.plantIds||[]);
  const boxes=(h.plantIds||[]).map(id=>`<label class="plant-choice"><input type="checkbox" name="plant" value="${id}" ${selected.has(id)?'checked':''}> <span>${esc(state.plants.find(p=>p.id===id)?.code||id)}</span></label>`).join('');
  const m=openModal(`<h2>Modifier la session</h2><form id="editSessionForm" class="stack">
    <div class="grid two">
      <div class="field"><label>Début</label><input type="datetime-local" name="start" value="${valAttr(String(s.start||'').slice(0,16))}" required></div>
      <div class="field"><label>Fin</label><input type="datetime-local" name="end" value="${valAttr(String(s.end||'').slice(0,16))}" required></div>
    </div>
    <div class="field"><label>Poids frais (g)</label><input type="number" min="0" step="0.1" name="freshWeight" value="${valAttr(s.freshWeight)}" required></div>
    <details open><summary>Plants concernés</summary><div class="plant-select-grid" style="margin-top:8px">${boxes}</div></details>
    <div class="field"><label>Commentaire</label><textarea name="note">${esc(s.note||'')}</textarea></div>
    <button class="btn">Enregistrer</button>
  </form>`);
  m.querySelector('#editSessionForm').onsubmit=e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const start=fd.get('start'), end=fd.get('end'), plantIds=fd.getAll('plant');
    if(new Date(end)<new Date(start)) return alert('La fin doit être après le début.');
    if(!plantIds.length) return alert('Sélectionne au moins un plant.');
    Object.assign(s,{
      start,end,freshWeight:fd.get('freshWeight'),
      note:fd.get('note').trim(),plantIds,updatedAt:nowISO()
    });
    h.updatedAt=nowISO();
    save();
    m.remove();
    if(parent?.remove) parent.remove();
    render();
    openHarvest(hid);
  };
}

openHarvest=function(id){
  const h=state.harvests.find(x=>x.id===id); if(!h)return;
  const total=(h.sessions||[]).reduce((s,x)=>s+(+x.freshWeight||0),0);
  const duration=(h.sessions||[]).reduce((s,x)=>s+Math.max(0,(new Date(x.end)-new Date(x.start))/3600000||0),0);
  const isActive=state.activeHarvestSession?.harvestId===id;
  const sessions=(h.sessions||[]).slice().reverse();

  const m=openModal(`<div class="section-title"><div><div class="eyebrow">${SPECIES[h.species].name}</div><h2>${esc(h.name)}</h2></div><span class="badge">${total.toFixed(0)} g</span></div>
    ${h.note?`<div class="note-card">${esc(h.note)}</div>`:''}
    <div class="grid two mini-stats">
      <div class="card"><strong>${h.sessions.length}</strong><span>sessions</span></div>
      <div class="card"><strong>${duration.toFixed(1)} h</strong><span>temps cumulé</span></div>
    </div>
    <div class="action-strip">
      ${isActive?'<button class="btn" id="timerBtn">Terminer la session</button>':'<button class="btn" id="timerBtn">▶ Démarrer maintenant</button>'}
      <button class="btn secondary" id="manualSession">Saisie manuelle</button>
      <button class="btn secondary" id="editHarvestPlants">Plants</button>
      <button class="btn secondary" id="editHarvest">Modifier le lot</button>
    </div>
    <div class="section-title"><h3>Sessions</h3></div>
    <div class="timeline">${sessions.length?sessions.map(s=>`<div class="timeline-row static harvest-session-row">
      <strong>${(+s.freshWeight||0).toFixed(0)} g</strong>
      <span>${fmtDateTime(s.start)} → ${fmtDateTime(s.end)}</span>
      <small>${s.note?esc(s.note):''}</small>
      <div class="inline-actions">
        <button type="button" class="mini-edit" data-edit-session="${s.id}">Modifier</button>
        <button type="button" class="mini-delete" data-del-session="${s.id}">Suppr.</button>
      </div>
    </div>`).join(''):'<div class="muted">Aucune session.</div>'}</div>
    <details class="danger-zone"><summary>Options du lot</summary><button type="button" class="btn danger small" id="deleteHarvest">Supprimer ce lot</button></details>`);

  m.querySelector('#timerBtn').onclick=()=>{m.remove(); isActive?finishHarvestTimer():startHarvestTimer(id);};
  m.querySelector('#manualSession').onclick=()=>openSession(id,m);
  m.querySelector('#editHarvestPlants').onclick=()=>openHarvestPlantSelection(id,m);
  m.querySelector('#editHarvest').onclick=()=>openEditHarvest(id,m);
  m.querySelectorAll('[data-edit-session]').forEach(b=>b.onclick=()=>openEditSession(id,b.dataset.editSession,m));
  m.querySelectorAll('[data-del-session]').forEach(b=>b.onclick=()=>{
    if(!confirm('Supprimer cette session de récolte ?')) return;
    if(typeof markDeleted==='function') markDeleted('sessions',b.dataset.delSession);
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
    if(typeof markDeleted==='function') markDeleted('harvests',id);
    state.harvests=state.harvests.filter(x=>x.id!==id);
    save();
    m.remove();
    render();
  };
};

function openEditTransformation(id,parent){
  const t=state.transformations.find(x=>x.id===id); if(!t)return;
  const lots=state.harvests.map(h=>`<option value="${h.id}" ${h.id===t.harvestId?'selected':''}>${esc(h.name)}</option>`).join('');
  const m=openModal(`<h2>Modifier l’essai</h2><form id="editTransForm" class="stack">
    <div class="field"><label>Nom</label><input name="name" value="${valAttr(t.name)}" required></div>
    <div class="field"><label>Lot source</label><select name="harvestId"><option value="">—</option>${lots}</select></div>
    <div class="grid two"><div class="field"><label>Poids entrant (g)</label><input type="number" step="0.1" name="inputWeight" value="${valAttr(t.inputWeight)}"></div><div class="field"><label>Poids final commercialisable (g)</label><input type="number" step="0.1" name="finalWeight" value="${valAttr(t.finalWeight)}"></div></div>
    <div class="grid two"><div class="field"><label>Température (°C)</label><input type="number" step="0.1" name="temperature" value="${valAttr(t.temperature)}"></div><div class="field"><label>Durée (h)</label><input type="number" step="0.1" name="duration" value="${valAttr(t.duration)}"></div></div>
    <div class="field"><label>Matériel</label><input name="equipment" value="${valAttr(t.equipment)}"></div>
    <div class="grid two"><div class="field"><label>Après séchage (g)</label><input type="number" step="0.1" name="dryWeight" value="${valAttr(t.dryWeight)}"></div><div class="field"><label>Graines / déchets (g)</label><input type="number" step="0.1" name="wasteWeight" value="${valAttr(t.wasteWeight)}"></div></div>
    <div class="field"><label>Observations</label><textarea name="note">${esc(t.note||'')}</textarea></div>
    <button class="btn">Enregistrer</button>
  </form>`);
  m.querySelector('#editTransForm').onsubmit=e=>{
    e.preventDefault();
    Object.assign(t,Object.fromEntries(new FormData(e.target).entries()),{updatedAt:nowISO()});
    save(); m.remove(); if(parent?.remove)parent.remove(); renderQuality(); openTransformationDetail(id);
  };
}

openTransformationDetail=function(id){
  const t=state.transformations.find(x=>x.id===id); if(!t)return;
  const lot=state.harvests.find(h=>h.id===t.harvestId);
  const input=+t.inputWeight||0, dry=+t.dryWeight||0, fin=+t.finalWeight||0, waste=+t.wasteWeight||0;
  const dryPct=input?Math.round(dry/input*1000)/10:null;
  const finalPct=input?Math.round(fin/input*1000)/10:null;
  const loss=input?Math.round((input-fin)/input*1000)/10:null;
  const m=openModal(`<div class="eyebrow">Essai de transformation</div><h2>${esc(t.name)}</h2>
    <div class="row"><button class="btn secondary small" id="editTrans">Modifier</button></div>
    <div class="grid two mini-stats">
      <div class="card"><strong>${finalPct!==null?finalPct+' %':'—'}</strong><span>rendement final</span></div>
      <div class="card"><strong>${dryPct!==null?dryPct+' %':'—'}</strong><span>rendement après séchage</span></div>
    </div>
    <div class="detail-table">
      <div><span>Lot source</span><strong>${lot?esc(lot.name):'—'}</strong></div>
      <div><span>Entrant</span><strong>${input||'—'} g</strong></div>
      <div><span>Après séchage</span><strong>${dry||'—'} g</strong></div>
      <div><span>Final commercialisable</span><strong>${fin||'—'} g</strong></div>
      <div><span>Graines / déchets</span><strong>${waste||'—'} g</strong></div>
      <div><span>Perte totale</span><strong>${loss!==null?loss+' %':'—'}</strong></div>
      <div><span>Température</span><strong>${t.temperature||'—'} °C</strong></div>
      <div><span>Durée</span><strong>${t.duration||'—'} h</strong></div>
      <div><span>Matériel</span><strong>${esc(t.equipment||'—')}</strong></div>
    </div>
    ${t.note?`<div class="note-card">${esc(t.note)}</div>`:''}
    <details class="danger-zone"><summary>Options</summary><button class="btn danger small" id="deleteTrans">Supprimer cet essai</button></details>`);
  m.querySelector('#editTrans').onclick=()=>openEditTransformation(id,m);
  m.querySelector('#deleteTrans').onclick=()=>{
    const linked=state.tastings.filter(x=>x.transformationId===id).length;
    if(linked) return alert('Cet essai est utilisé par '+linked+' dégustation(s). Supprime ou rattache ces dégustations avant.');
    if(!confirm('Supprimer cet essai de transformation ?')) return;
    if(typeof markDeleted==='function') markDeleted('transformations',id);
    state.transformations=state.transformations.filter(x=>x.id!==id);
    save(); m.remove(); renderQuality();
  };
};

function openEditTasting(id,parent){
  const t=state.tastings.find(x=>x.id===id); if(!t)return;
  const sources=state.transformations.map(x=>`<option value="${x.id}" ${x.id===t.transformationId?'selected':''}>${esc(x.name)}</option>`).join('');
  const selected=new Set(t.descriptors||[]);
  const descriptors=Object.entries(sensoryFamilies).map(([fam,vals])=>`<div class="card"><strong>${fam}</strong><div class="stack" style="margin-top:8px">${vals.map(v=>`<label class="row"><input style="width:auto;min-height:auto" type="checkbox" name="desc" value="${esc(v)}" ${selected.has(v)?'checked':''}> ${esc(v)}</label>`).join('')}</div></div>`).join('');
  const opt=(vals,current)=>vals.map(v=>`<option ${v===current?'selected':''}>${v}</option>`).join('');
  const m=openModal(`<h2>Modifier la dégustation</h2><form id="editTasteForm" class="stack">
    <div class="field"><label>Nom</label><input name="name" value="${valAttr(t.name)}" required></div>
    <div class="field"><label>Date</label><input type="date" name="date" value="${valAttr(t.date)}"></div>
    <div class="field"><label>Essai / lot</label><select name="transformationId"><option value="">—</option>${sources}</select></div>
    <h3>Descripteurs aromatiques</h3><div class="grid two">${descriptors}</div>
    <div class="grid two">
      <div class="field"><label>Intensité générale</label><select name="intensity">${opt(['Faible','Moyenne','Forte','Très forte'],t.intensity)}</select></div>
      <div class="field"><label>Complexité</label><select name="complexity">${opt(['Simple','Moyenne','Complexe','Très complexe'],t.complexity)}</select></div>
      <div class="field"><label>Équilibre</label><select name="balance">${opt(['Déséquilibré','Correct','Équilibré','Très harmonieux'],t.balance)}</select></div>
      <div class="field"><label>Longueur en bouche</label><select name="length">${opt(['Courte','Moyenne','Longue','Très longue'],t.length)}</select></div>
    </div>
    <div class="field"><label>Intérêt gastronomique</label><select name="gastro">${opt(['Faible','Intéressant','Très intéressant','Remarquable'],t.gastro)}</select></div>
    <div class="field"><label>Amertume / astringence / défauts</label><textarea name="defects">${esc(t.defects||'')}</textarea></div>
    <div class="field"><label>Accords / idées culinaires</label><textarea name="pairings">${esc(t.pairings||'')}</textarea></div>
    <div class="field"><label>Commentaire libre</label><textarea name="note">${esc(t.note||'')}</textarea></div>
    <button class="btn">Enregistrer</button>
  </form>`);
  m.querySelector('#editTasteForm').onsubmit=e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const obj=Object.fromEntries(fd.entries());
    obj.descriptors=fd.getAll('desc');
    Object.assign(t,obj,{updatedAt:nowISO()});
    save(); m.remove(); if(parent?.remove)parent.remove(); renderQuality(); openTastingDetail(id);
  };
}

openTastingDetail=function(id){
  const t=state.tastings.find(x=>x.id===id); if(!t)return;
  const source=state.transformations.find(x=>x.id===t.transformationId);
  const descriptors=(t.descriptors||[]).map(d=>`<span class="descriptor-chip">${esc(d)}</span>`).join('');
  const m=openModal(`<div class="eyebrow">Dégustation · ${fmtDate(t.date)}</div><h2>${esc(t.name)}</h2>
    <div class="row"><button class="btn secondary small" id="editTaste">Modifier</button></div>
    <div class="small-note">${source?'Essai : '+esc(source.name):'Sans essai associé'}</div>
    <div class="descriptor-strip large">${descriptors||'<span class="muted">Aucun descripteur.</span>'}</div>
    <div class="detail-table">
      <div><span>Intensité</span><strong>${esc(t.intensity||'—')}</strong></div>
      <div><span>Complexité</span><strong>${esc(t.complexity||'—')}</strong></div>
      <div><span>Équilibre</span><strong>${esc(t.balance||'—')}</strong></div>
      <div><span>Longueur</span><strong>${esc(t.length||'—')}</strong></div>
      <div><span>Intérêt gastronomique</span><strong>${esc(t.gastro||'—')}</strong></div>
    </div>
    ${t.defects?`<div class="note-card"><strong>Défauts / astringence</strong><br>${esc(t.defects)}</div>`:''}
    ${t.pairings?`<div class="note-card"><strong>Accords</strong><br>${esc(t.pairings)}</div>`:''}
    ${t.note?`<div class="note-card">${esc(t.note)}</div>`:''}
    <details class="danger-zone"><summary>Options</summary><button class="btn danger small" id="deleteTaste">Supprimer cette dégustation</button></details>`);
  m.querySelector('#editTaste').onclick=()=>openEditTasting(id,m);
  m.querySelector('#deleteTaste').onclick=()=>{
    if(!confirm('Supprimer cette dégustation ?')) return;
    if(typeof markDeleted==='function') markDeleted('tastings',id);
    state.tastings=state.tastings.filter(x=>x.id!==id);
    save(); m.remove(); renderQuality();
  };
};

const zSyncPhotosV064=zSyncPhotos;
zSyncPhotos=async function(token,notify){
  state.deleted=zDeletedShape(state.deleted);let failedDeletions=0;
  for(const tomb of state.deleted.photoRefs||[]){
    const current=await getPhoto(tomb.id);const ref=(state.photoRefs||[]).find(p=>p.id===tomb.id);
    if(Math.max(zStamp(current),zStamp(ref))>new Date(tomb.deletedAt||0).getTime())continue;
    let failed=false;
    try{await deletePhotoLocal(tomb.id);}catch{failed=true;}
    if(tomb.drivePath){
      try{
        const response=await fetch(zGraphUrl(tomb.drivePath),{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});
        if(!response.ok&&response.status!==404)failed=true;
      }catch{failed=true;}
    }
    if(failed)failedDeletions++;
  }
  const stats=await zSyncPhotosV064(token,notify);
  return {...stats,failed:(stats.failed||0)+failedDeletions};
};

state.version=APP_VERSION;
save();
