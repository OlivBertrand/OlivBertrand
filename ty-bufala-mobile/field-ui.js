/* Ty Bufala Mobile — saisie terrain étendue : soins, traitements, sorties et entrées.
   Le journal local n'est PAS une preuve de synchronisation OneDrive/Windows. */
(function(){
 'use strict';
 const D=globalThis.TyBufalaField;
 if(!D)throw new Error('TyBufalaField absent');
 const oldAnimalDetail=renderAnimalDetail,oldHome=renderHome;
 const n=v=>String(v??'').trim();
 const safe=v=>esc(v||'');
 const select=(key,values,current)=>`<select name="${key}">${values.map(v=>`<option value="${safe(v)}" ${v===current?'selected':''}>${safe(v)}</option>`).join('')}</select>`;
 const field=(label,fieldName,value='',type='text')=>`<div class="field"><label>${safe(label)}</label><input name="${fieldName}" type="${type}" value="${safe(value)}"></div>`;
 const panel=(which,content)=>`<div class="field-panel" data-event-section="${which}" hidden>${content}</div>`;
 const actorInfo=()=>'Cet enregistrement est local et attend la synchronisation. Il ne remplace pas le registre sanitaire réglementaire.';
 function closeWithError(err){toast('Enregistrement impossible : '+err.message);}
 function compareAndPutEvent(original,next,oldAnimal,nextAnimal){
   return new Promise((resolve,reject)=>{
     let conflict=null;
     const tx=database.transaction(['events','animals'],'readwrite');
     tx.oncomplete=()=>{
       const pos=state.events.findIndex(e=>e.id===next.id);
       if(pos===-1)state.events.push(next);else state.events[pos]=next;
       if(nextAnimal){const i=state.animals.findIndex(a=>a.id===nextAnimal.id);if(i>=0)state.animals[i]=nextAnimal;}
       resolve();
     };
     tx.onerror=()=>reject(conflict||tx.error||new Error('Échec de la transaction.'));
     tx.onabort=()=>reject(conflict||tx.error||new Error('Transaction interrompue.'));
     const eventStore=tx.objectStore('events'),animalStore=tx.objectStore('animals');
     const evReq=eventStore.get(next.id);
     evReq.onsuccess=()=>{
       const dbOld=evReq.result;
       if((dbOld?.updatedAt||null)!==(original?.updatedAt||null)){
         conflict=new Error('Cet événement a été modifié depuis son ouverture. Rouvre la fiche.');tx.abort();return;
       }
       if(!nextAnimal){eventStore.put(next);return;}
       const animalReq=animalStore.get(oldAnimal.id);
       animalReq.onsuccess=()=>{
         if(!animalReq.result||animalReq.result.updatedAt!==oldAnimal.updatedAt){
           conflict=new Error('La fiche animale a changé depuis la saisie. Rouvre-la pour éviter un écrasement.');tx.abort();return;
         }
         eventStore.put(next);animalStore.put(nextAnimal);
       };
     };
   });
 }
 openEventForm=function(animalId,eventId){
   const animal=animalFor(animalId),old=eventId?state.events.find(e=>e.id===eventId):null;
   if(!animal){toast('Animal non trouvé.');return;}
   const type=old?.type||'Observation',med=old?.medication||{},move=old?.movement||{};
   const formBody=`<div class="form-grid"><div class="field"><label>Type d’événement</label>${select('type',D.TYPES,type)}</div>
     ${field('Date de l’événement *','date',old?.date||localToday(),'date')}
     <div class="field wide"><label>Observation / compte rendu</label><textarea name="description" rows="3">${safe(old?.description||'')}</textarea></div>
     ${field('Prochain contrôle ou rappel (facultatif)','nextDate',old?.nextDate||'','date')}
     </div>
     ${panel('treatment',`<h3>Traçabilité du traitement</h3><p class="help">Saisis les informations réelles du traitement. Les délais d’attente ne sont jamais calculés ou inventés par l’application.</p>
       <div class="form-grid">${field('Médicament *','medName',med.name||'')}${field('Dose','medDose',med.dose||'')}
       <div class="field"><label>Unité de dose</label>${select('medUnit',['','ml','mg','g','comprimé(s)','autre'],med.doseUnit||'')}</div>
       <div class="field"><label>Voie</label>${select('medRoute',['','Orale','IM','SC','IV','Intramammaire','Cutanée','Autre'],med.route||'')}</div>
       ${field('Lot médicament','medBatch',med.batch||'')}${field('Vétérinaire / prescripteur','medPrescriber',med.prescriber||'')}${field('Administré par','medActor',med.administeredBy||'')}
       ${field('Fin délai d’attente lait (si connu)','milkWithdrawalUntil',old?.milkWithdrawalUntil||'','date')}
       ${field('Fin délai d’attente viande (si connu)','meatWithdrawalUntil',old?.meatWithdrawalUntil||'','date')}</div>
       <p class="help">Une date non renseignée signifie « à vérifier », pas « aucun délai ».</p>`)}
     ${panel('movement',`<h3>Informations de mouvement</h3><div class="form-grid">${field('Motif / nature','movementReason',move.reason||'')}${field('Destination / origine / parcelle','movementDestination',move.destination||'')}</div><p class="help">Une sortie conserve la fiche et l’historique, sans suppression. Une entrée ultérieure est enregistrée comme un nouvel événement.</p>`)}
     <p class="help">${actorInfo()}</p>`;
   const {form}=modal(old?'Corriger un événement':'Enregistrer un événement',formBody,'Enregistrer',async form=>{
     const fd=new FormData(form),stamp=nowISO(),event=D.formRecord({
       animalId,type:n(fd.get('type')),date:n(fd.get('date')),
       description:n(fd.get('description')),nextDate:n(fd.get('nextDate')),
       medication:{name:n(fd.get('medName')),dose:n(fd.get('medDose')),doseUnit:n(fd.get('medUnit')),route:n(fd.get('medRoute')),batch:n(fd.get('medBatch')),prescriber:n(fd.get('medPrescriber')),administeredBy:n(fd.get('medActor'))},
       milkWithdrawalUntil:n(fd.get('milkWithdrawalUntil')),meatWithdrawalUntil:n(fd.get('meatWithdrawalUntil')),
       movement:{reason:n(fd.get('movementReason')),destination:n(fd.get('movementDestination'))},
       createdAt:stamp,updatedAt:stamp
     },old,old?.id||makeID('event'));
     const check=D.validate(event,animal,old);
     if(check.errors.length)throw new Error(check.errors.join(' '));
     if(check.warnings.length&&!confirm('Points à vérifier :\n'+check.warnings.join('\n')+'\n\nEnregistrer quand même ?'))return false;
     const updated=D.projectAnimal(animal,event,old);
     const updatedAnimal=updated?{...updated,updatedAt:stamp}:null;
     if(updatedAnimal){
       const validation=globalThis.TyBufalaQuality?.validateAnimal(updatedAnimal,state.animals,localToday());
       if(validation?.errors.length)throw new Error(validation.errors[0].message);
       if(['Sortie','Décès','Entrée'].includes(event.type)&&!confirm(`Mettre à jour la situation de ${displayAnimal(animal)} (${event.type.toLowerCase()}) ?`))return false;
     }
     await compareAndPutEvent(old,event,animal,updatedAnimal);
     toast('Événement enregistré localement. Synchronisation à effectuer.');
   });
   const chooser=form.querySelector('[name="type"]');
   const updatePanels=()=>{
     const t=chooser.value;
     form.querySelector('[data-event-section="treatment"]').hidden=t!=='Traitement';
     form.querySelector('[data-event-section="movement"]').hidden=!['Entrée','Sortie','Décès','Changement de parcelle','Changement de lot'].includes(t);
   };
   chooser.addEventListener('change',updatePanels);updatePanels();
 };
 function treatmentSummary(e){
   const status=D.treatmentStatus(e,localToday()),med=e.medication?.name||e.description||'Médicament non précisé';
   const flags=[];
   if(status.needsReview)flags.push('<span class="badge warn">Délais incomplets</span>');
   if(status.datesInFuture)flags.push('<span class="badge danger">Délai en cours — vérifier</span>');
   return `<div class="field-health-row"><strong>${safe(med)}</strong><span>${dateFR(e.date)}</span>${flags.join('')}
   ${e.medication?.dose?`<small>Dose : ${safe(e.medication.dose)} ${safe(e.medication.doseUnit)}</small>`:''}
   ${e.milkWithdrawalUntil?`<small>Lait : date renseignée ${dateFR(e.milkWithdrawalUntil)}</small>`:'<small>Lait : information non renseignée</small>'}
   ${e.meatWithdrawalUntil?`<small>Viande : date renseignée ${dateFR(e.meatWithdrawalUntil)}</small>`:'<small>Viande : information non renseignée</small>'}
   </div>`;
 }
 renderAnimalDetail=function(id){
   const result=oldAnimalDetail(id),animal=animalFor(id);
   if(!animal)return result;
   const treatments=state.events.filter(e=>e.animalId===id&&e.type==='Traitement').sort((a,b)=>b.date.localeCompare(a.date));
   if(!treatments.length)return result;
   const item=document.createElement('section');item.className='field-health card';
   item.innerHTML=`<h2>Soins et délais d’attente déclarés</h2><div class="note info">Données saisies par les utilisateurs : absence de date ≠ absence de délai. Vérifier toute commercialisation auprès des documents vétérinaires applicables.</div>${treatments.slice(0,8).map(treatmentSummary).join('')}`;
   const base=app.querySelector('.card');base?.insertAdjacentElement('afterend',item);
   return result;
 };
 renderHome=function(){
   const result=oldHome();
   const today=localToday();
   const unconfirmed=[];
   for(const a of activeAnimals()){
     for(const e of state.events){
       if(e.animalId!==a.id||e.type!=='Traitement')continue;
       const s=D.treatmentStatus(e,today);
       if(s.needsReview||s.datesInFuture)unconfirmed.push({a,e,s});
     }
   }
   if(!unconfirmed.length)return result;
   const el=document.createElement('section');el.className='field-health card';
   el.innerHTML=`<h2>Vigilance traitements (${unconfirmed.length})</h2><p class="help">Informations vétérinaires à vérifier avant d’utiliser ou de commercialiser les produits. Ne constitue pas une décision de libération du lait ou de la viande.</p>${unconfirmed.slice(0,6).map(({a,e})=>`<button class="tile field-health-link" data-health-animal="${safe(a.id)}"><div><strong>${safe(displayAnimal(a))} · ${safe(e.medication?.name||'Traitement')}</strong><small>${dateFR(e.date)} — vérifier les délais renseignés</small></div><span class="arrow">›</span></button>`).join('')}`;
   app.append(el);
   el.querySelectorAll('[data-health-animal]').forEach(button=>button.addEventListener('click',()=>{nav('herd');ui.animalId=button.dataset.healthAnimal;render();}));
   return result;
 };
})();