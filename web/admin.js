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
    reportData = null;
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
      '<button class="btn secondary admin-tab" data-tab="Assignments">มอบหมายงาน</button><button class="btn secondary" id="holiday-btn">วันหยุดโรงเรียน</button><button class="btn secondary" id="audit-btn">ประวัติการเปลี่ยนแปลง</button><button class="btn secondary" id="backup-btn">สำรองและกู้คืน</button><button class="btn secondary" id="status-btn">สถานะระบบ</button></div><section class="card" id="admin-content"></section>';
    document.querySelectorAll(".admin-tab").forEach(
      (b) =>
        (b.onclick = () => {
          adminTab = b.dataset.tab;
          adminContent();
        }),
    );
    $("holiday-btn").onclick = holidayModal;
    $("audit-btn").onclick = auditModal;
    $("backup-btn").onclick = backupCenterModal;
    $("status-btn").onclick = systemStatusModal;
    adminContent();
  }
  function adminContent() {
    if (adminTab === "Assignments") {
      assignmentContent();
      return;
    }
    const t = adminTables[adminTab],
      key = adminTab === "Users" ? "UserID" : adminTab === "Classrooms" ? "ClassroomID" : "AreaID";
    $("admin-content").innerHTML =
      '<div class="flex justify-between mb-4"><h2 class="text-lg">' +
      t.name +
      '</h2><div class="flex flex-wrap gap-2">' +
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
                '">QR</button> '
              : "") +
            '<button class="btn small danger delete-row" data-id="' +
            esc(r[key]) +
            '">ลบ</button>',
        ]),
      );
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
    win.document.write('<!doctype html><meta charset="utf-8"><title>กำลังเตรียม QR…</title><p style="font-family:sans-serif;padding:24px">กำลังเตรียม QR Code…</p>');
    busy(true, "กำลังเตรียม QR Code สำหรับพิมพ์…");
    try {
      const rawRows = prefetched || (await rpc("qrAdmin", {}, true));
      const rows = rawRows.map((q) => q.url ? q : withQrUrl(q));
      if (!rows.length) throw Error("ยังไม่มีเขตพื้นที่");
      const cards = rows.map((q) => ({ ...q, image: makeQrDataUrl(q.url, 360) }));
      const html =
        '<!doctype html><html lang="th"><head><meta charset="utf-8"><title>QR จุดตรวจ RSD Clean</title><style>' +
        '@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,"Noto Sans Thai",sans-serif;color:#17324a;margin:0}.toolbar{position:sticky;top:0;background:white;padding:8px 0 14px;border-bottom:1px solid #ddd;margin-bottom:12px}.toolbar button{font:inherit;padding:9px 16px;border:0;border-radius:9px;background:#0891b2;color:white;cursor:pointer}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10mm}.card{border:1.5px solid #cde8ec;border-radius:16px;padding:10mm;text-align:center;break-inside:avoid;min-height:122mm;display:flex;flex-direction:column;align-items:center;justify-content:center}.brand{font-weight:700;color:#087e96;font-size:18px}.area{font-weight:700;font-size:22px;margin:10px 0 3px}.class{font-size:15px;color:#567}.hint{font-size:13px;color:#456;margin-top:9px}.qr{width:68mm;height:68mm;object-fit:contain}.code{font-size:10px;color:#9aa;margin-top:7px}@media print{.toolbar{display:none}.grid{gap:8mm}.card{min-height:125mm}}@media(max-width:700px){.grid{grid-template-columns:1fr}}' +
        '</style></head><body><div class="toolbar"><button onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button></div><div class="grid">' +
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
      title: "ยืนยันการลบ?",
      text: "ประวัติผลตรวจที่บันทึกไว้จะยังคงอยู่",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "ลบรายการ",
      cancelButtonText: "ยกเลิก",
    });
    if (!confirm.isConfirmed) return;
    try {
      await rpc("deleteMaster", { table: tableName, id });
      toast("ลบแล้ว");
      await route();
    } catch (e) {
      error(e);
    }
  }
  const dutyDayOptions = [
    [1, "จันทร์", "จ."], [2, "อังคาร", "อ."], [3, "พุธ", "พ."], [4, "พฤหัสบดี", "พฤ."], [5, "ศุกร์", "ศ."],
  ];
  function dutyDaysArray(value) {
    const raw = String(value || "").trim();
    if (!raw) return [1, 2, 3, 4, 5];
    return [...new Set(raw.split(/[^1-5]+/).filter(Boolean).map(Number))].sort();
  }
  function dutyDaysLabel(value) {
    const days = dutyDaysArray(value);
    if (days.length === 5) return "จันทร์–ศุกร์";
    return days.map((n) => dutyDayOptions.find((d) => d[0] === n)?.[2] || n).join(" ");
  }
  function assignmentContent() {
    const m = S.master,
      inspectors = m.Users.filter((u) => u.Role === "Inspector");
    const dayChecks = dutyDayOptions
      .map(([n, full]) =>
        '<label class="duty-check"><input type="checkbox" name="day" value="' + n + '" checked> ' + full + '</label>',
      )
      .join("");
    const inspectorChecks = inspectors.length
      ? inspectors
          .map((u) =>
            '<label class="rounded-xl border p-3"><input type="checkbox" name="user" value="' +
            esc(u.UserID) + '"> ' + esc(u.FullName) + '</label>',
          )
          .join("")
      : '<p class="muted">ยังไม่มีบัญชีผู้ตรวจ</p>';
    const areaChecks = m.Areas.length
      ? m.Areas
          .map((a) =>
            '<label class="rounded-xl border p-3"><input type="checkbox" name="area" value="' +
            esc(a.AreaID) + '"> ' + esc(a.AreaName) + ' <small class="muted">' +
            esc(masterLabel("ResponsibleClassroomID", a.ResponsibleClassroomID)) + '</small></label>',
          )
          .join("")
      : '<p class="muted">ยังไม่มีเขตพื้นที่</p>';

    const rows = [...m.Assignments]
      .sort((a, b) => {
        const aa = m.Areas.find((x) => x.AreaID === a.AreaID)?.AreaName || "";
        const bb = m.Areas.find((x) => x.AreaID === b.AreaID)?.AreaName || "";
        return aa.localeCompare(bb, "th") || dutyDaysLabel(a.Days).localeCompare(dutyDaysLabel(b.Days), "th");
      })
      .map((a) => [
        esc(m.Users.find((u) => u.UserID === a.UserID)?.FullName || "—"),
        esc(m.Areas.find((x) => x.AreaID === a.AreaID)?.AreaName || "—"),
        '<span class="pill gray">' + esc(dutyDaysLabel(a.Days)) + '</span>',
        '<button class="btn small secondary edit-duty" data-id="' + esc(a.AssignmentID) + '">แก้วัน</button> ' +
          '<button class="btn small danger unassign" data-id="' + esc(a.AssignmentID) + '">ยกเลิกเวร</button>',
      ]);

    $("admin-content").innerHTML =
      '<div class="flex flex-wrap items-start justify-between gap-3 mb-3"><div><h2 class="text-lg">ตั้งเวรผู้ตรวจสภานักเรียน</h2>' +
      '<p class="muted mt-1">พื้นที่เดียวมีผู้ตรวจได้หลายคน และผู้ตรวจหนึ่งคนรับผิดชอบได้หลายพื้นที่ เลือกวันเข้าเวรได้ จันทร์–ศุกร์</p></div></div>' +
      '<div class="notice-duty mb-5"><b>หลักการ:</b> หากวันเดียวกันมีผู้ตรวจหลายคนในพื้นที่เดียวกัน ทุกคนจะเห็นงานเดียวกัน แต่พื้นที่นั้นมีผลตรวจเพียง 1 ผลต่อวัน ผู้ตรวจคนใดคนหนึ่งบันทึกแล้ว สมาชิกทีมคนอื่นจะเห็นผลเดียวกัน</div>' +
      '<form id="assign-form"><div class="field"><label>1) เลือกวันเข้าเวร</label><div class="duty-days">' + dayChecks + '</div></div>' +
      '<div class="field"><label>2) เลือกผู้ตรวจ (เลือกได้หลายคน)</label><div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-60 overflow-auto p-1">' + inspectorChecks + '</div></div>' +
      '<div class="field"><label>3) เลือกพื้นที่ (เลือกได้หลายพื้นที่)</label><div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-72 overflow-auto p-1">' + areaChecks + '</div></div>' +
      '<button class="btn" ' + (!inspectors.length || !m.Areas.length ? 'disabled' : '') + '>เพิ่ม / รวมเวรที่เลือก</button></form>' +
      '<div class="flex flex-wrap items-center justify-between gap-2 mt-8 mb-3"><h2 class="text-lg">ตารางเวรปัจจุบัน</h2><span class="muted">ทั้งหมด ' + rows.length + ' รายการ</span></div>' +
      table(["ผู้ตรวจ", "พื้นที่", "วันเข้าเวร", "จัดการ"], rows);

    $("assign-form").onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target), userIds = f.getAll("user"), areaIds = f.getAll("area"), days = f.getAll("day");
      if (!days.length) return error(new Error("เลือกวันเข้าเวรอย่างน้อย 1 วัน"));
      if (!userIds.length) return error(new Error("เลือกผู้ตรวจอย่างน้อย 1 คน"));
      if (!areaIds.length) return error(new Error("เลือกพื้นที่อย่างน้อย 1 พื้นที่"));
      try {
        const result = await rpc("assign", { userIds, areaIds, days });
        toast("บันทึกเวรแล้ว");
        await route();
      } catch (e) { error(e); }
    };
    document.querySelectorAll(".unassign").forEach((b) => (b.onclick = () => deleteRow("Assignments", b.dataset.id)));
    document.querySelectorAll(".edit-duty").forEach((b) => {
      b.onclick = () => editDutyDays(m.Assignments.find((x) => x.AssignmentID === b.dataset.id));
    });
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
  async function renderReports(seq) {
    const today = thaiDay();
    $("app").innerHTML =
      heading("รายงานและเกียรติบัตร", "วิเคราะห์ผลการดูแลพื้นที่และติดตามประสิทธิภาพการตรวจ") +
      '<form id="report-filter" class="card flex flex-wrap items-end gap-4 mb-6"><div class="field m-0"><label>ตั้งแต่วันที่</label><input type="date" name="start" value="' +
      today.slice(0, 8) +
      '01" required></div><div class="field m-0"><label>ถึงวันที่</label><input type="date" name="end" value="' +
      today +
      '" max="' +
      today +
      '" required></div><button class="btn">แสดงรายงาน</button></form><div id="report-content"></div>';
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
        ["inspector01", "", "ชื่อผู้ตรวจ", "Inspector", ""],
        ["teacher01", "", "ชื่อครูประจำชั้น", "Teacher", "ม.1/1"],
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
    const names=["users","classrooms","areas","assignments","inspections","inspection_inspectors","rewards_log","holidays","settings","audit_log"];
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
      '<div id="system-status-body"><div class="muted">กำลังตรวจสอบ D1, Drive Gateway และ Backup…</div></div>'
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
          '<div class="card"><div class="muted">Google Drive Gateway</div><div class="mt-2">'+statusBadge(!!r.drive?.ok,"เชื่อมต่อแล้ว","มีปัญหา")+'</div><div class="muted mt-2">'+esc(r.drive?.message||"")+'</div></div>' +
          '<div class="card"><div class="muted">Backup ล่าสุด</div><div class="mt-2"><b>'+fmtStatusDate(b.lastAt)+'</b></div><div class="muted mt-2">Auto: '+esc(b.lastAutoDay||"—")+'</div></div>' +
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
