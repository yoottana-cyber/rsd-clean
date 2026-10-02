const TZ = "Asia/Bangkok";
const SESSION_MS = 8 * 3600000;
const REMEMBER_SESSION_MS = 30 * 24 * 3600000;
const MAX_IMAGE = 100 * 1024 * 1024;
const ITERATIONS = 600000;
const ROLES = ["Admin", "Supervisor", "Inspector", "Teacher"];
const enc = new TextEncoder();

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
    if (JSON.stringify(input?.payload || {}).length > 100000) throw Error("คำขอใหญ่เกินไป");
    const action = String(input?.action || "");
    const payload = input?.payload || {};
    const token = String(input?.token || "");
    const data = await dispatch(env, action, payload, token, request);
    if (!["challenge","login","publicDashboard"].includes(action)) {
      const job = autoBackupIfDue(env).catch(e => console.error("AUTO_BACKUP_FAILED", e));
      if (typeof context.waitUntil === "function") context.waitUntil(job);
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
  };
  assert(handlers[action], "ไม่พบ API");
  const result = await handlers[action]();
  if (AUDIT_ACTIONS.has(action)) {
    try { await writeAudit(env,u,action,p,result); }
    catch (e) { console.error("AUDIT_WRITE_FAILED",e); }
  }
  return result;
}

async function login(env,p) {
  const db=env.DB, username=text(p.username,80).toLowerCase();
  const u=await db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").bind(username).first();
  const c=parseJson(u?.password,{});
  assert(u && equalLoose(c.hash, await hmac(env,text(p.proof,200))), "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
  await db.prepare("DELETE FROM sessions WHERE user_id=? OR expires_at<?").bind(u.user_id,Date.now()).run();
  const token=uuid()+uuid(), th=await digest(token), exp=Date.now()+(p.remember===true?REMEMBER_SESSION_MS:SESSION_MS);
  await db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,credential_hash,created_at) VALUES(?,?,?,?,?)")
    .bind(th,u.user_id,exp,await digest(u.password),Date.now()).run();
  return { token, user:publicUser(u), mustChange:c.scheme === "bootstrap" };
}
async function auth(env, token) {
  assert(token,"SESSION_EXPIRED"); const db=env.DB, th=await digest(token);
  const s=await db.prepare("SELECT s.*,u.* FROM sessions s JOIN users u ON u.user_id=s.user_id WHERE s.token_hash=?").bind(th).first();
  if (!s || Number(s.expires_at)<Date.now() || !equalLoose(s.credential_hash,await digest(s.password))) {
    await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(th).run(); throw Error("SESSION_EXPIRED");
  }
  return s;
}
function role(u, allowed) { assert(u && allowed.includes(u.role),"ไม่มีสิทธิ์ใช้งาน"); }
async function all(db,sql,...args) { const r=await db.prepare(sql).bind(...args).all(); return r.results || []; }

