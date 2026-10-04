const adminTables = {
    Users: {
      name: "ผู้ใช้งาน",
      fields: ["Username", "FullName", "Role", "LinkedClassroomID"],
      labels: ["ชื่อผู้ใช้", "ชื่อ–สกุล", "สิทธิ์", "ห้องเรียน"],
    },
    Classrooms: { name: "ห้องเรียน", fields: ["ClassName"], labels: ["ชื่อห้องเรียน"] },
    Areas: {
      name: "เขตพื้นที่",
      fields: ["AreaName", "ResponsibleClassroomID"],
      labels: ["ชื่อพื้นที่", "ห้องรับผิดชอบ"],
    },
  };
  let adminTab = "Users",
    reportData = null,
    dailyReportData = null,
    executivePeriodId = "",
    executiveMapPack = null,
    executiveMapSelected = "";
  function wireTextFilter(inputId, scopeSelector) {
    const input=$(inputId),scope=document.querySelector(scopeSelector);
    if(!input||!scope)return;
    const run=()=>{
      const q=String(input.value||"").trim().toLocaleLowerCase("th");
      scope.querySelectorAll("tbody tr").forEach(tr=>{
        tr.style.display=!q||tr.textContent.toLocaleLowerCase("th").includes(q)?"":"none";
      });
    };
    input.oninput=run;
    run();
  }
  function opts(rows, key, label, current, empty = "— เลือก —") {
    return (
      '<option value="">' +
      esc(empty) +
      "</option>" +
      rows
        .map(
          (r) =>
            '<option value="' +
            esc(r[key]) +
            '" ' +
            (r[key] === current ? "selected" : "") +
            ">" +
            esc(r[label]) +
            "</option>",
        )
        .join("")
    );
  }
  function masterLabel(field, value) {
    const m = S.master;
    if (field === "LinkedClassroomID" || field === "ResponsibleClassroomID")
      return m.Classrooms.find((c) => c.ClassroomID === value)?.ClassName || "—";
    return value;
  }
  async function renderAdmin(seq) {
    const m = await rpc("master");
    if (seq !== S.seq) return;
    S.master = m;
    $("app").innerHTML =
      heading("จัดการข้อมูลระบบ", "ผู้ใช้งาน ห้องเรียน เขตพื้นที่ และงานตรวจประจำวัน") +
      '<div class="flex flex-wrap gap-2 mb-5">' +
      Object.entries(adminTables)
        .map(
          ([k, t]) =>
            '<button class="btn secondary admin-tab" data-tab="' + k + '">' + t.name + "</button>",
        )
        .join("") +
      '<button class="btn secondary admin-tab" data-tab="Assignments">มอบหมายงาน</button><button class="btn secondary admin-tab" data-tab="AreaMap">ผังพื้นที่</button><a class="btn secondary" href="#control">ศูนย์งานวันนี้</a><a class="btn secondary" href="#periods">ปีการศึกษา</a><button class="btn secondary" id="excel-import-btn">นำเข้า Excel</button><a class="btn secondary" href="#certificates">เกียรติบัตร</a><button class="btn secondary" id="override-btn">ผู้ตรวจทดแทน</button><button class="btn secondary" id="settings-btn">ตั้งค่าระบบ</button><button class="btn secondary" id="holiday-btn">วันหยุดโรงเรียน</button><button class="btn secondary" id="audit-btn">ประวัติการเปลี่ยนแปลง</button><button class="btn secondary" id="trash-btn">ถังขยะ</button><button class="btn secondary" id="backup-btn">สำรองและกู้คืน</button><button class="btn secondary" id="status-btn">สถานะระบบ</button><button class="btn secondary" id="monitor-btn">มอนิเตอร์ระบบ</button></div><section class="card" id="admin-content"></section>';
    document.querySelectorAll(".admin-tab").forEach(
      (b) =>
        (b.onclick = () => {
          adminTab = b.dataset.tab;
          adminContent();
        }),
    );
    $("excel-import-btn").onclick = importExcelModal;
    $("override-btn").onclick = dutyOverrideModal;
    $("settings-btn").onclick = appSettingsModal;
    $("holiday-btn").onclick = holidayModal;
    $("audit-btn").onclick = auditModal;
    $("trash-btn").onclick = trashModal;
    $("backup-btn").onclick = backupCenterModal;
    $("status-btn").onclick = systemStatusModal;
    $("monitor-btn").onclick = systemMonitorModal;
    adminContent();
  }
  function adminContent() {
    if (adminTab === "AreaMap") { areaMapContent(); return; }
    if (adminTab === "Assignments") {
      assignmentContent();
      return;
    }
    const t = adminTables[adminTab],
      key = adminTab === "Users" ? "UserID" : adminTab === "Classrooms" ? "ClassroomID" : "AreaID";
    $("admin-content").innerHTML =
      '<div class="flex flex-wrap items-center justify-between gap-3 mb-4"><div><h2 class="text-lg">' +
      t.name +
      '</h2><div class="search-box mt-2"><i data-lucide="search"></i><input id="admin-table-search" type="search" placeholder="ค้นหา '+esc(t.name)+'…"></div></div><div class="flex flex-wrap gap-2">' +
      (adminTab === "Areas"
        ? '<button class="btn secondary" id="qr-all"><span aria-hidden="true">▦</span> พิมพ์ QR ทุกพื้นที่</button>'
        : "") +
      '<button class="btn secondary" id="bulk-add">+ เพิ่มหลายรายการ</button><button class="btn" id="add-row">+ เพิ่ม' +
      t.name +
      "</button></div></div>" +
      table(
        [...t.labels, "จัดการ"],
        S.master[adminTab].map((r) => [
          ...t.fields.map((f) => esc(masterLabel(f, r[f]))),
          '<button class="btn small secondary edit-row" data-id="' +
            esc(r[key]) +
            '">แก้ไข</button> ' +
            (adminTab === "Areas"
              ? '<button class="btn small secondary qr-area" data-id="' +
                esc(r[key]) +
                '">QR</button> <a class="btn small secondary" href="#history" data-history-type="area" data-history-id="'+esc(r[key])+'">ประวัติ</a> '
              : adminTab === "Classrooms"
                ? '<a class="btn small secondary" href="#history" data-history-type="class" data-history-id="'+esc(r[key])+'">ประวัติ</a> '
                : "") +
            '<button class="btn small danger delete-row" data-id="' +
            esc(r[key]) +
            '">ลบ</button>',
        ]),
      );
    wireTextFilter("admin-table-search","#admin-content");
    icons();
    $("add-row").onclick = () => editMaster();
    $("bulk-add").onclick = bulkModal;
    if ($("qr-all")) $("qr-all").onclick = () => printAreaQrs();
    document.querySelectorAll(".qr-area").forEach(
      (b) => (b.onclick = () => qrAreaModal(b.dataset.id)),
    );
    document
      .querySelectorAll(".edit-row")
      .forEach(
        (b) =>
          (b.onclick = () => editMaster(S.master[adminTab].find((r) => r[key] === b.dataset.id))),
      );
    document
      .querySelectorAll(".delete-row")
      .forEach((b) => (b.onclick = () => deleteRow(adminTab, b.dataset.id)));
  }
  function makeQrDataUrl(text, size = 320) {
    if (!window.QRCode) throw Error("ไลบรารีสร้าง QR Code โหลดไม่สำเร็จ");
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:-99999px;top:-99999px;background:#fff;padding:8px";
    document.body.appendChild(box);
    try {
      new QRCode(box, {
        text,
        width: size,
        height: size,
        correctLevel: QRCode.CorrectLevel.M,
      });
      const canvas = box.querySelector("canvas");
      if (canvas) return canvas.toDataURL("image/png");
      const img = box.querySelector("img");
      if (img?.src) return img.src;
      throw Error("สร้าง QR Code ไม่สำเร็จ");
    } finally {
      box.remove();
    }
  }
  function frontendQrUrl(token) {
    const u = new URL(location.origin + location.pathname);
    u.searchParams.set("qr", String(token || ""));
    u.hash = "tasks";
    return u.toString();
  }
  function withQrUrl(q) { return { ...q, url: frontendQrUrl(q.token) }; }

  async function qrAreaModal(areaId) {
    busy(true, "กำลังสร้าง QR Code…");
    try {
      await window.rsdEnsureQrCode();
      const rows = await rpc("qrAdmin", { areaIds: [areaId] }, true),
        q = rows[0] ? withQrUrl(rows[0]) : null;
      if (!q) throw Error("ไม่พบพื้นที่");
      openModal(
        "QR จุดตรวจ: " + q.AreaName,
        '<div class="qr-panel"><div id="area-qr-code" class="qr-code-box"></div>' +
          '<h3 class="text-lg font-medium mt-4">' +
          esc(q.AreaName) +
          '</h3><p class="muted">ห้องรับผิดชอบ ' +
          esc(q.ClassName) +
          '</p><p class="muted mt-2">ติดป้ายนี้ไว้ ณ จุดตรวจ ผู้ตรวจสามารถใช้กล้องมือถือหรือปุ่มสแกนในระบบได้</p>' +
          '<div class="flex flex-wrap gap-2 mt-4 justify-center"><button class="btn" id="print-one-qr">พิมพ์ป้าย QR</button><button class="btn secondary" id="copy-qr-link">คัดลอกลิงก์</button></div></div>',
      );
      const holder = $("area-qr-code");
      new QRCode(holder, {
        text: q.url,
        width: 260,
        height: 260,
        correctLevel: QRCode.CorrectLevel.M,
      });
      $("print-one-qr").onclick = () => printAreaQrs([q]);
      $("copy-qr-link").onclick = async () => {
        await navigator.clipboard.writeText(q.url);
        toast("คัดลอกลิงก์ QR แล้ว");
      };
    } catch (e) {
      error(e);
    } finally {
      busy(false);
    }
  }
  async function printAreaQrs(prefetched = null) {
    const win = window.open("", "_blank");
    if (!win) {
      error(new Error("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up แล้วลองใหม่"));
      return;
    }
    win.document.write('<!doctype html><html lang="th"><head><meta charset="utf-8"><title>กำลังเตรียม QR…</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/fontsource-kanit@4.0.0/thai.css"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/fontsource-kanit@4.0.0/latin.css"></head><body><p style="font-family:Kanit,Tahoma,sans-serif;padding:24px">กำลังเตรียม QR Code…</p></body></html>');
    busy(true, "กำลังเตรียม QR Code สำหรับพิมพ์…");
    try {
      await window.rsdEnsureQrCode();
      const rawRows = prefetched || (await rpc("qrAdmin", {}, true));
      const rows = rawRows.map((q) => q.url ? q : withQrUrl(q));
      if (!rows.length) throw Error("ยังไม่มีเขตพื้นที่");
      const cards = rows.map((q) => ({ ...q, image: makeQrDataUrl(q.url, 360) }));
      const html =
        '<!doctype html><html lang="th"><head><meta charset="utf-8"><title>QR จุดตรวจ RSD Clean</title>' +
        '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/fontsource-kanit@4.0.0/thai.css">' +
        '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/fontsource-kanit@4.0.0/latin.css"><style>' +
        '@page{size:A4;margin:12mm}*{box-sizing:border-box}html,body,button{font-family:"Kanit",Tahoma,sans-serif!important}body{color:#17324a;margin:0}.toolbar{position:sticky;top:0;background:white;padding:8px 0 14px;border-bottom:1px solid #ddd;margin-bottom:12px}.toolbar button{font:inherit;padding:9px 16px;border:0;border-radius:9px;background:#0891b2;color:white;cursor:pointer}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10mm}.card{border:1.5px solid #cde8ec;border-radius:16px;padding:10mm;text-align:center;break-inside:avoid;min-height:122mm;display:flex;flex-direction:column;align-items:center;justify-content:center}.brand{font-weight:700;color:#087e96;font-size:18px}.area{font-weight:700;font-size:22px;margin:10px 0 3px}.class{font-size:15px;color:#567}.hint{font-size:13px;color:#456;margin-top:9px}.qr{width:68mm;height:68mm;object-fit:contain}.code{font-size:10px;color:#9aa;margin-top:7px}@media print{.toolbar{display:none}.grid{gap:8mm}.card{min-height:125mm}}@media(max-width:700px){.grid{grid-template-columns:1fr}}' +
        '</style></head><body><div class="toolbar"><button id="print-qr-page" type="button">พิมพ์ / บันทึกเป็น PDF</button></div><div class="grid">' +
        cards
          .map(
            (q) =>
              '<section class="card"><div class="brand">RSD Clean · โรงเรียนรัษฎา</div><div class="area">' +
              esc(q.AreaName) +
              '</div><div class="class">ห้องรับผิดชอบ ' +
              esc(q.ClassName) +
              '</div><img class="qr" src="' +
              q.image +
              '" alt="QR"><div class="hint">สแกน ณ จุดตรวจเพื่อเปิดแบบประเมินพื้นที่นี้</div><div class="code">Area: ' +
              esc(q.AreaID) +
              "</div></section>",
          )
          .join("") +
        "</div></body></html>";
      win.document.open();
      win.document.write(html);
      win.document.close();
      const printButton=win.document.getElementById("print-qr-page");
      if(printButton)printButton.addEventListener("click",async()=>{
        try{if(win.document.fonts?.ready)await win.document.fonts.ready;}catch(e){}
        win.focus();
        win.print();
      });
    } catch (e) {
      win.close();
      error(e);
    } finally {
      busy(false);
    }
  }

  function editMaster(row = {}) {
    const name = adminTab,
      t = adminTables[name],
      key = { Users: "UserID", Classrooms: "ClassroomID", Areas: "AreaID" }[name];
    let form = "";
    t.fields.forEach((f, i) => {
      let control;
      if (f === "Role")
        control =
          '<select name="Role" required>' +
          ["Admin", "Supervisor", "Inspector", "Teacher"]
            .map(
              (r) =>
                "<option " +
                (r === (row.Role || "Inspector") ? "selected" : "") +
                ">" +
                r +
                "</option>",
            )
            .join("") +
          "</select>";
      else if (f.includes("ClassroomID"))
        control =
          '<select name="' +
          f +
          '" ' +
          (name === "Areas" ? "required" : "") +
          ">" +
          opts(S.master.Classrooms, "ClassroomID", "ClassName", row[f]) +
          "</select>";
      else
        control =
          '<input name="' +
          f +
          '" value="' +
          esc(row[f] || "") +
          '" required maxlength="' +
          (f === "Username" ? 80 : 200) +
          '">';
      form += '<div class="field"><label>' + t.labels[i] + "</label>" + control + "</div>";
    });
    if (name === "Users")
      form +=
        '<div class="field"><label>รหัสผ่าน ' +
        (row.UserID ? "(เว้นว่างเพื่อใช้เดิม)" : "(อย่างน้อย 4 ตัวอักษร)") +
        '</label><input type="password" name="newPassword" autocomplete="new-password" minlength="4" maxlength="200" ' +
        (row.UserID ? "" : "required") +
        "></div>";
    openModal(
      (row[key] ? "แก้ไข" : "เพิ่ม") + t.name,
      '<form id="master-form">' + form + '<button class="btn">บันทึกข้อมูล</button></form>',
    );
    $("master-form").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target,
        data = Object.fromEntries(new FormData(f));
      data[key] = row[key] || "";
      const password = data.newPassword;
      delete data.newPassword;
      busy(true);
      try {
        const credential = password ? await newCredential(password) : null;
        await rpc("saveMaster", { table: name, row: data, credential }, true);
        closeModal();
        toast("บันทึกเรียบร้อย");
        await route();
      } catch (e) {
        error(e);
      } finally {
        busy(false);
      }
    };
  }
  async function deleteRow(tableName, id) {
    const confirm = await Swal.fire({
      title: "ย้ายไปถังขยะ?",
      text: "กู้คืนได้ภายใน 30 วัน และประวัติผลตรวจที่บันทึกไว้จะยังคงอยู่",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "ย้ายไปถังขยะ",
      cancelButtonText: "ยกเลิก",
    });
    if (!confirm.isConfirmed) return;
    try {
      await rpc("deleteMaster", { table: tableName, id });
      toast("ย้ายไปถังขยะแล้ว");
      await route();
    } catch (e) {
      error(e);
    }
  }
  const dutyDayOptions = [
    [1, "จันทร์", "จ."], [2, "อังคาร", "อ."], [3, "พุธ", "พ."], [4, "พฤหัสบดี", "พฤ."], [5, "ศุกร์", "ศ."],
    [6, "เสาร์", "ส."], [7, "อาทิตย์", "อา."],
  ];
  function activeDutyDayOptions(){
    return dutyDayOptions.filter(([n])=>n<=5||(n===6&&S.config?.saturdayDutyEnabled===true)||(n===7&&S.config?.sundayDutyEnabled===true));
  }
  function dutyDaysArray(value) {
    const raw = String(value || "").trim();
    if (!raw) return [1, 2, 3, 4, 5];
    return [...new Set(raw.split(/[^1-7]+/).filter(Boolean).map(Number))].sort();
  }
  function dutyDaysLabel(value) {
    const days = dutyDaysArray(value);
    if (days.length === 5) return "จันทร์–ศุกร์";
    return days.map((n) => dutyDayOptions.find((d) => d[0] === n)?.[2] || n).join(" ");
  }
  // assignment-ui: area-first-v2
  let assignmentSelectedDutyDay = (() => {
    const raw = new Date().getDay(),d=raw===0?7:raw;
    return d>=1&&d<=7?d:1;
  })();
  function assignmentAreaSort(a, b) {
    return String(a.AreaName || "").localeCompare(String(b.AreaName || ""), "th", {
      numeric: true,
      sensitivity: "base",
    });
  }
  function assignmentContent() {
    const availableDays=activeDutyDayOptions();
    if(!availableDays.some(([n])=>n===assignmentSelectedDutyDay))assignmentSelectedDutyDay=availableDays[0]?.[0]||1;
    const m = S.master,
      inspectors = m.Users
        .filter((u) => u.Role === "Inspector")
        .sort((a, b) => String(a.FullName || "").localeCompare(String(b.FullName || ""), "th")),
      areas = [...m.Areas].sort(assignmentAreaSort),
      selectedDay = assignmentSelectedDutyDay,
      dayMeta = dutyDayOptions.find((d) => d[0] === selectedDay) || dutyDayOptions[0],
      dayAssignments = m.Assignments.filter((a) => dutyDaysArray(a.Days).includes(selectedDay)),
      byArea = new Map();

    dayAssignments.forEach((a) => {
      if (!byArea.has(a.AreaID)) byArea.set(a.AreaID, []);
      byArea.get(a.AreaID).push(a);
    });

    const areaNumber = new Map(
      areas.map((a, i) => [a.AreaID, String(i + 1).padStart(2, "0")]),
    );
    const assignedAreaCount = new Set(dayAssignments.map((a) => a.AreaID)).size;
    const activeInspectorCount = new Set(dayAssignments.map((a) => a.UserID)).size;
    const unassignedCount = Math.max(0, areas.length - assignedAreaCount);

    const dayTabs = availableDays
      .map(
        ([n, full, short]) =>
          '<button type="button" class="assignment-day-tab ' +
          (n === selectedDay ? "active" : "") +
          '" data-day="' +
          n +
          '" aria-pressed="' +
          (n === selectedDay ? "true" : "false") +
          '"><span>' +
          esc(short) +
          '</span><small>' +
          esc(full) +
          "</small></button>",
      )
      .join("");

    const areaCards = areas.length
      ? areas
          .map((a) => {
            const className = masterLabel("ResponsibleClassroomID", a.ResponsibleClassroomID),
              team = (byArea.get(a.AreaID) || []).sort((x, y) => {
                const xn = m.Users.find((u) => u.UserID === x.UserID)?.FullName || "";
                const yn = m.Users.find((u) => u.UserID === y.UserID)?.FullName || "";
                return xn.localeCompare(yn, "th");
              }),
              teamNames = team.map(
                (x) => m.Users.find((u) => u.UserID === x.UserID)?.FullName || "—",
              ),
              searchText = [a.AreaName, className, ...teamNames]
                .join(" ")
                .toLocaleLowerCase("th"),
              teamHtml = team.length
                ? team
                    .map((x) => {
                      const name =
                        m.Users.find((u) => u.UserID === x.UserID)?.FullName || "—";
                      return (
                        '<span class="assignment-person-chip"><span>' +
                        esc(name) +
                        '</span><button type="button" class="assignment-person-remove assignment-remove-day" data-id="' +
                        esc(x.AssignmentID) +
                        '" title="นำออกจากเวร' +
                        esc(dayMeta[1]) +
                        '" aria-label="นำ ' +
                        esc(name) +
                        " ออกจากเวร" +
                        esc(dayMeta[1]) +
                        '">×</button></span>'
                      );
                    })
                    .join("")
                : '<span class="assignment-empty-chip">ยังไม่มีผู้ตรวจ</span>';
            return (
              '<article class="assignment-area-card area-first-card" data-assigned="' +
              (team.length ? "1" : "0") +
              '" data-search="' +
              esc(searchText) +
              '">' +
              '<div class="assignment-area-main area-first-main">' +
              '<span class="assignment-area-no">' +
              areaNumber.get(a.AreaID) +
              '</span><span class="assignment-area-copy"><strong>' +
              esc(a.AreaName) +
              '</strong><small>ห้องรับผิดชอบ ' +
              esc(className) +
              "</small></span>" +
              '<span class="assignment-area-status ' +
              (team.length ? "assigned" : "empty") +
              '">' +
              (team.length ? team.length + " คน" : "ยังว่าง") +
              "</span></div>" +
              '<div class="area-first-label">ผู้ตรวจวัน' +
              esc(dayMeta[1]) +
              "</div>" +
              '<div class="assignment-area-team area-first-team">' +
              teamHtml +
              "</div>" +
              '<div class="area-first-actions"><button type="button" class="btn secondary area-first-add assignment-add-inspector" data-area="' +
              esc(a.AreaID) +
              '"><span aria-hidden="true">＋</span> เพิ่มผู้ตรวจ</button>' +
              (team.length ? '<button type="button" class="btn secondary area-first-clear assignment-clear-area" data-area="' + esc(a.AreaID) + '">ล้างผู้ตรวจ</button><button type="button" class="btn secondary assignment-copy-team" data-area="' + esc(a.AreaID) + '">👥 เพิ่มชุดผู้ตรวจไปพื้นที่อื่น</button>' : "") +
              "</div></article>"
            );
          })
          .join("")
      : '<div class="empty">ยังไม่มีเขตพื้นที่</div>';

    $("admin-content").innerHTML =
      '<div class="assignment-shell">' +
      '<div class="flex flex-wrap items-start justify-between gap-3 mb-3"><div><h2 class="text-lg">มอบหมายเวรตามพื้นที่</h2>' +
      '<p class="muted mt-1">เลือกวัน แล้วเพิ่มผู้ตรวจให้แต่ละพื้นที่โดยตรง เห็นสถานะครบทุกพื้นที่ในหน้าเดียว</p></div></div>' +
      '<div class="notice-duty mb-4"><b>วิธีใช้:</b> กด <b>+ เพิ่มผู้ตรวจ</b> ในพื้นที่ที่ต้องการ ระบบจะแสดงรายชื่อสภานักเรียนให้เลือก พื้นที่เดียวมีผู้ตรวจหลายคนได้</div>' +
      '<div class="assignment-day-tabs" aria-label="เลือกวันเข้าเวร">' +
      dayTabs +
      "</div>" +
      '<div class="assignment-stats">' +
      '<div class="assignment-stat"><span>พื้นที่ทั้งหมด</span><b>' +
      areas.length +
      '</b></div><div class="assignment-stat"><span>มีผู้ตรวจแล้ว</span><b>' +
      assignedAreaCount +
      '</b></div><div class="assignment-stat"><span>ยังไม่มีผู้ตรวจ</span><b>' +
      unassignedCount +
      '</b></div><div class="assignment-stat"><span>ผู้ตรวจเข้าเวร</span><b>' +
      activeInspectorCount +
      "</b></div></div>" +
      '<div class="assignment-export-bar"><div><b>ตารางเวรประจำสัปดาห์</b><small>ส่งออกเวรตามวันที่เปิดใช้งานครบทุกพื้นที่</small></div><div class="assignment-export-actions"><button type="button" class="btn secondary" id="assignment-print-roster">🖨 พิมพ์ / PDF</button><button type="button" class="btn secondary" id="assignment-export-csv">⬇ ส่งออก CSV</button></div></div>' +
      '<div class="assignment-toolbar area-first-toolbar"><div class="search-box assignment-search"><i data-lucide="search"></i><input id="assignment-area-search" type="search" placeholder="ค้นหาพื้นที่ / ห้องเรียน / ผู้ตรวจ…"></div>' +
      '<label class="assignment-filter-check"><input id="assignment-only-unassigned" type="checkbox"> เฉพาะพื้นที่ยังว่าง</label>' +
      '<label class="assignment-filter-check"><input id="assignment-only-assigned" type="checkbox"> เฉพาะพื้นที่มีเวร</label><button type="button" class="btn secondary" id="assignment-copy-days">⧉ คัดลอกไปวันอื่น</button><button type="button" class="btn assignment-copy-all" id="assignment-copy-all">⚡ ใช้เวรนี้ทุกวัน</button><button type="button" class="btn secondary assignment-delete-tools" id="assignment-delete-tools">🗑 ลบเวรเร็ว</button></div>' +
      '<div class="assignment-area-meta"><span>วัน<b>' +
      esc(dayMeta[1]) +
      '</b></span><span>กำลังแสดง <b id="assignment-visible-count">' +
      areas.length +
      "</b> / " +
      areas.length +
      " พื้นที่</span></div>" +
      '<div class="assignment-area-grid area-first-grid">' +
      areaCards +
      "</div></div>";

    icons();

    const cards = [...document.querySelectorAll(".assignment-area-card")],
      searchInput = $("assignment-area-search"),
      onlyUnassigned = $("assignment-only-unassigned"),
      onlyAssigned = $("assignment-only-assigned");

    const applyFilter = () => {
      const q = String(searchInput.value || "")
          .trim()
          .toLocaleLowerCase("th"),
        onlyEmpty = onlyUnassigned.checked,
        onlyHas = onlyAssigned.checked;
      if (onlyEmpty && onlyHas) {
        onlyAssigned.checked = false;
      }
      let visible = 0;
      cards.forEach((card) => {
        const assigned = card.dataset.assigned === "1";
        const show =
          (!q || String(card.dataset.search || "").includes(q)) &&
          (!onlyUnassigned.checked || !assigned) &&
          (!onlyAssigned.checked || assigned);
        card.hidden = !show;
        if (show) visible++;
      });
      $("assignment-visible-count").textContent = String(visible);
    };

    document.querySelectorAll(".assignment-day-tab").forEach((b) => {
      b.onclick = () => {
        assignmentSelectedDutyDay = Number(b.dataset.day) || 1;
        assignmentContent();
      };
    });
    searchInput.oninput = applyFilter;
    onlyUnassigned.onchange = () => {
      if (onlyUnassigned.checked) onlyAssigned.checked = false;
      applyFilter();
    };
    onlyAssigned.onchange = () => {
      if (onlyAssigned.checked) onlyUnassigned.checked = false;
      applyFilter();
    };
    document.querySelectorAll(".assignment-add-inspector").forEach((b) => {
      b.onclick = () => assignmentAreaInspectorModal(b.dataset.area, selectedDay);
    });
    document.querySelectorAll(".assignment-clear-area").forEach((b) => {
      b.onclick = () => clearAreaDuty(b.dataset.area, selectedDay);
    });
    document.querySelectorAll(".assignment-copy-team").forEach((b) => {
      b.onclick = () => assignmentCopyTeamModal(b.dataset.area, selectedDay);
    });
    $("assignment-print-roster").onclick = assignmentPrintRoster;
    $("assignment-export-csv").onclick = assignmentExportRosterCsv;
    $("assignment-copy-days").onclick = () => assignmentCopyDaysModal(selectedDay);
    $("assignment-copy-all").onclick = () => assignmentCopyAllDays(selectedDay);
    $("assignment-delete-tools").onclick = () => assignmentDeleteToolsModal(selectedDay);
    document.querySelectorAll(".assignment-remove-day").forEach((b) => {
      b.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeAssignmentDutyDay(b.dataset.id, selectedDay);
      };
    });
    applyFilter();
  }


  function assignmentRosterMatrix() {
    const m=S.master,
      areas=[...m.Areas].sort(assignmentAreaSort),
      users=new Map(m.Users.map(u=>[u.UserID,u.FullName||"—"])),
      byAreaDay=new Map();

    for(const a of m.Assignments){
      const name=users.get(a.UserID)||"—";
      for(const day of dutyDaysArray(a.Days)){
        const key=String(a.AreaID)+"|"+day;
        if(!byAreaDay.has(key))byAreaDay.set(key,[]);
        byAreaDay.get(key).push(name);
      }
    }
    for(const names of byAreaDay.values()) names.sort((a,b)=>String(a).localeCompare(String(b),"th"));

    return areas.map((area,index)=>({
      no:String(index+1).padStart(2,"0"),
      area:area.AreaName||"—",
      classroom:masterLabel("ResponsibleClassroomID",area.ResponsibleClassroomID)||"—",
      days:activeDutyDayOptions().map(([day])=>(byAreaDay.get(String(area.AreaID)+"|"+day)||[]).join(", ")||"—")
    }));
  }

  function assignmentPrintRoster() {
    const rows=assignmentRosterMatrix();
    if(!rows.length)return error(new Error("ยังไม่มีข้อมูลพื้นที่สำหรับพิมพ์"));
    const win=window.open("","_blank");
    if(!win)return error(new Error("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up สำหรับเว็บไซต์นี้"));

    const generated=new Date().toLocaleString("th-TH",{
      timeZone:"Asia/Bangkok",
      dateStyle:"medium",
      timeStyle:"short"
    });
    const activeDays=activeDutyDayOptions(),dayNames=activeDays.map(x=>x[1]);
    const body=rows.map(r=>
      "<tr><td class='center'>"+esc(r.no)+"</td><td>"+esc(r.area)+"</td><td>"+esc(r.classroom)+"</td>"+
      r.days.map(v=>"<td>"+esc(v)+"</td>").join("")+"</tr>"
    ).join("");

    const html='<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ตารางเวรตรวจเขตพื้นที่ - โรงเรียนรัษฎา</title>'+
      '<style>'+
      '@page{size:A4 landscape;margin:8mm}*{box-sizing:border-box}body{font-family:"Kanit","Noto Sans Thai",Tahoma,sans-serif;color:#17313b;margin:0;background:#fff}'+
      '.toolbar{position:sticky;top:0;z-index:10;background:#fff;padding:10px 0 14px;display:flex;gap:8px}.toolbar button{border:0;border-radius:9px;background:#0f8294;color:#fff;padding:9px 14px;font:600 13px inherit;cursor:pointer}'+
      'header{text-align:center;margin:2px 0 10px}h1{font-size:20px;margin:0 0 3px}h2{font-size:14px;font-weight:500;margin:0;color:#526d77}.meta{font-size:10px;color:#71858d;margin-top:5px}'+
      'table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9px}thead{display:table-header-group}th,td{border:1px solid #aebfc5;padding:5px 5px;vertical-align:top;overflow-wrap:anywhere}th{background:#eaf6f8;text-align:center;font-size:9px}tr{break-inside:avoid;page-break-inside:avoid}.center{text-align:center}.no{width:5%}.area{width:19%}.room{width:11%}.day{width:13%}'+
      'footer{margin-top:8px;display:flex;justify-content:space-between;gap:10px;font-size:9px;color:#7b8d94}'+
      '@media print{.toolbar{display:none}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}'+
      '</style></head><body><div class="toolbar"><button onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button><button onclick="window.close()">ปิด</button></div>'+
      '<header><h1>ตารางเวรตรวจความสะอาดและเขตพื้นที่ประจำสัปดาห์</h1><h2>โรงเรียนรัษฎา</h2><div class="meta">RSD Clean · '+esc(dayNames.join(" · "))+' · พื้นที่ทั้งหมด '+rows.length+' พื้นที่</div></header>'+
      '<table><thead><tr><th class="no">ลำดับ</th><th class="area">พื้นที่</th><th class="room">ห้องรับผิดชอบ</th>'+dayNames.map(n=>'<th class="day">'+esc(n)+'</th>').join("")+'</tr></thead><tbody>'+body+'</tbody></table>'+
      '<footer><span>ระบบ RSD Clean · โรงเรียนรัษฎา</span><span>จัดทำเมื่อ '+esc(generated)+' น.</span></footer></body></html>';
    win.document.open();
    win.document.write(html);
    win.document.close();
    setTimeout(()=>{try{win.focus();win.print();}catch(e){}},450);
  }

  function assignmentExportRosterCsv() {
    const rows=assignmentRosterMatrix();
    if(!rows.length)return error(new Error("ยังไม่มีข้อมูลพื้นที่สำหรับส่งออก"));
    const cell=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
    const header=["ลำดับ","พื้นที่","ห้องรับผิดชอบ",...activeDutyDayOptions().map(x=>x[1])];
    const csv=[header,...rows.map(r=>[r.no,r.area,r.classroom,...r.days])]
      .map(row=>row.map(cell).join(","))
      .join("\r\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    const stamp=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"});
    a.href=url;
    a.download="RSD-Clean-Duty-Roster-"+stamp+".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    toast("ส่งออกตารางเวร CSV แล้ว");
  }

  function assignmentAreaInspectorModal(areaId, day) {
    const m = S.master,
      area = m.Areas.find((a) => a.AreaID === areaId);
    if (!area) return error(new Error("ไม่พบพื้นที่"));
    const n = Number(day),
      dayName = dutyDayOptions.find((d) => d[0] === n)?.[1] || String(n),
      inspectors = m.Users
        .filter((u) => u.Role === "Inspector")
        .sort((a, b) => String(a.FullName || "").localeCompare(String(b.FullName || ""), "th")),
      current = m.Assignments.filter(
        (a) => a.AreaID === areaId && dutyDaysArray(a.Days).includes(n),
      ),
      currentIds = new Set(current.map((a) => a.UserID)),
      className = masterLabel("ResponsibleClassroomID", area.ResponsibleClassroomID),
      choices = inspectors.length
        ? inspectors
            .map((u) => {
              const already = currentIds.has(u.UserID);
              return (
                '<label class="assignment-inspector-choice ' +
                (already ? "already" : "") +
                '" data-search="' +
                esc(String(u.FullName || "").toLocaleLowerCase("th")) +
                '">' +
                '<input type="checkbox" name="user" value="' +
                esc(u.UserID) +
                '" ' +
                (already ? "disabled" : "") +
                "><span><strong>" +
                esc(u.FullName) +
                "</strong><small>" +
                (already ? "มอบหมายพื้นที่นี้แล้ว" : "เลือกเพิ่มเป็นผู้ตรวจ") +
                "</small></span>" +
                (already ? '<span class="pill gray">มีเวรแล้ว</span>' : "") +
                "</label>"
              );
            })
            .join("")
        : '<div class="empty">ยังไม่มีบัญชีผู้ตรวจ</div>';

    openModal(
      "เพิ่มผู้ตรวจ · " + area.AreaName,
      '<form id="area-inspector-form">' +
        '<div class="area-inspector-context"><div><span class="assignment-area-no">' +
        String([...m.Areas].sort(assignmentAreaSort).findIndex((a) => a.AreaID === areaId) + 1).padStart(2, "0") +
        '</span></div><div><b>' +
        esc(area.AreaName) +
        '</b><small>ห้องรับผิดชอบ ' +
        esc(className) +
        " · วัน" +
        esc(dayName) +
        "</small></div></div>" +
        '<div class="search-box mt-4 mb-3"><i data-lucide="search"></i><input id="area-inspector-search" type="search" placeholder="ค้นหาชื่อผู้ตรวจ…"></div>' +
        '<div class="assignment-inspector-choice-list">' +
        choices +
        "</div>" +
        '<div class="area-inspector-footer"><span id="area-inspector-selected">ยังไม่ได้เลือกผู้ตรวจเพิ่ม</span><button class="btn" id="area-inspector-save" ' +
        (!inspectors.length ? "disabled" : "") +
        ">เพิ่มผู้ตรวจที่เลือก</button></div></form>",
    );
    icons();

    const form = $("area-inspector-form"),
      search = $("area-inspector-search"),
      rows = [...document.querySelectorAll(".assignment-inspector-choice")],
      save = $("area-inspector-save"),
      selected = $("area-inspector-selected");

    const sync = () => {
      const count = form
        ? form.querySelectorAll('input[name="user"]:checked:not(:disabled)').length
        : 0;
      selected.textContent = count ? "เลือกแล้ว " + count + " คน" : "ยังไม่ได้เลือกผู้ตรวจเพิ่ม";
      if (save) save.disabled = !count;
    };
    search.oninput = () => {
      const q = String(search.value || "").trim().toLocaleLowerCase("th");
      rows.forEach((row) => {
        row.hidden = !!q && !String(row.dataset.search || "").includes(q);
      });
    };
    rows.forEach((row) => {
      const input = row.querySelector('input[name="user"]');
      if (input && !input.disabled) input.onchange = sync;
    });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const userIds = new FormData(form).getAll("user").map(String);
      if (!userIds.length) return error(new Error("เลือกผู้ตรวจอย่างน้อย 1 คน"));
      busy(true, "กำลังเพิ่มผู้ตรวจ…");
      try {
        await rpc("assign", {
          userIds,
          areaIds: [String(areaId)],
          days: [String(n)],
        });
        S.master = await rpc("master", {}, true);
        closeModal();
        toast("เพิ่มผู้ตรวจวัน" + dayName + "แล้ว " + userIds.length + " คน");
        assignmentContent();
      } catch (e) {
        error(e);
      } finally {
        busy(false);
      }
    };
    sync();
  }



  function assignmentCopyTeamModal(sourceAreaId, day) {
    const m=S.master,
      n=Number(day),
      dayName=dutyDayOptions.find(d=>d[0]===n)?.[1]||String(n),
      sourceArea=m.Areas.find(a=>String(a.AreaID)===String(sourceAreaId));
    if(!sourceArea)return error(new Error("ไม่พบพื้นที่ต้นแบบ"));

    const sourceRows=m.Assignments.filter(a=>String(a.AreaID)===String(sourceAreaId)&&dutyDaysArray(a.Days).includes(n)),
      sourceUserIds=[...new Set(sourceRows.map(a=>String(a.UserID)))];
    if(!sourceUserIds.length)return error(new Error("พื้นที่นี้ยังไม่มีชุดผู้ตรวจในวัน"+dayName));

    const userMap=new Map(m.Users.map(u=>[String(u.UserID),u])),
      sourceNames=sourceUserIds.map(id=>userMap.get(id)?.FullName||"—"),
      dayRows=m.Assignments.filter(a=>dutyDaysArray(a.Days).includes(n)),
      byArea=new Map();

    dayRows.forEach(a=>{
      const key=String(a.AreaID);
      if(!byArea.has(key))byArea.set(key,new Set());
      byArea.get(key).add(String(a.UserID));
    });

    const targets=[...m.Areas]
      .filter(a=>String(a.AreaID)!==String(sourceAreaId))
      .sort(assignmentAreaSort)
      .map(a=>{
        const current=byArea.get(String(a.AreaID))||new Set(),
          missing=sourceUserIds.filter(id=>!current.has(id)),
          existingNames=[...current].map(id=>userMap.get(id)?.FullName||"—").filter(Boolean);
        return{area:a,missing,existingNames,complete:missing.length===0};
      });

    if(!targets.length)return error(new Error("ไม่มีพื้นที่อื่นให้เพิ่มชุดผู้ตรวจ"));

    const rowsHtml=targets.map((x,idx)=>{
      const cls=masterLabel("ResponsibleClassroomID",x.area.ResponsibleClassroomID)||"—",
        meta=x.complete?"มีชุดผู้ตรวจนี้ครบแล้ว":(x.existingNames.length?"มีผู้ตรวจเดิม "+x.existingNames.length+" คน · จะเพิ่ม "+x.missing.length+" คน":"จะเพิ่ม "+x.missing.length+" คน"),
        search=[x.area.AreaName,cls,...x.existingNames].join(" ").toLocaleLowerCase("th");
      return '<label class="copy-team-area '+(x.complete?"complete":"")+'" data-search="'+esc(search)+'">'+
        '<input type="checkbox" name="targetArea" value="'+esc(x.area.AreaID)+'" '+(x.complete?"disabled":"")+'>'+
        '<span><b>'+esc(x.area.AreaName)+'</b><small>ห้องรับผิดชอบ '+esc(cls)+' · '+esc(meta)+'</small></span>'+
        (x.complete?'<span class="pill gray">ครบแล้ว</span>':'')+
      '</label>';
    }).join("");

    openModal(
      "เพิ่มชุดผู้ตรวจไปพื้นที่อื่น",
      '<form id="copy-team-form">'+
        '<div class="copy-team-source"><div><span>ต้นแบบวัน'+esc(dayName)+'</span><b>'+esc(sourceArea.AreaName)+'</b></div><strong>'+sourceUserIds.length+' คน</strong></div>'+
        '<div class="copy-team-members">'+sourceNames.map(n=>'<span>'+esc(n)+'</span>').join("")+'</div>'+
        '<div class="copy-duty-note"><b>เป็นการเพิ่ม</b> ผู้ตรวจชุดนี้เข้าไปในพื้นที่ปลายทาง ผู้ตรวจเดิมจะไม่ถูกลบหรือแทนที่</div>'+
        '<div class="search-box mt-3 mb-2"><i data-lucide="search"></i><input id="copy-team-search" type="search" placeholder="ค้นหาพื้นที่ / ห้องเรียน…"></div>'+
        '<div class="copy-team-tools"><button type="button" class="btn secondary" id="copy-team-all">เลือกทุกพื้นที่</button><button type="button" class="btn secondary" id="copy-team-empty">เฉพาะพื้นที่ยังไม่มีผู้ตรวจ</button><button type="button" class="btn secondary" id="copy-team-clear">ล้างการเลือก</button></div>'+
        '<div class="copy-team-area-list">'+rowsHtml+'</div>'+
        '<div class="area-inspector-footer"><span id="copy-team-selected">ยังไม่ได้เลือกพื้นที่ปลายทาง</span><button class="btn" id="copy-team-save" disabled>เพิ่มชุดผู้ตรวจ</button></div>'+
      '</form>'
    );
    icons();

    const form=$("copy-team-form"),
      boxes=[...form.querySelectorAll('input[name="targetArea"]')],
      rows=[...form.querySelectorAll(".copy-team-area")],
      search=$("copy-team-search"),
      save=$("copy-team-save"),
      selected=$("copy-team-selected");

    const sync=()=>{
      const chosen=boxes.filter(x=>x.checked&&!x.disabled);
      selected.textContent=chosen.length?"เลือกแล้ว "+chosen.length+" พื้นที่ · ชุด "+sourceUserIds.length+" คน":"ยังไม่ได้เลือกพื้นที่ปลายทาง";
      save.disabled=!chosen.length;
      save.textContent=chosen.length?"เพิ่มชุดไป "+chosen.length+" พื้นที่":"เพิ่มชุดผู้ตรวจ";
    };

    search.oninput=()=>{
      const q=String(search.value||"").trim().toLocaleLowerCase("th");
      rows.forEach(row=>row.hidden=!!q&&!String(row.dataset.search||"").includes(q));
    };
    boxes.forEach(x=>x.onchange=sync);

    $("copy-team-all").onclick=()=>{
      boxes.forEach(x=>{if(!x.disabled)x.checked=true;});
      sync();
    };
    $("copy-team-empty").onclick=()=>{
      boxes.forEach(x=>{
        if(x.disabled)return;
        const areaId=String(x.value),current=byArea.get(areaId)||new Set();
        x.checked=current.size===0;
      });
      sync();
    };
    $("copy-team-clear").onclick=()=>{
      boxes.forEach(x=>x.checked=false);
      sync();
    };

    form.onsubmit=async e=>{
      e.preventDefault();
      const areaIds=boxes.filter(x=>x.checked&&!x.disabled).map(x=>String(x.value));
      if(!areaIds.length)return;
      const allTargets=areaIds.length===boxes.filter(x=>!x.disabled).length;
      const ok=await Swal.fire({
        icon:"question",
        title:allTargets?"เพิ่มชุดผู้ตรวจไปทุกพื้นที่?":"เพิ่มชุดผู้ตรวจไป "+areaIds.length+" พื้นที่?",
        html:"ชุด <b>"+sourceUserIds.length+" คน</b> จาก <b>"+esc(sourceArea.AreaName)+"</b> วัน"+esc(dayName)+"<br><span class='muted'>ผู้ตรวจเดิมของพื้นที่ปลายทางจะยังอยู่เหมือนเดิม</span>",
        showCancelButton:true,
        confirmButtonText:"เพิ่มชุดผู้ตรวจ",
        cancelButtonText:"ยกเลิก"
      });
      if(!ok.isConfirmed)return;
      busy(true,"กำลังเพิ่มชุดผู้ตรวจ…");
      try{
        const result=await rpc("assign",{userIds:sourceUserIds,areaIds,days:[String(n)]});
        S.master=await rpc("master",{},true);
        closeModal();
        toast("เพิ่มชุดผู้ตรวจแล้ว "+areaIds.length+" พื้นที่");
        assignmentContent();
      }catch(e){error(e);}finally{busy(false);}
    };
    sync();
  }


  async function assignmentCopyAllDays(sourceDay) {
    const n=Number(sourceDay),
      dayName=dutyDayOptions.find(d=>d[0]===n)?.[1]||String(n),
      sourceRows=S.master.Assignments.filter(a=>dutyDaysArray(a.Days).includes(n)),
      targets=activeDutyDayOptions().map(x=>x[0]).filter(d=>d!==n);
    if(!sourceRows.length)return error(new Error("วัน"+dayName+"ยังไม่มีเวรให้คัดลอก"));
    const ok=await Swal.fire({
      icon:"question",
      title:"ใช้เวรวัน"+dayName+"เป็นเวรทุกวัน?",
      html:"จะทำให้วันอื่นที่เปิดใช้งานมีผู้ตรวจและพื้นที่ <b>เหมือนวัน"+esc(dayName)+"</b><br><span class='muted'>เวรเดิมของวันปลายทางจะถูกแทนที่ แต่เวรวัน"+esc(dayName)+"จะไม่เปลี่ยน</span>",
      showCancelButton:true,
      confirmButtonText:"ใช้เวรนี้ทุกวัน",
      cancelButtonText:"ยกเลิก"
    });
    if(!ok.isConfirmed)return;
    busy(true,"กำลังคัดลอกเวรไปทุกวัน…");
    try{
      const r=await rpc("copyDutyAssignments",{sourceDay:n,targetDays:targets});
      S.master=await rpc("master",{},true);
      toast("ตั้งเวรเหมือนวัน"+dayName+"ครบทุกวันที่เปิดใช้งานแล้ว");
      assignmentContent();
    }catch(e){error(e);}finally{busy(false);}
  }

  function assignmentCopyDaysModal(sourceDay) {
    const n=Number(sourceDay),
      dayName=dutyDayOptions.find(d=>d[0]===n)?.[1]||String(n),
      sourceRows=S.master.Assignments.filter(a=>dutyDaysArray(a.Days).includes(n));
    if(!sourceRows.length)return error(new Error("วัน"+dayName+"ยังไม่มีเวรให้คัดลอก"));

    const checks=activeDutyDayOptions()
      .filter(([d])=>d!==n)
      .map(([d,full])=>'<label class="copy-duty-day"><input type="checkbox" name="targetDay" value="'+d+'"><span><b>'+esc(full)+'</b><small>แทนที่ด้วยเวรวัน'+esc(dayName)+'</small></span></label>')
      .join("");

    openModal(
      "คัดลอกเวรวัน"+dayName,
      '<form id="copy-duty-form">'+
        '<div class="copy-duty-source"><b>ต้นแบบ: วัน'+esc(dayName)+'</b><span>'+sourceRows.length+' รายการเวร</span></div>'+
        '<p class="muted mt-3 mb-2">เลือกวันปลายทางที่ต้องการให้มีเวรเหมือนวัน'+esc(dayName)+'</p>'+
        '<div class="copy-duty-days">'+checks+'</div>'+
        '<div class="copy-duty-note">วันปลายทางที่เลือกจะถูก <b>แทนที่</b> ให้เหมือนต้นแบบทั้งหมด เพื่อไม่ให้เกิดเวรเก่าปะปน</div>'+
        '<div class="flex gap-2 mt-4"><button type="button" class="btn secondary" id="copy-duty-select-all">เลือกวันทั้งหมด</button><button class="btn" id="copy-duty-save" disabled>คัดลอกเวร</button></div>'+
      '</form>'
    );

    const form=$("copy-duty-form"),
      save=$("copy-duty-save"),
      boxes=[...form.querySelectorAll('input[name="targetDay"]')];
    const sync=()=>{
      const count=boxes.filter(x=>x.checked).length;
      save.disabled=!count;
      save.textContent=count?"คัดลอกไป "+count+" วัน":"คัดลอกเวร";
    };
    boxes.forEach(x=>x.onchange=sync);
    $("copy-duty-select-all").onclick=()=>{boxes.forEach(x=>x.checked=true);sync();};
    form.onsubmit=async e=>{
      e.preventDefault();
      const targetDays=boxes.filter(x=>x.checked).map(x=>Number(x.value));
      if(!targetDays.length)return;
      const labels=targetDays.map(d=>dutyDayOptions.find(x=>x[0]===d)?.[2]||d).join(" ");
      const ok=await Swal.fire({
        icon:"warning",
        title:"ยืนยันคัดลอกเวร?",
        html:"เวรวัน"+esc(dayName)+"จะถูกใช้แทนเวรเดิมของ <b>"+esc(labels)+"</b>",
        showCancelButton:true,
        confirmButtonText:"คัดลอกและแทนที่",
        cancelButtonText:"ยกเลิก"
      });
      if(!ok.isConfirmed)return;
      busy(true,"กำลังคัดลอกเวร…");
      try{
        await rpc("copyDutyAssignments",{sourceDay:n,targetDays});
        S.master=await rpc("master",{},true);
        closeModal();
        toast("คัดลอกเวรเรียบร้อย");
        assignmentContent();
      }catch(e){error(e);}finally{busy(false);}
    };
    sync();
  }

  async function refreshAssignmentsAfterRemoval(message) {
    S.master = await rpc("master", {}, true);
    closeModal();
    if (message) toast(message);
    assignmentContent();
  }

  async function clearAreaDuty(areaId, day) {
    const m=S.master,
      area=m.Areas.find(a=>a.AreaID===areaId);
    if(!area)return error(new Error("ไม่พบพื้นที่"));
    const n=Number(day),
      dayName=dutyDayOptions.find(d=>d[0]===n)?.[1]||String(n),
      team=m.Assignments.filter(a=>a.AreaID===areaId&&dutyDaysArray(a.Days).includes(n));
    if(!team.length)return toast("พื้นที่นี้ยังไม่มีผู้ตรวจในวัน"+dayName);
    const names=team.map(a=>m.Users.find(u=>u.UserID===a.UserID)?.FullName||"—");
    const ok=await Swal.fire({
      icon:"warning",
      title:"ล้างผู้ตรวจพื้นที่นี้?",
      html:"<b>"+esc(area.AreaName)+"</b><br>วัน"+esc(dayName)+" · "+team.length+" คน<br><span class='muted'>"+names.map(esc).join(" · ")+"</span>",
      showCancelButton:true,
      confirmButtonText:"ล้างผู้ตรวจ",
      cancelButtonText:"ยกเลิก",
      confirmButtonColor:"#be123c"
    });
    if(!ok.isConfirmed)return;
    busy(true,"กำลังล้างผู้ตรวจ…");
    try{
      const r=await rpc("removeDutyAssignments",{mode:"areas",day:n,areaIds:[String(areaId)]});
      await refreshAssignmentsAfterRemoval("ล้างผู้ตรวจแล้ว "+Number(r.changed||0)+" รายการ");
    }catch(e){error(e);}finally{busy(false);}
  }

  function assignmentDeleteToolsModal(day) {
    const m=S.master,n=Number(day),
      dayName=dutyDayOptions.find(d=>d[0]===n)?.[1]||String(n),
      dayRows=m.Assignments.filter(a=>dutyDaysArray(a.Days).includes(n)),
      activeUserIds=[...new Set(dayRows.map(a=>a.UserID))],
      activeAreaIds=[...new Set(dayRows.map(a=>a.AreaID))],
      inspectors=m.Users
        .filter(u=>u.Role==="Inspector"&&activeUserIds.includes(u.UserID))
        .sort((a,b)=>String(a.FullName||"").localeCompare(String(b.FullName||""),"th")),
      areas=[...m.Areas]
        .filter(a=>activeAreaIds.includes(a.AreaID))
        .sort(assignmentAreaSort);

    const inspectorOptions=inspectors.length
      ? '<option value="">— เลือกผู้ตรวจ —</option>'+inspectors.map(u=>{
          const count=dayRows.filter(a=>a.UserID===u.UserID).length;
          return '<option value="'+esc(u.UserID)+'">'+esc(u.FullName)+' ('+count+' พื้นที่)</option>';
        }).join("")
      : '<option value="">ยังไม่มีผู้ตรวจในวันนี้</option>';

    const areaRows=areas.length
      ? areas.map(a=>{
          const count=dayRows.filter(x=>x.AreaID===a.AreaID).length,
            className=masterLabel("ResponsibleClassroomID",a.ResponsibleClassroomID);
          return '<label class="quick-delete-area-row"><input type="checkbox" name="area" value="'+esc(a.AreaID)+'"><span><b>'+esc(a.AreaName)+'</b><small>'+esc(className)+' · '+count+' คน</small></span></label>';
        }).join("")
      : '<div class="muted">ยังไม่มีพื้นที่ที่มีเวรในวันนี้</div>';

    openModal(
      "ลบเวรเร็ว · วัน"+dayName,
      '<div class="quick-delete-wrap">'+
        '<section class="quick-delete-card"><div class="quick-delete-head"><span>1</span><div><b>ลบผู้ตรวจคนหนึ่งออกจากทั้งวัน</b><small>เหมาะกรณีลา หรือเปลี่ยนเวรทั้งวัน</small></div></div>'+
          '<select id="quick-delete-inspector">'+inspectorOptions+'</select>'+
          '<button type="button" class="btn secondary danger-soft w-full mt-2" id="quick-delete-inspector-btn" '+(!inspectors.length?'disabled':'')+'>นำผู้ตรวจออกจากเวรวันนี้ทั้งหมด</button>'+
        '</section>'+
        '<section class="quick-delete-card"><div class="quick-delete-head"><span>2</span><div><b>ล้างผู้ตรวจหลายพื้นที่</b><small>เลือกหลายพื้นที่แล้วล้างพร้อมกันครั้งเดียว</small></div></div>'+
          '<div class="flex flex-wrap gap-2 mb-2"><button type="button" class="btn small secondary" id="quick-delete-select-all">เลือกทั้งหมด</button><button type="button" class="btn small secondary" id="quick-delete-clear-select">ล้างที่เลือก</button><span class="muted">เลือกแล้ว <b id="quick-delete-area-count">0</b> พื้นที่</span></div>'+
          '<div class="quick-delete-area-list">'+areaRows+'</div>'+
          '<button type="button" class="btn secondary danger-soft w-full mt-3" id="quick-delete-areas-btn" disabled>ล้างผู้ตรวจจากพื้นที่ที่เลือก</button>'+
        '</section>'+
        '<section class="quick-delete-card danger-zone"><div class="quick-delete-head"><span>3</span><div><b>ล้างเวรทั้งวัน</b><small>นำผู้ตรวจทั้งหมดออกจากทุกพื้นที่เฉพาะวัน'+esc(dayName)+'</small></div></div>'+
          '<button type="button" class="btn danger w-full" id="quick-delete-day-btn" '+(!dayRows.length?'disabled':'')+'>ล้างเวรวัน'+esc(dayName)+'ทั้งหมด ('+dayRows.length+' รายการ)</button>'+
        '</section>'+
      '</div>'
    );

    const inspectorSel=$("quick-delete-inspector"),
      inspectorBtn=$("quick-delete-inspector-btn"),
      areaBtn=$("quick-delete-areas-btn"),
      checks=[...document.querySelectorAll('.quick-delete-area-row input[name="area"]')];

    const syncAreas=()=>{
      const count=checks.filter(x=>x.checked).length;
      $("quick-delete-area-count").textContent=String(count);
      areaBtn.disabled=!count;
      areaBtn.textContent=count?"ล้างผู้ตรวจ "+count+" พื้นที่":"ล้างผู้ตรวจจากพื้นที่ที่เลือก";
    };
    checks.forEach(x=>x.onchange=syncAreas);
    $("quick-delete-select-all").onclick=()=>{checks.forEach(x=>x.checked=true);syncAreas();};
    $("quick-delete-clear-select").onclick=()=>{checks.forEach(x=>x.checked=false);syncAreas();};

    inspectorBtn.onclick=async()=>{
      const userId=String(inspectorSel.value||"");
      if(!userId)return error(new Error("เลือกผู้ตรวจก่อน"));
      const user=m.Users.find(u=>u.UserID===userId),
        count=dayRows.filter(a=>a.UserID===userId).length;
      const ok=await Swal.fire({
        icon:"warning",
        title:"นำผู้ตรวจออกจากทั้งวัน?",
        html:"<b>"+esc(user?.FullName||"—")+"</b><br>วัน"+esc(dayName)+" · "+count+" พื้นที่<br><span class='muted'>เวรวันอื่นจะไม่ถูกกระทบ</span>",
        showCancelButton:true,confirmButtonText:"นำออกจากทั้งวัน",cancelButtonText:"ยกเลิก",confirmButtonColor:"#be123c"
      });
      if(!ok.isConfirmed)return;
      busy(true,"กำลังลบเวรผู้ตรวจ…");
      try{
        const r=await rpc("removeDutyAssignments",{mode:"inspector",day:n,userId});
        await refreshAssignmentsAfterRemoval("นำผู้ตรวจออกแล้ว "+Number(r.changed||0)+" พื้นที่");
      }catch(e){error(e);}finally{busy(false);}
    };

    areaBtn.onclick=async()=>{
      const areaIds=checks.filter(x=>x.checked).map(x=>x.value);
      if(!areaIds.length)return;
      const affected=dayRows.filter(a=>areaIds.includes(a.AreaID)).length;
      const ok=await Swal.fire({
        icon:"warning",
        title:"ล้างผู้ตรวจจาก "+areaIds.length+" พื้นที่?",
        html:"จะนำเวรวัน"+esc(dayName)+"ออก "+affected+" รายการ<br><span class='muted'>เวรวันอื่นจะยังคงเดิม</span>",
        showCancelButton:true,confirmButtonText:"ล้างพื้นที่ที่เลือก",cancelButtonText:"ยกเลิก",confirmButtonColor:"#be123c"
      });
      if(!ok.isConfirmed)return;
      busy(true,"กำลังล้างหลายพื้นที่…");
      try{
        const r=await rpc("removeDutyAssignments",{mode:"areas",day:n,areaIds});
        await refreshAssignmentsAfterRemoval("ล้างผู้ตรวจแล้ว "+Number(r.changed||0)+" รายการ");
      }catch(e){error(e);}finally{busy(false);}
    };

    $("quick-delete-day-btn").onclick=async()=>{
      if(!dayRows.length)return;
      const ok=await Swal.fire({
        icon:"warning",
        title:"ล้างเวรวัน"+dayName+"ทั้งหมด?",
        html:"ผู้ตรวจทั้ง "+activeUserIds.length+" คน จาก "+activeAreaIds.length+" พื้นที่<br><b>"+dayRows.length+" รายการเวรจะถูกนำออกเฉพาะวันนี้</b><br><span class='muted'>วันอื่นไม่ถูกกระทบ และรายการที่ไม่มีวันอื่นเหลือจะเข้าถังขยะ</span>",
        showCancelButton:true,confirmButtonText:"ล้างเวรทั้งวัน",cancelButtonText:"ยกเลิก",confirmButtonColor:"#be123c"
      });
      if(!ok.isConfirmed)return;
      busy(true,"กำลังล้างเวรทั้งวัน…");
      try{
        const r=await rpc("removeDutyAssignments",{mode:"day",day:n});
        await refreshAssignmentsAfterRemoval("ล้างเวรวัน"+dayName+"แล้ว "+Number(r.changed||0)+" รายการ");
      }catch(e){error(e);}finally{busy(false);}
    };
    syncAreas();
  }

  async function removeAssignmentDutyDay(assignmentId, day) {
    const row = S.master.Assignments.find((x) => x.AssignmentID === assignmentId);
    if (!row) return;
    const n = Number(day),
      days = dutyDaysArray(row.Days),
      remaining = days.filter((x) => x !== n),
      userName = S.master.Users.find((u) => u.UserID === row.UserID)?.FullName || "—",
      areaName = S.master.Areas.find((a) => a.AreaID === row.AreaID)?.AreaName || "—",
      dayName = dutyDayOptions.find((d) => d[0] === n)?.[1] || String(n);
    const confirm = await Swal.fire({
      icon: "question",
      title: "นำออกจากเวรวัน" + dayName + "?",
      html:
        "<b>" +
        esc(userName) +
        "</b><br>" +
        esc(areaName) +
        (remaining.length
          ? '<br><span class="muted">เวรวันอื่นของรายการนี้จะยังคงเดิม</span>'
          : '<br><span class="muted">รายการเวรนี้ไม่มีวันอื่นแล้ว จึงจะย้ายไปถังขยะ</span>'),
      showCancelButton: true,
      confirmButtonText: "นำออกจากวันนี้",
      cancelButtonText: "ยกเลิก",
    });
    if (!confirm.isConfirmed) return;
    busy(true, "กำลังปรับเวร…");
    try {
      if (remaining.length)
        await rpc("setAssignmentDays", { id: row.AssignmentID, days: remaining.map(String) });
      else
        await rpc("deleteMaster", { table: "Assignments", id: row.AssignmentID });
      S.master = await rpc("master", {}, true);
      toast("ปรับเวรเรียบร้อย");
      assignmentContent();
    } catch (e) {
      error(e);
    } finally {
      busy(false);
    }
  }
  function editDutyDays(row) {
    if (!row) return;
    const m = S.master, days = dutyDaysArray(row.Days),
      userName = m.Users.find((u) => u.UserID === row.UserID)?.FullName || "—",
      areaName = m.Areas.find((a) => a.AreaID === row.AreaID)?.AreaName || "—";
    const checks = dutyDayOptions.map(([n, full]) =>
      '<label class="duty-check"><input type="checkbox" name="day" value="' + n + '" ' + (days.includes(n) ? 'checked' : '') + '> ' + full + '</label>',
    ).join("");
    openModal(
      "แก้วันเข้าเวร",
      '<form id="duty-days-form"><p><b>' + esc(userName) + '</b> · ' + esc(areaName) + '</p>' +
      '<div class="field"><label>วันเข้าเวร</label><div class="duty-days">' + checks + '</div></div>' +
      '<button class="btn w-full">บันทึกวันเข้าเวร</button></form>',
    );
    $("duty-days-form").onsubmit = async (e) => {
      e.preventDefault();
      const days = new FormData(e.target).getAll("day");
      if (!days.length) return error(new Error("เลือกวันเข้าเวรอย่างน้อย 1 วัน"));
      try {
        await rpc("setAssignmentDays", { id: row.AssignmentID, days });
        closeModal(); toast("แก้วันเข้าเวรแล้ว"); await route();
      } catch (e) { error(e); }
    };
  }
  async function holidayModal() {
    try {
      const b = await rpc("bootstrap");
      openModal(
        "วันหยุดโรงเรียน",
        '<form id="holiday-form"><p class="muted">ไม่สร้างงานใหม่ในเสาร์–อาทิตย์ และวันหยุดที่กำหนด ควรกำหนดล่วงหน้า งานที่สร้างแล้วจะไม่ถูกลบ</p><div class="field"><label>วันที่ YYYY-MM-DD หนึ่งวันต่อบรรทัด</label><textarea name="dates" rows="10">' +
          esc(b.holidays.join("\n")) +
          '</textarea></div><button class="btn">บันทึกวันหยุด</button></form>',
      );
      $("holiday-form").onsubmit = async (e) => {
        e.preventDefault();
        try {
          const dates = e.target.elements.dates.value.split(/\s+/).filter(Boolean);
          await rpc("holidays", { dates });
          closeModal();
          toast("บันทึกแล้ว");
        } catch (e) {
          error(e);
        }
      };
    } catch (e) {
      error(e);
    }
  }
  function dailyThaiDate(date){
    try{
      return new Date(date+"T12:00:00+07:00").toLocaleDateString("th-TH",{
        weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:"Asia/Bangkok"
      });
    }catch(e){return date;}
  }
  function dailySorted(items){
    return [...items].sort((a,b)=>
      String(a.ClassName||"").localeCompare(String(b.ClassName||""),"th") ||
      String(a.AreaName||"").localeCompare(String(b.AreaName||""),"th")
    );
  }
  function dailyGroups(d){
    const done=(d.items||[]).filter(x=>x.Status==="ตรวจแล้ว");
    return{
      excellent:dailySorted(done.filter(x=>Number(x.Score)===3)),
      medium:dailySorted(done.filter(x=>Number(x.Score)===2)),
      improve:dailySorted(done.filter(x=>Number(x.Score)===1)),
      skipped:dailySorted((d.items||[]).filter(x=>x.Status==="งดตรวจ")),
      pending:dailySorted((d.items||[]).filter(x=>x.Status==="รอตรวจ"))
    };
  }
  function dailyItemText(x,withNote=true){
    let line=String(x.ClassName||"—")+" — "+String(x.AreaName||"—");
    if(x.Status==="งดตรวจ"&&x.SkipReason)line+=" | เหตุผล: "+String(x.SkipReason);
    if(withNote&&String(x.Notes||"").trim()){
      const note=String(x.Notes).trim().replace(/\s+/g," ");
      line+=" | หมายเหตุ: "+(note.length>180?note.slice(0,177)+"…":note);
    }
    return line;
  }
  function dailyReportText(d){
    const g=dailyGroups(d),date=dailyThaiDate(d.date),cfg=d.settings||{};
    const lines=[
      "📢 รายงานผลการตรวจเขตพื้นที่ประจำวัน",
      "🏫 "+(cfg.schoolName||"โรงเรียนรัษฎา"),
      "📅 "+date,
      ""
    ];
    if(d.isHoliday){
      lines.push("🏖️ "+(d.holidayReason||"วันหยุด / ไม่มีการตรวจ"));
      lines.push("วันนี้ไม่นับเป็นวันขาดข้อมูล");
      return lines.join("\n");
    }
    lines.push("สรุป: ตรวจแล้ว "+d.done+"/"+d.scheduled+" พื้นที่");
    const labels=cfg.scoreLabels||{"1":"ปรับปรุง","2":"ปานกลาง","3":"ยอดเยี่ยม"};
    lines.push("🌟 "+labels["3"]+" "+d.counts.excellent+" | 🙂 "+labels["2"]+" "+d.counts.medium+" | 🔧 "+labels["1"]+" "+d.counts.improve+(d.skipped?" | 📴 งดตรวจ "+d.skipped:"")+(d.pending?" | ⏳ รอตรวจ "+d.pending:"")+(d.approvalPending?" | 🛡️ รอรับรอง "+d.approvalPending:""));
    const sections=[
      ["🌟 "+labels["3"],g.excellent],
      ["🙂 "+labels["2"],g.medium],
      ["🔧 "+labels["1"],g.improve],
      ["📴 งดตรวจ",g.skipped],
      ["⏳ รอตรวจ",g.pending]
    ];
    sections.forEach(([title,rows])=>{
      if(!rows.length)return;
      lines.push("",title+" ("+rows.length+")");
      rows.forEach(x=>lines.push("• "+dailyItemText(x,true)));
    });
    lines.push("",cfg.reportFooter||("RSD Clean · "+(cfg.schoolName||"โรงเรียนรัษฎา")));
    return lines.join("\n");
  }
  async function copyDailyReport(){
    if(!dailyReportData)return;
    const text=dailyReportText(dailyReportData);
    try{
      await navigator.clipboard.writeText(text);
    }catch(e){
      const ta=document.createElement("textarea");
      ta.value=text;ta.style.position="fixed";ta.style.opacity="0";
      document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();
    }
    toast("คัดลอกข้อความรายงานแล้ว");
  }
  function blobImage(blob){
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(blob),img=new Image();
      img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
      img.onerror=()=>{URL.revokeObjectURL(url);reject(Error("โหลดรูปไม่สำเร็จ"));};
      img.src=url;
    });
  }
  async function loadDailyLogo(preferred=""){
    const urls=[preferred,"/school-logo","https://www.ratsada.ac.th/learn/up/uploads/NOOK/LOGO.png","/icon-512.png"].filter(Boolean);
    for(const url of urls){
      try{
        const res=await fetch(url,{mode:"cors",cache:"force-cache"});
        if(!res.ok)continue;
        return await blobImage(await res.blob());
      }catch(e){}
    }
    return null;
  }
  function canvasRoundRect(ctx,x,y,w,h,r,fill){
    const rr=Math.min(r,w/2,h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);
    ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();
    if(fill){ctx.fillStyle=fill;ctx.fill();}
  }
  function canvasWrap(ctx,text,maxWidth){
    const words=String(text||"").split(/\s+/),lines=[];let line="";
    for(const word of words){
      const test=line?line+" "+word:word;
      if(ctx.measureText(test).width>maxWidth&&line){lines.push(line);line=word;}
      else line=test;
    }
    if(line)lines.push(line);
    return lines.length?lines:[""];
  }
  async function dailyReportCanvasBlob(d){
    await document.fonts?.ready?.catch?.(()=>{});
    const g=dailyGroups(d),cfg=d.settings||{};
    const itemCount=(d.items||[]).length;
    const noteCount=(d.items||[]).filter(x=>String(x.Notes||"").trim()).length;
    const height=Math.max(1350,Math.min(7000,880+itemCount*76+noteCount*34+(d.isHoliday?0:260)));
    const canvas=document.createElement("canvas");
    canvas.width=1080;canvas.height=height;
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="#eef8f7";ctx.fillRect(0,0,canvas.width,canvas.height);
    canvasRoundRect(ctx,42,42,996,height-84,34,"#ffffff");

    const grad=ctx.createLinearGradient(42,42,1038,330);
    grad.addColorStop(0,"#0f766e");grad.addColorStop(1,"#0891b2");
    canvasRoundRect(ctx,42,42,996,300,34,grad);

    const logo=await loadDailyLogo(cfg.schoolLogoUrl||"");
    if(logo){
      ctx.fillStyle="#ffffff";ctx.beginPath();ctx.arc(150,152,72,0,Math.PI*2);ctx.fill();
      ctx.drawImage(logo,92,94,116,116);
    }
    ctx.fillStyle="#ffffff";
    ctx.font='700 46px "Kanit",sans-serif';
    ctx.fillText("รายงานผลการตรวจเขตพื้นที่ประจำวัน",250,125);
    ctx.font='500 31px "Kanit",sans-serif';ctx.fillText(String(cfg.schoolName||"โรงเรียนรัษฎา"),250,178);
    ctx.font='400 25px "Kanit",sans-serif';ctx.fillStyle="rgba(255,255,255,.9)";
    ctx.fillText(dailyThaiDate(d.date),250,225);
    ctx.font='400 20px "Kanit",sans-serif';
    ctx.fillText("RSD Clean · School Cleanliness Inspection System",250,267);

    let y=390;
    if(d.isHoliday){
      canvasRoundRect(ctx,86,y,908,180,24,"#f0fdfa");
      ctx.fillStyle="#0f766e";ctx.font='700 40px "Kanit",sans-serif';ctx.textAlign="center";
      ctx.fillText("วันหยุด / ไม่มีการตรวจ",540,y+70);
      ctx.font='400 26px "Kanit",sans-serif';ctx.fillStyle="#56737a";
      ctx.fillText(d.holidayReason||"วันนี้ไม่นับเป็นวันขาดข้อมูล",540,y+120);
      ctx.textAlign="left";y+=230;
    }else{
      const labels=cfg.scoreLabels||{"1":"ปรับปรุง","2":"ปานกลาง","3":"ยอดเยี่ยม"};
      const stats=[
        ["ตรวจแล้ว",d.done+"/"+d.scheduled,"#e8f7f3","#0f766e"],
        [labels["3"],d.counts.excellent,"#ecfdf5","#15803d"],
        [labels["2"],d.counts.medium,"#fff8e7","#a16207"],
        [labels["1"],d.counts.improve,"#fff1f2","#be123c"]
      ];
      stats.forEach((x,i)=>{
        const sx=86+i*226;
        canvasRoundRect(ctx,sx,y,204,128,20,x[2]);
        ctx.fillStyle=x[3];ctx.font='600 22px "Kanit",sans-serif';ctx.fillText(x[0],sx+18,y+38);
        ctx.font='700 38px "Kanit",sans-serif';ctx.fillText(String(x[1]),sx+18,y+91);
      });
      y+=178;
      if(d.approvalPending){
        canvasRoundRect(ctx,86,y,908,62,16,"#eef2ff");
        ctx.fillStyle="#4338ca";ctx.font='500 22px "Kanit",sans-serif';
        ctx.fillText("🛡 รอรับรอง "+d.approvalPending+" รายการ",110,y+40);y+=78;
      }
      if(d.skipped){
        canvasRoundRect(ctx,86,y,908,62,16,"#f1f5f9");
        ctx.fillStyle="#64748b";ctx.font='500 22px "Kanit",sans-serif';
        ctx.fillText("📴 งดตรวจ "+d.skipped+" พื้นที่ (มีเหตุผลบันทึกไว้)",110,y+40);y+=78;
      }
      if(d.pending){
        canvasRoundRect(ctx,86,y,908,62,16,"#fff9e9");
        ctx.fillStyle="#8a671b";ctx.font='500 22px "Kanit",sans-serif';
        ctx.fillText("⏳ รอตรวจ "+d.pending+" พื้นที่",110,y+40);y+=90;
      }
      const sections=[
        [labels["3"],g.excellent,"#15803d","#ecfdf5"],
        [labels["2"],g.medium,"#a16207","#fff8e7"],
        [labels["1"],g.improve,"#be123c","#fff1f2"],
        ["งดตรวจ",g.skipped,"#64748b","#f1f5f9"],
        ["รอตรวจ",g.pending,"#64748b","#f1f5f9"]
      ];
      for(const [title,rows,color,bg] of sections){
        if(!rows.length)continue;
        canvasRoundRect(ctx,86,y,908,56,15,bg);
        ctx.fillStyle=color;ctx.font='700 25px "Kanit",sans-serif';
        ctx.fillText(title+" ("+rows.length+")",108,y+37);y+=78;
        for(const item of rows){
          ctx.fillStyle="#17334b";ctx.font='600 22px "Kanit",sans-serif';
          const main=canvasWrap(ctx,dailyItemText(item,false),840);
          for(const line of main){ctx.fillText("• "+line,112,y);y+=31;}
          if(item.Status==="งดตรวจ"&&String(item.SkipReason||"").trim()){
            ctx.fillStyle="#64748b";ctx.font='400 19px "Kanit",sans-serif';
            const why=canvasWrap(ctx,"เหตุผล: "+String(item.SkipReason).trim(),805);
            for(const line of why){ctx.fillText(line,145,y);y+=27;}
          }
          if(String(item.Notes||"").trim()){
            ctx.fillStyle="#718596";ctx.font='400 19px "Kanit",sans-serif';
            const note=canvasWrap(ctx,"หมายเหตุ: "+String(item.Notes).trim().replace(/\s+/g," "),805);
            for(const line of note){ctx.fillText(line,145,y);y+=27;}
          }
          y+=15;
        }
        y+=16;
      }
    }
    ctx.strokeStyle="#dcebed";ctx.beginPath();ctx.moveTo(86,y);ctx.lineTo(994,y);ctx.stroke();y+=42;
    ctx.fillStyle="#718596";ctx.font='400 19px "Kanit",sans-serif';
    ctx.fillText(String(cfg.reportFooter||"ข้อมูลจากระบบ RSD Clean")+" · อัปเดต "+new Date(d.updatedAt).toLocaleTimeString("th-TH",{timeZone:"Asia/Bangkok"})+" น.",86,y);
    y+=50;

    const finalHeight=Math.min(height,Math.max(650,y+70));
    if(finalHeight===height){
      return await new Promise(resolve=>canvas.toBlob(resolve,"image/png",0.95));
    }
    const cropped=document.createElement("canvas");cropped.width=1080;cropped.height=finalHeight;
    cropped.getContext("2d").drawImage(canvas,0,0,1080,finalHeight,0,0,1080,finalHeight);
    return await new Promise(resolve=>cropped.toBlob(resolve,"image/png",0.95));
  }
  async function downloadDailyReportImage(){
    if(!dailyReportData)return;
    busy(true,"กำลังสร้างภาพรายงาน…");
    try{
      const blob=await dailyReportCanvasBlob(dailyReportData);
      if(!blob)throw Error("สร้างภาพไม่สำเร็จ");
      const a=document.createElement("a");
      a.href=URL.createObjectURL(blob);
      a.download="RSD-Clean-Daily-"+dailyReportData.date+".png";
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href),2000);
      toast("ดาวน์โหลดภาพรายงานแล้ว");
    }catch(e){error(e);}
    finally{busy(false);}
  }
  async function shareDailyReport(){
    if(!dailyReportData)return;
    const text=dailyReportText(dailyReportData);
    busy(true,"กำลังเตรียมรายงานสำหรับแชร์…");
    try{
      const blob=await dailyReportCanvasBlob(dailyReportData);
      const file=blob?new File([blob],"RSD-Clean-Daily-"+dailyReportData.date+".png",{type:"image/png"}):null;
      busy(false);
      if(file&&navigator.share&&navigator.canShare?.({files:[file]})){
        await navigator.share({title:"รายงานผลรายวัน RSD Clean",text,files:[file]});
        return;
      }
      if(navigator.share){
        await navigator.share({title:"รายงานผลรายวัน RSD Clean",text});
        return;
      }
      await copyDailyReport();
    }catch(e){
      busy(false);
      if(e?.name!=="AbortError")error(e);
    }
  }
  function dailyResultRows(rows,labelClass){
    if(!rows.length)return '<div class="daily-empty">ไม่มีรายการ</div>';
    return '<div class="daily-result-list">'+rows.map(x=>
      '<div class="daily-result-row">'+
        '<div><b>'+esc(x.ClassName)+'</b><span>'+esc(x.AreaName)+'</span>'+
        (x.SkipReason?'<small>เหตุผล: '+esc(x.SkipReason)+'</small>':'')+
        (x.Notes?'<small>หมายเหตุ: '+esc(x.Notes)+'</small>':'')+'</div>'+
        '<span class="daily-dot '+labelClass+'"></span>'+
      '</div>'
    ).join("")+'</div>';
  }
  function drawDailyReport(){
    const d=dailyReportData,g=dailyGroups(d),date=dailyThaiDate(d.date),cfg=d.settings||{};
    const content=$("daily-report-content");
    if(!content)return;
    content.innerHTML=
      '<section class="daily-share-card" id="daily-share-card">'+
        '<header class="daily-share-head">'+
          '<div class="daily-logo-box"><img src="'+esc(cfg.schoolLogoUrl||"/school-logo")+'" alt="ตราโรงเรียน" onerror="this.onerror=null;this.src=\'/school-logo\'"></div>'+
          '<div><span>RSD CLEAN · '+esc(cfg.schoolName||"โรงเรียนรัษฎา")+'</span><h2>รายงานผลการตรวจเขตพื้นที่ประจำวัน</h2><p>'+esc(date)+'</p></div>'+
        '</header>'+
        (d.isHoliday
          ? '<div class="daily-holiday"><i data-lucide="calendar-off"></i><h3>วันหยุด / ไม่มีการตรวจ</h3><p>'+esc(d.holidayReason||"วันนี้ไม่นับเป็นวันขาดข้อมูล")+'</p></div>'
          : '<div class="daily-stat-grid">'+
              '<div><span>ตรวจแล้ว</span><b>'+d.done+'/'+d.scheduled+'</b></div>'+
              '<div class="excellent"><span>ยอดเยี่ยม</span><b>'+d.counts.excellent+'</b></div>'+
              '<div class="medium"><span>ปานกลาง</span><b>'+d.counts.medium+'</b></div>'+
              '<div class="improve"><span>ปรับปรุง</span><b>'+d.counts.improve+'</b></div>'+
            '</div>'+
            (d.approvalPending?'<div class="daily-pending" style="background:#eef2ff;color:#4338ca;border-color:#c7d2fe"><i data-lucide="badge-check"></i> รอรับรอง '+d.approvalPending+' รายการ</div>':'')+
            (d.skipped?'<div class="daily-pending" style="background:#f1f5f9;color:#64748b;border-color:#e2e8f0"><i data-lucide="circle-off"></i> งดตรวจ '+d.skipped+' พื้นที่ · มีเหตุผลบันทึกไว้</div>':'')+
            (d.pending?'<div class="daily-pending"><i data-lucide="clock-3"></i> ยังรอตรวจ '+d.pending+' พื้นที่</div>':'')+
            '<div class="daily-section excellent"><h3><span></span>'+esc(cfg.scoreLabels?.["3"]||"ยอดเยี่ยม")+' <b>'+g.excellent.length+'</b></h3>'+dailyResultRows(g.excellent,"excellent")+'</div>'+
            '<div class="daily-section medium"><h3><span></span>'+esc(cfg.scoreLabels?.["2"]||"ปานกลาง")+' <b>'+g.medium.length+'</b></h3>'+dailyResultRows(g.medium,"medium")+'</div>'+
            '<div class="daily-section improve"><h3><span></span>'+esc(cfg.scoreLabels?.["1"]||"ปรับปรุง")+' <b>'+g.improve.length+'</b></h3>'+dailyResultRows(g.improve,"improve")+'</div>'+
            (g.skipped.length?'<div class="daily-section pending"><h3><span></span>งดตรวจ <b>'+g.skipped.length+'</b></h3>'+dailyResultRows(g.skipped,"pending")+'</div>':'')+
            (g.pending.length?'<div class="daily-section pending"><h3><span></span>รอตรวจ <b>'+g.pending.length+'</b></h3>'+dailyResultRows(g.pending,"pending")+'</div>':'')
        )+
        '<footer class="daily-share-footer">'+esc(cfg.reportFooter||"ข้อมูลจากระบบ RSD Clean")+' · อัปเดต '+esc(new Date(d.updatedAt).toLocaleTimeString("th-TH",{timeZone:"Asia/Bangkok"}))+' น.</footer>'+
      '</section>';
    $("daily-actions").classList.remove("hidden");
    icons();
  }
  async function loadDailyReport(seq=S.seq){
    const date=$("daily-date")?.value;
    if(!date)return;
    const d=await rpc("dailyReport",{date});
    if(seq!==S.seq||$("daily-date")?.value!==date)return;
    dailyReportData=d;
    drawDailyReport();
  }
  async function renderDailyReport(seq){
    const today=thaiDay();
    $("app").innerHTML=
      heading(
        "รายงานผลรายวัน 📣",
        "จัดรูปแบบสำหรับส่งในกลุ่มหัวหน้าห้อง สามารถแชร์ คัดลอกข้อความ หรือดาวน์โหลดเป็นภาพได้",
        ["Admin","Supervisor"].includes(S.user?.Role)
          ? '<a class="btn secondary" href="#reports"><i data-lucide="chart-no-axes-column-increasing"></i> รายงานหลัก</a>'
          : '<a class="btn secondary" href="#tasks"><i data-lucide="clipboard-check"></i> งานตรวจวันนี้</a>'
      )+
      '<form id="daily-filter" class="card daily-filter mb-4"><div class="field m-0"><label>วันที่รายงาน</label><input id="daily-date" type="date" value="'+today+'" max="'+today+'" required></div><button class="btn" type="submit"><i data-lucide="refresh-cw"></i> แสดงผล</button></form>'+
      '<div id="daily-actions" class="daily-actions hidden mb-4">'+
        '<button class="btn" id="daily-share"><i data-lucide="share-2"></i> แชร์</button>'+
        '<button class="btn secondary" id="daily-copy"><i data-lucide="copy"></i> คัดลอกข้อความ</button>'+
        '<button class="btn secondary" id="daily-image"><i data-lucide="image-down"></i> ดาวน์โหลดภาพ</button>'+
        (S.user?.Role==="Admin"?'<button class="btn secondary" id="daily-admin-edit"><i data-lucide="pencil"></i> แก้ไขผลย้อนหลัง</button>':'')+
        (["Admin","Supervisor"].includes(S.user?.Role)?'<button class="btn secondary" id="daily-exception"><i data-lucide="circle-off"></i> จัดการงดตรวจ</button>':'')+
      '</div>'+
      '<div id="daily-report-content"><div class="card empty">กำลังโหลดรายงาน…</div></div>';
    $("daily-filter").onsubmit=e=>{e.preventDefault();loadDailyReport().catch(error);};
    $("daily-date").onchange=()=>loadDailyReport().catch(error);
    $("daily-share").onclick=shareDailyReport;
    $("daily-copy").onclick=copyDailyReport;
    $("daily-image").onclick=downloadDailyReportImage;
    if($("daily-admin-edit"))$("daily-admin-edit").onclick=()=>adminHistoricalDayEditModal($("daily-date").value);
    if($("daily-exception"))$("daily-exception").onclick=()=>inspectionExceptionModal($("daily-date").value);
    icons();
    await loadDailyReport(seq);
  }

  function execPct(v){return Number(v||0).toLocaleString("th-TH",{maximumFractionDigits:1})+"%";}
  function execScore(v){return Number(v||0).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2});}
  function execWeekLabel(date){
    try{return new Date(date+"T12:00:00+07:00").toLocaleDateString("th-TH",{day:"numeric",month:"short",timeZone:"Asia/Bangkok"});}
    catch(e){return date;}
  }
  function execMonthLabel(month){
    try{return new Date(month+"-01T12:00:00+07:00").toLocaleDateString("th-TH",{month:"short",year:"2-digit",timeZone:"Asia/Bangkok"});}
    catch(e){return month;}
  }
  function execDelta(current,previous,digits=1,suffix=""){
    const a=Number(current||0),b=Number(previous||0),d=a-b;
    if(!Number.isFinite(d)||Math.abs(d)<0.005)return '<span class="exec-delta neutral">คงที่</span>';
    const sign=d>0?"+":"";
    const cls=d>0?"up":"down";
    return '<span class="exec-delta '+cls+'">'+sign+d.toLocaleString("th-TH",{maximumFractionDigits:digits})+suffix+'</span>';
  }
  function execSummaryText(d){
    const t=d.todayStats||{},l=d.last30||{},ref=d.referenceDate===d.today?"วันนี้":"วันที่อ้างอิง",labels=d.settings?.scoreLabels||S.config?.scoreLabels||{"1":"ปรับปรุง","2":"ปานกลาง","3":"ยอดเยี่ยม"};
    if(!t.scheduled)return ref+"ไม่มีงานตรวจตามตาราง หรือเป็นวันหยุด";
    const parts=[
      ref+"ตรวจแล้ว "+t.done+"/"+t.scheduled+" พื้นที่ ("+execPct(t.completionRate)+")",
      labels["3"]+" "+t.excellent+" · "+labels["2"]+" "+t.medium+" · "+labels["1"]+" "+t.improve
    ];
    if(t.pending)parts.push("ยังเหลือ "+t.pending+" พื้นที่รอตรวจ");
    if(l.done)parts.push("30 วันล่าสุดคะแนนเฉลี่ย "+execScore(l.averageScore)+" จาก 3");
    return parts.join(" · ");
  }
  function execWatchRows(rows){
    return rows.length
      ? rows.map(x=>[
          '<b>'+esc(x.name||"—")+'</b>',
          esc(x.className||"—"),
          String(x.improve||0),
          execScore(x.avg)
        ])
      : [['<span class="muted">ยังไม่พบรายการที่ต้องติดตาม</span>','—','0','—']];
  }

  function execMapStatus(item){
    if(!item)return{key:"no_assignment",label:"ไม่มีเวร",color:"#94a3b8"};
    if(item.StatusKey)return{key:item.StatusKey,label:item.StatusLabel||item.StatusKey,color:item.StatusColor||"#94a3b8"};
    if(item.Status==="งดตรวจ")return{key:"skipped",label:"งดตรวจ",color:"#64748b"};
    if(item.Status==="รอตรวจ")return{key:"pending",label:"รอตรวจ",color:"#facc15"};
    if(item.Status==="ตรวจแล้ว"){
      if(Number(item.Score)===3)return{key:"excellent",label:S.config?.scoreLabels?.["3"]||"ยอดเยี่ยม",color:"#22c55e"};
      if(Number(item.Score)===2)return{key:"medium",label:S.config?.scoreLabels?.["2"]||"ปานกลาง",color:"#f59e0b"};
      if(Number(item.Score)===1)return{key:"improve",label:S.config?.scoreLabels?.["1"]||"ปรับปรุง",color:"#ef4444"};
      return{key:"done",label:item.Rating||"ตรวจแล้ว",color:"#14b8a6"};
    }
    return{key:"no_assignment",label:"ไม่มีเวร",color:"#94a3b8"};
  }
  function execMapCenter(s){
    if(s.ShapeType==="polygon"&&Array.isArray(s.Points)&&s.Points.length){
      const sum=s.Points.reduce((a,p)=>({x:a.x+Number(p.x||0),y:a.y+Number(p.y||0)}),{x:0,y:0});
      return{x:sum.x/s.Points.length,y:sum.y/s.Points.length};
    }
    return{x:Number(s.X||0)+Number(s.Width||0)/2,y:Number(s.Y||0)+Number(s.Height||0)/2};
  }
  function execMapHtml(pack,date){
    const shapes=pack?.layout?.shapes||[],items=pack?.daily?.items||[];
    if(!shapes.length)return '<section class="card exec-map-card mb-5"><div class="exec-section-title"><div><span class="muted">ภาพรวมเชิงพื้นที่</span><h2>ผังสถานะพื้นที่</h2></div></div><div class="exec-map-empty">ยังไม่มีผังพื้นที่ในระบบ</div></section>';
    const byArea=new Map(items.map(x=>[String(x.AreaID),x])),counts={holiday:0,no_assignment:0,no_inspector:0,pending:0,excellent:0,medium:0,improve:0,skipped:0,done:0};
    items.filter(x=>x.InScope!==false).forEach(x=>{const st=execMapStatus(x);counts[st.key]=(counts[st.key]||0)+1;});
    let ref="";try{ref=localStorage.getItem("rsd-area-map-reference-v1")||"";}catch(e){}
    let opacity=.55;try{opacity=Math.max(.1,Math.min(.8,Number(localStorage.getItem("rsd-area-map-reference-opacity-v1")||55)/100));}catch(e){}
    const reference=ref?'<image href="'+ref+'" x="0" y="0" width="1600" height="1000" opacity="'+opacity+'" pointer-events="none"/>':"";
    const body=shapes.map(s=>{
      const item=byArea.get(String(s.AreaID)),status=execMapStatus(item),center=execMapCenter(s),
        geo=s.ShapeType==="polygon"
          ? '<polygon points="'+(s.Points||[]).map(p=>Number(p.x)+","+Number(p.y)).join(" ")+'" fill="'+status.color+'"/>'
          : '<rect x="'+Number(s.X||0)+'" y="'+Number(s.Y||0)+'" width="'+Number(s.Width||0)+'" height="'+Number(s.Height||0)+'" rx="10" fill="'+status.color+'"/>';
      return '<g class="exec-map-shape '+(executiveMapSelected===String(s.AreaID)?"selected":"")+'" data-area="'+esc(s.AreaID)+'">'+geo+
        '<text x="'+center.x+'" y="'+(center.y-5)+'" text-anchor="middle"><tspan x="'+center.x+'">'+esc(s.AreaName||item?.AreaName||"พื้นที่")+'</tspan><tspan class="sub" x="'+center.x+'" dy="18">'+esc(s.ClassName||item?.ClassName||"")+'</tspan></text></g>';
    }).join("");
    const legend=[
      ["#cbd5e1","วันหยุด",counts.holiday],["#94a3b8","ไม่มีเวร",counts.no_assignment],["#a78bfa","ไม่มีผู้ตรวจ",counts.no_inspector],
      ["#facc15","รอตรวจ",counts.pending],["#22c55e",S.config?.scoreLabels?.["3"]||"ยอดเยี่ยม",counts.excellent],
      ["#f59e0b",S.config?.scoreLabels?.["2"]||"ปานกลาง",counts.medium],["#ef4444",S.config?.scoreLabels?.["1"]||"ปรับปรุง",counts.improve],
      ["#64748b","งดตรวจ",counts.skipped]
    ].filter(x=>x[2]>0).map(x=>'<span><i style="background:'+x[0]+'"></i>'+esc(x[1])+' <b>'+Number(x[2]||0)+'</b></span>').join("");
    return '<section class="card exec-map-card mb-5"><div class="exec-section-title"><div><span class="muted">วันที่อ้างอิง '+esc(date||"")+'</span><h2>ผังสถานะพื้นที่</h2></div><a class="btn small secondary" href="#control" id="exec-open-control-map"><i data-lucide="maximize-2"></i> เปิดผังเต็ม</a></div>'+
      '<div class="exec-map-legend">'+legend+'</div>'+
      '<div class="exec-map-layout"><div class="exec-map-scroll"><svg viewBox="0 0 1600 1000" aria-label="ผังสถานะสำหรับผู้บริหาร"><rect width="1600" height="1000" fill="#fff"/>'+reference+body+'</svg></div><aside id="exec-map-detail" class="exec-map-detail"></aside></div></section>';
  }
  function execMapDetail(){
    const box=$("exec-map-detail");if(!box)return;
    const areaId=String(executiveMapSelected||""),shape=(executiveMapPack?.layout?.shapes||[]).find(s=>String(s.AreaID)===areaId),
      item=(executiveMapPack?.daily?.items||[]).find(x=>String(x.AreaID)===areaId);
    if(!shape){
      box.innerHTML='<div class="exec-map-detail-empty"><i data-lucide="mouse-pointer-2"></i><b>เลือกพื้นที่บนผัง</b><span>คลิกเพื่อดูผลตรวจ ผู้ตรวจ และสถานะรับรอง</span></div>';icons();return;
    }
    const status=execMapStatus(item),inspectors=(item?.Inspectors||[]).map(v=>v.Name).filter(Boolean).join(", ")||"—";
    box.innerHTML='<div class="exec-map-detail-head"><span style="background:'+status.color+'"></span><div><b>'+esc(shape.AreaName||item?.AreaName||"พื้นที่")+'</b><small>'+esc(shape.ClassName||item?.ClassName||"—")+'</small></div></div>'+
      '<div class="exec-map-detail-status"><b>'+esc(status.label)+'</b><span>'+esc(executiveMapPack?.daily?.date||"")+'</span></div>'+
      (item?.InspectionID?'<div class="exec-map-detail-grid"><div><span>ผู้ตรวจ</span><b>'+esc(inspectors)+'</b></div><div><span>คะแนน</span><b>'+(item.Status==="ตรวจแล้ว"?esc(String(item.Score||"—"))+" · "+esc(item.Rating||status.label):"—")+'</b></div><div><span>การรับรอง</span><b>'+esc(item.ApprovalStatus||"—")+'</b></div>'+(item.Notes?'<div class="wide"><span>หมายเหตุ</span><b>'+esc(item.Notes)+'</b></div>':"")+'</div>':'<div class="exec-map-no-duty">ไม่มีงานตรวจในวันที่อ้างอิง</div>');
    icons();
  }
  function wireExecMap(date){
    document.querySelectorAll(".exec-map-shape").forEach(el=>el.onclick=()=>{executiveMapSelected=String(el.dataset.area||"");const card=el.closest(".exec-map-card");card?.querySelectorAll(".exec-map-shape").forEach(x=>x.classList.toggle("selected",x===el));execMapDetail();});
    if($("exec-open-control-map"))$("exec-open-control-map").onclick=()=>{
      try{sessionStorage.setItem("rsd-control-open-date",String(date||thaiDay()));}catch(e){}
      try{opControlView="map";opControlMapSelected=executiveMapSelected||"";}catch(e){}
    };
    execMapDetail();
  }

  async function renderExecutiveDashboard(seq){
    $("app").innerHTML=
      heading(
        "Dashboard ผู้บริหาร",
        "สรุปสถานะวันนี้และแนวโน้มโรงเรียนแบบกระชับ",
        '<div class="flex flex-wrap gap-2"><a class="btn secondary" href="#control"><i data-lucide="panel-top"></i> ศูนย์งานวันนี้</a><a class="btn secondary" href="#certificates"><i data-lucide="award"></i> เกียรติบัตร</a><a class="btn secondary" href="#review"><i data-lucide="badge-check"></i> รับรองผล</a><a class="btn secondary" href="#history"><i data-lucide="history"></i> ประวัติ</a><a class="btn secondary" href="#exports"><i data-lucide="file-down"></i> ส่งออก</a><a class="btn secondary" href="#daily"><i data-lucide="send"></i> รายงานรายวัน</a><a class="btn secondary" href="#reports"><i data-lucide="chart-no-axes-column-increasing"></i> รายงานละเอียด</a><button class="btn" id="exec-refresh" type="button"><i data-lucide="refresh-cw"></i> รีเฟรช</button></div>'
      )+
      '<div id="executive-content"><div class="card empty">กำลังสรุปข้อมูลสำหรับผู้บริหาร…</div></div>';
    $("exec-refresh").onclick=()=>loadExecutiveDashboard(S.seq).catch(error);
    icons();
    await loadExecutiveDashboard(seq);
  }
  async function loadExecutiveDashboard(seq=S.seq){
    const d=await rpc("executiveDashboard",{periodId:executivePeriodId},true);
    if(seq!==S.seq)return;
    const refDate=d.referenceDate||d.today||thaiDay();
    const mapData=await rpc("mapStatus",{date:refDate},true).catch(()=>({date:refDate,shapes:[],items:[],summary:{}}));
    if(window.rsdEnsureMapReference)await window.rsdEnsureMapReference(mapData);
    if(seq!==S.seq)return;
    executiveMapPack={layout:mapData,daily:mapData};
    executiveMapSelected="";
    if(d.settings){S.config=d.settings;try{localStorage.setItem("rsd-config-cache",JSON.stringify(d.settings));}catch(e){}}
    const t=d.todayStats||{},w=d.currentWeek||{},pw=d.previousWeek||{},m=d.currentMonth||{},pm=d.previousMonth||{},l=d.last30||{},labels=d.settings?.scoreLabels||S.config?.scoreLabels||{"1":"ปรับปรุง","2":"ปานกลาง","3":"ยอดเยี่ยม"};
    const watch=d.watchAreas||[],leaders=d.leaders||[],isTodayRef=d.referenceDate===d.today,refLabel=isTodayRef?"วันนี้":"วันที่อ้างอิง";
    const statusClass=!t.scheduled?"neutral":t.pending?"warning":"good";
    const statusText=!t.scheduled?"ไม่มีงานวันนี้":t.pending?"ยังมีงานรอตรวจ":"ตรวจครบแล้ว";
    $("executive-content").innerHTML=
      '<section class="card exec-period-selector mb-4"><div><span class="muted">บริบทข้อมูล</span><b>'+(d.period?esc(d.period.Label):'ไม่ได้กำหนดภาคเรียน')+'</b></div><select id="exec-period-select" class="control"><option value="">Active / ปัจจุบัน</option>'+(d.periods||[]).map(x=>'<option value="'+esc(x.PeriodID)+'" '+(d.period?.PeriodID===x.PeriodID?'selected':'')+'>'+esc(x.Label)+(x.IsActive?' · Active':'')+'</option>').join("")+'</select></section>'+
      '<section class="exec-hero '+statusClass+'">'+
        '<div><span class="exec-eyebrow">EXECUTIVE SUMMARY · '+esc(d.referenceDate||d.today)+'</span><h2>'+esc(statusText)+'</h2><p>'+esc(execSummaryText(d))+'</p></div>'+
        '<div class="exec-hero-rate"><span>อัตราตรวจครบ'+refLabel+'</span><b>'+execPct(t.completionRate)+'</b><small>'+t.done+' / '+t.scheduled+' พื้นที่</small></div>'+
      '</section>'+
      '<div class="exec-kpi-grid">'+
        '<article class="exec-kpi"><span>คะแนนเฉลี่ย 30 วัน</span><b>'+execScore(l.averageScore)+'</b><small>จากคะแนนเต็ม 3</small></article>'+
        '<article class="exec-kpi excellent"><span>'+esc(labels["3"])+' 30 วัน</span><b>'+execPct(l.excellentRate)+'</b><small>'+Number(l.excellent||0)+' จาก '+Number(l.done||0)+' ผลตรวจ</small></article>'+
        '<article class="exec-kpi improve"><span>'+esc(labels["1"])+' 30 วัน</span><b>'+execPct(l.improveRate)+'</b><small>'+Number(l.improve||0)+' ครั้ง</small></article>'+
        '<article class="exec-kpi"><span>พื้นที่ต้องติดตาม</span><b>'+watch.length+'</b><small>มีผลระดับปรับปรุงใน 30 วัน</small></article>'+
      '</div>'+
      execMapHtml(executiveMapPack,refDate)+
      '<div class="exec-period-grid">'+
        '<section class="card exec-period-card"><div class="exec-period-head"><div><span>สัปดาห์นี้</span><h3>'+execPct(w.completionRate)+' ตรวจครบ</h3></div>'+execDelta(w.completionRate,pw.completionRate,1,"%")+'</div>'+
          '<div class="exec-period-stats"><span>คะแนนเฉลี่ย <b>'+execScore(w.averageScore)+'</b></span><span>ตรวจแล้ว <b>'+w.done+'/'+w.scheduled+'</b></span><span>ปรับปรุง <b>'+w.improve+'</b></span></div>'+
        '</section>'+
        '<section class="card exec-period-card"><div class="exec-period-head"><div><span>เดือนนี้</span><h3>'+execPct(m.completionRate)+' ตรวจครบ</h3></div>'+execDelta(m.completionRate,pm.completionRate,1,"%")+'</div>'+
          '<div class="exec-period-stats"><span>คะแนนเฉลี่ย <b>'+execScore(m.averageScore)+'</b></span><span>ตรวจแล้ว <b>'+m.done+'/'+m.scheduled+'</b></span><span>ปรับปรุง <b>'+m.improve+'</b></span></div>'+
        '</section>'+
      '</div>'+
      '<div class="grid xl:grid-cols-2 gap-5 mb-5">'+
        '<section class="card"><div class="exec-chart-head"><div><span class="muted">8 สัปดาห์ล่าสุด</span><h2>แนวโน้มรายสัปดาห์</h2></div><span class="exec-legend-note">คะแนนเฉลี่ย + อัตราตรวจครบ</span></div><div class="chart-box exec-chart-box"><canvas id="exec-week-chart"></canvas></div></section>'+
        '<section class="card"><div class="exec-chart-head"><div><span class="muted">6 เดือนล่าสุด</span><h2>แนวโน้มผลประเมินรายเดือน</h2></div><span class="exec-legend-note">จำนวนผลตรวจแต่ละระดับ</span></div><div class="chart-box exec-chart-box"><canvas id="exec-month-chart"></canvas></div></section>'+
      '</div>'+
      '<div class="grid xl:grid-cols-2 gap-5 mb-5">'+
        '<section class="card"><div class="exec-section-title"><div><span class="muted">30 วันล่าสุด</span><h2>พื้นที่ที่ควรติดตาม</h2></div><a href="#reports" class="text-link">ดูรายงานทั้งหมด</a></div>'+
          table(["พื้นที่","ห้องรับผิดชอบ","ปรับปรุง","คะแนนเฉลี่ย"],execWatchRows(watch.slice(0,6)))+
        '</section>'+
        '<section class="card"><div class="exec-section-title"><div><span class="muted">30 วันล่าสุด</span><h2>ห้องเรียนผลเฉลี่ยเด่น</h2></div><a href="#reports" class="text-link">ดูรายละเอียด</a></div>'+
          (leaders.length?'<div class="exec-leader-list">'+leaders.map((x,i)=>
            '<div class="exec-leader-row"><span class="exec-rank">'+(i+1)+'</span><div><b>'+esc(x.name)+'</b><small>'+Number(x.total||0)+' ผลตรวจ</small></div><strong>'+execScore(x.avg)+'</strong></div>'
          ).join("")+'</div>':'<div class="empty">ยังไม่มีข้อมูลเพียงพอ</div>')+
        '</section>'+
      '</div>'+
      '<section class="card exec-quality-card"><div class="exec-section-title"><div><span class="muted">'+refLabel+'</span><h2>สัดส่วนผลประเมิน</h2></div><span class="muted">อัปเดต '+esc(new Date(d.updatedAt).toLocaleTimeString("th-TH",{timeZone:"Asia/Bangkok"}))+' น.</span></div>'+
        '<div class="exec-quality-grid">'+
          '<div class="excellent"><span>'+esc(labels["3"])+'</span><b>'+t.excellent+'</b></div>'+
          '<div class="medium"><span>'+esc(labels["2"])+'</span><b>'+t.medium+'</b></div>'+
          '<div class="improve"><span>'+esc(labels["1"])+'</span><b>'+t.improve+'</b></div>'+
          '<div class="pending"><span>รอตรวจ</span><b>'+t.pending+'</b></div>'+
        '</div>'+
      '</section>';

    wireExecMap(refDate);
    if($("exec-period-select"))$("exec-period-select").onchange=()=>{
      executivePeriodId=$("exec-period-select").value;
      loadExecutiveDashboard(S.seq).catch(error);
    };
    S.charts.forEach(c=>c.destroy());S.charts=[];
    if(window.Chart){
      Chart.defaults.font.family="Kanit";
      Chart.defaults.color="#718497";
      const weeks=d.weekSeries||[],months=d.monthSeries||[];
      S.charts.push(new Chart($("exec-week-chart"),{
        data:{
          labels:weeks.map(x=>execWeekLabel(x.start)),
          datasets:[
            {type:"line",label:"คะแนนเฉลี่ย",data:weeks.map(x=>Number(x.averageScore||0)),borderColor:"#0f766e",backgroundColor:"#0f766e",tension:.35,yAxisID:"yScore",pointRadius:3,pointHoverRadius:5},
            {type:"bar",label:"ตรวจครบ (%)",data:weeks.map(x=>Number(x.completionRate||0)),backgroundColor:"rgba(8,145,178,.18)",borderColor:"#0891b2",borderWidth:1,borderRadius:7,yAxisID:"yRate"}
          ]
        },
        options:{
          maintainAspectRatio:false,
          interaction:{mode:"index",intersect:false},
          scales:{
            yScore:{position:"left",min:0,max:3,ticks:{stepSize:1},grid:{color:"rgba(148,163,184,.12)"}},
            yRate:{position:"right",min:0,max:100,grid:{drawOnChartArea:false},ticks:{callback:v=>v+"%"}},
            x:{grid:{display:false}}
          },
          plugins:{legend:{position:"bottom"}}
        }
      }));
      S.charts.push(new Chart($("exec-month-chart"),{
        type:"bar",
        data:{
          labels:months.map(x=>execMonthLabel(x.month)),
          datasets:[
            {label:labels["3"],data:months.map(x=>Number(x.excellent||0)),backgroundColor:"#86efac",borderRadius:5},
            {label:labels["2"],data:months.map(x=>Number(x.medium||0)),backgroundColor:"#fde68a",borderRadius:5},
            {label:labels["1"],data:months.map(x=>Number(x.improve||0)),backgroundColor:"#fda4af",borderRadius:5}
          ]
        },
        options:{
          maintainAspectRatio:false,
          scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,beginAtZero:true,grid:{color:"rgba(148,163,184,.12)"}}},
          plugins:{legend:{position:"bottom"}}
        }
      }));
    }
    icons();
  }

  async function renderReports(seq) {
    const today = thaiDay(),periods=await rpc("academicPeriods",{},true);
    if(seq!==S.seq)return;
    const active=periods.find(x=>x.IsActive),startDefault=active?.StartDate||today.slice(0,8)+"01",endDefault=active?((active.EndDate<today)?active.EndDate:today):today;
    $("app").innerHTML =
      heading("รายงานและเกียรติบัตร", "วิเคราะห์ผลการดูแลพื้นที่และติดตามประสิทธิภาพการตรวจ", '<div class="flex flex-wrap gap-2"><a class="btn secondary" href="#daily"><i data-lucide="send"></i> รายงานผลรายวัน</a><a class="btn secondary" href="#certificates"><i data-lucide="award"></i> เกียรติบัตรอัตโนมัติ</a></div>') +
      '<form id="report-filter" class="card flex flex-wrap items-end gap-4 mb-6">'+
        '<div class="field m-0"><label>ปีการศึกษา / ภาคเรียน</label><select id="report-period"><option value="">กำหนดช่วงเอง</option>'+periods.map(x=>'<option value="'+esc(x.PeriodID)+'" data-start="'+esc(x.StartDate)+'" data-end="'+esc(x.EndDate)+'" '+(x.IsActive?"selected":"")+'>'+esc(x.Label)+'</option>').join("")+'</select></div>'+
        '<div class="field m-0"><label>ตั้งแต่วันที่</label><input type="date" name="start" value="'+esc(startDefault)+'" required></div>'+
        '<div class="field m-0"><label>ถึงวันที่</label><input type="date" name="end" value="'+esc(endDefault)+'" max="'+today+'" required></div>'+
        '<button class="btn">แสดงรายงาน</button></form><div id="report-content"></div>';
    $("report-period").onchange=()=>{
      const o=$("report-period").selectedOptions[0];
      if(o?.value){
        $("report-filter").elements.start.value=o.dataset.start;
        $("report-filter").elements.end.value=o.dataset.end<today?o.dataset.end:today;
        loadReport().catch(error);
      }
    };
    $("report-filter").onsubmit = (e) => {
      e.preventDefault();
      loadReport().catch(error);
    };
    await loadReport(seq);
  }
  async function loadReport(seq = S.seq) {
    const f = new FormData($("report-filter")),
      r = await rpc("report", Object.fromEntries(f));
    if (seq !== S.seq) return;
    reportData = r;
    drawReport();
  }
  function drawReport() {
    const r = reportData;
    $("report-content").innerHTML =
      '<div class="card mb-4 report-search-card"><div class="search-box"><i data-lucide="search"></i><input id="report-search" type="search" placeholder="ค้นหาห้องเรียน / พื้นที่ / ผู้ตรวจ…"></div></div>' +
      '<section class="card mb-6"><div class="flex justify-between items-center mb-4"><h2>🏆 อันดับห้องเรียน</h2><select id="leader-sort" class="control" style="width:180px"><option value="average">คะแนนเฉลี่ย</option><option value="total">คะแนนสะสม</option></select></div><div id="report-leaders"></div></section><div class="grid lg:grid-cols-2 gap-6 mb-6"><section class="card"><h2 class="mb-4">พื้นที่ที่ต้องจับตา</h2>' +
      table(
        ["พื้นที่", "ปรับปรุง (ครั้ง)"],
        r.watch.map((x) => [esc(x.name), x.count]),
      ) +
      '</section><section class="card"><h2 class="mb-4">ประสิทธิภาพผู้ตรวจ</h2>' +
      table(
        ["ผู้ตรวจ", "งานทั้งหมด", "ตรวจแล้ว", "สำเร็จ"],
        r.inspectors.map((x) => [
          esc(x.name),
          x.scheduled,
          x.done,
          (x.scheduled ? Math.round((x.done / x.scheduled) * 100) : 0) + "%",
        ]),
      ) +
      '</section></div><section class="card"><h2 class="mb-2">🎖 เกียรติบัตรประจำเดือน ' +
      esc(r.month) +
      '</h2><p class="muted mb-4">ใช้ข้อมูลทั้งเดือนของวันที่สิ้นสุดรายงาน · ผลระหว่างเดือนยังไม่ใช่ผลรับรอง · นับเฉพาะวันที่โรงเรียนมีผลตรวจจริง และต้องตรวจครบทุกงานในวันนั้น</p>' +
      table(
        ["ห้องเรียน", "ตรวจแล้ว/งาน", "ปรับปรุง", "วันขาดข้อมูล", "ระดับ", "เกียรติบัตร"],
        r.monthly.map((x, index) => [
          esc(x.name),
          x.done + "/" + x.total,
          x.improve,
          x.missingDays,
          esc(x.medal) + (x.provisional ? ' <span class="pill gray">ชั่วคราว</span>' : ""),
          !x.provisional && ["เหรียญทอง", "เหรียญเงิน", "เหรียญทองแดง"].includes(x.medal)
            ? '<button class="btn small secondary certificate-btn" data-index="' +
              index +
              '">พิมพ์</button>'
            : "—",
        ]),
      ) +
      "</section>";
    const leaderValues = (x) => {
      const isNewShape = x.avg !== undefined || x.score !== undefined;
      const count = Number(x.count ?? (isNewShape ? x.total : 0) ?? 0);
      const average = Number(x.average ?? x.avg ?? 0);
      const totalScore = Number(x.score ?? (!isNewShape ? x.total : 0) ?? 0);
      return {
        count: Number.isFinite(count) ? count : 0,
        average: Number.isFinite(average) ? average : 0,
        totalScore: Number.isFinite(totalScore) ? totalScore : 0,
      };
    };
    const leaders = () => {
      const metric = $("leader-sort").value;
      const rows = [...(r.leaders || [])]
        .map((x) => ({ ...x, _v: leaderValues(x) }))
        .sort((a, b) =>
          metric === "average"
            ? b._v.average - a._v.average
            : b._v.totalScore - a._v.totalScore
        )
        .map((x, i) => [
          i + 1,
          esc(x.name),
          x._v.count,
          x._v.average.toFixed(2),
          x._v.totalScore,
        ]);
      $("report-leaders").innerHTML = table(
        ["อันดับ", "ห้องเรียน", "ครั้ง", "คะแนนเฉลี่ย", "คะแนนสะสม"],
        rows,
      );
    };
    $("leader-sort").onchange = leaders;
    leaders();
    wireTextFilter("report-search","#report-content");
    icons();
    document
      .querySelectorAll(".certificate-btn")
      .forEach((b) => (b.onclick = () => certificate(r.monthly[Number(b.dataset.index)], r.month)));
  }
  function certificate(item, month) {
    openModal(
      "เกียรติบัตร",
      '<div class="certificate"><p>โรงเรียนรัษฎา</p><h2>เกียรติบัตร</h2><p>มอบไว้เพื่อแสดงว่า</p><h3>' +
        esc(item.name) +
        "</h3><p>ได้รับรางวัล <strong>" +
        esc(item.medal) +
        "</strong></p><p>การดูแลรักษาความสะอาดเขตพื้นที่โรงเรียน<br>ประจำเดือน " +
        esc(month) +
        '</p><p>ขอชื่นชมในความรับผิดชอบและความร่วมมือ<br>ในการสร้างสภาพแวดล้อมที่เอื้อต่อการเรียนรู้</p><p style="margin-top:60px">ลงชื่อ ........................................................<br><small>ผู้บริหารสถานศึกษา</small></p></div><button class="btn mt-4 no-print" id="print-certificate">พิมพ์ / บันทึก PDF</button>',
    );
    $("print-certificate").onclick = () => window.print();
  }
  // Bulk import accepts Excel clipboard (TSV), UTF-8 CSV, and semicolon-delimited CSV.
  const BULK_SPEC = {
    Classrooms: {
      headers: ["ClassName"],
      labels: ["ชื่อห้องเรียน"],
      sample: [["ม.1/1"], ["ม.1/2"]],
    },
    Areas: {
      headers: ["AreaName", "ClassName"],
      labels: ["ชื่อพื้นที่", "ห้องรับผิดชอบ"],
      sample: [
        ["สวนหน้าอาคาร", "ม.1/1"],
        ["ลานกิจกรรม", "ม.1/2"],
      ],
    },
    Users: {
      headers: ["Username", "Password", "FullName", "Role", "ClassName"],
      labels: ["ชื่อผู้ใช้", "รหัสผ่าน", "ชื่อ–สกุล", "สิทธิ์", "ห้องเรียน"],
      sample: [
        ["inspector01", "1234", "ชื่อผู้ตรวจ", "Inspector", ""],
        ["teacher01", "1234", "ชื่อครูประจำชั้น", "Teacher", "ม.1/1"],
      ],
    },
    Assignments: {
      headers: ["Username", "AreaName", "Days"],
      labels: ["ผู้ตรวจ", "พื้นที่", "วันเข้าเวร"],
      sample: [
        ["inspector01", "สวนหน้าอาคาร", "1,2,3,4,5"],
        ["inspector02", "ลานกิจกรรม", "1,3,5,6,7"],
      ],
    },
  };
  function bulkParse(text) {
    text = String(text)
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n");
    if (text.length > 200000) throw Error("ข้อมูลใหญ่เกินไป กรุณาแบ่งครั้งละไม่เกิน 100 รายการ");
    // Count separators outside quoted cells in the first record.
    const separators = { "\t": 0, ",": 0, ";": 0 };
    let quoted = false;
    for (let n = 0; n < text.length; n++) {
      const c = text[n];
      if (c === '"') {
        if (quoted && text[n + 1] === '"') {
          n++;
          continue;
        }
        quoted = !quoted;
      } else if (!quoted && c === "\n") break;
      else if (!quoted && c in separators) separators[c]++;
    }
    const delimiter = separators["\t"] ? "\t" : separators[";"] > separators[","] ? ";" : ",";
    const rows = [];
    let row = [],
      cell = "",
      inQuotes = false,
      closed = false;
    const pushCell = () => {
      row.push(cell);
      cell = "";
      closed = false;
    };
    const pushRow = () => {
      pushCell();
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    };
    for (let n = 0; n < text.length; n++) {
      const c = text[n];
      if (inQuotes) {
        if (c === '"') {
          if (text[n + 1] === '"') {
            cell += '"';
            n++;
          } else {
            inQuotes = false;
            closed = true;
          }
        } else cell += c;
        continue;
      }
      if (c === delimiter) {
        pushCell();
        continue;
      }
      if (c === "\n") {
        pushRow();
        continue;
      }
      if (closed) {
        if (c === " " || c === "\t") continue;
        throw Error("รูปแบบ CSV ไม่ถูกต้องหลังเครื่องหมายคำพูด");
      }
      if (c === '"') {
        if (cell !== "") throw Error("เครื่องหมายคำพูดต้องอยู่ต้นช่องข้อมูล");
        inQuotes = true;
        continue;
      }
      cell += c;
    }
    if (inQuotes) throw Error("เครื่องหมายคำพูดใน CSV ปิดไม่ครบ");
    pushRow();
    return rows;
  }
  function bulkDecode(text, kind) {
    const matrix = bulkParse(text),
      spec = BULK_SPEC[kind];
    if (!matrix.length) throw Error("วางหัวตารางพร้อมข้อมูลก่อน");
    const aliases = {
      username: "Username",
      ชื่อผู้ใช้: "Username",
      password: "Password",
      รหัสผ่าน: "Password",
      fullname: "FullName",
      ชื่อสกุล: "FullName",
      "ชื่อ–สกุล": "FullName",
      "ชื่อ-สกุล": "FullName",
      role: "Role",
      สิทธิ์: "Role",
      classname: "ClassName",
      ชื่อห้องเรียน: "ClassName",
      ห้องเรียน: "ClassName",
      ห้องรับผิดชอบ: "ClassName",
      areaName: "AreaName",
      areaname: "AreaName",
      ชื่อพื้นที่: "AreaName",
      พื้นที่: "AreaName",
      inspector: "Username",
      ผู้ตรวจ: "Username",
      days: "Days",
      วันเข้าเวร: "Days",
    };
    const keys = matrix[0].map((h) => aliases[h.trim().toLowerCase().replace(/\s+/g, "")]);
    if (keys.some((k) => !k || !spec.headers.includes(k)) || new Set(keys).size !== keys.length)
      throw Error("หัวตารางไม่ตรงหรือซ้ำ กรุณาใช้รูปแบบตัวอย่าง");
    const required = spec.headers.filter((k) => !(kind === "Users" && k === "ClassName"));
    if (required.some((k) => !keys.includes(k)))
      throw Error("หัวตารางไม่ครบ: " + required.join(", "));
    if (matrix.length < 2 || matrix.length > 101)
      throw Error("นำเข้าได้ครั้งละ 1–100 รายการ ไม่รวมหัวตาราง");
    return matrix.slice(1).map((cells, index) => {
      if (cells.length !== keys.length)
        throw Error("แถว " + (index + 2) + " มีจำนวนช่องไม่ตรงกับหัวตาราง");
      const r = {};
      keys.forEach((k, i) => (r[k] = k === "Password" ? cells[i] : cells[i].trim()));
      if (kind === "Users") {
        if (r.Password.length < 4 || r.Password.length > 200)
          throw Error("แถว " + (index + 2) + " ต้องตั้งรหัสผ่าน 4–200 ตัวอักษร");
        r.ClassName = r.ClassName || "";
      }
      return r;
    });
  }
  function bulkSafeRows(rows) {
    // Plain passwords remain inside this modal's closure and are never sent in preview/RPC.
    return rows.map(({ Password, ...rest }) => rest);
  }
  function bulkTemplate(kind) {
    const spec = BULK_SPEC[kind];
    const csv = [spec.headers, ...spec.sample]
      .map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "RSD-" + kind + "-template.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function bulkModal() {
    const kind = adminTab,
      spec = BULK_SPEC[kind];
    openModal(
      "เพิ่มหลายรายการ: " + adminTables[kind].name,
      '<p class="muted">คัดลอกหัวตารางพร้อมข้อมูลจาก Excel มาวาง หรือเลือกไฟล์ CSV/TSV แบบ UTF-8 · ครั้งละไม่เกิน 100 รายการ</p>' +
        '<div class="flex flex-wrap gap-2 my-3"><button type="button" class="btn small secondary" id="bulk-example">วางรูปแบบตัวอย่าง</button><button type="button" class="btn small secondary" id="bulk-template">ดาวน์โหลดแม่แบบ CSV</button></div>' +
        '<p class="muted">' +
        (kind === "Users"
          ? "กำหนดรหัสผ่านเองอย่างน้อย 4 ตัว · Teacher ต้องระบุชื่อห้องเรียน · สิทธิ์อื่นเว้นห้องเรียนว่าง"
          : kind === "Areas"
            ? "เพิ่มห้องเรียนให้เรียบร้อยก่อน ใช้ชื่อห้องเรียนหรือ ClassroomID เพื่อจับคู่"
            : kind === "Assignments"
              ? "ใช้ Username ของผู้ตรวจ + ชื่อพื้นที่ + วันเข้าเวร 1–7 (6=เสาร์, 7=อาทิตย์) เช่น 1,2,3,4,5,6"
              : "กรอกหนึ่งห้องต่อหนึ่งแถว") +
        "</p>" +
        '<div class="field"><label for="bulk-file">เลือกไฟล์ CSV / TSV</label><input id="bulk-file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values"></div>' +
        '<div class="field"><label for="bulk-text">หัวตารางและรายการข้อมูล</label><textarea id="bulk-text" rows="9" spellcheck="false" autocomplete="off" placeholder="' +
        esc(spec.headers.join("\t")) +
        '"></textarea></div>' +
        '<div class="flex flex-wrap gap-2"><button type="button" class="btn secondary" id="bulk-preview">ตรวจสอบข้อมูล</button><button type="button" class="btn" id="bulk-save" disabled>บันทึกทั้งหมด</button></div><div id="bulk-result" class="mt-4" aria-live="polite"></div>',
    );
    const area = $("bulk-text"),
      file = $("bulk-file"),
      save = $("bulk-save"),
      preview = $("bulk-preview"),
      out = $("bulk-result");
    let draft = null,
      compiled = null,
      revision = 0,
      saving = false;
    function invalidate() {
      revision++;
      draft = null;
      compiled = null;
      save.disabled = true;
      out.replaceChildren();
    }
    area.oninput = invalidate;
    $("bulk-template").onclick = () => bulkTemplate(kind);
    $("bulk-example").onclick = () => {
      area.value = [spec.headers, ...spec.sample].map((r) => r.join("\t")).join("\n");
      invalidate();
    };
    file.onchange = async () => {
      invalidate();
      const current = revision,
        selected = file.files[0];
      if (!selected) return;
      try {
        if (!/\.(csv|tsv)$/i.test(selected.name))
          throw Error("ใช้ CSV/TSV หรือคัดลอกเซลล์จาก Excel มาวาง");
        if (selected.size > 1024 * 1024) throw Error("ไฟล์ต้องไม่เกิน 1 MB กรุณาแบ่งข้อมูล");
        const content = new TextDecoder("utf-8", { fatal: true }).decode(
          await selected.arrayBuffer(),
        );
        if (current === revision && area.isConnected) {
          area.value = content;
          invalidate();
        }
      } catch (e) {
        error(e);
      }
    };
    function showResult(result, local) {
      const failed = result.rows.filter((r) => r.errors.length).length;
      out.innerHTML =
        '<p class="mb-3">' +
        (failed
          ? "พบปัญหา " + failed + " แถว กรุณาแก้แล้วตรวจสอบใหม่"
          : "ตรวจสอบผ่าน " + result.total + " รายการ พร้อมบันทึก") +
        "</p>" +
        table(
          ["แถว", ...spec.labels.filter((x) => x !== "รหัสผ่าน"), "ผลตรวจ"],
          result.rows.map((r, index) => {
            const data = { ...local[index], ...r.display };
            return [
              r.row,
              ...spec.headers.filter((k) => k !== "Password").map((k) => esc(data[k] || "—")),
              r.errors.length
                ? '<span class="text-red-600">' + r.errors.map(esc).join("<br>")
                : '<span class="pill green">ผ่าน</span>',
            ];
          }),
        );
    }
    preview.onclick = async () => {
      if (saving) return;
      invalidate();
      const current = revision;
      preview.disabled = true;
      try {
        const parsed = bulkDecode(area.value, kind);
        const result = await rpc("bulkPreview", { table: kind, rows: bulkSafeRows(parsed) });
        if (current !== revision || !area.isConnected) return;
        showResult(result, parsed);
        draft = result.valid ? parsed : null;
        save.disabled = !draft;
      } catch (e) {
        error(e);
      } finally {
        if (preview.isConnected) preview.disabled = false;
      }
    };
    save.onclick = async () => {
      if (saving || !draft) return;
      const current = revision;
      const confirm = await Swal.fire({
        title: "บันทึก " + draft.length + " รายการ?",
        text: "เพิ่มเป็นรายการใหม่ทั้งหมด โดยไม่เขียนทับข้อมูลเดิม",
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "บันทึกทั้งหมด",
        cancelButtonText: "ยกเลิก",
      });
      if (!confirm.isConfirmed || current !== revision || !area.isConnected || !draft) return;
      saving = true;
      save.disabled = true;
      preview.disabled = true;
      area.disabled = true;
      file.disabled = true;
      $("bulk-example").disabled = true;
      busy(true, "กำลังเตรียมข้อมูล…");
      try {
        if (!compiled) {
          compiled = [];
          for (let index = 0; index < draft.length; index++) {
            $("loading-text").textContent = "เตรียมข้อมูล " + (index + 1) + " / " + draft.length;
            const { Password, ...data } = draft[index];
            if (kind === "Users") data.credential = await newCredential(Password);
            compiled.push(data);
          }
        }
        $("loading-text").textContent = "กำลังบันทึก " + compiled.length + " รายการ…";
        const result = await rpc("bulkCreate", { table: kind, rows: compiled }, true);
        if (!result.saved) {
          showResult(result, draft);
          draft = null;
          compiled = null;
          throw Error("ข้อมูลเปลี่ยนระหว่างตรวจสอบ กรุณาแก้รายการที่แจ้งแล้วตรวจสอบอีกครั้ง");
        }
        area.value = "";
        draft = null;
        compiled = null;
        closeModal();
        toast("เพิ่มข้อมูลสำเร็จ " + result.count + " รายการ");
        await route();
      } catch (e) {
        compiled = null;
        error(e);
      } finally {
        saving = false;
        busy(false);
        if (save.isConnected) {
          save.disabled = true;
          preview.disabled = false;
          area.disabled = false;
          file.disabled = false;
          $("bulk-example").disabled = false;
        }
      }
    };
  }

  async function auditModal() {
    openModal("ประวัติการเปลี่ยนแปลง", '<div class="muted">กำลังโหลด Audit Log…</div>');
    try {
      const rows = await rpc("auditLog", { limit: 200 });
      const labels = {
        saveMaster:"เพิ่ม/แก้ข้อมูลหลัก",
        bulkCreate:"เพิ่มข้อมูลหลายรายการ",
        deleteMaster:"ลบข้อมูล",
        assign:"ตั้งเวรผู้ตรวจ",
        setAssignmentDays:"แก้วันเข้าเวร",
        saveInspection:"บันทึกผลตรวจ",
        password:"เปลี่ยนรหัสผ่าน",
        holidays:"แก้วันหยุด",
        backupExport:"ดาวน์โหลด Backup",
        backupNow:"Backup ไป Google Drive",
        restoreBackup:"กู้คืนจาก Backup",
        backupAuto:"Backup อัตโนมัติ"
      };
      $("modal-body").innerHTML =
        '<p class="muted mb-4">แสดงรายการล่าสุด ' + rows.length + ' รายการ · Audit Log ไม่เก็บรหัสผ่านหรือ credential</p>' +
        table(
          ["วันเวลา","ผู้ดำเนินการ","รายการ","ประเภท/รหัส","รายละเอียด"],
          rows.map(r => [
            esc(new Date(r.Timestamp).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})),
            esc((r.ActorName||"ระบบ") + (r.ActorRole ? " · " + r.ActorRole : "")),
            esc(labels[r.Action] || r.Action),
            esc((r.EntityType||"—") + (r.EntityID ? " · " + r.EntityID : "")),
            '<code class="text-xs whitespace-pre-wrap">' + esc(JSON.stringify(r.Details||{})) + '</code>'
          ])
        );
    } catch (e) {
      $("modal-body").innerHTML = '<div class="warn">' + esc(e.message||String(e)) + '</div>';
    }
  }

  function backupCenterModal() {
    openModal(
      "สำรองและกู้คืนข้อมูล",
      '<div class="space-y-4">' +
        '<div class="warn"><b>คำแนะนำ:</b> ก่อนเปลี่ยนข้อมูลจำนวนมาก ควรสำรองข้อมูลไว้ก่อน ไฟล์ Backup มีข้อมูลบัญชีแบบ hash จึงควรเก็บเป็นความลับ</div>' +
        '<div class="grid gap-3">' +
          '<button class="btn" id="backup-drive-now">☁ Backup ไป Google Drive ตอนนี้</button>' +
          '<button class="btn secondary" id="backup-download-now">⬇ ดาวน์โหลด Backup ลงเครื่อง</button>' +
        '</div>' +
        '<hr class="my-4">' +
        '<h3 class="text-lg font-medium">กู้คืนจากไฟล์ Backup</h3>' +
        '<p class="muted">ระบบจะตรวจไฟล์ สร้าง Backup ของข้อมูลปัจจุบันไป Google Drive ก่อน แล้วจึงกู้คืน D1</p>' +
        '<input id="restore-file" type="file" accept="application/json,.json" class="w-full">' +
        '<button class="btn danger mt-3" id="restore-backup-btn">♻ กู้คืนจากไฟล์ที่เลือก</button>' +
      '</div>'
    );
    $("backup-drive-now").onclick = backupToDriveNow;
    $("backup-download-now").onclick = downloadBackup;
    $("restore-backup-btn").onclick = restoreBackupFile;
  }

  async function backupToDriveNow() {
    busy(true,"กำลังสำรอง D1 ไป Google Drive…");
    try {
      const r = await rpc("backupNow", {}, true);
      await Swal.fire({
        icon:"success",
        title:"Backup สำเร็จ",
        html:"บันทึกเป็น <b>"+esc(r.filename||"Backup JSON")+"</b><br><span class='muted'>"+esc(new Date(r.createdAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"}))+"</span>"
      });
      toast("สำรองข้อมูลไป Google Drive แล้ว");
    } catch(e) {
      error(e);
    } finally {
      busy(false);
    }
  }

  async function restoreBackupFile() {
    const input = $("restore-file"), file = input?.files?.[0];
    if (!file) return Swal.fire({icon:"warning",title:"ยังไม่ได้เลือกไฟล์ Backup"});
    if (file.size > 20 * 1024 * 1024) return Swal.fire({icon:"error",title:"ไฟล์ใหญ่เกิน 20 MB"});
    let bundle;
    try {
      bundle = JSON.parse(await file.text());
    } catch(e) {
      return Swal.fire({icon:"error",title:"อ่านไฟล์ไม่ได้",text:"ไฟล์ต้องเป็น JSON ที่ถูกต้อง"});
    }
    if (!bundle || bundle.format !== "rsd-clean-d1-backup-v1" || !bundle.tables) {
      return Swal.fire({icon:"error",title:"ไฟล์ Backup ไม่ถูกต้อง",text:"รองรับเฉพาะ RSD Clean D1 Backup v1"});
    }
    const names=["users","classrooms","areas","assignments","inspections","inspection_inspectors","rewards_log","holidays","settings","audit_log","recycle_bin","duty_overrides","academic_periods","push_subscriptions"];
    const counts=names.map(n=>[n,Array.isArray(bundle.tables[n])?bundle.tables[n].length:0]);
    const created=bundle.createdAt ? new Date(bundle.createdAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"}) : "ไม่ระบุ";
    const summary=counts.map(([n,c])=>"<tr><td style='text-align:left;padding:3px 10px'>"+esc(n)+"</td><td style='text-align:right;padding:3px 10px'>"+c+"</td></tr>").join("");
    const confirm = await Swal.fire({
      icon:"warning",
      title:"ยืนยันการกู้คืนข้อมูล",
      html:
        "<p>Backup วันที่ <b>"+esc(created)+"</b></p>"+
        "<table style='margin:12px auto'>"+summary+"</table>"+
        "<p><b>ข้อมูล D1 ปัจจุบันจะถูกแทนที่ด้วยข้อมูลในไฟล์นี้</b></p>"+
        "<p>ก่อน Restore ระบบจะสำรองข้อมูลปัจจุบันไป Google Drive ให้อัตโนมัติ</p>",
      input:"text",
      inputLabel:"พิมพ์ RESTORE เพื่อยืนยัน",
      inputPlaceholder:"RESTORE",
      showCancelButton:true,
      confirmButtonText:"กู้คืนข้อมูล",
      cancelButtonText:"ยกเลิก",
      confirmButtonColor:"#b91c1c",
      preConfirm:(v)=>{
        if(String(v||"").trim()!=="RESTORE"){
          Swal.showValidationMessage("กรุณาพิมพ์ RESTORE ให้ตรงกัน");
          return false;
        }
        return true;
      }
    });
    if (!confirm.isConfirmed) return;

    busy(true,"กำลังสร้าง Safety Backup และกู้คืนข้อมูล…");
    try {
      const r = await rpc("restoreBackup", { bundle, confirm:"RESTORE" }, true);
      busy(false);
      await Swal.fire({
        icon:"success",
        title:"กู้คืนสำเร็จ",
        html:
          "ข้อมูลถูกกู้คืนแล้ว<br>"+
          "Safety Backup ก่อนกู้คืน: <b>"+esc(r.preRestoreBackup?.filename||"สร้างแล้ว")+"</b><br>"+
          "<span class='muted'>ระบบจะออกจากระบบเพื่อโหลดข้อมูลชุดใหม่</span>",
        confirmButtonText:"เข้าสู่ระบบใหม่"
      });
      clearSession();
      location.href = location.pathname;
    } catch(e) {
      busy(false);
      error(e);
    }
  }

  async function downloadBackup() {
    const ok = await Swal.fire({
      title:"ดาวน์โหลด Backup D1?",
      text:"ไฟล์มีข้อมูลระบบและ password hash ควรเก็บไว้เป็นความลับ",
      icon:"question",
      showCancelButton:true,
      confirmButtonText:"ดาวน์โหลด",
      cancelButtonText:"ยกเลิก"
    });
    if (!ok.isConfirmed) return;
    busy(true,"กำลังสร้าง Backup…");
    try {
      const bundle = await rpc("backupExport", {}, true);
      const blob = new Blob([JSON.stringify(bundle,null,2)], {type:"application/json;charset=utf-8"});
      const url = URL.createObjectURL(blob), a=document.createElement("a");
      a.href=url;
      a.download="RSD-Clean-D1-backup-"+thaiDay()+".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
      toast("สร้างไฟล์ Backup แล้ว");
    } catch(e) {
      error(e);
    } finally {
      busy(false);
    }
  }


  function trashTypeLabel(t) {
    return ({Users:"ผู้ใช้งาน",Classrooms:"ห้องเรียน",Areas:"เขตพื้นที่",Assignments:"งานมอบหมาย",Inspections:"ผลตรวจ"})[t] || t;
  }
  async function trashModal() {
    openModal("ถังขยะ", '<div id="trash-body"><div class="muted">กำลังโหลดถังขยะ…</div></div>');
    await refreshTrash();
  }
  async function refreshTrash() {
    const box=$("trash-body"); if(!box) return;
    try{
      const rows=await rpc("recycleBin",{},true);
      if(!box.isConnected) return;
      box.innerHTML =
        '<div class="warn mb-4"><b>กู้คืนได้ภายใน 30 วัน</b><br>รายการที่ครบกำหนดจะถูกลบถาวรอัตโนมัติ</div>' +
        table(
          ["ประเภท","รายการ","เหตุผล","ลบเมื่อ","ผู้ลบ","เหลือ","จัดการ"],
          rows.map(r=>{
            const days=Math.max(0,Math.ceil((Number(r.ExpiresAt)-Date.now())/86400000));
            return[
              esc(trashTypeLabel(r.EntityType)),
              esc(r.Label||r.EntityID),
              esc(r.Reason||"—"),
              esc(new Date(r.DeletedAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})),
              esc(r.DeletedBy||"—"),
              days+" วัน",
              '<button class="btn small secondary restore-trash" data-id="'+esc(r.RecycleID)+'">กู้คืน</button> '+
              '<button class="btn small danger purge-trash" data-id="'+esc(r.RecycleID)+'">ลบถาวร</button>'
            ];
          })
        );
      document.querySelectorAll(".restore-trash").forEach(b=>b.onclick=async()=>{
        const ok=await Swal.fire({icon:"question",title:"กู้คืนรายการนี้?",showCancelButton:true,confirmButtonText:"กู้คืน",cancelButtonText:"ยกเลิก"});
        if(!ok.isConfirmed)return;
        try{
          await rpc("restoreTrash",{recycleId:b.dataset.id});
          toast("กู้คืนข้อมูลแล้ว");
          await refreshTrash();
          if(S.route==="admin") {
            S.master=await rpc("master",{},true);
            adminContent();
          }
        }catch(e){error(e);}
      });
      document.querySelectorAll(".purge-trash").forEach(b=>b.onclick=async()=>{
        const ok=await Swal.fire({
          icon:"warning",
          title:"ลบถาวร?",
          text:"รายการนี้จะไม่สามารถกู้คืนจากถังขยะได้",
          input:"text",
          inputLabel:"พิมพ์ DELETE เพื่อยืนยัน",
          inputPlaceholder:"DELETE",
          showCancelButton:true,
          confirmButtonText:"ลบถาวร",
          cancelButtonText:"ยกเลิก",
          confirmButtonColor:"#be123c",
          preConfirm:v=>{
            if(String(v||"").trim()!=="DELETE"){Swal.showValidationMessage("กรุณาพิมพ์ DELETE");return false;}
            return true;
          }
        });
        if(!ok.isConfirmed)return;
        try{
          await rpc("purgeTrash",{recycleId:b.dataset.id});
          toast("ลบถาวรแล้ว");
          await refreshTrash();
        }catch(e){error(e);}
      });
    }catch(e){
      box.innerHTML='<div class="warn">โหลดถังขยะไม่สำเร็จ<br>'+esc(e.message||String(e))+'</div>';
    }
  }

  function systemEventTypeLabel(t){
    return t==="error"?"Error":t==="slow"?"Slow API":t==="security"?"Security":String(t||"");
  }
  function systemEventBadge(t){
    const map={
      error:["#fff1f2","#be123c"],
      slow:["#fff8e7","#a16207"],
      security:["#eef2ff","#4338ca"]
    };
    const x=map[t]||["#f1f5f9","#475569"];
    return '<span style="display:inline-block;padding:4px 8px;border-radius:999px;background:'+x[0]+';color:'+x[1]+';font-weight:700;font-size:11px">'+esc(systemEventTypeLabel(t))+'</span>';
  }
  async function systemMonitorModal(){
    openModal(
      "มอนิเตอร์ระบบ",
      '<div id="system-monitor-body"><div class="muted">กำลังโหลด Error / Slow API / Security events…</div></div>'
    );
    await refreshSystemMonitor();
  }
  async function refreshSystemMonitor(type=""){
    const box=$("system-monitor-body");
    if(!box)return;
    box.innerHTML='<div class="muted">กำลังโหลดข้อมูลมอนิเตอร์…</div>';
    try{
      const r=await rpc("systemEvents",{type,limit:100},true);
      if(!box.isConnected)return;
      const sum=r.summary||{},rows=Array.isArray(r.rows)?r.rows:[];
      box.innerHTML=
        '<div class="grid gap-3 md:grid-cols-3 mb-4">'+
          '<div class="card"><div class="muted">Error · 24 ชม.</div><div class="kpi" style="font-size:30px">'+Number(sum.errors||0)+'</div></div>'+
          '<div class="card"><div class="muted">Slow API · 24 ชม.</div><div class="kpi" style="font-size:30px">'+Number(sum.slow||0)+'</div></div>'+
          '<div class="card"><div class="muted">Security · 24 ชม.</div><div class="kpi" style="font-size:30px">'+Number(sum.security||0)+'</div></div>'+
        '</div>'+
        '<div class="flex flex-wrap items-center justify-between gap-3 mb-3">'+
          '<div class="muted">เก็บเฉพาะเหตุการณ์สำคัญย้อนหลัง 30 วัน · ไม่บันทึกรหัสผ่าน Token หรือข้อมูลฟอร์ม</div>'+
          '<div class="flex gap-2"><select id="monitor-filter" class="control" style="width:170px">'+
            '<option value="">ทุกประเภท</option><option value="error">Error</option><option value="slow">Slow API</option><option value="security">Security</option>'+
          '</select><button class="btn secondary" id="monitor-refresh">รีเฟรช</button></div>'+
        '</div>'+
        (rows.length
          ? table(
              ["เวลา","ประเภท","API","เวลา","รายละเอียด"],
              rows.map(x=>[
                fmtStatusDate(x.Timestamp),
                systemEventBadge(x.Type),
                esc(x.Action||"—"),
                Number(x.DurationMs||0).toLocaleString("th-TH")+" ms",
                esc(x.Message||"—")
              ])
            )
          : '<div class="empty card">ยังไม่พบเหตุการณ์ในหมวดนี้</div>');
      $("monitor-filter").value=type||"";
      $("monitor-filter").onchange=()=>refreshSystemMonitor($("monitor-filter").value);
      $("monitor-refresh").onclick=()=>refreshSystemMonitor($("monitor-filter").value);
    }catch(e){
      box.innerHTML='<div class="warn"><b>โหลดมอนิเตอร์ไม่สำเร็จ</b><br>'+esc(e.message||String(e))+'</div><button class="btn mt-3" id="monitor-retry">ลองใหม่</button>';
      if($("monitor-retry"))$("monitor-retry").onclick=()=>refreshSystemMonitor(type);
    }
  }

  async function refreshDriveStatusCard(){
    const card=$("drive-status-card");if(!card)return;
    try{
      const d=await rpc("driveStatus",{},true);
      if(!card.isConnected)return;
      card.innerHTML='<div class="muted">Google Drive Gateway</div><div class="mt-2">'+statusBadge(!!d.ok,"เชื่อมต่อแล้ว","มีปัญหา")+'</div><div class="muted mt-2">'+esc(d.message||"")+(d.cached?' · cache 60 วินาที':'')+'</div>';
    }catch(e){
      if(card.isConnected)card.innerHTML='<div class="muted">Google Drive Gateway</div><div class="mt-2">'+statusBadge(false,"เชื่อมต่อแล้ว","ตรวจสอบไม่ได้")+'</div><div class="muted mt-2">'+esc(e.message||String(e))+'</div>';
    }
  }

  function statusBadge(ok, okText, badText) {
    return ok
      ? '<span style="display:inline-block;padding:4px 9px;border-radius:999px;background:#ecfdf5;color:#166534;font-weight:700">' + esc(okText) + '</span>'
      : '<span style="display:inline-block;padding:4px 9px;border-radius:999px;background:#fff1f2;color:#be123c;font-weight:700">' + esc(badText) + '</span>';
  }
  function fmtStatusDate(v) {
    if (!v) return "—";
    const d = new Date(v);
    return Number.isNaN(d.valueOf()) ? esc(String(v)) : esc(d.toLocaleString("th-TH",{timeZone:"Asia/Bangkok"}));
  }
  async function systemStatusModal() {
    openModal(
      "สถานะระบบ",
      '<div id="system-status-body"><div class="muted">กำลังตรวจสอบ D1 และสถานะระบบ…</div></div>'
    );
    await refreshSystemStatus();
  }
  async function refreshSystemStatus() {
    const box = $("system-status-body");
    if (!box) return;
    box.innerHTML = '<div class="muted">กำลังตรวจสอบระบบ…</div>';
    try {
      const r = await rpc("systemStatus", {}, true);
      if (!box.isConnected) return;
      const c = r.counts || {}, b = r.backup || {};
      const warnings = Array.isArray(r.warnings) ? r.warnings : [];
      const warningHtml = warnings.length
        ? '<div class="warn mb-4"><b>พบจุดที่ควรตรวจสอบ</b><ul style="margin:8px 0 0 20px;list-style:disc">' +
          warnings.map(x=>'<li>'+esc(x)+'</li>').join("") + '</ul></div>'
        : '<div style="background:#ecfdf5;color:#166534;padding:12px;border-radius:12px;margin-bottom:16px"><b>ระบบหลักทำงานปกติ</b></div>';
      box.innerHTML =
        warningHtml +
        '<div class="grid gap-3 md:grid-cols-3 mb-4">' +
          '<div class="card"><div class="muted">Cloudflare D1</div><div class="mt-2">'+statusBadge(!!r.d1?.ok,"ปกติ","ผิดปกติ")+'</div><div class="muted mt-2">'+esc(r.d1?.message||"")+'</div></div>' +
          '<div class="card" id="drive-status-card"><div class="muted">Google Drive Gateway</div><div class="mt-2"><span style="display:inline-block;padding:4px 9px;border-radius:999px;background:#f1f5f9;color:#64748b;font-weight:700">กำลังตรวจแยก…</span></div><div class="muted mt-2">ไม่บล็อกการเปิดหน้าสถานะระบบ</div></div>' +
          '<div class="card"><div class="muted">Backup ล่าสุด</div><div class="mt-2"><b>'+fmtStatusDate(b.lastAt)+'</b></div><div class="muted mt-2">Auto: '+esc(b.lastAutoDay||"—")+'</div></div>' +
        '</div>' +
        '<div class="grid gap-3 md:grid-cols-2 mb-4">' +
          '<div class="card"><div class="muted">Web Push</div><div class="mt-2">'+statusBadge(!!r.push?.configured,"พร้อมใช้งาน","ยังไม่ตั้ง VAPID")+'</div><div class="muted mt-2">อุปกรณ์ที่ลงทะเบียน '+Number(r.push?.subscriptions||0)+'</div></div>' +
          '<div class="card"><div class="muted">ปีการศึกษา / ภาคเรียน</div><div class="mt-2"><b>'+Number(c.academicPeriods||0)+' ช่วง</b></div><div class="muted mt-2"><a href="#periods">จัดการภาคเรียน</a></div></div>' +
        '</div>' +
        '<div class="grid gap-3 md:grid-cols-3 mb-4">' +
          '<div class="card"><div class="muted">Error · 24 ชม.</div><div class="kpi" style="font-size:28px">'+Number(r.monitor24h?.errors||0)+'</div></div>' +
          '<div class="card"><div class="muted">Slow API · 24 ชม.</div><div class="kpi" style="font-size:28px">'+Number(r.monitor24h?.slow||0)+'</div></div>' +
          '<div class="card"><div class="muted">Security · 24 ชม.</div><div class="kpi" style="font-size:28px">'+Number(r.monitor24h?.security||0)+'</div></div>' +
        '</div>' +
        '<h3 class="text-lg font-medium mb-2">จำนวนข้อมูล</h3>' +
        table(
          ["รายการ","จำนวน"],
          [
            ["ผู้ใช้งาน",c.users||0],
            ["ห้องเรียน",c.classrooms||0],
            ["เขตพื้นที่",c.areas||0],
            ["งานมอบหมาย",c.assignments||0],
            ["ผลการตรวจ",c.inspections||0],
            ["ผลตรวจที่มีรูป",c.photos||0],
            ["Audit Log",c.auditLogs||0],
            ["ถังขยะ",c.recycleBin||0],
            ["System Events",c.systemEvents||0],
            ["เวรทดแทนวันนี้/ล่วงหน้า",c.dutyOverrides||0],
            ["ปีการศึกษา/ภาคเรียน",c.academicPeriods||0],
            ["Push Subscription",c.pushSubscriptions||0],
            ["Session ที่ยังใช้งาน",c.activeSessions||0]
          ].map(x=>[esc(x[0]),String(x[1])])
        ) +
        '<div class="mt-4 card">' +
          '<div><b>Server time:</b> '+fmtStatusDate(r.serverTime)+'</div>' +
          '<div class="mt-1"><b>Restore ล่าสุด:</b> '+fmtStatusDate(b.lastRestoreAt)+'</div>' +
          '<div class="mt-1"><b>ผลตรวจที่อัปเดตล่าสุด:</b> '+fmtStatusDate(r.lastInspection?.updatedAt)+'</div>' +
          '<div class="mt-1"><b>Audit ล่าสุด:</b> '+fmtStatusDate(r.lastAudit?.timestamp)+' '+esc(r.lastAudit?.actorName||"")+'</div>' +
        '</div>' +
        '<div class="flex gap-2 mt-4"><button class="btn" id="status-refresh">↻ ตรวจสอบอีกครั้ง</button><button class="btn secondary" id="status-backup-now">☁ Backup ตอนนี้</button></div>';
      refreshDriveStatusCard().catch(()=>{});
      $("status-refresh").onclick = refreshSystemStatus;
      $("status-backup-now").onclick = async () => {
        await backupToDriveNow();
        if ($("system-status-body")) await refreshSystemStatus();
      };
    } catch(e) {
      box.innerHTML = '<div class="warn"><b>ตรวจสอบสถานะไม่สำเร็จ</b><br>'+esc(e.message||String(e))+'</div><button class="btn mt-3" id="status-retry">ลองใหม่</button>';
      if ($("status-retry")) $("status-retry").onclick = refreshSystemStatus;
    }
  }
