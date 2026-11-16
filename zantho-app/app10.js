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

