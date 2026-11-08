// Service worker: guarda el cascarón de la app para abrir sin conexión y poder instalarla.
// Al cambiar archivos del cascarón, sube VERSION para que los teléfonos tomen lo nuevo.
const VERSION = 'hf-web-2'; // motor real de Telegram
const SHELL = [
  './', './index.html', './w.css', './manifest.webmanifest',
  './js/app.js', './js/router.js', './js/state.js', './js/icons.js', './js/gestures.js',
  './js/ui/components.js', './js/ui/sheets.js', './js/ui/access.js', './js/ui/browse.js',
  './js/ui/detail.js', './js/ui/player.js', './js/ui/settings.js',
  './js/data/library.js', './js/data/demo-items.js', './js/data/art.js', './js/data/playback.js',
  './icons/panda.png', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Red primero (para ver cambios enseguida) y caché si no hay conexión.
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
  );
});
