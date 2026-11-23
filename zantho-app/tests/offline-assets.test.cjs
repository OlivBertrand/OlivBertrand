const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const source=n=>fs.readFileSync(path.join(root,n),'utf8').replace(/^\uFEFF/,'');
const scope='https://test.invalid/zantho-app/';
function worker(){
 const handlers={},puts=[],deleted=[],added=[];const bucket={addAll:async x=>added.push(...x),put:async(k,r)=>puts.push([k,r]),match:async()=>undefined};
 const c=vm.createContext({URL,Response,Headers,self:{registration:{scope},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(n,f)=>handlers[n]=f},caches:{open:async()=>bucket,keys:async()=>['cheptel-data','zantho-v064',`zantho-shell:${scope}:v064`],delete:async k=>deleted.push(k)},fetch:async()=>new Response('SYNTHETIC_SHELL')});
 vm.runInContext(source('sw.js'),c);return {c,handlers,puts,deleted,added,bucket};
}
function event(url,mode='cors',method='GET',headers={}){let response;return {request:{url,mode,method,headers:new Headers(headers)},respondWith:p=>response=p,result:()=>response};}
test('iPhone and Android icons are nonempty PNG exports at declared dimensions',()=>{
 for(const [name,size] of [['apple-touch-icon.png',180],['icon-192.png',192],['icon-512.png',512]]){
  const raw=fs.readFileSync(path.join(root,name));assert.equal(raw.subarray(1,4).toString(),'PNG');assert.equal(raw.readUInt32BE(16),size);assert.equal(raw.readUInt32BE(20),size);assert.ok(raw.length>1000);
 }
 const manifest=JSON.parse(source('manifest.webmanifest'));for(const icon of manifest.icons)assert.ok(fs.statSync(path.join(root,icon.src)).size>0);
});
test('touch icon and manifest remain scoped under the app subdirectory',()=>{
 const dom=new JSDOM(source('app.html'),{url:scope});for(const selector of ['link[rel="manifest"]','link[rel="apple-touch-icon"]'])assert.ok(dom.window.document.querySelector(selector).href.startsWith(scope));dom.window.close();
});
test('offline install caches the complete actual eleven-script entry page',async()=>{
 const w=worker();let pending;w.handlers.install({waitUntil:p=>pending=p});await pending;const assets=new Set(w.added.map(x=>new URL(x,scope).href));const dom=new JSDOM(source('app.html'),{url:scope});
 for(const script of dom.window.document.querySelectorAll('script[src]'))assert.ok(assets.has(script.src),script.src);
 assert.ok(w.added.includes('./app.html'));assert.equal(dom.window.document.querySelectorAll('script[src]').length,11);dom.window.close();
});
test('activation preserves every cache outside its exact application namespace',async()=>{const w=worker();let pending;w.handlers.activate({waitUntil:p=>pending=p});await pending;assert.deepEqual(w.deleted,[`zantho-shell:${scope}:v064`]);});
test('Graph, OAuth callback, authorized GET, writes and private routes bypass cache',()=>{
 const w=worker();for(const e of [event('https://graph.microsoft.com/v1.0/me/drive'),event(scope+'auth.html','navigate'),event(scope+'app1.js?v=0.6.6','cors','GET',{Authorization:'FAKE'}),event(scope+'app1.js?v=0.6.6','cors','POST'),event(scope+'api/private')]){w.handlers.fetch(e);assert.equal(e.result(),undefined);}assert.equal(w.puts.length,0);
});
test('offline navigation and versioned script use cached data; missing resource is explicit',async()=>{
 const w=worker();w.c.fetch=async()=>{throw new TypeError('offline');};w.bucket.match=async()=>new Response('SYNTHETIC_SHELL');let e=event(scope,'navigate');w.handlers.fetch(e);assert.equal(await(await e.result()).text(),'SYNTHETIC_SHELL');
 w.bucket.match=async()=>undefined;e=event(scope+'app8.js?v=0.6.6');w.handlers.fetch(e);assert.equal((await e.result()).status,503);
});
test('HTTP failure never poisons a previously good offline cache',async()=>{const w=worker();w.c.fetch=async()=>new Response('failure',{status:503});const e=event(scope+'app8.js?v=0.6.6');w.handlers.fetch(e);assert.equal((await e.result()).status,503);assert.equal(w.puts.length,0);});

