// Zantho V0.6 — plan central et fiches plants simplifiées

function familyLabel(p){
  if(p.species==='tas_f'||p.species==='tas_m') return 'Tasmannia';
  if(p.species==='japanese') return 'Sansho japonais';
  if(p.species==='korean') return 'Sansho coréen';
  if(p.species==='sichuan') return 'Sichuan';
  if(p.species==='timut') return 'Timut';
  return SPECIES[p.species]?.name||p.species;
}
function familyColor(p){ return SPECIES[p.species]?.color||'#789'; }
function codeNumber(p){ return String(p.code||p.id).split('-').pop(); }

function renderPlan(){
  const ordered=state.plants.slice().sort((a,b)=>a.line-b.line||a.position-b.position);
  const lines=[1,2,3,4,5].map(line=>ordered.filter(p=>p.line===line));

  app.innerHTML=`
    <div class="plan-top">
      <div>
        <div class="eyebrow">Plantation · 97 plants</div>
        <h2>Plan</h2>
        <div class="small-note">Touchez un plant pour consulter ou ajouter une information.</div>
      </div>
      <button class="btn small secondary" id="planTour">Tournée</button>
    </div>

    <input class="search" id="plantSearch" placeholder="Rechercher L2-SIC-04, Timut, coréen…">

    <div class="field-plan">
      ${lines.map(arr=>{
        const groups=[];
        arr.forEach(p=>{
          const last=groups[groups.length-1];
          if(!last||last.code!==p.groupCode) groups.push({code:p.groupCode,plants:[p]});
          else last.plants.push(p);
        });
        return `<section class="field-line">
          <div class="field-line-title"><strong>Ligne ${arr[0]?.line||''}</strong><span>${arr.length} plants</span></div>
          <div class="field-groups">
            ${groups.map(g=>{
              const gp=g.plants[0];
              return `<div class="field-group" data-group="${esc(g.code)}">
                <div class="field-group-head">
                  <span class="group-chip" style="--group:${familyColor(gp)}">${esc(g.code)}</span>
                  <span>${esc(familyLabel(gp))}</span>
                </div>
                <div class="field-plants">
                  ${g.plants.map(p=>`<button
                    type="button"
                    class="field-plant ${statusTone(plantStatus(p))}"
                    data-plant="${p.id}"
                    data-search="${esc((p.code+' '+familyLabel(p)+' '+SPECIES[p.species].latin).toLowerCase())}"
                    style="--plant:${familyColor(p)}"
                    aria-label="${esc(p.code+' '+familyLabel(p))}">
                    <span class="plant-number">${codeNumber(p)}</span>
                    <span class="plant-dot"></span>
                  </button>`).join('')}
                </div>
              </div>`;
            }).join('')}
          </div>
        </section>`;
      }).join('')}
    </div>

    <div class="plan-key">
      <span><i class="key-ok"></i>Sain</span>
      <span><i class="key-watch"></i>À surveiller</span>
      <span><i class="key-danger"></i>Problème</span>
    </div>`;

  document.querySelector('#planTour').onclick=()=>openTour();
  document.querySelectorAll('[data-plant]').forEach(b=>b.onclick=()=>openPlant(b.dataset.plant));
  document.querySelector('#plantSearch').oninput=e=>{
    const q=e.target.value.toLowerCase().trim();
    document.querySelectorAll('[data-plant]').forEach(b=>{
      b.classList.toggle('plan-hidden',!!q && !b.dataset.search.includes(q));
    });
    document.querySelectorAll('.field-group').forEach(g=>{
      g.classList.toggle('plan-hidden',![...g.querySelectorAll('[data-plant]')].some(b=>!b.classList.contains('plan-hidden')));
    });
  };
}

function openAddPlantInfo(id,parent){
  const p=state.plants.find(x=>x.id===id); if(!p)return;
  const m=openModal(`
    <div class="eyebrow">${esc(p.code)} · ${esc(familyLabel(p))}</div>
    <h2>Ajouter une information</h2>
    <form id="quickNoteForm" class="stack">
      <div class="field">
        <label>Type</label>
        <select name="category">
          <option>Note</option>
          <option>Intervention</option>
          <option>Incident</option>
          <option>Entretien / taille</option>
          <option>Mesure</option>
        </select>
      </div>
      <div class="field">
        <label>Information</label>
        <textarea name="note" required autofocus placeholder="Ex. reprise correcte, branche cassée, taille légère…"></textarea>
      </div>
      <button class="btn big">Enregistrer</button>
    </form>
    <div class="section-title"><h3>Ou saisir un suivi structuré</h3></div>
    <div class="grid two">
      <button class="btn secondary" id="expressInfo">Observation express</button>
      <button class="btn secondary" id="detailInfo">Observation détaillée</button>
    </div>`);

  m.querySelector('#quickNoteForm').onsubmit=e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const d=defaultsForPlant(id);
    state.observations.push({
      id:uid('obs'),
      plantId:id,
      date:new Date().toISOString().slice(0,10),
      vigor:d.vigor,
      health:d.health,
      flowering:d.flowering,
      fruiting:d.fruiting,
      height:'',
      width:'',
      note:fd.get('note').trim(),
      kind:'note',
      category:fd.get('category'),
      createdAt:nowISO(),
      updatedAt:nowISO()
    });
    save();
    m.remove();
    if(parent?.remove) parent.remove();
    render();
    openPlant(id);
  };
  m.querySelector('#expressInfo').onclick=()=>{m.remove();openQuickObs(id,()=>{if(parent?.remove)parent.remove();render();openPlant(id);});};
  m.querySelector('#detailInfo').onclick=()=>{m.remove();openObservation(id,parent);};
}

function openPlant(id){
  const p=state.plants.find(x=>x.id===id); if(!p)return;
  const obs=state.observations.filter(o=>o.plantId===id).sort((a,b)=>String(b.createdAt||b.date).localeCompare(String(a.createdAt||a.date)));
  const last=obs[0]; const age=daysSince(last?.date);

  const m=openModal(`<div class="plant-sheet plant-sheet-v6">
    <div class="plant-sheet-head">
      <div>
        <div class="eyebrow">Ligne ${p.line} · emplacement ${p.id}</div>
        <h2>${esc(p.code||p.id)}</h2>
        <div class="plant-species">${esc(familyLabel(p))}</div>
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
          <button type="button" class="mini-delete" data-del-obs="${o.id}" aria-label="Supprimer">Suppr.</button>
        </div>`;
      }).join(''):'<div class="card muted">Aucun historique pour ce plant.</div>'}
    </div>

    <div class="section-title"><h3>Photos</h3><button class="text-button" id="photoPlant2">+ Ajouter</button></div>
    <div class="photo-grid" id="plantPhotos"></div>
  </div>`);

  m.querySelector('#addInfoPlant').onclick=()=>openAddPlantInfo(id,m);
  m.querySelector('#photoPlant').onclick=()=>openPhotoCapture(id,m);
  m.querySelector('#photoPlant2').onclick=()=>openPhotoCapture(id,m);

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
}

state.version='0.6.0';
save();
currentView='plan';
if(typeof syncNav==='function') syncNav();
render();
