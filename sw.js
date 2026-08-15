/* Cache-first for the app shell, network-first for data.

   The shell is versioned: bump CACHE to invalidate. Data files are fetched
   fresh when a connection exists so an updated seed reaches the device, and
   fall back to cache when it does not — which is the exhibition-hall case. */
const CACHE = 'teal-leadconnect-v2';

const SHELL = [
  './', './index.html', './manifest.json',
  './css/tokens.css', './css/base.css', './css/shell.css', './css/components.css',
  './js/app.js', './js/store.js', './js/router.js', './js/shell.js',
  './js/scoring.js', './js/ui.js', './js/charts.js',
  './js/views/dashboard.js', './js/views/leads.js', './js/views/lead-detail.js',
  './js/views/pipeline.js', './js/views/accounts.js', './js/views/intelligence.js',
  './js/views/capture.js', './js/views/misc.js',
  './assets/teal-logo.svg', './assets/teal-mark.svg', './assets/teal-mark-maskable.svg',
  './data/leads.json', './data/companies.json', './data/contacts.json',
  './data/products.json', './data/exhibitions.json', './data/activities.json',
  './data/users.json', './data/notifications.json', './data/settings.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (request.url.includes('/data/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request)));
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).catch(() => caches.match('./index.html'))));
});
