'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Q=require('../quality.js');
const A={id:'a',earTag:' FR 001 ',name:'Violette',sex:'F',birthDate:'2020-01-01',status:'present'};
const B={id:'b',earTag:'FR002',name:'Vinka',motherTag:'FR001',sex:'F',birthDate:'2024-01-01',status:'present'};
const C={id:'c',earTag:'FR003',motherTag:'FR002',sex:'F',birthDate:'2026-01-01',status:'present'};
const today='2026-11-14';
test('dates calendaires strictes',()=>{
  assert.equal(Q.isDate('2024-02-29'),true);
  assert.equal(Q.isDate('2025-02-29'),false);
  assert.equal(Q.isDate('2026-13-01'),false);
  assert.equal(Q.isDate('2026-11-14'),true);
  assert.equal(Q.daysBetween('2026-11-16',today),2);
});
test('filiation multi-generations, parent inconnu tolere',()=>{
  assert.deepEqual(Q.descendants([A,B,C],'a').map(x=>[x.animal.id,x.depth]),[['b',1],['c',2]]);
  assert.deepEqual(Q.descendants([{...A,motherTag:'FR003'},B,C],'a').map(x=>x.animal.id),['b','c']);
  assert.equal(Q.validateAnimal({...B,motherTag:'FR999'},[A,B,C],today).errors.length,0);
});
test('anti-doublon et chronology',()=>{
  assert.equal(Q.validateAnimal({...B,earTag:'fr 001'},[A,B,C],today).errors.some(x=>x.code==='duplicate_tag'),true);
  assert.equal(Q.validateAnimal({...B,motherTag:'FR002'},[A,B,C],today).errors.some(x=>x.code==='self_mother'),true);
  assert.equal(Q.validateAnimal({...B,birthDate:'2027-01-01'},[A,B,C],today).errors.some(x=>x.code==='birth_future'),true);
});
test('reference Excel: previsions a confirmer, pas de diagnostic',()=>{
  const report=Q.check({animals:[{...A,expectedCalving:'2026-11-01'}],events:[],sales:[]},today);
  assert.equal(report.issues.some(x=>x.code==='calving_prediction_overdue'),true);
  assert.equal(Q.check({animals:[{...A,expectedCalving:'2026-11-01',lastCalving:'2026-11-03'}],events:[],sales:[]},today).issues.length,0);
});
test('vérification arithmétique ligne vente',()=>{
  const sale={id:'sale-1',date:today,lines:[{quantityMilli:1500,unitPriceCents:101,totalCents:152}]};
  assert.equal(Q.check({animals:[],events:[],sales:[sale]},today).counts.error,0);
  const bad={...sale,lines:[{...sale.lines[0],totalCents:151}]};
  assert.equal(Q.check({animals:[],events:[],sales:[bad]},today).issues.some(x=>x.code==='incorrect_sale_total'),true);
});
test('import contradictoire refuse avant ecriture',()=>{
  const changes=Q.importConflicts([A,B],[{id:'other',earTag:'FR001',updatedAt:'2026-11-15'}]);
  assert.equal(changes[0].code,'same_tag_different_id');
  assert.equal(Q.importConflicts([A],[{...A}]).length,0);
});
test('evenements orphelins detectes',()=>{
  const issues=Q.check({animals:[A],events:[{id:'event-1',animalId:'missing',type:'Traitement',date:today}],sales:[]},today).issues;
  assert.equal(issues.some(x=>x.code==='orphan_event'),true);
});
test('descendance paternelle et collisions d’identifiants internes',()=>{
 const father={...A,id:'p',earTag:'P001',sex:'M'};
 const child={...B,fatherTag:'P001',motherTag:''};
 assert.equal(Q.descendants([father,child],'p')[0].animal.id,'b');
 assert.ok(Q.importConflicts([],[A,{...A,earTag:'different'}]).some(x=>x.code==='duplicate_id_in_import'));
 assert.equal(Q.importConflicts([A],[Object.fromEntries(Object.entries(A).reverse())]).length,0);
});

test('un cycle est une anomalie, un parent extérieur une information',()=>{
 const report=Q.check({animals:[{...A,motherTag:'FR003'},B,C]},today);
 assert.ok(report.issues.some(i=>i.code==='parent_cycle'&&i.severity==='error'));
 const outside=Q.check({animals:[{...B,motherTag:'EXTERIEUR'}]},today);
 assert.ok(outside.issues.some(i=>i.code==='external_mother'&&i.severity==='info'));
});
test('filiation stable après correction des boucles, sans rattachement par ancien numéro',()=>{
 const mother={...A,earTag:'FR999'};
 const calf={...B,motherId:'a',motherTag:'FR001'};
 const grandchild={...C,motherId:'b'};
 const other={id:'other',earTag:'FR001',sex:'F',status:'present'};
 assert.deepEqual(Q.descendants([mother,calf,grandchild,other],'a').map(x=>x.animal.id),['b','c']);
 assert.deepEqual(Q.descendants([mother,calf,grandchild,other],'other'),[]);
});
