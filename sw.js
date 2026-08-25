/* Offline shell.

   Cache-first for the application's own files, network-first for the seed
   data, and deliberately hands-off for everything else.

   That last part matters now there is a backend. An earlier version of this
   file answered every GET it saw, and on failure fell back to index.html —
   which meant a Supabase request made on a bad connection resolved with a page
   of HTML that the client then tried to read as JSON. Requests to another
   origin are now left alone entirely: the store's outbox is what makes writes
   survive being offline, and it can only do that if it is told the truth about
   whether a request failed.

   Bump CACHE to invalidate the shell. */
const CACHE = 'teal-leadconnect-v3';

const SHELL = [
  './', './index.html', './manifest.json',
  './css/tokens.css', './css/base.css', './css/shell.css', './css/components.css',
  './js/app.js', './js/store.js', './js/router.js', './js/shell.js',
  './js/scoring.js', './js/ui.js', './js/charts.js',
  './js/config.js', './js/api.js', './js/field-map.js',
  './js/views/dashboard.js', './js/views/leads.js', './js/views/lead-detail.js',
  './js/views/pipeline.js', './js/views/accounts.js', './js/views/intelligence.js',
  './js/views/capture.js', './js/views/misc.js',
  './vendor/supabase-js.esm.js',
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

  const url = new URL(request.url);

  // Supabase, and anything else off-origin. Not ours to answer: a cached or
  // substituted response to an API call is worse than a failed one, because
  // the failure is what tells the store to queue the write and retry.
  if (url.origin !== self.location.origin) return;

  // Which project this deployment points at must never come from a cache. A
  // stale copy would send a reconfigured deployment to the previous database.
  if (url.pathname.endsWith('/config.json')) return;

  // Seed data: fresh when there is a connection so an updated seed reaches the
  // device, cached when there is not — the exhibition-hall case.
  if (url.pathname.includes('/data/')) {
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
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).catch(() => {
        // Only a navigation should fall back to the shell. Answering a missing
        // script or stylesheet with a page of HTML produces a syntax error
        // that hides whatever actually went wrong.
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    }));
});
