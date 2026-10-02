const TZ = "Asia/Bangkok";
const SESSION_MS = 8 * 3600000;
const REMEMBER_SESSION_MS = 90 * 24 * 3600000;
const MAX_IMAGE = 100 * 1024 * 1024;
const ITERATIONS = 600000;
const ROLES = ["Admin", "Supervisor", "Inspector", "Teacher"];
const enc = new TextEncoder();
let sessionMetaReady = false;
let autoBackupCheckedDay = "";

export async function onRequest(context) {
  const { request, env } = context;
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, headers);
  if (!env.DB) return jsonResponse({ ok: false, error: "ยังไม่ได้ผูก D1 binding ชื่อ DB" }, 500, headers);
  if (!env.RSD_PEPPER) return jsonResponse({ ok: false, error: "ยังไม่ได้ตั้งค่า RSD_PEPPER" }, 500, headers);
  try {
    const input = await request.json();
    const action = String(input?.action || "");
    const payload = input?.payload || {};
    const payloadSize = JSON.stringify(payload).length;
    const maxPayload = action === "restoreBackup" ? 20 * 1024 * 1024 : 100000;
    if (payloadSize > maxPayload) throw Error(action === "restoreBackup" ? "ไฟล์ Backup ใหญ่เกิน 20 MB" : "คำขอใหญ่เกินไป");
    const token = String(input?.token || "");
    const data = await dispatch(env, action, payload, token, request);
    if (!["challenge","login","publicDashboard"].includes(action)) {
      const job = autoBackupIfDue(env).catch(e => console.error("AUTO_BACKUP_FAILED", e));
      if (typeof context.waitUntil === "function") context.waitUntil(job);
    }
    if (action === "saveInspection" && typeof context.waitUntil === "function") {
      context.waitUntil(rebuildRewards(env).catch(e => console.error("REWARD_REBUILD_FAILED", e)));
    }
    return jsonResponse({ ok: true, data }, 200, headers);
  } catch (err) {
    return jsonResponse({ ok: false, error: err?.message || String(err) }, 200, headers);
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
    bootstrap: async () => ({ user:publicUser(u), today:thaiDay(), holidays:(await all(db,"SELECT holiday_date FROM holidays ORDER BY holiday_date")).map(x=>x.holiday_date) }),
    myRewards: async () => { role(u,["Inspector"]); return (await all(db,"SELECT * FROM rewards_log WHERE reference_id=? ORDER BY timestamp",u.user_id)).map(rewardRow); },
    dashboard: async () => dashboard(env,u,validateDate(p.date || thaiDay())),
    tasks: async () => tasks(env,u),
    inspectorHome: async () => inspectorHome(env,u),
    qrTask: async () => qrTask(env,u,p),
    teacher: async () => teacher(env,u),
    qrAdmin: async () => qrAdmin(env,u,p),
    master: async () => master(env,u),
    report: async () => report(env,u,validateDate(p.start),validateDate(p.end)),
    saveMaster: async () => saveMaster(env,u,p),
    bulkPreview: async () => bulkPreview(env,u,p),
    bulkCreate: async () => bulkCreate(env,u,p),
    deleteMaster: async () => deleteMaster(env,u,p),
    assign: async () => assign(env,u,p),
    setAssignmentDays: async () => setAssignmentDays(env,u,p),
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
  return { token, user:publicUser(u), mustChange:c.scheme === "bootstrap" };
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

const AUDIT_ACTIONS = new Set(["saveMaster","bulkCreate","deleteMaster","assign","setAssignmentDays","saveInspection","password","holidays","backupExport","backupNow","restoreBackup","restoreTrash","purgeTrash","logoutSession","logoutOtherSessions"]);

async function ensureAuditTable(db){
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
  const specs=[
    ["users","SELECT * FROM users ORDER BY user_id"],
    ["classrooms","SELECT * FROM classrooms ORDER BY classroom_id"],
    ["areas","SELECT * FROM areas ORDER BY area_id"],
    ["assignments","SELECT * FROM assignments ORDER BY assignment_id"],
    ["inspections","SELECT * FROM inspections ORDER BY inspection_date,inspection_id"],
    ["inspection_inspectors","SELECT * FROM inspection_inspectors ORDER BY inspection_id,user_id"],
    ["rewards_log","SELECT * FROM rewards_log ORDER BY timestamp,log_id"],
    ["holidays","SELECT * FROM holidays ORDER BY holiday_date"],
    ["settings","SELECT * FROM settings ORDER BY key"],
    ["audit_log","SELECT * FROM audit_log ORDER BY timestamp,audit_id"],
    ["recycle_bin","SELECT * FROM recycle_bin ORDER BY deleted_at,recycle_id"]
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
    db.prepare("DELETE FROM areas"),
    db.prepare("DELETE FROM users"),
    db.prepare("DELETE FROM classrooms"),
    db.prepare("DELETE FROM holidays"),
    db.prepare("DELETE FROM settings"),
    db.prepare("DELETE FROM audit_log"),
    db.prepare("DELETE FROM recycle_bin")
  ]);

  const now=nowIso();
  await runDbBatches(db,t.classrooms.map(r=>db.prepare("INSERT INTO classrooms(classroom_id,class_name,created_at,updated_at) VALUES(?,?,?,?)")
    .bind(String(r.classroom_id),String(r.class_name),String(r.created_at||now),String(r.updated_at||now))));
  await runDbBatches(db,t.users.map(r=>db.prepare("INSERT INTO users(user_id,username,password,full_name,role,linked_classroom_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .bind(String(r.user_id),String(r.username).toLowerCase(),String(r.password),String(r.full_name),String(r.role),String(r.linked_classroom_id||""),String(r.created_at||now),String(r.updated_at||now))));
  await runDbBatches(db,t.areas.map(r=>db.prepare("INSERT INTO areas(area_id,area_name,responsible_classroom_id,created_at,updated_at) VALUES(?,?,?,?,?)")
    .bind(String(r.area_id),String(r.area_name),String(r.responsible_classroom_id),String(r.created_at||now),String(r.updated_at||now))));
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

async function systemStatus(env,u){
  role(u,["Admin"]);
  const db=env.DB;
  await ensureAuditTable(db);
  await ensureRecycleTable(db);

  const countSql = [
    ["users","SELECT COUNT(*) n FROM users"],
    ["classrooms","SELECT COUNT(*) n FROM classrooms"],
    ["areas","SELECT COUNT(*) n FROM areas"],
    ["assignments","SELECT COUNT(*) n FROM assignments"],
    ["inspections","SELECT COUNT(*) n FROM inspections"],
    ["auditLogs","SELECT COUNT(*) n FROM audit_log"],
    ["activeSessions","SELECT COUNT(*) n FROM sessions WHERE expires_at>?"],
    ["photos","SELECT COUNT(*) n FROM inspections WHERE photo_links_json IS NOT NULL AND photo_links_json<>'[]'"],
    ["recycleBin","SELECT COUNT(*) n FROM recycle_bin"]
  ];
  const counts={};
  for(const [key,sql] of countSql){
    const row = key==="activeSessions" ? await db.prepare(sql).bind(Date.now()).first() : await db.prepare(sql).first();
    counts[key]=Number(row?.n||0);
  }

  const settingsRows=await all(db,"SELECT key,value FROM settings WHERE key IN ('last_backup_at','last_backup_file_id','last_auto_backup_day','last_restore_at') ORDER BY key");
  const settings=Object.fromEntries(settingsRows.map(x=>[x.key,x.value]));
  const lastInspection=await db.prepare("SELECT inspection_date,status,updated_at FROM inspections ORDER BY updated_at DESC LIMIT 1").first();
  const lastAudit=await db.prepare("SELECT timestamp,action,actor_name FROM audit_log ORDER BY timestamp DESC LIMIT 1").first();

  let drive={configured:!!(env.GAS_DRIVE_URL&&env.DRIVE_GATEWAY_KEY),ok:false,message:"ยังไม่ได้ตั้งค่า Drive Gateway"};
  if(drive.configured){
    const timeout15 = () => new Promise((_,reject)=>setTimeout(()=>reject(Error("TIMEOUT")),15000));
    try{
      try{
        const ping=await Promise.race([gasDrive(env,"ping",{}),timeout15()]);
        drive={configured:true,ok:!!ping?.ok,message:"เชื่อมต่อได้",service:String(ping?.service||"RSD Clean Drive Gateway")};
      }catch(firstErr){
        if(String(firstErr?.message||firstErr).includes("ไม่พบ Drive API")){
          const res=await Promise.race([
            fetch(env.GAS_DRIVE_URL,{method:"GET",redirect:"follow",headers:{"Cache-Control":"no-cache"}}),
            timeout15()
          ]);
          const raw=await res.text();
          let body={};try{body=JSON.parse(raw);}catch{}
          drive={configured:true,ok:res.ok&&body?.ok===true,message:res.ok?(body?.ok===true?"เชื่อมต่อได้":"Gateway ตอบกลับไม่สมบูรณ์"):"HTTP "+res.status,service:String(body?.service||"")};
        }else{
          throw firstErr;
        }
      }
    }catch(e){
      drive={configured:true,ok:false,message:e?.message==="TIMEOUT"?"เชื่อมต่อเกิน 15 วินาที":String(e?.message||e)};
    }
  }

  const warnings=[];
  if(!drive.ok) warnings.push("Google Drive Gateway: "+drive.message);
  const lastBackup=String(settings.last_backup_at||"");
  if(!lastBackup){
    warnings.push("ยังไม่พบประวัติ Backup");
  }else{
    const age=Date.now()-new Date(lastBackup).getTime();
    if(!Number.isFinite(age)||age>48*3600000) warnings.push("Backup ล่าสุดเกิน 48 ชั่วโมงแล้ว");
  }
  if(counts.users===0) warnings.push("ไม่พบผู้ใช้งานในฐานข้อมูล");
  if(counts.areas>0&&counts.assignments===0) warnings.push("มีพื้นที่แล้วแต่ยังไม่มีการมอบหมายเวร");

  return{
    overall:warnings.length?"warning":"ok",
    serverTime:nowIso(),
    today:thaiDay(),
    d1:{ok:true,message:"เชื่อมต่อ D1 ได้"},
    drive,
    backup:{
      lastAt:lastBackup,
      lastFileId:String(settings.last_backup_file_id||""),
      lastAutoDay:String(settings.last_auto_backup_day||""),
      lastRestoreAt:String(settings.last_restore_at||"")
    },
    counts,
    lastInspection:lastInspection?{date:lastInspection.inspection_date,status:lastInspection.status,updatedAt:lastInspection.updated_at}:null,
    lastAudit:lastAudit?{timestamp:lastAudit.timestamp,action:lastAudit.action,actorName:lastAudit.actor_name}:null,
    warnings
  };
}

async function ensureRecycleTable(db){
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
  const deletedAt=nowIso(),expiresAt=Date.now()+30*24*3600000;
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
    await invalidateToday(env);
    await ensureToday(env);
  }else throw Error("ประเภทข้อมูลในถังขยะไม่รองรับ");
  await db.prepare("DELETE FROM recycle_bin WHERE recycle_id=?").bind(r.recycle_id).run();
  await invalidateToday(env);
  return{entityType:type,entityId:String(r.entity_id)};
}
async function purgeTrash(env,u,p){
  role(u,["Admin"]); const db=env.DB; await cleanRecycle(db);
  const id=String(p.recycleId||""); const r=await db.prepare("DELETE FROM recycle_bin WHERE recycle_id=?").bind(id).run();
  assert(Number(r.meta?.changes||0)>0,"ไม่พบรายการในถังขยะ");
  return true;
}

async function notifications(env,u,skipEnsure=false){
  const db=env.DB,items=[];
  const add=(type,title,message,action="",count=0)=>items.push({type,title,message,action,count});
  if(u.role==="Inspector"){
    if(!skipEnsure)await ensureToday(env);
    const row=await db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN i.status='ตรวจแล้ว' THEN 1 ELSE 0 END) done
      FROM inspections i JOIN inspection_inspectors ii ON ii.inspection_id=i.inspection_id
      WHERE i.inspection_date=? AND ii.user_id=?`).bind(thaiDay(),u.user_id).first();
    const total=Number(row?.total||0),done=Number(row?.done||0),pending=Math.max(0,total-done);
    if(pending) add("warning","งานตรวจยังไม่ครบ","วันนี้เหลือ "+pending+" พื้นที่จากทั้งหมด "+total+" พื้นที่","tasks",pending);
    else if(total) add("success","งานวันนี้ครบแล้ว","ตรวจครบ "+total+" พื้นที่แล้ว","tasks",0);
    else add("info","ไม่มีงานตรวจวันนี้","อาจเป็นวันหยุดหรือยังไม่ได้มอบหมายงาน","tasks",0);
  }else if(u.role==="Admin"||u.role==="Supervisor"){
    if(!skipEnsure)await ensureToday(env);
    const day=thaiDay();
    const row=await db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status='ตรวจแล้ว' THEN 1 ELSE 0 END) done FROM inspections WHERE inspection_date=?").bind(day).first();
    const total=Number(row?.total||0),done=Number(row?.done||0),pending=Math.max(0,total-done);
    if(pending) add("warning","มีงานตรวจค้าง","วันนี้ยังเหลือ "+pending+" งาน","reports",pending);
    const unassigned=await db.prepare("SELECT COUNT(*) n FROM areas a WHERE NOT EXISTS(SELECT 1 FROM assignments x WHERE x.area_id=a.area_id)").first();
    if(Number(unassigned?.n||0)>0) add("warning","พื้นที่ยังไม่มีผู้ตรวจ",Number(unassigned.n)+" พื้นที่ยังไม่มีการมอบหมาย","admin",Number(unassigned.n));
    const b=await db.prepare("SELECT value FROM settings WHERE key='last_backup_at'").first();
    const last=String(b?.value||"");
    if(!last) add("warning","ยังไม่มี Backup","ควรสำรองข้อมูลระบบ","admin",1);
    else if(Date.now()-new Date(last).getTime()>48*3600000) add("warning","Backup เกิน 48 ชั่วโมง","ควรตรวจสอบระบบสำรองข้อมูล","admin",1);
    if(u.role==="Admin"){ await cleanRecycle(db); const trash=await db.prepare("SELECT COUNT(*) n FROM recycle_bin").first(); if(Number(trash?.n||0)>0) add("info","มีข้อมูลในถังขยะ",Number(trash.n)+" รายการจะถูกลบถาวรเมื่อครบ 30 วัน","admin",Number(trash.n)); }
  }else if(u.role==="Teacher"){
    const rows=await all(db,"SELECT score,inspection_date,meta_json FROM inspections WHERE status='ตรวจแล้ว' ORDER BY inspection_date DESC LIMIT 100");
    const mine=rows.filter(x=>parseJson(x.meta_json,{}).classId===u.linked_classroom_id);
    const improve=mine.filter(x=>Number(x.score)===1).slice(0,5);
    if(improve.length) add("warning","มีผลประเมินที่ควรติดตาม","พบ "+improve.length+" ผลตรวจระดับปรับปรุงล่าสุด","teacher",improve.length);
    else add("success","สถานะห้องเรียน","ยังไม่พบผลระดับปรับปรุงในรายการล่าสุด","teacher",0);
  }
  return{items,unread:items.filter(x=>x.type==="warning").reduce((n,x)=>n+Math.max(1,Number(x.count||0)),0),updatedAt:nowIso()};
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
  return { InspectionID:i.inspection_id,AssignmentID:"",InspectionDate:i.inspection_date,Status:i.status,Rating:i.rating,Score:Number(i.score||0),Notes:i.note||"",PhotoLinks:parseJson(i.photo_links_json,[]).map(id=>({id})),meta:m };
}
async function displayOne(db,i){ const team=await all(db,"SELECT user_id,user_name FROM inspection_inspectors WHERE inspection_id=? ORDER BY user_name",i.inspection_id); return inspectionDisplay(i,team); }
async function ownedTask(env,u,id){ role(u,["Inspector"]); const db=env.DB; const i=await db.prepare(`SELECT i.* FROM inspections i JOIN inspection_inspectors ii ON ii.inspection_id=i.inspection_id WHERE i.inspection_id=? AND ii.user_id=?`).bind(id,u.user_id).first(); assert(i,"งานนี้ไม่ใช่งานที่ได้รับมอบหมาย"); assert(i.inspection_date===thaiDay(),"แก้ไขได้เฉพาะงานวันนี้"); return i; }
async function tasksReady(env,u){
  const day=thaiDay(),db=env.DB;
  const [rows,teams]=await Promise.all([
    all(db,`SELECT DISTINCT i.* FROM inspections i
      JOIN inspection_inspectors mine ON mine.inspection_id=i.inspection_id
      WHERE i.inspection_date=? AND mine.user_id=?
      ORDER BY i.inspection_id`,day,u.user_id),
    all(db,`SELECT team.inspection_id,team.user_id,team.user_name
      FROM inspections i
      JOIN inspection_inspectors mine ON mine.inspection_id=i.inspection_id AND mine.user_id=?
      JOIN inspection_inspectors team ON team.inspection_id=i.inspection_id
      WHERE i.inspection_date=?
      ORDER BY team.inspection_id,team.user_name`,u.user_id,day)
  ]);
  const map=new Map();
  teams.forEach(x=>{if(!map.has(x.inspection_id))map.set(x.inspection_id,[]);map.get(x.inspection_id).push(x);});
  return rows.map(i=>inspectionDisplay(i,map.get(i.inspection_id)||[]));
}
async function tasks(env,u){ role(u,["Inspector"]); await ensureToday(env); return tasksReady(env,u); }
async function inspectorHome(env,u){
  role(u,["Inspector"]); await ensureToday(env);
  const [taskRows,rewards,notice]=await Promise.all([
    tasksReady(env,u),
    all(env.DB,"SELECT * FROM rewards_log WHERE reference_id=? ORDER BY timestamp",u.user_id),
    notifications(env,u,true)
  ]);
  return{tasks:taskRows,rewards:rewards.map(rewardRow),notifications:notice,updatedAt:nowIso()};
}
async function qrTask(env,u,p){ role(u,["Inspector"]); const aid=await qrAreaId(env,p.token); await ensureToday(env); const i=await env.DB.prepare(`SELECT i.* FROM inspections i JOIN inspection_inspectors ii ON ii.inspection_id=i.inspection_id WHERE i.inspection_date=? AND i.area_id=? AND ii.user_id=?`).bind(thaiDay(),aid,u.user_id).first(); assert(i,"พื้นที่นี้ไม่ได้อยู่ในงานที่คุณได้รับมอบหมายวันนี้"); return displayOne(env.DB,i); }
async function visible(env,u,i){ if(!u) return false; if(["Admin","Supervisor"].includes(u.role)) return true; if(u.role==="Inspector") return !!(await env.DB.prepare("SELECT 1 x FROM inspection_inspectors WHERE inspection_id=? AND user_id=?").bind(i.inspection_id,u.user_id).first()); const m=parseJson(i.meta_json,{}); return u.role==="Teacher" && m.classId===u.linked_classroom_id; }

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
    const old=m.Areas.find(x=>x.AreaID===id); assert(old,"ไม่พบรายการ"); assert(!m.Assignments.some(a=>a.AreaID===id),"ยกเลิกงานมอบหมายก่อน");
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

async function password(env,u,p){ const c=parseJson(u.password,{}); assert(equalLoose(c.hash,await hmac(env,text(p.oldProof,200))),"รหัสผ่านเดิมไม่ถูกต้อง"); const pass=await credentialJson(env,p.credential); await env.DB.prepare("UPDATE users SET password=?,updated_at=? WHERE user_id=?").bind(pass,nowIso(),u.user_id).run(); await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(u.user_id).run(); return true; }
async function saveHolidays(env,u,p){ role(u,["Admin"]); assert(Array.isArray(p.dates)&&p.dates.length<=400,"วันหยุดมากเกินไป"); const dates=[...new Set(p.dates.map(validateDate))]; await env.DB.prepare("DELETE FROM holidays").run(); if(dates.length) await env.DB.batch(dates.map(d=>env.DB.prepare("INSERT INTO holidays(holiday_date) VALUES(?)").bind(d))); await invalidateToday(env); return true; }

async function bulkPlan(env,table,inputs,needCred){
  const m=await masterData(env.DB), rows=[], prepared=[]; assert(["Users","Classrooms","Areas"].includes(table),"ตารางไม่ถูกต้อง"); assert(Array.isArray(inputs)&&inputs.length>=1&&inputs.length<=100,"นำเข้าได้ครั้งละ 1–100 รายการ");
  const seen=new Set();
  for(let i=0;i<inputs.length;i++){
    const x=inputs[i]||{}, errors=[], display={};
    if(table==="Classrooms") { const name=text(x.ClassName||x["ชื่อห้องเรียน"]||"",200); display.ClassName=name; if(!name) errors.push("ชื่อห้องเรียนว่าง"); const k=name.toLowerCase(); if(seen.has(k)||m.Classrooms.some(c=>c.ClassName.toLowerCase()===k)) errors.push("ชื่อห้องเรียนซ้ำ"); seen.add(k); if(!errors.length) prepared.push({classroom_id:uuid(),class_name:name}); }
    if(table==="Areas") { const name=text(x.AreaName||x["ชื่อพื้นที่"]||"",200), cls=text(x.ClassName||x["ห้องรับผิดชอบ"]||"",200); display.AreaName=name; display.ClassName=cls; const c=m.Classrooms.find(c=>c.ClassName===cls||c.ClassroomID===cls); if(!name) errors.push("ชื่อพื้นที่ว่าง"); if(!c) errors.push("ไม่พบห้องรับผิดชอบ"); const k=name.toLowerCase(); if(seen.has(k)||m.Areas.some(a=>a.AreaName.toLowerCase()===k)) errors.push("ชื่อพื้นที่ซ้ำ"); seen.add(k); if(!errors.length) prepared.push({area_id:uuid(),area_name:name,responsible_classroom_id:c.ClassroomID}); }
    if(table==="Users") { const username=text(x.Username||"",80).toLowerCase(), full=text(x.FullName||"",200), roleRaw=text(x.Role||"",40), cls=text(x.ClassName||"",200); const map={"ผู้ดูแลระบบ":"Admin","หัวหน้างาน":"Supervisor","ผู้บริหาร":"Supervisor","ผู้ตรวจ":"Inspector","ครูประจำชั้น":"Teacher"}; const rr=map[roleRaw]||roleRaw; display.Username=username;display.FullName=full;display.Role=rr;display.ClassName=cls; if(!/^[a-z0-9._@-]{3,80}$/.test(username)) errors.push("Username ไม่ถูกต้อง"); if(!full) errors.push("ชื่อ–สกุลว่าง"); if(!ROLES.includes(rr)) errors.push("Role ไม่ถูกต้อง"); let c=null; if(rr==="Teacher"){ c=m.Classrooms.find(c=>c.ClassName===cls||c.ClassroomID===cls); if(!c) errors.push("Teacher ต้องระบุห้องเรียน"); } else if(cls) errors.push("สิทธิ์นี้ต้องเว้นห้องเรียน"); const k=username; if(seen.has(k)||m.Users.some(u=>u.Username.toLowerCase()===k)) errors.push("Username ซ้ำ"); seen.add(k); if(needCred&&!x.credential) errors.push("ไม่พบ credential"); if(!errors.length) prepared.push({user_id:uuid(),username,full_name:full,role:rr,linked_classroom_id:c?.ClassroomID||"",credential:x.credential}); }
    rows.push({row:i+2,errors,display});
  }
  return {valid:rows.every(r=>!r.errors.length),rows,total:rows.length,prepared};
}
async function bulkPreview(env,u,p){ role(u,["Admin"]); const r=await bulkPlan(env,p.table,p.rows,false); return {valid:r.valid,rows:r.rows,total:r.total}; }
async function bulkCreate(env,u,p){ role(u,["Admin"]); const r=await bulkPlan(env,p.table,p.rows,true); if(!r.valid) return {saved:false,valid:false,rows:r.rows,total:r.total}; const db=env.DB; const stmts=[];
  if(p.table==="Classrooms") r.prepared.forEach(x=>stmts.push(db.prepare("INSERT INTO classrooms(classroom_id,class_name,created_at,updated_at) VALUES(?,?,?,?)").bind(x.classroom_id,x.class_name,nowIso(),nowIso())));
  if(p.table==="Areas") r.prepared.forEach(x=>stmts.push(db.prepare("INSERT INTO areas(area_id,area_name,responsible_classroom_id,created_at,updated_at) VALUES(?,?,?,?,?)").bind(x.area_id,x.area_name,x.responsible_classroom_id,nowIso(),nowIso())));
  if(p.table==="Users") for(const x of r.prepared) stmts.push(db.prepare("INSERT INTO users(user_id,username,password,full_name,role,linked_classroom_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(x.user_id,x.username,await credentialJson(env,x.credential),x.full_name,x.role,x.linked_classroom_id,nowIso(),nowIso()));
  await db.batch(stmts); await invalidateToday(env); return {saved:true,count:r.prepared.length}; }

async function uploadStart(env,u,p,request){
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
  const db=env.DB,i=await ownedTask(env,u,p.id); assert(Number(p.version)===Number(i.version),"ข้อมูลถูกเปลี่ยนแล้ว กรุณาโหลดใหม่"); assert(["รอตรวจ","ตรวจแล้ว"].includes(p.status),"สถานะไม่ถูกต้อง"); const score=p.status==="ตรวจแล้ว"?Number(p.score):0; assert((Number.isInteger(score)&&score>=1&&score<=3)||p.status==="รอตรวจ","เลือกระดับประเมิน");
  const oldPhotos=parseJson(i.photo_links_json,[]); let photos=oldPhotos;
  if(p.uploadTicket){ const t=await db.prepare("SELECT * FROM upload_tickets WHERE ticket=?").bind(String(p.uploadTicket)).first(); assert(t&&t.user_id===u.user_id&&t.inspection_id===i.inspection_id&&Number(t.expires_at)>Date.now(),"สิทธิ์อัปโหลดหมดอายุ"); await gasDrive(env,"verifyUpload",{ticket:t.ticket,fileId:t.file_id,size:Number(t.size),mime:t.mime,inspectionId:i.inspection_id}); photos=[t.file_id]; }
  else if(p.removePhoto===true) photos=[];
  const stamp=nowIso(), meta=parseJson(i.meta_json,{}); meta.note=text(p.notes,2000); meta.version=Number(i.version)+1; meta.completedAt=score?stamp:""; meta.completedById=score?u.user_id:""; meta.completedByName=score?u.full_name:"";
  await db.prepare(`UPDATE inspections SET status=?,rating=?,score=?,note=?,meta_json=?,photo_links_json=?,version=?,completed_at=?,completed_by_id=?,completed_by_name=?,updated_at=? WHERE inspection_id=?`)
    .bind(p.status,["","ปรับปรุง","ปานกลาง","ยอดเยี่ยม"][score],score,meta.note,JSON.stringify(meta),JSON.stringify(photos),meta.version,meta.completedAt,meta.completedById,meta.completedByName,stamp,i.inspection_id).run();
  if(p.uploadTicket) { await db.prepare("DELETE FROM upload_tickets WHERE ticket=?").bind(String(p.uploadTicket)).run(); gasDrive(env,"consumeUpload",{ticket:String(p.uploadTicket)}).catch(()=>{}); }
  const trash=oldPhotos.filter(id=>!photos.includes(id)); if(trash.length&&env.GAS_DRIVE_URL) gasDrive(env,"trashFiles",{fileIds:trash}).catch(()=>{});
  const updated=await db.prepare("SELECT * FROM inspections WHERE inspection_id=?").bind(i.inspection_id).first();
  return {inspection:await displayOne(db,updated),warning:""};
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
function activeDates(ins){ return new Set(ins.filter(i=>i.status==="ตรวจแล้ว").map(i=>i.inspection_date)); }
async function rewardRecords(env,ins,teamMap){
  const ad=activeDates(ins); ins=ins.filter(i=>ad.has(i.inspection_date)); const rewards=[],classes={},inspectors={};
  const add=async(ref,key,name,details)=>rewards.push({log_id:await digest(ref+"|"+key),timestamp:details.at||nowIso(),reference_id:ref,achievement:name,details_json:JSON.stringify(details)});
  for(const i of ins){ const m=metaOf(i); (classes[m.classId]||(classes[m.classId]=[])).push(i); for(const uid of inspectorIdsFrom(i,teamMap)){ const k=uid+"|"+i.inspection_date; (inspectors[k]||(inspectors[k]=[])).push(i); } }
  for(const [ref,list] of Object.entries(classes)){
    list.sort((a,b)=>a.inspection_date.localeCompare(b.inspection_date)||a.inspection_id.localeCompare(b.inspection_id)); let streak=0,count=0,improving=0,star=false,improved=false;
    for(const i of list){ const m=metaOf(i),s=i.status==="ตรวจแล้ว"?Number(i.score):0; if(s===3){streak++;count++;if(improving>0)improving++;}else{streak=0;improving=s===1?1:0;} if(streak>=5&&!star){await add(ref,"star","ดาวสะอาด",{at:m.completedAt,description:"ยอดเยี่ยม 5 ผลตรวจติดต่อกัน"});star=true;} if([10,20,50].includes(count)&&s===3)await add(ref,"consistent:"+count,"ความสม่ำเสมอ "+count+" ครั้ง",{at:m.completedAt,count}); if(improving===4&&!improved){await add(ref,"improve","พัฒนาการยอดเยี่ยม",{at:m.completedAt,description:"ปรับปรุง แล้วได้ยอดเยี่ยม 3 ผลตรวจติดต่อกัน"});improved=true;} }
  }
  for(const [key,items] of Object.entries(inspectors)){ const [uid,date]=key.split("|"); const ok=items.length&&items.every(i=>i.status==="ตรวจแล้ว"&&metaOf(i).completedAt&&new Intl.DateTimeFormat("en-GB",{timeZone:TZ,hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(metaOf(i).completedAt))<"10:00:00"); if(ok) await add(uid,"perfect:"+date,"Perfect Day",{at:date+"T10:00:00+07:00",date,count:items.length}); }
  return rewards;
}
async function rebuildRewards(env){ const {ins,teamMap}=await inspectionBundle(env.DB), desired=await rewardRecords(env,ins,teamMap), existing=await all(env.DB,"SELECT * FROM rewards_log"), old=new Map(existing.map(x=>[x.log_id,x.timestamp])); const stmts=[env.DB.prepare("DELETE FROM rewards_log")]; for(const r of desired) stmts.push(env.DB.prepare("INSERT INTO rewards_log(log_id,timestamp,reference_id,achievement,details_json) VALUES(?,?,?,?,?)").bind(r.log_id,old.get(r.log_id)||r.timestamp,r.reference_id,r.achievement,r.details_json)); await env.DB.batch(stmts); }
function leaderboard(ins){ const groups={}; ins.filter(i=>i.status==="ตรวจแล้ว").forEach(i=>{const m=metaOf(i),g=groups[m.classId]||(groups[m.classId]={id:m.classId,name:m.className,total:0,score:0});g.total++;g.score+=Number(i.score||0);}); return Object.values(groups).map(g=>({...g,avg:g.total?g.score/g.total:0})).sort((a,b)=>b.avg-a.avg||b.total-a.total||a.name.localeCompare(b.name,"th")); }
async function monthly(env,allIns,month){ const ad=activeDates(allIns), firstNext=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)), last=new Date(firstNext.getTime()-86400000).toISOString().slice(0,10), cutoff=last<thaiDay()?last:thaiDay(), expected=[...ad].filter(d=>d.startsWith(month)&&d<=cutoff).sort(),groups={}; allIns.filter(i=>i.inspection_date.startsWith(month)&&i.inspection_date<=cutoff).forEach(i=>{const m=metaOf(i),g=groups[m.classId]||(groups[m.classId]={id:m.classId,name:m.className,total:0,done:0,improve:0,days:new Set()}); if(!ad.has(i.inspection_date))return;g.total++;g.days.add(i.inspection_date);if(i.status==="ตรวจแล้ว"){g.done++;if(Number(i.score)===1)g.improve++;}}); return Object.values(groups).map(g=>{const missingDays=expected.filter(d=>!g.days.has(d)).length,complete=expected.length>0&&g.total>0&&g.done===g.total&&missingDays===0;return{id:g.id,name:g.name,total:g.total,done:g.done,improve:g.improve,missingDays,inspectionDays:expected.length,provisional:last>=thaiDay(),medal:expected.length===0?"ไม่มีการตรวจในเดือนนี้":!complete?"ข้อมูลไม่ครบ":g.improve===0?"เหรียญทอง":g.improve<=3?"เหรียญเงิน":g.improve<=5?"เหรียญทองแดง":"ไม่ผ่านเกณฑ์"};}); }
async function dashboard(env,u,d){
  if(d===thaiDay())await ensureToday(env);
  const start=shiftDate(d,-29);
  const [{ins},areas]=await Promise.all([
    inspectionBundleRange(env.DB,start,d),
    env.DB.prepare("SELECT COUNT(*) n FROM areas").first()
  ]);
  const ad=activeDates(ins),isHoliday=d<thaiDay()&&!ad.has(d);
  const selected=ins.filter(i=>i.inspection_date===d&&!isHoliday&&(!u||u.role!=="Teacher"||metaOf(i).classId===u.linked_classroom_id));
  const done=selected.filter(i=>i.status==="ตรวจแล้ว"),counts=[3,2,1].map(n=>done.filter(i=>Number(i.score)===n).length);
  const recent=done.sort((a,b)=>String(metaOf(b).completedAt).localeCompare(String(metaOf(a).completedAt))).slice(0,50).map(i=>({date:i.inspection_date,area:metaOf(i).areaName,className:metaOf(i).className,rating:i.rating,score:i.score}));
  return{date:d,isHoliday,areas:Number(areas?.n||0),scheduled:selected.length,done:done.length,pending:selected.length-done.length,counts,feed:u?recent:[],leaders:leaderboard(ins).slice(0,5),updatedAt:nowIso()};
}
async function teacher(env,u){ role(u,["Teacher"]); await ensureToday(env); const {ins}=await inspectionBundle(env.DB),ad=activeDates(ins); const filtered=ins.filter(i=>metaOf(i).classId===u.linked_classroom_id&&(i.inspection_date===thaiDay()||ad.has(i.inspection_date))).sort((a,b)=>b.inspection_date.localeCompare(a.inspection_date)).slice(0,200); return{inspections:await Promise.all(filtered.map(i=>displayOne(env.DB,i))),rewards:(await all(env.DB,"SELECT * FROM rewards_log WHERE reference_id=?",u.linked_classroom_id)).map(rewardRow),monthly:(await monthly(env,ins,thaiDay().slice(0,7))).filter(r=>r.id===u.linked_classroom_id)}; }
async function report(env,u,start,end){
  role(u,["Admin","Supervisor"]); assert(start<=end&&end<=thaiDay(),"ช่วงวันที่ไม่ถูกต้อง"); assert((new Date(end)-new Date(start))<=366*86400000,"เลือกช่วงไม่เกิน 366 วัน");
  await ensureToday(env);
  const month=end.slice(0,7),monthStart=month+"-01",monthEnd=monthLastDay(month)<thaiDay()?monthLastDay(month):thaiDay();
  const [{ins,teamMap},{ins:monthIns},users,rewardRows]=await Promise.all([
    inspectionBundleRange(env.DB,start,end),
    inspectionBundleRange(env.DB,monthStart,monthEnd),
    all(env.DB,"SELECT user_id,full_name FROM users"),
    all(env.DB,"SELECT * FROM rewards_log ORDER BY timestamp")
  ]);
  const ad=activeDates(ins),filtered=ins.filter(i=>ad.has(i.inspection_date)),done=filtered.filter(i=>i.status==="ตรวจแล้ว"),areas={},people={},um=new Map(users.map(x=>[x.user_id,x.full_name]));
  for(const i of filtered){const m=metaOf(i),ids=inspectorIdsFrom(i,teamMap),names=inspectorNamesFrom(i,teamMap);ids.forEach((uid,idx)=>{const g=people[uid]||(people[uid]={name:names[idx]||um.get(uid)||"—",scheduled:0,done:0});g.scheduled++;if(i.status==="ตรวจแล้ว")g.done++;});if(i.status==="ตรวจแล้ว"&&Number(i.score)===1){const a=areas[m.areaId]||(areas[m.areaId]={name:m.areaName,count:0});a.count++;}}
  return{start,end,leaders:leaderboard(done),watch:Object.values(areas).sort((a,b)=>b.count-a.count),inspectors:Object.values(people),monthly:await monthly(env,monthIns,month),month,rewards:rewardRows.map(rewardRow)};
}
