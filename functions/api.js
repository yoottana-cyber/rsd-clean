const TZ = "Asia/Bangkok";
const SESSION_MS = 8 * 3600000;
const REMEMBER_SESSION_MS = 90 * 24 * 3600000;
const MAX_IMAGE = 100 * 1024 * 1024;
const MAX_CERT_TEMPLATE = 8 * 1024 * 1024;
const ITERATIONS = 600000;
const ROLES = ["Admin", "Supervisor", "Inspector", "Teacher"];
const enc = new TextEncoder();
const DEFAULT_APP_SETTINGS = {
  schoolName:"โรงเรียนรัษฎา",
  schoolLogoUrl:"/school-logo",
  reportFooter:"ข้อมูลจากระบบ RSD Clean",
  scoreLabels:{"1":"ปรับปรุง","2":"ปานกลาง","3":"ยอดเยี่ยม"},
  inspectionStart:"07:30",
  inspectionEnd:"16:30",
  approvalEnabled:false,
  offlineEnabled:true,
  photoEvidenceEnabled:false,
  recycleDays:30,
  certificateSilverMax:3,
  certificateBronzeMax:5,
  skipReasons:["ผู้ตรวจลา","กิจกรรมโรงเรียน","ฝนตก/สภาพอากาศ","พื้นที่ปิด/เข้าไม่ได้","เหตุจำเป็นอื่น"]
};
let sessionMetaReady = false;
let autoBackupCheckedDay = "";
let systemEventsReady = false;
let auditReady = false;
let recycleReady = false;
let dutyOverridesReady = false;
let academicPeriodsReady = false;
let pushSubscriptionsReady = false;
let areaMapReady = false;
let systemEventsCleanupDay = "";
const rateBuckets = new Map();
const rateEventLast = new Map();
const notificationCache = new Map();
let appSettingsCache = { value:null, at:0 };
let driveHealthCache = { value:null, at:0 };
let rateSweepAt = 0;

function clientAddress(request){
  return String(
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0] ||
    "unknown"
  ).trim().slice(0,80);
}
function rateError(message="คำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่"){
  const e=Error(message);e.httpStatus=429;e.rateLimited=true;return e;
}
function consumeRateBucket(key,limit,windowMs){
  const now=Date.now();
  if(now-rateSweepAt>60000){
    rateSweepAt=now;
    for(const [k,v] of rateBuckets){if(Number(v.resetAt||0)<=now)rateBuckets.delete(k);}
    if(rateBuckets.size>5000){
      const extra=rateBuckets.size-4000;
      let n=0;for(const k of rateBuckets.keys()){rateBuckets.delete(k);if(++n>=extra)break;}
    }
  }
  let b=rateBuckets.get(key);
  if(!b||b.resetAt<=now)b={count:0,resetAt:now+windowMs};
  b.count++;
  rateBuckets.set(key,b);
  if(b.count>limit)throw rateError();
}
function enforceRateLimit(request,action,payload,token){
  const ip=clientAddress(request),username=String(payload?.username||"").trim().toLowerCase().slice(0,80);
  if(action==="login"){
    consumeRateBucket("login:user:"+ip+":"+username,8,5*60000);
    consumeRateBucket("login:ip:"+ip,120,5*60000);
    return;
  }
  if(action==="challenge"){
    consumeRateBucket("challenge:user:"+ip+":"+username,30,5*60000);
    consumeRateBucket("challenge:ip:"+ip,240,5*60000);
    return;
  }
  if(action==="publicDashboard"){
    consumeRateBucket("public:"+ip,90,60000);
    return;
  }
  if(token){
    consumeRateBucket("auth:"+String(token).slice(-28),180,60000);
    return;
  }
  consumeRateBucket("anon:"+ip,60,60000);
}
function shouldLogRateEvent(request,action){
  const key=clientAddress(request)+"|"+String(action||"unknown");
  const now=Date.now(),last=Number(rateEventLast.get(key)||0);
  if(now-last<60000)return false;
  rateEventLast.set(key,now);
  if(rateEventLast.size>2000){
    for(const [k,v] of rateEventLast){if(now-Number(v)>5*60000)rateEventLast.delete(k);}
  }
  return true;
}
function expectedClientError(message){
  return /SESSION_EXPIRED|ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง|วันที่ไม่ถูกต้อง|ช่วงวันที่ไม่ถูกต้อง|ไม่มีสิทธิ์|ไม่พบรายการ|ไม่พบ API|ไม่ถูกต้อง|ต้องยืนยัน|กรุณา|เลือก|ซ้ำ|ว่าง|หมดอายุ|ไม่ได้อยู่ในงาน|แก้ไขได้เฉพาะงานวันนี้|ข้อมูลถูกเปลี่ยนแล้ว|คำขอใหญ่เกินไป|รองรับ JPG|รูปภาพต้องไม่เกิน/i.test(String(message||""));
}
function background(context,promise){
  if(typeof context.waitUntil==="function")context.waitUntil(Promise.resolve(promise).catch(()=>{}));
}
export async function onRequest(context) {
  const { request, env } = context;
  const started=Date.now();
  let action="",payload={},token="";
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, headers);
  if (!env.DB) return jsonResponse({ ok: false, error: "ยังไม่ได้ผูก D1 binding ชื่อ DB" }, 500, headers);
  if (!env.RSD_PEPPER) return jsonResponse({ ok: false, error: "ยังไม่ได้ตั้งค่า RSD_PEPPER" }, 500, headers);
  try {
    const input = await request.json();
    action = String(input?.action || "");
    payload = input?.payload || {};
    token = String(input?.token || "");
    const payloadSize = JSON.stringify(payload).length;
    const maxPayload = action === "restoreBackup" ? 20 * 1024 * 1024 : 100000;
    if (payloadSize > maxPayload) throw Error(action === "restoreBackup" ? "ไฟล์ Backup ใหญ่เกิน 20 MB" : "คำขอใหญ่เกินไป");
    enforceRateLimit(request,action,payload,token);

    const data = await dispatch(env, action, payload, token, request);
    if(["saveInspection","reviewInspection","adminEditInspection","saveDutyOverride","deleteDutyOverride","setInspectionException","saveAppSettings","assign","setAssignmentDays","holidays","saveMaster","deleteMaster","restoreTrash","restoreBackup"].includes(action)) notificationCache.clear();
    if(action==="restoreBackup")appSettingsCache={value:null,at:0};
    const duration=Date.now()-started;

    if (!["challenge","login","publicDashboard"].includes(action)) {
      background(context,autoBackupIfDue(env).catch(e => console.error("AUTO_BACKUP_FAILED", e)));
    }
    if (action === "saveInspection" || action === "reviewInspection" || action === "adminEditInspection") {
      background(context,rebuildRewards(env).catch(e => console.error("REWARD_REBUILD_FAILED", e)));
    }
    if(["saveDutyOverride","reviewInspection","saveInspection"].includes(action)){
      background(context,pushAfterAction(env,action,payload,data));
    }
    if(duration>=1200 && !["systemEvents","driveStatus"].includes(action)){
      background(context,writeSystemEvent(env,{
        eventType:"slow",
        action,
        durationMs:duration,
        message:"API ใช้เวลานานกว่าค่าที่กำหนด",
        details:{thresholdMs:1200}
      },request));
    }
    return jsonResponse({ ok: true, data }, 200, {...headers,"Server-Timing":"app;dur="+duration});
  } catch (err) {
    const message=err?.message||String(err),duration=Date.now()-started;
    if(err?.rateLimited && shouldLogRateEvent(request,action)){
      background(context,writeSystemEvent(env,{
        eventType:"security",
        action:action||"unknown",
        durationMs:duration,
        message:"Rate limit exceeded",
        details:{kind:"rate_limit"}
      },request));
    }else if(!expectedClientError(message)){
      background(context,writeSystemEvent(env,{
        eventType:"error",
        action:action||"unknown",
        durationMs:duration,
        message,
        details:{name:String(err?.name||"Error")}
      },request));
    }
    return jsonResponse({ ok: false, error: message }, Number(err?.httpStatus||200), {...headers,"Server-Timing":"app;dur="+duration});
  }
}

function jsonResponse(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers });
}
function assert(ok, msg) { if (!ok) throw Error(msg); }
function text(v, max = 200) {
  const s = String(v ?? "").trim();
  assert(s.length <= max, "ข้อความยาวเกินกำหนด");
  return s;
}
function uuid() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }
function thaiDay(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function validateDate(s) {
  s = String(s || "");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(s), "วันที่ไม่ถูกต้อง");
  const d = new Date(s + "T00:00:00Z");
  assert(!Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10) === s, "วันที่ไม่ถูกต้อง");
  return s;
}
function shiftDate(s, n) {
  const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0,10);
}
function weekday(s) { return new Date(s + "T00:00:00Z").getUTCDay(); }
function dutyDays(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [1,2,3,4,5];
  const out = [...new Set(raw.split(/[^1-5]+/).filter(Boolean).map(Number))].sort();
  assert(out.length && out.every(n => n >= 1 && n <= 5), "วันเข้าเวรไม่ถูกต้อง");
  return out;
}
function dutyText(value) { return dutyDays(value).join(","); }
function parseJson(s, fallback) { try { const v = JSON.parse(s); return v == null ? fallback : v; } catch { return fallback; } }
function publicUser(u) {
  return { UserID: u.user_id, Username: u.username, FullName: u.full_name, Role: u.role, LinkedClassroomID: u.linked_classroom_id || "" };
}
function userRow(u) {
  return { UserID:u.user_id, Username:u.username, Password:u.password, FullName:u.full_name, Role:u.role, LinkedClassroomID:u.linked_classroom_id || "" };
}
function classRow(r) { return { ClassroomID:r.classroom_id, ClassName:r.class_name }; }
function areaRow(r) { return { AreaID:r.area_id, AreaName:r.area_name, ResponsibleClassroomID:r.responsible_classroom_id }; }
function assignRow(r) { return { AssignmentID:r.assignment_id, UserID:r.user_id, AreaID:r.area_id, Days:r.days || "1,2,3,4,5" }; }

async function sha256Bytes(s) { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(s)))); }
function b64url(bytes, pad = true) {
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  let s = btoa(bin).replace(/\+/g,"-").replace(/\//g,"_");
  if (!pad) s = s.replace(/=+$/g,"");
  return s;
}
async function digest(s) { return b64url(await sha256Bytes(s), true); }
async function hmac(env, s) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(env.RSD_PEPPER)), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(String(s)))), true);
}
function equalLoose(a,b) {
  a = String(a||"").replace(/=+$/g,""); b = String(b||"").replace(/=+$/g,"");
  if (a.length !== b.length) return false; let n=0; for(let i=0;i<a.length;i++) n |= a.charCodeAt(i)^b.charCodeAt(i); return n===0;
}
async function qrToken(env, areaId) { return areaId + "." + await hmac(env, "area-qr:" + areaId); }
async function qrAreaId(env, token) {
  const raw = text(token, 300), dot = raw.indexOf(".");
  assert(dot > 0 && dot === raw.lastIndexOf("."), "QR Code ไม่ถูกต้อง");
  const id = raw.slice(0,dot), sig = raw.slice(dot+1);
  assert(equalLoose(sig, await hmac(env, "area-qr:" + id)), "QR Code ไม่ถูกต้องหรือถูกแก้ไข");
  return id;
}
async function credentialJson(env, c) {
  assert(c && c.scheme === "pbkdf2" && /^[a-f0-9]{64}$/.test(c.proof) && /^[a-f0-9]{32}$/.test(c.salt), "ข้อมูลรหัสผ่านไม่ถูกต้อง");
  return JSON.stringify({ scheme:"pbkdf2", salt:c.salt, hash: await hmac(env, c.proof) });
}

async function dispatch(env, action, p, token, request) {
  const db = env.DB;
  if (action === "challenge") {
    const username = text(p.username,80).toLowerCase();
    const u = await db.prepare("SELECT password FROM users WHERE username=? COLLATE NOCASE").bind(username).first();
    const c = parseJson(u?.password, {});
    return { scheme:c.scheme || "pbkdf2", salt:c.salt || await digest(await hmac(env, username)), iterations:ITERATIONS };
  }
  if (action === "login") return login(env, p);
  if (action === "publicDashboard") return dashboard(env, null, validateDate(p.date || thaiDay()));
  const u = await auth(env, token);
  if (action === "logout") {
    await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(token)).run(); return true;
  }
  const handlers = {
    bootstrap: async () => ({ user:publicUser(u), today:thaiDay(), holidays:(await all(db,"SELECT holiday_date FROM holidays ORDER BY holiday_date")).map(x=>x.holiday_date), settings:await getAppSettings(db) }),
    myRewards: async () => { role(u,["Inspector"]); return (await all(db,"SELECT * FROM rewards_log WHERE reference_id=? ORDER BY timestamp",u.user_id)).map(rewardRow); },
    dashboard: async () => dashboard(env,u,validateDate(p.date || thaiDay())),
    executiveDashboard: async () => executiveDashboard(env,u,p),
    dailyControl: async () => dailyControl(env,u,p),
    academicPeriods: async () => academicPeriods(env,u),
    saveAcademicPeriod: async () => saveAcademicPeriod(env,u,p),
    deleteAcademicPeriod: async () => deleteAcademicPeriod(env,u,p),
    certificateData: async () => certificateData(env,u,p),
    certificateTemplate: async () => certificateTemplate(env,u),
    certificateTemplateUploadStart: async () => certificateTemplateUploadStart(env,u,p,request),
    saveCertificateTemplate: async () => saveCertificateTemplate(env,u,p),
    certificateTemplateImage: async () => certificateTemplateImage(env,u),
    deleteCertificateTemplate: async () => deleteCertificateTemplate(env,u),
    pushStatus: async () => pushStatus(env,u),
    savePushSubscription: async () => savePushSubscription(env,u,p),
    deletePushSubscription: async () => deletePushSubscription(env,u,p),
    sendPushReminder: async () => sendPushReminder(env,u,p),
    sendPushTest: async () => sendPushTest(env,u),
    appSettings: async () => appSettings(env,u),
    saveAppSettings: async () => saveAppSettings(env,u,p),
    dutyOverrides: async () => dutyOverrides(env,u,p),
    saveDutyOverride: async () => saveDutyOverride(env,u,p),
    deleteDutyOverride: async () => deleteDutyOverride(env,u,p),
    reviewQueue: async () => reviewQueue(env,u),
    reviewInspection: async () => reviewInspection(env,u,p),
    historyOptions: async () => historyOptions(env,u),
    historyData: async () => historyData(env,u,p),
    adminEditInspection: async () => adminEditInspection(env,u,p),
    exportData: async () => exportData(env,u,p),
    tasks: async () => tasks(env,u),
    inspectorHome: async () => inspectorHome(env,u),
    qrTask: async () => qrTask(env,u,p),
    teacher: async () => teacher(env,u),
    qrAdmin: async () => qrAdmin(env,u,p),
    master: async () => master(env,u),
    areaMapLayout: async () => areaMapLayout(env,u),
    saveAreaMapLayout: async () => saveAreaMapLayout(env,u,p),
    report: async () => report(env,u,validateDate(p.start),validateDate(p.end)),
    dailyReport: async () => dailyReport(env,u,validateDate(p.date || thaiDay())),
    inspectionExceptions: async () => inspectionExceptions(env,u,p),
    setInspectionException: async () => setInspectionException(env,u,p),
    saveMaster: async () => saveMaster(env,u,p),
    bulkPreview: async () => bulkPreview(env,u,p),
    bulkCreate: async () => bulkCreate(env,u,p),
    deleteMaster: async () => deleteMaster(env,u,p),
    assign: async () => assign(env,u,p),
    setAssignmentDays: async () => setAssignmentDays(env,u,p),
    removeDutyAssignments: async () => removeDutyAssignments(env,u,p),
    copyDutyAssignments: async () => copyDutyAssignments(env,u,p),
    saveInspection: async () => saveInspection(env,u,p),
    uploadStart: async () => uploadStart(env,u,p,request),
    photo: async () => photo(env,u,p),
    password: async () => password(env,u,p),
    holidays: async () => saveHolidays(env,u,p),
    auditLog: async () => auditList(env,u,p),
    backupExport: async () => backupExport(env,u),
    backupNow: async () => backupNow(env,u),
    restoreBackup: async () => restoreBackup(env,u,p),
    systemStatus: async () => systemStatus(env,u),
    driveStatus: async () => driveStatus(env,u),
    systemEvents: async () => systemEvents(env,u,p),
    clientError: async () => clientError(env,u,p,request),
    notifications: async () => notifications(env,u),
    recycleBin: async () => recycleBin(env,u),
    restoreTrash: async () => restoreTrash(env,u,p),
    purgeTrash: async () => purgeTrash(env,u,p),
    sessions: async () => listSessions(env,u),
    logoutSession: async () => logoutSession(env,u,p),
    logoutOtherSessions: async () => logoutOtherSessions(env,u),
  };
  assert(handlers[action], "ไม่พบ API");
  const result = await handlers[action]();
  if (AUDIT_ACTIONS.has(action)) {
    try { await writeAudit(env,u,action,p,result); }
    catch (e) { console.error("AUDIT_WRITE_FAILED",e); }
  }
  return result;
}

async function ensureSessionMeta(db){
  if(sessionMetaReady)return;
  const cols=(await all(db,"PRAGMA table_info(sessions)")).map(x=>String(x.name));
  const add=async(name,sql)=>{
    if(cols.includes(name))return;
    try{await db.prepare(sql).run();}catch(e){
      if(!/duplicate column/i.test(String(e?.message||e)))throw e;
    }
  };
  await add("device_id","ALTER TABLE sessions ADD COLUMN device_id TEXT NOT NULL DEFAULT ''");
  await add("device_label","ALTER TABLE sessions ADD COLUMN device_label TEXT NOT NULL DEFAULT ''");
  await add("last_seen","ALTER TABLE sessions ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0");
  sessionMetaReady=true;
}
function cleanClient(p){
  const c=p&&typeof p.client==="object"?p.client:{};
  return{
    id:text(c.id||"",120),
    label:text(c.label||"",120)
  };
}
async function listSessions(env,u){
  const db=env.DB;await ensureSessionMeta(db);
  const rows=await all(db,"SELECT token_hash,device_id,device_label,created_at,last_seen,expires_at FROM sessions WHERE user_id=? AND expires_at>? ORDER BY last_seen DESC,created_at DESC",u.user_id,Date.now());
  return rows.map(r=>({
    SessionID:String(r.token_hash),
    DeviceID:String(r.device_id||""),
    DeviceLabel:String(r.device_label||"อุปกรณ์เดิม"),
    CreatedAt:Number(r.created_at||0),
    LastSeen:Number(r.last_seen||r.created_at||0),
    ExpiresAt:Number(r.expires_at||0),
    Current:String(r.token_hash)===String(u.token_hash)
  }));
}
async function logoutSession(env,u,p){
  const db=env.DB;await ensureSessionMeta(db);
  const id=text(p.sessionId,200);assert(id,"ไม่พบ Session");
  const row=await db.prepare("SELECT token_hash,user_id FROM sessions WHERE token_hash=?").bind(id).first();
  assert(row&&String(row.user_id)===String(u.user_id),"ไม่พบอุปกรณ์นี้");
  assert(String(row.token_hash)!==String(u.token_hash),"ใช้งานปุ่มออกจากระบบสำหรับเครื่องปัจจุบัน");
  await db.prepare("DELETE FROM sessions WHERE token_hash=? AND user_id=?").bind(id,u.user_id).run();
  return true;
}
async function logoutOtherSessions(env,u){
  await env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?").bind(u.user_id,u.token_hash).run();
  return true;
}

async function login(env,p) {
  const db=env.DB, username=text(p.username,80).toLowerCase();
  await ensureSessionMeta(db);
  const u=await db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").bind(username).first();
  const c=parseJson(u?.password,{});
  assert(u && equalLoose(c.hash, await hmac(env,text(p.proof,200))), "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
  await db.prepare("DELETE FROM sessions WHERE expires_at<?").bind(Date.now()).run();
  const token=uuid()+uuid(), th=await digest(token), now=Date.now(), exp=now+(p.remember===true?REMEMBER_SESSION_MS:SESSION_MS),client=cleanClient(p);
  await db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,credential_hash,created_at,device_id,device_label,last_seen) VALUES(?,?,?,?,?,?,?,?)")
    .bind(th,u.user_id,exp,await digest(u.password),now,client.id,client.label,now).run();
  return { token, user:publicUser(u), mustChange:c.scheme === "bootstrap", settings:await getAppSettings(db) };
}
async function auth(env, token) {
  assert(token,"SESSION_EXPIRED"); const db=env.DB, th=await digest(token);
  await ensureSessionMeta(db);
  const s=await db.prepare("SELECT s.*,u.* FROM sessions s JOIN users u ON u.user_id=s.user_id WHERE s.token_hash=?").bind(th).first();
  if (!s || Number(s.expires_at)<Date.now() || !equalLoose(s.credential_hash,await digest(s.password))) {
    await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(th).run(); throw Error("SESSION_EXPIRED");
  }
  const now=Date.now(), remembered = Number(s.expires_at) - Number(s.created_at) > SESSION_MS * 2;
  const renewBefore = 30 * 24 * 3600000;
  if (remembered && Number(s.expires_at) - now < renewBefore) {
    const next = now + REMEMBER_SESSION_MS;
    await db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").bind(next,th).run();
    s.expires_at = next;
  }
  if(now-Number(s.last_seen||0)>15*60000){
    await db.prepare("UPDATE sessions SET last_seen=? WHERE token_hash=?").bind(now,th).run();
    s.last_seen=now;
  }
  return s;
}
function role(u, allowed) { assert(u && allowed.includes(u.role),"ไม่มีสิทธิ์ใช้งาน"); }
async function all(db,sql,...args) { const r=await db.prepare(sql).bind(...args).all(); return r.results || []; }

const AUDIT_ACTIONS = new Set(["saveMaster","bulkCreate","deleteMaster","assign","setAssignmentDays","removeDutyAssignments","copyDutyAssignments","saveInspection","password","holidays","backupExport","backupNow","restoreBackup","restoreTrash","purgeTrash","logoutSession","logoutOtherSessions","saveAppSettings","saveDutyOverride","deleteDutyOverride","reviewInspection","setInspectionException","saveAcademicPeriod","deleteAcademicPeriod","savePushSubscription","deletePushSubscription","sendPushReminder","sendPushTest","adminEditInspection","saveCertificateTemplate","deleteCertificateTemplate","saveAreaMapLayout"]);

