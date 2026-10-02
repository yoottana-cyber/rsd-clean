"use strict";
  const SCHOOL_LOGO_URL = "https://www.ratsada.ac.th/learn/up/uploads/NOOK/LOGO.png";
  let deferredInstallPrompt = null;
  const isStandaloneApp = () => window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent || "");

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    document.documentElement.classList.add("pwa-installable");
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    document.documentElement.classList.add("pwa-installed");
    document.querySelectorAll(".install-btn").forEach((b) => b.classList.add("hidden"));
  });

  async function installApp() {
    if (isStandaloneApp()) return toast("ติดตั้ง RSD Clean บนอุปกรณ์นี้แล้ว");
    if (deferredInstallPrompt) {
      const prompt = deferredInstallPrompt;
      deferredInstallPrompt = null;
      await prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") toast("กำลังติดตั้ง RSD Clean");
      return;
    }
    if (isIOS()) {
      return Swal.fire({
        icon: "info",
        title: "ติดตั้ง RSD Clean บน iPhone / iPad",
        html: '<div style="text-align:left;line-height:1.8"><b>1.</b> แตะปุ่ม <b>แชร์</b> ของเบราว์เซอร์<br><b>2.</b> เลือก <b>เพิ่มไปยังหน้าจอโฮม (Add to Home Screen)</b><br><b>3.</b> แตะ <b>เพิ่ม</b><br><br><span style="color:#64748b">เมื่อติดตั้งแล้ว เปิดจากไอคอน RSD Clean ได้เหมือนแอป</span></div>',
        confirmButtonText: "เข้าใจแล้ว",
        confirmButtonColor: "#0f766e",
      });
    }
    return Swal.fire({
      icon: "info",
      title: "ติดตั้ง RSD Clean",
      text: "เปิดเมนูของเบราว์เซอร์ แล้วเลือก ติดตั้งแอป หรือ เพิ่มไปยังหน้าจอหลัก",
      confirmButtonText: "ตกลง",
      confirmButtonColor: "#0f766e",
    });
  }

  function wireInstallButtons() {
    document.querySelectorAll(".install-btn").forEach((b) => {
      if (isStandaloneApp()) b.classList.add("hidden");
      else {
        b.classList.remove("hidden");
        b.onclick = installApp;
      }
    });
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
    } catch (e) {
      try {
        return sessionStorage.getItem(key) || "";
      } catch (e2) {
        return "";
      }
    }
  }
  function storeSession(token, remember) {
    try {
      sessionStorage.removeItem("rsd-token");
      localStorage.removeItem("rsd-token");
      if (remember) localStorage.setItem("rsd-token", token);
      else sessionStorage.setItem("rsd-token", token);
    } catch (e) {
      try {
        sessionStorage.setItem("rsd-token", token);
      } catch (e2) {}
    }
  }
  const PENDING_QR_KEY = "rsd-pending-qr";
  const CONSUMED_QR_KEY = "rsd-consumed-qr";
  const PENDING_QR_MS = 30 * 60 * 1000;
  function qrFromLocation() {
    try {
      const q = new URLSearchParams(location.search).get("qr");
      if (q) return q;
    } catch (e) {}
    try {
      const raw = location.hash || "";
      const qIndex = raw.indexOf("?");
      if (qIndex >= 0) {
        const q = new URLSearchParams(raw.slice(qIndex + 1)).get("qr");
        if (q) return q;
      }
    } catch (e) {}
    return "";
  }
  function savePendingQr(token) {
    token = String(token || "").trim();
    if (!token) return;
    const value = JSON.stringify({ token, at: Date.now() });
    try { localStorage.setItem(PENDING_QR_KEY, value); } catch (e) {}
    try { sessionStorage.setItem(PENDING_QR_KEY, value); } catch (e) {}
  }
  function isQrConsumed(token) {
    try { return sessionStorage.getItem(CONSUMED_QR_KEY) === String(token || ""); }
    catch (e) { return false; }
  }
  function markQrConsumed(token) {
    try { sessionStorage.setItem(CONSUMED_QR_KEY, String(token || "")); } catch (e) {}
  }
  function getPendingQr() {
    const direct = qrFromLocation();
    if (direct) {
      // A completed QR must not reopen repeatedly just because ?qr= remains in the web-app URL.
      if (isQrConsumed(direct)) return "";
      savePendingQr(direct);
      return direct;
    }
    let raw = "";
    try { raw = sessionStorage.getItem(PENDING_QR_KEY) || localStorage.getItem(PENDING_QR_KEY) || ""; } catch (e) {}
    if (!raw) return "";
    try {
      const x = JSON.parse(raw);
      if (!x.token || !x.at || Date.now() - Number(x.at) > PENDING_QR_MS) {
        clearPendingQr();
        return "";
      }
      return String(x.token);
    } catch (e) {
      clearPendingQr();
      return "";
    }
  }
  function clearPendingQr() {
    try { sessionStorage.removeItem(PENDING_QR_KEY); } catch (e) {}
    try { localStorage.removeItem(PENDING_QR_KEY); } catch (e) {}
  }
  const initialScanToken = getPendingQr();
  const S = {
    token: storageGet("rsd-token"),
    user: null,
    route: "",
    busy: 0,
    charts: [],
    seq: 0,
    master: null,
    config: null,
    polling: false,
    scanToken: initialScanToken,
    scanHandled: false,
  };
  if (initialScanToken) savePendingQr(initialScanToken);
  const $ = (id) => document.getElementById(id);
  const mobileNavQuery = window.matchMedia("(max-width: 760px)");
  function placeNavigation() {
    const navEl = $("nav"), topbar = document.querySelector(".topbar"), account = $("account");
    if (!navEl || !topbar) return;
    if (mobileNavQuery.matches) {
      if (navEl.parentElement !== document.body) document.body.appendChild(navEl);
    } else if (navEl.parentElement !== topbar) {
      if (account && account.parentElement === topbar) topbar.insertBefore(navEl, account);
      else topbar.appendChild(navEl);
    }
  }
  if (mobileNavQuery.addEventListener) mobileNavQuery.addEventListener("change", placeNavigation);
  else if (mobileNavQuery.addListener) mobileNavQuery.addListener(placeNavigation);
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const thaiDay = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  const OFFLINE_DB_NAME = "rsd-clean-offline";
  const OFFLINE_DB_VERSION = 1;
  function openOfflineDb() {
    return new Promise((resolve,reject)=>{
      if(!("indexedDB" in window)) return reject(Error("อุปกรณ์นี้ไม่รองรับ Offline Storage"));
      const req=indexedDB.open(OFFLINE_DB_NAME,OFFLINE_DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains("inspectionQueue")){
          const store=db.createObjectStore("inspectionQueue",{keyPath:"key"});
          store.createIndex("userId","userId",{unique:false});
          store.createIndex("createdAt","createdAt",{unique:false});
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||Error("เปิด Offline Storage ไม่สำเร็จ"));
    });
  }
  async function offlineStore(mode,fn){
    const db=await openOfflineDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction("inspectionQueue",mode),store=tx.objectStore("inspectionQueue");
      let result;
      try{result=fn(store);}catch(e){db.close();reject(e);return;}
      tx.oncomplete=()=>{db.close();resolve(result?.result);};
      tx.onerror=()=>{db.close();reject(tx.error||Error("Offline Storage ผิดพลาด"));};
      tx.onabort=()=>{db.close();reject(tx.error||Error("Offline Storage ถูกยกเลิก"));};
    });
  }
  async function queueOfflineInspection(record){
    await offlineStore("readwrite",store=>store.put(record));
    window.dispatchEvent(new CustomEvent("rsd-offline-queue-change"));
    return true;
  }
  async function listOfflineInspections(userId=""){
    const db=await openOfflineDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction("inspectionQueue","readonly"),store=tx.objectStore("inspectionQueue"),req=store.getAll();
      req.onsuccess=()=>resolve((req.result||[]).filter(x=>!userId||x.userId===userId).sort((a,b)=>a.createdAt-b.createdAt));
      req.onerror=()=>reject(req.error||Error("อ่าน Offline Queue ไม่สำเร็จ"));
      tx.oncomplete=()=>db.close();
    });
  }
  async function removeOfflineInspection(key){
    await offlineStore("readwrite",store=>store.delete(key));
    window.dispatchEvent(new CustomEvent("rsd-offline-queue-change"));
  }
  window.rsdOfflineQueue={queue:queueOfflineInspection,list:listOfflineInspections,remove:removeOfflineInspection};

  async function notificationCenterModal(){
    if(!S.user) return;
    openModal("ศูนย์แจ้งเตือน",'<div id="notification-center-body"><div class="muted">กำลังโหลดแจ้งเตือน…</div></div>');
    const box=$("notification-center-body");
    try{
      const freshInspectorNotice=S.user.Role==="Inspector"&&window.rsdInspectorNotifications&&Date.now()-Number(window.rsdInspectorNotifications.at||0)<30000
        ? window.rsdInspectorNotifications.data
        : null;
      const [server,offline]=await Promise.all([
        freshInspectorNotice ? Promise.resolve(freshInspectorNotice) : rpc("notifications",{},true).catch(()=>({items:[],unread:0,offline:true})),
        S.user.Role==="Inspector" ? listOfflineInspections(S.user.UserID).catch(()=>[]) : Promise.resolve([])
      ]);
      if(!box?.isConnected)return;
      const items=[...(server?.items||[])];
      if(offline.length)items.unshift({type:"warning",title:"มีผลตรวจรอซิงก์",message:offline.length+" รายการถูกเก็บไว้ในเครื่อง และจะส่งอัตโนมัติเมื่อออนไลน์",action:"tasks",count:offline.length,offline:true});
      const icon={warning:"triangle-alert",success:"circle-check",info:"info"}; 
      box.innerHTML=items.length
        ? '<div class="notification-list">'+items.map((x,i)=>
            '<button class="notification-card notification-'+esc(x.type||"info")+'" data-index="'+i+'">'+
              '<span class="notification-icon"><i data-lucide="'+(icon[x.type]||"bell")+'"></i></span>'+
              '<span class="notification-copy"><b>'+esc(x.title)+'</b><small>'+esc(x.message)+'</small></span>'+
              (x.count?'<span class="notification-count">'+Number(x.count)+'</span>':'')+
            '</button>'
          ).join("")+'</div>'
        : '<div class="empty">ไม่มีแจ้งเตือนที่ต้องดำเนินการ</div>';
      box.querySelectorAll(".notification-card").forEach(btn=>btn.onclick=async()=>{
        const x=items[Number(btn.dataset.index)];
        if(x.offline){
          closeModal();
          if(navigator.onLine&&typeof window.syncOfflineInspections==="function") await window.syncOfflineInspections(true);
          else {location.hash="tasks";await route();}
          return;
        }
        if(x.action){closeModal();location.hash=x.action;await route();}
      });
      icons();
    }catch(e){
      box.innerHTML='<div class="warn">โหลดแจ้งเตือนไม่สำเร็จ<br>'+esc(e.message||String(e))+'</div>';
    }
  }
  async function refreshNotificationBadge(){
    if(!S.user)return;
    try{
      const freshInspectorNotice=S.user.Role==="Inspector"&&window.rsdInspectorNotifications&&Date.now()-Number(window.rsdInspectorNotifications.at||0)<30000
        ? window.rsdInspectorNotifications.data
        : null;
      const [server,offline]=await Promise.all([
        freshInspectorNotice ? Promise.resolve(freshInspectorNotice) : rpc("notifications",{},true).catch(()=>({unread:0})),
        S.user.Role==="Inspector" ? listOfflineInspections(S.user.UserID).catch(()=>[]) : Promise.resolve([])
      ]);
      const n=Math.min(99,Number(server?.unread||0)+offline.length);
      document.querySelectorAll(".notification-badge").forEach(el=>{
        el.textContent=n>99?"99+":String(n);
        el.classList.toggle("hidden",!n);
      });
    }catch(e){}
  }
  window.addEventListener("rsd-offline-queue-change",()=>refreshNotificationBadge());
  window.rsdNotificationCenter=notificationCenterModal;

  function busy(on, text = "กำลังประมวลผล…") {
    S.busy = Math.max(0, S.busy + (on ? 1 : -1));
    $("loading").classList.toggle("hidden", !S.busy);
    $("loading-text").textContent = text;
  }
  // External PWA calls the same-origin Cloudflare Pages Function; the gateway secret never reaches the browser.
  async function rpc(action, payload = {}, silent = false) {
    if (!silent) busy(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const res = await fetch("/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
        body: JSON.stringify({ action, payload, token: S.token || "" }),
      });
      let r=null;
      try{r=await res.json();}catch(e){}
      if (!res.ok) throw Error((r&&r.error)||("API HTTP "+res.status));
      if (!r || r.ok !== true) {
        if (r && r.error === "SESSION_EXPIRED") {
          clearSession();
          route();
        }
        throw Error((r && r.error) || "API ตอบกลับไม่ถูกต้อง");
      }
      return r.data;
    } catch (e) {
      if (e.name === "AbortError") throw Error("เชื่อมต่อ API นานเกินไป กรุณาลองใหม่");
      throw e;
    } finally {
      clearTimeout(timer);
      if (!silent) busy(false);
    }
  }
  const clientErrorSeen=new Map();
  async function reportBrowserError(message){
    if(!S.user||!S.token||!navigator.onLine)return;
    const msg=String(message||"Browser error").replace(/\s+/g," ").slice(0,300);
    if(!msg)return;
    const key=(S.route||"unknown")+"|"+msg,now=Date.now(),last=Number(clientErrorSeen.get(key)||0);
    if(now-last<60000)return;
    clientErrorSeen.set(key,now);
    if(clientErrorSeen.size>100){
      for(const [k,v] of clientErrorSeen){if(now-Number(v)>10*60000)clientErrorSeen.delete(k);}
    }
    try{await rpc("clientError",{message:msg,page:S.route||"unknown"},true);}catch(e){}
  }
  window.addEventListener("error",(e)=>{
    reportBrowserError(e?.message||e?.error?.message||"JavaScript error");
  });
  window.addEventListener("unhandledrejection",(e)=>{
    reportBrowserError(e?.reason?.message||String(e?.reason||"Unhandled promise rejection"));
  });

  function error(e) {
    Swal.fire({
      icon: "error",
      title: "ดำเนินการไม่สำเร็จ",
      text: e.message || String(e),
      confirmButtonText: "ตกลง",
      confirmButtonColor: "#0891b2",
    });
  }
  function toast(text) {
    Swal.fire({
      position: "center",
      icon: "success",
      title: text,
      showConfirmButton: false,
      timer: 1800,
      timerProgressBar: true,
      width: 340,
      customClass: { popup: "center-notification" },
    });
  }
  function icons() {
    if (window.lucide) lucide.createIcons();
  }
  function table(headers, rows) {
    return (
      '<div class="table-wrap"><table><thead><tr>' +
      headers.map((x) => "<th>" + esc(x) + "</th>").join("") +
      "</tr></thead><tbody>" +
      (rows.length
        ? rows.map((r) => "<tr>" + r.map((c) => "<td>" + c + "</td>").join("") + "</tr>").join("")
        : '<tr><td colspan="' + headers.length + '" class="empty">ยังไม่มีข้อมูล</td></tr>') +
      "</tbody></table></div>"
    );
  }
  function pill(score, text) {
    return (
      '<span class="pill ' +
      ({ 3: "green", 2: "yellow", 1: "red" }[score] || "gray") +
      '">' +
      esc(text || S.config?.scoreLabels?.[String(score)] || { 3: "ยอดเยี่ยม", 2: "ปานกลาง", 1: "ปรับปรุง" }[score] || "รอตรวจ") +
      "</span>"
    );
  }
  function heading(title, desc, action = "") {
    return (
      '<div class="flex flex-wrap items-center justify-between gap-4 mb-7"><div><h1 class="page-title">' +
      esc(title) +
      '</h1><p class="muted mt-1">' +
      esc(desc) +
      "</p></div>" +
      action +
      "</div>"
    );
  }
  let modalFocus = null,
    modalCleanup = null;
  function setModalCleanup(fn) {
    modalCleanup = typeof fn === "function" ? fn : null;
  }
  function openModal(title, html) {
    modalCleanup = null;
    modalFocus = document.activeElement;
    $("modal-title").textContent = title;
    $("modal-body").innerHTML = html;
    $("modal").classList.remove("hidden");
    $("modal-close").focus();
  }
  function closeModal() {
    const cleanup = modalCleanup;
    modalCleanup = null;
    if (cleanup) {
      try {
        const result = cleanup();
        if (result?.catch) result.catch(() => {});
      } catch (e) {}
    }
    $("modal").classList.add("hidden");
    $("modal-body").innerHTML = "";
    if (modalFocus?.isConnected) modalFocus.focus();
  }
  $("modal-close").onclick = closeModal;
  $("modal").onclick = (e) => {
    if (e.target === $("modal")) closeModal();
  };
  document.addEventListener("keydown", (e) => {
    if ($("modal").classList.contains("hidden")) return;
    if (e.key === "Escape") closeModal();
    if (e.key === "Tab") {
      const a = [...$("modal").querySelectorAll("button,input,select,textarea,a[href]")].filter(
          (x) => !x.disabled,
        ),
        first = a[0],
        last = a[a.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  $("hamburger").onclick = () => {
    $("nav").classList.toggle("open");
    $("hamburger").setAttribute("aria-expanded", String($("nav").classList.contains("open")));
  };
  function clearSession() {
    S.token = "";
    S.user = null;
    try {
      sessionStorage.removeItem("rsd-token");
      localStorage.removeItem("rsd-token");
      localStorage.removeItem("rsd-user-cache");
      localStorage.removeItem("rsd-config-cache");
    } catch (e) {}
  }
  const pages = {
    dashboard: { title: "ภาพรวม", icon: "layout-dashboard", roles: ["Admin", "Supervisor", "Inspector"] },
    executive: { title: "ผู้บริหาร", icon: "briefcase-business", roles: ["Admin", "Supervisor"] },
    tasks: { title: "งานตรวจวันนี้", icon: "clipboard-check", roles: ["Inspector"] },
    teacher: { title: "ห้องเรียนของฉัน", icon: "school", roles: ["Teacher"] },
    admin: { title: "จัดการข้อมูล", icon: "settings-2", roles: ["Admin"] },
    reports: { title: "รายงาน", icon: "chart-no-axes-column-increasing", roles: ["Admin", "Supervisor"] },
    review: { title: "รับรองผล", icon: "badge-check", roles: ["Admin", "Supervisor"] },
    history: { title: "ประวัติ", icon: "history", roles: ["Admin", "Supervisor", "Inspector", "Teacher"] },
    exports: { title: "ส่งออก", icon: "file-down", roles: ["Admin", "Supervisor", "Teacher"] },
    daily: { title: "รายงานรายวัน", icon: "send", roles: ["Admin", "Supervisor", "Inspector"] },
  };
  function getDeviceIdentity(){
    let id="";
    try{
      id=localStorage.getItem("rsd-device-id")||"";
      if(!id){
        id=(crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random().toString(16).slice(2));
        localStorage.setItem("rsd-device-id",id);
      }
    }catch(e){id="device-"+Date.now();}
    const ua=navigator.userAgent||"";
    let device=/iPhone/i.test(ua)?"iPhone":/iPad/i.test(ua)?"iPad":/Android/i.test(ua)?"Android":/Windows/i.test(ua)?"Windows":/Macintosh|Mac OS X/i.test(ua)?"Mac":"อุปกรณ์";
    let browser=/CriOS|Chrome/i.test(ua)?"Chrome":/FxiOS|Firefox/i.test(ua)?"Firefox":/EdgiOS|Edg/i.test(ua)?"Edge":/Safari/i.test(ua)?"Safari":"Browser";
    if(isStandaloneApp()) browser+=" · PWA";
    return{id,label:device+" · "+browser};
  }
  function homeRouteForUser(){
    if(!S.user)return"dashboard";
    return S.user.Role==="Inspector"?"tasks":S.user.Role==="Teacher"?"teacher":["Admin","Supervisor"].includes(S.user.Role)?"executive":"dashboard";
  }
  function onboardingKey(){
    return "rsd-onboarding-v1:"+(S.user?.Role||"guest");
  }
  function onboardingSlides(){
    const common=[
      {icon:"house",title:"หน้าแรกของคุณ",text:"ระบบจะพาไปหน้าที่เหมาะกับบทบาทอัตโนมัติเมื่อเปิดจากไอคอน RSD Clean"},
      {icon:"bell",title:"ดูแจ้งเตือน",text:"ตรวจงานค้าง งานรอซิงก์ และข้อความที่ต้องดำเนินการจากกระดิ่งด้านล่าง"}
    ];
    if(S.user?.Role==="Inspector")return[
      {icon:"clipboard-check",title:"ดูงานตรวจวันนี้",text:"เปิดรายการพื้นที่ที่ได้รับมอบหมาย และดูสถานะงานของวันนี้"},
      {icon:"scan-line",title:"สแกน QR ณ จุดตรวจ",text:"ใช้ปุ่มวงกลมตรงกลางเพื่อสแกน QR แล้วเปิดแบบประเมินของพื้นที่นั้นทันที"},
      {icon:"wifi-off",title:"เน็ตหลุดก็ยังบันทึกได้",text:"งานจะเก็บไว้ในเครื่องและขึ้นสถานะรอซิงก์ จากนั้นส่งอัตโนมัติเมื่อออนไลน์"},
      ...common.slice(1)
    ];
    if(S.user?.Role==="Teacher")return[
      {icon:"school",title:"ติดตามห้องเรียนของฉัน",text:"ดูผลตรวจ พื้นที่รับผิดชอบ รูปหลักฐาน และรางวัลของห้องเรียน"},
      {icon:"bell",title:"ติดตามผลที่ควรปรับปรุง",text:"ศูนย์แจ้งเตือนจะช่วยชี้ผลประเมินที่ควรติดตาม"},
      {icon:"smartphone",title:"ติดตั้งบนมือถือ",text:"เพิ่ม RSD Clean ลงหน้าจอหลักแล้วเปิดใช้งานเหมือนแอป"}
    ];
    if(S.user?.Role==="Admin")return[
      {icon:"briefcase-business",title:"Dashboard ผู้บริหาร",text:"ดูสถานะวันนี้ แนวโน้มรายสัปดาห์/รายเดือน และจุดที่ควรติดตามในหน้าเดียว"},
      {icon:"settings-2",title:"จัดการข้อมูล",text:"เพิ่มผู้ใช้ ห้องเรียน พื้นที่ ตั้งเวร QR วันหยุด และกู้คืนข้อมูลจากถังขยะ"},
      {icon:"bell",title:"ตรวจสิ่งที่ต้องดำเนินการ",text:"ศูนย์แจ้งเตือนรวมงานค้าง พื้นที่ไม่มีผู้ตรวจ Backup และสถานะสำคัญ"},
      {icon:"shield-check",title:"ระบบมี Backup และ Audit Log",text:"ตรวจประวัติการเปลี่ยนแปลง สำรอง และกู้คืนข้อมูลได้จากหน้า Admin"}
    ];
    if(S.user?.Role==="Supervisor")return[
      {icon:"briefcase-business",title:"Dashboard ผู้บริหาร",text:"ดูสถานะวันนี้ แนวโน้มรายสัปดาห์/รายเดือน และประเด็นที่ควรติดตามในหน้าเดียว"},
      {icon:"chart-no-axes-column-increasing",title:"เปิดรายงาน",text:"ดูอันดับห้องเรียน พื้นที่ที่ต้องจับตา และประสิทธิภาพผู้ตรวจ"},
      ...common.slice(1)
    ];
    return common;
  }
  function showOnboarding(force=false){
    if(!S.user)return;
    try{if(!force&&localStorage.getItem(onboardingKey())==="done")return;}catch(e){}
    const slides=onboardingSlides();let index=0;
    const render=()=>{
      const x=slides[index];
      openModal("เริ่มใช้งาน RSD Clean",
        '<div class="onboarding-wrap">'+
          '<div class="onboarding-step">ขั้นตอน '+(index+1)+' / '+slides.length+'</div>'+
          '<div class="onboarding-icon"><i data-lucide="'+x.icon+'"></i></div>'+
          '<h3>'+esc(x.title)+'</h3><p>'+esc(x.text)+'</p>'+
          '<div class="onboarding-dots">'+slides.map((_,i)=>'<span class="'+(i===index?"active":"")+'"></span>').join("")+'</div>'+
          '<div class="onboarding-actions">'+
            (index?'<button class="btn secondary" id="onboard-prev">ย้อนกลับ</button>':'<button class="btn secondary" id="onboard-skip">ข้าม</button>')+
            '<button class="btn" id="onboard-next">'+(index===slides.length-1?"เริ่มใช้งาน":"ถัดไป")+'</button>'+
          '</div>'+
        '</div>');
      icons();
      if($("onboard-prev"))$("onboard-prev").onclick=()=>{index--;render();};
      if($("onboard-skip"))$("onboard-skip").onclick=()=>{try{localStorage.setItem(onboardingKey(),"done");}catch(e){}closeModal();};
      $("onboard-next").onclick=()=>{
        if(index<slides.length-1){index++;render();}
        else{try{localStorage.setItem(onboardingKey(),"done");}catch(e){}closeModal();toast("พร้อมใช้งาน RSD Clean");}
      };
    };
    render();
  }
  async function deviceSessionsModal(){
    openModal("อุปกรณ์ที่เข้าสู่ระบบ",'<div id="device-sessions-body"><div class="muted">กำลังโหลดอุปกรณ์…</div></div>');
    const box=$("device-sessions-body");
    try{
      const rows=await rpc("sessions",{},true);
      if(!box?.isConnected)return;
      box.innerHTML=
        '<p class="muted mb-4">หากพบอุปกรณ์ที่ไม่รู้จัก สามารถออกจากระบบอุปกรณ์นั้นได้ทันที</p>'+
        '<div class="device-list">'+rows.map(r=>
          '<div class="device-card '+(r.Current?"current":"")+'">'+
            '<span class="device-icon"><i data-lucide="'+(/iPhone|iPad|Android/.test(r.DeviceLabel)?"smartphone":"monitor")+'"></i></span>'+
            '<span class="device-copy"><b>'+esc(r.DeviceLabel||"อุปกรณ์เดิม")+(r.Current?' <span class="pill green">เครื่องนี้</span>':'')+'</b>'+
              '<small>ใช้งานล่าสุด '+esc(new Date(r.LastSeen).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"}))+'</small>'+
              '<small>หมดอายุ '+esc(new Date(r.ExpiresAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"}))+'</small></span>'+
            (!r.Current?'<button class="btn small danger session-logout" data-id="'+esc(r.SessionID)+'">ออกจากระบบ</button>':'')+
          '</div>'
        ).join("")+'</div>'+
        (rows.filter(x=>!x.Current).length?'<button class="btn danger w-full mt-4" id="logout-other-sessions">ออกจากระบบเครื่องอื่นทั้งหมด</button>':'');
      box.querySelectorAll(".session-logout").forEach(b=>b.onclick=async()=>{
        const ok=await Swal.fire({icon:"question",title:"ออกจากระบบอุปกรณ์นี้?",showCancelButton:true,confirmButtonText:"ออกจากระบบ",cancelButtonText:"ยกเลิก"});
        if(!ok.isConfirmed)return;
        await rpc("logoutSession",{sessionId:b.dataset.id},true);
        toast("ออกจากระบบอุปกรณ์แล้ว");
        await deviceSessionsModal();
      });
      if($("logout-other-sessions"))$("logout-other-sessions").onclick=async()=>{
        const ok=await Swal.fire({icon:"warning",title:"ออกจากระบบเครื่องอื่นทั้งหมด?",showCancelButton:true,confirmButtonText:"ยืนยัน",cancelButtonText:"ยกเลิก"});
        if(!ok.isConfirmed)return;
        await rpc("logoutOtherSessions",{},true);
        toast("ออกจากระบบเครื่องอื่นแล้ว");
        await deviceSessionsModal();
      };
      icons();
    }catch(e){box.innerHTML='<div class="warn">'+esc(e.message||String(e))+'</div>';}
  }

  function mobileQuickAction() {
    if (!S.user) {
      location.hash = "login";
      return;
    }
    if (S.user.Role === "Inspector") {
      if (typeof scanQrModal === "function") {
        scanQrModal();
      } else {
        location.hash = "tasks";
      }
      return;
    }
    if (S.user.Role === "Admin") {
      location.hash = "admin";
      setTimeout(() => {
        const add = $("add-row");
        if (add) add.click();
      }, 350);
      return;
    }
    if (S.user.Role === "Supervisor") {
      location.hash = "reports";
      return;
    }
    if (S.user.Role === "Teacher") {
      location.hash = "teacher";
      setTimeout(() => route(), 50);
      return;
    }
  }

  function mobileMoreMenu() {
    if (!S.user) {
      location.hash = "login";
      return;
    }
    openModal(
      "เมนู",
      '<div class="mobile-more-user">' +
        '<div class="mobile-more-avatar"><i data-lucide="user-round"></i></div>' +
        '<div><b>' + esc(S.user.FullName) + '</b><div class="muted">' + esc(S.user.Role) + '</div></div>' +
      '</div>' +
      '<div class="mobile-more-grid">' +
        (["Admin","Supervisor"].includes(S.user.Role) ? '<button class="mobile-more-item" id="mobile-executive" type="button"><i data-lucide="briefcase-business"></i><span>Dashboard ผู้บริหาร</span></button><button class="mobile-more-item" id="mobile-review" type="button"><i data-lucide="badge-check"></i><span>รับรองผลตรวจ</span></button><button class="mobile-more-item" id="mobile-history" type="button"><i data-lucide="history"></i><span>ประวัติพื้นที่/ห้อง</span></button><button class="mobile-more-item" id="mobile-exports" type="button"><i data-lucide="file-down"></i><span>ส่งออก Excel/PDF</span></button><button class="mobile-more-item" id="mobile-dashboard" type="button"><i data-lucide="layout-dashboard"></i><span>ภาพรวมทั่วไป</span></button>' : '') +
        (["Inspector"].includes(S.user.Role) ? '<button class="mobile-more-item" id="mobile-history" type="button"><i data-lucide="history"></i><span>ประวัติพื้นที่</span></button>' : '') +
        (["Teacher"].includes(S.user.Role) ? '<button class="mobile-more-item" id="mobile-history" type="button"><i data-lucide="history"></i><span>ประวัติห้องเรียน</span></button><button class="mobile-more-item" id="mobile-exports" type="button"><i data-lucide="file-down"></i><span>ส่งออก Excel/PDF</span></button>' : '') +
        (["Admin","Supervisor","Inspector"].includes(S.user.Role) ? '<button class="mobile-more-item" id="mobile-daily-report" type="button"><i data-lucide="send"></i><span>รายงานรายวัน</span></button>' : '') +
        (!isStandaloneApp() ? '<button class="mobile-more-item install-btn" type="button"><i data-lucide="download"></i><span>ติดตั้งแอป</span></button>' : '') +
        '<button class="mobile-more-item" id="mobile-devices" type="button"><i data-lucide="monitor-smartphone"></i><span>อุปกรณ์ที่เข้าสู่ระบบ</span></button>' +
        '<button class="mobile-more-item" id="mobile-guide" type="button"><i data-lucide="circle-help"></i><span>คู่มือใช้งาน</span></button>' +
        '<button class="mobile-more-item" id="mobile-change-pass" type="button"><i data-lucide="key-round"></i><span>เปลี่ยนรหัสผ่าน</span></button>' +
        '<button class="mobile-more-item" id="mobile-refresh" type="button"><i data-lucide="refresh-cw"></i><span>รีเฟรชข้อมูล</span></button>' +
        '<button class="mobile-more-item danger-item" id="mobile-logout" type="button"><i data-lucide="log-out"></i><span>ออกจากระบบ</span></button>' +
      '</div>'
    );
    wireInstallButtons();
    icons();
    refreshNotificationBadge();
    if ($("mobile-executive")) $("mobile-executive").onclick = () => { closeModal(); location.hash="executive"; route(); };
    if ($("mobile-review")) $("mobile-review").onclick = () => { closeModal(); location.hash="review"; route(); };
    if ($("mobile-history")) $("mobile-history").onclick = () => { closeModal(); location.hash="history"; route(); };
    if ($("mobile-exports")) $("mobile-exports").onclick = () => { closeModal(); location.hash="exports"; route(); };
    if ($("mobile-dashboard")) $("mobile-dashboard").onclick = () => { closeModal(); location.hash="dashboard"; route(); };
    if ($("mobile-daily-report")) $("mobile-daily-report").onclick = () => { closeModal(); location.hash="daily"; route(); };
    if ($("mobile-devices")) $("mobile-devices").onclick = () => { closeModal(); deviceSessionsModal(); };
    if ($("mobile-guide")) $("mobile-guide").onclick = () => { closeModal(); showOnboarding(true); };
    if ($("mobile-change-pass")) $("mobile-change-pass").onclick = () => {
      closeModal();
      passwordModal();
    };
    if ($("mobile-refresh")) $("mobile-refresh").onclick = async () => {
      closeModal();
      await route();
      toast("รีเฟรชข้อมูลแล้ว");
    };
    if ($("mobile-logout")) $("mobile-logout").onclick = async () => {
      try { await rpc("logout"); } catch (e) {}
      clearSession();
      closeModal();
      location.hash = "login";
      route();
    };
  }

  function nav() {
    const keys = S.user
      ? Object.keys(pages).filter((k) => pages[k].roles.includes(S.user.Role))
      : ["dashboard"];

    const desktopLinks = keys
      .map(
        (k) =>
          '<a class="nav-link desktop-nav-link ' +
          (S.route === k ? "active" : "") +
          '" href="#' + k + '" aria-label="' + esc(pages[k].title) + '">' +
          '<i data-lucide="' + pages[k].icon + '"></i><span>' + esc(pages[k].title) + "</span></a>",
      )
      .join("");

    const mobileLink = (k, slot) =>
      '<a class="mobile-nav-item mobile-slot-' + slot + ' ' + (S.route === k ? "active" : "") +
      '" href="#' + k + '" aria-label="' + esc(pages[k].title) + '">' +
      '<i data-lucide="' + pages[k].icon + '"></i><span>' + esc(pages[k].title) + '</span></a>';
    const spacer = (slot) => '<span class="mobile-nav-spacer mobile-slot-' + slot + '" aria-hidden="true"></span>';
    const notificationItem = S.user
      ? '<button class="mobile-nav-item mobile-slot-2 notification-mobile-btn" id="mobile-notification-btn" type="button" aria-label="แจ้งเตือน">' +
          '<span class="menu-icon-with-badge"><i data-lucide="bell"></i><b class="notification-badge hidden">0</b></span><span>แจ้งเตือน</span></button>'
      : '<button class="mobile-nav-item mobile-slot-2 install-btn" type="button"><i data-lucide="download"></i><span>ติดตั้ง</span></button>';

    let slot1 = mobileLink("dashboard",1);
    let slot4 = spacer(4);
    let fabIcon = "layout-dashboard";
    let fabText = "ภาพรวม";

    if (S.user?.Role === "Inspector") {
      slot1 = mobileLink("dashboard",1);
      slot4 = mobileLink("tasks",4);
      fabIcon = "scan-line";
      fabText = "สแกน";
    } else if (S.user?.Role === "Admin") {
      slot1 = mobileLink("executive",1);
      slot4 = mobileLink("reports",4);
      fabIcon = "plus";
      fabText = "เพิ่ม";
    } else if (S.user?.Role === "Supervisor") {
      slot1 = mobileLink("executive",1);
      slot4 = mobileLink("dashboard",4);
      fabIcon = "chart-no-axes-column-increasing";
      fabText = "รายงาน";
    } else if (S.user?.Role === "Teacher") {
      slot1 = mobileLink("teacher",1);
      slot4 = spacer(4);
      fabIcon = "refresh-cw";
      fabText = "รีเฟรช";
    } else if (!S.user) {
      slot1 = mobileLink("dashboard",1);
      slot4 = spacer(4);
      fabIcon = "log-in";
      fabText = "เข้าสู่ระบบ";
    }

    $("nav").innerHTML =
      '<div class="desktop-nav">' + desktopLinks + '</div>' +
      '<div class="mobile-bottom-nav">' +
        slot1 +
        notificationItem +
        '<button class="mobile-fab mobile-slot-3" id="mobile-fab" type="button" aria-label="' + esc(fabText) + '">' +
          '<i data-lucide="' + fabIcon + '"></i><span>' + esc(fabText) + '</span></button>' +
        slot4 +
        (S.user
          ? '<button class="mobile-nav-item mobile-slot-5" id="mobile-more" type="button"><i data-lucide="menu"></i><span>เมนู</span></button>'
          : '<a class="mobile-nav-item mobile-slot-5" href="#login"><i data-lucide="user-round"></i><span>เข้าสู่ระบบ</span></a>') +
      '</div>';

    const install = !isStandaloneApp()
      ? '<button class="btn small secondary install-btn" type="button" aria-label="ติดตั้งแอป"><i data-lucide="download"></i><span class="account-label">ติดตั้ง</span></button>'
      : "";
    $("account").innerHTML = S.user
      ? '<div class="account-user"><span class="account-name">' + esc(S.user.FullName) + '</span>' +
        '<button class="btn small secondary notification-btn" id="notification-btn" type="button" aria-label="แจ้งเตือน"><span class="menu-icon-with-badge"><i data-lucide="bell"></i><b class="notification-badge hidden">0</b></span><span class="account-label">แจ้งเตือน</span></button>' +
        '<button class="btn small secondary" id="devices-btn" type="button" aria-label="อุปกรณ์"><i data-lucide="monitor-smartphone"></i><span class="account-label">อุปกรณ์</span></button>' +
        install +
        '<button class="btn small secondary" id="change-pass" type="button" aria-label="เปลี่ยนรหัสผ่าน"><i data-lucide="key-round"></i><span class="account-label">รหัสผ่าน</span></button>' +
        '<button class="btn small secondary" id="logout" type="button" aria-label="ออกจากระบบ"><i data-lucide="log-out"></i><span class="account-label">ออก</span></button></div>'
      : install + '<a class="btn small" href="#login"><i data-lucide="log-in"></i><span class="account-label">เข้าสู่ระบบ</span></a>';

    if ($("mobile-fab")) $("mobile-fab").onclick = mobileQuickAction;
    if ($("mobile-more")) $("mobile-more").onclick = mobileMoreMenu;
    if ($("mobile-notification-btn")) $("mobile-notification-btn").onclick = notificationCenterModal;
    if ($("notification-btn")) $("notification-btn").onclick = notificationCenterModal;
    if ($("devices-btn")) $("devices-btn").onclick = deviceSessionsModal;

    if (S.user) {
      $("logout").onclick = async () => {
        try { await rpc("logout"); } catch (e) {}
        clearSession();
        location.hash = "login";
        route();
      };
      $("change-pass").onclick = passwordModal;
    }
    wireInstallButtons();
    icons();
    if(S.user) setTimeout(refreshNotificationBadge,S.user.Role==="Inspector"&&S.route==="tasks"?1200:0);
  }
  async function route() {
    const seq = ++S.seq;
    S.charts.forEach((c) => c.destroy());
    S.charts = [];
    if (!S.scanToken) S.scanToken = getPendingQr();
    let p = (location.hash.slice(1).split("?")[0] || "home");
    if(p==="home") p=homeRouteForUser();
    if (S.user && p === "login") p = homeRouteForUser();
    if (S.user && p === "dashboard" && S.user.Role === "Teacher") p = "teacher";
    if (S.user && S.scanToken && S.user.Role === "Inspector") p = "tasks";
    if (!S.user && p !== "dashboard") p = "login";
    if (S.user && pages[p] && !pages[p].roles.includes(S.user.Role))
      p = homeRouteForUser();
    if (!pages[p] && p !== "login") p = "dashboard";
    S.route = p;
    nav();
    $("nav").classList.remove("open");
    try {
      if (p === "login") renderLogin();
      else if (p === "dashboard") await renderDashboard(seq);
      else if (p === "executive") await renderExecutiveDashboard(seq);
      else if (p === "admin") await renderAdmin(seq);
      else if (p === "reports") await renderReports(seq);
      else if (p === "daily") await renderDailyReport(seq);
      else if (p === "review") await renderReviewQueue(seq);
      else if (p === "history") await renderHistoryHub(seq);
      else if (p === "exports") await renderExportCenter(seq);
      else if (p === "tasks") await renderTasks(seq);
      else if (p === "teacher") await renderTeacher(seq);
    } catch (e) {
      error(e);
    }
  }
  async function derive(password, salt) {
    const enc = new TextEncoder(),
      key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
        "deriveBits",
      ]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: enc.encode(salt), iterations: 600000, hash: "SHA-256" },
      key,
      256,
    );
    return [...new Uint8Array(bits)].map((n) => n.toString(16).padStart(2, "0")).join("");
  }
  async function newCredential(pass) {
    if (pass.length < 4) throw Error("รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร");
    const salt = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    return { scheme: "pbkdf2", salt, proof: await derive(pass, salt) };
  }
  async function proofFor(username, password) {
    const c = await rpc("challenge", { username }, true);
    return c.scheme === "bootstrap" ? password : derive(password, c.salt);
  }
  function renderLogin() {
    $("app").innerHTML =
      '<section class="card login-shell">' +
        '<div class="login-visual">' +
          '<div class="login-logo-box"><img src="' + SCHOOL_LOGO_URL + '" alt="ตราโรงเรียนรัษฎา" onerror="this.onerror=null;this.src=\'/icon-192.png\'"></div>' +
          '<div><span class="login-chip">RSD CLEAN · SCHOOL APP</span><h1 class="mt-4">พื้นที่สะอาด<br>สร้างได้ทุกวัน</h1><p>ระบบตรวจความสะอาดและให้คะแนนเขตพื้นที่ โรงเรียนรัษฎา ใช้งานได้ทั้งคอมพิวเตอร์และมือถือ</p></div>' +
        '</div>' +
        '<div class="login-form-panel">' +
          '<h1 class="page-title">ยินดีต้อนรับ</h1><p class="muted mt-1">เข้าสู่ระบบเพื่อเริ่มใช้งาน RSD Clean</p>' +
          '<form id="login-form"><div class="field"><label for="username">ชื่อผู้ใช้</label><input id="username" autocomplete="username" autocapitalize="none" required maxlength="80" placeholder="ชื่อผู้ใช้"></div>' +
          '<div class="field"><label for="password">รหัสผ่าน</label><input id="password" type="password" autocomplete="current-password" required maxlength="200" placeholder="รหัสผ่าน"></div>' +
          '<label class="remember-login"><input id="remember-login" type="checkbox" checked><span><b>จำการเข้าสู่ระบบบนอุปกรณ์นี้</b><small>เหมาะสำหรับมือถือส่วนตัว · ต่ออายุการเข้าสู่ระบบอัตโนมัติเมื่อใช้งาน</small></span></label>' +
          '<button class="btn w-full mt-4" type="submit"><i data-lucide="log-in"></i> เข้าสู่ระบบ</button></form>' +
          '<button class="btn secondary w-full mt-3 install-btn" id="login-install-app" type="button"><i data-lucide="download"></i> ติดตั้ง RSD Clean ลงมือถือ</button>' +
          '<div class="login-install-note"><i data-lucide="smartphone"></i><span>เมื่อติดตั้งแล้ว เปิดจากไอคอนบนหน้าจอหลักได้ทันที และไม่ต้องกรอกรหัสผ่านใหม่ทุกครั้งบนอุปกรณ์ส่วนตัว</span></div>' +
        '</div>' +
      '</section>';
    wireInstallButtons();
    icons();
    $("login-form").onsubmit = async (e) => {
      e.preventDefault();
      busy(true, "กำลังตรวจสอบสิทธิ์…");
      try {
        const username = $("username").value.trim().toLowerCase(),
          proof = await proofFor(username, $("password").value),
          remember = $("remember-login").checked,
          r = await rpc("login", { username, proof, remember, client:getDeviceIdentity() }, true);
        S.token = r.token;
        S.user = r.user;
        S.config = r.settings || S.config;
        storeSession(r.token, remember);
        try { localStorage.setItem("rsd-user-cache",JSON.stringify(r.user)); localStorage.setItem("rsd-config-cache",JSON.stringify(S.config||{})); } catch(e) {}
        if (remember && navigator.storage?.persist) navigator.storage.persist().catch(() => {});
        S.scanToken = getPendingQr();
        S.scanHandled = false;
        location.hash = "home";
        await route();
        setTimeout(()=>showOnboarding(false),350);
        if (S.scanToken && S.user.Role !== "Inspector")
          await Swal.fire({
            icon: "info",
            title: "QR สำหรับผู้ตรวจ",
            text: "QR จุดตรวจใช้ได้กับบัญชีผู้ตรวจ (Inspector) เท่านั้น",
            confirmButtonText: "ตกลง",
          });
        if (r.mustChange) passwordModal();
      } catch (e) {
        error(e);
      } finally {
        busy(false);
      }
    };
  }
  function passwordModal() {
    openModal(
      "เปลี่ยนรหัสผ่าน",
      '<form id="pass-form"><p class="muted">ตั้งรหัสผ่านอย่างน้อย 4 ตัวอักษร เมื่อเปลี่ยนแล้วต้องเข้าสู่ระบบใหม่</p><div class="field"><label>รหัสผ่านเดิม</label><input name="old" type="password" autocomplete="current-password" required></div><div class="field"><label>รหัสผ่านใหม่</label><input name="new" type="password" autocomplete="new-password" minlength="4" maxlength="200" required></div><button class="btn">บันทึกรหัสผ่าน</button></form>',
    );
    $("pass-form").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      busy(true);
      try {
        await rpc(
          "password",
          {
            oldProof: await proofFor(S.user.Username, f.elements.old.value),
            credential: await newCredential(f.elements.new.value),
          },
          true,
        );
        closeModal();
        clearSession();
        location.hash = "login";
        await route();
        toast("เปลี่ยนรหัสผ่านแล้ว");
      } catch (e) {
        error(e);
      } finally {
        busy(false);
      }
    };
  }
  async function renderDashboard(seq) {
    $("app").innerHTML =
      heading(
        "พื้นที่สะอาด บรรยากาศดี 🌿",
        "ติดตามการดูแลพื้นที่และความร่วมมือของทุกห้องเรียน",
        '<input type="date" id="dashboard-date" class="control" style="width:180px" value="' +
          thaiDay() +
          '">',
      ) + '<div id="dashboard-content"></div>';
    $("dashboard-date").onchange = () => loadDashboard(false).catch(error);
    await loadDashboard(false, seq);
  }
  async function loadDashboard(silent = false, seq = S.seq) {
    const date = $("dashboard-date")?.value;
    if (!date) return;
    const d = await rpc(S.user ? "dashboard" : "publicDashboard", { date }, silent);
    if (seq !== S.seq || $("dashboard-date")?.value !== date) return;
    S.charts.forEach((c) => c.destroy());
    S.charts = [];
    $("dashboard-content").innerHTML =
      '<div class="grid sm:grid-cols-3 gap-5 mb-6">' +
      [
        ["พื้นที่ทั้งหมด", d.areas, "🏫"],
        ["ตรวจแล้ววันนี้ / วันที่เลือก", d.done, "✅"],
        ["รอตรวจตามงานที่กำหนด", d.pending, "⏳"],
      ]
        .map(
          ([t, n, icon]) =>
            '<div class="card"><div class="flex justify-between muted">' +
            t +
            "<span>" +
            icon +
            '</span></div><div class="kpi">' +
            n +
            "</div></div>",
        )
        .join("") +
      '</div><div class="grid lg:grid-cols-2 gap-6 mb-6"><section class="card"><h2 class="font-medium mb-5">ผลประเมินประจำวันที่เลือก</h2><div class="chart-box"><canvas id="donut"></canvas></div></section><section class="card"><h2 class="font-medium mb-5">🏆 Top 5 ห้องเรียน · 30 วันถึงวันที่เลือก</h2><div class="chart-box"><canvas id="leader-chart"></canvas></div></section></div><section class="card"><h2 class="font-medium mb-4">ผลตรวจล่าสุด</h2>' +
      (S.user
        ? table(
            ["พื้นที่", "ห้องเรียน", "ผลประเมิน"],
            d.feed.map((x) => [esc(x.area), esc(x.className), pill(x.score, x.rating)]),
          )
        : '<p class="muted">เข้าสู่ระบบเพื่อดูรายละเอียดผลตรวจ</p>') +
      '</section><p class="muted text-right mt-3" id="poll-status">อัปเดต ' +
      new Date(d.updatedAt).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" }) +
      " · รีเฟรชอัตโนมัติทุก 60 วินาที</p>";
    if (d.isHoliday) {
      const notice = document.createElement("p");
      notice.className = "card mb-5 text-cyan-800";
      notice.textContent =
        "วันหยุด — ทั้งโรงเรียนไม่มีผลตรวจในวันนี้ จึงไม่นับงานค้างหรือวันขาดข้อมูล";
      $("dashboard-content").prepend(notice);
    }
    if (window.Chart) {
      Chart.defaults.font.family = "Kanit";
      Chart.defaults.color = "#718497";
      S.charts.push(
        new Chart($("donut"), {
          type: "doughnut",
          data: {
            labels: ["ยอดเยี่ยม", "ปานกลาง", "ปรับปรุง"],
            datasets: [
              {
                data: d.counts,
                backgroundColor: ["#86efac", "#fde68a", "#fda4af"],
                borderWidth: 4,
                borderColor: "#fff",
              },
            ],
          },
          options: {
            maintainAspectRatio: false,
            cutout: "73%",
            plugins: { legend: { position: "bottom" } },
          },
        }),
      );
      S.charts.push(
        new Chart($("leader-chart"), {
          type: "bar",
          data: {
            labels: d.leaders.map((x) => x.name),
            datasets: [
              {
                label: "คะแนนเฉลี่ย",
                data: d.leaders.map((x) => Number(x.average ?? x.avg ?? 0)),
                backgroundColor: "#67d8e5",
                borderRadius: 8,
              },
            ],
          },
          options: {
            indexAxis: "y",
            maintainAspectRatio: false,
            scales: { x: { min: 0, max: 3 } },
            plugins: { legend: { display: false } },
          },
        }),
      );
    }
  }
  document.addEventListener("click", (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (link) {
      e.preventDefault();
      location.hash = link.getAttribute("href");
    }
  });
  window.addEventListener("hashchange", route);
  setInterval(async () => {
    if (
      document.hidden ||
      S.busy ||
      S.polling ||
      S.route !== "dashboard" ||
      !$("modal").classList.contains("hidden")
    )
      return;
    S.polling = true;
    try {
      await loadDashboard(true);
    } catch (e) {
      if ($("poll-status")) $("poll-status").textContent = "เชื่อมต่อขัดข้อง · จะลองใหม่อัตโนมัติ";
    } finally {
      S.polling = false;
    }
  }, 60000);
  function updateNetworkStatus() {
    const bar = $("network-status");
    if (!bar) return;
    bar.classList.toggle("hidden", navigator.onLine);
  }
  window.addEventListener("online", async () => {
    updateNetworkStatus();
    if (typeof window.syncOfflineInspections === "function") {
      try { await window.syncOfflineInspections(false); } catch(e) {}
    }
    refreshNotificationBadge();
  });
  window.addEventListener("offline", () => {
    updateNetworkStatus();
    refreshNotificationBadge();
  });

  window.addEventListener("DOMContentLoaded", async () => {
    placeNavigation();
    updateNetworkStatus();
    wireInstallButtons();
    if (S.token) {
      try {
        const b = await rpc("bootstrap");
        S.user = b.user;
        S.config = b.settings || S.config;
        try { localStorage.setItem("rsd-user-cache",JSON.stringify(b.user)); localStorage.setItem("rsd-config-cache",JSON.stringify(S.config||{})); } catch(e) {}
      } catch (e) {
        let cached=null,cachedConfig=null;
        try { cached=JSON.parse(localStorage.getItem("rsd-user-cache")||"null"); cachedConfig=JSON.parse(localStorage.getItem("rsd-config-cache")||"null"); } catch(x) {}
        if(S.token&&cached){ S.user=cached; S.config=cachedConfig||S.config; }
        else clearSession();
      }
    }
    await route();
    if(S.user)setTimeout(()=>showOnboarding(false),450);
    if(navigator.onLine&&S.user&&typeof window.syncOfflineInspections==="function"){
      try{await window.syncOfflineInspections(false);}catch(e){}
    }
  });

  if ("serviceWorker" in navigator) {
    let reloadingForUpdate=false,updatePromptOpen=false;
    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      if(reloadingForUpdate)return;
      reloadingForUpdate=true;
      location.reload();
    });
    async function offerUpdate(reg){
      if(updatePromptOpen||!reg?.waiting)return;
      updatePromptOpen=true;
      const r=await Swal.fire({
        icon:"info",
        title:"RSD Clean มีเวอร์ชันใหม่",
        text:"อัปเดตตอนนี้เพื่อรับฟังก์ชันและการแก้ไขล่าสุด",
        showCancelButton:true,
        confirmButtonText:"อัปเดตตอนนี้",
        cancelButtonText:"ไว้ภายหลัง",
        confirmButtonColor:"#0f766e"
      });
      updatePromptOpen=false;
      if(r.isConfirmed&&reg.waiting)reg.waiting.postMessage({type:"SKIP_WAITING"});
    }
    window.addEventListener("load", async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        if(reg.waiting&&navigator.serviceWorker.controller) offerUpdate(reg);
        reg.addEventListener("updatefound",()=>{
          const worker=reg.installing;
          if(!worker)return;
          worker.addEventListener("statechange",()=>{
            if(worker.state==="installed"&&navigator.serviceWorker.controller) offerUpdate(reg);
          });
        });
        reg.update().catch(()=>{});
      } catch (e) {}
    });
  }