const AUDIT_ACTIONS = new Set(["saveMaster","bulkCreate","deleteMaster","assign","setAssignmentDays","saveInspection","password","holidays","backupExport"]);

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
  if(action==="backupExport")return{entityType:"Backup",entityId:"manual",details:{createdAt:result?.createdAt||nowIso()}};
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
    ["audit_log","SELECT * FROM audit_log ORDER BY timestamp,audit_id"]
  ];
  const tables={};
  for(const [name,sql] of specs)tables[name]=await all(env.DB,sql);
  return{format:"rsd-clean-d1-backup-v1",createdAt:nowIso(),tables};
}
async function backupExport(env,u){role(u,["Admin"]);return buildBackupBundle(env);}
async function autoBackupIfDue(env){
  if(!env.GAS_DRIVE_URL||!env.DRIVE_GATEWAY_KEY)return;
  const day=thaiDay(),key="last_auto_backup_day";
  const lock=await env.DB.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value<>excluded.value").bind(key,day).run();
  if(!Number(lock?.meta?.changes||0))return;
  try{
    const bundle=await buildBackupBundle(env),content=JSON.stringify(bundle),filename="RSD-Clean-D1-auto-"+day+".json";
    const saved=await gasDrive(env,"saveBackup",{filename,content});
    await env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('last_backup_at',?),('last_backup_file_id',?)")
      .bind(bundle.createdAt,String(saved.fileId||"")).run();
    await ensureAuditTable(env.DB);
    await env.DB.prepare("INSERT INTO audit_log(audit_id,timestamp,actor_user_id,actor_name,actor_role,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(uuid(),bundle.createdAt,"","ระบบ","System","backupAuto","Backup",String(saved.fileId||""),JSON.stringify({filename,size:Number(saved.size||content.length)})).run();
  }catch(e){
    await env.DB.prepare("DELETE FROM settings WHERE key=? AND value=?").bind(key,day).run();
    throw e;
  }
}

async function schoolDay(env,date) {
  const w=weekday(date); if(w===0||w===6) return false;
  return !(await env.DB.prepare("SELECT 1 x FROM holidays WHERE holiday_date=?").bind(date).first());
}
async function ensureToday(env) {
  const db=env.DB,date=thaiDay(); if(!(await schoolDay(env,date))) return;
  const w=weekday(date);
  const rows=await all(db,`SELECT a.area_id,a.area_name,a.responsible_classroom_id,c.class_name,
    asn.user_id,u.full_name,asn.assignment_id,asn.days
    FROM assignments asn JOIN users u ON u.user_id=asn.user_id
    JOIN areas a ON a.area_id=asn.area_id JOIN classrooms c ON c.classroom_id=a.responsible_classroom_id
    WHERE u.role='Inspector' ORDER BY a.area_id,u.full_name`);
  const byArea=new Map();
  for(const r of rows){ if(!dutyDays(r.days).includes(w)) continue; if(!byArea.has(r.area_id)) byArea.set(r.area_id,[]); byArea.get(r.area_id).push(r); }
  for(const [areaId,team] of byArea){
    let i=await db.prepare("SELECT * FROM inspections WHERE area_id=? AND inspection_date=?").bind(areaId,date).first();
    if(!i){
      const first=team[0], id=date+"_"+areaId, now=nowIso();
      const meta={ note:"",areaId,areaName:first.area_name,classId:first.responsible_classroom_id,className:first.class_name,
        inspectorIds:team.map(x=>x.user_id),inspectorNames:team.map(x=>x.full_name),createdAt:now,completedAt:"",version:0 };
      await db.prepare(`INSERT OR IGNORE INTO inspections(inspection_id,area_id,inspection_date,status,rating,score,note,meta_json,photo_links_json,version,completed_at,completed_by_id,completed_by_name,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,areaId,date,"รอตรวจ","",0,"",JSON.stringify(meta),"[]",0,"","","",now,now).run();
      i=await db.prepare("SELECT * FROM inspections WHERE area_id=? AND inspection_date=?").bind(areaId,date).first();
    }
    if(i.status === "รอตรวจ"){
      await db.prepare("DELETE FROM inspection_inspectors WHERE inspection_id=?").bind(i.inspection_id).run();
      const stmts=team.map(x=>db.prepare("INSERT OR IGNORE INTO inspection_inspectors(inspection_id,user_id,user_name) VALUES(?,?,?)").bind(i.inspection_id,x.user_id,x.full_name));
      if(stmts.length) await db.batch(stmts);
      const meta=parseJson(i.meta_json,{}); meta.inspectorIds=team.map(x=>x.user_id); meta.inspectorNames=team.map(x=>x.full_name);
      await db.prepare("UPDATE inspections SET meta_json=?,updated_at=? WHERE inspection_id=?").bind(JSON.stringify(meta),nowIso(),i.inspection_id).run();
    }
  }
}
function inspectionDisplay(i, inspectors=[]) {
  const m=parseJson(i.meta_json,{}); m.note=i.note||m.note||""; m.version=Number(i.version||0); m.completedAt=i.completed_at||m.completedAt||"";
  if(inspectors.length){ m.inspectorIds=inspectors.map(x=>x.user_id); m.inspectorNames=inspectors.map(x=>x.user_name); }
  return { InspectionID:i.inspection_id,AssignmentID:"",InspectionDate:i.inspection_date,Status:i.status,Rating:i.rating,Score:Number(i.score||0),Notes:i.note||"",PhotoLinks:parseJson(i.photo_links_json,[]).map(id=>({id})),meta:m };
}
async function displayOne(db,i){ const team=await all(db,"SELECT user_id,user_name FROM inspection_inspectors WHERE inspection_id=? ORDER BY user_name",i.inspection_id); return inspectionDisplay(i,team); }
async function ownedTask(env,u,id){ role(u,["Inspector"]); const db=env.DB; const i=await db.prepare(`SELECT i.* FROM inspections i JOIN inspection_inspectors ii ON ii.inspection_id=i.inspection_id WHERE i.inspection_id=? AND ii.user_id=?`).bind(id,u.user_id).first(); assert(i,"งานนี้ไม่ใช่งานที่ได้รับมอบหมาย"); assert(i.inspection_date===thaiDay(),"แก้ไขได้เฉพาะงานวันนี้"); return i; }
async function tasks(env,u){ role(u,["Inspector"]); await ensureToday(env); const rows=await all(env.DB,`SELECT DISTINCT i.* FROM inspections i JOIN inspection_inspectors ii ON ii.inspection_id=i.inspection_id WHERE i.inspection_date=? AND ii.user_id=? ORDER BY i.inspection_id`,thaiDay(),u.user_id); return Promise.all(rows.map(i=>displayOne(env.DB,i))); }
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
  } return true;
}

async function deleteMaster(env,u,p){
  role(u,["Admin"]); const db=env.DB,m=await masterData(db), id=String(p.id||""); assert(["Users","Classrooms","Areas","Assignments"].includes(p.table),"ตารางไม่ถูกต้อง");
  if(p.table==="Users") { const old=m.Users.find(x=>x.UserID===id); assert(old,"ไม่พบรายการ"); assert(id!==u.user_id,"ลบบัญชีตนเองไม่ได้"); assert(!m.Assignments.some(a=>a.UserID===id),"ยกเลิกงานมอบหมายก่อน"); assert(old.Role!=="Admin"||m.Users.filter(x=>x.Role==="Admin").length>1,"ต้องมี Admin"); await db.prepare("DELETE FROM users WHERE user_id=?").bind(id).run(); }
  if(p.table==="Classrooms") { assert(m.Classrooms.some(x=>x.ClassroomID===id),"ไม่พบรายการ"); assert(!m.Areas.some(a=>a.ResponsibleClassroomID===id)&&!m.Users.some(x=>x.LinkedClassroomID===id),"ยังมีข้อมูลอ้างอิงห้องนี้"); await db.prepare("DELETE FROM classrooms WHERE classroom_id=?").bind(id).run(); }
  if(p.table==="Areas") { assert(m.Areas.some(x=>x.AreaID===id),"ไม่พบรายการ"); assert(!m.Assignments.some(a=>a.AreaID===id),"ยกเลิกงานมอบหมายก่อน"); await db.prepare("DELETE FROM areas WHERE area_id=?").bind(id).run(); }
  if(p.table==="Assignments") { assert(m.Assignments.some(x=>x.AssignmentID===id),"ไม่พบรายการ"); await db.prepare("DELETE FROM assignments WHERE assignment_id=?").bind(id).run(); }
  return true;
}

async function assign(env,u,p){
  role(u,["Admin"]); const db=env.DB,m=await masterData(db), users=[...new Set((p.userIds||[]).map(String))], areas=[...new Set((p.areaIds||[]).map(String))], days=dutyText(Array.isArray(p.days)?p.days.join(","):p.days);
  assert(users.length&&areas.length,"เลือกผู้ตรวจและพื้นที่"); users.forEach(id=>assert(m.Users.some(x=>x.UserID===id&&x.Role==="Inspector"),"ผู้ตรวจไม่ถูกต้อง")); areas.forEach(id=>assert(m.Areas.some(x=>x.AreaID===id),"ไม่พบพื้นที่"));
  let added=0,merged=0; const stmts=[];
  for(const uid of users) for(const aid of areas){ const old=m.Assignments.find(a=>a.UserID===uid&&a.AreaID===aid); if(old){ const union=[...new Set([...dutyDays(old.Days),...dutyDays(days)])].sort().join(","); stmts.push(db.prepare("UPDATE assignments SET days=?,updated_at=? WHERE assignment_id=?").bind(union,nowIso(),old.AssignmentID)); merged++; } else { stmts.push(db.prepare("INSERT INTO assignments(assignment_id,user_id,area_id,days,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(uuid(),uid,aid,days,nowIso(),nowIso())); added++; } }
  if(stmts.length) await db.batch(stmts); await ensureToday(env); return {added,merged};
}
async function setAssignmentDays(env,u,p){ role(u,["Admin"]); const days=dutyText(Array.isArray(p.days)?p.days.join(","):p.days); const r=await env.DB.prepare("UPDATE assignments SET days=?,updated_at=? WHERE assignment_id=?").bind(days,nowIso(),String(p.id||"")).run(); assert(r.meta.changes,"ไม่พบรายการ"); await ensureToday(env); return true; }

async function password(env,u,p){ const c=parseJson(u.password,{}); assert(equalLoose(c.hash,await hmac(env,text(p.oldProof,200))),"รหัสผ่านเดิมไม่ถูกต้อง"); const pass=await credentialJson(env,p.credential); await env.DB.prepare("UPDATE users SET password=?,updated_at=? WHERE user_id=?").bind(pass,nowIso(),u.user_id).run(); await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(u.user_id).run(); return true; }
async function saveHolidays(env,u,p){ role(u,["Admin"]); assert(Array.isArray(p.dates)&&p.dates.length<=400,"วันหยุดมากเกินไป"); const dates=[...new Set(p.dates.map(validateDate))]; await env.DB.prepare("DELETE FROM holidays").run(); if(dates.length) await env.DB.batch(dates.map(d=>env.DB.prepare("INSERT INTO holidays(holiday_date) VALUES(?)").bind(d))); return true; }

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
  await db.batch(stmts); return {saved:true,count:r.prepared.length}; }

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
  let warning=""; try{await rebuildRewards(env);}catch(e){warning="บันทึกสำเร็จ แต่รางวัลรอประมวลผลใหม่";}
  const updated=await db.prepare("SELECT * FROM inspections WHERE inspection_id=?").bind(i.inspection_id).first(); return {inspection:await displayOne(db,updated),warning};
}
async function photo(env,u,p){ const i=await env.DB.prepare("SELECT * FROM inspections WHERE inspection_id=?").bind(String(p.inspectionId||"")).first(); assert(i&&await visible(env,u,i),"ไม่มีสิทธิ์ดูรูป"); const ids=parseJson(i.photo_links_json,[]); assert(ids.includes(String(p.fileId||"")),"ไม่พบรูปในรายการ"); return gasDrive(env,"photo",{fileId:String(p.fileId)}); }

function rewardRow(r){ return {LogID:r.log_id,Timestamp:r.timestamp,ReferenceID:r.reference_id,Achievement:r.achievement,Details:r.details_json}; }
function metaOf(i){ const m=parseJson(i.meta_json,{}); m.note=i.note||m.note||""; m.completedAt=i.completed_at||m.completedAt||""; return m; }
function inspectorIdsFrom(i, teamMap){ const t=teamMap.get(i.inspection_id)||[]; if(t.length) return t.map(x=>x.user_id); const m=metaOf(i); return Array.isArray(m.inspectorIds)?m.inspectorIds.map(String):(m.userId?[String(m.userId)]:[]); }
function inspectorNamesFrom(i, teamMap){ const t=teamMap.get(i.inspection_id)||[]; if(t.length) return t.map(x=>x.user_name); const m=metaOf(i); return Array.isArray(m.inspectorNames)?m.inspectorNames.map(String):(m.userName?[String(m.userName)]:[]); }
async function inspectionBundle(db){ const ins=await all(db,"SELECT * FROM inspections ORDER BY inspection_date,inspection_id"), teams=await all(db,"SELECT * FROM inspection_inspectors ORDER BY inspection_id,user_name"), map=new Map(); teams.forEach(x=>{if(!map.has(x.inspection_id))map.set(x.inspection_id,[]);map.get(x.inspection_id).push(x);}); return {ins,teamMap:map}; }
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
async function dashboard(env,u,d){ if(d===thaiDay())await ensureToday(env); const {ins}=await inspectionBundle(env.DB),ad=activeDates(ins),isHoliday=d<thaiDay()&&!ad.has(d), selected=ins.filter(i=>i.inspection_date===d&&!isHoliday&&(!u||u.role!=="Teacher"||metaOf(i).classId===u.linked_classroom_id)),done=selected.filter(i=>i.status==="ตรวจแล้ว"),counts=[3,2,1].map(n=>done.filter(i=>Number(i.score)===n).length),areas=await env.DB.prepare("SELECT COUNT(*) n FROM areas").first(); const recent=done.sort((a,b)=>String(metaOf(b).completedAt).localeCompare(String(metaOf(a).completedAt))).slice(0,50).map(i=>({date:i.inspection_date,area:metaOf(i).areaName,className:metaOf(i).className,rating:i.rating,score:i.score})); return{date:d,isHoliday,areas:Number(areas?.n||0),scheduled:selected.length,done:done.length,pending:selected.length-done.length,counts,feed:u?recent:[],leaders:leaderboard(ins.filter(i=>i.inspection_date>=shiftDate(d,-29)&&i.inspection_date<=d)).slice(0,5),updatedAt:nowIso()}; }
async function teacher(env,u){ role(u,["Teacher"]); await ensureToday(env); const {ins}=await inspectionBundle(env.DB),ad=activeDates(ins); const filtered=ins.filter(i=>metaOf(i).classId===u.linked_classroom_id&&(i.inspection_date===thaiDay()||ad.has(i.inspection_date))).sort((a,b)=>b.inspection_date.localeCompare(a.inspection_date)).slice(0,200); return{inspections:await Promise.all(filtered.map(i=>displayOne(env.DB,i))),rewards:(await all(env.DB,"SELECT * FROM rewards_log WHERE reference_id=?",u.linked_classroom_id)).map(rewardRow),monthly:(await monthly(env,ins,thaiDay().slice(0,7))).filter(r=>r.id===u.linked_classroom_id)}; }
async function report(env,u,start,end){ role(u,["Admin","Supervisor"]); assert(start<=end&&end<=thaiDay(),"ช่วงวันที่ไม่ถูกต้อง"); assert((new Date(end)-new Date(start))<=366*86400000,"เลือกช่วงไม่เกิน 366 วัน"); await ensureToday(env); const {ins,teamMap}=await inspectionBundle(env.DB),ad=activeDates(ins),filtered=ins.filter(i=>i.inspection_date>=start&&i.inspection_date<=end&&ad.has(i.inspection_date)),done=filtered.filter(i=>i.status==="ตรวจแล้ว"),areas={},people={},users=await all(env.DB,"SELECT user_id,full_name FROM users"),um=new Map(users.map(x=>[x.user_id,x.full_name])); for(const i of filtered){const m=metaOf(i),ids=inspectorIdsFrom(i,teamMap),names=inspectorNamesFrom(i,teamMap);ids.forEach((uid,idx)=>{const g=people[uid]||(people[uid]={name:names[idx]||um.get(uid)||"—",scheduled:0,done:0});g.scheduled++;if(i.status==="ตรวจแล้ว")g.done++;});if(i.status==="ตรวจแล้ว"&&Number(i.score)===1){const a=areas[m.areaId]||(areas[m.areaId]={name:m.areaName,count:0});a.count++;}}
  return{start,end,leaders:leaderboard(done),watch:Object.values(areas).sort((a,b)=>b.count-a.count),inspectors:Object.values(people),monthly:await monthly(env,ins,end.slice(0,7)),month:end.slice(0,7),rewards:(await all(env.DB,"SELECT * FROM rewards_log ORDER BY timestamp")).map(rewardRow)}; }
