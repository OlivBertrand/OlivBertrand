/* Présentation uniquement : les faits, révisions et reçus restent inchangés. */
(function(root,factory){const kit=factory();if(typeof module==='object'&&module.exports)module.exports=kit;else root.TyBufalaUI=kit;})(globalThis,function(){
 'use strict';
 const GROUP_COLORS=['#477A64','#477E91','#8B6AA4','#BB7849','#A15E79','#587AB0','#8B8745','#478C83','#A66B58','#73749E','#577A45','#9A704A'];
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function groupColor(group){if(/^#[0-9a-f]{6}$/i.test(group?.color||''))return group.color.toUpperCase();let hash=2166136261;for(const char of String(group?.id||''))hash=Math.imul(hash^char.codePointAt(0),16777619)>>>0;return GROUP_COLORS[hash%GROUP_COLORS.length];}
 function tint(color,amount=.9){color=groupColor({color});return '#'+[1,3,5].map(i=>Math.round(parseInt(color.slice(i,i+2),16)*(1-amount)+255*amount).toString(16).padStart(2,'0')).join('').toUpperCase();}
 function groupStyle(group){const color=groupColor(group);return `--group-color:${color};--group-tint:${tint(color)}`;}
 function eventTone(type){if(['Vêlage','Entrée','Sortie'].includes(type))return 'life';if(type==='Changement de lot')return 'group';if(['Traitement','Vaccination','Soins','Maladie','Vermifuge','Intervention','Analyse','Blessure'].includes(type))return 'health';return 'repro';}
 function dateLabel(value){return /^\d{4}-\d{2}-\d{2}$/.test(value||'')?`${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}`:'Date inconnue';}
 function certainty(event){if(event.cancelled)return 'Annulé';return ({confirmed:'Confirmé',planned:'Prévu'})[event.confirmation]||'À confirmer';}
 function monthLabel(value){return /^\d{4}-\d{2}-\d{2}$/.test(value||'')?new Date(value+'T12:00:00').toLocaleDateString('fr-FR',{month:'long',year:'numeric'}):'Sans date précise';}
 function timeline(events,expanded=[]){let previous='';return events.map(event=>{
  const month=monthLabel(event.date),heading=month!==previous?`<h3 class="timeline-month">${escape(month)}</h3>`:'';previous=month;
  const result=({positive:'Pleine',negative:'Vide',uncertain:'Indéterminé'})[event.result]||event.result||'';
  const description=String(event.description||'');
  return heading+`<article class="timeline-event tone-${eventTone(event.type)} ${event.cancelled?'is-cancelled':''}"><span class="timeline-node" aria-hidden="true"></span><div class="timeline-date">${dateLabel(event.date)}</div><details class="timeline-card" data-timeline-id="${escape(event.id)}" ${expanded.includes(event.id)?'open':''}><summary><span class="timeline-event-title">${escape(event.type)}${result?` <span class="event-result">${escape(result)}</span>`:''}</span><span class="event-certainty ${event.confirmation==='confirmed'?'':'is-unconfirmed'}">${certainty(event)}</span>${description?`<span class="timeline-preview">${escape(description.length>95?description.slice(0,92)+'…':description)}</span>`:''}<span class="timeline-expand" aria-hidden="true">⌄</span></summary><div class="timeline-expanded">${description?`<p class="event-notes">${escape(description)}</p>`:''}${event.nextDate?`<p class="event-next">Prochain suivi · ${dateLabel(event.nextDate)}</p>`:''}${event.medication?`<p>${escape(event.medication)} · ${escape(event.dose||'')} · ${escape(event.route||'')}</p><p class="small-note">Attente lait : ${escape(event.milkWithdrawalDays??'à préciser')} j · viande : ${escape(event.meatWithdrawalDays??'à préciser')} j</p>`:''}<div class="timeline-actions"><button type="button" class="btn secondary small" data-event="${escape(event.id)}">Modifier</button>${!event.cancelled?`<button type="button" class="btn ghost small" data-cancel-event="${escape(event.id)}">Annuler</button>`:''}</div><details class="event-provenance"><summary>Traçabilité</summary><p>${event.author?'Saisi par '+escape(event.author):'Auteur non renseigné'}${event.source?' · '+escape(typeof event.source==='string'?event.source:'Source historique'):''}</p></details></div></details></article>`;
 }).join('');}
 function syncStatus({conflict=false,running=false,pending=0,online=true,error=false,confirmed=false}={}){if(conflict)return {label:'À comparer',tone:'alert'};if(error)return {label:'À vérifier',tone:'alert'};if(!online)return {label:pending?`${pending} à envoyer`:'Hors connexion',tone:'offline'};if(pending)return {label:`${pending} à envoyer`,tone:'waiting'};if(running)return {label:'Mise à jour…',tone:'waiting'};return confirmed?{label:'À jour',tone:'ready'}:{label:'Connexion…',tone:'waiting'};}
 const MANAGEMENT_GROUPS=Object.freeze([
  {id:'lactating',label:'En lactation',icon:'◒',color:'#477A64'},
  {id:'dry',label:'Taries',icon:'☾',color:'#8B6AA4'},
  {id:'heifer',label:'Génisses',icon:'❧',color:'#BB7849'},
  {id:'male',label:'Mâles',icon:'♂',color:'#477E91'},
  {id:'bull',label:'Taureaux',icon:'♉',color:'#A15E79'},
  {id:'unclassified',label:'À classer',icon:'?',color:'#927644'}
 ].map(Object.freeze));
 function managementGroup(a){
  if(a?.sex==='M')return a.maleRole==='breeding_bull'?'bull':'male';
  if(a?.sex==='F'){
   if(['lactating','dry'].includes(a.productionStatus))return a.productionStatus;
   if(a.reproductiveStatus==='heifer'&&!a.lastCalving)return 'heifer';
  }
  return 'unclassified';
 }
 function classificationPlan(animals,events,ids,target,today,{reviewHeifers=false}={}){
  const category=MANAGEMENT_GROUPS.find(g=>g.id===target&&g.id!=='unclassified');
  if(!category)throw new Error('Choisis un des cinq classements.');
  const unique=[...new Set(ids)];if(!unique.length)throw new Error('Coche au moins un animal.');
  const selected=unique.map(id=>animals.find(a=>a.id===id));
  for(const a of selected){
   const sex=['male','bull'].includes(target)?'M':'F';
   if(!a||a.status!=='present'||(a.sex&&a.sex!==sex))throw new Error('Ce classement ne correspond pas au sexe ou à la présence des animaux cochés.');
   if(['lactating','dry'].includes(target)&&a.birthDate){
    const months=(+today.slice(0,4)- +a.birthDate.slice(0,4))*12+(+today.slice(5,7)- +a.birthDate.slice(5,7))-(today.slice(8)<a.birthDate.slice(8)?1:0);
    if(months<12)throw new Error('Un animal de moins de 12 mois ne peut pas être en lactation ou tari.');
   }
   if(target==='heifer'&&(a.lastCalving||events.some(e=>e.animalId===a.id&&e.type==='Vêlage'&&!e.cancelled&&e.confirmation==='confirmed')))throw new Error('Un vêlage est connu : vérifier la fiche avant de déclarer une génisse.');
   if(['lactating','dry'].includes(target)&&a.reproductiveStatus==='heifer'&&!reviewHeifers)throw new Error('Confirme le changement des génisses déjà classées.');
  }
  return selected.filter(a=>managementGroup(a)!==target).map(a=>{
   const data={...a};
   if(['male','bull'].includes(target)){data.sex='M';data.maleRole=target==='bull'?'breeding_bull':'other';}
   else if(target==='heifer'){Object.assign(data,{sex:'F',reproductiveStatus:'heifer',productionStatus:'',productionStatusDate:''});}
   else{Object.assign(data,{sex:'F',productionStatus:target,productionStatusDate:today});if(data.reproductiveStatus==='heifer')data.reproductiveStatus='calved';}
   return {data,description:'Classement actuel confirmé : '+category.label+'. Date de début non renseignée.'};
  });
 }
 return {GROUP_COLORS,groupColor,tint,groupStyle,eventTone,dateLabel,certainty,timeline,syncStatus,escape,MANAGEMENT_GROUPS,managementGroup,classificationPlan};
});
