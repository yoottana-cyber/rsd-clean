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
    polling: false,
    scanToken: initialScanToken,
    scanHandled: false,
  };
  if (initialScanToken) savePendingQr(initialScanToken);
  const $ = (id) => document.getElementById(id);
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
      if (!res.ok) throw Error("API HTTP " + res.status);
      const r = await res.json();
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
      toast: true,
      position: "top-end",
      icon: "success",
      title: text,
      showConfirmButton: false,
      timer: 2500,
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
      esc(text || { 3: "ยอดเยี่ยม", 2: "ปานกลาง", 1: "ปรับปรุง" }[score] || "รอตรวจ") +
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
    } catch (e) {}
  }
  const pages = {
    dashboard: { title: "ภาพรวม", icon: "layout-dashboard", roles: ["Admin", "Supervisor", "Inspector"] },
    tasks: { title: "งานตรวจวันนี้", icon: "clipboard-check", roles: ["Inspector"] },
    teacher: { title: "ห้องเรียนของฉัน", icon: "school", roles: ["Teacher"] },
    admin: { title: "จัดการข้อมูล", icon: "settings-2", roles: ["Admin"] },
    reports: { title: "รายงาน", icon: "chart-no-axes-column-increasing", roles: ["Admin", "Supervisor"] },
  };
  function nav() {
    const keys = S.user
      ? Object.keys(pages).filter((k) => pages[k].roles.includes(S.user.Role))
      : ["dashboard"];
    $("nav").innerHTML = keys
      .map(
        (k) =>
          '<a class="nav-link ' +
          (S.route === k ? "active" : "") +
          '" href="#' + k + '" aria-label="' + esc(pages[k].title) + '">' +
          '<i data-lucide="' + pages[k].icon + '"></i><span>' + esc(pages[k].title) + "</span></a>",
      )
      .join("");
    const install = !isStandaloneApp()
      ? '<button class="btn small secondary install-btn" type="button" aria-label="ติดตั้งแอป"><i data-lucide="download"></i><span class="account-label">ติดตั้ง</span></button>'
      : "";
    $("account").innerHTML = S.user
      ? '<div class="account-user"><span class="account-name">' + esc(S.user.FullName) + '</span>' +
        install +
        '<button class="btn small secondary" id="change-pass" type="button" aria-label="เปลี่ยนรหัสผ่าน"><i data-lucide="key-round"></i><span class="account-label">รหัสผ่าน</span></button>' +
        '<button class="btn small secondary" id="logout" type="button" aria-label="ออกจากระบบ"><i data-lucide="log-out"></i><span class="account-label">ออก</span></button></div>'
      : install + '<a class="btn small" href="#login"><i data-lucide="log-in"></i><span class="account-label">เข้าสู่ระบบ</span></a>';
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
  }
  async function route() {
    const seq = ++S.seq;
    S.charts.forEach((c) => c.destroy());
    S.charts = [];
    if (!S.scanToken) S.scanToken = getPendingQr();
    let p = (location.hash.slice(1).split("?")[0] || "dashboard");
    if (S.user && p === "login") p = S.user.Role === "Teacher" ? "teacher" : "dashboard";
    if (S.user && p === "dashboard" && S.user.Role === "Teacher") p = "teacher";
    if (S.user && S.scanToken && S.user.Role === "Inspector") p = "tasks";
    if (!S.user && p !== "dashboard") p = "login";
    if (S.user && pages[p] && !pages[p].roles.includes(S.user.Role))
      p = S.user.Role === "Teacher" ? "teacher" : "dashboard";
    if (!pages[p] && p !== "login") p = "dashboard";
    S.route = p;
    nav();
    $("nav").classList.remove("open");
    try {
      if (p === "login") renderLogin();
      else if (p === "dashboard") await renderDashboard(seq);
      else if (p === "admin") await renderAdmin(seq);
      else if (p === "reports") await renderReports(seq);
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
          r = await rpc("login", { username, proof, remember }, true);
        S.token = r.token;
        S.user = r.user;
        storeSession(r.token, remember);
        if (remember && navigator.storage?.persist) navigator.storage.persist().catch(() => {});
        S.scanToken = getPendingQr();
        S.scanHandled = false;
        location.hash =
          S.user.Role === "Teacher"
            ? "teacher"
            : S.user.Role === "Inspector"
              ? "tasks"
              : "dashboard";
        await route();
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
  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);

  window.addEventListener("DOMContentLoaded", async () => {
    updateNetworkStatus();
    wireInstallButtons();
    if (S.token) {
      try {
        const b = await rpc("bootstrap");
        S.user = b.user;
      } catch (e) {
        clearSession();
      }
    }
    route();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        reg.update().catch(() => {});
      } catch (e) {}
    });
  }
