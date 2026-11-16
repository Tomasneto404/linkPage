// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
// Only a generic offline page and its assets enter Cache Storage. Keep this
// list explicit: authenticated HTML, API replies, documents and uploads must
// always go to the server, where current permissions can be checked.
const CACHE_PREFIX = 'linkpage-offline-';
const CACHE_NAME = `${CACHE_PREFIX}1`;
const OFFLINE_ASSETS = [
  '/offline.html', '/pwa/offline.css', '/pwa/offline.js',
  '/pwa/icon-192.png', '/pwa/icon-512.png',
  '/pwa/icon-maskable-512.png', '/pwa/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(OFFLINE_ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const fallback = await caches.match('/offline.html', { cacheName: CACHE_NAME });
      return fallback || Response.error();
    }));
    return;
  }
  if (!url.search && OFFLINE_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request, { cacheName: CACHE_NAME }).then(cached => cached || fetch(request)));
  }
});
