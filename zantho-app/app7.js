// Zantho V0.4.2 — exploitation des données post-récolte

function renderTransformationsBody(){
  const el=document.querySelector('#qualityBody');
  const arr=state.transformations.slice().reverse();
  const valid=state.transformations.filter(t=>(+t.inputWeight||0)>0 && (+t.finalWeight||0)>=0);
  const totalIn=valid.reduce((s,t)=>s+(+t.inputWeight||0),0);
  const totalFinal=valid.reduce((s,t)=>s+(+t.finalWeight||0),0);
  const aggregate=totalIn?Math.round(totalFinal/totalIn*100):null;
  const ranked=valid.map(t=>({...t,_yield:(+t.finalWeight||0)/(+t.inputWeight||1)})).sort((a,b)=>b._yield-a._yield);
  const best=ranked[0];

  el.innerHTML=`
    <div class="section-title"><div><h2>Transformation</h2><div class="small-note">Rendements et essais comparables</div></div><button class="btn small" id="newTrans">Nouvel essai</button></div>
    ${valid.length?`<div class="grid two mini-stats quality-summary">
      <div class="card"><strong>${aggregate}%</strong><span>rendement final cumulé</span></div>
      <div class="card"><strong>${best?Math.round(best._yield*100)+' %':'—'}</strong><span>meilleur essai${best?' · '+esc(best.name):''}</span></div>
    </div>`:''}
    <div class="list">${arr.length?arr.map(t=>{
      const input=+t.inputWeight||0, dry=+t.dryWeight||0, fin=+t.finalWeight||0;
      const dryPct=input?Math.round(dry/input*100):null;
      const finPct=input?Math.round(fin/input*100):null;
      return `<button class="list-item transformation-row" data-trans="${t.id}">
        <div><strong>${esc(t.name)}</strong><div class="small-note">${esc(t.equipment||'Matériel non renseigné')} · ${t.temperature||'—'} °C · ${t.duration||'—'} h</div></div>
        <div class="yield-box"><strong>${fin||'—'} g</strong><small>${finPct!==null?finPct+' % final':''}${dryPct!==null?' · '+dryPct+' % sec':''}</small></div>
      </button>`;
    }).join(''):'<div class="card muted">Aucun essai.</div>'}</div>`;
  document.querySelector('#newTrans').onclick=openTransformation;
  document.querySelectorAll('[data-trans]').forEach(b=>b.onclick=()=>openTransformationDetail(b.dataset.trans));
}

function openTransformationDetail(id){
  const t=state.transformations.find(x=>x.id===id); if(!t)return;
  const lot=state.harvests.find(h=>h.id===t.harvestId);
  const input=+t.inputWeight||0, dry=+t.dryWeight||0, fin=+t.finalWeight||0, waste=+t.wasteWeight||0;
  const dryPct=input?Math.round(dry/input*1000)/10:null;
  const finalPct=input?Math.round(fin/input*1000)/10:null;
  const loss=input?Math.round((input-fin)/input*1000)/10:null;
  const m=openModal(`<div class="eyebrow">Essai de transformation</div><h2>${esc(t.name)}</h2>
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
  m.querySelector('#deleteTrans').onclick=()=>{
    const linked=state.tastings.filter(x=>x.transformationId===id).length;
    if(linked) return alert('Cet essai est utilisé par '+linked+' dégustation(s). Supprime ou rattache ces dégustations avant.');
    if(!confirm('Supprimer cet essai de transformation ?')) return;
    if(typeof markDeleted==='function') markDeleted('transformations',id);
    state.transformations=state.transformations.filter(x=>x.id!==id);
    save(); m.remove(); renderQuality();
  };
}

function renderTastingsBody(){
  const el=document.querySelector('#qualityBody');
  const arr=state.tastings.slice().reverse();
  const freq={};
  state.tastings.forEach(t=>(t.descriptors||[]).forEach(d=>freq[d]=(freq[d]||0)+1));
  const top=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const remarkable=state.tastings.filter(t=>t.gastro==='Remarquable').length;

  el.innerHTML=`<div class="section-title"><div><h2>Dégustations</h2><div class="small-note">Mémoire sensorielle de la gamme</div></div><button class="btn small" id="newTaste">Nouvelle dégustation</button></div>
    ${arr.length?`<div class="card sensory-summary">
      <div><strong>${arr.length}</strong><span>dégustation(s)</span></div>
      <div><strong>${remarkable}</strong><span>remarquable(s)</span></div>
      <div class="descriptor-strip">${top.length?top.map(([d,n])=>`<span>${esc(d)} · ${n}</span>`).join(''):'<span>Pas encore de descripteur dominant</span>'}</div>
    </div>`:''}
    <div class="list">${arr.length?arr.map(t=>`<button class="list-item" data-taste="${t.id}">
      <div><strong>${esc(t.name)}</strong><div class="small-note">${fmtDate(t.date)} · ${esc(t.intensity||'—')} · ${esc(t.gastro||'—')}</div></div>
      <span class="badge">${(t.descriptors||[]).length} notes</span>
    </button>`).join(''):'<div class="card muted">Aucune dégustation.</div>'}</div>`;
  document.querySelector('#newTaste').onclick=openTasting;
  document.querySelectorAll('[data-taste]').forEach(b=>b.onclick=()=>openTastingDetail(b.dataset.taste));
}

function openTastingDetail(id){
  const t=state.tastings.find(x=>x.id===id); if(!t)return;
  const source=state.transformations.find(x=>x.id===t.transformationId);
  const descriptors=(t.descriptors||[]).map(d=>`<span class="descriptor-chip">${esc(d)}</span>`).join('');
  const m=openModal(`<div class="eyebrow">Dégustation · ${fmtDate(t.date)}</div><h2>${esc(t.name)}</h2>
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
  m.querySelector('#deleteTaste').onclick=()=>{
    if(!confirm('Supprimer cette dégustation ?')) return;
    if(typeof markDeleted==='function') markDeleted('tastings',id);
    state.tastings=state.tastings.filter(x=>x.id!==id);
    save(); m.remove(); renderQuality();
  };
}

state.version='0.4.2';
_saveCoreV041();
