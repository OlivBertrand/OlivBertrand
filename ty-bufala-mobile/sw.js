const CACHE = 'ty-bufala-mobile-v7-herd-work';
const ASSETS = ['./','./index.html','./styles.css','./app.js','./reproduction.js','./herd-work.js','./sync.js','./quality.js','./enhancements.js','./enhancements.css','./herd-overview.js','./herd-overview.css','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith('ty-bufala-mobile-') && key !== CACHE).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const path=new URL(event.request.url).pathname;
  if(path.startsWith('/api/') || path==='/healthz')return;
  if(!ASSETS.some(a=>new URL(a,self.location.href).pathname===path))return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if(cached) return cached;
    try { const response = await fetch(event.request); if(response.ok) {const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put(event.request,copy));} return response; }
    catch { if(event.request.mode === 'navigate') return caches.match('./index.html'); throw new Error('Hors ligne'); }
  })());
});
