// Service worker: офлайн-кэш игры. Код (html/js/css/json) — сеть с откатом на кэш,
// ресурсы (assets/, icons/) — кэш с дозагрузкой при первом обращении.
const VERSION = 'v2';
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
    e.respondWith(assetResponse(req, url));
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

// Ресурсы: кэш-first. Range-запросы (аудио/видео) обслуживаем из полного файла в кэше,
// потому что ответ 206 в Cache API положить нельзя.
async function assetResponse(req, url) {
  const cache = await caches.open(CACHE);
  let res = await cache.match(url.pathname);
  if (!res) {
    const full = await fetch(url.pathname); // без Range — целиком
    if (!full.ok) return fetch(req);
    await cache.put(url.pathname, full.clone());
    res = full;
  }
  const range = req.headers.get('range');
  if (!range) return res;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  let start = m && m[1] !== '' ? parseInt(m[1], 10) : 0;
  let end = m && m[2] !== '' ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
  if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
  if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Content-Length': String(end - start + 1),
    },
  });
}