async function returnRoute(){return (await import(require('node:url').pathToFileURL(path.join(root,'auth-return.js')).href)).routeMicrosoftReturn;}
function returnContext(hash='',search=''){
 const saved={},navigations=[];let forwarded=0;const label={textContent:''};
 return {saved,navigations,label,get forwarded(){return forwarded;},options:{currentLocation:{hash,search,href:scope+search+hash,replace:url=>navigations.push(url)},storage:{setItem:(key,value)=>saved[key]=value},documentRef:{getElementById:()=>label},loadBridge:async()=>({broadcastResponseToMainFrame:async()=>{forwarded++;}})}};
}
test('root opens the separate application page without processing an authentication response',async()=>{const c=returnContext();const route=await returnRoute();assert.equal((await route(c.options)).status,'opened_app');assert.deepEqual(c.navigations,[scope+'app.html']);assert.equal(c.forwarded,0);assert.deepEqual(c.saved,{});});
test('Microsoft code is forwarded through the bridge without persisting the code or state',async()=>{const c=returnContext('#code=SYNTHETIC_AUTH_CODE&state=SYNTHETIC_STATE');const route=await returnRoute();assert.equal((await route(c.options)).status,'forwarded_response');assert.equal(c.forwarded,1);assert.doesNotMatch(JSON.stringify(c.saved),/SYNTHETIC_AUTH_CODE|SYNTHETIC_STATE/);});
test('Microsoft error response retains only the error category and bounded numeric diagnostics',async()=>{const c=returnContext('#error=server_error&error_description='+encodeURIComponent('AADSTS7000218 user@example.invalid PRIVATE_TOKEN'));const route=await returnRoute();await route(c.options);const stored=JSON.parse(c.saved['zantho-auth-diagnostic-v1']);assert.equal(stored.code,'server_error');assert.deepEqual(stored.aadsts,['AADSTS7000218']);assert.doesNotMatch(JSON.stringify(c.saved),/user@|PRIVATE_TOKEN/);});
test('unavailable session storage cannot prevent the Microsoft bridge from forwarding',async()=>{const c=returnContext('#code=SYNTHETIC_CODE');c.options.storage.setItem=()=>{throw new Error('SYNTHETIC_QUOTA');};const route=await returnRoute();assert.equal((await route(c.options)).status,'forwarded_response');assert.equal(c.forwarded,1);});
test('interrupted bridge shows a recoverable message without logging a raw payload',async()=>{const c=returnContext('#error=server_error');c.options.loadBridge=async()=>{throw new Error('PRIVATE_TOKEN');};const route=await returnRoute();assert.equal((await route(c.options)).status,'interrupted');assert.match(c.label.textContent,/conservées/);assert.doesNotMatch(c.label.textContent,/PRIVATE_TOKEN/);});
test('authentication return pages are never stored in the shell cache',async()=>{const w=worker();let pending;w.handlers.install({waitUntil:p=>pending=p});await pending;assert.ok(!w.added.includes('./index.html'));assert.ok(!w.added.some(name=>name.includes('auth-return')));for(const url of [scope,scope+'index.html']){const e=event(url,'navigate');w.handlers.fetch(e);await e.result();}assert.equal(w.puts.length,0);const bridge=event(scope+'auth-return.js?v=0.6.6');w.handlers.fetch(bridge);assert.equal(bridge.result(),undefined);});
test('old root home-screen URL can open the cached application while offline',async()=>{const w=worker();w.c.fetch=async()=>{throw new TypeError('offline');};w.bucket.match=async key=>{assert.equal(key,scope+'app.html');return new Response('SYNTHETIC_APP');};const e=event(scope,'navigate');w.handlers.fetch(e);assert.equal(await(await e.result()).text(),'SYNTHETIC_APP');assert.equal(w.puts.length,0);});
test('PWA identity is retained and new installed launches target the cached application page',()=>{const manifest=JSON.parse(source('manifest.webmanifest'));assert.equal(manifest.id,'./');assert.equal(manifest.start_url,'./app.html');const entry=new JSDOM(source('index.html'),{url:scope});assert.equal(entry.window.document.querySelectorAll('script').length,1);assert.equal(entry.window.document.querySelector('script').type,'module');assert.ok(entry.window.document.querySelector('script').src.endsWith('auth-return.js?v=0.6.6'));entry.window.close();});
