const CACHE='zantho-v052';
const ASSETS=[
  './','./index.html','./styles.css',
  './app1.js','./app2a.js','./app2b.js','./app3.js','./app4.js','./app5.js','./app6.js','./app7.js','./app8.js?v=0.5.2',
  './manifest.webmanifest','./icon.svg'
];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
});

self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  ]));
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin) return;
  if(url.pathname==='/auth.html') return;

  if(event.request.mode==='navigate'){
    event.respondWith(
      fetch(event.request,{cache:'no-store'})
        .then(resp=>{
          const copy=resp.clone();
          caches.open(CACHE).then(cache=>cache.put('./index.html',copy));
          return resp;
        })
        .catch(()=>caches.match('./index.html',{ignoreSearch:true}))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(resp=>{
        const copy=resp.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy));
        return resp;
      })
      .catch(()=>caches.match(event.request,{ignoreSearch:true}))
  );
});