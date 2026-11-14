function openHarvestPlantSelection(hid,parent=null){
  const h=state.harvests.find(x=>x.id===hid); if(!h) return;
  const candidates=state.plants.filter(p=>p.species===h.species);
  const selected=new Set(h.plantIds||[]);
  const m=openModal(`<h2>Plants du lot — ${esc(h.name)}</h2><p class="small-note">Tous sont sélectionnés par défaut. Décoche uniquement les plants qui ne font pas partie de ce lot.</p><form id="plantSelectForm" class="stack"><div class="plant-select-grid">${candidates.map(p=>`<label class="plant-choice"><input type="checkbox" name="plant" value="${p.id}" ${selected.has(p.id)?'checked':''}> <span>${p.id}</span></label>`).join('')}</div><button class="btn">Enregistrer la sélection</button></form>`);
  m.querySelector('#plantSelectForm').onsubmit=e=>{
    e.preventDefault(); const fd=new FormData(e.target); const ids=fd.getAll('plant');
    if(!ids.length) return alert('Sélectionne au moins un plant.');
    h.plantIds=ids; h.updatedAt=nowISO(); save(); m.remove(); if(parent) parent.remove(); openHarvest(hid);
  };
}
function openHarvest(id){
  const h=state.harvests.find(x=>x.id===id); const total=(h.sessions||[]).reduce((s,x)=>s+(+x.freshWeight||0),0); const duration=(h.sessions||[]).reduce((s,x)=>s+((new Date(x.end)-new Date(x.start))/3600000||0),0);
  const m=openModal(`<div class="section-title"><div><h2>${esc(h.name)}</h2><div class="muted">${SPECIES[h.species].name}</div></div><span class="badge">${total.toFixed(1)} g frais</span></div>
  <div class="card"><div class="row" style="justify-content:space-between"><span>Plants associés au lot</span><strong>${h.plantIds.length}</strong></div><div class="row" style="justify-content:space-between"><span>Sessions</span><strong>${h.sessions.length}</strong></div><div class="row" style="justify-content:space-between"><span>Durée cumulée</span><strong>${duration.toFixed(1)} h</strong></div></div>
  <div class="row" style="margin:12px 0"><button class="btn" id="addSession">Ajouter une session</button><button class="btn secondary" id="editHarvestPlants">Modifier les plants</button></div>
  <div class="list">${h.sessions.length?h.sessions.map((s,i)=>`<div class="list-item"><div><strong>Session ${i+1}</strong><div class="small-note">${fmtDateTime(s.start)} → ${fmtDateTime(s.end)} · ${(s.plantIds||h.plantIds).length} plant(s)</div></div><strong>${(+s.freshWeight||0).toFixed(1)} g</strong></div>`).join(''):'<div class="muted">Aucune session.</div>'}</div>`);
  m.querySelector('#addSession').onclick=()=>openSession(h.id,m);
  m.querySelector('#editHarvestPlants').onclick=()=>openHarvestPlantSelection(h.id,m);
}
function openSession(hid,parent){
  const h=state.harvests.find(x=>x.id===hid); if(!h) return;
  const now=new Date(); const local=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const plantBoxes=(h.plantIds||[]).map(id=>`<label class="plant-choice"><input type="checkbox" name="plant" value="${id}" checked> <span>${id}</span></label>`).join('');
  const m=openModal(`<h2>Session de récolte</h2><form id="sessionForm" class="stack"><div class="grid two"><div class="field"><label>Début</label><input type="datetime-local" name="start" value="${local}" required></div><div class="field"><label>Fin</label><input type="datetime-local" name="end" value="${local}" required></div></div><div class="field"><label>Poids frais (g)</label><input type="number" min="0" step="0.1" name="freshWeight" required></div><details><summary>Plants concernés — ${h.plantIds.length} sélectionnés par défaut</summary><div class="plant-select-grid" style="margin-top:8px">${plantBoxes}</div></details><div class="field"><label>Commentaire</label><textarea name="note"></textarea></div><button class="btn">Enregistrer</button></form>`);
  m.querySelector('#sessionForm').onsubmit=e=>{
    e.preventDefault(); const fd=new FormData(e.target); const f=Object.fromEntries(fd.entries()); const plantIds=fd.getAll('plant');
    if(new Date(f.end)<new Date(f.start)) return alert('La fin doit être après le début.');
    if(!plantIds.length) return alert('Sélectionne au moins un plant pour cette session.');
    state.harvests.find(x=>x.id===hid).sessions.push({id:uid('session'),start:f.start,end:f.end,freshWeight:f.freshWeight,note:f.note,plantIds,createdAt:nowISO(),updatedAt:nowISO()});
    state.harvests.find(x=>x.id===hid).updatedAt=nowISO(); save(); m.remove(); parent.remove(); render(); openHarvest(hid);
  };
}
