/* Ty Bufala Mobile — domaine événements d'élevage (sans dépendance réseau). */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.TyBufalaField=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TYPES=['Observation','Reproduction','Saillie','Insémination','Diagnostic de gestation','Vêlage','Naissance','Avortement','Tarissement','Sevrage','Soins / santé','Traitement','Vaccination','Analyse','Pesée','Changement de lot','Changement de parcelle','Entrée','Sortie','Décès','Autre'];
  const EFFECT_TYPES=new Set(['Vêlage','Sortie','Décès','Entrée']);
  const isDate=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;const [y,m,d]=s.split('-').map(Number),z=new Date(Date.UTC(y,m-1,d));return z.getUTCFullYear()===y&&z.getUTCMonth()===m-1&&z.getUTCDate()===d;};
  const trimmed=s=>String(s??'').trim();
  const copy=x=>JSON.parse(JSON.stringify(x));
  function validate(event,animal,previous=null){
    const errors=[],warnings=[];
    if(!animal||event.animalId!==animal.id)errors.push('Animal introuvable pour cet événement.');
    if(!TYPES.includes(event.type))errors.push('Type d’événement non reconnu.');
    if(!isDate(event.date))errors.push('Date d’événement invalide.');
    if(event.nextDate&&!isDate(event.nextDate))errors.push('Date de rappel invalide.');
    if(animal?.birthDate&&isDate(animal.birthDate)&&isDate(event.date)&&event.date<animal.birthDate)errors.push('Événement antérieur à la naissance de l’animal.');
    if(previous&&EFFECT_TYPES.has(previous.type)&&previous.type!==event.type)errors.push('Pour modifier un événement de mouvement ou de vêlage, conserve son type et corrige sa date ou son détail. Pour un changement de type, utilise une correction de fiche contrôlée.');
    if(event.type==='Vêlage'&&animal?.sex==='M')errors.push('Un animal identifié mâle ne peut pas avoir de vêlage.');
    if(event.type==='Traitement'){
      if(!trimmed(event.medication?.name))errors.push('Le nom du médicament est requis pour un traitement.');
      if(event.medication?.dose&&!trimmed(event.medication?.doseUnit))warnings.push('Dose saisie sans unité : à compléter.');
      if(!event.milkWithdrawalUntil||!event.meatWithdrawalUntil)warnings.push('Un ou plusieurs délais d’attente ne sont pas renseignés : vérifier auprès du vétérinaire ou de la notice.');
      for(const [key,label] of [['milkWithdrawalUntil','lait'],['meatWithdrawalUntil','viande']]){
        const date=event[key];
        if(date&&!isDate(date))errors.push('Date de fin de délai '+label+' invalide.');
        else if(date&&isDate(event.date)&&date<event.date)errors.push('La fin de délai '+label+' ne peut pas précéder le traitement.');
      }
    }
    if((event.type==='Sortie'||event.type==='Décès')&&!trimmed(event.movement?.reason))warnings.push('Motif de sortie non précisé.');
    if(event.type==='Entrée'&&animal?.status==='sorti'&&animal.exitDate&&event.date<animal.exitDate)errors.push('La date de réentrée ne peut pas précéder la dernière date de sortie.');
    if(event.type==='Entrée'&&animal?.status==='sorti'&&animal.exitReason==='Décès')errors.push('Réentrée après décès déclarée : faire une correction contrôlée du dossier avant de réactiver cet animal.');
    return {errors,warnings};
  }
  function projectAnimal(animal,event,previous=null){
    const a=copy(animal);let changed=false;
    // Une correction historique ne peut pas remplacer une projection plus récente.
    if(previous && event.type==='Vêlage' && a.lastCalvingEventId!==event.id)return null;
    if(previous && ['Sortie','Décès','Entrée'].includes(event.type) && a.movementEventId!==event.id)return null;
    if(['Sortie','Décès','Entrée'].includes(event.type) && a.lastMovementDate && a.lastMovementDate>event.date && a.movementEventId!==event.id)return null;
    if(event.type==='Vêlage'){
      const pointer=a.lastCalvingEventId;
      if(pointer===event.id || !a.lastCalving || event.date>=a.lastCalving){
        a.lastCalving=event.date;a.lastCalvingEventId=event.id;changed=true;
        if(a.expectedCalving&&a.expectedCalving<=event.date){a.expectedCalving='';changed=true;}
      }
    }else if(event.type==='Sortie'||event.type==='Décès'){
      if(a.status!=='sorti'||a.movementEventId===event.id||!a.exitDate||event.date>=a.exitDate){
        a.status='sorti';a.exitDate=event.date;a.exitReason=trimmed(event.movement?.reason)||event.type;
        a.movementEventId=event.id;a.lastMovementDate=event.date;changed=true;
      }
    }else if(event.type==='Entrée'){
      // Un événement de retour est un événement distinct : l'ancienne sortie reste dans l'historique.
      if(a.status==='sorti'||a.movementEventId===event.id){
        a.status='present';a.exitDate='';a.exitReason='';a.movementEventId=event.id;a.lastMovementDate=event.date;changed=true;
      }
    }
    return changed?a:null;
  }
  function formRecord(raw,old=null,id=''){
    const event={...(old||{}),id:old?.id||id,animalId:trimmed(raw.animalId),type:trimmed(raw.type),date:trimmed(raw.date),description:trimmed(raw.description),nextDate:trimmed(raw.nextDate),createdAt:old?.createdAt||raw.createdAt,updatedAt:raw.updatedAt||new Date().toISOString(),syncState:'pending',source:'mobile'};
    if(event.type==='Traitement'){
      event.medication={name:trimmed(raw.medication?.name),dose:trimmed(raw.medication?.dose),doseUnit:trimmed(raw.medication?.doseUnit),route:trimmed(raw.medication?.route),batch:trimmed(raw.medication?.batch),prescriber:trimmed(raw.medication?.prescriber),administeredBy:trimmed(raw.medication?.administeredBy)};
      event.milkWithdrawalUntil=trimmed(raw.milkWithdrawalUntil);
      event.meatWithdrawalUntil=trimmed(raw.meatWithdrawalUntil);
    }else{delete event.medication;delete event.milkWithdrawalUntil;delete event.meatWithdrawalUntil;}
    if(['Entrée','Sortie','Décès','Changement de parcelle','Changement de lot'].includes(event.type))event.movement={reason:trimmed(raw.movement?.reason),destination:trimmed(raw.movement?.destination)};
    else delete event.movement;
    if(old){
      // Journal de corrections conservé intégralement avec la fiche exportée.
      const prev=copy(old);delete prev.history;
      event.history=[...(old.history||[]),{correctedAt:event.updatedAt,previous:prev}];
    }
    return event;
  }
  function treatmentStatus(event,today){
    if(event.type!=='Traitement')return null;
    if(!isDate(today))throw new Error('Date de référence invalide.');
    const fields=['milkWithdrawalUntil','meatWithdrawalUntil'];
    const missing=fields.filter(k=>!event[k]);
    const active=fields.filter(k=>isDate(event[k])&&event[k]>=today);
    return {missing,active,needsReview:missing.length>0,datesInFuture:active.length>0};
  }
  return Object.freeze({TYPES,isDate,validate,projectAnimal,formRecord,treatmentStatus});
});