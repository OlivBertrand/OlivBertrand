'use strict';
// Assignments have their own revisions; labels never overwrite an animal record.
const herdSelection=new Set();
const workFilter={labels:[],group:'',reproduction:'',sex:'',minAge:'',maxAge:'',selecting:false,allTasks:false};
const activeLabels=id=>state.animalLabelAssignments.filter(x=>x.animalId===id&&!x.completedAt);
const currentGroup=id=>state.animalGroupAssignments.find(x=>x.animalId===id&&!x.endedAt);
const labelName=id=>state.labelDefinitions.find(x=>x.id===id)?.name||'Étiquette inconnue';
const groupName=id=>state.herdGroups.find(x=>x.id===id)?.name||'Lot inconnu';
function herdWorkMatches(a){
 if(workFilter.labels.length&&!activeLabels(a.id).some(x=>workFilter.labels.includes(x.labelId)))return false;
 if(workFilter.group&&currentGroup(a.id)?.groupId!==workFilter.group)return false;
 if(workFilter.sex&&a.sex!==workFilter.sex)return false;
 if(workFilter.reproduction&&TyBufalaReproduction.summary(state.events.filter(e=>e.animalId===a.id),localToday()).status!==workFilter.reproduction)return false;
 const months=a.birthDate?-dayDiff(a.birthDate)/30.4375:null;
 if(workFilter.minAge!==''&&(months===null||months<Number(workFilter.minAge)))return false;
 if(workFilter.maxAge!==''&&(months===null||months>Number(workFilter.maxAge)))return false;
 return true;
}
function mountHerdWorkFilters(){
 const list=document.getElementById('herdList'),box=document.createElement('section');box.className='card';
 box.innerHTML=`<details><summary>Filtres</summary><div class="form-grid"><div class="field"><label>Étiquettes (au moins une)</label><select id="workLabels" multiple>${state.labelDefinitions.map(x=>`<option value="${esc(x.id)}" ${workFilter.labels.includes(x.id)?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Lot</label><select id="workGroup"><option value="">Tous</option>${state.herdGroups.map(x=>`<option value="${esc(x.id)}" ${workFilter.group===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Reproduction</label><select id="workRepro">${[['','Tous'],['positive','Diagnostic positif connu'],['negative','Dernier diagnostic vide'],['unconfirmed','Gestation non confirmée'],['ended','Gestation terminée'],['uncertain','À confirmer']].map(([v,l])=>`<option value="${v}" ${workFilter.reproduction===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="field"><label>Sexe</label><select id="workSex">${[['','Tous'],['F','Femelles'],['M','Mâles']].map(([v,l])=>`<option value="${v}" ${workFilter.sex===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="field"><label>Âge minimum (mois)</label><input id="workMinAge" type="number" min="0" value="${esc(workFilter.minAge)}"></div><div class="field"><label>Âge maximum (mois)</label><input id="workMaxAge" type="number" min="0" value="${esc(workFilter.maxAge)}"></div></div><button class="btn ghost small" id="resetWorkFilters">Effacer ces filtres</button></details><button class="btn secondary small" id="manageWork">Renommer une étiquette / un lot</button>`;
 list.before(box);
 for(const [id,key] of [['workGroup','group'],['workRepro','reproduction'],['workSex','sex'],['workMinAge','minAge'],['workMaxAge','maxAge']])box.querySelector('#'+id).onchange=e=>{workFilter[key]=e.target.value;drawHerdList();};
 box.querySelector('#workLabels').onchange=e=>{workFilter.labels=[...e.target.selectedOptions].map(o=>o.value);drawHerdList();};
 box.querySelector('#resetWorkFilters').onclick=()=>{Object.assign(workFilter,{labels:[],group:'',reproduction:'',sex:'',minAge:'',maxAge:''});render();};
 box.querySelector('#manageWork').onclick=openWorkRename;
 const bar=document.createElement('section');bar.id='herdSelectionBar';bar.className='card herd-selection-bar';list.before(bar);
}
function mountHerdSelection(){
 const bar=document.getElementById('herdSelectionBar');if(!bar)return;
 bar.innerHTML=`<button class="btn secondary small" id="toggleSelection">${workFilter.selecting?'Finir la sélection':'Sélectionner'}</button><strong id="selectionCount">${herdSelection.size} sélectionné(s)</strong>${workFilter.selecting?'<div class="filter-row"><button class="btn ghost small" id="selectFiltered">Tout sélectionner les résultats filtrés</button><button class="btn ghost small" id="clearSelected">Tout désélectionner</button></div><div class="filter-row"><button class="btn small" id="bulkLabel">+ Ajouter une étiquette</button><button class="btn secondary small" id="bulkComplete">Terminer une étiquette</button><button class="btn secondary small" id="bulkRemove">Retirer une étiquette</button><button class="btn secondary small" id="bulkGroup">Changer de lot</button></div>':''}`;
 bar.querySelector('#toggleSelection').onclick=()=>{workFilter.selecting=!workFilter.selecting;drawHerdList();};
 if(!workFilter.selecting)return;
 const tiles=[...document.querySelectorAll('#herdList [data-id]')];
 for(const tile of tiles){const input=document.createElement('input');input.type='checkbox';input.setAttribute('aria-label','Sélectionner '+tile.textContent);input.checked=herdSelection.has(tile.dataset.id);input.dataset.selectAnimal=tile.dataset.id;input.onclick=e=>e.stopPropagation();input.onchange=()=>{input.checked?herdSelection.add(tile.dataset.id):herdSelection.delete(tile.dataset.id);document.getElementById('selectionCount').textContent=herdSelection.size+' sélectionné(s)';};const wrapper=document.createElement('div');wrapper.className='selection-item';tile.before(wrapper);wrapper.append(input,tile);}
 bar.querySelector('#selectFiltered').onclick=()=>{tiles.forEach(t=>herdSelection.add(t.dataset.id));drawHerdList();};bar.querySelector('#clearSelected').onclick=()=>{herdSelection.clear();drawHerdList();};
 for(const [id,action] of [['bulkLabel','label'],['bulkComplete','complete'],['bulkRemove','remove'],['bulkGroup','group']])bar.querySelector('#'+id).onclick=()=>openWorkAssignment([...herdSelection],action);
}
function mountAnimalWork(a){
 const box=document.createElement('section');box.className='advanced-section';box.innerHTML=`<details><summary>Lot & étiquettes ${animalGroupChip(a.id)}</summary><p>${activeLabels(a.id).map(x=>`<span class="badge">${esc(labelName(x.labelId))}${x.dueDate?' · '+dateFR(x.dueDate):''}</span>`).join(' ')||'Aucune étiquette active'}</p><p>Lot : ${currentGroup(a.id)?esc(groupName(currentGroup(a.id).groupId)):'Non renseigné'}</p><div class="filter-row"><button class="btn small" id="animalLabel">+ Étiquette</button><button class="btn secondary small" id="animalCompleteLabel">Terminer / retirer</button><button class="btn secondary small" id="animalGroup">Changer de lot</button></div><details><summary>Historique des affectations</summary>${state.animalLabelAssignments.filter(x=>x.animalId===a.id).map(x=>`<p>${esc(labelName(x.labelId))} · ${x.completedAt?x.completionReason==='removed'?'Retirée':'Terminée':'À faire'} · ${dateFR((x.assignedAt||'').slice(0,10))}${x.note?' · '+esc(x.note):''}</p>`).join('')}${state.animalGroupAssignments.filter(x=>x.animalId===a.id).map(x=>`<p>${esc(groupName(x.groupId))} · ${dateFR((x.startedAt||'').slice(0,10))} → ${x.endedAt?dateFR(x.endedAt.slice(0,10)):'actuel'}</p>`).join('')}</details></details>`;
 document.getElementById('addEvent').closest('.section-head').before(box);
 box.querySelector('#animalLabel').onclick=()=>openWorkAssignment([a.id],'label');box.querySelector('#animalCompleteLabel').onclick=()=>openWorkAssignment([a.id],'complete');box.querySelector('#animalGroup').onclick=()=>openWorkAssignment([a.id],'group');
}
function openWorkAssignment(ids,action){
 ids=[...new Set(ids)].filter(id=>animalFor(id));if(!ids.length){toast('Sélectionne au moins un animal.');return;}
 const isGroup=action==='group',closing=['complete','remove'].includes(action),defs=state[isGroup?'herdGroups':'labelDefinitions'];
 const title=isGroup?'Changer de lot':closing?action==='remove'?'Retirer une étiquette':'Terminer une étiquette':'Ajouter une étiquette';
 modal(title,`<p>${ids.length} animal(aux) ciblé(s). Les autres informations sont conservées.</p><div class="field"><label>${isGroup?'Lot':'Étiquette'} existant(e)</label><select name="definition"><option value="">Choisir…</option>${defs.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></div>${!closing?'<div class="field"><label>Ou nouveau libellé</label><input name="newName" maxlength="80"></div>':''}${!closing&&!isGroup?'<div class="field"><label>Échéance facultative</label><input type="date" name="dueDate"></div>':''}<div class="field"><label>Note facultative</label><input name="note" maxlength="1000"></div><p class="help">Chaque lot de 25 animaux est enregistré localement de façon atomique. En cas d’interruption, les lots précédents restent en attente de synchronisation.</p>`, 'Confirmer',async form=>{
  const f=new FormData(form),newName=String(f.get('newName')||'').trim(),chosen=String(f.get('definition')||'');let def=newName?defs.find(d=>norm(d.name)===norm(newName)):defs.find(d=>d.id===chosen),newDef=false;
  if(!def&&newName){def={id:makeID(isGroup?'group':'label'),name:newName};newDef=true;}
  if(!def)throw new Error('Choisis une étiquette / un lot ou indique un nouveau libellé.');
  let saved=0,skipped=0;
  for(let offset=0;offset<ids.length;offset+=25){
   const changes=[],at=nowISO();if(newDef){changes.push({kind:isGroup?'herdGroups':'labelDefinitions',data:def});}
   let changed=0;
   for(const id of ids.slice(offset,offset+25)){
    if(isGroup){const previous=currentGroup(id);if(previous?.groupId===def.id){skipped++;continue;}if(previous)changes.push({kind:'animalGroupAssignments',data:{...previous,endedAt:at}});changes.push({kind:'animalGroupAssignments',data:{id:makeID('group_assignment'),animalId:id,groupId:def.id,startedAt:at,note:String(f.get('note')||'')}});changes.push({kind:'events',data:{id:makeID('event'),animalId:id,type:'Changement de lot',date:localToday(),confirmation:'confirmed',groupId:def.id,description:def.name,createdAt:at}});}
    else {const previous=activeLabels(id).find(x=>x.labelId===def.id);if(closing){if(!previous){skipped++;continue;}changes.push({kind:'animalLabelAssignments',data:{...previous,completedAt:at,completionReason:action==='remove'?'removed':'done'}});}else{if(previous){skipped++;continue;}changes.push({kind:'animalLabelAssignments',data:{id:makeID('label_assignment'),animalId:id,labelId:def.id,assignedAt:at,dueDate:String(f.get('dueDate')||''),note:String(f.get('note')||'')}});}}
    changed++;
   }
   try{if(changes.length)await putGroup(changes);newDef=false;saved+=changed;}catch(error){throw new Error(`${saved} enregistré(s) localement ; ${skipped} déjà conformes ; ${ids.length-offset} non traités. ${error.message}`);}
  }
  toast(`${saved} enregistré(s) localement ; ${skipped} déjà conformes. Synchronisation en attente de confirmation serveur.`);
 });
}
function openWorkRename(){
 const defs=[...state.labelDefinitions.map(x=>({...x,kind:'labelDefinitions'})),...state.herdGroups.map(x=>({...x,kind:'herdGroups'}))];
 modal('Renommer sans perdre les liens',`<div class="field"><label>Étiquette / lot</label><select name="index">${defs.map((d,i)=>`<option value="${i}">${esc(d.name)} (${d.kind==='herdGroups'?'lot':'étiquette'})</option>`).join('')}</select></div><div class="field"><label>Nouveau libellé</label><input name="name" required maxlength="80"></div>`,'Enregistrer',async form=>{const f=new FormData(form),d=defs[Number(f.get('index'))];if(!d)throw new Error('Aucune définition à renommer.');const {kind,...data}=d;await putGroup([{kind,data:{...data,name:String(f.get('name')).trim()}}]);});
}
function mountHomeWork(){
 const present=new Set(activeAnimals().map(a=>a.id)),labels=state.labelDefinitions.map(d=>({...d,rows:state.animalLabelAssignments.filter(x=>x.labelId===d.id&&!x.completedAt&&present.has(x.animalId))})).filter(d=>d.rows.length),groups=state.herdGroups.map(d=>({...d,count:new Set(state.animalGroupAssignments.filter(x=>x.groupId===d.id&&!x.endedAt&&present.has(x.animalId)).map(x=>x.animalId)).size})).filter(d=>d.count);
 const box=document.createElement('section');box.className='card';box.innerHTML=`${labels.length||ui.view==='lots'?'<h2>À faire</h2>':''}${(workFilter.allTasks?labels:labels.slice(0,6)).map(d=>`<button class="tile" data-task-label="${esc(d.id)}"><strong>${esc(d.name)}</strong><span>${new Set(d.rows.map(x=>x.animalId)).size}${d.rows.some(x=>x.dueDate&&x.dueDate<localToday())?' · en retard':''}</span></button>`).join('')||(ui.view==='lots'?'<p>Aucune tâche active.</p>':'')}${labels.length>6?'<button class="btn ghost small" id="allTasks">Voir tout</button>':''}<h2>Lots</h2><div class="group-grid">${groups.map(d=>`<button class="tile group-card" style="${TyBufalaUI.groupStyle(d)}" data-task-group="${esc(d.id)}"><strong class="group-card-name"><span class="group-dot"></span>${esc(d.name)}</strong><span class="group-card-count">${d.count}</span><small>animaux présents</small></button>`).join('')||'<p>Aucun lot renseigné.</p>'}</div>`;
 (document.getElementById('homeWork')||app).append(box);box.querySelector('#allTasks')?.addEventListener('click',()=>{workFilter.allTasks=true;render();});
 for(const [attr,key] of [['label','labels'],['group','group']])box.querySelectorAll('[data-task-'+attr+']').forEach(b=>b.onclick=()=>{Object.assign(workFilter,{labels:[],group:'',reproduction:'',sex:'',minAge:'',maxAge:''});ui.herdSearch='';workFilter[key]=attr==='label'?[b.dataset.taskLabel]:b.dataset.taskGroup;ui.herdStatus='present';ui.herdCategory='';nav('herd');});
}
function herdWorkCompletionChanges(event){
 const suggestion={'Échographie':'À échographier','Vaccination':'À vacciner','Tarissement':'À tarir','Sortie':'À sortir'}[event.type];if(!suggestion||event.confirmation!=='confirmed'||!event.date||event.date>localToday()||event.dateUnknown||event.cancelled)return [];
 const assignments=activeLabels(event.animalId).filter(x=>norm(labelName(x.labelId))===norm(suggestion));if(!assignments.length||!confirm(`Marquer l’étiquette « ${suggestion} » comme terminée ?`))return [];
 return assignments.map(x=>({kind:'animalLabelAssignments',data:{...x,completedAt:nowISO(),completionReason:'done',eventId:event.id}}));
}
async function cancelAnimalEvent(event){
 if(!confirm('Annuler cet événement ? Sa trace restera dans l’historique.'))return;
 const changes=[{kind:'events',data:{...event,cancelled:true,cancelledAt:nowISO()}}],a=animalFor(event.animalId);
 if(event.type==='Vêlage'&&a){
  const children=childrenOf(a);const remaining=state.events.filter(x=>x.animalId===a.id&&x.id!==event.id&&!x.cancelled&&x.type==='Vêlage'&&x.confirmation==='confirmed'&&x.date&&x.date<=localToday()).sort((x,y)=>y.date.localeCompare(x.date));
  if(a.lastCalving===event.date){
   if(!confirm(`${children.length} descendant(s) connu(s), tous conservés. Remplacer le dernier vêlage par ${remaining[0]?dateFR(remaining[0].date):'une date inconnue'} et remettre le profil maternel à vérifier ?`))throw new Error('Annulation interrompue : vérifier la fiche maternelle avant de continuer.');
   changes.push({kind:'animals',data:{...a,lastCalving:remaining[0]?.date||'',reproductiveStatus:'',productionStatus:'',productionStatusDate:'',updatedAt:nowISO()}});
  }
 }
 if(['Tarissement','Mise en lactation','Entrée','Sortie','Changement de lot'].includes(event.type)){
  if(!confirm('Cet événement avait pu modifier la lactation, la présence ou le lot. Son annulation ne revient pas automatiquement sur ces données : confirmer puis vérifier la fiche ?'))throw new Error('Annulation interrompue.');
 }
 await putGroup(changes);toast('Annulation enregistrée localement. Les descendants sont conservés.');
}
function mountEventHistory(a,events){
 const section=document.createElement('details');section.className='card';section.innerHTML=`<summary>Événements annulés et historique des corrections</summary>${events.map(e=>`<button class="btn ghost small" type="button" data-history-event="${esc(e.id)}">${esc(e.type)} · ${dateFR(e.date)}${e.cancelled?' · annulé':''}</button>`).join('')}`;app.append(section);
 section.querySelectorAll('[data-history-event]').forEach(b=>b.onclick=async()=>{
  const event=events.find(e=>e.id===b.dataset.historyEvent);let history=[];
  try{history=(await cloud.request('history/events/'+encodeURIComponent(event.id))).history;}catch(error){toast('Historique serveur indisponible ; version locale affichée.');}
  modal('Historique des corrections',`<p>Version locale : ${esc(event.type)} · ${event.cancelled?'Annulé':'Actif'}</p>${history.map(e=>`<article><strong>Révision ${esc(e.revision)} · ${esc(e.author)}</strong><p>${esc(e.type)} · ${dateFR(e.date)} · ${esc(e.result||'')} · ${e.cancelled?'Annulé':'Actif'}</p><p>${esc(e.description||'')}</p></article>`).join('')||'<p>Historique détaillé accessible après connexion au serveur.</p>'}`,'Fermer',()=>{});
 });
}
function reconcileCalvingCorrection(old,event,changes){
 if(!old||old.type!=='Vêlage'||(old.date===event.date&&old.type===event.type&&old.confirmation===event.confirmation))return;
 const a=animalFor(event.animalId);if(!a||a.lastCalving!==old.date)return;
 const remaining=state.events.filter(x=>x.id!==old.id&&x.animalId===a.id&&!x.cancelled&&x.type==='Vêlage'&&x.confirmation==='confirmed'&&x.date&&x.date<=localToday());
 if(event.type==='Vêlage'&&event.confirmation==='confirmed'&&event.date&&event.date<=localToday())remaining.push(event);
 remaining.sort((a,b)=>b.date.localeCompare(a.date));
 if(!confirm('Cette correction change le dernier vêlage. Actualiser la fiche maternelle ? Les veaux et leur filiation seront conservés.'))throw new Error('Correction interrompue pour vérifier la fiche maternelle.');
 for(let i=changes.length-1;i>=0;i--)if(changes[i].kind==='animals'&&changes[i].data.id===a.id)changes.splice(i,1);
 changes.push({kind:'animals',data:{...a,lastCalving:remaining[0]?.date||'',reproductiveStatus:remaining.length?'calved':'',productionStatus:remaining.length?a.productionStatus:'',productionStatusDate:remaining.length?a.productionStatusDate:'',updatedAt:nowISO()}});
}

function animalGroupChip(id){const assignment=currentGroup(id),group=state.herdGroups.find(g=>g.id===assignment?.groupId);return group?`<span class="group-chip" style="${TyBufalaUI.groupStyle(group)}">${esc(group.name)}</span>`:'';}
function renderWorkHub(){app.innerHTML=`<section class="hero"><h1>Lots & tâches</h1></section><div class="quick-actions"><button class="btn" id="newGroup">＋ Lot</button><button class="btn secondary" id="newLabel">＋ Étiquette</button><button class="btn ghost" id="renameWork">Renommer</button></div>`;mountHomeWork();document.getElementById('newGroup').onclick=()=>openWorkDefinition('herdGroups');document.getElementById('newLabel').onclick=()=>openWorkDefinition('labelDefinitions');document.getElementById('renameWork').onclick=openWorkRename;}
function openWorkDefinition(kind){modal(kind==='herdGroups'?'Nouveau lot':'Nouvelle étiquette',`<div class="field"><label>Nom<input name="name" required maxlength="80"></label></div>`,'Créer',async form=>{const name=String(new FormData(form).get('name')||'').trim();if(!name)throw new Error('Indique un nom.');if(state[kind].some(x=>norm(x.name)===norm(name)))throw new Error('Ce nom existe déjà.');await putGroup([{kind,data:{id:makeID(kind==='herdGroups'?'group':'label'),name}}]);});}
