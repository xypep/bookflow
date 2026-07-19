// Bumping the name is what drops the previous version's entries on activate.
const CACHE_NAME = "book-flow-v2";
const APP_SHELL = [
  "/",
  "/manifest.json",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

/**
 * The page itself is fetched network-first, everything else cache-first.
 *
 * The document names the hashed asset files a build produced, so serving it
 * from cache pins the whole app to that build: the cached HTML asks for the
 * old asset names, which are also cached, and a deployed update is never
 * reached. Assets are safe to serve from cache precisely because they are
 * hashed — a changed file is a new name, never a stale hit.
 */
function isNavigation(request) {
  return request.mode === "navigate" || request.destination === "document";
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline: the last good copy of the page, or the shell entry for a route
    // that was never visited directly.
    return (await caches.match(request)) ?? (await caches.match("/")) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    isNavigation(event.request) ? networkFirst(event.request) : cacheFirst(event.request)
  );
});
