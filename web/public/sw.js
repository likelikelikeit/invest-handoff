// M8 오프라인 셸. API JSON은 토큰별로 web/src/lib/api.js가 Cache API에 저장한다.
const SHELL = "invest-shell-v1";
const CORE = ["./", "./manifest.webmanifest", "./icon.svg", "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("invest-shell-") && key !== SHELL).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).then((res) => {
      if (res.ok) caches.open(SHELL).then((cache) => cache.put("./", res.clone()));
      return res;
    }).catch(() => caches.match("./")));
    return;
  }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) caches.open(SHELL).then((cache) => cache.put(req, res.clone()));
    return res;
  })));
});
