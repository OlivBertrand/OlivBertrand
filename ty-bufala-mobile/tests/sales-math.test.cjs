'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../sales-math.js');
test('demi-centime arrondi correctement en arithmétique entière',()=>{
  assert.equal(S.lineTotalCents(1500,101),152);
  assert.equal(S.lineTotalCents(1,500),1);
  assert.equal(S.lineTotalCents(1000,199),199);
});
test('quantité ou prix invalides rejetés',()=>{
  assert.throws(()=>S.lineTotalCents(0,100));
  assert.throws(()=>S.lineTotalCents(1000,-1));
  assert.throws(()=>S.lineTotalCents(2000,Number.MAX_SAFE_INTEGER));
});
test('total transactionnel cohérent et reproductible',()=>{
  const lines=[{quantityMilli:1500,unitPriceCents:101,totalCents:152},{quantityMilli:2000,unitPriceCents:190,totalCents:380}];
  assert.equal(S.saleTotalCents(lines),532);
  assert.throws(()=>S.saleTotalCents([{...lines[0],totalCents:151}]));
});
test('alerte doublon n’empêche pas ventes réelles identiques',()=>{
  const one={id:'sale01',date:'2026-11-14',client:'',channel:'Marché',paymentMethod:'Carte',lines:[{product:'mozza',quantityMilli:1000,unit:'pièce',unitPriceCents:550,totalCents:550}]};
  const two={...one,id:'sale02'};
  assert.deepEqual(S.potentialDuplicates([one],two).map(x=>x.id),['sale01']);
  assert.deepEqual(S.potentialDuplicates([one],{...two,lines:[{...one.lines[0],quantityMilli:2000,totalCents:1100}]}),[]);
});