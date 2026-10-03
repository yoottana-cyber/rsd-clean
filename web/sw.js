const CACHE="rsd-clean-v2-shell-53";
const RUNTIME="rsd-clean-v2-runtime-1";
const CERT_CACHE="rsd-certificate-template-v1";
const SHELL=[
  "/",
  "/index.html",
  "/style.css",
  "/core.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png"
];
const TRUSTED_RUNTIME_ORIGINS=new Set([
  "https://cdn.tailwindcss.com",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://cdnjs.cloudflare.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com"
]);

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));
});

self.addEventListener("message",event=>{
  if(event.data&&event.data.type==="SKIP_WAITING")self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k!==RUNTIME&&k!==CERT_CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

async function staleWhileRevalidate(cacheName,req){
  const cache=await caches.open(cacheName);
  const cached=await cache.match(req);
  const network=fetch(req).then(async res=>{
    if(res&&(res.ok||res.type==="opaque")){
      try{await cache.put(req,res.clone());}catch(e){}
    }
    return res;
  }).catch(()=>null);
  if(cached){network.catch(()=>{});return cached;}
  return await network||Response.error();
}

self.addEventListener("fetch",event=>{
  const req=event.request;
  const url=new URL(req.url);
  if(req.method!=="GET")return;

  if(url.origin!==location.origin){
    if(TRUSTED_RUNTIME_ORIGINS.has(url.origin)){
      event.respondWith(staleWhileRevalidate(RUNTIME,req));
    }
    return;
  }
  if(url.pathname==="/api"||url.pathname==="/migrate-api")return;

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

  event.respondWith(staleWhileRevalidate(CACHE,req));
});

self.addEventListener("push",event=>{
  const title="RSD Clean";
  const options={
    body:"มีรายการใหม่ที่ต้องตรวจสอบใน RSD Clean",
    icon:"/icon-192.png",
    badge:"/icon-192.png",
    tag:"rsd-clean-update",
    renotify:true,
    data:{url:"/#home"}
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const url=event.notification?.data?.url||"/#home";
  event.waitUntil((async()=>{
    const list=await clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of list){
      try{
        if("focus" in client){
          await client.focus();
          if("navigate" in client)await client.navigate(url);
          return;
        }
      }catch(e){}
    }
    if(clients.openWindow)return clients.openWindow(url);
  })());
});
