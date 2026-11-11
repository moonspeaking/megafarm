// Service worker: офлайн-кэш игры. Код (html/js/css/json) — сеть с откатом на кэш,
// ресурсы (assets/, icons/) — кэш с дозагрузкой при первом обращении.
const VERSION = 'v1';
const CACHE = 'megafarm-' + VERSION;
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'assets/manifest.json', 'assets/decor.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('megafarm-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isAsset = (url) => /\/(assets|icons)\//.test(url.pathname) && !/\.(json)$/.test(url.pathname);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (isAsset(url)) {
    // cache-first
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // network-first, ignoring cache-busting query (?v=...)
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(url.pathname, copy));
      }
      return res;
    }).catch(() => caches.match(url.pathname, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
