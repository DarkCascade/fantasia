// Fantasia service worker: makes the site installable and playable offline.
// Strategy: stale-while-revalidate for same-origin GETs (instant loads, but the
// next visit picks up fresh code). The shell is precached; everything else is
// cached the first time a game actually requests it. museum/ (huge Godot
// assets), version.json and range requests are never cached.
const CACHE = "fantasia-v1";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "vendor/phaser.min.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || req.headers.has("range")) return;
  if (url.pathname.includes("/museum/") || url.pathname.endsWith("/version.json")) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: false });
      const net = fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit || (req.mode === "navigate" ? cache.match("index.html") : Response.error()));
      return hit || net;
    })
  );
});
