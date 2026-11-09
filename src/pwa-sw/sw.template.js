// Service worker for Hollow Creek games. The build prepends VERSION, SHELL (the app
// shell: pages, bundles, manifests, icons) and ASSETS (models/textures -> content hash).
//
// - Pages: network first (2.5 s timeout), falling back to the cached copy offline.
// - Hashed JS/CSS and the shell: precached on install, served from cache.
// - Game assets: cache first, keyed by content hash, so each file downloads once and
//   is only fetched again when it actually changes in a new release.

/* global VERSION, SHELL, ASSETS */
const SHELL_CACHE = `hc-shell-${VERSION}`;
const ASSET_CACHE = 'hc-assets-v1';
const scope = new URL(self.registration.scope);
const rel = (url) => (url.origin === scope.origin && url.pathname.startsWith(scope.pathname) ? url.pathname.slice(scope.pathname.length) : null);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL.map((p) => new Request(p, { cache: 'reload' })))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('hc-shell-') && key !== SHELL_CACHE) await caches.delete(key);
      // Drop asset entries whose content changed (or that were removed) in this release.
      const assets = await caches.open(ASSET_CACHE);
      for (const req of await assets.keys()) {
        const u = new URL(req.url);
        const path = rel(u);
        if (!path || ASSETS[path] !== u.searchParams.get('v')) await assets.delete(req);
      }
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

async function fromShell(request) {
  if (request.mode === 'navigate') {
    const path = rel(new URL(request.url)) || 'index.html';
    return (await caches.match(path, { cacheName: SHELL_CACHE, ignoreSearch: true, ignoreVary: true })) || null;
  }
  return (await caches.match(request, { cacheName: SHELL_CACHE, ignoreVary: true })) || null;
}

async function page(event) {
  const network = (async () => {
    const preloaded = await event.preloadResponse;
    const res = preloaded || (await fetch(event.request));
    if (res.ok) {
      const copy = res.clone();
      const path = rel(new URL(event.request.url)) || 'index.html';
      caches.open(SHELL_CACHE).then((c) => c.put(path, copy));
    }
    return res;
  })();
  const timeout = new Promise((resolve) => setTimeout(resolve, 2500, null));
  try {
    const first = await Promise.race([network.catch(() => null), timeout]);
    if (first) return first;
    const cached = await fromShell(event.request);
    return cached || (await network);
  } catch {
    return (await fromShell(event.request)) || (await caches.match('index.html', { cacheName: SHELL_CACHE, ignoreVary: true })) || Response.error();
  }
}

async function asset(request, path, hash) {
  const cache = await caches.open(ASSET_CACHE);
  const key = new URL(`${path}?v=${hash}`, scope).href;
  const hit = await cache.match(key, { ignoreVary: true });
  if (hit) return hit;
  // Revalidate with the server: a changed file keeps its name, so the browser's HTTP
  // cache could otherwise hand back last release's copy.
  const res = await fetch(request, { cache: 'no-cache' });
  if (res.ok && res.status === 200) cache.put(key, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Range requests and the launcher's own bulk download go straight to the network.
  if (request.method !== 'GET' || request.headers.has('range') || request.headers.has('x-sumix-download')) return;
  const url = new URL(request.url);
  const path = rel(url);
  if (path === null) return;
  if (request.mode === 'navigate') {
    event.respondWith(page(event));
    return;
  }
  if (path === 'sw.js') return;
  const hash = ASSETS[path];
  if (hash) {
    event.respondWith(asset(request, path, hash));
    return;
  }
  event.respondWith(fromShell(request).then((hit) => hit || fetch(request)));
});
