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
  const m=openModal(`<h2>Nouvelle observation — ${plantId}</h2><form id="obsForm" class="stack">
    <div class="field"><label>Date</label><input type="date" name="date" value="${new Date().toISOString().slice(0,10)}"></div>
    <div class="field"><label>Vigueur</label><select name="vigor">${['Très faible','Faible','Correcte','Bonne','Très bonne'].map(x=>`<option>${x}</option>`).join('')}</select></div>
    <div class="field"><label>État sanitaire</label><select name="health">${['Sain','À surveiller','Problème'].map(x=>`<option>${x}</option>`).join('')}</select></div>
    <div class="field"><label>Floraison</label><select name="flowering">${['Absente','Faible','Moyenne','Forte'].map(x=>`<option>${x}</option>`).join('')}</select></div>
    <div class="field"><label>Fructification</label><select name="fruiting">${['Absente','Faible','Moyenne','Forte'].map(x=>`<option>${x}</option>`).join('')}</select></div>
    <div class="grid two"><div class="field"><label>Hauteur (cm, facultatif)</label><input type="number" name="height"></div><div class="field"><label>Largeur (cm, facultatif)</label><input type="number" name="width"></div></div>
    <div class="field"><label>Commentaire</label><textarea name="note"></textarea></div><button class="btn">Enregistrer</button></form>`);
  m.querySelector('#obsForm').onsubmit=e=>{e.preventDefault(); const f=new FormData(e.target); state.observations.push({id:uid('obs'),plantId,...Object.fromEntries(f.entries()),createdAt:nowISO()}); save(); m.remove(); parent.remove(); render();};
}

async function photoDB(){ return new Promise((resolve,reject)=>{ const req=indexedDB.open(PHOTO_DB,1); req.onupgradeneeded=()=>{ if(!req.result.objectStoreNames.contains(PHOTO_STORE)) req.result.createObjectStore(PHOTO_STORE,{keyPath:'id'}); }; req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
async function putPhoto(rec){ const db=await photoDB(); return new Promise((res,rej)=>{ const tx=db.transaction(PHOTO_STORE,'readwrite'); tx.objectStore(PHOTO_STORE).put(rec); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); }
async function getPhotosByPlant(plantId){ const db=await photoDB(); return new Promise((res,rej)=>{ const tx=db.transaction(PHOTO_STORE,'readonly'); const req=tx.objectStore(PHOTO_STORE).getAll(); req.onsuccess=()=>res(req.result.filter(x=>x.plantId===plantId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))); req.onerror=()=>rej(req.error); }); }
async function getPhoto(id){ const db=await photoDB(); return new Promise((res,rej)=>{ const req=db.transaction(PHOTO_STORE,'readonly').objectStore(PHOTO_STORE).get(id); req.onsuccess=()=>res(req.result||null); req.onerror=()=>rej(req.error); }); }
async function getAllPhotos(){ const db=await photoDB(); return new Promise((res,rej)=>{ const req=db.transaction(PHOTO_STORE,'readonly').objectStore(PHOTO_STORE).getAll(); req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); }
function openPhotoCapture(plantId,parent){ const m=openModal(`<h2>Photo de suivi — ${plantId}</h2><form id="photoForm" class="stack"><div class="field"><label>Photo</label><input type="file" name="photo" accept="image/*" capture="environment" required></div><div class="field"><label>Commentaire</label><input name="note"></div><button class="btn">Enregistrer</button></form>`); m.querySelector('#photoForm').onsubmit=async e=>{e.preventDefault(); const file=e.target.photo.files[0]; const createdAt=nowISO(); const rec={id:uid('photo'),plantId,blob:file,name:file.name||'photo.jpg',type:file.type||'image/jpeg',note:e.target.note.value,createdAt,synced:false}; await putPhoto(rec); state.photoRefs=mergeById(state.photoRefs||[],[{id:rec.id,plantId:rec.plantId,name:rec.name,type:rec.type,note:rec.note,createdAt,updatedAt:createdAt,drivePath:null}]); save(); m.remove(); parent.remove(); openPlant(plantId);}; }
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
