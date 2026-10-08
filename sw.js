const CACHE = "shift-yar-v3";
const SHELL = [
  "/", "/index.html", "/manifest.webmanifest", "/css/tokens.css", "/css/style.css",
  "/js/app.js", "/js/config.js", "/js/supabaseClient.js", "/js/auth.js", "/js/data.js",
  "/js/ui.js", "/js/utils.js", "/js/hoursApi.js", "/js/hoursUtil.js",
  "/js/views/login.js", "/js/views/schedule.js", "/js/views/swap.js",
  "/js/views/checklist.js", "/js/views/admin.js", "/js/views/hours.js",
  "/icons/icon-192.png", "/icons/icon-512.png",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.hostname.includes("supabase.co") || e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request).then((cached) => {
    const net = fetch(e.request).then((res) => {
      if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => cached);
    return cached || net;
  }));
});
