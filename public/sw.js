const CACHE = "storyforge-v2";
const CHAPTER_CACHE = "storyforge-chapters-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  // Drop caches from older SW versions, then take over open clients.
  const keep = new Set([CACHE, CHAPTER_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.pathname === "/") {
    // NETWORK-FIRST for the shell. Cache-first here meant a deploy only
    // reached an installed PWA on the second full launch afterward — three
    // fixes shipped 2026-08-30 were all "not working" for an hour each
    // because the phone kept serving yesterday's HTML. The shell carries the
    // hashed asset references, so it must be fresh; the cache is only the
    // offline fallback.
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        try {
          const response = await fetch(event.request);
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        } catch (err) {
          const cached = await cache.match(event.request);
          if (cached) return cached;
          throw err;
        }
      })
    );
    return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    // Cache-first stays CORRECT here: filenames are content-hashed, so a
    // cached asset is immutable and a fresh shell always references new names.
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
