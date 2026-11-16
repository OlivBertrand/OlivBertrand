function openModal(html){
  const tpl=document.querySelector('#modalTemplate').content.cloneNode(true); const back=tpl.querySelector('.modal-backdrop'); back.querySelector('.modal-body').innerHTML=html; back.querySelector('.modal-close').onclick=()=>back.remove(); back.addEventListener('click',e=>{if(e.target===back)back.remove();}); document.body.appendChild(back); return back;
}
function openPlant(id){
  const p=state.plants.find(x=>x.id===id); const obs=state.observations.filter(o=>o.plantId===id).sort((a,b)=>b.date.localeCompare(a.date));
  const m=openModal(`<div class="section-title"><div><h2>${p.id}</h2><div class="muted">${SPECIES[p.species].name} · ligne ${p.line}, position ${p.position}</div></div><span class="badge">${plantStatus(p)}</span></div>
    <div class="grid two"><button class="btn" id="addObs">Observation</button><button class="btn secondary" id="addPhoto">Photo</button></div>
    <div class="section-title"><h3>Historique</h3></div>
    <div class="list">${obs.length?obs.map(o=>`<div class="list-item"><div><strong>${fmtDate(o.date)}</strong><div class="small-note">Vigueur ${esc(o.vigor)} · ${esc(o.health)} · floraison ${esc(o.flowering)} · fruits ${esc(o.fruiting)}</div>${o.note?`<div>${esc(o.note)}</div>`:''}</div></div>`).join(''):'<div class="muted">Aucune observation.</div>'}</div>
    <div class="section-title"><h3>Photos</h3></div><div class="photo-grid" id="plantPhotos"></div>`);
  m.querySelector('#addObs').onclick=()=>openObservation(id,m);
  m.querySelector('#addPhoto').onclick=()=>openPhotoCapture(id,m);
  loadPlantPhotos(id,m.querySelector('#plantPhotos'));
}
function openObservation(plantId,parent){
  const p=state.plants.find(x=>x.id===plantId);
  const prev=state.observations.filter(o=>o.plantId===plantId).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0]||null;
  const defaults={
    vigor:prev?.vigor||p?.vigor||'Correcte',
    health:prev?.health||p?.status||'Sain',
    flowering:prev?.flowering||'Absente',
    fruiting:prev?.fruiting||'Absente'
  };
  const opts=(values,current)=>values.map(x=>`<option ${x===current?'selected':''}>${x}</option>`).join('');
  const m=openModal(`<h2>Observation détaillée — ${plantId}</h2><form id="obsForm" class="stack">
    <div class="field"><label>Date</label><input type="date" name="date" value="${new Date().toISOString().slice(0,10)}"></div>
    <div class="field"><label>Vigueur</label><select name="vigor">${opts(['Très faible','Faible','Correcte','Bonne','Très bonne'],defaults.vigor)}</select></div>
    <div class="field"><label>État sanitaire</label><select name="health">${opts(['Sain','À surveiller','Problème'],defaults.health)}</select></div>
    <div class="field"><label>Floraison</label><select name="flowering">${opts(['Absente','Faible','Moyenne','Forte'],defaults.flowering)}</select></div>
    <div class="field"><label>Fructification</label><select name="fruiting">${opts(['Absente','Faible','Moyenne','Forte'],defaults.fruiting)}</select></div>
    <div class="grid two"><div class="field"><label>Hauteur (cm, facultatif)</label><input type="number" min="0" name="height" inputmode="decimal"></div><div class="field"><label>Largeur (cm, facultatif)</label><input type="number" min="0" name="width" inputmode="decimal"></div></div>
    <div class="field"><label>Commentaire</label><textarea name="note" placeholder="Facultatif"></textarea></div>
    <button class="btn">Enregistrer</button>
  </form>`);
  m.querySelector('#obsForm').onsubmit=e=>{
    e.preventDefault();
    const f=new FormData(e.target);
    state.observations.push({id:uid('obs'),plantId,...Object.fromEntries(f.entries()),createdAt:nowISO(),updatedAt:nowISO()});
    save();
    m.remove();
    if(parent?.remove) parent.remove();
    render();
    openPlant(plantId);
  };
}

