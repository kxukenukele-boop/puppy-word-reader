const CACHE = 'puppy-reader-v1.0.0';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
];
const VENDOR = [
  'https://cdn.jsdelivr.net/npm/mammoth@1.12.2/mammoth.browser.min.js',
  'https://cdn.jsdelivr.net/npm/dompurify@3.4.15/dist/purify.min.js',
  'https://cdn.jsdelivr.net/npm/papaparse@5.7.0/papaparse.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    for (const url of VENDOR) {
      try {
        const response = await fetch(url, { mode: 'no-cors', cache: 'reload' });
        await cache.put(url, response);
      } catch (e) {
        console.warn('Vendor precache failed:', url, e);
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('puppy-reader-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: false });
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response && (response.ok || response.type === 'opaque')) {
        const cache = await caches.open(CACHE);
        cache.put(event.request, response.clone()).catch(() => {});
      }
      return response;
    } catch (e) {
      if (event.request.mode === 'navigate') {
        return (await caches.match('./index.html')) || Response.error();
      }
      throw e;
    }
  })());
});
