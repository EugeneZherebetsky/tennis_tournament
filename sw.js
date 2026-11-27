// Offline support: every file is precached and served cache-first, so the page
// opens instantly with no signal. Bump VERSION whenever any file changes;
// visitors get the new version on their next visit after it has downloaded.
var VERSION = 'tt-2026-11-27-6';
var ASSETS = ['./', 'index.html', 'styles.css', 'i18n.js', 'tournament.js', 'match-queue.js', 'app.js', 'shared.js', 'manifest.webmanifest', 'icon.svg',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(ASSETS.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return caches.keys(); }).then(function (keys) {
    // Older clients have no update prompt. Let their next reload pick up this release.
    if (keys.some(function (key) { return /^tt-\d{4}-\d{2}-\d{2}-[1-5]$/.test(key); })) return self.skipWaiting();
  }));
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return /^tt-\d{4}-\d{2}-\d{2}-\d+$/.test(k) && k !== VERSION;
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var r = e.request;
  var url = new URL(r.url);
  if (r.method !== 'GET' || url.origin !== location.origin || url.pathname.indexOf('/api/') === 0) return;
  e.respondWith(caches.open(VERSION).then(function (c) {
    return c.match(r, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      if (r.mode === 'navigate') return c.match('./').then(function (m) { return m || fetch(r); });
      return fetch(r);
    });
  }));
});
