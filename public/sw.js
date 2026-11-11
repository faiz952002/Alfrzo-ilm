// Service worker for Alfrzo Ilm (registered by js/app.js on https only).
// Deliberately minimal: it caches NOTHING, so users can never be stuck on old app code or stale data.
// It only takes control right away and removes caches left by any earlier version.
// Offline support is planned for a later phase.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
