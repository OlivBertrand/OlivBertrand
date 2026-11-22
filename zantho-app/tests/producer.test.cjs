const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {IDBFactory}=require('fake-indexeddb');
const {Blob,File}=require('node:buffer');
const root=path.join(__dirname,'..');
const source=name=>fs.readFileSync(path.join(root,name),'utf8').replace(/^\uFEFF/,'');
function lab(t){
 const dom=new JSDOM(source('index.html'),{url:'https://zantho-test.invalid/',runScripts:'outside-only'});const w=dom.window;t.after(()=>dom.window.close());
 const logs=[],timers=[],urls=[],revoked=[];let storageFails=false,metaFails=false;
 const nativeSet=w.Storage.prototype.setItem;
 w.Storage.prototype.setItem=function(key,value){if((storageFails&&key==='zantho-state-v1')||(metaFails&&key==='zantho-sync-meta-v2'))throw new Error('SYNTHETIC_QUOTA');return nativeSet.call(this,key,value);};
 w.Blob=Blob;w.File=File;w.indexedDB=new IDBFactory();w.alert=()=>{};w.confirm=()=>true;
 w.console.error=(...args)=>logs.push(args);w.console.warn=(...args)=>logs.push(args);
 w.URL.createObjectURL=()=>{const url=`blob:synthetic-${urls.length}`;urls.push(url);return url;};w.URL.revokeObjectURL=url=>revoked.push(url);
 w.setTimeout=(fn,delay)=>{timers.push([fn,delay]);return timers.length;};w.clearTimeout=()=>{};w.setInterval=()=>1;w.clearInterval=()=>{};
 w.HTMLMediaElement.prototype.play=async()=>{};
 w.fetch=async()=>{throw new Error('Unexpected transport');};
 for(const script of w.document.querySelectorAll('script[src]'))vm.runInContext(source(path.basename(new URL(script.src).pathname)),dom.getInternalVMContext(),{filename:path.basename(new URL(script.src).pathname)});
 w.zAccessToken=async()=> 'SYNTHETIC_TOKEN';w.zEnsureAppRoot=async()=>({id:'SYNTHETIC_APPROOT'});
 const state=()=>w.eval('state');state().settings.clientId='SYNTHETIC_CLIENT';state().settings.syncEnabled=false;state().settings.lastSync='2026-11-19T12:00:00.000Z';
 return {w,dom,state,logs,timers,urls,revoked,storageFails:v=>storageFails=v,metaFails:v=>metaFails=v};
}
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function photo(l,id='photo_test',options={}){
 const p={id,plantId:l.state().plants[0].id,name:'synthetic.heic',type:'image/heic',blob:new Blob(['SYNTHETIC_IMAGE_BYTES'],{type:'image/heic'}),note:'Test only',createdAt:new Date(Date.now()-1000).toISOString(),synced:false,...options};await l.w.putPhoto(p);return p;
}
function graph(l,custom=()=>null){
 const calls=[];l.w.fetch=async(url,options={})=>{calls.push({url,options});const r=await custom(url,options);if(r)return r;if(!options.method)return response({},404);return response({id:'SYNTHETIC_ACK'});};return calls;
}
function capture(l,file){
 const parent=l.w.openModal('<h2>Parent fictif</h2>');l.w.openPhotoCapture(l.state().plants[0].id,parent);const form=l.w.document.querySelector('#photoForm');const input=form.querySelector('#existingPhoto');Object.defineProperty(input,'files',{value:[file],configurable:true});input.onchange();return form;
}
const submit=form=>form.onsubmit({preventDefault(){},target:form});
test('runs current producer with automatic AppFolder sync and photo editing intact',t=>{
 const l=lab(t);assert.equal(l.w.eval('APP_VERSION'),'0.6.5');assert.equal(l.w.eval('Z_SYNC_SCOPE.join()'),'Files.ReadWrite.AppFolder');assert.equal(typeof l.w.openPhotoDetail,'function');assert.equal(typeof l.w.markDeleted,'function');assert.ok(l.timers.some(x=>x[1]===2500));
});
test('photo format preserves HEIC and repairs legacy empty-MIME defaults',t=>{
 const {w}=lab(t);assert.equal(w.photoFormat(new File(['x'],'image.HEIC')).ext,'heic');assert.equal(w.photoFormat({name:'image.heic',type:'image/jpeg',blob:new Blob(['x'])}).type,'image/heic');assert.equal(w.photoFormat({name:'image.jpg',type:'image/webp'}).ext,'webp');
});
test('transaction commit preserves exact original bytes and abort rejects',async t=>{
 const l=lab(t);const p=await photo(l);assert.equal(await (await l.w.getPhoto(p.id)).blob.text(),'SYNTHETIC_IMAGE_BYTES');const real=l.w.photoDB;
 l.w.photoDB=async()=>{const db=await real();return {close:()=>db.close(),transaction:(...a)=>{const tx=db.transaction(...a);queueMicrotask(()=>tx.abort());return tx;}};};await assert.rejects(photo(l,'aborted'));l.w.photoDB=real;assert.equal(await l.w.getPhoto('aborted'),null);
});
test('camera selection retry after storage failure retains one photo ID',async t=>{
 const l=lab(t);const form=capture(l,new File(['SYNTHETIC'],'capture.heic',{type:'image/heic'}));l.storageFails(true);await submit(form);assert.equal((await l.w.getAllPhotos()).length,1);assert.match(form.textContent,/conservée/);l.storageFails(false);await submit(form);assert.equal((await l.w.getAllPhotos()).length,1);assert.equal(l.state().photoRefs.length,1);
});
test('camera form double click creates one durable record',async t=>{
 const l=lab(t);const form=capture(l,new File(['SYNTHETIC'],'capture.heic',{type:'image/heic'}));await Promise.all([submit(form),submit(form)]);assert.equal((await l.w.getAllPhotos()).length,1);
});
test('late camera permission response closes tracks after modal closes',async t=>{
 const l=lab(t);let release;let stopped=0;Object.defineProperty(l.w.navigator,'mediaDevices',{value:{getUserMedia:()=>new Promise(r=>release=r)}});
 l.w.openPhotoCapture(l.state().plants[0].id,{remove(){}});l.w.document.querySelector('#photoForm').closest('.modal-backdrop').remove();await Promise.resolve();release({getTracks:()=>[{stop:()=>stopped++}]});await new Promise(r=>setImmediate(r));assert.equal(stopped,1);
});
test('empty original is never acknowledged as saved',async t=>{
 const l=lab(t);const form=capture(l,new File([],'empty.heic',{type:'image/heic'}));await submit(form);assert.equal((await l.w.getAllPhotos()).length,0);assert.match(form.textContent,/impossible/);
});
test('HEIC upload is acknowledged only after remote JSON write',async t=>{
 const l=lab(t);await photo(l);const calls=graph(l);const result=await l.w.zRunSync({interactive:true});assert.equal(result.status,'ok');const upload=calls.find(x=>x.options.method==='PUT'&&x.url.includes('photo-photo_test.heic'));
 assert.ok(upload);assert.equal(upload.options.headers['Content-Type'],'image/heic');assert.equal(await upload.options.body.text(),'SYNTHETIC_IMAGE_BYTES');assert.notEqual(l.state().settings.lastSync,'2026-11-19T12:00:00.000Z');
});
test('photo upload failure preserves pending record and old lastSync',async t=>{
 const l=lab(t);await photo(l);graph(l,(u,o)=>o.method==='PUT'&&u.includes('photo-photo_test')?response({},503):null);assert.equal((await l.w.zRunSync()).status,'error');assert.equal((await l.w.getPhoto('photo_test')).synced,false);assert.equal(l.state().settings.lastSync,'2026-11-19T12:00:00.000Z');
});
test('JSON failure preserves photo acknowledgement and retry does not upload twice',async t=>{
 const l=lab(t);await photo(l);let fail=true;const calls=graph(l,(u,o)=>o.method==='PUT'&&u.includes('zantho-data.json')&&fail?response({},503):null);
 assert.equal((await l.w.zRunSync()).status,'error');assert.equal((await l.w.getPhoto('photo_test')).synced,true);assert.equal(l.state().settings.lastSync,'2026-11-19T12:00:00.000Z');
 fail=false;assert.equal((await l.w.zRunSync()).status,'ok');assert.equal(calls.filter(x=>x.options.method==='PUT'&&x.url.includes('photo-photo_test')).length,1);
});
test('failed photo pull is partial, retaining reference and previous success date',async t=>{
 const l=lab(t);const remote=structuredClone(l.w.zRemotePayload());remote.photoRefs=[{id:'remote',plantId:l.state().plants[0].id,drivePath:'photo-remote.heic',type:'image/heic',createdAt:new Date().toISOString()}];graph(l,(u,o)=>!o.method&&u.includes('zantho-data.json')?response(remote):null);
 const result=await l.w.zRunSync();assert.equal(result.status,'partial');assert.equal(l.state().photoRefs.length,1);assert.equal(l.state().settings.lastSync,'2026-11-19T12:00:00.000Z');
});
test('new local edit during JSON write survives and remains pending',async t=>{
 const l=lab(t);graph(l,(u,o)=>{if(o.method==='PUT'&&u.includes('zantho-data.json')){l.state().observations.push({id:'LOCAL_LATER',createdAt:new Date().toISOString()});l.w.save();}return null;});const r=await l.w.zRunSync();assert.equal(r.status,'partial');assert.equal(r.changed,true);assert.equal(l.state().observations[0].id,'LOCAL_LATER');
});
test('busy sync has only one token acquisition and transport owner',async t=>{
 const l=lab(t);graph(l);let release;let count=0;l.w.zAccessToken=()=>{count++;return new Promise(r=>release=r);};const a=l.w.zRunSync();assert.equal((await l.w.zRunSync()).status,'busy');release('FAKE');await a;assert.equal(count,1);
});
test('offline and authentication failure do not leak token-shaped errors',async t=>{
 const l=lab(t);Object.defineProperty(l.w.navigator,'onLine',{value:false,configurable:true});assert.equal((await l.w.zRunSync()).status,'offline');Object.defineProperty(l.w.navigator,'onLine',{value:true});l.w.zAccessToken=async()=>{throw new Error('FAKE_SECRET_MUST_STAY_PRIVATE');};assert.equal((await l.w.zRunSync()).status,'error');assert.equal(l.logs.length,0);assert.doesNotMatch(l.w.localStorage.getItem('zantho-sync-meta-v2'),/FAKE_SECRET/);
});
test('failed local deletion never reuploads a tombstoned photo',async t=>{
 const l=lab(t);const p=await photo(l);l.state().deleted.photoRefs=[{id:p.id,deletedAt:new Date(Date.now()+1000).toISOString(),drivePath:'photo-photo_test.heic'}];l.w.deletePhotoLocal=async()=>{throw new Error('synthetic failure');};const calls=graph(l);await l.w.zSyncPhotos('FAKE');assert.equal(calls.filter(x=>x.options.method==='PUT').length,0);
});
test('a newer restored photo is not deleted by an older tombstone',async t=>{
 const l=lab(t);const p=await photo(l,'restored',{updatedAt:new Date().toISOString(),synced:true,drivePath:'photo-restored.heic'});l.state().photoRefs=[{...p,blob:undefined}];l.state().deleted.photoRefs=[{id:p.id,deletedAt:new Date(Date.now()-10000).toISOString(),drivePath:p.drivePath}];const calls=graph(l);await l.w.zSyncPhotos('FAKE');assert.ok(await l.w.getPhoto(p.id));assert.equal(calls.filter(x=>x.options.method==='DELETE').length,0);
});
test('photo reference arriving on final remote reread stays pending until downloaded',async t=>{
 const l=lab(t);let reads=0;const remote=structuredClone(l.w.zRemotePayload());remote.photoRefs=[{id:'late-remote',plantId:l.state().plants[0].id,drivePath:'photo-late.heic',type:'image/heic',createdAt:new Date().toISOString()}];
 graph(l,(url,o)=>{if(!o.method&&url.includes('zantho-data.json'))return ++reads===1?response({},404):response(remote);return null;});
 const r=await l.w.zRunSync();assert.equal(r.status,'partial');assert.equal(r.pending,1);assert.equal(await l.w.getPhoto('late-remote'),null);assert.equal(l.state().settings.lastSync,'2026-11-19T12:00:00.000Z');
});
test('retake discards late camera stream from superseded acquisition',async t=>{
 const l=lab(t);const releases=[];const stopped=[];Object.defineProperty(l.w.navigator,'mediaDevices',{value:{getUserMedia:()=>new Promise(r=>releases.push(r))}});
 l.w.openPhotoCapture(l.state().plants[0].id,{remove(){}});const form=l.w.document.querySelector('#photoForm');form.querySelector('#retakePhoto').onclick();
 releases[1]({getTracks:()=>[{stop:()=>stopped.push('current')}]});await new Promise(r=>setImmediate(r));releases[0]({getTracks:()=>[{stop:()=>stopped.push('obsolete')}]});await new Promise(r=>setImmediate(r));assert.deepEqual(stopped,['obsolete']);form.closest('.modal-backdrop').remove();await new Promise(r=>setImmediate(r));assert.ok(stopped.includes('current'));
});
test('remote photo deletion failure is partial and cannot advance lastSuccess',async t=>{
 const l=lab(t);l.state().deleted.photoRefs=[{id:'deleted',deletedAt:new Date().toISOString(),drivePath:'photo-deleted.heic'}];
 graph(l,(url,o)=>o.method==='DELETE'?response({},503):null);const result=await l.w.zRunSync();assert.equal(result.status,'partial');assert.equal(result.failed,1);assert.equal(l.state().settings.lastSync,'2026-11-19T12:00:00.000Z');assert.equal(l.state().deleted.photoRefs.length,1);
});
test('metadata storage error releases busy flag and allows a clean retry',async t=>{
 const l=lab(t);graph(l);l.metaFails(true);assert.equal((await l.w.zRunSync()).status,'error');assert.equal(l.w.eval('zSyncBusy'),false);l.metaFails(false);assert.equal((await l.w.zRunSync()).status,'ok');
});
test('local state failure after cloud acknowledgement keeps prior lastSync until retry',async t=>{
 const l=lab(t);await photo(l);const calls=graph(l);l.storageFails(true);assert.equal((await l.w.zRunSync()).status,'error');assert.equal(l.state().settings.lastSync,'2026-11-19T12:00:00.000Z');l.storageFails(false);assert.equal((await l.w.zRunSync()).status,'ok');assert.equal(calls.filter(x=>x.options.method==='PUT'&&x.url.includes('photo-photo_test')).length,1);
});
test('note edited during upload is preserved by atomic acknowledgement',async t=>{
 const l=lab(t);const p=await photo(l);graph(l,async(url,o)=>{
  if(o.method==='PUT'&&url.includes('photo-photo_test')){const current=await l.w.getPhoto(p.id);current.note='NEWER_LOCAL_NOTE';current.updatedAt=new Date().toISOString();await l.w.putPhoto(current);l.state().photoRefs=l.w.zMergeById(l.state().photoRefs,[{...current,blob:undefined}]);l.w.save();}
  return null;
 });await l.w.zRunSync();assert.equal((await l.w.getPhoto(p.id)).note,'NEWER_LOCAL_NOTE');assert.equal(l.state().photoRefs[0].note,'NEWER_LOCAL_NOTE');
});
test('deletion during upload never resurrects the photo and records cleanup path',async t=>{
 const l=lab(t);const p=await photo(l);let deleted=false;const calls=graph(l,async(url,o)=>{
  if(!deleted&&o.method==='PUT'&&url.includes('photo-photo_test')){deleted=true;await l.w.openPhotoDetail(p.id,p.plantId);await l.w.document.querySelector('#deletePhoto').onclick();}
  return null;
 });assert.equal((await l.w.zRunSync()).status,'partial');assert.equal(await l.w.getPhoto(p.id),null);assert.equal(l.state().photoRefs.length,0);assert.equal(l.state().deleted.photoRefs[0].drivePath,'photo-photo_test.heic');assert.equal((await l.w.zRunSync()).status,'ok');assert.equal(calls.filter(x=>x.options.method==='DELETE').length,1);
});
