/* Améliorations non destructives de Ty Bufala Mobile : contrôle de cohérence et parenté. */
(function(){
  'use strict';
  const Q=globalThis.TyBufalaQuality;
  if(!Q)throw new Error('Module de contrôle du cheptel indisponible.');
  const oldRender=render;
  let issueFilter='error',showAll=false,ancestorId='';
  const labelOf=a=>a.name?.trim()?`${a.name} · ${a.earTag}`:(a.earTag||'Sans identification');
  const actorLink=(id,label,meta='')=>`<button type="button" class="tile audit-link" data-animal-id="${esc(id)}"><div><strong>${esc(label)}</strong>${meta?`<small>${esc(meta)}</small>`:''}</div><span class="arrow">›</span></button>`;
  function renderQuality(){
    const report=Q.check(state,localToday()),counts=report.counts;
    const all=report.issues.filter(i=>i.severity===issueFilter);
    const visible=showAll?all:all.slice(0,15);
    const title={error:'À corriger',warning:'À vérifier',info:'Informations'};
    const pill={error:'danger',warning:'warn',info:'neutral'};
    app.innerHTML=`<section class="hero"><p class="eyebrow">Qualité & filiation</p><h1>Contrôles du cheptel</h1><p class="lead">Repérer les incohérences sans modifier automatiquement les données.</p></section>
      <section class="grid stats"><div class="card stat"><strong>${report.active}</strong><span>Présents</span></div><div class="card stat"><strong>${counts.error}</strong><span>Anomalies</span></div><div class="card stat"><strong>${counts.warning}</strong><span>À vérifier</span></div></section>
      ${!report.animals?'<div class="note">L’inventaire est vide sur cet appareil. Son état de chargement est indiqué dans Données. La base commune doit recevoir l’inventaire validé une seule fois.</div>':''}
      <div class="note info">Les contrôles sont indicatifs : une mère absente du fichier peut être un animal extérieur à l’élevage. Une date prévisionnelle de vêlage ne constitue pas un diagnostic de gestation.</div>
      <div class="section-head"><h2>Contrôles automatiques</h2></div>
      <div class="audit-filters" role="group" aria-label="Niveau de contrôle">${Object.entries(title).map(([key,name])=>`<button type="button" class="audit-filter ${key===issueFilter?'selected':''}" data-filter="${key}">${name} (${counts[key]})</button>`).join('')}</div>
      <div class="list" id="auditList">${visible.length?visible.map(i=>`<div class="card audit-entry"><div class="audit-entry-heading"><span class="badge ${pill[i.severity]}">${esc(title[i.severity])}</span><strong>${esc(i.title)}</strong></div><div class="help">${esc(i.detail||'')}${i.date?' · '+dateFR(i.date):''}</div>${i.animalId&&animalFor(i.animalId)?actorLink(i.animalId,labelOf(animalFor(i.animalId))):''}</div>`).join(''):'<div class="empty">Aucun élément dans cette catégorie.</div>'}</div>
      ${!showAll&&all.length>visible.length?`<button id="showAllIssues" class="btn secondary audit-expand">Voir les ${all.length-visible.length} autres contrôles</button>`:''}
      <div class="section-head"><h2>Ascendance & descendance</h2></div>
      <div class="card form-stack"><label for="ancestorLookup">Sélectionner un animal</label><select id="ancestorLookup"><option value="">Choisir un animal…</option>${state.animals.slice().sort((a,b)=>labelOf(a).localeCompare(labelOf(b),'fr',{numeric:true})).map(a=>`<option value="${esc(a.id)}" ${a.id===ancestorId?'selected':''}>${esc(labelOf(a))}</option>`).join('')}</select><div id="familyPreview" class="audit-family"></div></div>
      <p class="help">Aucune correction automatique. OneDrive reste un raccordement distinct à activer.</p>`;
    app.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{issueFilter=b.dataset.filter;showAll=false;renderQuality();}));
    app.querySelector('#showAllIssues')?.addEventListener('click',()=>{showAll=true;renderQuality();});
    app.querySelector('#ancestorLookup').addEventListener('change',e=>{ancestorId=e.target.value;drawFamily();});
    bindAnimalLinks(app);drawFamily();
  }
  function bindAnimalLinks(root){
    root.querySelectorAll('[data-animal-id]').forEach(b=>b.addEventListener('click',()=>{
      nav('herd');ui.animalId=b.dataset.animalId;render();
    }));
  }
  function drawFamily(){
    const el=document.querySelector('#familyPreview');if(!el)return;
    const a=state.animals.find(x=>x.id===ancestorId);
    if(!a){el.innerHTML='<p class="help">Tu pourras consulter les descendants directs et sur plusieurs générations.</p>';return;}
    const mother=state.animals.find(x=>Q.tag(x.earTag)===Q.tag(a.motherTag)),father=state.animals.find(x=>Q.tag(x.earTag)===Q.tag(a.fatherTag));
    const descendants=Q.descendants(state.animals,a.id);
    el.innerHTML=`<div class="audit-family-group"><h3>Animal sélectionné</h3>${actorLink(a.id,labelOf(a),a.birthDate?'Né(e) le '+dateFR(a.birthDate):'')}</div>
      <div class="audit-family-group"><h3>Parents</h3>${mother?actorLink(mother.id,labelOf(mother),'Mère'):`<p class="help">Mère : ${esc(a.motherName||a.motherTag||'Non renseignée')}</p>`}${father?actorLink(father.id,labelOf(father),'Père'):`<p class="help">Père : ${esc(a.fatherName||a.fatherTag||'Non renseigné')}</p>`}</div>
      <div class="audit-family-group"><h3>Descendance connue (${descendants.length})</h3>${descendants.length?descendants.map(d=>`<div class="audit-generation" style="--depth:${Math.min(d.depth,8)}"><span class="audit-gen-label">Génération ${d.depth}</span>${actorLink(d.animal.id,labelOf(d.animal),d.animal.birthDate?dateFR(d.animal.birthDate):'Date inconnue')}</div>`).join(''):'<p class="help">Aucun descendant identifié dans le fichier.</p>'}</div>`;
    bindAnimalLinks(el);
  }
  render=function(){if(!sessionUser)return oldRender();if(ui.view==='quality')return renderQuality();return oldRender();};
})();