async function photoDB(){ return new Promise((resolve,reject)=>{ const req=indexedDB.open(PHOTO_DB,1); req.onupgradeneeded=()=>{ if(!req.result.objectStoreNames.contains(PHOTO_STORE)) req.result.createObjectStore(PHOTO_STORE,{keyPath:'id'}); }; req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
async function putPhoto(rec){ const db=await photoDB(); return new Promise((res,rej)=>{ const tx=db.transaction(PHOTO_STORE,'readwrite'); tx.objectStore(PHOTO_STORE).put(rec); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); }
async function getPhotosByPlant(plantId){ const db=await photoDB(); return new Promise((res,rej)=>{ const tx=db.transaction(PHOTO_STORE,'readonly'); const req=tx.objectStore(PHOTO_STORE).getAll(); req.onsuccess=()=>res(req.result.filter(x=>x.plantId===plantId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))); req.onerror=()=>rej(req.error); }); }
async function getPhoto(id){ const db=await photoDB(); return new Promise((res,rej)=>{ const req=db.transaction(PHOTO_STORE,'readonly').objectStore(PHOTO_STORE).get(id); req.onsuccess=()=>res(req.result||null); req.onerror=()=>rej(req.error); }); }
async function getAllPhotos(){ const db=await photoDB(); return new Promise((res,rej)=>{ const req=db.transaction(PHOTO_STORE,'readonly').objectStore(PHOTO_STORE).getAll(); req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); }
function openPhotoCapture(plantId,parent){
  const m=openModal(`<div class="eyebrow">${esc(state.plants.find(x=>x.id===plantId)?.code||plantId)}</div>
    <h2>Photo de suivi</h2>
    <form id="photoForm" class="stack">
      <div class="camera-capture">
        <video id="cameraPreview" autoplay playsinline muted
          style="width:100%;max-height:55vh;object-fit:cover;border-radius:14px;background:#111"></video>
        <img id="capturedPreview" alt="Aperçu de la photo"
          style="display:none;width:100%;max-height:55vh;object-fit:contain;border-radius:14px;background:#111">
        <canvas id="cameraCanvas" hidden></canvas>
        <div id="cameraStatus" class="small-note">Ouverture de l’appareil photo…</div>
      </div>
      <div class="grid two">
        <button type="button" class="btn" id="takePhoto" disabled>Prendre la photo</button>
        <button type="button" class="btn secondary" id="retakePhoto" hidden>Reprendre</button>
      </div>
      <button type="button" class="text-button" id="chooseExisting">Choisir une photo existante</button>
      <input type="file" id="existingPhoto" accept="image/*" hidden>
      <div class="field"><label>Commentaire</label><input name="note" placeholder="Facultatif"></div>
      <button class="btn big" id="savePhoto" disabled>Enregistrer la photo</button>
    </form>`);

  const video=m.querySelector('#cameraPreview');
  const canvas=m.querySelector('#cameraCanvas');
  const image=m.querySelector('#capturedPreview');
  const status=m.querySelector('#cameraStatus');
  const take=m.querySelector('#takePhoto');
  const retake=m.querySelector('#retakePhoto');
  const existing=m.querySelector('#existingPhoto');
  const choose=m.querySelector('#chooseExisting');
  const saveBtn=m.querySelector('#savePhoto');
  let stream=null;
  let selectedFile=null;
  let previewUrl=null;

  const revokePreview=()=>{
    if(previewUrl){ URL.revokeObjectURL(previewUrl); previewUrl=null; }
  };
  const stopCamera=()=>{
    if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
    if(video) video.srcObject=null;
  };
  const showCaptured=file=>{
    selectedFile=file;
    stopCamera();
    revokePreview();
    previewUrl=URL.createObjectURL(file);
    image.src=previewUrl;
    image.style.display='block';
    video.style.display='none';
    retake.hidden=false;
    take.hidden=true;
    saveBtn.disabled=false;
    status.textContent='Photo prête à être enregistrée.';
  };

  const startCamera=async()=>{
    selectedFile=null;
    revokePreview();
    image.removeAttribute('src');
    image.style.display='none';
    video.style.display='block';
    retake.hidden=true;
    take.hidden=false;
    take.disabled=true;
    saveBtn.disabled=true;
    status.textContent='Ouverture de l’appareil photo…';
    stopCamera();

    if(!navigator.mediaDevices?.getUserMedia){
      status.textContent='Accès direct à la caméra non disponible sur ce navigateur. Utilise « Choisir une photo existante ».';
      return;
    }
    try{
      stream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:'environment'}},
        audio:false
      });
      video.srcObject=stream;
      await video.play();
      take.disabled=false;
      status.textContent='Cadre le plant puis prends la photo.';
    }catch(err){
      console.warn('Caméra Zantho',err);
      status.textContent='Impossible d’ouvrir la caméra. Autorise l’accès à l’appareil photo dans les réglages du navigateur, ou choisis une photo existante.';
    }
  };

  take.onclick=async()=>{
    if(!video.videoWidth||!video.videoHeight) return;
    canvas.width=video.videoWidth;
    canvas.height=video.videoHeight;
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.92));
    if(!blob) return alert('Impossible de créer la photo.');
    const code=state.plants.find(x=>x.id===plantId)?.code||plantId;
    const file=new File([blob],`zantho-${code}-${Date.now()}.jpg`,{type:'image/jpeg',lastModified:Date.now()});
    showCaptured(file);
  };
  retake.onclick=startCamera;
  choose.onclick=()=>{
    stopCamera();
    existing.value='';
    existing.click();
  };
  existing.onchange=()=>{
    const file=existing.files?.[0];
    if(file) showCaptured(file);
    else startCamera();
  };

  m.querySelector('#photoForm').onsubmit=async e=>{
    e.preventDefault();
    if(!selectedFile) return alert('Prends une photo avant de l’enregistrer.');
    const createdAt=nowISO();
    const rec={
      id:uid('photo'),plantId,blob:selectedFile,
      name:selectedFile.name||'photo.jpg',
      type:selectedFile.type||'image/jpeg',
      note:e.target.note.value,createdAt,synced:false
    };
    await putPhoto(rec);
    state.photoRefs=mergeById(state.photoRefs||[],[{
      id:rec.id,plantId:rec.plantId,name:rec.name,type:rec.type,note:rec.note,
      createdAt,updatedAt:createdAt,drivePath:null
    }]);
    save();
    stopCamera();
    revokePreview();
    m.remove();
    if(parent?.remove) parent.remove();
    openPlant(plantId);
  };

  const cleanupObserver=new MutationObserver(()=>{
    if(!m.isConnected){
      stopCamera();
      revokePreview();
      cleanupObserver.disconnect();
    }
  });
  cleanupObserver.observe(document.body,{childList:true,subtree:true});
  startCamera();
}

