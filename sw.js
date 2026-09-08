// Service worker — کش کردن shell اپ برای بارگذاری سریع/آفلاین.
// داده‌های زنده (شیفت‌ها، سواپ‌ها) همیشه از شبکه (Supabase) خونده می‌شن،
// این فقط فایل‌های ثابت رو کش می‌کنه.

const CACHE = "shift-yar-v1";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/css/tokens.css",
  "/css/style.css",
  "/js/app.js",
  "/js/config.js",
  "/js/supabaseClient.js",
  "/js/auth.js",
  "/js/data.js",
  "/js/ui.js",
  "/js/views/login.js",
  "/js/views/schedule.js",
  "/js/views/swap.js",
  "/js/views/checklist.js",
  "/js/views/admin.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // درخواست‌های Supabase (API/Realtime) رو دست نزن — همیشه شبکه
  if (url.hostname.includes("supabase.co")) return;

  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
