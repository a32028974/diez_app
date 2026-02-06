const VERSION = "2026-02-06-2"; // 👈 subí versión (cambiala cada vez que actualices)
const CACHE_NAME = `diezde-${VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./consignas.js",
  "./manifest.json",
  "./favicon-32.png",
  "./icon-192.png",
  "./icon-512.png",
  "./sw.js",
];

const OPTIONAL_ASSETS = [
  "./musica/track1.mp3",
  "./musica/track2.mp3",
  "./musica/track3.mp3",
  "./musica/track4.mp3",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async ()=>{
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);

    for (const url of OPTIONAL_ASSETS) {
      try { await cache.add(url); } catch (e) {}
    }

    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return;
  if (url.origin !== location.origin) return;

  const accept = req.headers.get("accept") || "";

  if (accept.includes("text/html") || url.pathname.endsWith(".html") || url.pathname === "/") {
    event.respondWith(networkFirst(req));
    return;
  }

  if (url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith(".json")) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  event.respondWith(cacheFirst(req));
});

async function networkFirst(req){
  try{
    const fresh = await fetch(req, { cache: "no-store" });
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, fresh.clone());
    return fresh;
  }catch(e){
    return (await caches.match(req)) || (await caches.match("./index.html"));
  }
}

async function staleWhileRevalidate(req){
  const cached = await caches.match(req);
  const cache = await caches.open(CACHE_NAME);

  const fetchPromise = fetch(req).then(fresh => {
    cache.put(req, fresh.clone());
    return fresh;
  }).catch(()=> null);

  return cached || fetchPromise || new Response("", { status: 504 });
}

async function cacheFirst(req){
  const cached = await caches.match(req);
  if (cached) return cached;

  const fresh = await fetch(req);
  const cache = await caches.open(CACHE_NAME);
  cache.put(req, fresh.clone());
  return fresh;
}
