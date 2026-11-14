'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const sync=require('../sync-core.js');
const sale={id:'sale-0001',date:'2026-11-14',lines:[{product:'Mozzarella',quantityMilli:2000,unitPriceCents:500,totalCents:1000}],cancelled:false};
const make=(id='op-0001',baseRevision=0,data=sale)=>({opId:id,entity:'sales',entityId:data.id,deviceId:'android-001',baseRevision,data});
test('la répétition réseau n’ajoute jamais deux ventes',()=>{
  const store=sync.newStore(),op=make();
  const first=sync.applyBatch(store,[op],'suzanna-001')[0],retry=sync.applyBatch(store,[op],'suzanna-001')[0];
  assert.equal(first.status,'accepted');assert.equal(retry.status,'duplicate');
  assert.equal(Object.keys(store.data.sales).length,1);assert.equal(store.history.length,1);
  assert.equal(retry.serverRevision,1);
});
test('un identifiant de transmission ne peut pas être réutilisé pour une autre vente',()=>{
  const store=sync.newStore();sync.applyBatch(store,[make()],'suzanna-001');
  assert.equal(sync.applyBatch(store,[make('op-0001',0,{...sale,client:'Marie'})],'suzanna-001')[0].status,'rejected');
  assert.equal(store.history.length,1);
});
test('versions concurrentes détectées et conservées',()=>{
  const store=sync.newStore();sync.applyBatch(store,[make()],'suzanna-001');
  const stale=sync.applyBatch(store,[make('op-0002',0,{...sale,client:'Concurrent'})],'user-002')[0];
  assert.equal(stale.status,'conflict');assert.equal(stale.serverRevision,1);
  assert.equal(store.history.length,1);assert.equal(store.data.sales[sale.id].client,undefined);
  const update=sync.applyBatch(store,[make('op-0003',1,{...sale,client:'Validé'})],'user-002')[0];
  assert.equal(update.status,'accepted');assert.equal(update.serverRevision,2);assert.equal(store.history.length,2);
});
test('paiements et annulation restent des mises à jour, pas de nouvelle vente',()=>{
  const store=sync.newStore();sync.applyBatch(store,[make()],'suzanna-001');
  const result=sync.applyBatch(store,[make('op-0004',1,{...sale,cancelled:true})],'suzanna-001')[0];
  assert.equal(result.status,'accepted');assert.equal(Object.keys(store.data.sales).length,1);
  assert.equal(store.data.sales[sale.id].cancelled,true);
});
test('contrôle strict en centimes et utilisateur authentifié',()=>{
  const store=sync.newStore(),bad=make('op-bad',0,{...sale,lines:[{...sale.lines[0],totalCents:999}]});
  assert.equal(sync.applyBatch(store,[bad],'suzanna-001')[0].status,'rejected');
  assert.equal(sync.applyBatch(store,[make()],'')[0].status,'rejected');
  assert.equal(store.history.length,0);
});
test('le journal incrémental conserve l’ordre des opérations',()=>{
  const store=sync.newStore();sync.applyBatch(store,[make('op-0001'),make('op-0002',1,{...sale,client:'Bonjour'})],'suzanna-001');
  const page=sync.pull(store,0,1);assert.equal(page.changes.length,1);assert.equal(page.cursor,1);assert.equal(page.hasMore,true);
  const following=sync.pull(store,page.cursor);assert.equal(following.changes.length,1);assert.equal(following.hasMore,false);
});