const CACHE = "storyforge-v1";
const CHAPTER_CACHE = "storyforge-chapters-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.pathname === "/" || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        const network = fetch(event.request).then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }
  if (url.pathname === "/v1/execute" && url.search.includes("storyforge.chapter.get.v1")) {
    event.respondWith(
      caches.open(CHAPTER_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        const response = await fetch(event.request).catch(() => cached);
        if (response && response.ok) {
          cache.put(event.request, response.clone());
          const keys = await cache.keys();
          await Promise.all(keys.slice(0, Math.max(0, keys.length - 3)).map((key) => cache.delete(key)));
        }
        return response || cached;
      })
    );
  }
});
