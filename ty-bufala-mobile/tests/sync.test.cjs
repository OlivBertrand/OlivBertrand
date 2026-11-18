const {test}=require('node:test');
const assert=require('node:assert/strict');
const {IDBFactory}=require('fake-indexeddb');
const {CloudSync}=require('../sync.js');
const {randomUUID}=require('node:crypto');
Object.defineProperty(globalThis,'crypto',{value:{randomUUID},configurable:true});
let online=true,chain=Promise.resolve();
Object.defineProperty(globalThis,'navigator',{value:{get onLine(){return online},locks:{request(_name,fn){const next=chain.then(fn);chain=next.catch(()=>{});return next;}}},configurable:true});
async function database(){const factory=new IDBFactory();return new Promise((resolve,reject)=>{const r=factory.open('device',2);r.onupgradeneeded=()=>{for(const k of ['animals','events','sales','labelDefinitions','animalLabelAssignments','herdGroups','animalGroupAssignments','outbox','meta','conflicts'])r.result.createObjectStore(k,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function device(username){
 const response=await fetch('http://127.0.0.1:8000/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'local-test-only-password'})});assert.equal(response.status,200);
 const session=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];const cloud=new CloudSync(await database(),session.user,session.csrf);
 cloud.request=async(path,options={})=>{const r=await fetch('http://127.0.0.1:8000/api/'+path,{...options,headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':cloud.csrf,...options.headers}});const data=await r.json();if(!r.ok){const error=new Error(data.error);error.status=r.status;error.details=data;throw error;}return data;};await cloud.run();return cloud;
}

test('two accounts, offline recovery, conflicts, durable replay, read-only and API cache isolation',async()=>{
 const a=await device('alice'),b=await device('suzanna');let record=(await a.all('animals'))[0];assert.ok(record);
 // Two offline edits on one record must keep their strict revision order.
 online=false;
 await a.save([{kind:'animals',data:{...record,notes:'offline first'}}]);
 record=(await a.all('animals'))[0];
 await a.save([{kind:'animals',data:{...record,notes:'offline second'}}]);
 assert.equal((await a.all('outbox')).length,2);
 online=true;await a.run();assert.equal(a.error,'');await b.run();
 assert.equal((await b.all('animals'))[0].notes,'offline second');assert.equal((await a.all('outbox')).length,0);
 // Two different devices edit the same base revision.
 const stale=(await b.all('animals'))[0];online=false;
 await b.save([{kind:'animals',data:{...stale,notes:'my conflicting edit'}}]);online=true;
 const latest=(await a.all('animals'))[0];await a.save([{kind:'animals',data:{...latest,notes:'other author'}}]);await a.run();await b.run();
 let blocked=(await b.all('outbox'))[0];assert.equal(blocked.blocked.code,'revision_conflict');
 assert.equal((await b.all('animals'))[0].notes,'my conflicting edit');
 await b.resolve(blocked.id,'local');assert.equal((await b.all('outbox')).length,0);await a.run();
 assert.equal((await a.all('animals'))[0].notes,'my conflicting edit');assert.equal((await b.all('conflicts')).length,1);
 // Simulate server commit followed by a lost HTTP response: immutable op is retried.
 online=false;record=(await a.all('animals'))[0];await a.save([{kind:'animals',data:{...record,notes:'lost response'}}]);
 const pending=(await a.all('outbox'))[0];online=true;
 const first=await a.request('sync',{method:'POST',body:JSON.stringify({operations:pending.operations})});
 await a.run();const current=await a.request('record/animals/'+record.id);assert.equal(current.data.revision,first.receipts[0].revision);assert.equal((await a.all('outbox')).length,0);
 // Rejection must not silently remove the queue.
 online=false;record=(await b.all('animals'))[0];await b.save([{kind:'animals',data:{...record,notes:'abandoned version'}}]);online=true;await b.run();
 blocked=(await b.all('outbox'))[0];assert.ok(blocked.blocked);await b.resolve(blocked.id,'remote');
 assert.equal((await b.all('animals'))[0].notes,'lost response');assert.equal((await b.all('outbox')).length,0);
 online=false;record=(await a.all('animals'))[0];await a.save([{kind:'animals',data:{...record,birthDate:'2025-02-30'}}]);online=true;await a.run();
 let rejected=(await a.all('outbox'))[0];assert.equal(rejected.blocked.status,422);
 record=(await a.all('animals'))[0];await a.save([{kind:'animals',data:{...record,birthDate:'2025-01-01'}}]);await a.run();assert.equal((await a.all('outbox')).length,0);
 assert.ok((await a.all('conflicts')).some(c=>c.choice==='corrected'));
 const reader=await device('reader');await assert.rejects(reader.save([{kind:'animals',data:record}]),/lecture seule/);
 const sw=require('fs').readFileSync(require('path').join(__dirname,'../sw.js'),'utf8');assert.ok(sw.includes("path.startsWith('/api/')"));
 console.log('Validated independent IndexedDB devices and real local authenticated HTTP API; no browser rendering claimed.');
});


test('conflict resolution preserves reference event IDs containing colons',async()=>{
 const cloud=new CloudSync(await database(),{id:'alice',role:'admin'},'csrf-test');
 const id='event:source:introduction';
 const batch={id:'batch-colon',order:1,createdAt:'2026-11-15',blocked:{status:409},operations:[{kind:'events',data:{id},baseRevision:1}]};
 await cloud.transaction(['outbox','events'],tx=>{tx.objectStore('outbox').put(batch);tx.objectStore('events').put({id,description:'local'});});
 const paths=[];
 cloud.request=async path=>{paths.push(path);return {data:{id,description:'remote',revision:2}};};
 await cloud._resolve(batch.id,'remote');
 assert.deepEqual(paths,['record/events/'+encodeURIComponent(id)]);
 assert.equal((await cloud.all('events'))[0].id,id);
 assert.equal((await cloud.all('events'))[0].description,'remote');
 assert.equal((await cloud.all('outbox')).length,0);
});

test('offline label assignments survive client restart and replay across two users',async()=>{
 const a=await device('alice'),b=await device('suzanna'),animal=(await a.all('animals'))[0];
 online=false;
 await a.save([{kind:'labelDefinitions',data:{id:'offline_label',name:'Action hors ligne'}},{kind:'animalLabelAssignments',data:{id:'offline_assignment',animalId:animal.id,labelId:'offline_label',assignedAt:new Date().toISOString()}}]);
 assert.equal((await a.all('outbox')).length,1);
 const restarted=new CloudSync(a.db,a.user,a.csrf);restarted.request=a.request.bind(restarted);
 assert.equal((await restarted.all('animalLabelAssignments')).filter(x=>x.id==='offline_assignment').length,1);
 online=true;await restarted.run();assert.equal(restarted.error,'');await b.run();
 assert.equal((await b.all('animalLabelAssignments')).filter(x=>x.id==='offline_assignment').length,1);
 await restarted.run();assert.equal((await restarted.all('outbox')).length,0);
});

test('incomplete receipts never remove an offline batch',async()=>{
 const a=await device('alice');online=false;
 const record=(await a.all('animals'))[0];await a.save([{kind:'animals',data:{...record,notes:'receipt guard'}}]);
 const batch=(await a.all('outbox'))[0];await assert.rejects(a.accept(batch,[]),/Accusés incomplets/);
 assert.equal((await a.all('outbox')).length,1);online=true;await a.run();assert.equal((await a.all('outbox')).length,0);
});
test('offline catalogue sale keeps Windows identity through local restart and replay',async()=>{
 const phone=await device('suzanna');await phone.run();
 const catalogue=(await phone.all('meta')).find(x=>x.id==='salesCatalogue').value;
 const product=catalogue.products.find(p=>p.ready&&p.inputMode!=='amount');assert.ok(product);
 online=false;
 try{
  await phone.save([{kind:'sales',data:{id:'sale_offline_catalogue',date:'2026-11-17',channel:'À la ferme',paymentMethod:'Espèces',
   lines:[{catalogueId:product.id,catalogueVersion:catalogue.version,catalogueSource:catalogue.sourceId,productId:product.productId,
    product:product.name,unit:product.unit,vatRate:product.vatRate,quantityMilli:2000,unitPriceCents:505,totalCents:1010}]}}]);
  assert.equal((await phone.all('sales')).find(s=>s.id==='sale_offline_catalogue')._sync,'pending');
  const restarted=new CloudSync(phone.db,phone.user,phone.csrf);restarted.request=phone.request.bind(phone);
  online=true;await restarted.run();assert.equal(restarted.error,'');
  const received=(await restarted.all('sales')).find(s=>s.id==='sale_offline_catalogue');
  assert.equal(received._sync,'shared');assert.equal(received.syncState,'pending');assert.equal(received.totalCents,1010);
  assert.equal(received.lines[0].catalogueId,product.id);assert.equal(received.lines[0].productId,product.productId);
  assert.equal(received.lines[0].netCents+received.lines[0].vatCents,1010);
  await restarted.run();assert.equal((await restarted.all('sales')).filter(s=>s.id==='sale_offline_catalogue').length,1);
 }finally{online=true;}
});
