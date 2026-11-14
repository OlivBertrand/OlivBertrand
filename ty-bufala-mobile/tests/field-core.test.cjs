'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const F=require('../field-core.js');
const animal={id:'animal-001',earTag:'FR01',name:'Violette',sex:'F',birthDate:'2020-02-01',status:'present',updatedAt:'2026-11-14T00:00:00Z'};
function event(type,changes={}){return {id:'event-001',animalId:animal.id,type,date:'2026-11-14',description:'Exemple',nextDate:'',...changes};}
test('traitement complet sans délai inventé',()=>{
  const e=F.formRecord({...event('Traitement'),medication:{name:'Médicament de test',dose:'2',doseUnit:'ml',route:'IM'},milkWithdrawalUntil:'',meatWithdrawalUntil:''},null,'event-001');
  assert.equal(F.validate(e,animal).errors.length,0);
  assert.ok(F.validate(e,animal).warnings.some(w=>w.includes('délais')));
  assert.equal(F.treatmentStatus(e,'2026-11-14').needsReview,true);
  assert.equal(e.medication.dose,'2');
});
test('traitement refusé sans médicament et avec délai antérieur',()=>{
  const e=event('Traitement',{medication:{name:''},milkWithdrawalUntil:'2026-11-13'});
  const errors=F.validate(e,animal).errors;
  assert.ok(errors.some(x=>x.includes('nom du médicament')));
  assert.ok(errors.some(x=>x.includes('précéder le traitement')));
});
test('délais future présents n’autorisent aucune libération automatique',()=>{
  const e=event('Traitement',{medication:{name:'X'},milkWithdrawalUntil:'2026-11-16',meatWithdrawalUntil:'2026-11-20'});
  assert.deepEqual(F.treatmentStatus(e,'2026-11-14').active,['milkWithdrawalUntil','meatWithdrawalUntil']);
  assert.equal(F.treatmentStatus(e,'2026-11-20').datesInFuture,true);
  assert.equal(F.treatmentStatus(e,'2026-11-21').datesInFuture,false);
});
test('sortie change situation sans supprimer l’animal',()=>{
  const a=F.projectAnimal(animal,event('Sortie',{movement:{reason:'Vente',destination:'Autre ferme'}}));
  assert.equal(a.status,'sorti');assert.equal(a.exitDate,'2026-11-14');assert.equal(a.exitReason,'Vente');
  assert.equal(a.id,animal.id);assert.equal(animal.status,'present');
});
test('réentrée conserve l’historique de sortie',()=>{
  const exited=F.projectAnimal(animal,event('Sortie',{date:'2026-11-05',movement:{reason:'Transfert'}}));
  const back=event('Entrée',{id:'event-002',date:'2026-11-14'});
  const a=F.projectAnimal(exited,back);
  assert.equal(a.status,'present');assert.equal(a.exitDate,'');assert.equal(a.movementEventId,'event-002');
  assert.equal(F.validate(back,exited).errors.length,0);
  assert.ok(F.validate(event('Entrée',{date:'2026-11-01'}),exited).errors.length);
});
test('vêlage réel remplace uniquement une prévision ancienne',()=>{
  const a=F.projectAnimal({...animal,expectedCalving:'2026-11-11'},event('Vêlage',{date:'2026-11-14'}));
  assert.equal(a.lastCalving,'2026-11-14');assert.equal(a.expectedCalving,'');
  const prior=F.projectAnimal({...animal,lastCalving:'2026-11-10'},event('Vêlage',{date:'2026-11-08'}));
  assert.equal(prior,null);
});
test('correction datée conserve une copie de la version précédente',()=>{
  const e=F.formRecord({...event('Observation'),createdAt:'2026-11-14T12:00:00Z',updatedAt:'2026-11-14T12:00:00Z'},null,'event-001');
  const revised=F.formRecord({...e,description:'Nouvelle observation',updatedAt:'2026-11-14T13:00:00Z'},e,'event-001');
  assert.equal(revised.history.length,1);
  assert.equal(revised.history[0].previous.description,'Exemple');
  assert.equal(revised.description,'Nouvelle observation');
  assert.equal(revised.syncState,'pending');
  assert.ok(!('history' in revised.history[0].previous));
});
test('type d’événement à effet interdit à modifier silencieusement',()=>{
  const old=event('Sortie');const changed=event('Observation');
  assert.ok(F.validate(changed,animal,old).errors.some(x=>x.includes('conserve son type')));
});
test('événement avant naissance et vêlage masculin refusés',()=>{
  assert.ok(F.validate(event('Observation',{date:'2019-01-01'}),animal).errors.length);
  assert.ok(F.validate(event('Vêlage'),{...animal,sex:'M'}).errors.length);
});

test('modifier une ancienne sortie ne réécrit pas une réentrée ultérieure',()=>{
 const exited=F.projectAnimal(animal,event('Sortie',{date:'2026-10-01',movement:{reason:'Vente'}}));
 const back=F.projectAnimal(exited,event('Entrée',{id:'entry-01',date:'2026-11-14'}));
 const revision=event('Sortie',{date:'2026-10-02',movement:{reason:'Vente'}});
 assert.equal(F.projectAnimal(back,revision,event('Sortie',{date:'2026-10-01'})),null);
 assert.equal(back.status,'present');
});
test('réentrée après décès déclaré ne se fait pas automatiquement',()=>{
 const dead=F.projectAnimal(animal,event('Décès',{date:'2026-11-10',movement:{reason:'Décès'}}));
 assert.ok(F.validate(event('Entrée'),dead).errors.some(x=>x.includes('décès')));
});