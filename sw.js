const cachePrefix = "karman-shell-" + self.registration.scope + "-";
const cacheName = cachePrefix + "1";
const home = self.registration.scope;
const index = new URL("index.html", home).href;
const shell = [
  "index.html",
  "styles.css",
  "app.js",
  "ledger.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
].map((file) => new URL(file, home).href);

self.addEventListener("install", (event) => {
  // An update activates after all windows using the previous version close.
  const requests = shell.map((url) => new Request(url, { cache: "reload" }));
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(requests)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(cachePrefix) && name !== cacheName)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const page = url.origin + url.pathname;
  const key = request.mode === "navigate" && (page === home || page === index) ? index : request.url;
  if (!shell.includes(key)) return;

  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(key) ?? fetch(request);
  })());
});
