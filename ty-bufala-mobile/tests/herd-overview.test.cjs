'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const H=require('./herd-overview.js');
const today='2026-11-16';
const animal=(id,sex,birth,fields={})=>({id,sex,birthDate:birth,status:'present',...fields});
test('one animal -> one exclusive category; exits excluded',()=>{
 const arr=[
  animal('cow-milk','F','2021-05-01',{productionStatus:'lactating',reproductiveStatus:'calved'}),
  animal('cow-dry','F','2019-01-01',{productionStatus:'dry',reproductiveStatus:'calved'}),
  animal('heifer','F','2024-02-01',{reproductiveStatus:'heifer'}),
  animal('calf-f','F','2026-04-01'),
  animal('young-m','M','2025-11-01'),
  animal('bull','M','2020-02-02',{maleRole:'breeding_bull'}),
  animal('other-m','M','2020-02-02'),
  animal('uncertain-f','F','2020-02-02',{lastCalving:'2024-01-02'}),
  animal('unknown-f','F','2020-02-02'),
  animal('unknown','',''),
  animal('exited','F','2020-01-01',{status:'sorti',productionStatus:'lactating'}),
 ];
 const s=H.summarize(arr,today);
 assert.equal(s.total,10);
 assert.deepEqual(Object.fromEntries(Object.entries(s.counts)),{
  lactating:1,dry:1,heifers:1,youngFemales:1,youngMales:1,breedingBulls:1,adultMales:1,calvedUnknown:1,femaleUnknown:1,unknown:1
 });
 assert.equal(s.unclassified,4);
 assert.equal(Object.values(s.counts).reduce((a,b)=>a+b,0),s.total);
 assert.deepEqual(s.members.dry,['cow-dry']);
});
test('no classification from estimated calving date or lactation potential',()=>{
 const a=animal('x','F','2020-01-01',{expectedCalving:'2026-12-01',lactationPotentialRaw:'oui',lastCalving:'2025-01-01'});
 assert.equal(H.classify(a,today),'calvedUnknown');
 assert.equal(H.classify({...a,productionStatus:'dry'},today),'dry');
});
test('strict birth anniversary including 12 and 24 months',()=>{
 assert.equal(H.ageMonths('2025-11-16',today),12);
 assert.equal(H.ageMonths('2024-11-16',today),24);
 assert.equal(H.classify(animal('f','F','2025-11-16'),today),'femaleUnknown');
 assert.equal(H.classify(animal('m','M','2024-11-16'),today),'adultMales');
 assert.equal(H.classify(animal('n','F','2025-11-17'),today),'youngFemales');
 assert.equal(H.ageMonths('2026-02-29',today),null);
 assert.equal(H.ageMonths('2027-01-01',today),null);
});
test('heifer with known last calving is never silently labelled heifer',()=>{
 const a=animal('f','F','2022-01-01',{reproductiveStatus:'heifer',lastCalving:'2025-01-01'});
 assert.equal(H.classify(a,today),'calvedUnknown');
 assert.match(H.validateAnimalCategory(a,today),/génisse/);
});
test('validation rejects inconsistent sex, lactation and tampered values',()=>{
 assert.match(H.validateAnimalCategory(animal('m','M','2020-01-01',{productionStatus:'dry'}),today),/femelle/);
 assert.match(H.validateAnimalCategory(animal('f','F','2020-01-01',{maleRole:'breeding_bull'}),today),/mâles/);
 assert.match(H.validateAnimalCategory(animal('f','F','2026-05-01',{productionStatus:'lactating'}),today),/moins de 12 mois/);
 assert.match(H.validateAnimalCategory(animal('f','F','2020-01-01',{productionStatus:'bogus'}),today),/non reconnu/);
 assert.equal(H.validateAnimalCategory(animal('f','F','2020-01-01',{reproductiveStatus:'heifer'}),today),'');
 assert.equal(H.validateAnimalCategory(animal('m','M','2020-01-01',{maleRole:'breeding_bull'}),today),'');
});
test('status change / offline local edits reflect immediately in counters',()=>{
 const a=animal('a','F','2021-01-01',{productionStatus:'dry',reproductiveStatus:'calved'});
 assert.equal(H.summarize([a],today).counts.dry,1);
 const changed={...a,productionStatus:'lactating'};
 assert.equal(H.summarize([changed],today).counts.lactating,1);
 assert.equal(H.summarize([{...changed,status:'sorti',exitDate:today}],today).total,0);
});