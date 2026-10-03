const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
export async function onRequest(context){
  const {request,env}=context;
  if(request.method!=="POST")return Response.json({ok:false,error:"METHOD_NOT_ALLOWED"},{status:405,headers});
  let started=false;
  try{
    if(String(env.MIGRATION_ENABLED||"").toLowerCase()!=="true")throw Error("MIGRATION_DISABLED");
    if(!env.DB||!env.MIGRATION_SECRET)throw Error("ยังไม่ได้ตั้งค่า DB/MIGRATION_SECRET");
    const len=Number(request.headers.get("content-length")||0);
    if(len>20*1024*1024)throw Error("ไฟล์ migration ใหญ่เกิน 20 MB");
    const body=await request.json();
    if(!safeEqual(String(body.secret||""),String(env.MIGRATION_SECRET)))throw Error("MIGRATION_DENIED");
    const b=body.bundle;
    if(!b||typeof b!=="object")throw Error("ไฟล์ migration ไม่ถูกต้อง");
    const count=await env.DB.prepare("SELECT COUNT(*) n FROM users").first();
    if(Number(count?.n||0)>0){
      if(body.replace===true)throw Error("ปิดการแทนที่ข้อมูลผ่านหน้า Migration แล้ว กรุณาใช้เมนู สำรองและกู้คืน ในระบบหลัก");
      throw Error("D1 มีข้อมูลแล้ว Migration ใช้ได้เฉพาะฐานข้อมูลว่าง");
    }

    const x=validateBundle(b);
    const {users,classrooms,areas,assignments,inspections,rewards,holidays}=x;
    started=true;
    await batches(env.DB,classrooms.map(r=>env.DB.prepare("INSERT INTO classrooms(classroom_id,class_name,created_at,updated_at) VALUES(?,?,?,?)").bind(String(r.ClassroomID),String(r.ClassName),now(),now())));
    await batches(env.DB,users.map(r=>env.DB.prepare("INSERT INTO users(user_id,username,password,full_name,role,linked_classroom_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(String(r.UserID),String(r.Username).toLowerCase(),String(r.Password),String(r.FullName),String(r.Role),String(r.LinkedClassroomID||""),now(),now())));
    await batches(env.DB,areas.map(r=>env.DB.prepare("INSERT INTO areas(area_id,area_name,responsible_classroom_id,created_at,updated_at) VALUES(?,?,?,?,?)").bind(String(r.AreaID),String(r.AreaName),String(r.ResponsibleClassroomID),now(),now())));
    await batches(env.DB,assignments.map(r=>env.DB.prepare("INSERT INTO assignments(assignment_id,user_id,area_id,days,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(String(r.AssignmentID),String(r.UserID),String(r.AreaID),String(r.Days||"1,2,3,4,5"),now(),now())));

    const ii=[],ins=[];
    for(const r of inspections){
      const meta=parse(r.Notes,{note:String(r.Notes||"")}),photos=normalizePhotos(r.PhotoLinks);
      const version=Number(meta.version||0),completedAt=String(meta.completedAt||""),completedById=String(meta.completedById||""),completedByName=String(meta.completedByName||"");
      ins.push(env.DB.prepare(`INSERT INTO inspections(inspection_id,area_id,inspection_date,status,rating,score,note,meta_json,photo_links_json,version,completed_at,completed_by_id,completed_by_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(String(r.InspectionID),String(meta.areaId||""),String(r.InspectionDate),String(r.Status||"รอตรวจ"),String(r.Rating||""),Number(r.Score||0),String(meta.note||""),JSON.stringify(meta),JSON.stringify(photos),version,completedAt,completedById,completedByName,String(meta.createdAt||now()),now()));
      let ids=Array.isArray(meta.inspectorIds)?meta.inspectorIds.map(String):[];
      let names=Array.isArray(meta.inspectorNames)?meta.inspectorNames.map(String):[];
      if(!ids.length&&meta.userId){ids=[String(meta.userId)];names=[String(meta.userName||"")];}
      ids.forEach((uid,idx)=>ii.push(env.DB.prepare("INSERT OR IGNORE INTO inspection_inspectors(inspection_id,user_id,user_name) VALUES(?,?,?)").bind(String(r.InspectionID),uid,names[idx]||"")));
    }
    await batches(env.DB,ins);
    await batches(env.DB,ii);
    await batches(env.DB,rewards.map(r=>env.DB.prepare("INSERT INTO rewards_log(log_id,timestamp,reference_id,achievement,details_json) VALUES(?,?,?,?,?)").bind(String(r.LogID),String(r.Timestamp),String(r.ReferenceID),String(r.Achievement),String(r.Details||"{}"))));
    await batches(env.DB,holidays.map(d=>env.DB.prepare("INSERT OR IGNORE INTO holidays(holiday_date) VALUES(?)").bind(String(d))));
    await env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('migrated_at',?)").bind(now()).run();
    started=false;
    return Response.json({ok:true,data:{users:users.length,classrooms:classrooms.length,areas:areas.length,assignments:assignments.length,inspections:inspections.length,rewards:rewards.length,holidays:holidays.length}},{headers});
  }catch(e){
    if(started&&env.DB){
      try{await clearImported(env.DB);}catch(cleanErr){return Response.json({ok:false,error:(e.message||String(e))+" · rollback ไม่สมบูรณ์: "+(cleanErr.message||String(cleanErr))},{status:200,headers});}
    }
    return Response.json({ok:false,error:e.message||String(e)},{status:200,headers});
  }
}
function validateBundle(b){
  const tables=b.tables||{},users=arr(tables.Users,"Users"),classrooms=arr(tables.Classrooms,"Classrooms"),areas=arr(tables.Areas,"Areas"),assignments=arr(tables.Assignments,"Assignments"),inspections=arr(tables.Inspections,"Inspections"),rewards=arr(tables.RewardsLog,"RewardsLog"),holidays=Array.isArray(b.holidays)?b.holidays:[];
  const unique=(rows,key,label)=>{const s=new Set();for(const r of rows){const v=String(r?.[key]||"");if(!v||s.has(v))throw Error(label+" มีรหัสว่างหรือซ้ำ: "+v);s.add(v);}return s;};
  const classIds=unique(classrooms,"ClassroomID","Classrooms"),userIds=unique(users,"UserID","Users"),areaIds=unique(areas,"AreaID","Areas"),inspectionIds=unique(inspections,"InspectionID","Inspections");
  unique(assignments,"AssignmentID","Assignments");unique(rewards,"LogID","RewardsLog");
  const usernames=new Set(),classNames=new Set(),areaNames=new Set();
  for(const r of users){const username=String(r.Username||"").toLowerCase();if(!/^[a-z0-9._@-]{3,80}$/.test(username)||usernames.has(username))throw Error("Username ไม่ถูกต้องหรือซ้ำ: "+username);usernames.add(username);if(!["Admin","Supervisor","Inspector","Teacher"].includes(String(r.Role)))throw Error("Role ไม่ถูกต้อง");if(String(r.Role)==="Teacher"&&String(r.LinkedClassroomID||"")&&!classIds.has(String(r.LinkedClassroomID)))throw Error("Teacher อ้างอิงห้องเรียนที่ไม่มีอยู่");}
  if(!users.some(r=>String(r.Role)==="Admin"))throw Error("Migration ต้องมี Admin อย่างน้อย 1 บัญชี");
  for(const r of classrooms){const name=String(r.ClassName||"");if(!name||classNames.has(name))throw Error("ชื่อห้องเรียนว่างหรือซ้ำ");classNames.add(name);}
  for(const r of areas){const name=String(r.AreaName||"");if(!name||areaNames.has(name))throw Error("ชื่อพื้นที่ว่างหรือซ้ำ");areaNames.add(name);if(!classIds.has(String(r.ResponsibleClassroomID)))throw Error("พื้นที่อ้างอิงห้องเรียนที่ไม่มีอยู่");}
  for(const r of assignments){if(!userIds.has(String(r.UserID))||!areaIds.has(String(r.AreaID)))throw Error("งานมอบหมายอ้างอิงข้อมูลที่ไม่มีอยู่");}
  for(const r of inspections){const meta=parse(r.Notes,{});if(!areaIds.has(String(meta.areaId||"")))throw Error("ผลตรวจอ้างอิงพื้นที่ที่ไม่มีอยู่");}
  holidays.forEach(d=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(String(d)))throw Error("รูปแบบวันหยุดไม่ถูกต้อง");});
  return{users,classrooms,areas,assignments,inspections,rewards,holidays,inspectionIds};
}
function arr(v,label){if(!Array.isArray(v))throw Error(label+" ไม่ใช่รายการข้อมูล");return v;}
async function clearImported(db){
  await db.batch([
    db.prepare("DELETE FROM inspection_inspectors"),db.prepare("DELETE FROM inspections"),db.prepare("DELETE FROM assignments"),
    db.prepare("DELETE FROM rewards_log"),db.prepare("DELETE FROM sessions"),db.prepare("DELETE FROM upload_tickets"),
    db.prepare("DELETE FROM areas"),db.prepare("DELETE FROM users"),db.prepare("DELETE FROM classrooms"),db.prepare("DELETE FROM holidays")
  ]);
  await db.prepare("DELETE FROM settings WHERE key='migrated_at'").run();
}
async function batches(db,stmts){for(let i=0;i<stmts.length;i+=50)await db.batch(stmts.slice(i,i+50));}
function safeEqual(a,b){a=String(a);b=String(b);if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
function parse(v,f){try{return JSON.parse(v)||f}catch{return f}}
function normalizePhotos(v){const x=parse(v,[]);return Array.isArray(x)?x.map(y=>typeof y==="string"?y:y?.id).filter(Boolean):[]}
function now(){return new Date().toISOString()}
