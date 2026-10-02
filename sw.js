/* Ushers App offline shell. Bump CACHE when a shell file changes.
   Only the files below are served from the cache, and only when the
   network fails; everything else (the Admin App, the server) passes
   straight through. Same idea as the Driver App's sw.js. */
const CACHE = "ushers-v0.1.0";
const SHELL = ["./", "./index.html", "./config.js", "./shared/core.js", "./shared/style.css", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("ushers-") && k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  const rel = "./" + url.pathname.slice(scope.pathname.length);
  if (SHELL.indexOf(rel) === -1) return;
  e.respondWith(fetch(req).then((res) => {
    const copy = res.clone();
    if (res.ok) caches.open(CACHE).then((c) => c.put(req, copy));
    return res;
  }).catch(() => caches.match(req).then((m) => m || caches.match("./index.html"))));
});
