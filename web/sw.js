const CACHE="rsd-clean-v2-shell-11";
const SHELL=[
  "/",
  "/index.html",
  "/style.css",
  "/core.js",
  "/admin.js",
  "/inspector.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));
});

self.addEventListener("message",event=>{
  if(event.data&&event.data.type==="SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  const req=event.request;
  const url=new URL(req.url);
  if(req.method!=="GET"||url.origin!==location.origin||url.pathname==="/api") return;

  if(req.mode==="navigate"){
    event.respondWith(
      fetch(req)
        .then(res=>{
          const copy=res.clone();
          caches.open(CACHE).then(c=>c.put("/",copy)).catch(()=>{});
          return res;
        })
        .catch(async()=>await caches.match("/")||await caches.match("/index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached=>{
      const network=fetch(req).then(res=>{
        if(res&&res.ok){
          const copy=res.clone();
          caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});
        }
        return res;
      }).catch(()=>cached);
      return cached||network;
    })
  );
});
