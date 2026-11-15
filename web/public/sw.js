// Service worker: lets the app open with no connection once it has been loaded (or saved) on this device.
//   - Data and pages (same origin): try the network first so the numbers are current; when offline, use the
//     copy saved on this device.
//   - Built files under /assets/ have a hash in their name and never change: use the saved copy first.
// Nothing from other origins is touched. The "Save for offline" button in the app fills the same cache up
// front (see src/lib/offline.js), so a first visit made online is enough.
const CACHE = "fire-harmonize-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE && n.startsWith("fire-harmonize-")).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const saved = await cache.match(request, { ignoreSearch: true });
    if (saved) return saved;
    if (request.mode === "navigate") {
      const page = await cache.match(self.registration.scope);
      if (page) return page;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(url.pathname.includes("/assets/") ? cacheFirst(request) : networkFirst(request));
});
