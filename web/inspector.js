let taskRows = [];
  let inspectorMapLayout={shapes:[]};
  function inspectorTeamLabel(i) {
    const names = Array.isArray(i?.meta?.inspectorNames) ? i.meta.inspectorNames.filter(Boolean) : [];
    if (names.length > 1) return "ทีมผู้ตรวจ: " + names.join(", ");
    return names.length === 1 ? "ผู้ตรวจ: " + names[0] : "";
  }
  function taskCacheKey(){
    return "rsd-task-cache:" + (S.user?.UserID||"") + ":" + thaiDay();
  }
  function saveTaskCache(rows,rewards){
    try{localStorage.setItem(taskCacheKey(),JSON.stringify({at:Date.now(),rows,rewards}));}catch(e){}
  }
  function loadTaskCache(){
    try{
      const x=JSON.parse(localStorage.getItem(taskCacheKey())||"null");
      return x&&Array.isArray(x.rows)&&Array.isArray(x.rewards)?x:null;
    }catch(e){return null;}
  }
  async function offlinePendingMap(){
    if(!window.rsdOfflineQueue||!S.user)return new Map();
    try{
      const rows=await window.rsdOfflineQueue.list(S.user.UserID);
      return new Map(rows.map(x=>[x.inspectionId,x]));
    }catch(e){return new Map();}
  }
  function offlineNetworkError(e){
    const m=String(e?.message||e||"");
    return !navigator.onLine || /Failed to fetch|Load failed|NetworkError|เชื่อมต่อ API|API HTTP|Drive ชั่วคราว|นานเกินไป/i.test(m);
  }

  function inspectorMapCacheKey(){return "rsd-inspector-area-map-v1";}
  function saveInspectorMapCache(layout){try{localStorage.setItem(inspectorMapCacheKey(),JSON.stringify(layout||{shapes:[]}));}catch(e){}}
  function loadInspectorMapCache(){try{return JSON.parse(localStorage.getItem(inspectorMapCacheKey())||'{"shapes":[]}');}catch(e){return{shapes:[]};}}
  function inspectorMapStatus(item){
    if(!item)return{key:"other_area",label:"พื้นที่อื่น",color:"#cbd5e1"};
    if(item._offlinePending)return{key:"offline",label:"รอซิงก์",color:"#8b5cf6"};
    if(item.StatusKey)return{key:item.StatusKey,label:item.StatusLabel||item.StatusKey,color:item.StatusColor||"#94a3b8"};
    if(item.Status==="งดตรวจ")return{key:"skipped",label:"งดตรวจ",color:"#64748b"};
    if(item.Status==="รอตรวจ")return{key:"pending",label:"รอตรวจ",color:"#facc15"};
    if(item.Status==="ตรวจแล้ว"){
      if(Number(item.Score)===3)return{key:"excellent",label:S.config?.scoreLabels?.["3"]||"ยอดเยี่ยม",color:"#22c55e"};
      if(Number(item.Score)===2)return{key:"medium",label:S.config?.scoreLabels?.["2"]||"ปานกลาง",color:"#f59e0b"};
      if(Number(item.Score)===1)return{key:"improve",label:S.config?.scoreLabels?.["1"]||"ปรับปรุง",color:"#ef4444"};
      return{key:"done",label:"ตรวจแล้ว",color:"#14b8a6"};
    }
    return{key:"other_area",label:item.Status||"งานตรวจ",color:"#38bdf8"};
  }
  function inspectorMapCenter(s){
    if(s.ShapeType==="polygon"&&Array.isArray(s.Points)&&s.Points.length){
      const sum=s.Points.reduce((a,p)=>({x:a.x+Number(p.x||0),y:a.y+Number(p.y||0)}),{x:0,y:0});
      return{x:sum.x/s.Points.length,y:sum.y/s.Points.length};
    }
    return{x:Number(s.X||0)+Number(s.Width||0)/2,y:Number(s.Y||0)+Number(s.Height||0)/2};
  }
  function inspectorTaskMapHtml(todayRows){
    const shapes=inspectorMapLayout?.shapes||[];
    if(!shapes.length)return '<section class="card inspector-map-card mb-5"><div class="inspector-map-head"><div><span class="muted">ตำแหน่งงานวันนี้</span><h2>พื้นที่ของฉันบนผัง</h2></div></div><div class="inspector-map-empty">ยังไม่มีผังพื้นที่ในระบบ</div></section>';
    if(!todayRows.length)return '<section class="card inspector-map-card mb-5"><div class="inspector-map-head"><div><span class="muted">ตำแหน่งงานวันนี้</span><h2>พื้นที่ของฉันบนผัง</h2></div></div><div class="inspector-map-empty">วันนี้ไม่มีพื้นที่ที่ได้รับมอบหมาย</div></section>';

    const byArea=new Map(todayRows.map(x=>[String(x.meta?.areaId||""),x])),
      counts={pending:0,excellent:0,medium:0,improve:0,skipped:0,offline:0};
    todayRows.forEach(x=>{const st=inspectorMapStatus(x);counts[st.key]=(counts[st.key]||0)+1;});

    let ref="";try{ref=localStorage.getItem("rsd-area-map-reference-v1")||"";}catch(e){}
    let opacity=.55;try{opacity=Math.max(.1,Math.min(.8,Number(localStorage.getItem("rsd-area-map-reference-opacity-v1")||55)/100));}catch(e){}
    const reference=ref?'<image href="'+ref+'" x="0" y="0" width="1600" height="1000" opacity="'+opacity+'" pointer-events="none"/>':"";
    const body=shapes.map(s=>{
      const item=byArea.get(String(s.AreaID)),status=inspectorMapStatus(item),center=inspectorMapCenter(s),mine=!!item,
        geo=s.ShapeType==="polygon"
          ? '<polygon points="'+(s.Points||[]).map(p=>Number(p.x)+","+Number(p.y)).join(" ")+'" fill="'+status.color+'"/>'
          : '<rect x="'+Number(s.X||0)+'" y="'+Number(s.Y||0)+'" width="'+Number(s.Width||0)+'" height="'+Number(s.Height||0)+'" rx="10" fill="'+status.color+'"/>';
      return '<g class="inspector-map-shape '+(mine?"mine status-"+status.key:"other")+'" '+(mine?'data-area="'+esc(s.AreaID)+'" tabindex="0" role="button"':"")+'>'+geo+
        (mine?'<text x="'+center.x+'" y="'+(center.y-5)+'" text-anchor="middle"><tspan x="'+center.x+'">'+esc(item.meta?.areaName||"พื้นที่")+'</tspan><tspan class="sub" x="'+center.x+'" dy="18">'+esc(item.meta?.className||"")+'</tspan></text>':"")+
      '</g>';
    }).join("");

    const legend=[
      ["#facc15","รอตรวจ",counts.pending],["#22c55e",S.config?.scoreLabels?.["3"]||"ยอดเยี่ยม",counts.excellent],
      ["#f59e0b",S.config?.scoreLabels?.["2"]||"ปานกลาง",counts.medium],["#ef4444",S.config?.scoreLabels?.["1"]||"ปรับปรุง",counts.improve],
      ["#64748b","งดตรวจ",counts.skipped],["#8b5cf6","รอซิงก์",counts.offline]
    ].filter(x=>x[2]>0).map(x=>'<span><i style="background:'+x[0]+'"></i>'+esc(x[1])+' <b>'+x[2]+'</b></span>').join("");

    return '<section class="card inspector-map-card mb-5"><div class="inspector-map-head"><div><span class="muted">แตะพื้นที่เพื่อไปยังงาน</span><h2>พื้นที่ของฉันบนผัง</h2></div><button class="btn small secondary" id="inspector-map-toggle" type="button">ซ่อนผัง</button></div>'+
      '<div class="inspector-map-legend">'+legend+'</div>'+
      '<div class="inspector-map-scroll" id="inspector-map-body"><svg viewBox="0 0 1600 1000" aria-label="ผังพื้นที่งานตรวจของฉัน"><rect width="1600" height="1000" fill="#fff"/>'+reference+body+'</svg></div></section>';
  }
  function wireInspectorTaskMap(){
    const body=$("inspector-map-body"),toggle=$("inspector-map-toggle");
    if(toggle&&body)toggle.onclick=()=>{
      const hidden=body.classList.toggle("hidden");
      toggle.textContent=hidden?"แสดงผัง":"ซ่อนผัง";
    };
    document.querySelectorAll(".inspector-map-shape.mine").forEach(el=>{
      const go=()=>{
        const area=String(el.dataset.area||""),
          card=[...document.querySelectorAll(".task-grid article[data-area-id]")].find(x=>String(x.dataset.areaId)===area);
        if(!card)return;
        card.scrollIntoView({behavior:"smooth",block:"center"});
        card.classList.add("task-map-focus");
        setTimeout(()=>card.classList.remove("task-map-focus"),1800);
      };
      el.onclick=go;
      el.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();go();}};
    });
  }

  async function renderTasks(seq) {
    let rows,rewards,offlineView=false;
    if(!navigator.onLine){
      const cached=loadTaskCache();
      if(!cached) throw Error("ยังไม่มีรายการงานที่เก็บไว้ในเครื่อง กรุณาเชื่อมต่ออินเทอร์เน็ตอย่างน้อย 1 ครั้ง");
      rows=cached.rows;
      rewards=cached.rewards;
      inspectorMapLayout=loadInspectorMapCache();
      offlineView=true;
    }else{
      try{
        const [home,mapLayout]=await Promise.all([
          rpc("inspectorHome"),
          rpc("mapStatus",{date:thaiDay()},true).catch(()=>loadInspectorMapCache())
        ]);
        inspectorMapLayout=mapLayout||{shapes:[],items:[]};
        if(window.rsdEnsureMapReference)await window.rsdEnsureMapReference(inspectorMapLayout);
        if(inspectorMapLayout?.shapes?.length)saveInspectorMapCache(inspectorMapLayout);
        rows=home.tasks||[];
        rewards=home.rewards||[];
        if(home.settings){
          S.config=home.settings;
          try{localStorage.setItem("rsd-config-cache",JSON.stringify(home.settings));}catch(e){}
        }
        saveTaskCache(rows,rewards);
        if(home.notifications){
          window.rsdInspectorNotifications={data:home.notifications,at:Date.now()};
          const offline=await window.rsdOfflineQueue?.list(S.user.UserID).catch(()=>[])||[];
          const n=Math.min(99,Number(home.notifications.unread||0)+offline.length);
          document.querySelectorAll(".notification-badge").forEach(el=>{
            el.textContent=n>99?"99+":String(n);
            el.classList.toggle("hidden",!n);
          });
        }
      }catch(e){
        const cached=loadTaskCache();
        if(!cached) throw e;
        rows=cached.rows;
        rewards=cached.rewards;
        offlineView=true;
      }
    }
    if (seq !== S.seq) return;

    const pending=await offlinePendingMap();
    rows=rows.map(i=>{
      const q=pending.get(i.InspectionID);
      if(!q)return i;
      return {
        ...i,
        Status:q.payload.status,
        Score:Number(q.payload.score||0),
        Notes:q.payload.notes||"",
        _offlinePending:true,
        _offlineCreatedAt:q.createdAt,
        _offlineError:q.lastError||""
      };
    });
    taskRows = rows;
    const todayRows=rows.filter(i=>i.InspectionDate===thaiDay());
    const done = todayRows.filter((i) => i.Status === "ตรวจแล้ว" || i.Status === "งดตรวจ").length;
    const pendingCount=[...pending.values()].length;
    $("app").innerHTML =
      heading(
        "งานตรวจของฉัน 🔎",
        "งานประจำวันที่ " + thaiDay() + " · ดำเนินการแล้ว " + done + " จาก " + todayRows.length + " พื้นที่" + (S.config?.inspectionStart&&S.config?.inspectionEnd ? " · เวลาตรวจ "+S.config.inspectionStart+"–"+S.config.inspectionEnd+" น." : ""),
        '<div class="flex flex-wrap gap-2"><button class="btn" id="scan-qr"><span aria-hidden="true">▦</span> สแกน QR ณ จุดตรวจ</button><button class="btn secondary" id="refresh-tasks">รีเฟรช</button></div>',
      ) +
      (offlineView?'<div class="offline-work-notice mb-4"><b>โหมดออฟไลน์</b><span>กำลังใช้รายการงานล่าสุดที่เก็บไว้ในเครื่อง ผลตรวจใหม่จะซิงก์เมื่ออินเทอร์เน็ตกลับมา</span></div>':'') +
      (pendingCount?'<div class="offline-work-notice pending mb-4"><b>รอซิงก์ '+pendingCount+' รายการ</b><button class="btn small secondary" id="sync-now" type="button">ซิงก์ตอนนี้</button></div>':'') +
      inspectorTaskMapHtml(todayRows) +
      '<div class="task-filter-bar mb-4"><div class="search-box"><i data-lucide="search"></i><input id="task-search" type="search" placeholder="ค้นหาพื้นที่ / ห้องเรียน / หมายเหตุ…"></div><select id="task-status-filter" class="control"><option value="">ทุกสถานะ</option><option value="pending">รอตรวจ</option><option value="done">ตรวจแล้ว</option><option value="offline">รอซิงก์</option></select></div>' +
      '<div class="flex flex-wrap gap-2 mb-5">' +
      rewards
        .slice(-10)
        .map(
          (r) =>
            '<span class="pill yellow">🏅 ' +
            esc(r.Achievement) +
            " · " +
            esc(JSON.parse(r.Details).date || "") +
            "</span>",
        )
        .join("") +
      '</div><div class="task-grid">' +
      (rows.length
        ? rows
            .map(
              (i, index) =>
                '<article class="card'+(i._offlinePending?' offline-pending-card':'')+'" data-area-id="'+esc(i.meta.areaId||"")+'" data-task-status="'+(i._offlinePending?'offline':i.Status==="ตรวจแล้ว"?'done':'pending')+'" data-task-search="'+esc([i.meta.areaName,i.meta.className,i.Notes,inspectorTeamLabel(i)].filter(Boolean).join(" ").toLocaleLowerCase("th"))+'"><div class="flex justify-between items-center mb-4"><span class="muted">' +
                esc(i.meta.className) +
                "</span>" +
                (i._offlinePending?'<span class="pill offline-pill">รอซิงก์</span>':pill(i.Score)) +
                '</div>' +
                (i.InspectionDate!==thaiDay()?'<p class="pill red inline-flex mb-2">ส่งกลับแก้ไข · '+esc(i.InspectionDate)+'</p>':'')+
                '<h2 class="text-xl font-medium mb-2">' +
                esc(i.meta.areaName) +
                '</h2>' +
                (inspectorTeamLabel(i) ? '<p class="muted mb-2">' + esc(inspectorTeamLabel(i)) + '</p>' : '') +
                (i.meta.completedByName && !i._offlinePending ? '<p class="muted mb-2">ตรวจล่าสุดโดย ' + esc(i.meta.completedByName) + '</p>' : '') +
                (i.ApprovalStatus ? '<p class="muted mb-2">สถานะรับรอง: <b>'+esc(i.ApprovalStatus)+'</b>'+(i.ReviewNote?' · '+esc(i.ReviewNote):'')+'</p>' : '') +
                (i.SkipReason ? '<p class="muted mb-2">เหตุผลงดตรวจ: '+esc(i.SkipReason)+'</p>' : '') +
                (i._offlineError?'<p class="offline-error mb-2">ซิงก์ล่าสุดไม่สำเร็จ: '+esc(i._offlineError)+'</p>':'') +
                '<p class="muted min-h-10">' +
                esc(i.Notes || "ยังไม่มีหมายเหตุ") +
                '</p><div class="flex gap-2 mt-5"><button class="btn inspect-btn" data-index="' +
                index +
                '">' +
                (i._offlinePending ? "แก้ไขรายการรอซิงก์" : i.Status === "ตรวจแล้ว" ? "แก้ไขผลตรวจ" : "เริ่มตรวจพื้นที่") +
                "</button>" +
                '<a class="btn secondary" href="#history" data-history-type="area" data-history-id="'+esc(i.meta.areaId||"")+'">ประวัติพื้นที่</a>' +
                (i.PhotoLinks.length && !i._offlinePending
                  ? '<button class="btn secondary task-photo" data-index="' +
                    index +
                    '">ดูรูป</button>'
                  : "") +
                "</div></article>",
            )
            .join("")
        : '<div class="card empty">ไม่มีงานวันนี้ อาจเป็นวันหยุดหรือยังไม่ได้มอบหมายงาน</div>') +
      "</div>";
    const applyTaskFilter=()=>{
      const q=String($("task-search")?.value||"").trim().toLocaleLowerCase("th");
      const status=String($("task-status-filter")?.value||"");
      document.querySelectorAll(".task-grid article[data-task-status]").forEach(card=>{
        const matchText=!q||String(card.dataset.taskSearch||"").includes(q);
        const matchStatus=!status||card.dataset.taskStatus===status;
        card.style.display=matchText&&matchStatus?"":"none";
      });
    };
    if($("task-search")) $("task-search").oninput=applyTaskFilter;
    if($("task-status-filter")) $("task-status-filter").onchange=applyTaskFilter;
    icons();
    wireInspectorTaskMap();
    $("refresh-tasks").onclick = route;
    $("scan-qr").onclick = scanQrModal;
    if($("sync-now")) $("sync-now").onclick=()=>window.syncOfflineInspections?.(true);
    document
      .querySelectorAll(".inspect-btn")
      .forEach(
        (b) =>
          (b.onclick = () => {
            const row=rows[Number(b.dataset.index)];
            const queued=pending.get(row.InspectionID);
            inspectionModal(row,queued||null);
          }),
      );
    document
      .querySelectorAll(".task-photo")
      .forEach((b) => (b.onclick = () => showPhoto(rows[Number(b.dataset.index)])));
    if (S.scanToken && !S.scanHandled) {
      S.scanHandled = true;
      setTimeout(() => openQrTask(S.scanToken), 0);
    }
  }
  function qrTokenFromScan(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      return new URL(raw).searchParams.get("qr") || "";
    } catch (e) {
      return raw.includes(".") && !raw.includes(" ") ? raw : "";
    }
  }
  async function openQrTask(token) {
    busy(true, "กำลังตรวจสอบ QR จุดตรวจ…");
    try {
      const task = await rpc("qrTask", { token }, true);
      const local = taskRows.find((i) => i.InspectionID === task.InspectionID) || task;
      markQrConsumed(token);
      clearPendingQr();
      S.scanToken = "";
      S.scanHandled = true;
      inspectionModal(local);
    } catch (e) {
      const message=String(e?.message||e||"");
      const nonRetriable=/ไม่ได้อยู่ในงานที่คุณได้รับมอบหมายวันนี้|QR ไม่ถูกต้อง|QR หมดอายุ|ไม่พบพื้นที่|ไม่พบงานตรวจ/i.test(message);
      if(nonRetriable){
        // Business-rule errors will not succeed by retrying. Consume/clear the token to avoid hijacking navigation.
        markQrConsumed(token);
        clearPendingQr();
        S.scanToken="";
        S.scanHandled=true;
      }else{
        // Temporary/network failures may be retried after reconnect/login.
        S.scanHandled=false;
        savePendingQr(token);
      }
      error(e);
    } finally {
      busy(false);
    }
  }
  function loadQrImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(Error("ไม่สามารถเปิดภาพที่ถ่ายได้"));
      };
      img.src = url;
    });
  }
  function qrCanvasVariant(img, maxSide = 1800, crop = 1, enhance = false) {
    const sw0 = img.naturalWidth || img.width,
      sh0 = img.naturalHeight || img.height,
      sw = Math.max(1, Math.round(sw0 * crop)),
      sh = Math.max(1, Math.round(sh0 * crop)),
      sx = Math.max(0, Math.round((sw0 - sw) / 2)),
      sy = Math.max(0, Math.round((sh0 - sh) / 2)),
      scale = Math.min(1, maxSide / Math.max(sw, sh)),
      w = Math.max(1, Math.round(sw * scale)),
      h = Math.max(1, Math.round(sh * scale)),
      canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d", { willReadFrequently: true });
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    if (enhance) {
      const data = ctx.getImageData(0, 0, w, h),
        px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const gray = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        const v = Math.max(0, Math.min(255, (gray - 128) * 1.55 + 128));
        px[i] = px[i + 1] = px[i + 2] = v;
      }
      ctx.putImageData(data, 0, 0);
    }
    return canvas;
  }
  async function decodeQrPhoto(file, onStep) {
    const report = (text) => {
      if (onStep) onStep(text);
    };
    const img = await loadQrImage(file);

    // 1) Native BarcodeDetector, when Safari/Chrome provides it.
    if ("BarcodeDetector" in window) {
      try {
        report("กำลังลองตัวอ่าน QR ของเบราว์เซอร์…");
        const supported = BarcodeDetector.getSupportedFormats
          ? await BarcodeDetector.getSupportedFormats()
          : ["qr_code"];
        if (!supported.length || supported.includes("qr_code")) {
          const detector = new BarcodeDetector({ formats: ["qr_code"] });
          const codes = await detector.detect(img);
          if (codes && codes[0] && codes[0].rawValue) return codes[0].rawValue;
        }
      } catch (e) {}
    }

    // 2) jsQR: try multiple downscaled / center-cropped / contrast-enhanced variants.
    if (window.jsQR) {
      const variants = [
        [2200, 1, false],
        [1600, 1, false],
        [1600, 0.9, false],
        [1600, 0.78, false],
        [1400, 1, true],
        [1400, 0.88, true],
        [1200, 0.72, true],
      ];
      for (let n = 0; n < variants.length; n++) {
        report("กำลังวิเคราะห์ QR จากภาพ… " + (n + 1) + "/" + variants.length);
        const [size, crop, enhance] = variants[n],
          canvas = qrCanvasVariant(img, size, crop, enhance),
          ctx = canvas.getContext("2d", { willReadFrequently: true }),
          data = ctx.getImageData(0, 0, canvas.width, canvas.height),
          found = jsQR(data.data, data.width, data.height, { inversionAttempts: "attemptBoth" });
        if (found && found.data) return found.data;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // 3) Existing decoder remains as a final fallback.
    if (window.Html5Qrcode) {
      report("กำลังลองตัวอ่าน QR สำรอง…");
      let scanner;
      try {
        scanner = new Html5Qrcode("qr-image-reader");
        const decoded = await scanner.scanFile(file, false);
        if (decoded) return decoded;
      } catch (e) {
      } finally {
        try { scanner && scanner.clear(); } catch (e) {}
      }
    }
    throw Error("ไม่พบ QR Code ในภาพ กรุณาถ่ายใหม่ให้ QR อยู่กลางภาพ ชัด และมีขนาดอย่างน้อยประมาณครึ่งหนึ่งของภาพ");
  }
  let activeQrScanner = null;
  window.stopActiveQrScanner = async function () {
    const s = activeQrScanner;
    activeQrScanner = null;
    if (!s) return;
    try { await s.stop(); } catch (e) {}
    try { s.clear(); } catch (e) {}
  };
  async function handleDecodedQr(decodedText) {
    const token = qrTokenFromScan(decodedText);
    if (!token) throw Error("QR นี้ไม่ใช่ QR จุดตรวจของระบบ");
    await window.stopActiveQrScanner();
    closeModal();
    await openQrTask(token);
  }
  async function scanQrModal() {
    openModal(
      "สแกน QR ณ จุดตรวจ",
      '<div class="qr-scan-panel">' +
        '<p class="muted">เล็งกล้องไปที่ QR ของพื้นที่ ระบบจะอ่านและเปิดแบบประเมินอัตโนมัติ</p>' +
        '<div id="live-qr-reader" class="live-qr-reader"></div>' +
        '<p id="qr-scan-status" class="muted">กำลังขอสิทธิ์กล้องหลัง…</p>' +
        '<div class="live-qr-actions"><input id="qr-photo-input" type="file" accept="image/*" capture="environment" class="qr-file-input"><label for="qr-photo-input" class="btn secondary qr-photo-btn">📷 ถ่ายภาพ QR แทน</label></div>' +
        '<div id="qr-image-reader" class="qr-image-reader" aria-hidden="true"></div>' +
      '</div>',
    );
    const status = $("qr-scan-status");
    const setStatus = (t) => { if (status) status.textContent = t; };
    setStatus("กำลังโหลดตัวอ่าน QR…");
    try{await window.rsdEnsureQrScanner();}catch(e){setStatus("โหลดตัวอ่าน QR บางส่วนไม่สำเร็จ · ยังลองใช้ความสามารถของเบราว์เซอร์ได้");}
    let decoded = false;
    const onSuccess = async (text) => {
      if (decoded) return;
      decoded = true;
      setStatus("พบ QR แล้ว กำลังตรวจสอบสิทธิ์…");
      try { await handleDecodedQr(text); }
      catch (e) { decoded = false; setStatus(e.message || String(e)); error(e); }
    };
    if (window.Html5Qrcode && location.protocol === "https:") {
      try {
        activeQrScanner = new Html5Qrcode("live-qr-reader");
        await activeQrScanner.start(
          { facingMode: "environment" },
          { fps: 12, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.72); return { width: s, height: s }; }, aspectRatio: 1.333 },
          onSuccess,
          () => {},
        );
        setStatus("พร้อมสแกน · ให้ QR อยู่ภายในกรอบ");
      } catch (e) {
        await window.stopActiveQrScanner();
        setStatus("เปิดกล้องสดไม่ได้ กรุณาใช้ปุ่มถ่ายภาพ QR ด้านล่าง");
      }
    } else {
      setStatus("เบราว์เซอร์นี้ไม่พร้อมสำหรับกล้องสด กรุณาใช้ปุ่มถ่ายภาพ QR");
    }
    const input = $("qr-photo-input");
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      input.disabled = true;
      setStatus("กำลังวิเคราะห์ภาพ QR…");
      try {
        const text = await decodeQrPhoto(file, setStatus);
        await handleDecodedQr(text);
      } catch (e) {
        input.value = ""; input.disabled = false; setStatus(e.message || String(e));
      }
    };
  }
  function inspectionModal(i, queuedRecord = null) {
    const photoEnabled=S.config?.photoEvidenceEnabled===true;
    openModal(
      "ประเมิน: " + i.meta.areaName,
      '<form id="inspection-form"><p class="muted">ห้องรับผิดชอบ ' +
        esc(i.meta.className) +
        '</p>' +
        (inspectorTeamLabel(i) ? '<p class="muted">' + esc(inspectorTeamLabel(i)) + '</p>' : '') +
        (i.meta.completedByName ? '<p class="muted">ผลปัจจุบันบันทึกโดย ' + esc(i.meta.completedByName) + '</p>' : '') +
        '<div class="field"><label>สถานะ</label><select name="status"><option value="ตรวจแล้ว" '+(i.Status==="ตรวจแล้ว"?"selected":"")+'>ตรวจแล้ว</option><option value="งดตรวจ" '+(i.Status==="งดตรวจ"?"selected":"")+'>งดตรวจ / ไม่สามารถตรวจได้</option><option value="รอตรวจ" '+(i.Status==="รอตรวจ"?"selected":"")+'>รอตรวจ</option></select></div>'+
        '<div class="field hidden" id="skip-reason-field"><label>เหตุผลงดตรวจ</label><select name="skipReason"><option value="">— เลือกเหตุผล —</option>'+((S.config?.skipReasons||["ผู้ตรวจลา","กิจกรรมโรงเรียน","ฝนตก/สภาพอากาศ","พื้นที่ปิด/เข้าไม่ได้","เหตุจำเป็นอื่น"]).map(x=>'<option value="'+esc(x)+'" '+(i.SkipReason===x?"selected":"")+'>'+esc(x)+'</option>').join(""))+'</select></div>'+
        '<div class="field"><label>ระดับประเมิน</label><select name="score"><option value="">— เลือกระดับ —</option>' +
        [
          [3, (S.config?.scoreLabels?.["3"]||"ยอดเยี่ยม")+" — 3 คะแนน"],
          [2, (S.config?.scoreLabels?.["2"]||"ปานกลาง")+" — 2 คะแนน"],
          [1, (S.config?.scoreLabels?.["1"]||"ปรับปรุง")+" — 1 คะแนน"],
        ]
          .map(
            ([v, l]) =>
              '<option value="' +
              v +
              '" ' +
              (Number(i.Score) === v ? "selected" : "") +
              ">" +
              l +
              "</option>",
          )
          .join("") +
        '</select></div><div class="field"><label>หมายเหตุ</label><textarea name="notes" maxlength="2000">' +
        esc(i.Notes) +
        '</textarea></div>' +
        (photoEnabled
          ? '<div class="field"><label>รูปภาพหลักฐาน (ไม่บังคับ) · JPG, PNG, WebP ไม่เกิน 100 MB</label><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"><p class="muted">การเลือกรูปใหม่จะย้ายรูปเดิมลงถังขยะหลังบันทึกสำเร็จ</p></div>' +
            (i.PhotoLinks.length?'<label><input type="checkbox" name="removePhoto"> ลบรูปเดิม</label>':'')
          : '') +
        '<div id="upload-progress" class="muted my-3"></div><button class="btn w-full">บันทึกผลการตรวจ</button></form>',
    );
    const form = $("inspection-form");
    const toggle = () => {
      const status=form.elements.status.value,isDone=status==="ตรวจแล้ว",isSkip=status==="งดตรวจ";
      form.elements.score.required=isDone;
      form.elements.score.disabled=!isDone;
      form.elements.skipReason.required=isSkip;
      $("skip-reason-field")?.classList.toggle("hidden",!isSkip);
      if(!isDone)form.elements.score.value="";
    };
    form.elements.status.onchange = toggle;
    toggle();
    let sending = false,
      ticket = "";
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (sending) return;
      sending = true;
      const button = form.querySelector("button");
      button.disabled = true;
      busy(true, navigator.onLine ? "กำลังบันทึกผลตรวจ…" : "กำลังเก็บผลตรวจไว้ในเครื่อง…");
      const f=form.elements;
      const selectedPhoto=photoEnabled&&f.photo ? (f.photo.files[0]||null) : null;
      const basePayload={
        id:i.InspectionID,
        version:Number(navigator.onLine ? i.meta.version : (queuedRecord?.payload?.version ?? i.meta.version)),
        status:f.status.value,
        score:Number(f.score.value),
        notes:f.notes.value,
        skipReason:f.skipReason?.value||"",
        removePhoto:photoEnabled?(f.removePhoto?.checked||false):false
      };
      const queueRecord=async(reason="")=>{
        if(S.config?.offlineEnabled===false) throw Error("Admin ปิดการบันทึกแบบออฟไลน์ไว้ กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนบันทึก");
        if(!window.rsdOfflineQueue) throw Error("อุปกรณ์นี้ไม่รองรับการเก็บงานแบบออฟไลน์");
        const prior=photoEnabled?(queuedRecord?.photo||null):null;
        const photo=photoEnabled?(selectedPhoto||prior||null):null;
        const record={
          key:String(S.user.UserID)+":"+String(i.InspectionID),
          userId:String(S.user.UserID),
          inspectionId:String(i.InspectionID),
          createdAt:Number(queuedRecord?.createdAt||Date.now()),
          updatedAt:Date.now(),
          payload:basePayload,
          photo:photo,
          photoName:selectedPhoto?.name||queuedRecord?.photoName||"",
          photoType:selectedPhoto?.type||queuedRecord?.photoType||"",
          lastError:reason
        };
        await window.rsdOfflineQueue.queue(record);
        closeModal();
        toast("บันทึกไว้ในเครื่องแล้ว · รอซิงก์");
        await route();
      };
      try {
        if(!navigator.onLine){
          await queueRecord();
          return;
        }
        let photo=photoEnabled?selectedPhoto:null;
        if(photoEnabled&&!photo&&queuedRecord?.photo)photo=queuedRecord.photo;
        if (photo && !ticket) {
          const upload = await rpc(
            "uploadStart",
            { id: i.InspectionID, mime: photo.type||queuedRecord?.photoType, size: photo.size, origin: location.origin },
            true,
          );
          await uploadChunks(upload.url, photo, (percent) => {
            if ($("upload-progress")) $("upload-progress").textContent = "อัปโหลด " + percent + "%";
            $("loading-text").textContent = "อัปโหลดรูปภาพ " + percent + "%";
          });
          ticket = upload.ticket;
        }
        const result = await rpc(
          "saveInspection",
          {
            ...basePayload,
            uploadTicket: ticket,
          },
          true,
        );
        if(queuedRecord?.key) await window.rsdOfflineQueue.remove(queuedRecord.key);
        closeModal();
        await route();
        if (result.warning) await Swal.fire({ icon: "info", text: result.warning });
        else toast("บันทึกผลตรวจแล้ว");
      } catch (e) {
        if(offlineNetworkError(e)){
          await queueRecord(String(e.message||e));
        }else{
          error(e);
        }
      } finally {
        sending = false;
        if(button?.isConnected) button.disabled = false;
        busy(false);
      }
    };
    if(form.elements.photo)form.elements.photo.onchange=()=>{ticket="";};
  }
  /** Resumable upload: 8 MiB is a multiple of Drive's 256 KiB requirement.
   * 308 + Range determines the acknowledged offset; retry with status probe after network errors.
   * Never retry a chunk blindly or replay a data mutation automatically.
   */
  async function uploadChunks(url, file, onProgress) {
    const chunk = 8 * 1024 * 1024;
    let offset = 0,
      failures = 0;
    const request = async (start, end, probe = false) => {
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 90000);
      try {
        return await fetch(url, {
          method: "PUT",
          headers: {
            "Content-Type": file.type,
            "Content-Range": probe
              ? "bytes */" + file.size
              : "bytes " + start + "-" + (end - 1) + "/" + file.size,
          },
          body: probe ? new Blob([]) : file.slice(start, end),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };
    const ack = (r) => {
      const range = r.headers.get("Range");
      return range ? Number(range.split("-")[1]) + 1 : 0;
    };
    while (offset < file.size) {
      try {
        const end = Math.min(offset + chunk, file.size),
          res = await request(offset, end);
        if (res.status === 200 || res.status === 201) {
          onProgress(100);
          return;
        }
        if (res.status === 308) {
          const next = ack(res);
          if (next <= offset) throw Error("Drive ยังไม่ยืนยันส่วนข้อมูล");
          offset = next;
          failures = 0;
          onProgress(Math.floor((offset / file.size) * 100));
          continue;
        }
        if (res.status === 404 || res.status === 410)
          throw Object.assign(Error("Upload session หมดอายุ กรุณาปิดหน้าต่างแล้วเลือกไฟล์ใหม่"), {
            fatal: true,
          });
        if (res.status < 500 && res.status !== 429)
          throw Object.assign(Error("Drive ปฏิเสธไฟล์ (HTTP " + res.status + ")"), { fatal: true });
        throw Error("Drive ชั่วคราวไม่พร้อม");
      } catch (e) {
        if (e.fatal || ++failures > 5)
          throw Error(e.message + " · ลองใหม่หรือตรวจการเชื่อมต่อ/นโยบาย CORS ของ Drive");
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** failures, 12000)));
        try {
          const status = await request(0, 0, true);
          if (status.status === 200 || status.status === 201) {
            onProgress(100);
            return;
          }
          if (status.status === 308) offset = ack(status);
          else if (status.status === 404 || status.status === 410)
            throw Object.assign(Error("Upload session หมดอายุ"), { fatal: true });
        } catch (probeError) {
          if (probeError.fatal) throw probeError;
        }
      }
    }
  }
  window.syncOfflineInspections = async function(manual=false){
    if(!navigator.onLine||!S.user||S.user.Role!=="Inspector"||!window.rsdOfflineQueue)return{synced:0,pending:0};
    const rows=await window.rsdOfflineQueue.list(S.user.UserID);
    if(!rows.length){if(manual)toast("ไม่มีรายการรอซิงก์");return{synced:0,pending:0};}
    let synced=0,failed=0;
    if(manual)busy(true,"กำลังซิงก์ผลตรวจ…");
    for(const q of rows){
      try{
        let uploadTicket="";
        if(S.config?.photoEvidenceEnabled===true&&q.photo){
          const upload=await rpc("uploadStart",{id:q.inspectionId,mime:q.photo.type||q.photoType,size:q.photo.size,origin:location.origin},true);
          await uploadChunks(upload.url,q.photo,percent=>{
            if(manual&&$("loading-text"))$("loading-text").textContent="ซิงก์รูปภาพ "+percent+"%";
          });
          uploadTicket=upload.ticket;
        }
        await rpc("saveInspection",{...q.payload,uploadTicket},true);
        await window.rsdOfflineQueue.remove(q.key);
        synced++;
      }catch(e){
        failed++;
        q.lastError=String(e.message||e);
        q.updatedAt=Date.now();
        await window.rsdOfflineQueue.queue(q);
        if(/ข้อมูลถูกเปลี่ยนแล้ว|งานนี้ไม่ใช่งานที่ได้รับมอบหมาย|แก้ไขได้เฉพาะงานวันนี้|SESSION_EXPIRED/i.test(q.lastError)) break;
      }
    }
    if(manual)busy(false);
    if(synced){
      toast("ซิงก์สำเร็จ "+synced+" รายการ");
      if(S.route==="tasks") await route();
    }else if(manual&&failed){
      await Swal.fire({icon:"warning",title:"ยังซิงก์ไม่ได้",text:"รายการยังเก็บอยู่ในเครื่อง กรุณาตรวจอินเทอร์เน็ตหรือเปิดรายการเพื่อดูรายละเอียด"});
    }
    window.dispatchEvent(new CustomEvent("rsd-offline-queue-change"));
    return{synced,pending:Math.max(0,rows.length-synced)};
  };

  async function showPhoto(i) {
    try {
      const src = await rpc("photo", { inspectionId: i.InspectionID, fileId: i.PhotoLinks[0].id });
      openModal(
        "รูปหลักฐาน: " + i.meta.areaName,
        '<img class="photo" alt="หลักฐานความสะอาด" src="' + esc(src) + '">',
      );
    } catch (e) {
      error(e);
    }
  }

  function teacherMapCenter(s){
    if(s.ShapeType==="polygon"&&Array.isArray(s.Points)&&s.Points.length){
      const sum=s.Points.reduce((a,p)=>({x:a.x+Number(p.x||0),y:a.y+Number(p.y||0)}),{x:0,y:0});
      return{x:sum.x/s.Points.length,y:sum.y/s.Points.length};
    }
    return{x:Number(s.X||0)+Number(s.Width||0)/2,y:Number(s.Y||0)+Number(s.Height||0)/2};
  }
  function teacherMapStatus(item){
    if(!item)return{key:"no_assignment",label:"ยังไม่มีผลวันนี้",color:"#94a3b8"};
    if(item.StatusKey)return{key:item.StatusKey,label:item.StatusLabel||item.StatusKey,color:item.StatusColor||"#94a3b8"};
    if(item.Status==="งดตรวจ")return{key:"skipped",label:"งดตรวจ",color:"#64748b"};
    if(item.Status==="รอตรวจ")return{key:"pending",label:"รอตรวจ",color:"#facc15"};
    if(item.Status==="ตรวจแล้ว"){
      if(Number(item.Score)===3)return{key:"excellent",label:S.config?.scoreLabels?.["3"]||"ยอดเยี่ยม",color:"#22c55e"};
      if(Number(item.Score)===2)return{key:"medium",label:S.config?.scoreLabels?.["2"]||"ปานกลาง",color:"#f59e0b"};
      if(Number(item.Score)===1)return{key:"improve",label:S.config?.scoreLabels?.["1"]||"ปรับปรุง",color:"#ef4444"};
      return{key:"done",label:"ตรวจแล้ว",color:"#14b8a6"};
    }
    return{key:"no_assignment",label:"ยังไม่มีผลวันนี้",color:"#94a3b8"};
  }
  function teacherLatestForArea(recent,areaId){
    return recent.find(i=>String(i.meta?.areaId||"")===String(areaId)&&i.Status==="ตรวจแล้ว")
      || recent.find(i=>String(i.meta?.areaId||"")===String(areaId))
      || null;
  }
  function teacherAreaMapHtml(layout,recent){
    const shapes=layout?.shapes||[],classroomId=String(S.user?.LinkedClassroomID||""),
      ownShapes=shapes.filter(s=>String(s.ResponsibleClassroomID||"")===classroomId),
      todayRows=(layout?.items||[]).filter(i=>i.InScope!==false),
      todayByArea=new Map(todayRows.map(i=>[String(i.AreaID||""),i]));
    if(!shapes.length)return '<section class="card teacher-map-card mb-7"><div class="teacher-map-head"><div><span class="muted">พื้นที่รับผิดชอบ</span><h2>ผังพื้นที่ของห้องฉัน</h2></div></div><div class="teacher-map-empty">ยังไม่มีผังพื้นที่ในระบบ</div></section>';
    if(!ownShapes.length)return '<section class="card teacher-map-card mb-7"><div class="teacher-map-head"><div><span class="muted">พื้นที่รับผิดชอบ</span><h2>ผังพื้นที่ของห้องฉัน</h2></div></div><div class="teacher-map-empty">ยังไม่พบพื้นที่ที่เชื่อมกับห้องเรียนของบัญชีนี้</div></section>';

    let ref="";try{ref=localStorage.getItem("rsd-area-map-reference-v1")||"";}catch(e){}
    let opacity=.5;try{opacity=Math.max(.1,Math.min(.75,Number(localStorage.getItem("rsd-area-map-reference-opacity-v1")||50)/100));}catch(e){}
    const reference=ref?'<image href="'+ref+'" x="0" y="0" width="1600" height="1000" opacity="'+opacity+'" pointer-events="none"/>':"";
    const counts={pending:0,excellent:0,medium:0,improve:0,skipped:0,none:0,no_assignment:0,no_inspector:0,holiday:0,done:0,other:0};
    ownShapes.forEach(s=>{const st=teacherMapStatus(todayByArea.get(String(s.AreaID)));counts[st.key]=(counts[st.key]||0)+1;});

    const body=shapes.map(s=>{
      const mine=String(s.ResponsibleClassroomID||"")===classroomId,
        item=todayByArea.get(String(s.AreaID)),
        status=mine?teacherMapStatus(item):{key:"other",label:"พื้นที่อื่น",color:"#cbd5e1"},
        center=teacherMapCenter(s),
        geo=s.ShapeType==="polygon"
          ? '<polygon points="'+(s.Points||[]).map(p=>Number(p.x)+","+Number(p.y)).join(" ")+'" fill="'+status.color+'"/>'
          : '<rect x="'+Number(s.X||0)+'" y="'+Number(s.Y||0)+'" width="'+Number(s.Width||0)+'" height="'+Number(s.Height||0)+'" rx="10" fill="'+status.color+'"/>';
      return '<g class="teacher-map-shape '+(mine?"mine status-"+status.key:"other")+'" '+(mine?'data-area="'+esc(s.AreaID)+'" tabindex="0" role="button"':"")+'>'+geo+
        (mine?'<text x="'+center.x+'" y="'+(center.y-5)+'" text-anchor="middle"><tspan x="'+center.x+'">'+esc(s.AreaName||item?.AreaName||"พื้นที่")+'</tspan><tspan class="sub" x="'+center.x+'" dy="18">'+esc(s.ClassName||item?.ClassName||"")+'</tspan></text>':"")+
      '</g>';
    }).join("");

    const legend=[
      ["#facc15","รอตรวจ",counts.pending],["#22c55e",S.config?.scoreLabels?.["3"]||"ยอดเยี่ยม",counts.excellent],
      ["#f59e0b",S.config?.scoreLabels?.["2"]||"ปานกลาง",counts.medium],["#ef4444",S.config?.scoreLabels?.["1"]||"ปรับปรุง",counts.improve],
      ["#64748b","งดตรวจ",counts.skipped],["#cbd5e1","วันหยุด",counts.holiday],["#94a3b8","ไม่มีเวร",counts.no_assignment],["#a78bfa","ไม่มีผู้ตรวจ",counts.no_inspector]
    ].filter(x=>x[2]>0).map(x=>'<span><i style="background:'+x[0]+'"></i>'+esc(x[1])+' <b>'+x[2]+'</b></span>').join("");

    return '<section class="card teacher-map-card mb-7">'+
      '<div class="teacher-map-head"><div><span class="muted">วันนี้ · '+ownShapes.length+' พื้นที่</span><h2>ผังพื้นที่ของห้องฉัน</h2></div><button class="btn small secondary" id="teacher-map-toggle" type="button">ซ่อนผัง</button></div>'+
      '<div class="teacher-map-legend">'+legend+'</div>'+
      '<div class="teacher-map-layout" id="teacher-map-body"><div class="teacher-map-scroll"><svg viewBox="0 0 1600 1000" aria-label="ผังพื้นที่รับผิดชอบของห้องเรียน"><rect width="1600" height="1000" fill="#fff"/>'+reference+body+'</svg></div><aside id="teacher-map-detail" class="teacher-map-detail"></aside></div>'+
    '</section>';
  }
  function wireTeacherAreaMap(layout,recent){
    const body=$("teacher-map-body"),toggle=$("teacher-map-toggle");
    if(toggle&&body)toggle.onclick=()=>{
      const hidden=body.classList.toggle("hidden");
      toggle.textContent=hidden?"แสดงผัง":"ซ่อนผัง";
    };
    const show=areaId=>{
      const box=$("teacher-map-detail");if(!box)return;
      const shape=(layout?.shapes||[]).find(s=>String(s.AreaID)===String(areaId));
      if(!shape)return;
      const today=(layout?.items||[]).find(i=>i.InScope!==false&&String(i.AreaID||"")===String(areaId)),
        latest=teacherLatestForArea(recent,areaId),status=teacherMapStatus(today),
        item=today?.InspectionID?today:latest,
        dateLabel=today?.InspectionID?"วันนี้":latest?latest.InspectionDate:"ยังไม่มีผลตรวจ";
      document.querySelectorAll(".teacher-map-shape.mine").forEach(el=>el.classList.toggle("selected",String(el.dataset.area)===String(areaId)));
      box.innerHTML='<div class="teacher-map-detail-head"><span style="background:'+status.color+'"></span><div><b>'+esc(shape.AreaName||item?.AreaName||item?.meta?.areaName||"พื้นที่")+'</b><small>'+esc(shape.ClassName||item?.ClassName||item?.meta?.className||"")+'</small></div></div>'+
        '<div class="teacher-map-detail-status"><b>'+esc(today?.InspectionID?status.label:(today?.StatusKey==="holiday"?"วันหยุด":latest?"ผลล่าสุด":status.label||"ยังไม่มีผลตรวจ"))+'</b><span>'+esc(dateLabel)+'</span></div>'+
        (item?'<div class="teacher-map-detail-grid"><div><span>ผลประเมิน</span><b>'+(item.Status==="ตรวจแล้ว"?esc(item.Rating||teacherMapStatus(item).label):esc(item.Status||"—"))+'</b></div><div><span>คะแนน</span><b>'+(item.Status==="ตรวจแล้ว"?esc(String(item.Score||"—")):"—")+'</b></div><div><span>ผู้ตรวจ</span><b>'+esc((item.Inspectors||[]).map(v=>v.Name).filter(Boolean).join(", ")||((item.meta?.inspectorNames||[]).filter(Boolean).join(", "))||"—")+'</b></div>'+(item.Notes?'<div class="wide"><span>หมายเหตุ</span><b>'+esc(item.Notes)+'</b></div>':"")+'</div>':'<div class="teacher-map-no-result">ยังไม่มีผลตรวจของพื้นที่นี้</div>')+
        '<div class="teacher-map-detail-actions"><a class="btn small secondary" href="#history" data-history-type="area" data-history-id="'+esc(areaId)+'">ดูประวัติพื้นที่</a></div>';
      icons();
    };
    document.querySelectorAll(".teacher-map-shape.mine").forEach(el=>{
      const go=()=>show(el.dataset.area);
      el.onclick=go;
      el.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();go();}};
    });
    const first=document.querySelector(".teacher-map-shape.mine");
    if(first)show(first.dataset.area);
    else if($("teacher-map-detail"))$("teacher-map-detail").innerHTML='<div class="teacher-map-detail-empty">เลือกพื้นที่บนผังเพื่อดูรายละเอียด</div>';
  }

  async function renderTeacher(seq) {
    const [r,mapLayout] = await Promise.all([rpc("teacher"),rpc("mapStatus",{date:thaiDay()},true).catch(()=>({shapes:[],items:[]}))]);
    if(window.rsdEnsureMapReference)await window.rsdEnsureMapReference(mapLayout);
    if (seq !== S.seq) return;
    const recent = r.inspections,
      done = recent.filter((i) => i.Status === "ตรวจแล้ว");
    $("app").innerHTML =
      heading("ห้องเรียนของฉัน 🌟", "ติดตามผลการดูแลพื้นที่และความสำเร็จของห้องเรียน", '<div class="flex flex-wrap gap-2"><a class="btn secondary" href="#history"><i data-lucide="history"></i> ประวัติ</a><a class="btn secondary" href="#exports"><i data-lucide="file-down"></i> ส่งออก</a></div>') +
      '<div class="grid md:grid-cols-3 gap-4 mb-6"><section class="card"><p class="muted">ผลตรวจที่แสดง (สูงสุด 200 รายการ)</p><div class="kpi">' +
      done.length +
      '</div></section><section class="card"><p class="muted">รางวัลที่ได้รับ</p><div class="kpi">' +
      r.rewards.length +
      '</div></section><section class="card"><p class="muted">ผลเกียรติบัตรเดือนนี้ (ชั่วคราว)</p><p class="text-xl mt-4">' +
      esc(r.monthly[0]?.medal || "ยังไม่มีข้อมูล") +
      '</p></section></div>'+teacherAreaMapHtml(mapLayout,recent)+'<h2 class="text-lg mb-4">รางวัลของห้องเรียน</h2><div class="task-grid mb-7">' +
      (r.rewards.length
        ? r.rewards
            .map(
              (b) =>
                '<div class="badge-card"><div class="text-3xl mb-2">🏅</div><h3>' +
                esc(b.Achievement) +
                '</h3><p class="muted">' +
                esc(
                  new Date(b.Timestamp).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" }),
                ) +
                "</p></div>",
            )
            .join("")
        : '<p class="muted">ร่วมกันดูแลพื้นที่เพื่อสะสมรางวัลแรก</p>') +
      '</div><section class="card"><div class="flex flex-wrap items-center justify-between gap-3 mb-4"><h2>ฟีดผลตรวจ</h2><div class="search-box"><i data-lucide="search"></i><input id="teacher-feed-search" type="search" placeholder="ค้นหาพื้นที่ / หมายเหตุ…"></div></div>' +
      table(
        ["วันที่", "พื้นที่", "ผลตรวจ", "หมายเหตุ", "รูป"],
        recent.map((i, index) => [
          esc(i.InspectionDate),
          esc(i.meta.areaName),
          pill(i.Score),
          esc(i.Notes),
          i.PhotoLinks.length
            ? '<button class="btn small secondary teacher-photo" data-index="' +
              index +
              '">ดูรูป</button>'
            : "—",
        ]),
      ) +
      "</section>";
    if($("teacher-feed-search")){
      $("teacher-feed-search").oninput=()=>{
        const q=String($("teacher-feed-search").value||"").trim().toLocaleLowerCase("th");
        document.querySelectorAll("#app section.card tbody tr").forEach(tr=>{
          tr.style.display=!q||tr.textContent.toLocaleLowerCase("th").includes(q)?"":"none";
        });
      };
      icons();
    }
    wireTeacherAreaMap(mapLayout,recent);
    icons();
    document
      .querySelectorAll(".teacher-photo")
      .forEach((b) => (b.onclick = () => showPhoto(recent[Number(b.dataset.index)])));
  }