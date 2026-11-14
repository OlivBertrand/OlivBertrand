const CACHE = 'ty-bufala-mobile-v4-events-sales';
const ASSETS = ['./','./index.html','./styles.css','./enhancements.css','./field-ui.css','./sales-math.js','./field-core.js','./app.js','./field-ui.js','./quality.js','./enhancements.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith('ty-bufala-mobile-') && key !== CACHE).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if(cached) return cached;
    try { const response = await fetch(event.request); if(response.ok) {const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put(event.request,copy));} return response; }
    catch { if(event.request.mode === 'navigate') return caches.match('./index.html'); throw new Error('Hors ligne'); }
  })());
});