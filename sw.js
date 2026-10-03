/* Ushers App offline shell and phone alerts. Bump CACHE when a shell file
   changes. Only the files below are served from the cache, and only when
   the network fails; everything else (the Admin App, the server) passes
   straight through. Same idea as the Driver App's sw.js. */
const CACHE = "ushers-v0.3.9";
const SHELL = ["./", "./index.html", "./config.js", "./shared/core.js", "./shared/reports.js", "./shared/style.css", "./shared/logo.png",
  "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

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
    /* The unread count on the home-screen icon, where the phone allows it,
       and any open copy of either app told at once, so its bell updates
       without waiting for its next look. */
    try {
      const n = Number(say.unread);
      if (n > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(n);
      else if (say.unread === 0 && self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
    } catch (err) {}
    try {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      all.forEach((c) => c.postMessage({ type: "ushers:notified" }));
    } catch (err) {}
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
