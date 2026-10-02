const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
export async function onRequest(context){
  const {request,env}=context;
  if (request.method !== "POST") {
  return Response.json(
    { ok: false, error: "METHOD_NOT_ALLOWED" },
    { status: 405, headers }
  );
}
  try{
    if(String(env.MIGRATION_ENABLED||"").toLowerCase()!=="true") throw Error("MIGRATION_DISABLED");
    if(!env.DB||!env.MIGRATION_SECRET) throw Error("ยังไม่ได้ตั้งค่า DB/MIGRATION_SECRET");
    const body=await request.json();
    if(String(body.secret||"")!==String(env.MIGRATION_SECRET)) throw Error("MIGRATION_DENIED");
    const b=body.bundle; if(!b||typeof b!=="object") throw Error("ไฟล์ migration ไม่ถูกต้อง");
    const replace=body.replace===true;
    const count=await env.DB.prepare("SELECT COUNT(*) n FROM users").first();
    if(Number(count?.n||0)>0&&!replace) throw Error("D1 มีข้อมูลแล้ว หากต้องการนำเข้าใหม่ให้ติ๊กแทนที่ข้อมูลเดิม");
    const tables=b.tables||{};
    const users=tables.Users||[], classrooms=tables.Classrooms||[], areas=tables.Areas||[], assignments=tables.Assignments||[], inspections=tables.Inspections||[], rewards=tables.RewardsLog||[];
    if(replace){
      await env.DB.batch([
        env.DB.prepare("DELETE FROM inspection_inspectors"),env.DB.prepare("DELETE FROM inspections"),env.DB.prepare("DELETE FROM assignments"),
        env.DB.prepare("DELETE FROM rewards_log"),env.DB.prepare("DELETE FROM sessions"),env.DB.prepare("DELETE FROM upload_tickets"),
        env.DB.prepare("DELETE FROM areas"),env.DB.prepare("DELETE FROM users"),env.DB.prepare("DELETE FROM classrooms"),env.DB.prepare("DELETE FROM holidays")
      ]);
    }
    await batches(env.DB,classrooms.map(r=>env.DB.prepare("INSERT INTO classrooms(classroom_id,class_name,created_at,updated_at) VALUES(?,?,?,?)").bind(String(r.ClassroomID),String(r.ClassName),now(),now())));
    await batches(env.DB,users.map(r=>env.DB.prepare("INSERT INTO users(user_id,username,password,full_name,role,linked_classroom_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(String(r.UserID),String(r.Username).toLowerCase(),String(r.Password),String(r.FullName),String(r.Role),String(r.LinkedClassroomID||""),now(),now())));
    await batches(env.DB,areas.map(r=>env.DB.prepare("INSERT INTO areas(area_id,area_name,responsible_classroom_id,created_at,updated_at) VALUES(?,?,?,?,?)").bind(String(r.AreaID),String(r.AreaName),String(r.ResponsibleClassroomID),now(),now())));
    await batches(env.DB,assignments.map(r=>env.DB.prepare("INSERT INTO assignments(assignment_id,user_id,area_id,days,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(String(r.AssignmentID),String(r.UserID),String(r.AreaID),String(r.Days||"1,2,3,4,5"),now(),now())));
    const ii=[];
    const ins=[];
    for(const r of inspections){
      const meta=parse(r.Notes,{note:String(r.Notes||"")});
      const photos=normalizePhotos(r.PhotoLinks);
      const version=Number(meta.version||0), completedAt=String(meta.completedAt||""), completedById=String(meta.completedById||""), completedByName=String(meta.completedByName||"");
      ins.push(env.DB.prepare(`INSERT INTO inspections(inspection_id,area_id,inspection_date,status,rating,score,note,meta_json,photo_links_json,version,completed_at,completed_by_id,completed_by_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(String(r.InspectionID),String(meta.areaId||""),String(r.InspectionDate),String(r.Status||"รอตรวจ"),String(r.Rating||""),Number(r.Score||0),String(meta.note||""),JSON.stringify(meta),JSON.stringify(photos),version,completedAt,completedById,completedByName,String(meta.createdAt||now()),now()));
      let ids=Array.isArray(meta.inspectorIds)?meta.inspectorIds.map(String):[];
      let names=Array.isArray(meta.inspectorNames)?meta.inspectorNames.map(String):[];
      if(!ids.length&&meta.userId){ids=[String(meta.userId)];names=[String(meta.userName||"")];}
      ids.forEach((uid,idx)=>ii.push(env.DB.prepare("INSERT OR IGNORE INTO inspection_inspectors(inspection_id,user_id,user_name) VALUES(?,?,?)").bind(String(r.InspectionID),uid,names[idx]||"")));
    }
    await batches(env.DB,ins); await batches(env.DB,ii);
    await batches(env.DB,rewards.map(r=>env.DB.prepare("INSERT INTO rewards_log(log_id,timestamp,reference_id,achievement,details_json) VALUES(?,?,?,?,?)").bind(String(r.LogID),String(r.Timestamp),String(r.ReferenceID),String(r.Achievement),String(r.Details||"{}"))));
    const holidays=Array.isArray(b.holidays)?b.holidays:[]; await batches(env.DB,holidays.map(d=>env.DB.prepare("INSERT OR IGNORE INTO holidays(holiday_date) VALUES(?)").bind(String(d))));
    await env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('migrated_at',?)").bind(now()).run();
    return Response.json({ok:true,data:{users:users.length,classrooms:classrooms.length,areas:areas.length,assignments:assignments.length,inspections:inspections.length,rewards:rewards.length,holidays:holidays.length}},{headers});
  }catch(e){return Response.json({ok:false,error:e.message||String(e)},{status:200,headers});}
}
async function batches(db,stmts){for(let i=0;i<stmts.length;i+=50) await db.batch(stmts.slice(i,i+50));}
function parse(v,f){try{return JSON.parse(v)||f}catch{return f}}
function normalizePhotos(v){const x=parse(v,[]);return Array.isArray(x)?x.map(y=>typeof y==="string"?y:y?.id).filter(Boolean):[]}
function now(){return new Date().toISOString()}
