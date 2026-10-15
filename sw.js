// Delegance app shell: works offline for the dashboard frame; data always comes fresh from the network.
const CACHE = 'dlg-shell-v8';
const SHELL = ['/dashboard', '/assets/dash.css?v=8', '/assets/dash.js?v=8', '/assets/motion.css?v=1', '/assets/motion.js?v=1', '/brand/delegance-logo-horizontal-flat.svg', '/favicon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  if (!SHELL.includes(u.pathname + u.search) && u.pathname !== '/dashboard') return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request, { ignoreSearch: false }).then(r => r || caches.match('/dashboard'))));
});
