let taskRows = [];
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
  async function renderTasks(seq) {
    let rows,rewards,offlineView=false;
    if(!navigator.onLine){
      const cached=loadTaskCache();
      if(!cached) throw Error("ยังไม่มีรายการงานที่เก็บไว้ในเครื่อง กรุณาเชื่อมต่ออินเทอร์เน็ตอย่างน้อย 1 ครั้ง");
      rows=cached.rows;
      rewards=cached.rewards;
      offlineView=true;
    }else{
      try{
        [rows,rewards]=await Promise.all([rpc("tasks"),rpc("myRewards")]);
        saveTaskCache(rows,rewards);
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
    const done = rows.filter((i) => i.Status === "ตรวจแล้ว").length;
    const pendingCount=[...pending.values()].length;
    $("app").innerHTML =
      heading(
        "งานตรวจของฉัน 🔎",
        "งานประจำวันที่ " + thaiDay() + " · สำเร็จ " + done + " จาก " + rows.length + " พื้นที่",
        '<div class="flex flex-wrap gap-2"><button class="btn" id="scan-qr"><span aria-hidden="true">▦</span> สแกน QR ณ จุดตรวจ</button><button class="btn secondary" id="refresh-tasks">รีเฟรช</button></div>',
      ) +
      (offlineView?'<div class="offline-work-notice mb-4"><b>โหมดออฟไลน์</b><span>กำลังใช้รายการงานล่าสุดที่เก็บไว้ในเครื่อง ผลตรวจใหม่จะซิงก์เมื่ออินเทอร์เน็ตกลับมา</span></div>':'') +
      (pendingCount?'<div class="offline-work-notice pending mb-4"><b>รอซิงก์ '+pendingCount+' รายการ</b><button class="btn small secondary" id="sync-now" type="button">ซิงก์ตอนนี้</button></div>':'') +
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
                '<article class="card'+(i._offlinePending?' offline-pending-card':'')+'" data-task-status="'+(i._offlinePending?'offline':i.Status==="ตรวจแล้ว"?'done':'pending')+'" data-task-search="'+esc([i.meta.areaName,i.meta.className,i.Notes,inspectorTeamLabel(i)].filter(Boolean).join(" ").toLocaleLowerCase("th"))+'"><div class="flex justify-between items-center mb-4"><span class="muted">' +
                esc(i.meta.className) +
                "</span>" +
                (i._offlinePending?'<span class="pill offline-pill">รอซิงก์</span>':pill(i.Score)) +
                '</div><h2 class="text-xl font-medium mb-2">' +
                esc(i.meta.areaName) +
                '</h2>' +
                (inspectorTeamLabel(i) ? '<p class="muted mb-2">' + esc(inspectorTeamLabel(i)) + '</p>' : '') +
                (i.meta.completedByName && !i._offlinePending ? '<p class="muted mb-2">ตรวจล่าสุดโดย ' + esc(i.meta.completedByName) + '</p>' : '') +
                (i._offlineError?'<p class="offline-error mb-2">ซิงก์ล่าสุดไม่สำเร็จ: '+esc(i._offlineError)+'</p>':'') +
                '<p class="muted min-h-10">' +
                esc(i.Notes || "ยังไม่มีหมายเหตุ") +
                '</p><div class="flex gap-2 mt-5"><button class="btn inspect-btn" data-index="' +
                index +
                '">' +
                (i._offlinePending ? "แก้ไขรายการรอซิงก์" : i.Status === "ตรวจแล้ว" ? "แก้ไขผลตรวจ" : "เริ่มตรวจพื้นที่") +
                "</button>" +
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
      // Keep the pending QR briefly so a login/reload can retry the same scanned location.
      S.scanHandled = false;
      savePendingQr(token);
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
    openModal(
      "ประเมิน: " + i.meta.areaName,
      '<form id="inspection-form"><p class="muted">ห้องรับผิดชอบ ' +
        esc(i.meta.className) +
        '</p>' +
        (inspectorTeamLabel(i) ? '<p class="muted">' + esc(inspectorTeamLabel(i)) + '</p>' : '') +
        (i.meta.completedByName ? '<p class="muted">ผลปัจจุบันบันทึกโดย ' + esc(i.meta.completedByName) + '</p>' : '') +
        '<div class="field"><label>สถานะ</label><select name="status"><option selected>ตรวจแล้ว</option><option>รอตรวจ</option></select></div><div class="field"><label>ระดับประเมิน</label><select name="score"><option value="">— เลือกระดับ —</option>' +
        [
          [3, "ยอดเยี่ยม — 3 คะแนน"],
          [2, "ปานกลาง — 2 คะแนน"],
          [1, "ปรับปรุง — 1 คะแนน"],
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
        '</textarea></div><div class="field"><label>รูปภาพหลักฐาน (ไม่บังคับ) · JPG, PNG, WebP ไม่เกิน 100 MB</label><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"><p class="muted">การเลือกรูปใหม่จะย้ายรูปเดิมลงถังขยะหลังบันทึกสำเร็จ</p></div>' +
        (i.PhotoLinks.length
          ? '<label><input type="checkbox" name="removePhoto"> ลบรูปเดิม</label>'
          : "") +
        '<div id="upload-progress" class="muted my-3"></div><button class="btn w-full">บันทึกผลการตรวจ</button></form>',
    );
    const form = $("inspection-form");
    const toggle = () => {
      form.elements.score.required = form.elements.status.value === "ตรวจแล้ว";
      form.elements.score.disabled = !form.elements.score.required;
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
      const selectedPhoto=f.photo.files[0] || null;
      const basePayload={
        id:i.InspectionID,
        version:Number(navigator.onLine ? i.meta.version : (queuedRecord?.payload?.version ?? i.meta.version)),
        status:f.status.value,
        score:Number(f.score.value),
        notes:f.notes.value,
        removePhoto:f.removePhoto?.checked||false
      };
      const queueRecord=async(reason="")=>{
        if(!window.rsdOfflineQueue) throw Error("อุปกรณ์นี้ไม่รองรับการเก็บงานแบบออฟไลน์");
        const prior=queuedRecord?.photo||null;
        const photo=selectedPhoto||prior||null;
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
        let photo=selectedPhoto;
        if(!photo && queuedRecord?.photo) photo=queuedRecord.photo;
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
    form.elements.photo.onchange = () => {
      ticket = "";
    };
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
        if(q.photo){
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
  async function renderTeacher(seq) {
    const r = await rpc("teacher");
    if (seq !== S.seq) return;
    const recent = r.inspections,
      done = recent.filter((i) => i.Status === "ตรวจแล้ว");
    $("app").innerHTML =
      heading("ห้องเรียนของฉัน 🌟", "ติดตามผลการดูแลพื้นที่และความสำเร็จของห้องเรียน") +
      '<div class="grid md:grid-cols-3 gap-4 mb-6"><section class="card"><p class="muted">ผลตรวจที่แสดง (สูงสุด 200 รายการ)</p><div class="kpi">' +
      done.length +
      '</div></section><section class="card"><p class="muted">รางวัลที่ได้รับ</p><div class="kpi">' +
      r.rewards.length +
      '</div></section><section class="card"><p class="muted">ผลเกียรติบัตรเดือนนี้ (ชั่วคราว)</p><p class="text-xl mt-4">' +
      esc(r.monthly[0]?.medal || "ยังไม่มีข้อมูล") +
      '</p></section></div><h2 class="text-lg mb-4">รางวัลของห้องเรียน</h2><div class="task-grid mb-7">' +
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
    document
      .querySelectorAll(".teacher-photo")
      .forEach((b) => (b.onclick = () => showPhoto(recent[Number(b.dataset.index)])));
  }