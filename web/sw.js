// Service worker: guarda el cascarón de la app para abrir sin conexión y poder instalarla.
// Al cambiar archivos del cascarón, sube VERSION para que los teléfonos tomen lo nuevo.
const VERSION = 'hf-web-3'; // la web usa las pantallas de mobile/ (las mismas del APK)
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png',
  '../mobile/m.css', '../mobile/m.js', '../mobile/icons.js', '../images/panda-login.png',
  '../js/tg.bundle.js', '../js/config.js', '../js/imagenes.js', '../js/telegram.js', '../js/library.js', '../js/sync.js',
  '../js/engine/i18n-es.js', '../js/engine/mp4.js', '../js/engine/mkv.js', '../js/engine/subs.js', '../js/engine/player.js',
  '../js/playback.js',
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
