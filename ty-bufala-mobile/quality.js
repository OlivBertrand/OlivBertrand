/* Ty Bufala Mobile — contrôles déterministes, sans transfert réseau ni données privées. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.TyBufalaQuality=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const tag=x=>String(x||'').trim().toUpperCase().replace(/\s+/g,'');
  const text=x=>String(x||'').trim();
  function isDate(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;
    const [y,m,d]=value.split('-').map(Number),check=new Date(Date.UTC(y,m-1,d));
    return check.getUTCFullYear()===y&&check.getUTCMonth()===m-1&&check.getUTCDate()===d;
  }
  function daysBetween(a,b){
    if(!isDate(a)||!isDate(b))return null;
    return Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000);
  }
  function validateAnimal(animal,animals=[],today='2099-12-31'){
    const errors=[],warnings=[],add=(arr,code,message)=>arr.push({code,message});
    const number=tag(animal?.earTag),birth=animal?.birthDate||'',mother=tag(animal?.motherTag),father=tag(animal?.fatherTag);
    if(!number)add(errors,'ear_tag_required','Le numéro de boucle est obligatoire.');
    if(number&&animals.some(a=>a.id!==animal?.id&&tag(a.earTag)===number))add(errors,'duplicate_tag','Ce numéro de boucle existe déjà.');
    if(number&&mother===number)add(errors,'self_mother','Un animal ne peut pas être sa propre mère.');
    if(number&&father===number)add(errors,'self_father','Un animal ne peut pas être son propre père.');
    if(birth&&!isDate(birth))add(errors,'birth_invalid','Date de naissance invalide.');
    if(isDate(birth)&&isDate(today)&&birth>today)add(errors,'birth_future','La naissance ne peut pas être dans le futur.');
    for(const key of ['lastCalving','expectedCalving','matingDate','exitDate','weaningDate']){
      if(animal?.[key]&&!isDate(animal[key]))add(errors,'invalid_'+key,'Date incorrecte : '+key+'.');
    }
    if(isDate(birth)&&isDate(animal?.lastCalving)&&animal.lastCalving<birth)add(errors,'calving_before_birth','Vêlage avant la naissance de la mère.');
    if(isDate(birth)&&isDate(animal?.exitDate)&&animal.exitDate<birth)add(errors,'exit_before_birth','Sortie avant la naissance.');
    const dam=mother&&animals.find(a=>tag(a.earTag)===mother);
    if(dam){
      if(dam.sex==='M')add(errors,'male_mother','La mère renseignée est identifiée comme mâle.');
      if(isDate(dam.birthDate)&&isDate(birth)&&dam.birthDate>=birth)add(errors,'mother_born_later','La mère ne peut pas être née le même jour ou après son petit.');
    }
    if(animal?.status==='sorti'&&!animal.exitDate)add(warnings,'exit_date_missing','L’animal est sorti, sans date de sortie.');
    if(animal?.status!=='sorti'&&animal?.exitDate)add(warnings,'exit_date_present','Une date de sortie existe alors que le statut est « présent ».');
    return {errors,warnings};
  }
  function descendants(animals,rootId){
    const origin=animals.find(a=>a.id===rootId);if(!origin)return [];
    const byMother=new Map();
    for(const animal of animals){for(const parent of new Set(['mother','father'].map(role=>animal[role+'Id']?'id:'+animal[role+'Id']:'tag:'+tag(animal[role+'Tag'])))){if(parent==='tag:')continue;const list=byMother.get(parent)||[];list.push(animal);byMother.set(parent,list);}}
    const seen=new Set([origin.id]),rows=[],queue=[{tag:'id:'+origin.id,legacy:'tag:'+tag(origin.earTag),depth:0}];
    while(queue.length){const current=queue.shift();for(const child of [...(byMother.get(current.tag)||[]),...(byMother.get(current.legacy)||[])]){
      if(seen.has(child.id))continue;seen.add(child.id);rows.push({animal:child,depth:current.depth+1});
      if(current.depth<30)queue.push({tag:'id:'+child.id,legacy:'tag:'+tag(child.earTag),depth:current.depth+1});
    }}return rows;
  }
  function check(data,today){
    const animals=data.animals||[],events=data.events||[],sales=data.sales||[],issues=[];
    const add=(code,severity,title,animalId='',detail='',date='')=>issues.push({code,severity,title,animalId,detail,date});
    const byTag=new Map(),byId=new Set();
    for(const animal of animals){
      const number=tag(animal.earTag);
      if(byId.has(animal.id))add('duplicate_animal_id','error','Identifiant interne répété',animal.id);
      byId.add(animal.id);
      if(number&&byTag.has(number))add('duplicate_tag','error','Numéro de boucle répété',animal.id,number);
      if(number)byTag.set(number,animal);
    }
    for(const a of animals){
      const number=tag(a.earTag),mother=tag(a.motherTag);
      if(!number)add('missing_tag','error','Numéro de boucle absent',a.id);
      if(a.birthDate&&!isDate(a.birthDate))add('invalid_birth','error','Date de naissance incorrecte',a.id,a.birthDate);
      if(isDate(today)&&isDate(a.birthDate)&&a.birthDate>today)add('future_birth','error','Naissance dans le futur',a.id,a.birthDate);
      if(number&&mother===number)add('self_mother','error','Auto-filiation maternelle',a.id);
      if(number&&tag(a.fatherTag)===number)add('self_father','error','Auto-filiation paternelle',a.id);
      if(mother){
        const m=byTag.get(mother);
        if(!m)add('external_mother','info','Mère non enregistrée dans l’inventaire',a.id,mother);
        else if(m.sex==='M')add('male_mother','error','Mère répertoriée comme mâle',a.id,mother);
        else if(isDate(a.birthDate)&&isDate(m.birthDate)&&m.birthDate>=a.birthDate)add('mother_timeline','error','Chronologie mère/petit impossible',a.id,mother);
      }
      if(!a.birthDate)add('missing_birth','warning','Date de naissance manquante',a.id);
      if(!a.sex)add('missing_sex','warning','Sexe non renseigné',a.id);
      const seen=new Set(),pending=[tag(a.motherTag),tag(a.fatherTag)].filter(Boolean);
      while(pending.length){const key=pending.pop();if(key===number){add('parent_cycle','error','Cycle de filiation',a.id);break;}if(seen.has(key))continue;seen.add(key);const parent=byTag.get(key);if(parent)pending.push(...[tag(parent.motherTag),tag(parent.fatherTag)].filter(Boolean));}
      if(a.status==='sorti'&&!a.exitDate)add('missing_exit','warning','Date de sortie manquante',a.id);
      if(a.status!=='sorti'&&a.exitDate)add('exit_disagreement','warning','Date de sortie mais statut présent',a.id);
      if(isDate(a.exitDate)&&isDate(a.birthDate)&&a.exitDate<a.birthDate)add('early_exit','error','Sortie avant naissance',a.id);
      if(a.status!=='sorti'&&isDate(a.expectedCalving)&&isDate(today)&&a.expectedCalving<today&&(!isDate(a.lastCalving)||a.lastCalving<a.expectedCalving))
        add('calving_prediction_overdue','warning','Prévision de vêlage à confirmer (non diagnostique)',a.id,a.expectedCalving,a.expectedCalving);
    }
    const animalIDs=new Set(animals.map(a=>a.id)),eventIds=new Set();
    for(const e of events){
      if(eventIds.has(e.id))add('duplicate_event','error','Identifiant d’événement répété',e.animalId);
      eventIds.add(e.id);
      if(!animalIDs.has(e.animalId))add('orphan_event','error','Événement sans animal correspondant',e.animalId);
      if(e.date&&!isDate(e.date))add('invalid_event_date','error','Date d’événement incorrecte',e.animalId,e.date);
      if(e.nextDate&&!isDate(e.nextDate))add('invalid_followup_date','error','Date de rappel incorrecte',e.animalId,e.nextDate);
      for(const field of ['milkWithdrawalUntil','meatWithdrawalUntil']){
        if(e[field]&&!isDate(e[field]))add('invalid_withdrawal','error','Date de délai d’attente incorrecte',e.animalId,field);
      }
      if(e.type==='Traitement'&&!text(e.description)&&!text(typeof e.medication==='string'?e.medication:e.medication?.name))add('treatment_unspecified','warning','Traitement sans détail',e.animalId);
    }
    const saleIDs=new Set();
    for(const s of sales){
      if(saleIDs.has(s.id))add('duplicate_sale','error','Identifiant de vente répété','',s.id);
      saleIDs.add(s.id);
      if(!isDate(s.date))add('invalid_sale_date','error','Date de vente incorrecte','',s.id);
      if(!Array.isArray(s.lines)||!s.lines.length)add('empty_sale','error','Vente sans ligne','',s.id);
      for(const l of s.lines||[]){
        const q=l.quantityMilli,p=l.unitPriceCents,t=l.totalCents;
        if(!Number.isSafeInteger(q)||q<=0||!Number.isSafeInteger(p)||p<0||!Number.isSafeInteger(t)||t<0){add('invalid_sale_line','error','Quantité ou prix invalide','',s.id);continue;}
        const expected=(BigInt(q)*BigInt(p)+500n)/1000n;
        if(expected!==BigInt(t))add('incorrect_sale_total','error','Montant de ligne incohérent','',s.id);
      }
    }
    const severityOrder={error:0,warning:1,info:2};
    issues.sort((a,b)=>(severityOrder[a.severity]-severityOrder[b.severity])||a.title.localeCompare(b.title,'fr'));
    return {issues,counts:{error:issues.filter(x=>x.severity==='error').length,warning:issues.filter(x=>x.severity==='warning').length,info:issues.filter(x=>x.severity==='info').length},animals:animals.length,active:animals.filter(a=>a.status==='present').length};
  }
  function importConflicts(existing,incoming){
    const ids=new Map(existing.map(a=>[a.id,a])),tags=new Map(existing.filter(a=>tag(a.earTag)).map(a=>[tag(a.earTag),a]));
    const conflicts=[],incomingTags=new Set(),incomingIds=new Set();
    const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
    for(const a of incoming){if(incomingIds.has(a.id))conflicts.push({code:'duplicate_id_in_import',id:a.id});incomingIds.add(a.id);const k=tag(a.earTag);if(k&&incomingTags.has(k))conflicts.push({code:'duplicate_in_import',tag:k,id:a.id});incomingTags.add(k);
      const sameTag=k&&tags.get(k);if(sameTag&&sameTag.id!==a.id)conflicts.push({code:'same_tag_different_id',tag:k,id:a.id,existingId:sameTag.id});
      const sameId=ids.get(a.id);if(sameId&&tag(sameId.earTag)!==k)conflicts.push({code:'same_id_different_tag',tag:k,id:a.id});
      if(sameId&&String(sameId.updatedAt||'')===String(a.updatedAt||'')&&canonical(sameId)!==canonical(a))conflicts.push({code:'same_revision_different_data',tag:k,id:a.id});
    }return conflicts;
  }
  return Object.freeze({tag,isDate,daysBetween,validateAnimal,descendants,check,importConflicts});
});
