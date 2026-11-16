'use strict';
/* Durable, account-scoped IndexedDB outbox. Receipts commit with the local record. */
class CloudSync {
 constructor(db, user, csrf) { this.db=db;this.user=user;this.csrf=csrf;this.running=false;this.error='';this.onchange=()=>{}; }
 all(store) {return new Promise((resolve,reject)=>{const tx=this.db.transaction(store),r=tx.objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);});}
 transaction(stores,fn){return new Promise((resolve,reject)=>{const tx=this.db.transaction(stores,'readwrite');try{fn(tx);}catch(e){tx.abort();reject(e);return;}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Écriture interrompue'));});}
 async request(path, options={}) { const response=await fetch('/api/'+path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json','X-CSRF-Token':this.csrf||'',...options.headers}});const data=await response.json();if(!response.ok){const error=new Error(data.error||'Serveur indisponible');error.status=response.status;error.details=data;throw error;}return data; }
 async lock(fn){if(!navigator.locks)throw new Error('Ce navigateur ne permet pas la synchronisation sûre entre onglets. Utiliser Chrome Android ou un navigateur récent.');return navigator.locks.request('tb-sync-'+this.user.id,fn);}
 async save(records){return this.lock(()=>this._save(records));}
 async _save(records) {
  if(this.user.role==='reader')throw new Error('Compte en lecture seule.');
  const queued=(await this.all('outbox')).sort((a,b)=>(a.order||0)-(b.order||0));
  const blocked=queued.find(b=>b.blocked),correction=blocked&&(blocked.blocked.status===422||blocked.blocked.code==='duplicate_tag')?blocked:null;
  if(blocked&&!correction)throw new Error('Résoudre le conflit dans Données avant une nouvelle saisie.');
  if(correction){const keys=new Set(correction.operations.map(o=>o.kind+':'+o.data.id));if(records.some(r=>!keys.has(r.kind+':'+r.data.id)))throw new Error('Corriger d’abord la saisie rejetée depuis Données.');if(queued.filter(b=>b.order>correction.order).some(b=>b.operations.some(o=>keys.has(o.kind+':'+o.data.id))))throw new Error('Des modifications suivantes dépendent de cette saisie. Comparer et conserver une version depuis Données avant de reprendre.');}

  let device=(await this.all('meta')).find(x=>x.id==='device')?.value;if(!device){device='device_'+crypto.randomUUID();await this.transaction(['meta'],tx=>tx.objectStore('meta').put({id:'device',value:device}));}
  const id='batch_'+crypto.randomUUID(), createdAt=new Date().toISOString(),order=Math.max(Date.now(),...queued.map(b=>(b.order||0)+1));
  const operations=records.map(({kind,data})=>{const {_sync,revision,author,changedAt,...clean}=data;delete clean._localRevision;return {opId:'op_'+crypto.randomUUID(),kind,deviceId:device,baseRevision:data._localRevision??revision??0,data:clean};});
  if(correction){
   const replacements=new Map(operations.map(o=>[o.kind+':'+o.data.id,o]));
   const fixed=correction.operations.map(o=>{const replacement=replacements.get(o.kind+':'+o.data.id);return replacement?{...replacement,baseRevision:o.baseRevision}:{...o,opId:'op_'+crypto.randomUUID()};});
   await this.transaction([...new Set(records.map(r=>r.kind)),'outbox','conflicts'],tx=>{
    tx.objectStore('conflicts').put({id:'correction_'+crypto.randomUUID(),resolvedAt:createdAt,choice:'corrected',batch:correction});
    records.forEach(({kind,data})=>{const o=fixed.find(o=>o.kind===kind&&o.data.id===data.id);tx.objectStore(kind).put({...data,_localRevision:o.baseRevision+1,_sync:'pending'});});
    tx.objectStore('outbox').put({...correction,blocked:null,operations:fixed});
   });this.onchange();this.run().catch(()=>{});return;
  }
  await this.transaction([...new Set(records.map(r=>r.kind)),'outbox'],tx=>{
   records.forEach(({kind,data},i)=>tx.objectStore(kind).put({...data,_localRevision:operations[i].baseRevision+1,_sync:'pending'}));
   tx.objectStore('outbox').put({id,operations,createdAt,order});
  });
  this.onchange();this.run().catch(()=>{});
 }
 async accept(batch,receipts) {
  const queued=await this.all('outbox'),later=queued.filter(b=>b.id!==batch.id);
  await this.transaction([...new Set(receipts.map(r=>r.kind)),'outbox'],tx=>{
   for(const r of receipts) {
    const pending=later.some(b=>b.operations.some(o=>o.kind===r.kind&&o.data.id===r.id));
    if(!pending)tx.objectStore(r.kind).put({...r.data,_sync:'shared'});
   }
   tx.objectStore('outbox').delete(batch.id);
  });
 }
 async pull() {
  const meta=(await this.all('meta')).find(x=>x.id==='cursor');let cursor=meta?.value||0,more=true;
  while(more){const result=await this.request('changes?after='+cursor),pending=await this.all('outbox');
   await this.transaction([...this.db.objectStoreNames].filter(k=>!['outbox','conflicts'].includes(k)),tx=>{
    for(const change of result.changes){if(!pending.some(b=>b.operations.some(o=>o.kind===change.kind&&o.data.id===change.data.id)))tx.objectStore(change.kind).put({...change.data,_sync:'shared'});}
    tx.objectStore('meta').put({id:'cursor',value:result.cursor});
   });cursor=result.cursor;more=result.hasMore;
  }
 }
 async run(){return this.lock(()=>this._run());}
 async _run() {
  if(this.running||!navigator.onLine)return;
  this.running=true;this.error='';this.onchange();
  try {
   const session=await this.request('session');if(session.user.id!==this.user.id)throw new Error('Le compte connecté a changé. Recharger avant de synchroniser.');this.csrf=session.csrf;
   let batches=(await this.all('outbox')).sort((a,b)=>(a.order||0)-(b.order||0)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
   for(const batch of batches){if(batch.blocked)break;
    try {const result=await this.request('sync',{method:'POST',body:JSON.stringify({operations:batch.operations})});await this.accept(batch,result.receipts);}
    catch(error){if(error.status===409||error.status===422){await this.transaction(['outbox'],tx=>tx.objectStore('outbox').put({...batch,blocked:{...error.details,status:error.status}}));}throw error;}
   }
   await this.pull();
  } catch(error){this.error=error.message;}
  finally{this.running=false;this.onchange();}
 }
 async resolve(batchId,choice){await this.lock(()=>this._resolve(batchId,choice));await this.run();this.onchange();}
 async _resolve(batchId,choice) {
  const batches=(await this.all('outbox')).sort((a,b)=>(a.order||0)-(b.order||0)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  const batch=batches.find(b=>b.id===batchId);if(!batch?.blocked)throw new Error('Conflit introuvable.');
  const history={id:'conflict_'+crypto.randomUUID(),resolvedAt:new Date().toISOString(),choice,batch};
  if(choice==='local'){
   const deltas=new Map();
   for(const op of batch.operations){const current=await this.request('record/'+op.kind+'/'+encodeURIComponent(op.data.id));deltas.set(op.kind+':'+op.data.id,(current.data?.revision||0)-op.baseRevision);}
   const updated=batches.map(b=>({...b,blocked:b.id===batchId?null:b.blocked,operations:b.operations.map(o=>({...o,opId:'op_'+crypto.randomUUID(),baseRevision:o.baseRevision+(deltas.get(o.kind+':'+o.data.id)||0)}))}));
   await this.transaction(['outbox','conflicts'],tx=>{tx.objectStore('conflicts').put(history);for(const b of updated)tx.objectStore('outbox').put(b);});
  } else {
   // A dependent group is also removed as a whole, preserving atomic birth/mother edits.
   const keys=new Set(batch.operations.map(o=>o.kind+':'+o.data.id)),removed=[];
   for(const b of batches){if(b.operations.some(o=>keys.has(o.kind+':'+o.data.id))){removed.push(b);for(const o of b.operations)keys.add(o.kind+':'+o.data.id);}}
   const remote=[];for(const key of keys){const separator=key.indexOf(':'),kind=key.slice(0,separator),id=key.slice(separator+1);remote.push({kind,id,...await this.request('record/'+kind+'/'+encodeURIComponent(id))});}
   history.removed=removed;
   await this.transaction([...this.db.objectStoreNames],tx=>{tx.objectStore('conflicts').put(history);for(const b of removed)tx.objectStore('outbox').delete(b.id);for(const r of remote){if(r.data)tx.objectStore(r.kind).put({...r.data,_sync:'shared'});else tx.objectStore(r.kind).delete(r.id);}});
  }
  this.onchange();
 }
}
if(typeof module!=='undefined')module.exports={CloudSync};
