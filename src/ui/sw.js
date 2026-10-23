// Cache first, refresh in the background: the app starts at once even on slow or
// captive Wi-Fi. Redirected responses (e.g. Wi-Fi login pages) and other sites are
// never cached.
// v3: without the banner photos; activating it deletes the old cache with them.
const CACHE = 'seedr-v3';
// The build fills in the icons.
const ICONS = [/* ICONS */];
const FILES = ['./', './index.html', './manifest.webmanifest', ...ICONS];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const network = fetch(request).then(async (response) => {
    if (response.ok && !response.redirected) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  });
  event.waitUntil(network.then(() => {}, () => {}));
  event.respondWith(
    caches.match(request, { ignoreSearch: true })
      .then((cached) => cached || network)
      .catch(() => (request.mode === 'navigate' ? caches.match('./index.html') : undefined))
      .then((response) => response || Response.error()),
  );
});