async function ensureAuditTable(db){
  if(auditReady)return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS audit_log (
    audit_id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    actor_user_id TEXT NOT NULL DEFAULT '',
    actor_name TEXT NOT NULL DEFAULT '',
    actor_role TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT '',
    entity_id TEXT NOT NULL DEFAULT '',
    details_json TEXT NOT NULL DEFAULT '{}'
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_user_id,timestamp DESC)").run();
  auditReady=true;
}
function safeMasterAuditRow(row={}){
  const out={};
  ["UserID","Username","FullName","Role","LinkedClassroomID","ClassroomID","ClassName","AreaID","AreaName","ResponsibleClassroomID"]
    .forEach(k=>{if(row[k]!==undefined)out[k]=row[k];});
  return out;
}
function auditMeta(action,p,result){
  if(action==="saveMaster")return{entityType:String(p.table||""),entityId:String(p.row?.UserID||p.row?.ClassroomID||p.row?.AreaID||""),details:{row:safeMasterAuditRow(p.row)}};
  if(action==="bulkCreate")return{entityType:String(p.table||""),entityId:"",details:{table:p.table,count:Number(result?.count||0)}};
  if(action==="deleteMaster")return{entityType:String(p.table||""),entityId:String(p.id||""),details:{table:p.table}};
  if(action==="assign")return{entityType:"Assignments",entityId:"",details:{userIds:(p.userIds||[]).map(String).slice(0,100),areaIds:(p.areaIds||[]).map(String).slice(0,100),days:p.days||[],added:Number(result?.added||0),merged:Number(result?.merged||0)}};
  if(action==="setAssignmentDays")return{entityType:"Assignments",entityId:String(p.id||""),details:{days:p.days||[]}};
  if(action==="removeDutyAssignments")return{entityType:"Assignments",entityId:"bulk",details:{mode:String(p.mode||""),day:Number(p.day||0),userId:String(p.userId||""),areaIds:(p.areaIds||[]).map(String).slice(0,100),changed:Number(result?.changed||0),updated:Number(result?.updated||0),removed:Number(result?.removed||0)}};
  if(action==="copyDutyAssignments")return{entityType:"Assignments",entityId:"copy",details:{sourceDay:Number(p.sourceDay||0),targetDays:(p.targetDays||[]).map(Number).slice(0,5),sourceCount:Number(result?.sourceCount||0),updated:Number(result?.updated||0),removed:Number(result?.removed||0)}};
  if(action==="saveAreaMapLayout")return{entityType:"AreaMap",entityId:"layout",details:{shapeCount:Number(result?.saved||0)}};
  if(action==="saveInspection")return{entityType:"Inspections",entityId:String(p.id||""),details:{status:String(p.status||""),score:Number(p.score||0),photoChanged:!!p.uploadTicket||p.removePhoto===true}};
  if(action==="holidays")return{entityType:"Holidays",entityId:"",details:{count:Array.isArray(p.dates)?p.dates.length:0}};
  if(action==="password")return{entityType:"Users",entityId:"self",details:{passwordChanged:true}};
  if(action==="backupExport")return{entityType:"Backup",entityId:"download",details:{createdAt:result?.createdAt||nowIso()}};
  if(action==="backupNow")return{entityType:"Backup",entityId:String(result?.fileId||"manual-drive"),details:{createdAt:result?.createdAt||nowIso(),filename:result?.filename||""}};
  if(action==="restoreBackup")return{entityType:"Backup",entityId:"restore",details:{restoredAt:result?.restoredAt||nowIso(),sourceCreatedAt:result?.sourceCreatedAt||"",preRestoreFileId:result?.preRestoreBackup?.fileId||"",counts:result?.counts||{}}};
  if(action==="restoreTrash")return{entityType:"RecycleBin",entityId:String(p.recycleId||""),details:{restoredType:result?.entityType||"",restoredId:result?.entityId||""}};
  if(action==="purgeTrash")return{entityType:"RecycleBin",entityId:String(p.recycleId||""),details:{purged:true}};
  if(action==="logoutSession")return{entityType:"Session",entityId:String(p.sessionId||""),details:{remoteLogout:true}};
  if(action==="logoutOtherSessions")return{entityType:"Session",entityId:"others",details:{logoutOtherDevices:true}};
  if(action==="saveAppSettings")return{entityType:"Settings",entityId:"app_config_json",details:{updated:true}};
  if(action==="saveDutyOverride")return{entityType:"DutyOverride",entityId:String(result?.OverrideID||""),details:{date:String(p.date||""),areaId:String(p.areaId||""),substituteUserId:String(p.substituteUserId||"")}};
  if(action==="deleteDutyOverride")return{entityType:"DutyOverride",entityId:String(p.id||""),details:{deleted:true}};
  if(action==="reviewInspection")return{entityType:"InspectionReview",entityId:String(p.id||""),details:{decision:String(p.decision||""),note:String(p.note||"").slice(0,300)}};
  if(action==="setInspectionException")return{entityType:"InspectionException",entityId:String(p.id||""),details:{action:String(p.action||""),reason:String(p.reason||"").slice(0,120)}};
  if(action==="saveAcademicPeriod")return{entityType:"AcademicPeriod",entityId:String(result?.PeriodID||p.id||""),details:{label:String(p.label||""),active:p.isActive===true}};
  if(action==="deleteAcademicPeriod")return{entityType:"AcademicPeriod",entityId:String(p.id||""),details:{deleted:true}};
  if(action==="savePushSubscription")return{entityType:"PushSubscription",entityId:String(result?.SubscriptionID||""),details:{enabled:true}};
  if(action==="deletePushSubscription")return{entityType:"PushSubscription",entityId:String(p.id||""),details:{deleted:true}};
  if(action==="sendPushReminder")return{entityType:"Push",entityId:String(p.date||thaiDay()),details:{sent:Number(result?.sent||0),failed:Number(result?.failed||0)}};
  if(action==="sendPushTest")return{entityType:"Push",entityId:String(u?.user_id||""),details:{test:true,sent:Number(result?.sent||0)}};
  if(action==="adminEditInspection")return{
    entityType:"InspectionCorrection",
    entityId:String(p.id||""),
    details:{
      reason:String(p.reason||"").slice(0,500),
      before:result?.before||{},
      after:result?.after||{}
    }
  };
  if(action==="saveCertificateTemplate")return{entityType:"CertificateTemplate",entityId:String(result?.fileId||"settings"),details:{enabled:result?.enabled===true,templateChanged:!!p.uploadTicket}};
  if(action==="deleteCertificateTemplate")return{entityType:"CertificateTemplate",entityId:"custom",details:{deleted:true}};
  return{entityType:"",entityId:"",details:{}};
}
async function writeAudit(env,u,action,p,result){
  await ensureAuditTable(env.DB);
  const m=auditMeta(action,p,result);
  await env.DB.prepare("INSERT INTO audit_log(audit_id,timestamp,actor_user_id,actor_name,actor_role,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(uuid(),nowIso(),String(u.user_id||""),String(u.full_name||""),String(u.role||""),action,m.entityType,m.entityId,JSON.stringify(m.details||{})).run();
}
async function auditList(env,u,p){
  role(u,["Admin"]);await ensureAuditTable(env.DB);
  const limit=Math.max(1,Math.min(500,Number(p?.limit||200)));
  const rows=await all(env.DB,"SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?",limit);
  return rows.map(r=>({AuditID:r.audit_id,Timestamp:r.timestamp,ActorUserID:r.actor_user_id,ActorName:r.actor_name,ActorRole:r.actor_role,Action:r.action,EntityType:r.entity_type,EntityID:r.entity_id,Details:parseJson(r.details_json,{})}));
}
async function buildBackupBundle(env){
  await ensureAuditTable(env.DB);
  await ensureRecycleTable(env.DB);
  await ensureDutyOverridesTable(env.DB);
  await ensureAcademicPeriodsTable(env.DB);
  await ensurePushSubscriptionsTable(env.DB);
  await ensureAreaMapTable(env.DB);
  const specs=[
    ["users","SELECT * FROM users ORDER BY user_id"],
    ["classrooms","SELECT * FROM classrooms ORDER BY classroom_id"],
    ["areas","SELECT * FROM areas ORDER BY area_id"],
    ["area_map_shapes","SELECT * FROM area_map_shapes ORDER BY sort_order,shape_id"],
    ["assignments","SELECT * FROM assignments ORDER BY assignment_id"],
    ["inspections","SELECT * FROM inspections ORDER BY inspection_date,inspection_id"],
    ["inspection_inspectors","SELECT * FROM inspection_inspectors ORDER BY inspection_id,user_id"],
    ["rewards_log","SELECT * FROM rewards_log ORDER BY timestamp,log_id"],
    ["holidays","SELECT * FROM holidays ORDER BY holiday_date"],
    ["settings","SELECT * FROM settings ORDER BY key"],
    ["audit_log","SELECT * FROM audit_log ORDER BY timestamp,audit_id"],
    ["recycle_bin","SELECT * FROM recycle_bin ORDER BY deleted_at,recycle_id"],
    ["duty_overrides","SELECT * FROM duty_overrides ORDER BY override_date,override_id"],
    ["academic_periods","SELECT * FROM academic_periods ORDER BY start_date,period_id"],
    ["push_subscriptions","SELECT * FROM push_subscriptions ORDER BY user_id,subscription_id"]
  ];
  const tables={};
  for(const [name,sql] of specs)tables[name]=await all(env.DB,sql);
  return{format:"rsd-clean-d1-backup-v1",createdAt:nowIso(),tables};
}
async function backupExport(env,u){role(u,["Admin"]);return buildBackupBundle(env);}
async function backupNow(env,u){
  role(u,["Admin"]);
  assert(env.GAS_DRIVE_URL&&env.DRIVE_GATEWAY_KEY,"ยังไม่ได้ตั้งค่า Google Drive gateway");
  const bundle=await buildBackupBundle(env),content=JSON.stringify(bundle);
  assert(content.length<=20*1024*1024,"Backup ใหญ่เกิน 20 MB");
  const filename="RSD-Clean-D1-manual-"+new Date().toISOString().replace(/[:.]/g,"-")+".json";
  const saved=await gasDrive(env,"saveBackup",{filename,content});
  await env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('last_backup_at',?),('last_backup_file_id',?)")
    .bind(bundle.createdAt,String(saved.fileId||"")).run();
  return{createdAt:bundle.createdAt,fileId:String(saved.fileId||""),filename:String(saved.name||filename),url:String(saved.url||""),size:Number(saved.size||content.length)};
}
function backupArrays(b){
  assert(b&&b.format==="rsd-clean-d1-backup-v1","ไฟล์นี้ไม่ใช่ Backup ของ RSD Clean D1");
  assert(b.tables&&typeof b.tables==="object","โครงสร้าง Backup ไม่ถูกต้อง");
  const names=["users","classrooms","areas","assignments","inspections","inspection_inspectors","rewards_log","holidays","settings"];
  const t={};
  for(const name of names){assert(Array.isArray(b.tables[name]),"Backup ขาดตาราง "+name);t[name]=b.tables[name];}
  t.audit_log=Array.isArray(b.tables.audit_log)?b.tables.audit_log:[];
  t.recycle_bin=Array.isArray(b.tables.recycle_bin)?b.tables.recycle_bin:[];
  t.duty_overrides=Array.isArray(b.tables.duty_overrides)?b.tables.duty_overrides:[];
  t.academic_periods=Array.isArray(b.tables.academic_periods)?b.tables.academic_periods:[];
  t.push_subscriptions=Array.isArray(b.tables.push_subscriptions)?b.tables.push_subscriptions:[];
  t.area_map_shapes=Array.isArray(b.tables.area_map_shapes)?b.tables.area_map_shapes:[];
  return t;
}
function uniqueBackup(rows,key,label,transform=v=>String(v??"")){
  const seen=new Set();
  for(const row of rows){
    const value=transform(row?.[key]);
    assert(value,label+" มีรหัสว่าง");
    assert(!seen.has(value),label+" มีข้อมูลซ้ำ: "+value);
    seen.add(value);
  }
  return seen;
}
function validateBackupBundle(b){
  const t=backupArrays(b);
  const userIds=uniqueBackup(t.users,"user_id","users");
  uniqueBackup(t.users,"username","users username",v=>String(v??"").toLowerCase());
  const classIds=uniqueBackup(t.classrooms,"classroom_id","classrooms");
  uniqueBackup(t.classrooms,"class_name","classrooms name",v=>String(v??"").toLowerCase());
  const areaIds=uniqueBackup(t.areas,"area_id","areas");
  uniqueBackup(t.assignments,"assignment_id","assignments");
  const inspectionIds=uniqueBackup(t.inspections,"inspection_id","inspections");
  uniqueBackup(t.rewards_log,"log_id","rewards_log");
  uniqueBackup(t.holidays,"holiday_date","holidays");
  uniqueBackup(t.settings,"key","settings");
  if(t.audit_log.length)uniqueBackup(t.audit_log,"audit_id","audit_log");
  if(t.recycle_bin.length)uniqueBackup(t.recycle_bin,"recycle_id","recycle_bin");
  if(t.duty_overrides.length)uniqueBackup(t.duty_overrides,"override_id","duty_overrides");
  if(t.academic_periods.length)uniqueBackup(t.academic_periods,"period_id","academic_periods");
  if(t.push_subscriptions.length){
    uniqueBackup(t.push_subscriptions,"subscription_id","push_subscriptions");
    uniqueBackup(t.push_subscriptions,"endpoint","push_subscriptions endpoint");
  }
  const pairs=new Set();
  for(const r of t.inspection_inspectors){
    const k=String(r?.inspection_id||"")+"|"+String(r?.user_id||"");
    assert(!pairs.has(k),"inspection_inspectors มีข้อมูลซ้ำ: "+k);pairs.add(k);
  }
  assert(t.users.some(x=>String(x.role)==="Admin"),"Backup ต้องมี Admin อย่างน้อย 1 บัญชี");
  for(const r of t.users){
    assert(["Admin","Supervisor","Inspector","Teacher"].includes(String(r.role)),"พบ Role ผู้ใช้ไม่ถูกต้อง");
    if(String(r.role)==="Teacher"&&String(r.linked_classroom_id||""))assert(classIds.has(String(r.linked_classroom_id)),"Teacher อ้างอิงห้องเรียนที่ไม่มีอยู่");
  }
  for(const r of t.areas)assert(classIds.has(String(r.responsible_classroom_id)),"พื้นที่อ้างอิงห้องเรียนที่ไม่มีอยู่");
  for(const r of t.assignments){
    assert(userIds.has(String(r.user_id)),"งานมอบหมายอ้างอิงผู้ใช้ที่ไม่มีอยู่");
    assert(areaIds.has(String(r.area_id)),"งานมอบหมายอ้างอิงพื้นที่ที่ไม่มีอยู่");
  }
  for(const r of t.inspections)assert(areaIds.has(String(r.area_id)),"ผลตรวจอ้างอิงพื้นที่ที่ไม่มีอยู่");
  for(const r of t.inspection_inspectors){
    assert(inspectionIds.has(String(r.inspection_id)),"ทีมผู้ตรวจอ้างอิงผลตรวจที่ไม่มีอยู่");
    assert(userIds.has(String(r.user_id)),"ทีมผู้ตรวจอ้างอิงผู้ใช้ที่ไม่มีอยู่");
  }
  for(const r of t.duty_overrides){
    assert(areaIds.has(String(r.area_id)),"เวรทดแทนอ้างอิงพื้นที่ที่ไม่มีอยู่");
    assert(userIds.has(String(r.substitute_user_id)),"เวรทดแทนอ้างอิงผู้ตรวจทดแทนที่ไม่มีอยู่");
    if(String(r.replace_user_id||""))assert(userIds.has(String(r.replace_user_id)),"เวรทดแทนอ้างอิงผู้ตรวจเดิมที่ไม่มีอยู่");
  }
  for(const r of t.push_subscriptions)assert(userIds.has(String(r.user_id)),"Push subscription อ้างอิงผู้ใช้ที่ไม่มีอยู่");
  const mapShapeIds=new Set(),mapAreaIds=new Set();
  for(const r of t.area_map_shapes){
    const sid=String(r.shape_id||""),aid=String(r.area_id||"");
    assert(sid&&!mapShapeIds.has(sid),"ผังพื้นที่มี ShapeID ซ้ำ"); mapShapeIds.add(sid);
    assert(areaIds.has(aid),"ผังพื้นที่อ้างอิงพื้นที่ที่ไม่มีอยู่");
    assert(!mapAreaIds.has(aid),"ผังพื้นที่มีพื้นที่ซ้ำ"); mapAreaIds.add(aid);
  }
  return{tables:t,counts:Object.fromEntries(Object.entries(t).map(([k,v])=>[k,v.length]))};
}
async function runDbBatches(db,stmts,size=50){
  for(let i=0;i<stmts.length;i+=size)await db.batch(stmts.slice(i,i+size));
}
async function restoreBackup(env,u,p){
  role(u,["Admin"]);
  assert(String(p.confirm||"")==="RESTORE","ต้องยืนยันด้วยคำว่า RESTORE");
  assert(env.GAS_DRIVE_URL&&env.DRIVE_GATEWAY_KEY,"ต้องตั้งค่า Google Drive gateway ก่อนกู้คืน");
  const checked=validateBackupBundle(p.bundle),t=checked.tables,db=env.DB;
  await ensureDutyOverridesTable(db);
  await ensureAcademicPeriodsTable(db);
  await ensurePushSubscriptionsTable(db);
  await ensureAreaMapTable(db);

  // Safety snapshot: restoration is blocked if the current state cannot be backed up first.
  const before=await buildBackupBundle(env),beforeContent=JSON.stringify(before);
  assert(beforeContent.length<=20*1024*1024,"Backup ปัจจุบันใหญ่เกิน 20 MB จึงยังไม่อนุญาตให้ Restore");
  const preName="RSD-Clean-D1-before-restore-"+new Date().toISOString().replace(/[:.]/g,"-")+".json";
  const pre=await gasDrive(env,"saveBackup",{filename:preName,content:beforeContent});
  assert(pre&&pre.fileId,"สร้าง Backup ก่อน Restore ไม่สำเร็จ");

  await db.batch([
    db.prepare("DELETE FROM inspection_inspectors"),
    db.prepare("DELETE FROM inspections"),
    db.prepare("DELETE FROM assignments"),
    db.prepare("DELETE FROM rewards_log"),
    db.prepare("DELETE FROM sessions"),
    db.prepare("DELETE FROM upload_tickets"),
    db.prepare("DELETE FROM area_map_shapes"),
    db.prepare("DELETE FROM areas"),
    db.prepare("DELETE FROM users"),
    db.prepare("DELETE FROM classrooms"),
    db.prepare("DELETE FROM holidays"),
    db.prepare("DELETE FROM settings"),
    db.prepare("DELETE FROM audit_log"),
    db.prepare("DELETE FROM recycle_bin"),
    db.prepare("DELETE FROM duty_overrides"),
    db.prepare("DELETE FROM academic_periods"),
    db.prepare("DELETE FROM push_subscriptions")
  ]);

  const now=nowIso();
  await runDbBatches(db,t.classrooms.map(r=>db.prepare("INSERT INTO classrooms(classroom_id,class_name,created_at,updated_at) VALUES(?,?,?,?)")
    .bind(String(r.classroom_id),String(r.class_name),String(r.created_at||now),String(r.updated_at||now))));
  await runDbBatches(db,t.users.map(r=>db.prepare("INSERT INTO users(user_id,username,password,full_name,role,linked_classroom_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .bind(String(r.user_id),String(r.username).toLowerCase(),String(r.password),String(r.full_name),String(r.role),String(r.linked_classroom_id||""),String(r.created_at||now),String(r.updated_at||now))));
  await runDbBatches(db,t.areas.map(r=>db.prepare("INSERT INTO areas(area_id,area_name,responsible_classroom_id,created_at,updated_at) VALUES(?,?,?,?,?)")
    .bind(String(r.area_id),String(r.area_name),String(r.responsible_classroom_id),String(r.created_at||now),String(r.updated_at||now))));
  await ensureAreaMapTable(db);
  await runDbBatches(db,t.area_map_shapes.map(r=>db.prepare("INSERT INTO area_map_shapes(shape_id,area_id,shape_type,x,y,width,height,points_json,fill_color,locked,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(String(r.shape_id),String(r.area_id),String(r.shape_type||"rect"),Number(r.x||0),Number(r.y||0),Number(r.width||0),Number(r.height||0),String(r.points_json||"[]"),String(r.fill_color||"#38bdf8"),Number(r.locked||0),Number(r.sort_order||0),String(r.created_at||now),String(r.updated_at||now))));
  await runDbBatches(db,t.assignments.map(r=>db.prepare("INSERT INTO assignments(assignment_id,user_id,area_id,days,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .bind(String(r.assignment_id),String(r.user_id),String(r.area_id),String(r.days||"1,2,3,4,5"),String(r.created_at||now),String(r.updated_at||now))));
  await runDbBatches(db,t.inspections.map(r=>db.prepare(`INSERT INTO inspections(inspection_id,area_id,inspection_date,status,rating,score,note,meta_json,photo_links_json,version,completed_at,completed_by_id,completed_by_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(String(r.inspection_id),String(r.area_id),String(r.inspection_date),String(r.status||"รอตรวจ"),String(r.rating||""),Number(r.score||0),String(r.note||""),String(r.meta_json||"{}"),String(r.photo_links_json||"[]"),Number(r.version||0),String(r.completed_at||""),String(r.completed_by_id||""),String(r.completed_by_name||""),String(r.created_at||now),String(r.updated_at||now))));
  await runDbBatches(db,t.inspection_inspectors.map(r=>db.prepare("INSERT INTO inspection_inspectors(inspection_id,user_id,user_name) VALUES(?,?,?)")
    .bind(String(r.inspection_id),String(r.user_id),String(r.user_name||""))));
  await runDbBatches(db,t.rewards_log.map(r=>db.prepare("INSERT INTO rewards_log(log_id,timestamp,reference_id,achievement,details_json) VALUES(?,?,?,?,?)")
    .bind(String(r.log_id),String(r.timestamp),String(r.reference_id),String(r.achievement),String(r.details_json||"{}"))));
  await runDbBatches(db,t.holidays.map(r=>db.prepare("INSERT INTO holidays(holiday_date) VALUES(?)").bind(String(r.holiday_date))));
  await runDbBatches(db,t.settings.map(r=>db.prepare("INSERT INTO settings(key,value) VALUES(?,?)").bind(String(r.key),String(r.value??""))));
  await runDbBatches(db,t.audit_log.map(r=>db.prepare("INSERT INTO audit_log(audit_id,timestamp,actor_user_id,actor_name,actor_role,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(String(r.audit_id),String(r.timestamp),String(r.actor_user_id||""),String(r.actor_name||""),String(r.actor_role||""),String(r.action||""),String(r.entity_type||""),String(r.entity_id||""),String(r.details_json||"{}"))));
  await ensureRecycleTable(db);
  await runDbBatches(db,t.recycle_bin.map(r=>db.prepare("INSERT INTO recycle_bin(recycle_id,deleted_at,deleted_by_user_id,deleted_by_name,entity_type,entity_id,label,snapshot_json,expires_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(String(r.recycle_id),String(r.deleted_at),String(r.deleted_by_user_id||""),String(r.deleted_by_name||""),String(r.entity_type),String(r.entity_id),String(r.label||""),String(r.snapshot_json||"{}"),Number(r.expires_at||Date.now()+30*24*3600000))));
  await ensureDutyOverridesTable(db);
  await runDbBatches(db,t.duty_overrides.map(r=>db.prepare("INSERT INTO duty_overrides(override_id,override_date,area_id,replace_user_id,substitute_user_id,reason,created_by_id,created_by_name,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(String(r.override_id),String(r.override_date),String(r.area_id),String(r.replace_user_id||""),String(r.substitute_user_id),String(r.reason||""),String(r.created_by_id||""),String(r.created_by_name||""),String(r.created_at||now))));
  await ensureAcademicPeriodsTable(db);
  await runDbBatches(db,t.academic_periods.map(r=>db.prepare("INSERT INTO academic_periods(period_id,academic_year,semester,label,start_date,end_date,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(String(r.period_id),String(r.academic_year),String(r.semester),String(r.label),String(r.start_date),String(r.end_date),Number(r.is_active||0),String(r.created_at||now),String(r.updated_at||now))));
  await ensurePushSubscriptionsTable(db);
  await runDbBatches(db,t.push_subscriptions.map(r=>db.prepare("INSERT INTO push_subscriptions(subscription_id,user_id,endpoint,p256dh,auth,device_label,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(String(r.subscription_id),String(r.user_id),String(r.endpoint),String(r.p256dh||""),String(r.auth||""),String(r.device_label||""),Number(r.enabled||0),String(r.created_at||now),String(r.updated_at||now))));

  const restoredAt=nowIso();
  await db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('last_restore_at',?),('last_restore_prebackup_file_id',?),('last_auto_backup_day',?)")
    .bind(restoredAt,String(pre.fileId),thaiDay()).run();
  await invalidateToday(env);
  autoBackupCheckedDay=thaiDay();

  const adminCount=await db.prepare("SELECT COUNT(*) n FROM users WHERE role='Admin'").first();
  assert(Number(adminCount?.n||0)>0,"Restore ไม่สมบูรณ์: ไม่พบ Admin");
  return{
    restoredAt,
    sourceCreatedAt:String(p.bundle?.createdAt||""),
    counts:checked.counts,
    preRestoreBackup:{fileId:String(pre.fileId),filename:String(pre.name||preName),url:String(pre.url||"")}
  };
}
async function autoBackupIfDue(env){
  if(!env.GAS_DRIVE_URL||!env.DRIVE_GATEWAY_KEY)return;
  const day=thaiDay(),key="last_auto_backup_day";
  if(autoBackupCheckedDay===day)return;
  const current=await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(key).first();
  if(String(current?.value||"")===day){autoBackupCheckedDay=day;return;}
  const lock=await env.DB.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value<>excluded.value").bind(key,day).run();
  if(!Number(lock?.meta?.changes||0)){autoBackupCheckedDay=day;return;}
  try{
    const bundle=await buildBackupBundle(env),content=JSON.stringify(bundle),filename="RSD-Clean-D1-auto-"+day+".json";
    const saved=await gasDrive(env,"saveBackup",{filename,content});
    await env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('last_backup_at',?),('last_backup_file_id',?)")
      .bind(bundle.createdAt,String(saved.fileId||"")).run();
    await ensureAuditTable(env.DB);
    await env.DB.prepare("INSERT INTO audit_log(audit_id,timestamp,actor_user_id,actor_name,actor_role,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(uuid(),bundle.createdAt,"","ระบบ","System","backupAuto","Backup",String(saved.fileId||""),JSON.stringify({filename,size:Number(saved.size||content.length)})).run();
    autoBackupCheckedDay=day;
  }catch(e){
    autoBackupCheckedDay="";
    await env.DB.prepare("DELETE FROM settings WHERE key=? AND value=?").bind(key,day).run();
    throw e;
  }
}

async function ensureSystemEventsTable(db){
  if(systemEventsReady)return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS system_events (
    event_id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    client_hash TEXT NOT NULL DEFAULT '',
    details_json TEXT NOT NULL DEFAULT '{}'
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_system_events_timestamp ON system_events(timestamp DESC)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_system_events_type_time ON system_events(event_type,timestamp DESC)").run();
  systemEventsReady=true;
}
async function cleanSystemEvents(db){
  await ensureSystemEventsTable(db);
  const day=thaiDay();
  if(systemEventsCleanupDay===day)return;
  systemEventsCleanupDay=day;
  const cutoff=new Date(Date.now()-30*86400000).toISOString();
  await db.prepare("DELETE FROM system_events WHERE timestamp<?").bind(cutoff).run();
}
async function writeSystemEvent(env,event,request){
  try{
    const db=env.DB;await cleanSystemEvents(db);
    const ip=clientAddress(request),clientHash=ip==="unknown"?"":String(await hmac(env,"client:"+ip)).slice(0,24);
    const details=event?.details&&typeof event.details==="object"?event.details:{};
    await db.prepare("INSERT INTO system_events(event_id,timestamp,event_type,action,duration_ms,message,client_hash,details_json) VALUES(?,?,?,?,?,?,?,?)")
      .bind(
        uuid(),
        nowIso(),
        String(event?.eventType||"info").slice(0,30),
        String(event?.action||"").slice(0,80),
        Math.max(0,Number(event?.durationMs||0)),
        String(event?.message||"").slice(0,500),
        clientHash,
        JSON.stringify(details).slice(0,2000)
      ).run();
  }catch(e){console.error("SYSTEM_EVENT_LOG_FAILED",e);}
}
async function clientError(env,u,p,request){
  const message=text(p.message||"Client error",300);
  const page=text(p.page||"",80);
  await writeSystemEvent(env,{
    eventType:"error",
    action:"client"+(page?":"+page:""),
    durationMs:0,
    message,
    details:{source:"browser",role:String(u.role||"")}
  },request);
  return true;
}

async function systemEvents(env,u,p){
  role(u,["Admin"]);const db=env.DB;await cleanSystemEvents(db);
  const type=["error","slow","security"].includes(String(p.type||""))?String(p.type):"";
  const limit=Math.min(200,Math.max(10,Number(p.limit||80)));
  const since24=new Date(Date.now()-24*3600000).toISOString();
  const summary=await db.prepare(`SELECT
    SUM(CASE WHEN event_type='error' THEN 1 ELSE 0 END) errors,
    SUM(CASE WHEN event_type='slow' THEN 1 ELSE 0 END) slow,
    SUM(CASE WHEN event_type='security' THEN 1 ELSE 0 END) security,
    MAX(CASE WHEN event_type='error' THEN timestamp ELSE '' END) last_error
    FROM system_events WHERE timestamp>=?`).bind(since24).first();
  const rows=type
    ? await all(db,"SELECT event_id,timestamp,event_type,action,duration_ms,message,details_json FROM system_events WHERE event_type=? ORDER BY timestamp DESC LIMIT ?",type,limit)
    : await all(db,"SELECT event_id,timestamp,event_type,action,duration_ms,message,details_json FROM system_events ORDER BY timestamp DESC LIMIT ?",limit);
  return{
    summary:{
      errors:Number(summary?.errors||0),
      slow:Number(summary?.slow||0),
      security:Number(summary?.security||0),
      lastError:String(summary?.last_error||"")
    },
    rows:rows.map(r=>({
      EventID:r.event_id,
      Timestamp:r.timestamp,
      Type:r.event_type,
      Action:r.action,
      DurationMs:Number(r.duration_ms||0),
      Message:r.message,
      Details:parseJson(r.details_json,{})
    }))
  };
}

async function driveStatus(env,u){
  role(u,["Admin"]);
  const configured=!!(env.GAS_DRIVE_URL&&env.DRIVE_GATEWAY_KEY);
  if(!configured)return{configured:false,ok:false,message:"ยังไม่ได้ตั้งค่า Drive Gateway",cached:false};
  if(driveHealthCache.value&&Date.now()-driveHealthCache.at<60000)return{...driveHealthCache.value,cached:true};
  const timeout=()=>new Promise((_,reject)=>setTimeout(()=>reject(Error("TIMEOUT")),8000));
  let result;
  try{
    try{
      const ping=await Promise.race([gasDrive(env,"ping",{}),timeout()]);
      result={configured:true,ok:!!ping?.ok,message:"เชื่อมต่อได้",service:String(ping?.service||"RSD Clean Drive Gateway")};
    }catch(firstErr){
      if(String(firstErr?.message||firstErr).includes("ไม่พบ Drive API")){
        const res=await Promise.race([fetch(env.GAS_DRIVE_URL,{method:"GET",redirect:"follow",headers:{"Cache-Control":"no-cache"}}),timeout()]);
        const raw=await res.text();let body={};try{body=JSON.parse(raw);}catch{}
        result={configured:true,ok:res.ok&&body?.ok===true,message:res.ok?(body?.ok===true?"เชื่อมต่อได้":"Gateway ตอบกลับไม่สมบูรณ์"):"HTTP "+res.status,service:String(body?.service||"")};
      }else throw firstErr;
    }
  }catch(e){
    result={configured:true,ok:false,message:e?.message==="TIMEOUT"?"เชื่อมต่อเกิน 8 วินาที":String(e?.message||e)};
  }
  driveHealthCache={value:result,at:Date.now()};
  return{...result,cached:false};
}

async function systemStatus(env,u){
  role(u,["Admin"]);
  const db=env.DB;
  await ensureAuditTable(db);
  await ensureRecycleTable(db);
  await ensureSystemEventsTable(db);
  await ensureDutyOverridesTable(db);
  await ensureAcademicPeriodsTable(db);
  await ensurePushSubscriptionsTable(db);

  const countSpecs = [
    ["users",db.prepare("SELECT COUNT(*) n FROM users")],
    ["classrooms",db.prepare("SELECT COUNT(*) n FROM classrooms")],
    ["areas",db.prepare("SELECT COUNT(*) n FROM areas")],
    ["assignments",db.prepare("SELECT COUNT(*) n FROM assignments")],
    ["inspections",db.prepare("SELECT COUNT(*) n FROM inspections")],
    ["auditLogs",db.prepare("SELECT COUNT(*) n FROM audit_log")],
    ["activeSessions",db.prepare("SELECT COUNT(*) n FROM sessions WHERE expires_at>?").bind(Date.now())],
    ["photos",db.prepare("SELECT COUNT(*) n FROM inspections WHERE photo_links_json IS NOT NULL AND photo_links_json<>'[]'")],
    ["recycleBin",db.prepare("SELECT COUNT(*) n FROM recycle_bin WHERE expires_at>=?").bind(Date.now())],
    ["systemEvents",db.prepare("SELECT COUNT(*) n FROM system_events")],
    ["dutyOverrides",db.prepare("SELECT COUNT(*) n FROM duty_overrides WHERE override_date>=?").bind(thaiDay())],
    ["academicPeriods",db.prepare("SELECT COUNT(*) n FROM academic_periods")],
    ["pushSubscriptions",db.prepare("SELECT COUNT(*) n FROM push_subscriptions WHERE enabled=1")]
  ];
  const [countResults,settingsRows,lastInspection,lastAudit,monitor]=await Promise.all([
    db.batch(countSpecs.map(x=>x[1])),
    all(db,"SELECT key,value FROM settings WHERE key IN ('last_backup_at','last_backup_file_id','last_auto_backup_day','last_restore_at') ORDER BY key"),
    db.prepare("SELECT inspection_date,status,updated_at FROM inspections ORDER BY updated_at DESC LIMIT 1").first(),
    db.prepare("SELECT timestamp,action,actor_name FROM audit_log ORDER BY timestamp DESC LIMIT 1").first(),
    db.prepare(`SELECT
      SUM(CASE WHEN event_type='error' THEN 1 ELSE 0 END) errors,
      SUM(CASE WHEN event_type='slow' THEN 1 ELSE 0 END) slow,
      SUM(CASE WHEN event_type='security' THEN 1 ELSE 0 END) security
      FROM system_events WHERE timestamp>=?`).bind(new Date(Date.now()-24*3600000).toISOString()).first()
  ]);
  const counts={};
  countSpecs.forEach((x,idx)=>{counts[x[0]]=Number(countResults[idx]?.results?.[0]?.n||0);});
  const settings=Object.fromEntries(settingsRows.map(x=>[x.key,x.value]));

  const driveConfigured=!!(env.GAS_DRIVE_URL&&env.DRIVE_GATEWAY_KEY);
  const drive={configured:driveConfigured,ok:null,message:driveConfigured?"ตรวจแยกแบบไม่บล็อกหน้า":"ยังไม่ได้ตั้งค่า Drive Gateway"};
  const warnings=[];
  const lastBackup=String(settings.last_backup_at||"");
  if(!lastBackup){
    warnings.push("ยังไม่พบประวัติ Backup");
  }else{
    const age=Date.now()-new Date(lastBackup).getTime();
    if(!Number.isFinite(age)||age>48*3600000) warnings.push("Backup ล่าสุดเกิน 48 ชั่วโมงแล้ว");
  }
  if(counts.users===0) warnings.push("ไม่พบผู้ใช้งานในฐานข้อมูล");
  if(counts.areas>0&&counts.assignments===0) warnings.push("มีพื้นที่แล้วแต่ยังไม่มีการมอบหมายเวร");
  if(counts.academicPeriods===0) warnings.push("ยังไม่ได้กำหนดปีการศึกษา/ภาคเรียน");
  if(counts.pushSubscriptions>0&&!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_JWK)) warnings.push("มี Push Subscription แต่ยังตั้งค่า VAPID ไม่ครบ");
  if(Number(monitor?.errors||0)>0)warnings.push("พบ System Error ใน 24 ชั่วโมงล่าสุด "+Number(monitor.errors)+" รายการ");

  return{
    overall:warnings.length?"warning":"ok",
    serverTime:nowIso(),
    today:thaiDay(),
    d1:{ok:true,message:"เชื่อมต่อ D1 ได้"},
    push:{configured:!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_JWK),subscriptions:counts.pushSubscriptions||0},
    drive,
    backup:{
      lastAt:lastBackup,
      lastFileId:String(settings.last_backup_file_id||""),
      lastAutoDay:String(settings.last_auto_backup_day||""),
      lastRestoreAt:String(settings.last_restore_at||"")
    },
    counts,
    monitor24h:{errors:Number(monitor?.errors||0),slow:Number(monitor?.slow||0),security:Number(monitor?.security||0)},
    lastInspection:lastInspection?{date:lastInspection.inspection_date,status:lastInspection.status,updatedAt:lastInspection.updated_at}:null,
    lastAudit:lastAudit?{timestamp:lastAudit.timestamp,action:lastAudit.action,actorName:lastAudit.actor_name}:null,
    warnings
  };
}

async function ensureRecycleTable(db){
  if(recycleReady)return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS recycle_bin (
    recycle_id TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL,
    deleted_by_user_id TEXT NOT NULL DEFAULT '',
    deleted_by_name TEXT NOT NULL DEFAULT '',
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    snapshot_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_recycle_expires ON recycle_bin(expires_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_recycle_deleted ON recycle_bin(deleted_at DESC)").run();
  recycleReady=true;
}
async function cleanRecycle(db){
  await ensureRecycleTable(db);
  await db.prepare("DELETE FROM recycle_bin WHERE expires_at<?").bind(Date.now()).run();
}
function recycleLabel(table,row){
  if(table==="Users") return String(row?.FullName||row?.Username||row?.UserID||"ผู้ใช้งาน");
  if(table==="Classrooms") return String(row?.ClassName||row?.ClassroomID||"ห้องเรียน");
  if(table==="Areas") return String(row?.AreaName||row?.AreaID||"พื้นที่");
  if(table==="Assignments") return String(row?.AssignmentID||"งานมอบหมาย");
  return String(row?.id||"รายการ");
}
async function putRecycle(db,u,table,id,snapshot){
  await cleanRecycle(db);
  const cfg=await getAppSettings(db),deletedAt=nowIso(),expiresAt=Date.now()+Number(cfg.recycleDays||30)*24*3600000;
  await db.prepare("INSERT INTO recycle_bin(recycle_id,deleted_at,deleted_by_user_id,deleted_by_name,entity_type,entity_id,label,snapshot_json,expires_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(uuid(),deletedAt,String(u.user_id||""),String(u.full_name||""),String(table),String(id),recycleLabel(table,snapshot),JSON.stringify(snapshot),expiresAt).run();
}
async function recycleBin(env,u){
  role(u,["Admin"]); const db=env.DB; await cleanRecycle(db);
  const rows=await all(db,"SELECT recycle_id,deleted_at,deleted_by_name,entity_type,entity_id,label,expires_at FROM recycle_bin ORDER BY deleted_at DESC LIMIT 500");
  return rows.map(r=>({
    RecycleID:r.recycle_id,
    DeletedAt:r.deleted_at,
    DeletedBy:r.deleted_by_name,
    EntityType:r.entity_type,
    EntityID:r.entity_id,
    Label:r.label,
    ExpiresAt:Number(r.expires_at)
  }));
}
async function restoreTrash(env,u,p){
  role(u,["Admin"]); const db=env.DB; await cleanRecycle(db);
  const r=await db.prepare("SELECT * FROM recycle_bin WHERE recycle_id=?").bind(String(p.recycleId||"")).first();
  assert(r,"ไม่พบรายการในถังขยะ");
  const x=parseJson(r.snapshot_json,null); assert(x,"ข้อมูลในถังขยะเสียหาย");
  const type=String(r.entity_type),now=nowIso();
  if(type==="Users"){
    assert(!(await db.prepare("SELECT 1 x FROM users WHERE user_id=? OR username=? COLLATE NOCASE").bind(String(x.UserID),String(x.Username)).first()),"มีผู้ใช้หรือ Username นี้อยู่แล้ว");
    if(String(x.Role)==="Teacher"&&String(x.LinkedClassroomID||"")) assert(await db.prepare("SELECT 1 x FROM classrooms WHERE classroom_id=?").bind(String(x.LinkedClassroomID)).first(),"ห้องเรียนเดิมไม่มีอยู่แล้ว");
    await db.prepare("INSERT INTO users(user_id,username,password,full_name,role,linked_classroom_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(String(x.UserID),String(x.Username).toLowerCase(),String(x.Password),String(x.FullName),String(x.Role),String(x.LinkedClassroomID||""),now,now).run();
  }else if(type==="Classrooms"){
    assert(!(await db.prepare("SELECT 1 x FROM classrooms WHERE classroom_id=? OR class_name=?").bind(String(x.ClassroomID),String(x.ClassName)).first()),"มีห้องเรียนนี้อยู่แล้ว");
    await db.prepare("INSERT INTO classrooms(classroom_id,class_name,created_at,updated_at) VALUES(?,?,?,?)").bind(String(x.ClassroomID),String(x.ClassName),now,now).run();
  }else if(type==="Areas"){
    assert(await db.prepare("SELECT 1 x FROM classrooms WHERE classroom_id=?").bind(String(x.ResponsibleClassroomID)).first(),"ห้องรับผิดชอบเดิมไม่มีอยู่แล้ว");
    assert(!(await db.prepare("SELECT 1 x FROM areas WHERE area_id=? OR area_name=?").bind(String(x.AreaID),String(x.AreaName)).first()),"มีพื้นที่นี้อยู่แล้ว");
    await db.prepare("INSERT INTO areas(area_id,area_name,responsible_classroom_id,created_at,updated_at) VALUES(?,?,?,?,?)").bind(String(x.AreaID),String(x.AreaName),String(x.ResponsibleClassroomID),now,now).run();
  }else if(type==="Assignments"){
    assert(await db.prepare("SELECT 1 x FROM users WHERE user_id=? AND role='Inspector'").bind(String(x.UserID)).first(),"ผู้ตรวจเดิมไม่มีอยู่แล้ว");
    assert(await db.prepare("SELECT 1 x FROM areas WHERE area_id=?").bind(String(x.AreaID)).first(),"พื้นที่เดิมไม่มีอยู่แล้ว");
    assert(!(await db.prepare("SELECT 1 x FROM assignments WHERE assignment_id=? OR (user_id=? AND area_id=?)").bind(String(x.AssignmentID),String(x.UserID),String(x.AreaID)).first()),"มีงานมอบหมายนี้อยู่แล้ว");
    await db.prepare("INSERT INTO assignments(assignment_id,user_id,area_id,days,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(String(x.AssignmentID),String(x.UserID),String(x.AreaID),String(x.Days||"1,2,3,4,5"),now,now).run();
  }else throw Error("ประเภทข้อมูลในถังขยะไม่รองรับ");
  await db.prepare("DELETE FROM recycle_bin WHERE recycle_id=?").bind(r.recycle_id).run();
  await invalidateToday(env);
  if(type==="Assignments")await ensureToday(env);
  return{entityType:type,entityId:String(r.entity_id)};
}
async function purgeTrash(env,u,p){
  role(u,["Admin"]); const db=env.DB; await cleanRecycle(db);
  const id=String(p.recycleId||""); const r=await db.prepare("DELETE FROM recycle_bin WHERE recycle_id=?").bind(id).run();
  assert(Number(r.meta?.changes||0)>0,"ไม่พบรายการในถังขยะ");
  return true;
}

async function notifications(env,u,skipEnsure=false){
  const today=thaiDay(),cacheKey=String(u.role||"")+"|"+String(u.user_id||"")+"|"+today,cached=notificationCache.get(cacheKey);
  if(cached&&Date.now()-cached.at<30000)return cached.data;
  const db=env.DB,items=[],cfg=await getAppSettings(db),month=today.slice(0,7),monthStart=month+"-01",last30=shiftDate(today,-29);
  const add=(type,title,message,action="",count=0)=>items.push({type,title,message,action,count});

  if(u.role==="Inspector"){
    if(!skipEnsure)await ensureToday(env);
    await ensureDutyOverridesTable(db);
    const [row,returned,sub]=await Promise.all([
      db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN i.status IN ('ตรวจแล้ว','งดตรวจ') THEN 1 ELSE 0 END) resolved,
        SUM(CASE WHEN i.status='รอตรวจ' THEN 1 ELSE 0 END) pending
        FROM inspections i JOIN inspection_inspectors ii ON ii.inspection_id=i.inspection_id
        WHERE i.inspection_date=? AND ii.user_id=?`).bind(today,u.user_id).first(),
      db.prepare(`SELECT COUNT(*) n FROM inspections i
        JOIN inspection_inspectors ii ON ii.inspection_id=i.inspection_id
        WHERE i.inspection_date>=? AND ii.user_id=?
          AND COALESCE(json_extract(i.meta_json,'$.approvalStatus'),'')='ส่งกลับแก้ไข'`).bind(shiftDate(today,-7),u.user_id).first(),
      db.prepare("SELECT COUNT(*) n FROM duty_overrides WHERE override_date=? AND substitute_user_id=?").bind(today,u.user_id).first()
    ]);
    const total=Number(row?.total||0),resolved=Number(row?.resolved||0),pending=Number(row?.pending||0),returnedCount=Number(returned?.n||0);
    if(pending)add("warning","งานตรวจยังไม่ครบ","วันนี้เหลือ "+pending+" พื้นที่จากทั้งหมด "+total+" พื้นที่","tasks",pending);
    else if(total)add("success","งานวันนี้ครบแล้ว","จัดการครบ "+resolved+" พื้นที่แล้ว","tasks",0);
    else add("info","ไม่มีงานตรวจวันนี้","อาจเป็นวันหยุดหรือยังไม่ได้มอบหมายงาน","tasks",0);
    if(returnedCount)add("warning","มีผลตรวจถูกส่งกลับแก้ไข",returnedCount+" รายการ กรุณาตรวจสอบหมายเหตุผู้รับรอง","tasks",returnedCount);
    if(Number(sub?.n||0)>0)add("info","วันนี้มีเวรทดแทน","ได้รับมอบหมายแทน "+Number(sub.n)+" พื้นที่","tasks",0);
    const nowTime=new Intl.DateTimeFormat("en-GB",{timeZone:TZ,hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date());
    if(pending&&nowTime>=cfg.inspectionEnd)add("warning","เลยเวลาตรวจที่กำหนดแล้ว","ยังเหลือ "+pending+" พื้นที่ที่ไม่ได้ดำเนินการ","tasks",pending);
    else if(pending&&nowTime>=shiftClock(cfg.inspectionEnd,-60))add("warning","ใกล้หมดเวลาตรวจ","ยังเหลือ "+pending+" พื้นที่ก่อน "+cfg.inspectionEnd+" น.","tasks",pending);
  }else if(u.role==="Admin"||u.role==="Supervisor"){
    if(!skipEnsure)await ensureToday(env);
    const approvedSql=cfg.approvalEnabled
      ? "AND COALESCE(json_extract(meta_json,'$.approvalStatus'),'') IN ('','รับรองแล้ว')"
      : "";
    const promises=[
      db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status IN ('ตรวจแล้ว','งดตรวจ') THEN 1 ELSE 0 END) resolved,SUM(CASE WHEN status='รอตรวจ' THEN 1 ELSE 0 END) pending FROM inspections WHERE inspection_date=?").bind(today).first(),
      db.prepare(`SELECT COUNT(*) n FROM (SELECT area_id FROM inspections WHERE inspection_date>=? AND inspection_date<=? AND status='ตรวจแล้ว' AND score=1 ${approvedSql} GROUP BY area_id HAVING COUNT(*)>=3)`).bind(last30,today).first(),
      db.prepare(`SELECT COUNT(*) n FROM (SELECT COALESCE(json_extract(meta_json,'$.classId'),'') class_id FROM inspections WHERE inspection_date>=? AND inspection_date<=? AND status='ตรวจแล้ว' AND score=1 ${approvedSql} GROUP BY class_id HAVING COUNT(*)>?)`).bind(monthStart,today,Number(cfg.certificateBronzeMax||5)).first(),
      db.prepare("SELECT COUNT(*) n FROM areas a WHERE NOT EXISTS(SELECT 1 FROM assignments x WHERE x.area_id=a.area_id)").first(),
      db.prepare("SELECT value FROM settings WHERE key='last_backup_at'").first()
    ];
    if(cfg.approvalEnabled)promises.push(db.prepare("SELECT COUNT(*) n FROM inspections WHERE inspection_date>=? AND COALESCE(json_extract(meta_json,'$.approvalStatus'),'')='รอรับรอง'").bind(shiftDate(today,-30)).first());
    if(u.role==="Admin")promises.push(db.prepare("SELECT COUNT(*) n FROM recycle_bin WHERE expires_at>=?").bind(Date.now()).first());
    const rs=await Promise.all(promises);
    const row=rs[0],repeatAreas=Number(rs[1]?.n||0),risky=Number(rs[2]?.n||0),unassigned=Number(rs[3]?.n||0),last=String(rs[4]?.value||"");
    let at=5;
    const waiting=cfg.approvalEnabled?Number(rs[at++]?.n||0):0;
    const trash=u.role==="Admin"?Number(rs[at++]?.n||0):0;
    const total=Number(row?.total||0),pending=Number(row?.pending||0);
    if(pending)add("warning","มีงานตรวจค้าง","วันนี้ยังเหลือ "+pending+" งานจาก "+total+" พื้นที่","reports",pending);
    if(waiting)add("warning","มีผลตรวจรอรับรอง",waiting+" รายการรอการตรวจสอบ","review",waiting);
    if(repeatAreas)add("warning","พื้นที่ได้ปรับปรุงซ้ำ",repeatAreas+" พื้นที่มีผลปรับปรุงตั้งแต่ 3 ครั้งใน 30 วัน","history",repeatAreas);
    if(risky)add("warning","ห้องเสี่ยงไม่ได้รับเกียรติบัตร",risky+" ห้องมีผลปรับปรุงเกิน "+cfg.certificateBronzeMax+" ครั้งในเดือนนี้","reports",risky);
    if(unassigned)add("warning","พื้นที่ยังไม่มีผู้ตรวจ",unassigned+" พื้นที่ยังไม่มีการมอบหมาย","admin",unassigned);
    if(!last)add("warning","ยังไม่มี Backup","ควรสำรองข้อมูลระบบ","admin",1);
    else if(Date.now()-new Date(last).getTime()>48*3600000)add("warning","Backup เกิน 48 ชั่วโมง","ควรตรวจสอบระบบสำรองข้อมูล","admin",1);
    if(trash)add("info","มีข้อมูลในถังขยะ",trash+" รายการจะถูกลบถาวรตามระยะเวลาที่ตั้งไว้","admin",trash);
  }else if(u.role==="Teacher"){
    const approvedSql=cfg.approvalEnabled?"AND COALESCE(json_extract(meta_json,'$.approvalStatus'),'') IN ('','รับรองแล้ว')":"";
    const [thirty,monthlyRow]=await Promise.all([
      db.prepare(`SELECT COUNT(*) n FROM inspections WHERE inspection_date>=? AND status='ตรวจแล้ว' AND score=1
        AND json_extract(meta_json,'$.classId')=? ${approvedSql}`).bind(last30,u.linked_classroom_id).first(),
      db.prepare(`SELECT COUNT(*) n FROM inspections WHERE inspection_date>=? AND inspection_date<=? AND status='ตรวจแล้ว' AND score=1
        AND json_extract(meta_json,'$.classId')=? ${approvedSql}`).bind(monthStart,today,u.linked_classroom_id).first()
    ]);
    const improve=Number(thirty?.n||0),monthImprove=Number(monthlyRow?.n||0);
    if(improve)add("warning","มีผลประเมินที่ควรติดตาม","พบ "+improve+" ผลตรวจระดับปรับปรุงใน 30 วัน","teacher",improve);
    else add("success","สถานะห้องเรียน","ยังไม่พบผลระดับปรับปรุงใน 30 วันล่าสุด","teacher",0);
    if(monthImprove>cfg.certificateBronzeMax)add("warning","เกินเกณฑ์เกียรติบัตรเดือนนี้","มีผลปรับปรุง "+monthImprove+" ครั้ง","history",1);
    else if(monthImprove>=cfg.certificateSilverMax+1)add("info","ติดตามเกณฑ์เกียรติบัตร","เดือนนี้มีผลปรับปรุง "+monthImprove+" ครั้ง","history",0);
  }
  const data={items,unread:items.filter(x=>x.type==="warning").reduce((n,x)=>n+Math.max(1,Number(x.count||0)),0),updatedAt:nowIso()};
  notificationCache.set(cacheKey,{at:Date.now(),data});
  return data;
}
function shiftClock(hhmm,minutes){
  const [h,m]=String(hhmm||"00:00").split(":").map(Number),total=(h*60+m+minutes+1440)%1440;
  return String(Math.floor(total/60)).padStart(2,"0")+":"+String(total%60).padStart(2,"0");
}

async function ensureAcademicPeriodsTable(db){
  if(academicPeriodsReady)return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS academic_periods (
    period_id TEXT PRIMARY KEY,
    academic_year TEXT NOT NULL,
    semester TEXT NOT NULL,
    label TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_academic_periods_dates ON academic_periods(start_date,end_date)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_academic_periods_active ON academic_periods(is_active,start_date)").run();
  academicPeriodsReady=true;
}
async function academicPeriods(env,u){
  assert(u,"SESSION_EXPIRED");
  const db=env.DB;await ensureAcademicPeriodsTable(db);
  const rows=await all(db,"SELECT * FROM academic_periods ORDER BY start_date DESC,academic_year DESC,semester DESC");
  return rows.map(r=>({
    PeriodID:String(r.period_id),
    AcademicYear:String(r.academic_year),
    Semester:String(r.semester),
    Label:String(r.label),
    StartDate:String(r.start_date),
    EndDate:String(r.end_date),
    IsActive:Number(r.is_active||0)===1
  }));
}
async function saveAcademicPeriod(env,u,p){
  role(u,["Admin"]);const db=env.DB;await ensureAcademicPeriodsTable(db);
  const id=text(p.id||"",100)||uuid(),year=text(p.academicYear,20),semester=text(p.semester,30),label=text(p.label,120),start=validateDate(p.startDate),end=validateDate(p.endDate),active=p.isActive===true,now=nowIso();
  assert(year&&semester&&label,"กรอกข้อมูลปีการศึกษา/ภาคเรียนให้ครบ");
  assert(start<=end,"วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด");
  const overlap=await db.prepare("SELECT period_id,label FROM academic_periods WHERE period_id<>? AND start_date<=? AND end_date>=? LIMIT 1").bind(id,end,start).first();
  assert(!overlap,"ช่วงวันที่ซ้อนกับ "+String(overlap?.label||"ภาคเรียนอื่น"));
  if(active)await db.prepare("UPDATE academic_periods SET is_active=0,updated_at=? WHERE is_active=1").bind(now).run();
  await db.prepare(`INSERT INTO academic_periods(period_id,academic_year,semester,label,start_date,end_date,is_active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(period_id) DO UPDATE SET academic_year=excluded.academic_year,semester=excluded.semester,label=excluded.label,start_date=excluded.start_date,end_date=excluded.end_date,is_active=excluded.is_active,updated_at=excluded.updated_at`)
    .bind(id,year,semester,label,start,end,active?1:0,now,now).run();
  return{PeriodID:id,AcademicYear:year,Semester:semester,Label:label,StartDate:start,EndDate:end,IsActive:active};
}
async function deleteAcademicPeriod(env,u,p){
  role(u,["Admin"]);const db=env.DB;await ensureAcademicPeriodsTable(db);
  const id=text(p.id,100),row=await db.prepare("SELECT * FROM academic_periods WHERE period_id=?").bind(id).first();assert(row,"ไม่พบปีการศึกษา/ภาคเรียน");
  assert(Number(row.is_active||0)!==1,"ไม่สามารถลบภาคเรียนที่กำลังใช้งาน");
  await db.prepare("DELETE FROM academic_periods WHERE period_id=?").bind(id).run();
  return true;
}
async function activeAcademicPeriod(db){
  await ensureAcademicPeriodsTable(db);
  const active=await db.prepare("SELECT * FROM academic_periods WHERE is_active=1 ORDER BY updated_at DESC LIMIT 1").first();
  if(active)return active;
  const today=thaiDay();
  return db.prepare("SELECT * FROM academic_periods WHERE start_date<=? AND end_date>=? ORDER BY start_date DESC LIMIT 1").bind(today,today).first();
}
async function academicPeriodForDate(db,date){
  await ensureAcademicPeriodsTable(db);
  return db.prepare("SELECT * FROM academic_periods WHERE start_date<=? AND end_date>=? ORDER BY start_date DESC LIMIT 1").bind(date,date).first();
}
async function ensurePushSubscriptionsTable(db){
  if(pushSubscriptionsReady)return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    subscription_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL DEFAULT '',
    auth TEXT NOT NULL DEFAULT '',
    device_label TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id,enabled)").run();
  pushSubscriptionsReady=true;
}
function b64urlBytes(input){
  const bytes=input instanceof Uint8Array?input:new TextEncoder().encode(String(input));
  let bin="";for(const b of bytes)bin+=String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
async function vapidAuthorization(env,endpoint){
  assert(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_JWK,"ยังไม่ได้ตั้งค่า VAPID สำหรับ Web Push");
  let jwk;try{jwk=JSON.parse(env.VAPID_PRIVATE_JWK);}catch(e){throw Error("VAPID_PRIVATE_JWK ไม่ถูกต้อง");}
  const origin=new URL(endpoint).origin,header=b64urlBytes(JSON.stringify({typ:"JWT",alg:"ES256"}));
  const payload=b64urlBytes(JSON.stringify({aud:origin,exp:Math.floor(Date.now()/1000)+12*3600,sub:String(env.VAPID_SUBJECT||"https://rsd-clean.pages.dev")}));
  const unsigned=header+"."+payload,key=await crypto.subtle.importKey("jwk",jwk,{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const sig=new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},key,new TextEncoder().encode(unsigned)));
  return "vapid t="+unsigned+"."+b64urlBytes(sig)+", k="+String(env.VAPID_PUBLIC_KEY);
}
async function sendEmptyPush(env,row){
  try{
    const auth=await vapidAuthorization(env,row.endpoint);
    const res=await fetch(row.endpoint,{method:"POST",headers:{TTL:"300",Urgency:"normal",Authorization:auth}});
    if(res.status===404||res.status===410)return{ok:false,gone:true,status:res.status};
    if(!res.ok)return{ok:false,status:res.status};
    return{ok:true,status:res.status};
  }catch(e){return{ok:false,error:String(e?.message||e)};}
}
async function sendPushToUsers(env,userIds){
  const db=env.DB;await ensurePushSubscriptionsTable(db);
  if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_JWK)return{configured:false,sent:0,failed:0,targets:0};
  const ids=[...new Set((userIds||[]).map(String).filter(Boolean))];
  if(!ids.length)return{configured:true,sent:0,failed:0,targets:0};
  const placeholders=ids.map(()=>"?").join(","),rows=await all(db,`SELECT * FROM push_subscriptions WHERE enabled=1 AND user_id IN (${placeholders})`,...ids);
  let sent=0,failed=0;const gone=[];
  const results=await Promise.all(rows.map(r=>sendEmptyPush(env,r)));
  results.forEach((r,i)=>{if(r.ok)sent++;else{failed++;if(r.gone)gone.push(rows[i].subscription_id);}});
  if(gone.length){
    const q=gone.map(()=>"?").join(",");
    await db.prepare(`DELETE FROM push_subscriptions WHERE subscription_id IN (${q})`).bind(...gone).run();
  }
  return{configured:true,sent,failed,targets:rows.length};
}
async function sendPushReminder(env,u,p){
  role(u,["Admin","Supervisor"]);const db=env.DB,date=validateDate(p.date||thaiDay());
  assert(date===thaiDay(),"Push เตือนงานค้างรองรับเฉพาะวันนี้");
  const lockKey="last_push_reminder_at",lastRow=await db.prepare("SELECT value FROM settings WHERE key=?").bind(lockKey).first(),lastMs=new Date(String(lastRow?.value||"")).getTime();
  assert(!Number.isFinite(lastMs)||Date.now()-lastMs>=120000,"เพิ่งส่ง Push เตือนไป กรุณารอประมาณ 2 นาที");
  await ensureToday(env);
  const ids=(await all(db,`SELECT DISTINCT ii.user_id FROM inspection_inspectors ii
    JOIN inspections i ON i.inspection_id=ii.inspection_id
    WHERE i.inspection_date=? AND i.status='รอตรวจ'`,date)).map(x=>x.user_id);
  const result=await sendPushToUsers(env,ids);
  assert(result.configured,"ยังไม่ได้ตั้งค่า VAPID สำหรับ Web Push");
  if(result.sent>0)await db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)").bind(lockKey,nowIso()).run();
  return{...result,inspectors:ids.length};
}
async function sendPushTest(env,u){
  const result=await sendPushToUsers(env,[u.user_id]);
  assert(result.configured,"ยังไม่ได้ตั้งค่า VAPID สำหรับ Web Push");
  assert(result.targets>0,"อุปกรณ์นี้ยังไม่ได้ลงทะเบียน Push Notification");
  return result;
}
async function pushAfterAction(env,action,p,data){
  try{
    if(action==="saveDutyOverride"&&data?.SubstituteUserID)return sendPushToUsers(env,[data.SubstituteUserID]);
    if(action==="reviewInspection"&&String(p?.decision||"")==="return"){
      const rows=await all(env.DB,"SELECT user_id FROM inspection_inspectors WHERE inspection_id=?",String(p.id||""));
      return sendPushToUsers(env,rows.map(x=>x.user_id));
    }
    if(action==="saveInspection"&&String(p?.status||"")==="ตรวจแล้ว"&&Number(p?.score||0)===1){
      const ids=(await all(env.DB,"SELECT user_id FROM users WHERE role IN ('Admin','Supervisor')")).map(x=>x.user_id);
      return sendPushToUsers(env,ids);
    }
  }catch(e){console.error("PUSH_AFTER_ACTION_FAILED",e);}
}

async function pushStatus(env,u){
  const db=env.DB;await ensurePushSubscriptionsTable(db);
  const rows=await all(db,"SELECT subscription_id,device_label,enabled,created_at,updated_at FROM push_subscriptions WHERE user_id=? ORDER BY updated_at DESC",u.user_id);
  return{
    configured:!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_JWK),
    publicKey:String(env.VAPID_PUBLIC_KEY||""),
    subscriptions:rows.map(r=>({SubscriptionID:r.subscription_id,DeviceLabel:r.device_label,Enabled:Number(r.enabled||0)===1,CreatedAt:r.created_at,UpdatedAt:r.updated_at}))
  };
}
async function savePushSubscription(env,u,p){
  const db=env.DB;await ensurePushSubscriptionsTable(db);
  const sub=p.subscription&&typeof p.subscription==="object"?p.subscription:{},endpoint=text(sub.endpoint,2000),keys=sub.keys&&typeof sub.keys==="object"?sub.keys:{},p256dh=text(keys.p256dh||"",1000),auth=text(keys.auth||"",500),device=text(p.deviceLabel||"",120),now=nowIso();
  assert(endpoint&&p256dh&&auth,"ข้อมูล Push Subscription ไม่ครบ");
  const old=await db.prepare("SELECT subscription_id FROM push_subscriptions WHERE endpoint=?").bind(endpoint).first(),id=old?.subscription_id||uuid();
  await db.prepare(`INSERT INTO push_subscriptions(subscription_id,user_id,endpoint,p256dh,auth,device_label,enabled,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,device_label=excluded.device_label,enabled=1,updated_at=excluded.updated_at`)
    .bind(id,u.user_id,endpoint,p256dh,auth,device,1,now,now).run();
  return{SubscriptionID:id};
}
async function deletePushSubscription(env,u,p){
  const db=env.DB;await ensurePushSubscriptionsTable(db);
  const id=text(p.id||"",120),endpoint=text(p.endpoint||"",2000);
  if(id)await db.prepare("DELETE FROM push_subscriptions WHERE subscription_id=? AND user_id=?").bind(id,u.user_id).run();
  else if(endpoint)await db.prepare("DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?").bind(endpoint,u.user_id).run();
  else throw Error("ไม่พบ Push Subscription");
  return true;
}
async function dailyControl(env,u,p){
  role(u,["Admin","Supervisor"]);const db=env.DB,date=validateDate(p.date||thaiDay());
  if(date===thaiDay())await ensureToday(env);
  const cfg=await getAppSettings(db),period=await academicPeriodForDate(db,date);
  const [rows,teams,overrides]=await Promise.all([
    all(db,"SELECT * FROM inspections WHERE inspection_date=? ORDER BY inspection_id",date),
    all(db,`SELECT ii.* FROM inspection_inspectors ii JOIN inspections i ON i.inspection_id=ii.inspection_id WHERE i.inspection_date=? ORDER BY ii.inspection_id,ii.user_name`,date),
    (async()=>{await ensureDutyOverridesTable(db);return all(db,`SELECT d.*,su.full_name substitute_name,ru.full_name replace_name FROM duty_overrides d
      JOIN users su ON su.user_id=d.substitute_user_id LEFT JOIN users ru ON ru.user_id=d.replace_user_id WHERE d.override_date=? ORDER BY d.area_id`,date);})()
  ]);
  const teamMap=new Map();teams.forEach(x=>{if(!teamMap.has(x.inspection_id))teamMap.set(x.inspection_id,[]);teamMap.get(x.inspection_id).push(x);});
  const overrideMap=new Map();overrides.forEach(x=>{if(!overrideMap.has(x.area_id))overrideMap.set(x.area_id,[]);overrideMap.get(x.area_id).push(x);});
  const items=rows.map(i=>{
    const m=metaOf(i),team=teamMap.get(i.inspection_id)||[],ovs=overrideMap.get(i.area_id)||[];
    return{
      InspectionID:i.inspection_id,Date:i.inspection_date,AreaID:i.area_id,AreaName:m.areaName||"—",ClassName:m.className||"—",
      Status:i.status,Score:Number(i.score||0),Rating:i.rating||"",Notes:i.note||"",SkipReason:m.skipReason||"",
      ApprovalStatus:m.approvalStatus||"",CompletedBy:m.completedByName||i.completed_by_name||"",CompletedAt:m.completedAt||i.completed_at||"",Version:Number(i.version||0),
      AdminEditedBy:String(m.adminEditedByName||""),AdminEditedAt:String(m.adminEditedAt||""),AdminEditReason:String(m.adminEditReason||""),
      Inspectors:team.map(x=>({UserID:x.user_id,Name:x.user_name})),
      HasSubstitute:ovs.length>0,
      Substitutes:ovs.map(x=>({ReplaceName:x.replace_name||"",SubstituteName:x.substitute_name||"",Reason:x.reason||""})),
      PhotoLinks:parseJson(i.photo_links_json,[]).map(id=>({id}))
    };
  });
  const summary={
    total:items.length,
    done:items.filter(x=>x.Status==="ตรวจแล้ว").length,
    skipped:items.filter(x=>x.Status==="งดตรวจ").length,
    resolved:items.filter(x=>x.Status==="ตรวจแล้ว"||x.Status==="งดตรวจ").length,
    pending:items.filter(x=>x.Status==="รอตรวจ").length,
    approvalPending:items.filter(x=>x.ApprovalStatus==="รอรับรอง").length,
    substitute:items.filter(x=>x.HasSubstitute).length
  };
  return{date,settings:cfg,period:period?{PeriodID:period.period_id,Label:period.label,StartDate:period.start_date,EndDate:period.end_date}:null,summary,items,updatedAt:nowIso()};
}
function defaultCertificateTemplate(){
  return {
    enabled:false,fileId:"",mime:"",updatedAt:"",
    fields:{
      className:{visible:true,x:50,y:49,size:42,color:"#17334b",weight:700,font:"Sarabun"},
      medal:{visible:true,x:50,y:63,size:34,color:"#9a7620",weight:700,font:"Sarabun"},
      month:{visible:true,x:50,y:75,size:20,color:"#526b78",weight:500,font:"Sarabun"},
      period:{visible:true,x:50,y:82,size:18,color:"#607380",weight:400,font:"Sarabun"},
      issueDate:{visible:false,x:50,y:89,size:16,color:"#607380",weight:400,font:"Sarabun"}
    },
    textBlocks:[]
  };
}
function certField(raw,def){
  raw=raw&&typeof raw==="object"?raw:{};
  const color=/^#[0-9a-f]{6}$/i.test(String(raw.color||""))?String(raw.color):def.color;
  const font=["Sarabun","Kanit"].includes(String(raw.font||""))?String(raw.font):String(def.font||"Sarabun");
  return{
    visible:raw.visible!==false,
    x:Math.min(100,Math.max(0,Number(raw.x??def.x))),
    y:Math.min(100,Math.max(0,Number(raw.y??def.y))),
    size:Math.min(96,Math.max(10,Number(raw.size??def.size))),
    color,
    weight:[400,500,600,700].includes(Number(raw.weight))?Number(raw.weight):def.weight,
    font
  };
}
function certTextBlock(raw,index=0){
  raw=raw&&typeof raw==="object"?raw:{};
  const color=/^#[0-9a-f]{6}$/i.test(String(raw.color||""))?String(raw.color):"#17334b";
  const id=text(raw.id||("text-"+(index+1)),80).replace(/[^a-zA-Z0-9_-]/g,"-")||("text-"+(index+1));
  return{
    id,
    text:text(raw.text||"",500),
    visible:raw.visible!==false,
    x:Math.min(100,Math.max(0,Number(raw.x??50))),
    y:Math.min(100,Math.max(0,Number(raw.y??50))),
    size:Math.min(96,Math.max(10,Number(raw.size??22))),
    color,
    weight:[400,500,600,700].includes(Number(raw.weight))?Number(raw.weight):400,
    font:["Sarabun","Kanit"].includes(String(raw.font||""))?String(raw.font):"Sarabun"
  };
}
async function getCertificateTemplate(db){
  const def=defaultCertificateTemplate(),r=await db.prepare("SELECT value FROM settings WHERE key='certificate_template_json'").first(),x=parseJson(r?.value,{});
  const fields={};
  for(const k of Object.keys(def.fields))fields[k]=certField(x?.fields?.[k],def.fields[k]);
  const textBlocks=Array.isArray(x?.textBlocks)?x.textBlocks.slice(0,20).map((v,i)=>certTextBlock(v,i)).filter(v=>v.text):[];
  return{
    enabled:x?.enabled===true&&!!String(x?.fileId||""),
    fileId:String(x?.fileId||""),
    mime:String(x?.mime||""),
    updatedAt:String(x?.updatedAt||""),
    fields,
    textBlocks
  };
}
async function certificateTemplate(env,u){
  role(u,["Admin","Supervisor"]);
  const cfg=await getCertificateTemplate(env.DB);
  return{...cfg,hasImage:!!cfg.fileId};
}
async function certificateTemplateUploadStart(env,u,p,request){
  role(u,["Admin"]);
  const mime=String(p.mime||""),size=Number(p.size),origin=String(p.origin||new URL(request.url).origin);
  assert(["image/jpeg","image/png"].includes(mime),"แม่แบบรองรับ JPG หรือ PNG");
  assert(Number.isInteger(size)&&size>0&&size<=MAX_CERT_TEMPLATE,"ไฟล์แม่แบบต้องไม่เกิน 8 MB");
  assert(env.GAS_DRIVE_URL&&env.DRIVE_GATEWAY_KEY,"ยังไม่ได้ตั้งค่า Google Drive gateway");
  const r=await gasDrive(env,"templateUploadStart",{userId:u.user_id,mime,size,origin});
  await env.DB.prepare("INSERT OR REPLACE INTO upload_tickets(ticket,user_id,inspection_id,file_id,size,mime,expires_at) VALUES(?,?,?,?,?,?,?)")
    .bind(r.ticket,u.user_id,"CERT_TEMPLATE",r.fileId,size,mime,Date.now()+3600000).run();
  return r;
}
async function saveCertificateTemplate(env,u,p){
  role(u,["Admin"]);
  const db=env.DB,old=await getCertificateTemplate(db),def=defaultCertificateTemplate(),raw=p.config&&typeof p.config==="object"?p.config:{};
  let fileId=old.fileId,mime=old.mime;
  if(p.uploadTicket){
    const t=await db.prepare("SELECT * FROM upload_tickets WHERE ticket=?").bind(String(p.uploadTicket)).first();
    assert(t&&t.user_id===u.user_id&&t.inspection_id==="CERT_TEMPLATE"&&Number(t.expires_at)>Date.now(),"สิทธิ์อัปโหลดแม่แบบหมดอายุ");
    await gasDrive(env,"verifyTemplateUpload",{ticket:t.ticket,fileId:t.file_id,size:Number(t.size),mime:t.mime,userId:u.user_id});
    fileId=String(t.file_id);mime=String(t.mime);
  }
  assert(fileId,"กรุณาอัปโหลดภาพแม่แบบก่อน");
  const fields={};
  for(const k of Object.keys(def.fields))fields[k]=certField(raw?.fields?.[k],old.fields?.[k]||def.fields[k]);
  const textBlocks=Array.isArray(raw?.textBlocks)?raw.textBlocks.slice(0,20).map((v,i)=>certTextBlock(v,i)).filter(v=>v.text):old.textBlocks||[];
  const cfg={enabled:raw.enabled!==false,fileId,mime,updatedAt:nowIso(),fields,textBlocks};
  await db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('certificate_template_json',?)").bind(JSON.stringify(cfg)).run();
  if(p.uploadTicket){
    await db.prepare("DELETE FROM upload_tickets WHERE ticket=?").bind(String(p.uploadTicket)).run();
    gasDrive(env,"consumeTemplateUpload",{ticket:String(p.uploadTicket)}).catch(()=>{});
    if(old.fileId&&old.fileId!==fileId)gasDrive(env,"trashFiles",{fileIds:[old.fileId]}).catch(()=>{});
  }
  return cfg;
}
async function certificateTemplateImage(env,u){
  role(u,["Admin","Supervisor"]);
  const cfg=await getCertificateTemplate(env.DB);assert(cfg.fileId,"ยังไม่มีแม่แบบเกียรติบัตร");
  return gasDrive(env,"templateImage",{fileId:cfg.fileId});
}
async function deleteCertificateTemplate(env,u){
  role(u,["Admin"]);
  const cfg=await getCertificateTemplate(env.DB);
  await env.DB.prepare("DELETE FROM settings WHERE key='certificate_template_json'").run();
  if(cfg.fileId&&env.GAS_DRIVE_URL)gasDrive(env,"trashFiles",{fileIds:[cfg.fileId]}).catch(()=>{});
  return true;
}

async function certificateData(env,u,p){
  role(u,["Admin","Supervisor"]);const db=env.DB;await ensureAcademicPeriodsTable(db);
  const month=/^\d{4}-\d{2}$/.test(String(p.month||""))?String(p.month):thaiDay().slice(0,7);
  const start=month+"-01",end=monthLastDay(month)<thaiDay()?monthLastDay(month):thaiDay(),cfg=await getAppSettings(db);
  const [{ins},template]=await Promise.all([inspectionBundleRange(db,start,end),getCertificateTemplate(db)]),rows=await monthly(env,ins,month),period=await academicPeriodForDate(db,end);
  return{
    month,settings:cfg,template,period:period?{PeriodID:period.period_id,Label:period.label,AcademicYear:period.academic_year,Semester:period.semester}:null,
    rows:rows.filter(x=>["เหรียญทอง","เหรียญเงิน","เหรียญทองแดง"].includes(x.medal)),
    generatedAt:nowIso()
  };
}

async function getAppSettings(db){
  if(appSettingsCache.value&&Date.now()-appSettingsCache.at<60000)return appSettingsCache.value;
  const r=await db.prepare("SELECT value FROM settings WHERE key='app_config_json'").first();
  const parsed=parseJson(r?.value,{});
  const cfg={...DEFAULT_APP_SETTINGS,...(parsed&&typeof parsed==="object"?parsed:{})};
  cfg.schoolName=String(cfg.schoolName||DEFAULT_APP_SETTINGS.schoolName).slice(0,200);
  cfg.schoolLogoUrl=String(cfg.schoolLogoUrl||DEFAULT_APP_SETTINGS.schoolLogoUrl).slice(0,500);
  cfg.scoreLabels={...DEFAULT_APP_SETTINGS.scoreLabels,...(cfg.scoreLabels&&typeof cfg.scoreLabels==="object"?cfg.scoreLabels:{})};
  ["1","2","3"].forEach(k=>cfg.scoreLabels[k]=String(cfg.scoreLabels[k]||DEFAULT_APP_SETTINGS.scoreLabels[k]).slice(0,50));
  cfg.reportFooter=String(cfg.reportFooter||DEFAULT_APP_SETTINGS.reportFooter).slice(0,300);
  cfg.inspectionStart=/^\d{2}:\d{2}$/.test(String(cfg.inspectionStart))?String(cfg.inspectionStart):DEFAULT_APP_SETTINGS.inspectionStart;
  cfg.inspectionEnd=/^\d{2}:\d{2}$/.test(String(cfg.inspectionEnd))?String(cfg.inspectionEnd):DEFAULT_APP_SETTINGS.inspectionEnd;
  cfg.approvalEnabled=cfg.approvalEnabled===true;
  cfg.offlineEnabled=cfg.offlineEnabled!==false;
  cfg.photoEvidenceEnabled=cfg.photoEvidenceEnabled===true;
  cfg.recycleDays=Math.min(180,Math.max(1,Number(cfg.recycleDays||30)));
  cfg.certificateSilverMax=Math.min(20,Math.max(0,Number(cfg.certificateSilverMax||3)));
  cfg.certificateBronzeMax=Math.min(30,Math.max(cfg.certificateSilverMax,Number(cfg.certificateBronzeMax||5)));
  cfg.skipReasons=Array.isArray(cfg.skipReasons)?cfg.skipReasons.map(x=>String(x).trim()).filter(Boolean).slice(0,20):DEFAULT_APP_SETTINGS.skipReasons;
  if(!cfg.skipReasons.length)cfg.skipReasons=[...DEFAULT_APP_SETTINGS.skipReasons];
  appSettingsCache={value:cfg,at:Date.now()};
  return cfg;
}
async function appSettings(env,u){
  assert(u,"SESSION_EXPIRED");
  return getAppSettings(env.DB);
}
async function saveAppSettings(env,u,p){
  role(u,["Admin"]);
  const old=await getAppSettings(env.DB),x=p&&typeof p.settings==="object"?p.settings:{};
  const cfg={
    ...old,
    schoolName:text(x.schoolName||old.schoolName,200),
    schoolLogoUrl:text(x.schoolLogoUrl||old.schoolLogoUrl||"/school-logo",500),
    scoreLabels:{
      "1":text(x.scoreLabels?.["1"]||old.scoreLabels?.["1"]||"ปรับปรุง",50),
      "2":text(x.scoreLabels?.["2"]||old.scoreLabels?.["2"]||"ปานกลาง",50),
      "3":text(x.scoreLabels?.["3"]||old.scoreLabels?.["3"]||"ยอดเยี่ยม",50)
    },
    reportFooter:text(x.reportFooter||old.reportFooter,300),
    inspectionStart:/^\d{2}:\d{2}$/.test(String(x.inspectionStart||""))?String(x.inspectionStart):old.inspectionStart,
    inspectionEnd:/^\d{2}:\d{2}$/.test(String(x.inspectionEnd||""))?String(x.inspectionEnd):old.inspectionEnd,
    approvalEnabled:x.approvalEnabled===true,
    offlineEnabled:x.offlineEnabled!==false,
    photoEvidenceEnabled:x.photoEvidenceEnabled===true,
    recycleDays:Math.min(180,Math.max(1,Number(x.recycleDays||old.recycleDays||30))),
    certificateSilverMax:Math.min(20,Math.max(0,Number(x.certificateSilverMax??old.certificateSilverMax))),
    certificateBronzeMax:Math.min(30,Math.max(Number(x.certificateSilverMax??old.certificateSilverMax),Number(x.certificateBronzeMax??old.certificateBronzeMax))),
    skipReasons:Array.isArray(x.skipReasons)?x.skipReasons.map(v=>text(v,100)).filter(Boolean).slice(0,20):old.skipReasons
  };
  assert(cfg.inspectionStart<cfg.inspectionEnd,"เวลาเริ่มตรวจต้องน้อยกว่าเวลาสิ้นสุด");
  assert(cfg.schoolName,"ชื่อโรงเรียนห้ามว่าง");
  if(!cfg.skipReasons.length)cfg.skipReasons=[...DEFAULT_APP_SETTINGS.skipReasons];
  await env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('app_config_json',?)").bind(JSON.stringify(cfg)).run();
  appSettingsCache={value:cfg,at:Date.now()};
  return cfg;
}
async function ensureDutyOverridesTable(db){
  if(dutyOverridesReady)return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS duty_overrides (
    override_id TEXT PRIMARY KEY,
    override_date TEXT NOT NULL,
    area_id TEXT NOT NULL,
    replace_user_id TEXT NOT NULL DEFAULT '',
    substitute_user_id TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_by_id TEXT NOT NULL DEFAULT '',
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_duty_overrides_date ON duty_overrides(override_date,area_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_duty_overrides_substitute ON duty_overrides(substitute_user_id,override_date)").run();
  dutyOverridesReady=true;
}
async function dutyOverrides(env,u,p){
  role(u,["Admin","Supervisor"]);const db=env.DB;await ensureDutyOverridesTable(db);
  const start=validateDate(p.start||thaiDay()),end=validateDate(p.end||shiftDate(start,30));
  assert(start<=end&&end<=shiftDate(start,366),"ช่วงวันที่ไม่ถูกต้อง");
  return all(db,`SELECT d.*,a.area_name,ru.full_name replace_name,su.full_name substitute_name
    FROM duty_overrides d
    JOIN areas a ON a.area_id=d.area_id
    LEFT JOIN users ru ON ru.user_id=d.replace_user_id
    JOIN users su ON su.user_id=d.substitute_user_id
    WHERE d.override_date>=? AND d.override_date<=?
    ORDER BY d.override_date,d.area_id`,start,end);
}
async function saveDutyOverride(env,u,p){
  role(u,["Admin"]);const db=env.DB;await ensureDutyOverridesTable(db);
  const date=validateDate(p.date),areaId=text(p.areaId,80),replaceId=text(p.replaceUserId||"",80),subId=text(p.substituteUserId,80),reason=text(p.reason||"",300);
  assert(date>=thaiDay(),"สลับเวรย้อนหลังไม่ได้");
  const area=await db.prepare("SELECT 1 x FROM areas WHERE area_id=?").bind(areaId).first();assert(area,"ไม่พบพื้นที่");
  const sub=await db.prepare("SELECT full_name FROM users WHERE user_id=? AND role='Inspector'").bind(subId).first();assert(sub,"ผู้ตรวจทดแทนไม่ถูกต้อง");
  if(replaceId){const r=await db.prepare("SELECT 1 x FROM users WHERE user_id=? AND role='Inspector'").bind(replaceId).first();assert(r,"ผู้ตรวจเดิมไม่ถูกต้อง");assert(replaceId!==subId,"ผู้ตรวจเดิมและผู้ตรวจทดแทนต้องไม่ใช่คนเดียวกัน");}
  const completed=await db.prepare("SELECT status FROM inspections WHERE inspection_date=? AND area_id=?").bind(date,areaId).first();
  assert(!completed||completed.status==="รอตรวจ","พื้นที่นี้มีการบันทึกผลแล้ว จึงเปลี่ยนผู้ตรวจไม่ได้");
  const id=text(p.id||"",100)||uuid();
  await db.prepare(`INSERT INTO duty_overrides(override_id,override_date,area_id,replace_user_id,substitute_user_id,reason,created_by_id,created_by_name,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(override_id) DO UPDATE SET override_date=excluded.override_date,area_id=excluded.area_id,replace_user_id=excluded.replace_user_id,substitute_user_id=excluded.substitute_user_id,reason=excluded.reason`)
    .bind(id,date,areaId,replaceId,subId,reason,u.user_id,u.full_name,nowIso()).run();
  if(date===thaiDay()){await invalidateToday(env);await ensureToday(env);}
  return{OverrideID:id,Date:date,AreaID:areaId,SubstituteUserID:subId};
}
async function deleteDutyOverride(env,u,p){
  role(u,["Admin"]);const db=env.DB;await ensureDutyOverridesTable(db);
  const id=text(p.id,100),row=await db.prepare("SELECT * FROM duty_overrides WHERE override_id=?").bind(id).first();assert(row,"ไม่พบรายการสลับเวร");
  await db.prepare("DELETE FROM duty_overrides WHERE override_id=?").bind(id).run();
  if(String(row.override_date)===thaiDay()){await invalidateToday(env);await ensureToday(env);}
  return true;
}
async function reviewQueue(env,u){
  role(u,["Admin","Supervisor"]);const cfg=await getAppSettings(env.DB);
  if(!cfg.approvalEnabled)return{enabled:false,rows:[]};
  const rows=await all(env.DB,"SELECT * FROM inspections WHERE inspection_date>=? ORDER BY inspection_date DESC,updated_at DESC LIMIT 500",shiftDate(thaiDay(),-30));
  return{enabled:true,rows:rows.filter(i=>["รอรับรอง","ส่งกลับแก้ไข"].includes(String(metaOf(i).approvalStatus||""))).map(i=>{
    const m=metaOf(i);return{InspectionID:i.inspection_id,Date:i.inspection_date,AreaName:m.areaName||"—",ClassName:m.className||"—",Status:i.status,Score:Number(i.score||0),Rating:i.rating||"",Notes:i.note||"",SkipReason:m.skipReason||"",ApprovalStatus:m.approvalStatus||"",ReviewNote:m.reviewNote||"",CompletedBy:m.completedByName||i.completed_by_name||"",PhotoLinks:parseJson(i.photo_links_json,[]).map(x=>({id:x})),UpdatedAt:i.updated_at};
  })};
}
async function reviewInspection(env,u,p){
  role(u,["Admin","Supervisor"]);const db=env.DB,cfg=await getAppSettings(db);assert(cfg.approvalEnabled,"ระบบรับรองผลยังไม่ได้เปิด");
  const id=text(p.id,120),decision=text(p.decision,30),note=text(p.note||"",1000);assert(["approve","return"].includes(decision),"คำสั่งรับรองไม่ถูกต้อง");
  const i=await db.prepare("SELECT * FROM inspections WHERE inspection_id=?").bind(id).first();assert(i,"ไม่พบผลตรวจ");
  const m=metaOf(i);assert(String(m.approvalStatus||"")==="รอรับรอง","รายการนี้ไม่ได้อยู่ในสถานะรอรับรอง");
  if(decision==="return")assert(note,"กรุณาระบุเหตุผลที่ส่งกลับแก้ไข");
  m.approvalStatus=decision==="approve"?"รับรองแล้ว":"ส่งกลับแก้ไข";
  m.reviewNote=note;
  m.approvedById=decision==="approve"?u.user_id:"";
  m.approvedByName=decision==="approve"?u.full_name:"";
  m.approvedAt=decision==="approve"?nowIso():"";
  m.reviewedByName=u.full_name;
  m.reviewedAt=nowIso();
  await db.prepare("UPDATE inspections SET meta_json=?,version=version+1,updated_at=? WHERE inspection_id=?").bind(JSON.stringify(m),nowIso(),id).run();
  return{InspectionID:id,ApprovalStatus:m.approvalStatus};
}
async function inspectionExceptions(env,u,p){
  role(u,["Admin","Supervisor"]);const db=env.DB,date=validateDate(p.date||thaiDay());
  assert(date<=thaiDay()&&date>=shiftDate(thaiDay(),-30),"จัดการงดตรวจย้อนหลังได้ไม่เกิน 30 วัน");
  if(date===thaiDay())await ensureToday(env);
  const rows=await all(db,"SELECT * FROM inspections WHERE inspection_date=? ORDER BY inspection_id",date);
  return{date,settings:await getAppSettings(db),rows:rows.map(i=>{const m=metaOf(i);return{InspectionID:i.inspection_id,AreaName:m.areaName||"—",ClassName:m.className||"—",Status:i.status,Score:Number(i.score||0),SkipReason:m.skipReason||"",Notes:i.note||"",ApprovalStatus:m.approvalStatus||"",Version:Number(i.version||0)};})};
}
async function setInspectionException(env,u,p){
  role(u,["Admin","Supervisor"]);const db=env.DB,id=text(p.id,120),action=text(p.action,30),cfg=await getAppSettings(db);
  assert(["skip","reopen"].includes(action),"คำสั่งไม่ถูกต้อง");
  const i=await db.prepare("SELECT * FROM inspections WHERE inspection_id=?").bind(id).first();assert(i,"ไม่พบงานตรวจ");
  assert(i.inspection_date<=thaiDay()&&i.inspection_date>=shiftDate(thaiDay(),-30),"จัดการย้อนหลังได้ไม่เกิน 30 วัน");
  const m=metaOf(i),stamp=nowIso();
  if(action==="skip"){
    const reason=text(p.reason||"",120),note=text(p.note||"",2000);assert(reason&&cfg.skipReasons.includes(reason),"เลือกเหตุผลงดตรวจ");
    m.skipReason=reason;m.note=note;m.completedAt=stamp;m.completedById=u.user_id;m.completedByName=u.full_name;m.reviewNote="";
    if(cfg.approvalEnabled){m.approvalStatus="รอรับรอง";m.approvedById="";m.approvedByName="";m.approvedAt="";}
    else{m.approvalStatus="รับรองแล้ว";m.approvedById="system";m.approvedByName="รับรองอัตโนมัติ";m.approvedAt=stamp;}
    await db.prepare("UPDATE inspections SET status='งดตรวจ',rating='',score=0,note=?,meta_json=?,version=version+1,completed_at=?,completed_by_id=?,completed_by_name=?,updated_at=? WHERE inspection_id=?")
      .bind(note,JSON.stringify(m),stamp,u.user_id,u.full_name,stamp,id).run();
  }else{
    assert(i.inspection_date===thaiDay(),"เปิดงานกลับเป็นรอตรวจได้เฉพาะวันนี้");
    m.skipReason="";m.reviewNote="";m.approvalStatus="";m.completedAt="";m.completedById="";m.completedByName="";
    await db.prepare("UPDATE inspections SET status='รอตรวจ',rating='',score=0,note='',meta_json=?,version=version+1,completed_at='',completed_by_id='',completed_by_name='',updated_at=? WHERE inspection_id=?").bind(JSON.stringify(m),stamp,id).run();
  }
  return true;
}

async function historyOptions(env,u){
  const db=env.DB;
  let classes=await all(db,"SELECT classroom_id id,class_name name FROM classrooms ORDER BY class_name");
  let areas=await all(db,`SELECT a.area_id id,a.area_name name,a.responsible_classroom_id class_id,c.class_name class_name FROM areas a JOIN classrooms c ON c.classroom_id=a.responsible_classroom_id ORDER BY a.area_name`);
  if(u.role==="Teacher"){
    classes=classes.filter(x=>String(x.id)===String(u.linked_classroom_id));
    areas=areas.filter(x=>String(x.class_id)===String(u.linked_classroom_id));
  }else if(u.role==="Inspector"){
    const ids=new Set((await all(db,"SELECT DISTINCT area_id FROM assignments WHERE user_id=?",u.user_id)).map(x=>String(x.area_id)));
    areas=areas.filter(x=>ids.has(String(x.id)));
    const cids=new Set(areas.map(x=>String(x.class_id)));classes=classes.filter(x=>cids.has(String(x.id)));
  }
  return{areas,classes};
}
function historySummary(rows){
  const done=rows.filter(i=>i.status==="ตรวจแล้ว"),scores=done.map(i=>Number(i.score||0)).filter(Boolean);
  return{total:rows.length,done:done.length,skipped:rows.filter(i=>i.status==="งดตรวจ").length,excellent:done.filter(i=>Number(i.score)===3).length,medium:done.filter(i=>Number(i.score)===2).length,improve:done.filter(i=>Number(i.score)===1).length,avg:scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:0};
}
async function historyData(env,u,p){
  const db=env.DB,type=String(p.type||"area"),id=text(p.id,100),start=validateDate(p.start||shiftDate(thaiDay(),-89)),end=validateDate(p.end||thaiDay());
  assert(["area","class"].includes(type)&&start<=end&&(new Date(end)-new Date(start))<=366*86400000,"เงื่อนไขประวัติไม่ถูกต้อง");
  const opts=await historyOptions(env,u);
  if(type==="area")assert(opts.areas.some(x=>String(x.id)===id),"ไม่มีสิทธิ์ดูพื้นที่นี้");
  else assert(opts.classes.some(x=>String(x.id)===id),"ไม่มีสิทธิ์ดูห้องนี้");
  const rows=await all(db,"SELECT * FROM inspections WHERE inspection_date>=? AND inspection_date<=? ORDER BY inspection_date DESC,inspection_id",start,end);
  const selected=rows.filter(i=>type==="area"?String(i.area_id)===id:String(metaOf(i).classId||"")===id);
  const trend=[...selected].reverse().map(i=>{const m=metaOf(i);return{date:i.inspection_date,score:Number(i.score||0),status:i.status,area:m.areaName||"—",className:m.className||"—"};});
  return{type,id,start,end,summary:historySummary(selected),trend,rows:selected.map(i=>{const m=metaOf(i);return{InspectionID:i.inspection_id,Date:i.inspection_date,AreaName:m.areaName||"—",ClassName:m.className||"—",Status:i.status,Score:Number(i.score||0),Rating:i.rating||"",Notes:i.note||"",SkipReason:m.skipReason||"",ApprovalStatus:m.approvalStatus||"",CompletedBy:m.completedByName||i.completed_by_name||"",Version:Number(i.version||0),AdminEditedBy:String(m.adminEditedByName||""),AdminEditedAt:String(m.adminEditedAt||""),AdminEditReason:String(m.adminEditReason||""),PhotoLinks:parseJson(i.photo_links_json,[]).map(x=>({id:x}))};})};
}
async function adminEditInspection(env,u,p){
  role(u,["Admin"]);
  const db=env.DB,id=text(p.id,120),reason=text(p.reason||"",500);
  assert(id,"ไม่พบรหัสผลตรวจ");
  assert(reason.length>=3,"กรุณาระบุเหตุผลการแก้ไขย้อนหลังอย่างน้อย 3 ตัวอักษร");

  const row=await db.prepare("SELECT * FROM inspections WHERE inspection_id=?").bind(id).first();
  assert(row,"ไม่พบผลตรวจ");
  assert(String(row.inspection_date)<=thaiDay(),"แก้ไขผลตรวจในอนาคตไม่ได้");
  assert(Number(p.version)===Number(row.version||0),"ข้อมูลถูกแก้ไขจากอุปกรณ์อื่นแล้ว กรุณาโหลดใหม่");

  const cfg=await getAppSettings(db),status=text(p.status,30);
  assert(["รอตรวจ","ตรวจแล้ว","งดตรวจ"].includes(status),"สถานะไม่ถูกต้อง");

  const score=status==="ตรวจแล้ว"?Number(p.score):0;
  assert(status!=="ตรวจแล้ว"||(Number.isInteger(score)&&score>=1&&score<=3),"เลือกระดับประเมิน 1–3");
  const skipReason=status==="งดตรวจ"?text(p.skipReason||"",120):"";
  if(status==="งดตรวจ")assert(skipReason&&cfg.skipReasons.includes(skipReason),"เลือกเหตุผลงดตรวจจากรายการที่กำหนด");

  const notes=text(p.notes||"",2000),stamp=nowIso(),m=metaOf(row);
  const before={
    date:String(row.inspection_date),
    status:String(row.status||""),
    score:Number(row.score||0),
    rating:String(row.rating||""),
    notes:String(row.note||""),
    skipReason:String(m.skipReason||""),
    approvalStatus:String(m.approvalStatus||""),
    completedBy:String(m.completedByName||row.completed_by_name||"")
  };

  m.note=notes;
  m.skipReason=skipReason;
  m.version=Number(row.version||0)+1;
  m.adminEditedById=String(u.user_id||"");
  m.adminEditedByName=String(u.full_name||"");
  m.adminEditedAt=stamp;
  m.adminEditReason=reason;
  m.reviewNote="";

  const completed=status==="ตรวจแล้ว"||status==="งดตรวจ";
  if(completed){
    m.completedAt=m.completedAt||row.completed_at||stamp;
    m.completedById=m.completedById||row.completed_by_id||u.user_id;
    m.completedByName=m.completedByName||row.completed_by_name||u.full_name;
    // Admin correction is authoritative; no second approval is required.
    m.approvalStatus="รับรองแล้ว";
    m.approvedById=String(u.user_id||"");
    m.approvedByName=String(u.full_name||"");
    m.approvedAt=stamp;
  }else{
    m.completedAt="";
    m.completedById="";
    m.completedByName="";
    m.approvalStatus="";
    m.approvedById="";
    m.approvedByName="";
    m.approvedAt="";
  }

  const rating=score?String(cfg.scoreLabels[String(score)]||["","ปรับปรุง","ปานกลาง","ยอดเยี่ยม"][score]):"";
  await db.prepare(`UPDATE inspections SET
      status=?,rating=?,score=?,note=?,meta_json=?,version=?,
      completed_at=?,completed_by_id=?,completed_by_name=?,updated_at=?
    WHERE inspection_id=?`)
    .bind(
      status,rating,score,notes,JSON.stringify(m),m.version,
      m.completedAt||"",m.completedById||"",m.completedByName||"",stamp,id
    ).run();

  const after={
    date:String(row.inspection_date),
    status,score,rating,notes,skipReason,
    approvalStatus:String(m.approvalStatus||""),
    completedBy:String(m.completedByName||"")
  };
  return{InspectionID:id,Version:m.version,before,after,EditedAt:stamp,EditedBy:u.full_name};
}

async function exportData(env,u,p){
  role(u,["Admin","Supervisor","Teacher"]);
  const db=env.DB,start=validateDate(p.start||shiftDate(thaiDay(),-29)),end=validateDate(p.end||thaiDay()),classId=text(p.classId||"",100),areaId=text(p.areaId||"",100);
  assert(start<=end&&(new Date(end)-new Date(start))<=366*86400000,"ช่วงวันที่ไม่ถูกต้อง");
  if(u.role==="Teacher"){assert(!classId||classId===u.linked_classroom_id,"ไม่มีสิทธิ์ส่งออกห้องนี้");}
  const rows=await all(db,"SELECT * FROM inspections WHERE inspection_date>=? AND inspection_date<=? ORDER BY inspection_date,inspection_id",start,end);
  const filtered=rows.filter(i=>{const m=metaOf(i);if(u.role==="Teacher"&&String(m.classId)!==String(u.linked_classroom_id))return false;if(classId&&String(m.classId)!==classId)return false;if(areaId&&String(i.area_id)!==areaId)return false;return true;});
  const cfg=await getAppSettings(db);
  return{start,end,settings:cfg,rows:filtered.map(i=>{const m=metaOf(i);return{วันที่:i.inspection_date,ห้องเรียน:m.className||"—",พื้นที่:m.areaName||"—",สถานะ:i.status,ระดับ:i.rating||"",คะแนน:Number(i.score||0),หมายเหตุ:i.note||"",เหตุผลงดตรวจ:m.skipReason||"",สถานะรับรอง:m.approvalStatus||"",ผู้ตรวจ:m.completedByName||i.completed_by_name||""};})};
}

async function schoolDay(env,date) {
  const w=weekday(date); if(w===0||w===6) return false;
  return !(await env.DB.prepare("SELECT 1 x FROM holidays WHERE holiday_date=?").bind(date).first());
}
async function invalidateToday(env){
  await env.DB.prepare("DELETE FROM settings WHERE key='today_sync_marker'").run();
}
async function ensureToday(env) {
  const db=env.DB,date=thaiDay(),markerValue="v3:"+date;
  const marker=await db.prepare("SELECT value FROM settings WHERE key='today_sync_marker'").first();
  if(String(marker?.value||"")===markerValue)return;
  if(!(await schoolDay(env,date))){
    await db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('today_sync_marker',?)").bind(markerValue).run();
    return;
  }
  const w=weekday(date);
  const rows=await all(db,`SELECT a.area_id,a.area_name,a.responsible_classroom_id,c.class_name,
    asn.user_id,u.full_name,asn.assignment_id,asn.days
    FROM assignments asn JOIN users u ON u.user_id=asn.user_id
    JOIN areas a ON a.area_id=asn.area_id JOIN classrooms c ON c.classroom_id=a.responsible_classroom_id
    WHERE u.role='Inspector' ORDER BY a.area_id,u.full_name`);
  const byArea=new Map();
  for(const r of rows){if(!dutyDays(r.days).includes(w))continue;if(!byArea.has(r.area_id))byArea.set(r.area_id,[]);byArea.get(r.area_id).push(r);}
  await ensureDutyOverridesTable(db);
  const overrides=await all(db,`SELECT d.*,su.full_name substitute_name,a.area_name,a.responsible_classroom_id,c.class_name
    FROM duty_overrides d
    JOIN users su ON su.user_id=d.substitute_user_id
    JOIN areas a ON a.area_id=d.area_id
    JOIN classrooms c ON c.classroom_id=a.responsible_classroom_id
    WHERE d.override_date=? ORDER BY d.area_id,d.created_at`,date);
  for(const o of overrides){
    let team=byArea.get(o.area_id)||[];
    if(o.replace_user_id)team=team.filter(x=>String(x.user_id)!==String(o.replace_user_id));
    if(!team.some(x=>String(x.user_id)===String(o.substitute_user_id))){
      team.push({
        area_id:o.area_id,area_name:o.area_name,responsible_classroom_id:o.responsible_classroom_id,class_name:o.class_name,
        user_id:o.substitute_user_id,full_name:o.substitute_name,assignment_id:"override:"+o.override_id,days:String(w)
      });
    }
    byArea.set(o.area_id,team);
  }
  let existing=await all(db,"SELECT * FROM inspections WHERE inspection_date=? ORDER BY inspection_id",date);
  const map=new Map(existing.map(i=>[i.area_id,i])),create=[];
  for(const [areaId,team] of byArea){
    if(map.has(areaId))continue;
    const first=team[0],id=date+"_"+areaId,now=nowIso();
    const meta={note:"",areaId,areaName:first.area_name,classId:first.responsible_classroom_id,className:first.class_name,inspectorIds:team.map(x=>x.user_id),inspectorNames:team.map(x=>x.full_name),createdAt:now,completedAt:"",version:0};
    create.push(db.prepare(`INSERT OR IGNORE INTO inspections(inspection_id,area_id,inspection_date,status,rating,score,note,meta_json,photo_links_json,version,completed_at,completed_by_id,completed_by_name,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,areaId,date,"รอตรวจ","",0,"",JSON.stringify(meta),"[]",0,"","","",now,now));
  }
  if(create.length){
    await runDbBatches(db,create,50);
    existing=await all(db,"SELECT * FROM inspections WHERE inspection_date=? ORDER BY inspection_id",date);
  }
  const current=new Map(existing.map(i=>[i.area_id,i])),sync=[];
  for(const [areaId,team] of byArea){
    const i=current.get(areaId); if(!i||i.status!=="รอตรวจ")continue;
    sync.push(db.prepare("DELETE FROM inspection_inspectors WHERE inspection_id=?").bind(i.inspection_id));
    for(const x of team)sync.push(db.prepare("INSERT OR IGNORE INTO inspection_inspectors(inspection_id,user_id,user_name) VALUES(?,?,?)").bind(i.inspection_id,x.user_id,x.full_name));
    const meta=parseJson(i.meta_json,{});meta.inspectorIds=team.map(x=>x.user_id);meta.inspectorNames=team.map(x=>x.full_name);meta.areaName=team[0].area_name;meta.classId=team[0].responsible_classroom_id;meta.className=team[0].class_name;
    sync.push(db.prepare("UPDATE inspections SET meta_json=?,updated_at=? WHERE inspection_id=?").bind(JSON.stringify(meta),nowIso(),i.inspection_id));
  }
  if(sync.length)await runDbBatches(db,sync,50);
  await db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('today_sync_marker',?)").bind(markerValue).run();
}
function inspectionDisplay(i, inspectors=[]) {
  const m=parseJson(i.meta_json,{}); m.note=i.note||m.note||""; m.version=Number(i.version||0); m.completedAt=i.completed_at||m.completedAt||"";
  if(inspectors.length){ m.inspectorIds=inspectors.map(x=>x.user_id); m.inspectorNames=inspectors.map(x=>x.user_name); }
  return { InspectionID:i.inspection_id,AssignmentID:"",InspectionDate:i.inspection_date,Status:i.status,Rating:i.rating,Score:Number(i.score||0),Notes:i.note||"",PhotoLinks:parseJson(i.photo_links_json,[]).map(id=>({id})),ApprovalStatus:String(m.approvalStatus||""),ReviewNote:String(m.reviewNote||""),SkipReason:String(m.skipReason||""),meta:m };
}
async function displayOne(db,i){ const team=await all(db,"SELECT user_id,user_name FROM inspection_inspectors WHERE inspection_id=? ORDER BY user_name",i.inspection_id); return inspectionDisplay(i,team); }
async function ownedTask(env,u,id){ role(u,["Inspector"]); const db=env.DB; const i=await db.prepare(`SELECT i.* FROM inspections i JOIN inspection_inspectors ii ON ii.inspection_id=i.inspection_id WHERE i.inspection_id=? AND ii.user_id=?`).bind(id,u.user_id).first(); assert(i,"งานนี้ไม่ใช่งานที่ได้รับมอบหมาย"); const returned=String(metaOf(i).approvalStatus||"")==="ส่งกลับแก้ไข"; assert(i.inspection_date===thaiDay()||returned,"แก้ไขได้เฉพาะงานวันนี้หรือรายการที่ถูกส่งกลับแก้ไข"); return i; }
async function tasksReady(env,u){
  const day=thaiDay(),start=shiftDate(day,-7),db=env.DB;
  const [allRows,teams]=await Promise.all([
    all(db,`SELECT DISTINCT i.* FROM inspections i
      JOIN inspection_inspectors mine ON mine.inspection_id=i.inspection_id
      WHERE i.inspection_date>=? AND i.inspection_date<=? AND mine.user_id=?
      ORDER BY i.inspection_date DESC,i.inspection_id`,start,day,u.user_id),
    all(db,`SELECT team.inspection_id,team.user_id,team.user_name
      FROM inspections i
      JOIN inspection_inspectors mine ON mine.inspection_id=i.inspection_id AND mine.user_id=?
      JOIN inspection_inspectors team ON team.inspection_id=i.inspection_id
      WHERE i.inspection_date>=? AND i.inspection_date<=?
      ORDER BY team.inspection_id,team.user_name`,u.user_id,start,day)
  ]);
  const rows=allRows.filter(i=>i.inspection_date===day||String(metaOf(i).approvalStatus||"")==="ส่งกลับแก้ไข");
  const map=new Map();
  teams.forEach(x=>{if(!map.has(x.inspection_id))map.set(x.inspection_id,[]);map.get(x.inspection_id).push(x);});
  return rows.map(i=>inspectionDisplay(i,map.get(i.inspection_id)||[]));
}
async function tasks(env,u){ role(u,["Inspector"]); await ensureToday(env); return tasksReady(env,u); }
async function inspectorHome(env,u){
  role(u,["Inspector"]); await ensureToday(env);
  const [taskRows,rewards,notice,settings]=await Promise.all([
    tasksReady(env,u),
    all(env.DB,"SELECT * FROM rewards_log WHERE reference_id=? ORDER BY timestamp",u.user_id),
    notifications(env,u,true),
    getAppSettings(env.DB)
  ]);
  return{tasks:taskRows,rewards:rewards.map(rewardRow),notifications:notice,settings,updatedAt:nowIso()};
}
async function qrTask(env,u,p){ role(u,["Inspector"]); const aid=await qrAreaId(env,p.token); await ensureToday(env); const i=await env.DB.prepare(`SELECT i.* FROM inspections i JOIN inspection_inspectors ii ON ii.inspection_id=i.inspection_id WHERE i.inspection_date=? AND i.area_id=? AND ii.user_id=?`).bind(thaiDay(),aid,u.user_id).first(); assert(i,"พื้นที่นี้ไม่ได้อยู่ในงานที่คุณได้รับมอบหมายวันนี้"); return displayOne(env.DB,i); }
async function visible(env,u,i){ if(!u) return false; if(["Admin","Supervisor"].includes(u.role)) return true; if(u.role==="Inspector") return !!(await env.DB.prepare("SELECT 1 x FROM inspection_inspectors WHERE inspection_id=? AND user_id=?").bind(i.inspection_id,u.user_id).first()); const m=parseJson(i.meta_json,{}); return u.role==="Teacher" && m.classId===u.linked_classroom_id; }

async function ensureAreaMapTable(db){
  if(areaMapReady)return;
  await db.prepare("CREATE TABLE IF NOT EXISTS area_map_shapes (shape_id TEXT PRIMARY KEY,area_id TEXT NOT NULL UNIQUE,shape_type TEXT NOT NULL DEFAULT 'rect',x REAL NOT NULL DEFAULT 0,y REAL NOT NULL DEFAULT 0,width REAL NOT NULL DEFAULT 120,height REAL NOT NULL DEFAULT 80,points_json TEXT NOT NULL DEFAULT '[]',fill_color TEXT NOT NULL DEFAULT '#38bdf8',locked INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_area_map_sort ON area_map_shapes(sort_order,shape_id)").run();
  areaMapReady=true;
}
function areaMapShapeRow(r){
  return {ShapeID:String(r.shape_id),AreaID:String(r.area_id),AreaName:String(r.area_name||""),ClassName:String(r.class_name||""),ResponsibleClassroomID:String(r.responsible_classroom_id||""),ShapeType:String(r.shape_type||"rect"),X:Number(r.x||0),Y:Number(r.y||0),Width:Number(r.width||0),Height:Number(r.height||0),Points:parseJson(r.points_json,[]),FillColor:String(r.fill_color||"#38bdf8"),Locked:Number(r.locked||0)===1,SortOrder:Number(r.sort_order||0)};
}
async function areaMapLayout(env,u){
  role(u,["Admin","Supervisor","Inspector","Teacher"]);
  await ensureAreaMapTable(env.DB);
  return {canvas:{width:1600,height:1000},shapes:(await all(env.DB,"SELECT s.*,a.area_name,a.responsible_classroom_id,c.class_name FROM area_map_shapes s LEFT JOIN areas a ON a.area_id=s.area_id LEFT JOIN classrooms c ON c.classroom_id=a.responsible_classroom_id ORDER BY s.sort_order,s.shape_id")).map(areaMapShapeRow)};
}
async function saveAreaMapLayout(env,u,p){
  role(u,["Admin"]);
  const db=env.DB; await ensureAreaMapTable(db);
  const shapes=Array.isArray(p.shapes)?p.shapes:[]; assert(shapes.length<=100,"ผังมีพื้นที่มากเกินไป");
  const m=await masterData(db),validAreas=new Set(m.Areas.map(a=>String(a.AreaID))),seen=new Set(),now=nowIso(),stmts=[db.prepare("DELETE FROM area_map_shapes")];
  const num=(v,min,max,label)=>{const n=Number(v);assert(Number.isFinite(n)&&n>=min&&n<=max,label+" ไม่ถูกต้อง");return Math.round(n*100)/100;};
  for(let i=0;i<shapes.length;i++){
    const s=shapes[i]||{},areaId=String(s.AreaID||""),type=String(s.ShapeType||"rect"),shapeId=text(s.ShapeID||"",120)||uuid(),color=String(s.FillColor||"#38bdf8").trim(),locked=s.Locked?1:0,sortOrder=Number.isFinite(Number(s.SortOrder))?Math.trunc(Number(s.SortOrder)):i;
    assert(validAreas.has(areaId),"ผังอ้างอิงพื้นที่ที่ไม่มีอยู่"); assert(!seen.has(areaId),"หนึ่งพื้นที่วางบนผังได้ 1 รูปทรง"); seen.add(areaId);
    assert(type==="rect"||type==="polygon","ชนิดรูปทรงไม่ถูกต้อง"); assert(/^#[0-9a-fA-F]{6}$/.test(color),"สีพื้นที่ไม่ถูกต้อง");
    let x=0,y=0,w=0,h=0,points=[];
    if(type==="rect"){
      x=num(s.X,0,1590,"ตำแหน่ง X"); y=num(s.Y,0,990,"ตำแหน่ง Y"); w=num(s.Width,20,1600,"ความกว้าง"); h=num(s.Height,20,1000,"ความสูง");
      assert(x+w<=1600.01&&y+h<=1000.01,"รูปทรงอยู่นอกขอบผัง");
    }else{
      assert(Array.isArray(s.Points)&&s.Points.length>=3&&s.Points.length<=60,"รูปหลายเหลี่ยมต้องมี 3–60 จุด");
      points=s.Points.map(pt=>({x:num(pt?.x,0,1600,"จุด X"),y:num(pt?.y,0,1000,"จุด Y")}));
      const xs=points.map(pt=>pt.x),ys=points.map(pt=>pt.y); x=Math.min(...xs); y=Math.min(...ys); w=Math.max(...xs)-x; h=Math.max(...ys)-y; assert(w>=20&&h>=20,"รูปหลายเหลี่ยมเล็กเกินไป");
    }
    stmts.push(db.prepare("INSERT INTO area_map_shapes(shape_id,area_id,shape_type,x,y,width,height,points_json,fill_color,locked,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(shapeId,areaId,type,x,y,w,h,JSON.stringify(points),color,locked,sortOrder,now,now));
  }
  await db.batch(stmts);
  return {saved:shapes.length};
}
async function masterData(db){
  const [us,cs,as,assigns]=await Promise.all([all(db,"SELECT * FROM users ORDER BY full_name"),all(db,"SELECT * FROM classrooms ORDER BY class_name"),all(db,"SELECT * FROM areas ORDER BY area_name"),all(db,"SELECT * FROM assignments ORDER BY area_id,user_id")]);
  return { Users:us.map(userRow),Classrooms:cs.map(classRow),Areas:as.map(areaRow),Assignments:assigns.map(assignRow) };
}
async function master(env,u){ role(u,["Admin"]); const m=await masterData(env.DB); m.Users=m.Users.map(x=>({UserID:x.UserID,Username:x.Username,FullName:x.FullName,Role:x.Role,LinkedClassroomID:x.LinkedClassroomID})); return m; }

async function qrAdmin(env,u,p){ role(u,["Admin"]); const m=await masterData(env.DB), req=Array.isArray(p.areaIds)?[...new Set(p.areaIds.map(String))]:[]; let areas=req.length?m.Areas.filter(a=>req.includes(a.AreaID)):m.Areas; assert(!req.length||areas.length===req.length,"มีพื้นที่บางรายการที่ไม่พบ"); return Promise.all(areas.map(async a=>({AreaID:a.AreaID,AreaName:a.AreaName,ClassName:m.Classrooms.find(c=>c.ClassroomID===a.ResponsibleClassroomID)?.ClassName||"—",token:await qrToken(env,a.AreaID)}))); }

async function saveMaster(env,u,p){
  role(u,["Admin"]); const db=env.DB,n=p.table; assert(["Users","Classrooms","Areas"].includes(n),"ตารางไม่ถูกต้อง"); const m=await masterData(db);
  if(n==="Users"){
    const id=text(p.row.UserID||"")||uuid(), old=m.Users.find(x=>x.UserID===id), username=text(p.row.Username,80).toLowerCase(), full=text(p.row.FullName,200), r=text(p.row.Role,30), link=text(p.row.LinkedClassroomID||"",80);
    assert(/^[a-z0-9._@-]{3,80}$/.test(username),"Username ใช้อักษรอังกฤษ 3–80 ตัว"); assert(ROLES.includes(r)&&full,"ชื่อหรือสิทธิ์ไม่ถูกต้อง");
    assert(!m.Users.some(x=>x.Username.toLowerCase()===username&&x.UserID!==id),"Username ซ้ำ"); if(r==="Teacher") assert(m.Classrooms.some(c=>c.ClassroomID===link),"เลือกห้องเรียนของครู");
    if(old?.Role==="Inspector"&&r!=="Inspector") assert(!m.Assignments.some(a=>a.UserID===id),"ยกเลิกงานมอบหมายก่อนเปลี่ยนสิทธิ์ผู้ตรวจ");
    if(old?.Role==="Admin"&&r!=="Admin") assert(m.Users.filter(x=>x.Role==="Admin").length>1,"ต้องมี Admin อย่างน้อย 1 คน");
    const pass=p.credential?await credentialJson(env,p.credential):old?.Password; assert(pass,"กำหนดรหัสผ่าน");
    await db.prepare(`INSERT INTO users(user_id,username,password,full_name,role,linked_classroom_id,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,password=excluded.password,full_name=excluded.full_name,role=excluded.role,linked_classroom_id=excluded.linked_classroom_id,updated_at=excluded.updated_at`).bind(id,username,pass,full,r,r==="Teacher"?link:"",nowIso()).run();
  } else if(n==="Classrooms"){
    const id=text(p.row.ClassroomID||"")||uuid(), name=text(p.row.ClassName,200); assert(name,"ชื่อห้องว่างหรือซ้ำ"); assert(!m.Classrooms.some(x=>x.ClassName===name&&x.ClassroomID!==id),"ชื่อห้องว่างหรือซ้ำ");
    await db.prepare(`INSERT INTO classrooms(classroom_id,class_name,updated_at) VALUES(?,?,?) ON CONFLICT(classroom_id) DO UPDATE SET class_name=excluded.class_name,updated_at=excluded.updated_at`).bind(id,name,nowIso()).run();
  } else {
    const id=text(p.row.AreaID||"")||uuid(), name=text(p.row.AreaName,200), cid=text(p.row.ResponsibleClassroomID,80); assert(name&&m.Classrooms.some(c=>c.ClassroomID===cid),"ระบุพื้นที่และห้องรับผิดชอบ"); assert(!m.Areas.some(x=>x.AreaName===name&&x.AreaID!==id),"ชื่อพื้นที่ซ้ำ");
    await db.prepare(`INSERT INTO areas(area_id,area_name,responsible_classroom_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(area_id) DO UPDATE SET area_name=excluded.area_name,responsible_classroom_id=excluded.responsible_classroom_id,updated_at=excluded.updated_at`).bind(id,name,cid,nowIso()).run();
  }
  await invalidateToday(env);
  return true;
}

async function deleteMaster(env,u,p){
  role(u,["Admin"]); const db=env.DB,m=await masterData(db), id=String(p.id||""); assert(["Users","Classrooms","Areas","Assignments"].includes(p.table),"ตารางไม่ถูกต้อง");
  if(p.table==="Users"){
    const old=m.Users.find(x=>x.UserID===id); assert(old,"ไม่พบรายการ"); assert(id!==u.user_id,"ลบบัญชีตนเองไม่ได้"); assert(!m.Assignments.some(a=>a.UserID===id),"ยกเลิกงานมอบหมายก่อน"); assert(old.Role!=="Admin"||m.Users.filter(x=>x.Role==="Admin").length>1,"ต้องมี Admin");
    await putRecycle(db,u,p.table,id,old);
    await db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id).run();
    await db.prepare("DELETE FROM users WHERE user_id=?").bind(id).run();
  }
  if(p.table==="Classrooms"){
    const old=m.Classrooms.find(x=>x.ClassroomID===id); assert(old,"ไม่พบรายการ"); assert(!m.Areas.some(a=>a.ResponsibleClassroomID===id)&&!m.Users.some(x=>x.LinkedClassroomID===id),"ยังมีข้อมูลอ้างอิงห้องนี้");
    await putRecycle(db,u,p.table,id,old);
    await db.prepare("DELETE FROM classrooms WHERE classroom_id=?").bind(id).run();
  }
  if(p.table==="Areas"){
    const old=m.Areas.find(x=>x.AreaID===id); assert(old,"ไม่พบรายการ"); assert(!m.Assignments.some(a=>a.AreaID===id),"ยกเลิกงานมอบหมายก่อน"); await ensureAreaMapTable(db); assert(!(await db.prepare("SELECT 1 x FROM area_map_shapes WHERE area_id=?").bind(id).first()),"นำพื้นที่ออกจากผังก่อน");
    await putRecycle(db,u,p.table,id,old);
    await db.prepare("DELETE FROM areas WHERE area_id=?").bind(id).run();
  }
  if(p.table==="Assignments"){
    const old=m.Assignments.find(x=>x.AssignmentID===id); assert(old,"ไม่พบรายการ");
    await putRecycle(db,u,p.table,id,old);
    await db.prepare("DELETE FROM assignments WHERE assignment_id=?").bind(id).run();
  }
  await invalidateToday(env);
  return true;
}
async function assign(env,u,p){
  role(u,["Admin"]); const db=env.DB,m=await masterData(db), users=[...new Set((p.userIds||[]).map(String))], areas=[...new Set((p.areaIds||[]).map(String))], days=dutyText(Array.isArray(p.days)?p.days.join(","):p.days);
  assert(users.length&&areas.length,"เลือกผู้ตรวจและพื้นที่"); users.forEach(id=>assert(m.Users.some(x=>x.UserID===id&&x.Role==="Inspector"),"ผู้ตรวจไม่ถูกต้อง")); areas.forEach(id=>assert(m.Areas.some(x=>x.AreaID===id),"ไม่พบพื้นที่"));
  let added=0,merged=0; const stmts=[];
  for(const uid of users) for(const aid of areas){ const old=m.Assignments.find(a=>a.UserID===uid&&a.AreaID===aid); if(old){ const union=[...new Set([...dutyDays(old.Days),...dutyDays(days)])].sort().join(","); stmts.push(db.prepare("UPDATE assignments SET days=?,updated_at=? WHERE assignment_id=?").bind(union,nowIso(),old.AssignmentID)); merged++; } else { stmts.push(db.prepare("INSERT INTO assignments(assignment_id,user_id,area_id,days,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(uuid(),uid,aid,days,nowIso(),nowIso())); added++; } }
  if(stmts.length) await db.batch(stmts); await invalidateToday(env); await ensureToday(env); return {added,merged};
}
async function setAssignmentDays(env,u,p){ role(u,["Admin"]); const days=dutyText(Array.isArray(p.days)?p.days.join(","):p.days); const r=await env.DB.prepare("UPDATE assignments SET days=?,updated_at=? WHERE assignment_id=?").bind(days,nowIso(),String(p.id||"")).run(); assert(r.meta.changes,"ไม่พบรายการ"); await invalidateToday(env); await ensureToday(env); return true; }
async function removeDutyAssignments(env,u,p){
  role(u,["Admin"]);
  const db=env.DB,m=await masterData(db),day=Number(p.day),mode=String(p.mode||"").trim();
  assert(Number.isInteger(day)&&day>=1&&day<=5,"วันเข้าเวรไม่ถูกต้อง");
  let targets=m.Assignments.filter(a=>dutyDays(a.Days).includes(day));

  if(mode==="areas"){
    const areaIds=[...new Set((Array.isArray(p.areaIds)?p.areaIds:[]).map(String))];
    assert(areaIds.length&&areaIds.length<=100,"เลือกพื้นที่อย่างน้อย 1 พื้นที่");
    areaIds.forEach(id=>assert(m.Areas.some(a=>a.AreaID===id),"ไม่พบพื้นที่"));
    const wanted=new Set(areaIds);
    targets=targets.filter(a=>wanted.has(String(a.AreaID)));
  }else if(mode==="inspector"){
    const userId=String(p.userId||"");
    assert(m.Users.some(x=>x.UserID===userId&&x.Role==="Inspector"),"ไม่พบผู้ตรวจ");
    targets=targets.filter(a=>String(a.UserID)===userId);
  }else if(mode!=="day"){
    throw Error("รูปแบบการลบเวรไม่ถูกต้อง");
  }

  if(!targets.length)return{changed:0,updated:0,removed:0};

  await cleanRecycle(db);
  const cfg=await getAppSettings(db),deletedAt=nowIso(),
    expiresAt=Date.now()+Number(cfg.recycleDays||30)*24*3600000,
    stmts=[];
  let updated=0,removed=0;

  for(const a of targets){
    const remaining=dutyDays(a.Days).filter(n=>n!==day);
    if(remaining.length){
      stmts.push(
        db.prepare("UPDATE assignments SET days=?,updated_at=? WHERE assignment_id=?")
          .bind(remaining.join(","),deletedAt,String(a.AssignmentID))
      );
      updated++;
    }else{
      stmts.push(
        db.prepare("INSERT INTO recycle_bin(recycle_id,deleted_at,deleted_by_user_id,deleted_by_name,entity_type,entity_id,label,snapshot_json,expires_at) VALUES(?,?,?,?,?,?,?,?,?)")
          .bind(uuid(),deletedAt,String(u.user_id||""),String(u.full_name||""),"Assignments",String(a.AssignmentID),recycleLabel("Assignments",a),JSON.stringify(a),expiresAt)
      );
      stmts.push(
        db.prepare("DELETE FROM assignments WHERE assignment_id=?").bind(String(a.AssignmentID))
      );
      removed++;
    }
  }

  if(stmts.length)await runDbBatches(db,stmts,40);
  await invalidateToday(env);
  await ensureToday(env);
  return{changed:targets.length,updated,removed};
}


async function copyDutyAssignments(env,u,p){
  role(u,["Admin"]);
  const db=env.DB,m=await masterData(db),sourceDay=Number(p.sourceDay),
    targets=[...new Set((Array.isArray(p.targetDays)?p.targetDays:[]).map(Number))]
      .filter(n=>Number.isInteger(n)&&n>=1&&n<=5&&n!==sourceDay)
      .sort();
  assert(Number.isInteger(sourceDay)&&sourceDay>=1&&sourceDay<=5,"วันต้นทางไม่ถูกต้อง");
  assert(targets.length,"เลือกวันปลายทางอย่างน้อย 1 วัน");

  const source=m.Assignments.filter(a=>dutyDays(a.Days).includes(sourceDay));
  assert(source.length,"วันต้นทางยังไม่มีเวรให้คัดลอก");
  const sourcePairs=new Set(source.map(a=>String(a.UserID)+"|"+String(a.AreaID))),
    targetSet=new Set(targets),
    deletedAt=nowIso();
  await cleanRecycle(db);
  const cfg=await getAppSettings(db),
    expiresAt=Date.now()+Number(cfg.recycleDays||30)*24*3600000,
    stmts=[];
  let updated=0,removed=0;

  for(const a of m.Assignments){
    const pair=String(a.UserID)+"|"+String(a.AreaID),
      before=dutyDays(a.Days),
      next=before.filter(n=>!targetSet.has(n));
    if(sourcePairs.has(pair)){
      for(const d of targets) if(!next.includes(d)) next.push(d);
    }
    next.sort((x,y)=>x-y);
    const beforeText=before.join(","),nextText=next.join(",");
    if(beforeText===nextText)continue;

    if(next.length){
      stmts.push(
        db.prepare("UPDATE assignments SET days=?,updated_at=? WHERE assignment_id=?")
          .bind(nextText,deletedAt,String(a.AssignmentID))
      );
      updated++;
    }else{
      stmts.push(
        db.prepare("INSERT INTO recycle_bin(recycle_id,deleted_at,deleted_by_user_id,deleted_by_name,entity_type,entity_id,label,snapshot_json,expires_at) VALUES(?,?,?,?,?,?,?,?,?)")
          .bind(uuid(),deletedAt,String(u.user_id||""),String(u.full_name||""),"Assignments",String(a.AssignmentID),recycleLabel("Assignments",a),JSON.stringify(a),expiresAt)
      );
      stmts.push(
        db.prepare("DELETE FROM assignments WHERE assignment_id=?").bind(String(a.AssignmentID))
      );
      removed++;
    }
  }

  if(stmts.length)await runDbBatches(db,stmts,40);
  await invalidateToday(env);
  await ensureToday(env);
  return{sourceCount:source.length,targetDays:targets,updated,removed};
}

async function password(env,u,p){ const c=parseJson(u.password,{}); assert(equalLoose(c.hash,await hmac(env,text(p.oldProof,200))),"รหัสผ่านเดิมไม่ถูกต้อง"); const pass=await credentialJson(env,p.credential); await env.DB.prepare("UPDATE users SET password=?,updated_at=? WHERE user_id=?").bind(pass,nowIso(),u.user_id).run(); await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(u.user_id).run(); return true; }
async function saveHolidays(env,u,p){ role(u,["Admin"]); assert(Array.isArray(p.dates)&&p.dates.length<=400,"วันหยุดมากเกินไป"); const dates=[...new Set(p.dates.map(validateDate))]; await env.DB.prepare("DELETE FROM holidays").run(); if(dates.length) await env.DB.batch(dates.map(d=>env.DB.prepare("INSERT INTO holidays(holiday_date) VALUES(?)").bind(d))); await invalidateToday(env); return true; }

async function bulkPlan(env,table,inputs,needCred){
  const m=await masterData(env.DB), rows=[], prepared=[]; assert(["Users","Classrooms","Areas","Assignments"].includes(table),"ตารางไม่ถูกต้อง"); assert(Array.isArray(inputs)&&inputs.length>=1&&inputs.length<=100,"นำเข้าได้ครั้งละ 1–100 รายการ");
  const seen=new Set();
  for(let i=0;i<inputs.length;i++){
    const x=inputs[i]||{}, errors=[], display={};
    if(table==="Classrooms") { const name=text(x.ClassName||x["ชื่อห้องเรียน"]||"",200); display.ClassName=name; if(!name) errors.push("ชื่อห้องเรียนว่าง"); const k=name.toLowerCase(); if(seen.has(k)||m.Classrooms.some(c=>c.ClassName.toLowerCase()===k)) errors.push("ชื่อห้องเรียนซ้ำ"); seen.add(k); if(!errors.length) prepared.push({classroom_id:uuid(),class_name:name}); }
    if(table==="Areas") { const name=text(x.AreaName||x["ชื่อพื้นที่"]||"",200), cls=text(x.ClassName||x["ห้องรับผิดชอบ"]||"",200); display.AreaName=name; display.ClassName=cls; const c=m.Classrooms.find(c=>c.ClassName===cls||c.ClassroomID===cls); if(!name) errors.push("ชื่อพื้นที่ว่าง"); if(!c) errors.push("ไม่พบห้องรับผิดชอบ"); const k=name.toLowerCase(); if(seen.has(k)||m.Areas.some(a=>a.AreaName.toLowerCase()===k)) errors.push("ชื่อพื้นที่ซ้ำ"); seen.add(k); if(!errors.length) prepared.push({area_id:uuid(),area_name:name,responsible_classroom_id:c.ClassroomID}); }
    if(table==="Users") { const username=text(x.Username||"",80).toLowerCase(), full=text(x.FullName||"",200), roleRaw=text(x.Role||"",40), cls=text(x.ClassName||"",200); const map={"ผู้ดูแลระบบ":"Admin","หัวหน้างาน":"Supervisor","ผู้บริหาร":"Supervisor","ผู้ตรวจ":"Inspector","ครูประจำชั้น":"Teacher"}; const rr=map[roleRaw]||roleRaw; display.Username=username;display.FullName=full;display.Role=rr;display.ClassName=cls; if(!/^[a-z0-9._@-]{3,80}$/.test(username)) errors.push("Username ไม่ถูกต้อง"); if(!full) errors.push("ชื่อ–สกุลว่าง"); if(!ROLES.includes(rr)) errors.push("Role ไม่ถูกต้อง"); let c=null; if(rr==="Teacher"){ c=m.Classrooms.find(c=>c.ClassName===cls||c.ClassroomID===cls); if(!c) errors.push("Teacher ต้องระบุห้องเรียน"); } else if(cls) errors.push("สิทธิ์นี้ต้องเว้นห้องเรียน"); const k=username; if(seen.has(k)||m.Users.some(u=>u.Username.toLowerCase()===k)) errors.push("Username ซ้ำ"); seen.add(k); if(needCred&&!x.credential) errors.push("ไม่พบ credential"); if(!errors.length) prepared.push({user_id:uuid(),username,full_name:full,role:rr,linked_classroom_id:c?.ClassroomID||"",credential:x.credential}); }
    if(table==="Assignments") {
      const userRef=text(x.Username||x.Inspector||x["ผู้ตรวจ"]||"",200).toLowerCase(),areaRef=text(x.AreaName||x["ชื่อพื้นที่"]||x["พื้นที่"]||"",200),rawDays=text(x.Days||x["วันเข้าเวร"]||"",100);
      display.Username=userRef;display.AreaName=areaRef;display.Days=rawDays;
      const inspector=m.Users.find(v=>v.Role==="Inspector"&&(v.Username.toLowerCase()===userRef||v.FullName.toLowerCase()===userRef||v.UserID.toLowerCase()===userRef));
      const area=m.Areas.find(v=>v.AreaName===areaRef||v.AreaID===areaRef);
      if(!inspector)errors.push("ไม่พบผู้ตรวจ Inspector");
      if(!area)errors.push("ไม่พบพื้นที่");
      let days="";
      try{days=dutyText(rawDays);}catch(e){errors.push("วันเข้าเวรไม่ถูกต้อง ใช้ 1,2,3,4,5");}
      const k=(inspector?.UserID||userRef)+"|"+(area?.AreaID||areaRef);
      if(seen.has(k))errors.push("ผู้ตรวจ/พื้นที่ซ้ำในไฟล์");seen.add(k);
      if(!errors.length){
        const old=m.Assignments.find(a=>a.UserID===inspector.UserID&&a.AreaID===area.AreaID);
        const merged=old?[...new Set([...dutyDays(old.Days),...dutyDays(days)])].sort().join(","):days;
        prepared.push({assignment_id:old?.AssignmentID||uuid(),user_id:inspector.UserID,area_id:area.AreaID,days:merged,existing:!!old});
      }
    }
    rows.push({row:i+2,errors,display});
  }
  return {valid:rows.every(r=>!r.errors.length),rows,total:rows.length,prepared};
}
async function bulkPreview(env,u,p){ role(u,["Admin"]); const r=await bulkPlan(env,p.table,p.rows,false); return {valid:r.valid,rows:r.rows,total:r.total}; }
async function bulkCreate(env,u,p){ role(u,["Admin"]); const r=await bulkPlan(env,p.table,p.rows,true); if(!r.valid) return {saved:false,valid:false,rows:r.rows,total:r.total}; const db=env.DB; const stmts=[];
  if(p.table==="Classrooms") r.prepared.forEach(x=>stmts.push(db.prepare("INSERT INTO classrooms(classroom_id,class_name,created_at,updated_at) VALUES(?,?,?,?)").bind(x.classroom_id,x.class_name,nowIso(),nowIso())));
  if(p.table==="Areas") r.prepared.forEach(x=>stmts.push(db.prepare("INSERT INTO areas(area_id,area_name,responsible_classroom_id,created_at,updated_at) VALUES(?,?,?,?,?)").bind(x.area_id,x.area_name,x.responsible_classroom_id,nowIso(),nowIso())));
  if(p.table==="Users") for(const x of r.prepared) stmts.push(db.prepare("INSERT INTO users(user_id,username,password,full_name,role,linked_classroom_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(x.user_id,x.username,await credentialJson(env,x.credential),x.full_name,x.role,x.linked_classroom_id,nowIso(),nowIso()));
  if(p.table==="Assignments") for(const x of r.prepared){
    if(x.existing)stmts.push(db.prepare("UPDATE assignments SET days=?,updated_at=? WHERE assignment_id=?").bind(x.days,nowIso(),x.assignment_id));
    else stmts.push(db.prepare("INSERT INTO assignments(assignment_id,user_id,area_id,days,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(x.assignment_id,x.user_id,x.area_id,x.days,nowIso(),nowIso()));
  }
  await db.batch(stmts); await invalidateToday(env); return {saved:true,count:r.prepared.length}; }

async function uploadStart(env,u,p,request){
  const cfg=await getAppSettings(env.DB);assert(cfg.photoEvidenceEnabled,"ระบบปิดการแนบรูปหลักฐานเพื่อเพิ่มความเร็ว");
  const i=await ownedTask(env,u,p.id); const mime=String(p.mime||""), size=Number(p.size), origin=String(p.origin||new URL(request.url).origin);
  assert(["image/jpeg","image/png","image/webp"].includes(mime),"รองรับ JPG PNG WebP"); assert(Number.isInteger(size)&&size>0&&size<=MAX_IMAGE,"รูปภาพต้องไม่เกิน 100 MB");
  assert(env.GAS_DRIVE_URL&&env.DRIVE_GATEWAY_KEY,"ยังไม่ได้ตั้งค่า Google Drive gateway");
  const r=await gasDrive(env,"uploadStart",{inspectionId:i.inspection_id,userId:u.user_id,mime,size,origin});
  await env.DB.prepare("INSERT OR REPLACE INTO upload_tickets(ticket,user_id,inspection_id,file_id,size,mime,expires_at) VALUES(?,?,?,?,?,?,?)").bind(r.ticket,u.user_id,i.inspection_id,r.fileId,size,mime,Date.now()+3600000).run();
  return r;
}
async function gasDrive(env,action,payload){
  const res=await fetch(env.GAS_DRIVE_URL,{method:"POST",headers:{"Content-Type":"text/plain; charset=UTF-8"},body:JSON.stringify({gatewayKey:env.DRIVE_GATEWAY_KEY,action,payload}),redirect:"follow"});
  const raw=await res.text(); let r; try{r=JSON.parse(raw);}catch{throw Error("Drive gateway ตอบกลับไม่ใช่ JSON");} if(!r.ok) throw Error(r.error||"Drive gateway error"); return r.data;
}
async function saveInspection(env,u,p){
  const db=env.DB,i=await ownedTask(env,u,p.id),cfg=await getAppSettings(db);
  assert(Number(p.version)===Number(i.version),"ข้อมูลถูกเปลี่ยนแล้ว กรุณาโหลดใหม่");
  assert(["รอตรวจ","ตรวจแล้ว","งดตรวจ"].includes(p.status),"สถานะไม่ถูกต้อง");
  const score=p.status==="ตรวจแล้ว"?Number(p.score):0;
  assert((Number.isInteger(score)&&score>=1&&score<=3)||p.status!=="ตรวจแล้ว","เลือกระดับประเมิน");
  const skipReason=p.status==="งดตรวจ"?text(p.skipReason||"",120):"";
  if(p.status==="งดตรวจ")assert(skipReason&&cfg.skipReasons.includes(skipReason),"เลือกเหตุผลงดตรวจ");
  const oldPhotos=parseJson(i.photo_links_json,[]); let photos=oldPhotos;
  if(p.uploadTicket){ const t=await db.prepare("SELECT * FROM upload_tickets WHERE ticket=?").bind(String(p.uploadTicket)).first(); assert(t&&t.user_id===u.user_id&&t.inspection_id===i.inspection_id&&Number(t.expires_at)>Date.now(),"สิทธิ์อัปโหลดหมดอายุ"); await gasDrive(env,"verifyUpload",{ticket:t.ticket,fileId:t.file_id,size:Number(t.size),mime:t.mime,inspectionId:i.inspection_id}); photos=[t.file_id]; }
  else if(p.removePhoto===true) photos=[];
  const stamp=nowIso(), meta=parseJson(i.meta_json,{});
  meta.note=text(p.notes,2000); meta.version=Number(i.version)+1; meta.skipReason=skipReason;
  const completed=p.status==="ตรวจแล้ว"||p.status==="งดตรวจ";
  meta.completedAt=completed?stamp:""; meta.completedById=completed?u.user_id:""; meta.completedByName=completed?u.full_name:"";
  meta.reviewNote="";
  if(completed&&cfg.approvalEnabled){
    meta.approvalStatus="รอรับรอง";meta.approvedById="";meta.approvedByName="";meta.approvedAt="";
  }else if(completed){
    meta.approvalStatus="รับรองแล้ว";meta.approvedById="system";meta.approvedByName="รับรองอัตโนมัติ";meta.approvedAt=stamp;
  }else{
    meta.approvalStatus="";
  }
  await db.prepare(`UPDATE inspections SET status=?,rating=?,score=?,note=?,meta_json=?,photo_links_json=?,version=?,completed_at=?,completed_by_id=?,completed_by_name=?,updated_at=? WHERE inspection_id=?`)
    .bind(p.status,score?String(cfg.scoreLabels[String(score)]||["","ปรับปรุง","ปานกลาง","ยอดเยี่ยม"][score]):"",score,meta.note,JSON.stringify(meta),JSON.stringify(photos),meta.version,meta.completedAt,meta.completedById,meta.completedByName,stamp,i.inspection_id).run();
  if(p.uploadTicket) { await db.prepare("DELETE FROM upload_tickets WHERE ticket=?").bind(String(p.uploadTicket)).run(); gasDrive(env,"consumeUpload",{ticket:String(p.uploadTicket)}).catch(()=>{}); }
  const trash=oldPhotos.filter(id=>!photos.includes(id)); if(trash.length&&env.GAS_DRIVE_URL) gasDrive(env,"trashFiles",{fileIds:trash}).catch(()=>{});
  const updated=await db.prepare("SELECT * FROM inspections WHERE inspection_id=?").bind(i.inspection_id).first();
  return {inspection:await displayOne(db,updated),warning:cfg.approvalEnabled&&completed?"บันทึกแล้ว · รอผู้รับรองผล":""};
}
async function photo(env,u,p){ const i=await env.DB.prepare("SELECT * FROM inspections WHERE inspection_id=?").bind(String(p.inspectionId||"")).first(); assert(i&&await visible(env,u,i),"ไม่มีสิทธิ์ดูรูป"); const ids=parseJson(i.photo_links_json,[]); assert(ids.includes(String(p.fileId||"")),"ไม่พบรูปในรายการ"); return gasDrive(env,"photo",{fileId:String(p.fileId)}); }

function rewardRow(r){ return {LogID:r.log_id,Timestamp:r.timestamp,ReferenceID:r.reference_id,Achievement:r.achievement,Details:r.details_json}; }
function metaOf(i){ const m=parseJson(i.meta_json,{}); m.note=i.note||m.note||""; m.completedAt=i.completed_at||m.completedAt||""; return m; }
function inspectorIdsFrom(i, teamMap){ const t=teamMap.get(i.inspection_id)||[]; if(t.length) return t.map(x=>x.user_id); const m=metaOf(i); return Array.isArray(m.inspectorIds)?m.inspectorIds.map(String):(m.userId?[String(m.userId)]:[]); }
function inspectorNamesFrom(i, teamMap){ const t=teamMap.get(i.inspection_id)||[]; if(t.length) return t.map(x=>x.user_name); const m=metaOf(i); return Array.isArray(m.inspectorNames)?m.inspectorNames.map(String):(m.userName?[String(m.userName)]:[]); }
async function inspectionBundle(db){ const ins=await all(db,"SELECT * FROM inspections ORDER BY inspection_date,inspection_id"), teams=await all(db,"SELECT * FROM inspection_inspectors ORDER BY inspection_id,user_name"), map=new Map(); teams.forEach(x=>{if(!map.has(x.inspection_id))map.set(x.inspection_id,[]);map.get(x.inspection_id).push(x);}); return {ins,teamMap:map}; }
async function inspectionBundleRange(db,start,end){
  const [ins,teams]=await Promise.all([
    all(db,"SELECT * FROM inspections WHERE inspection_date>=? AND inspection_date<=? ORDER BY inspection_date,inspection_id",start,end),
    all(db,`SELECT ii.* FROM inspection_inspectors ii
      JOIN inspections i ON i.inspection_id=ii.inspection_id
      WHERE i.inspection_date>=? AND i.inspection_date<=?
      ORDER BY ii.inspection_id,ii.user_name`,start,end)
  ]);
  const map=new Map();
  teams.forEach(x=>{if(!map.has(x.inspection_id))map.set(x.inspection_id,[]);map.get(x.inspection_id).push(x);});
  return{ins,teamMap:map};
}
function monthLastDay(month){
  const y=Number(month.slice(0,4)),m=Number(month.slice(5,7));
  return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
}
function activeDates(ins){ return new Set(ins.filter(i=>i.status==="ตรวจแล้ว"||i.status==="งดตรวจ").map(i=>i.inspection_date)); }
async function rewardRecords(env,ins,teamMap){
  const cfg=await getAppSettings(env.DB),ad=activeDates(ins); ins=ins.filter(i=>ad.has(i.inspection_date)&&(i.status!=="ตรวจแล้ว"||approvedForScoring(i,cfg))); const rewards=[],classes={},inspectors={};
  const add=async(ref,key,name,details)=>rewards.push({log_id:await digest(ref+"|"+key),timestamp:details.at||nowIso(),reference_id:ref,achievement:name,details_json:JSON.stringify(details)});
  for(const i of ins){ const m=metaOf(i); (classes[m.classId]||(classes[m.classId]=[])).push(i); for(const uid of inspectorIdsFrom(i,teamMap)){ const k=uid+"|"+i.inspection_date; (inspectors[k]||(inspectors[k]=[])).push(i); } }
  for(const [ref,list] of Object.entries(classes)){
    list.sort((a,b)=>a.inspection_date.localeCompare(b.inspection_date)||a.inspection_id.localeCompare(b.inspection_id)); let streak=0,count=0,improving=0,star=false,improved=false;
    for(const i of list){ if(i.status==="งดตรวจ")continue; const m=metaOf(i),s=i.status==="ตรวจแล้ว"?Number(i.score):0; if(s===3){streak++;count++;if(improving>0)improving++;}else{streak=0;improving=s===1?1:0;} if(streak>=5&&!star){await add(ref,"star","ดาวสะอาด",{at:m.completedAt,description:"ยอดเยี่ยม 5 ผลตรวจติดต่อกัน"});star=true;} if([10,20,50].includes(count)&&s===3)await add(ref,"consistent:"+count,"ความสม่ำเสมอ "+count+" ครั้ง",{at:m.completedAt,count}); if(improving===4&&!improved){await add(ref,"improve","พัฒนาการยอดเยี่ยม",{at:m.completedAt,description:"ปรับปรุง แล้วได้ยอดเยี่ยม 3 ผลตรวจติดต่อกัน"});improved=true;} }
  }
  for(const [key,items] of Object.entries(inspectors)){ const [uid,date]=key.split("|"); const ok=items.length&&items.every(i=>i.status==="ตรวจแล้ว"&&metaOf(i).completedAt&&new Intl.DateTimeFormat("en-GB",{timeZone:TZ,hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(metaOf(i).completedAt))<"10:00:00"); if(ok) await add(uid,"perfect:"+date,"Perfect Day",{at:date+"T10:00:00+07:00",date,count:items.length}); }
  return rewards;
}
async function rebuildRewards(env){ const {ins,teamMap}=await inspectionBundle(env.DB), desired=await rewardRecords(env,ins,teamMap), existing=await all(env.DB,"SELECT * FROM rewards_log"), old=new Map(existing.map(x=>[x.log_id,x.timestamp])); const stmts=[env.DB.prepare("DELETE FROM rewards_log")]; for(const r of desired) stmts.push(env.DB.prepare("INSERT INTO rewards_log(log_id,timestamp,reference_id,achievement,details_json) VALUES(?,?,?,?,?)").bind(r.log_id,old.get(r.log_id)||r.timestamp,r.reference_id,r.achievement,r.details_json)); await env.DB.batch(stmts); }
function approvedForScoring(i,cfg){
  if(i.status!=="ตรวจแล้ว")return false;
  const status=String(metaOf(i).approvalStatus||"");
  return !cfg?.approvalEnabled || status==="" || status==="รับรองแล้ว";
}
function leaderboard(ins,cfg=null){ const groups={}; ins.filter(i=>approvedForScoring(i,cfg)).forEach(i=>{const m=metaOf(i),g=groups[m.classId]||(groups[m.classId]={id:m.classId,name:m.className,total:0,score:0});g.total++;g.score+=Number(i.score||0);}); return Object.values(groups).map(g=>({...g,avg:g.total?g.score/g.total:0})).sort((a,b)=>b.avg-a.avg||b.total-a.total||a.name.localeCompare(b.name,"th")); }
async function monthly(env,allIns,month){ const cfg=await getAppSettings(env.DB),ad=activeDates(allIns), firstNext=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)), last=new Date(firstNext.getTime()-86400000).toISOString().slice(0,10), cutoff=last<thaiDay()?last:thaiDay(), expected=[...ad].filter(d=>d.startsWith(month)&&d<=cutoff).sort(),groups={}; allIns.filter(i=>i.inspection_date.startsWith(month)&&i.inspection_date<=cutoff).forEach(i=>{const m=metaOf(i),g=groups[m.classId]||(groups[m.classId]={id:m.classId,name:m.className,total:0,done:0,resolved:0,skipped:0,improve:0,days:new Set()}); if(!ad.has(i.inspection_date))return;g.total++;g.days.add(i.inspection_date);if(i.status==="ตรวจแล้ว"&&approvedForScoring(i,cfg)){g.done++;g.resolved++;if(Number(i.score)===1)g.improve++;}else if(i.status==="งดตรวจ"){g.skipped++;g.resolved++;}}); return Object.values(groups).map(g=>{const missingDays=expected.filter(d=>!g.days.has(d)).length,complete=expected.length>0&&g.total>0&&g.resolved===g.total&&missingDays===0;return{id:g.id,name:g.name,total:g.total,done:g.done,skipped:g.skipped,improve:g.improve,missingDays,inspectionDays:expected.length,provisional:last>=thaiDay(),medal:expected.length===0?"ไม่มีการตรวจในเดือนนี้":!complete?"ข้อมูลไม่ครบ":g.improve===0?"เหรียญทอง":g.improve<=cfg.certificateSilverMax?"เหรียญเงิน":g.improve<=cfg.certificateBronzeMax?"เหรียญทองแดง":"ไม่ผ่านเกณฑ์"};}); }
async function dashboard(env,u,d){
  if(d===thaiDay())await ensureToday(env);
  const cfg=await getAppSettings(env.DB),start=shiftDate(d,-29);
  const [ins,areas]=await Promise.all([
    all(env.DB,"SELECT * FROM inspections WHERE inspection_date>=? AND inspection_date<=? ORDER BY inspection_date,inspection_id",start,d),
    env.DB.prepare("SELECT COUNT(*) n FROM areas").first()
  ]);
  const ad=activeDates(ins),isHoliday=d<thaiDay()&&!ad.has(d);
  const selected=ins.filter(i=>i.inspection_date===d&&!isHoliday&&(!u||u.role!=="Teacher"||metaOf(i).classId===u.linked_classroom_id));
  const submitted=selected.filter(i=>i.status==="ตรวจแล้ว"),resolved=selected.filter(i=>i.status==="ตรวจแล้ว"||i.status==="งดตรวจ"),counts=[3,2,1].map(n=>submitted.filter(i=>Number(i.score)===n).length);
  const recent=[...submitted].sort((a,b)=>String(metaOf(b).completedAt).localeCompare(String(metaOf(a).completedAt))).slice(0,50).map(i=>({date:i.inspection_date,area:metaOf(i).areaName,className:metaOf(i).className,rating:i.rating,score:i.score,approvalStatus:String(metaOf(i).approvalStatus||"")}));
  return{date:d,isHoliday,areas:Number(areas?.n||0),scheduled:selected.length,done:submitted.length,skipped:selected.filter(i=>i.status==="งดตรวจ").length,pending:selected.length-resolved.length,approvalPending:submitted.filter(i=>String(metaOf(i).approvalStatus||"")==="รอรับรอง").length,counts,feed:u?recent:[],leaders:leaderboard(ins,cfg).slice(0,5),updatedAt:nowIso()};
}
function monthShift(month,offset){
  const y=Number(month.slice(0,4)),m=Number(month.slice(5,7));
  const d=new Date(Date.UTC(y,m-1+offset,1));
  return d.toISOString().slice(0,7);
}
function mondayOf(date){
  const d=new Date(date+"T00:00:00Z"),wd=d.getUTCDay()||7;
  d.setUTCDate(d.getUTCDate()-(wd-1));
  return d.toISOString().slice(0,10);
}
function executiveStats(ins,start,end,cfg=null){
  const rows=ins.filter(i=>i.inspection_date>=start&&i.inspection_date<=end);
  const done=rows.filter(i=>approvedForScoring(i,cfg)),resolved=rows.filter(i=>i.status==="ตรวจแล้ว"||i.status==="งดตรวจ");
  const scores=done.map(i=>Number(i.score||0)).filter(n=>n>0);
  const excellent=done.filter(i=>Number(i.score)===3).length;
  const medium=done.filter(i=>Number(i.score)===2).length;
  const improve=done.filter(i=>Number(i.score)===1).length;
  const scheduled=rows.length,doneCount=done.length;
  return{
    start,end,scheduled,done:doneCount,skipped:rows.filter(i=>i.status==="งดตรวจ").length,pending:Math.max(0,scheduled-resolved.length),
    completionRate:scheduled?resolved.length*100/scheduled:0,
    averageScore:scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:0,
    excellent,medium,improve,
    excellentRate:doneCount?excellent*100/doneCount:0,
    improveRate:doneCount?improve*100/doneCount:0
  };
}
async function executiveDashboard(env,u,p={}){
  role(u,["Admin","Supervisor"]);
  await ensureToday(env);
  const db=env.DB,today=thaiDay(),cfg=await getAppSettings(db);
  await ensureAcademicPeriodsTable(db);
  const periods=await all(db,"SELECT * FROM academic_periods ORDER BY start_date DESC,academic_year DESC,semester DESC");
  let selected=null;
  const requested=String(p.periodId||"");
  if(requested)selected=periods.find(x=>String(x.period_id)===requested)||null;
  if(!selected)selected=periods.find(x=>Number(x.is_active||0)===1)||null;
  const refDate=selected?(selected.end_date<today?selected.end_date:today):today;
  const contextStart=selected?.start_date||shiftDate(refDate,-180);
  const thisMonth=refDate.slice(0,7),currentWeekStart=mondayOf(refDate);
  const clipStart=d=>d<contextStart?contextStart:d;
  const firstMonth=clipStart(monthShift(thisMonth,-5)+"-01"),firstWeek=clipStart(shiftDate(currentWeekStart,-49));
  const queryStart=firstMonth<firstWeek?firstMonth:firstWeek;
  const [ins,areaRow]=await Promise.all([
    all(db,"SELECT * FROM inspections WHERE inspection_date>=? AND inspection_date<=? ORDER BY inspection_date,inspection_id",queryStart,refDate),
    db.prepare("SELECT COUNT(*) n FROM areas").first()
  ]);

  const todayStats=executiveStats(ins,refDate,refDate,cfg);
  const weekSeries=[];
  for(let n=7;n>=0;n--){
    const rawStart=shiftDate(currentWeekStart,-7*n),rawEnd=n===0?refDate:shiftDate(rawStart,6);
    const ws=clipStart(rawStart),we=rawEnd>refDate?refDate:rawEnd;
    const x=we<ws?executiveStats([],ws,we,cfg):executiveStats(ins,ws,we,cfg);
    weekSeries.push({...x,label:rawStart});
  }

  const monthSeries=[];
  for(let n=5;n>=0;n--){
    const month=monthShift(thisMonth,-n),rawStart=month+"-01",rawEnd=n===0?refDate:monthLastDay(month);
    const ms=clipStart(rawStart),me=rawEnd>refDate?refDate:rawEnd;
    const x=me<ms?executiveStats([],ms,me,cfg):executiveStats(ins,ms,me,cfg);
    monthSeries.push({...x,month});
  }

  const last30Start=clipStart(shiftDate(refDate,-29));
  const last30=ins.filter(i=>i.inspection_date>=last30Start&&i.inspection_date<=refDate);
  const last30Stats=executiveStats(ins,last30Start,refDate,cfg);
  const areaMap={},classMap={};
  for(const i of last30){
    if(!approvedForScoring(i,cfg))continue;
    const m=metaOf(i),score=Number(i.score||0);
    const a=areaMap[m.areaId]||(areaMap[m.areaId]={id:m.areaId,name:m.areaName||"—",className:m.className||"—",done:0,improve:0,totalScore:0});
    a.done++;a.totalScore+=score;if(score===1)a.improve++;
    const c=classMap[m.classId]||(classMap[m.classId]={id:m.classId,name:m.className||"—",done:0,improve:0,totalScore:0});
    c.done++;c.totalScore+=score;if(score===1)c.improve++;
  }
  const watchAreas=Object.values(areaMap).map(x=>({...x,avg:x.done?x.totalScore/x.done:0})).filter(x=>x.improve>0).sort((a,b)=>b.improve-a.improve||a.avg-b.avg||a.name.localeCompare(b.name,"th")).slice(0,8);
  const watchClasses=Object.values(classMap).map(x=>({...x,avg:x.done?x.totalScore/x.done:0})).filter(x=>x.improve>0).sort((a,b)=>b.improve-a.improve||a.avg-b.avg||a.name.localeCompare(b.name,"th")).slice(0,8);

  const currentWeek=weekSeries[weekSeries.length-1]||executiveStats([],refDate,refDate,cfg);
  const previousWeek=weekSeries[weekSeries.length-2]||executiveStats([],refDate,refDate,cfg);
  const currentMonth=monthSeries[monthSeries.length-1]||executiveStats([],refDate,refDate,cfg);
  const previousMonth=monthSeries[monthSeries.length-2]||executiveStats([],refDate,refDate,cfg);

  return{
    today,
    referenceDate:refDate,
    period:selected?{PeriodID:selected.period_id,Label:selected.label,StartDate:selected.start_date,EndDate:selected.end_date,AcademicYear:selected.academic_year,Semester:selected.semester}:null,
    periods:periods.map(x=>({PeriodID:x.period_id,Label:x.label,StartDate:x.start_date,EndDate:x.end_date,IsActive:Number(x.is_active||0)===1})),
    areas:Number(areaRow?.n||0),
    todayStats,last30:last30Stats,currentWeek,previousWeek,currentMonth,previousMonth,
    weekSeries,monthSeries,leaders:leaderboard(last30,cfg).slice(0,5),watchAreas,watchClasses,settings:cfg,updatedAt:nowIso()
  };
}
async function teacher(env,u){
  role(u,["Teacher"]);await ensureToday(env);
  const db=env.DB,today=thaiDay(),month=today.slice(0,7),monthStart=month+"-01",monthEnd=monthLastDay(month)<today?monthLastDay(month):today;
  const [filtered,monthIns,rewards]=await Promise.all([
    all(db,`SELECT * FROM inspections
      WHERE json_extract(meta_json,'$.classId')=?
        AND (inspection_date=? OR status IN ('ตรวจแล้ว','งดตรวจ'))
      ORDER BY inspection_date DESC,updated_at DESC LIMIT 200`,u.linked_classroom_id,today),
    all(db,"SELECT * FROM inspections WHERE inspection_date>=? AND inspection_date<=? ORDER BY inspection_date,inspection_id",monthStart,monthEnd),
    all(db,"SELECT * FROM rewards_log WHERE reference_id=? ORDER BY timestamp",u.linked_classroom_id)
  ]);
  let teams=[];
  if(filtered.length){
    const ids=filtered.map(x=>x.inspection_id),marks=ids.map(()=>"?").join(",");
    teams=await all(db,`SELECT inspection_id,user_id,user_name FROM inspection_inspectors WHERE inspection_id IN (${marks}) ORDER BY inspection_id,user_name`,...ids);
  }
  const map=new Map();teams.forEach(x=>{if(!map.has(x.inspection_id))map.set(x.inspection_id,[]);map.get(x.inspection_id).push(x);});
  return{
    inspections:filtered.map(i=>inspectionDisplay(i,map.get(i.inspection_id)||[])),
    rewards:rewards.map(rewardRow),
    monthly:(await monthly(env,monthIns,month)).filter(r=>r.id===u.linked_classroom_id)
  };
}
async function dailyReport(env,u,date){
  role(u,["Admin","Supervisor","Inspector"]);
  assert(date<=thaiDay(),"เลือกวันที่ในอนาคตไม่ได้");
  if(date===thaiDay())await ensureToday(env);
  const db=env.DB;
  const [rows,isSchoolDay]=await Promise.all([
    all(db,"SELECT * FROM inspections WHERE inspection_date=? ORDER BY inspection_id",date),
    schoolDay(env,date)
  ]);
  const items=rows.map(i=>{
    const m=metaOf(i);
    return{
      InspectionID:String(i.inspection_id),
      AreaName:String(m.areaName||"—"),
      ClassName:String(m.className||"—"),
      Status:String(i.status||"รอตรวจ"),
      Score:Number(i.score||0),
      Rating:String(i.rating||""),
      Notes:String(i.note||m.note||""),
      SkipReason:String(m.skipReason||""),
      ApprovalStatus:String(m.approvalStatus||""),
      CompletedAt:String(i.completed_at||m.completedAt||"")
    };
  });
  const done=items.filter(x=>x.Status==="ตรวจแล้ว"),resolved=items.filter(x=>x.Status==="ตรวจแล้ว"||x.Status==="งดตรวจ");
  const noInspectionHoliday=date<thaiDay()&&resolved.length===0;
  const isHoliday=!isSchoolDay||noInspectionHoliday;
  const counts={
    excellent:done.filter(x=>x.Score===3).length,
    medium:done.filter(x=>x.Score===2).length,
    improve:done.filter(x=>x.Score===1).length
  };
  return{
    date,
    isHoliday,
    holidayReason:!isSchoolDay?"วันหยุดตามปฏิทิน":noInspectionHoliday?"ไม่มีการตรวจในวันดังกล่าว":"",
    scheduled:items.length,
    done:done.length,
    pending:isHoliday?0:items.filter(x=>x.Status==="รอตรวจ").length,
    skipped:items.filter(x=>x.Status==="งดตรวจ").length,
    approvalPending:items.filter(x=>String(x.ApprovalStatus||"")==="รอรับรอง").length,
    counts,
    items,
    settings:await getAppSettings(db),
    updatedAt:nowIso()
  };
}

async function report(env,u,start,end){
  role(u,["Admin","Supervisor"]); assert(start<=end&&end<=thaiDay(),"ช่วงวันที่ไม่ถูกต้อง"); assert((new Date(end)-new Date(start))<=366*86400000,"เลือกช่วงไม่เกิน 366 วัน");
  await ensureToday(env);
  const cfg=await getAppSettings(env.DB),month=end.slice(0,7),monthStart=month+"-01",monthEnd=monthLastDay(month)<thaiDay()?monthLastDay(month):thaiDay();
  const [{ins,teamMap},{ins:monthIns},users,rewardRows]=await Promise.all([
    inspectionBundleRange(env.DB,start,end),
    inspectionBundleRange(env.DB,monthStart,monthEnd),
    all(env.DB,"SELECT user_id,full_name FROM users"),
    all(env.DB,"SELECT * FROM rewards_log ORDER BY timestamp")
  ]);
  const ad=activeDates(ins),filtered=ins.filter(i=>ad.has(i.inspection_date)),done=filtered.filter(i=>approvedForScoring(i,cfg)),areas={},people={},um=new Map(users.map(x=>[x.user_id,x.full_name]));
  for(const i of filtered){const m=metaOf(i),ids=inspectorIdsFrom(i,teamMap),names=inspectorNamesFrom(i,teamMap);ids.forEach((uid,idx)=>{const g=people[uid]||(people[uid]={name:names[idx]||um.get(uid)||"—",scheduled:0,done:0});g.scheduled++;if(i.status==="ตรวจแล้ว"||i.status==="งดตรวจ")g.done++;});if(approvedForScoring(i,cfg)&&Number(i.score)===1){const a=areas[m.areaId]||(areas[m.areaId]={name:m.areaName,count:0});a.count++;}}
  return{start,end,leaders:leaderboard(done,cfg),watch:Object.values(areas).sort((a,b)=>b.count-a.count),inspectors:Object.values(people),monthly:await monthly(env,monthIns,month),month,rewards:rewardRows.map(rewardRow)};
}
