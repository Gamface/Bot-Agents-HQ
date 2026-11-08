// Mission Control service worker: lets the app be installed, opens offline with your last
// saved data (the page keeps a copy in the browser), and shows phone alerts.
'use strict';
const CACHE = 'mission-control-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// The page itself: network first, so you always get the latest; the cached copy only when offline.
// API calls and the live stream are never cached.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/mcp') return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && (url.pathname === '/' || url.pathname === '/index.html')) { const copy = r.clone(); caches.open(CACHE).then(c => c.put('/', copy)); }
    return r;
  }).catch(() => caches.match(url.pathname === '/index.html' ? '/' : e.request).then(r => r || caches.match('/'))));
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Mission Control', {
    body: d.body || '', tag: d.tag || 'mission-control', renotify: true, requireInteraction: !!d.sticky,
    icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || '/', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => new URL(c.url).origin === location.origin);
    if (open) { open.navigate(target).catch(() => {}); return open.focus(); }
    return self.clients.openWindow(target);
  }));
});
