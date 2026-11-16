/* Reproductive facts are distinct from plans and imported predictions. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.TyBufalaReproduction=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const TYPES=['Vue en chaleur','Saillie naturelle','Insémination','Mise avec taureau','Retrait du taureau','Échographie','Diagnostic de gestation','Contrôle de gestation prévu','Avortement','Vêlage','Naissance de veau mort-né','Problème de reproduction','Autre événement reproductif'];
 const category=e=>TYPES.includes(e.type)||['Saillie','Naissance','Mise à la reproduction (historique)','Prévision de vêlage (Excel)'].includes(e.type)?'reproduction':['Traitement','Vaccination','Intervention','Analyse','Maladie','Blessure'].includes(e.type)?'health':['Tarissement','Mise en lactation','Sevrage'].includes(e.type)?'production':e.type==='Changement de lot'?'groups':'other';
 const timeline=(events,filter='all')=>events.filter(e=>!e.cancelled&&(filter==='all'||category(e)===filter)).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')||String(a.id).localeCompare(String(b.id)));
 function summary(events,today){
  const facts=timeline(events).filter(e=>e.confirmation==='confirmed'&&e.date&&e.date<=today&&!e.dateUnknown);
  const latest=types=>facts.find(e=>types.includes(e.type));
  const decisive=facts.filter(e=>['Vue en chaleur','Saillie','Saillie naturelle','Insémination','Avortement','Vêlage','Naissance de veau mort-né','Échographie','Diagnostic de gestation'].includes(e.type));
  const statusOf=e=>['Échographie','Diagnostic de gestation'].includes(e.type)?({positive:'positive',negative:'negative',uncertain:'uncertain'}[e.result]||'uncertain'):['Avortement','Vêlage','Naissance de veau mort-né'].includes(e.type)?'ended':'unconfirmed';
  const newest=decisive[0],sameDay=newest?decisive.filter(e=>e.date===newest.date):[];
  const conflict=new Set(sameDay.map(statusOf)).size>1;
  const stale=newest&&(Date.parse(today)-Date.parse(newest.date))/86400000>365;
  const status=!newest||conflict||stale?'uncertain':statusOf(newest);
  const labels={positive:'Gestation confirmée à cette date',negative:'Vide au dernier diagnostic',ended:'Gestation terminée',unconfirmed:'Gestation non confirmée',uncertain:'À confirmer'};
  return {status,label:labels[status],date:newest?.date||'',conflict,stale,heat:latest(['Vue en chaleur']),mating:latest(['Saillie','Saillie naturelle','Insémination']),diagnosis:latest(['Échographie','Diagnostic de gestation']),calving:latest(['Vêlage','Naissance de veau mort-né']),next:events.filter(e=>e.nextDate&&e.nextDate>=today).sort((a,b)=>a.nextDate.localeCompare(b.nextDate))[0]};
 }
 return Object.freeze({TYPES,category,timeline,summary});
});
