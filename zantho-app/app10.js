// Zantho V0.6.4 — édition généralisée et gestion complète des photos

async function deletePhotoLocal(photoId){
  const db=await photoDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(PHOTO_STORE,'readwrite');
    tx.objectStore(PHOTO_STORE).delete(photoId);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}

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
    const drivePath=ref.drivePath||photo.drivePath||null;
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