async function loadPlantPhotos(id,el){ const photos=await getPhotosByPlant(id); el.innerHTML=photos.length?photos.map(p=>`<img alt="Photo ${id}" src="${URL.createObjectURL(p.blob)}">`).join(''):'<div class="muted">Aucune photo.</div>'; }

function renderHarvests(){
  app.innerHTML=`<div class="section-title"><h2>Récoltes</h2><button class="btn small" id="newHarvest">Nouveau lot</button></div><div class="list">${state.harvests.length?state.harvests.slice().reverse().map(h=>{
    const w=(h.sessions||[]).reduce((s,x)=>s+(+x.freshWeight||0),0); return `<button class="list-item" data-harvest="${h.id}"><div><strong>${esc(h.name)}</strong><div class="small-note">${SPECIES[h.species]?.name||h.species} · ${h.sessions?.length||0} session(s)</div></div><strong>${w.toFixed(1)} g</strong></button>`;
  }).join(''):'<div class="card muted">Aucune récolte enregistrée.</div>'}</div>`;
  document.querySelector('#newHarvest').onclick=()=>openHarvestModal(); document.querySelectorAll('[data-harvest]').forEach(x=>x.onclick=()=>openHarvest(x.dataset.harvest));
}
function openHarvestModal(){
  const speciesOpts=['sichuan','korean','japanese','timut'].map(k=>`<option value="${k}">${SPECIES[k].name}</option>`).join('');
  const m=openModal(`<h2>Nouveau lot de récolte</h2><form id="harvestForm" class="stack"><div class="field"><label>Nom du lot</label><input name="name" placeholder="Timut 2029 — lot 01" required></div><div class="field"><label>Espèce</label><select name="species">${speciesOpts}</select></div><div class="field"><label>Plants</label><select name="selection"><option value="all">Tous les plants de l’espèce</option><option value="custom">Choisir les plants après création</option></select></div><div class="field"><label>Commentaire</label><textarea name="note"></textarea></div><button class="btn">Créer le lot</button></form>`);
  m.querySelector('#harvestForm').onsubmit=e=>{
    e.preventDefault();
    const f=Object.fromEntries(new FormData(e.target).entries());
    const ids=state.plants.filter(p=>p.species===f.species).map(p=>p.id);
    const h={id:uid('lot'),name:f.name,species:f.species,plantIds:ids,note:f.note,sessions:[],createdAt:nowISO(),updatedAt:nowISO()};
    state.harvests.push(h); save(); m.remove(); currentView='harvest'; syncNav(); render();
    if(f.selection==='custom') openHarvestPlantSelection(h.id); else openHarvest(h.id);
  };
}
