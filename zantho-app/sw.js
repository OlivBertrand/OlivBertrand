const PREFIX='zantho-shell:'+self.registration.scope+':';
const CACHE=PREFIX+'v066';
const ASSETS=['./app.html','./styles.css','./app1.js?v=0.6.6','./app2a.js?v=0.6.6','./app2b.js','./app3.js?v=0.6.4','./app4.js','./app5.js?v=0.4.0','./app6.js?v=0.4.1','./app7.js?v=0.4.2','./app8.js?v=0.6.6','./app9.js?v=0.6.4','./app10.js?v=0.6.6','./manifest.webmanifest?v=0.6.6','./icon.svg?v=svg1','./apple-touch-icon.png?v=0.6.6','./icon-192.png','./icon-512.png'];
const ALLOWED=new Set(ASSETS.map(path=>new URL(path,self.registration.scope).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key))))
])));
self.addEventListener('fetch',event=>{
  const request=event.request;const url=new URL(request.url);const scope=new URL(self.registration.scope);
  if(request.method!=='GET'||url.origin!==scope.origin||request.headers.has('Authorization')||url.pathname===new URL('./auth.html',scope).pathname)return;
  if(url.pathname===scope.pathname||url.pathname===new URL('./index.html',scope).pathname){
    // Return pages are fetched fresh and never stored, including OAuth callbacks.
    // The cached app remains reachable from an old home-screen shortcut offline.
    if(request.mode==='navigate')event.respondWith((async()=>{
      try{return await fetch(request);}catch{
        const cache=await caches.open(CACHE);return await cache.match(new URL('./app.html',scope).href)||new Response('Zantho indisponible hors ligne.',{status:503});
      }
    })());
    return;
  }
  if(url.pathname===new URL('./auth-return.js',scope).pathname)return;
  const navigation=request.mode==='navigate'&&url.pathname.startsWith(scope.pathname);
  if(!navigation&&!ALLOWED.has(url.href))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);const key=navigation?new URL('./app.html',scope).href:request.url;
    try{const response=await fetch(request);if(response.ok&&!response.redirected)await cache.put(key,response.clone());return response;}
    catch{const saved=await cache.match(key);return saved||new Response('Ressource indisponible hors ligne.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
  })());
});
