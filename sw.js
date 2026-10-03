/* The offline shell for both apps, and phone alerts. Bump CACHE when a shell
   file changes. Only the files below are kept, and the server is never
   touched (it is on another origin). One worker at the root covers the
   Admin App under admin/ too, so opening either app once with signal is
   enough for both to open with none. Same idea as the Driver App's sw.js. */
const CACHE = "ushers-v0.3.9";
const SHELL = ["./", "./index.html", "./config.js", "./shared/core.js", "./shared/reports.js", "./shared/style.css", "./shared/logo.png",
  "./shared/pdf.js", "./shared/vendor/jspdf.umd.min.js",
  "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png",
  "./admin/", "./admin/index.html", "./admin/testing.js", "./admin/manifest.webmanifest",
  "./admin/icon-192.png", "./admin/icon-512.png", "./admin/apple-touch-icon.png"];

/* As the Driver App: the network first, but a phone on a signal too weak
   to answer is handed the kept copy after this long rather than a blank
   screen for a minute. The fetch runs on and keeps the fresh copy for next
   time. */
const SHELL_WAIT = 3000;

/* config.js says where the server is. It is written for a page, so it is
   given a window to write to. */
self.window = self;
try { importScripts("./config.js"); } catch (e) {}
const API = String((self.USHERS_CONFIG || {}).api || "").replace(/\/+$/, "");

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("ushers-") && k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

/* The kept copy of this file (the PDF files are asked for with ?v=), or for
   a page, the right app's page. */
function kept(req, page) {
  return caches.match(req, { ignoreSearch: true }).then((hit) => hit || (page ? caches.match(page) : null));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  const rel = "./" + url.pathname.slice(scope.pathname.length);
  if (SHELL.indexOf(rel) === -1) return;
  const page = req.mode === "navigate" ? (rel.indexOf("./admin/") === 0 ? "./admin/index.html" : "./index.html") : null;
  /* Only a good answer is kept, and a bad one (a 404 while a deploy
     settles) is treated as no answer: the kept copy is better. */
  const net = fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }
    return kept(req, page).then((hit) => hit || res);
  }).catch(() => kept(req, page).then((hit) => hit || Response.error()));
  const slow = new Promise((resolve) => {
    setTimeout(() => { kept(req, page).then((hit) => { if (hit) resolve(hit); }).catch(() => {}); }, SHELL_WAIT);
  });
  e.respondWith(Promise.race([net, slow]));
});

/* A push carries nothing (as the Driver App's): the phone asks the server
   what it is for, with its own push address, and always shows something,
   because a push that shows nothing is held against the site. */
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let say = { title: "Ushers", body: "Open the app for the latest.", tag: "ushers", url: "./#notes" };
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub && API) {
        const res = await fetch(API + "/api/push.what", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }) });
        const out = await res.json();
        if (out && out.ok && out.title) say = out;
      }
    } catch (err) { /* the plain one */ }
    await self.registration.showNotification(say.title, {
      body: say.body || "", tag: say.tag || "ushers", renotify: true,
      icon: "./icon-192.png", badge: "./icon-192.png", data: { url: say.url || "./#notes" }
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const place = new URL((e.notification.data && e.notification.data.url) || "./#notes", self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const admin = place.indexOf("/admin/") !== -1;
    for (const c of all) {
      if (!("focus" in c) || c.url.indexOf(self.registration.scope) !== 0) continue;
      if ((c.url.indexOf("/admin/") !== -1) === admin) {
        if ("navigate" in c) { try { await c.navigate(place); } catch (err) {} }
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(place);
  })());
});
