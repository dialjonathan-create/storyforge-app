const CACHE = "storyforge-v3";
// v3 (Otherwise r3 UI-06): every navigation is answered with the app shell when
// the network is down, so reloading a deep link offline opens the app (and its
// on-device chapters) instead of the browser's "No internet" page. The old
// "storyforge-chapters-v1" cache is gone: it keyed chapters by URL for ANY
// signed-in reader on the device (a UI-01 leak in waiting), and it never held
// anything anyway -- chapters are fetched with POST, which this worker ignores.
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  // Drop caches from older SW versions, then take over open clients.
  const keep = new Set([CACHE]);
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

/** Is this a page load in our own app (a typed URL, a reload, a link)? */
function isAppNavigation(request, url) {
  return request.mode === "navigate" && url.origin === self.location.origin;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (isAppNavigation(event.request, url)) {
    // NETWORK-FIRST for the shell. Cache-first here meant a deploy only
    // reached an installed PWA on the second full launch afterward -- three
    // fixes shipped 2026-08-30 were all "not working" for an hour each
    // because the phone kept serving yesterday's HTML. The shell carries the
    // hashed asset references, so it must be fresh; the cache is only the
    // offline fallback.
    //
    // Every route the app has (/universes/u/stories/s, ...) is the same
    // index.html, so the shell is stored once, under "/", and any navigation
    // falls back to it (UI-06: only "/" did, and a deep-link reload offline
    // was the browser's error page).
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        try {
          const response = await fetch(event.request);
          if (response.ok && (response.headers.get("content-type") || "").includes("text/html")) {
            cache.put("/", response.clone());
          }
          return response;
        } catch (err) {
          const cached = (await cache.match("/")) || (await cache.match("/index.html"));
          if (cached) return cached;
          throw err;
        }
      })
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
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
  }
});
