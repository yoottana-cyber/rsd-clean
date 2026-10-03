"use strict";

/* =========================================================
   OPERATIONS PHASE
   Daily Control / Academic Periods / Excel Import /
   Certificates / Web Push enrollment
   ========================================================= */

function opDateText(date){
  try{return new Date(date+"T12:00:00+07:00").toLocaleDateString("th-TH",{weekday:"short",day:"numeric",month:"short",year:"numeric",timeZone:"Asia/Bangkok"});}
  catch(e){return date;}
}
function opMonthText(month){
  try{return new Date(month+"-01T12:00:00+07:00").toLocaleDateString("th-TH",{month:"long",year:"numeric",timeZone:"Asia/Bangkok"});}
  catch(e){return month;}
}

/* =========================
   1) DAILY CONTROL CENTER
   ========================= */
let opControlData=null;
async function renderDailyControl(seq){
  const today=thaiDay();
  $("app").innerHTML=
    heading(
      "ศูนย์ควบคุมงานประจำวัน",
      "ดูสถานะพื้นที่ ผู้ตรวจ เวรทดแทน งานค้าง งดตรวจ และผลรอรับรองในหน้าเดียว",
      '<div class="flex flex-wrap gap-2"><a class="btn secondary" href="#daily"><i data-lucide="send"></i> รายงานรายวัน</a><button class="btn" id="control-refresh"><i data-lucide="refresh-cw"></i> รีเฟรช</button></div>'
    )+
    '<form id="control-filter" class="card ops-control-filter mb-4">'+
      '<div class="field m-0"><label>วันที่</label><input id="control-date" type="date" value="'+today+'" max="'+today+'"></div>'+
      '<div class="field m-0"><label>สถานะ</label><select id="control-status"><option value="">ทุกสถานะ</option><option value="รอตรวจ">รอตรวจ</option><option value="ตรวจแล้ว">ตรวจแล้ว</option><option value="งดตรวจ">งดตรวจ</option><option value="รอรับรอง">รอรับรอง</option><option value="เวรทดแทน">เวรทดแทน</option></select></div>'+
      '<div class="search-box"><i data-lucide="search"></i><input id="control-search" type="search" placeholder="ค้นหาห้อง / พื้นที่ / ผู้ตรวจ…"></div>'+
    '</form>'+
    '<div id="control-content"><div class="card empty">กำลังโหลดสถานะงานวันนี้…</div></div>';
  $("control-refresh").onclick=()=>loadDailyControl(S.seq).catch(error);
  $("control-date").onchange=()=>loadDailyControl(S.seq).catch(error);
  $("control-status").onchange=applyControlFilter;
  $("control-search").oninput=applyControlFilter;
  icons();
  await loadDailyControl(seq);
}
async function loadDailyControl(seq=S.seq){
  const date=$("control-date")?.value||thaiDay(),d=await rpc("dailyControl",{date},true);
  if(seq!==S.seq)return;
  opControlData=d;
  const s=d.summary||{},cfg=d.settings||S.config||{},period=d.period?.Label||"ยังไม่ได้กำหนดภาคเรียน";
  $("control-content").innerHTML=
    '<section class="ops-control-hero">'+
      '<div><span>สถานะประจำวันที่ '+esc(opDateText(d.date))+'</span><h2>'+(s.pending?"ยังมีงานรอตรวจ "+s.pending+" พื้นที่":"ดำเนินการครบแล้ว")+'</h2><p>'+esc(period)+' · เวลาตรวจ '+esc(cfg.inspectionStart||"—")+'–'+esc(cfg.inspectionEnd||"—")+' น.</p></div>'+
      '<div class="ops-control-progress"><b>'+Number(s.resolved??(s.done+s.skipped))+' / '+s.total+'</b><span>ดำเนินการแล้ว</span></div>'+
    '</section>'+
    '<div class="exec-kpi-grid">'+
      '<article class="exec-kpi"><span>รอตรวจ</span><b>'+s.pending+'</b><small>ต้องดำเนินการ</small></article>'+
      '<article class="exec-kpi excellent"><span>ตรวจแล้ว</span><b>'+s.done+'</b><small>จาก '+s.total+' พื้นที่</small></article>'+
      '<article class="exec-kpi"><span>งดตรวจ</span><b>'+s.skipped+'</b><small>มีเหตุผลกำกับ</small></article>'+
      '<article class="exec-kpi improve"><span>รอรับรอง</span><b>'+s.approvalPending+'</b><small>เวรทดแทน '+s.substitute+' พื้นที่</small></article>'+
    '</div>'+
    '<section class="card mt-4"><div class="coverage-section-head mb-4"><div><h2>รายการพื้นที่</h2><p class="muted">กดดำเนินการได้จากรายการโดยตรง</p></div>'+
      '<div class="flex flex-wrap gap-2">'+
        (S.user?.Role==="Admin"?'<button class="btn secondary" id="control-substitute"><i data-lucide="user-round-check"></i> ผู้ตรวจทดแทน</button>':'')+
        (d.date===thaiDay()&&s.pending?'<button class="btn secondary" id="control-push-reminder"><i data-lucide="bell-ring"></i> เตือนผู้ตรวจที่ยังค้าง</button>':'')+
        '<button class="btn secondary" id="control-exception"><i data-lucide="circle-off"></i> งดตรวจ</button>'+
        (d.settings?.approvalEnabled?'<a class="btn secondary" href="#review"><i data-lucide="badge-check"></i> รับรองผล</a>':'')+
      '</div></div>'+
      '<div class="ops-control-list">'+
        (d.items?.length?d.items.map((x,idx)=>opControlCard(x,idx)).join(""):'<div class="empty">ไม่มีงานตรวจในวันนี้</div>')+
      '</div>'+
    '</section>';
  if($("control-substitute"))$("control-substitute").onclick=dutyOverrideModal;
  if($("control-push-reminder"))$("control-push-reminder").onclick=async()=>{
    const ok=await Swal.fire({icon:"question",title:"ส่ง Push เตือนผู้ตรวจที่ยังค้าง?",text:"ระบบจะส่งไปยังอุปกรณ์ที่เปิดรับ Push Notification",showCancelButton:true,confirmButtonText:"ส่งแจ้งเตือน",cancelButtonText:"ยกเลิก"});
    if(!ok.isConfirmed)return;
    try{
      const r=await rpc("sendPushReminder",{date:d.date},true);
      await Swal.fire({icon:r.sent?"success":"info",title:r.sent?"ส่งแจ้งเตือนแล้ว":"ยังไม่มีอุปกรณ์รับ Push",html:"ส่งสำเร็จ <b>"+r.sent+"</b> อุปกรณ์ · ล้มเหลว "+r.failed+" · ผู้ตรวจค้าง "+r.inspectors+" คน"});
    }catch(e){error(e);}
  };
  $("control-exception").onclick=()=>inspectionExceptionModal(d.date);
  document.querySelectorAll(".control-photo").forEach(b=>b.onclick=()=>coveragePhoto(d.items[Number(b.dataset.index)]));
  icons();
  applyControlFilter();
}
function opControlCard(x,index){
  const inspectors=(x.Inspectors||[]).map(v=>v.Name).join(", ")||"ยังไม่มีผู้ตรวจ";
  const search=[x.ClassName,x.AreaName,inspectors,x.Status,x.Rating,x.SkipReason,x.CompletedBy].join(" ").toLocaleLowerCase("th");
  let badge=coverageStatusPill(x.Status,x.Score);
  if(x.ApprovalStatus==="รอรับรอง")badge+=' <span class="pill yellow">รอรับรอง</span>';
  if(x.HasSubstitute)badge+=' <span class="pill green">เวรทดแทน</span>';
  return '<article class="ops-control-card" data-status="'+esc(x.Status)+'" data-approval="'+esc(x.ApprovalStatus||"")+'" data-sub="'+(x.HasSubstitute?"1":"0")+'" data-search="'+esc(search)+'">'+
    '<div class="ops-control-main"><div class="ops-control-title"><span>'+esc(x.ClassName)+'</span><h3>'+esc(x.AreaName)+'</h3></div><div class="ops-control-badges">'+badge+'</div></div>'+
    '<div class="ops-control-meta"><span><i data-lucide="users"></i>'+esc(inspectors)+'</span>'+
      (x.CompletedBy?'<span><i data-lucide="user-check"></i>'+esc(x.CompletedBy)+'</span>':'')+
      (x.SkipReason?'<span><i data-lucide="circle-off"></i>'+esc(x.SkipReason)+'</span>':'')+
      (x.HasSubstitute?'<span><i data-lucide="repeat-2"></i>'+esc((x.Substitutes||[]).map(v=>(v.ReplaceName?v.ReplaceName+" → ":"")+v.SubstituteName).join(", "))+'</span>':'')+
    '</div>'+
    '<div class="ops-control-actions">'+
      '<a class="btn small secondary" href="#history" data-history-type="area" data-history-id="'+esc(x.AreaID)+'">ประวัติ</a>'+
      (x.PhotoLinks?.length?'<button class="btn small secondary control-photo" data-index="'+index+'">ดูรูป</button>':'')+
    '</div>'+
  '</article>';
}
function applyControlFilter(){
  const q=String($("control-search")?.value||"").trim().toLocaleLowerCase("th"),status=$("control-status")?.value||"";
  document.querySelectorAll(".ops-control-card").forEach(card=>{
    const matchQ=!q||String(card.dataset.search||"").includes(q);
    let matchS=true;
    if(status==="รอรับรอง")matchS=card.dataset.approval==="รอรับรอง";
    else if(status==="เวรทดแทน")matchS=card.dataset.sub==="1";
    else if(status)matchS=card.dataset.status===status;
    card.style.display=matchQ&&matchS?"":"none";
  });
}

/* =========================
   2) ACADEMIC YEAR / SEMESTER
   ========================= */
let opPeriods=[];
async function renderAcademicPeriods(seq){
  $("app").innerHTML=
    heading("ปีการศึกษา / ภาคเรียน","แยกช่วงข้อมูลโดยไม่ต้องลบประวัติเก่า",'<button class="btn" id="period-add"><i data-lucide="plus"></i> เพิ่มภาคเรียน</button>')+
    '<div id="period-content"><div class="card empty">กำลังโหลดภาคเรียน…</div></div>';
  $("period-add").onclick=()=>academicPeriodModal();
  icons();
  await loadAcademicPeriods(seq);
}
async function loadAcademicPeriods(seq=S.seq){
  const rows=await rpc("academicPeriods",{},true);if(seq!==S.seq)return;opPeriods=rows;
  $("period-content").innerHTML=
    '<section class="card"><div class="coverage-section-head mb-4"><div><h2>ภาคเรียนทั้งหมด</h2><p class="muted">ภาคเรียนที่ Active ใช้เป็นบริบทหลักของรายงานและ Dashboard</p></div></div>'+
    (rows.length?table(["สถานะ","ปีการศึกษา","ภาคเรียน","ชื่อแสดง","เริ่ม","สิ้นสุด","จัดการ"],rows.map(r=>[
      r.IsActive?'<span class="pill green">กำลังใช้งาน</span>':'<span class="pill gray">เก็บไว้</span>',
      esc(r.AcademicYear),esc(r.Semester),esc(r.Label),coverageDateText(r.StartDate),coverageDateText(r.EndDate),
      '<button class="btn small secondary period-edit" data-id="'+esc(r.PeriodID)+'">แก้ไข</button> '+(!r.IsActive?'<button class="btn small danger period-delete" data-id="'+esc(r.PeriodID)+'">ลบ</button>':'')
    ])):'<div class="empty">ยังไม่ได้กำหนดปีการศึกษา/ภาคเรียน</div>')+
    '</section>';
  document.querySelectorAll(".period-edit").forEach(b=>b.onclick=()=>academicPeriodModal(rows.find(x=>x.PeriodID===b.dataset.id)));
  document.querySelectorAll(".period-delete").forEach(b=>b.onclick=async()=>{
    const ok=await Swal.fire({icon:"warning",title:"ลบภาคเรียนนี้?",text:"ข้อมูลผลตรวจเดิมจะไม่ถูกลบ เพียงลบช่วงภาคเรียนออก",showCancelButton:true,confirmButtonText:"ลบ",cancelButtonText:"ยกเลิก"});
    if(!ok.isConfirmed)return;
    try{await rpc("deleteAcademicPeriod",{id:b.dataset.id});toast("ลบภาคเรียนแล้ว");await loadAcademicPeriods();}catch(e){error(e);}
  });
  icons();
}
function academicPeriodModal(row=null){
  const y=String(new Date().getFullYear()+543),r=row||{};
  openModal(row?"แก้ไขภาคเรียน":"เพิ่มปีการศึกษา / ภาคเรียน",
    '<form id="period-form" class="coverage-form-grid">'+
      '<div class="field"><label>ปีการศึกษา</label><input name="academicYear" value="'+esc(r.AcademicYear||y)+'" maxlength="20" required placeholder="เช่น 2569"></div>'+
      '<div class="field"><label>ภาคเรียน</label><input name="semester" value="'+esc(r.Semester||"1")+'" maxlength="30" required placeholder="เช่น 1"></div>'+
      '<div class="field coverage-span-2"><label>ชื่อแสดง</label><input name="label" value="'+esc(r.Label||("ภาคเรียนที่ 1 ปีการศึกษา "+y))+'" maxlength="120" required></div>'+
      '<div class="field"><label>วันเริ่ม</label><input name="startDate" type="date" value="'+esc(r.StartDate||"")+'" required></div>'+
      '<div class="field"><label>วันสิ้นสุด</label><input name="endDate" type="date" value="'+esc(r.EndDate||"")+'" required></div>'+
      '<label class="coverage-toggle coverage-span-2"><input name="isActive" type="checkbox" '+(r.IsActive?"checked":"")+'><span><b>ตั้งเป็นภาคเรียนที่กำลังใช้งาน</b><small>ระบบจะยกเลิก Active ของภาคเรียนอื่นให้อัตโนมัติ</small></span></label>'+
      '<button class="btn coverage-span-2" type="submit">บันทึกภาคเรียน</button>'+
    '</form>');
  $("period-form").onsubmit=async e=>{
    e.preventDefault();const f=e.target.elements;
    try{
      await rpc("saveAcademicPeriod",{id:r.PeriodID||"",academicYear:f.academicYear.value,semester:f.semester.value,label:f.label.value,startDate:f.startDate.value,endDate:f.endDate.value,isActive:f.isActive.checked});
      toast("บันทึกภาคเรียนแล้ว");closeModal();await loadAcademicPeriods(S.seq);
    }catch(err){error(err);}
  };
}

/* =========================
   3) EXCEL IMPORT
   ========================= */
async function importExcelModal(){
  if(S.user?.Role!=="Admin")return;
  openModal("นำเข้าข้อมูลจาก Excel",
    '<div class="ops-import-wrap">'+
      '<div class="warn"><b>แนะนำ:</b> สำรองข้อมูลก่อนนำเข้าจำนวนมาก ระบบจะ Preview และตรวจข้อมูลก่อนบันทึกจริง</div>'+
      '<div class="coverage-form-grid mt-4">'+
        '<div class="field"><label>ประเภทข้อมูล</label><select id="excel-kind"><option value="Classrooms">ห้องเรียน</option><option value="Areas">พื้นที่</option><option value="Users">ผู้ใช้งาน</option><option value="Assignments">เวรผู้ตรวจ</option></select></div>'+
        '<div class="field"><label>ไฟล์ Excel</label><input id="excel-file" type="file" accept=".xlsx,.xls"></div>'+
      '</div>'+
      '<div class="flex flex-wrap gap-2"><button class="btn secondary" id="excel-template">ดาวน์โหลดแม่แบบ Excel</button><button class="btn" id="excel-preview">ตรวจสอบไฟล์</button></div>'+
      '<div id="excel-result" class="mt-4"></div>'+
    '</div>');
  $("excel-template").onclick=downloadExcelTemplate;
  $("excel-preview").onclick=previewExcelImport;
  icons();
}
async function ensureXlsx(){await loadCoverageScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",()=>!!window.XLSX);}
async function downloadExcelTemplate(){
  try{
    await ensureXlsx();
    const wb=XLSX.utils.book_new();
    Object.entries(BULK_SPEC).forEach(([kind,spec])=>{
      const ws=XLSX.utils.aoa_to_sheet([spec.headers,...spec.sample]);
      ws["!cols"]=spec.headers.map(h=>({wch:Math.max(16,h.length+5)}));
      XLSX.utils.book_append_sheet(wb,ws,kind);
    });
    XLSX.writeFile(wb,"RSD-Clean-Import-Template.xlsx");
  }catch(e){error(e);}
}
async function previewExcelImport(){
  const file=$("excel-file")?.files?.[0],kind=$("excel-kind")?.value,out=$("excel-result");
  if(!file)return Swal.fire({icon:"warning",title:"เลือกไฟล์ Excel ก่อน"});
  if(file.size>5*1024*1024)return Swal.fire({icon:"error",title:"ไฟล์ใหญ่เกิน 5 MB"});
  busy(true,"กำลังอ่าน Excel…");
  try{
    await ensureXlsx();
    const wb=XLSX.read(await file.arrayBuffer(),{type:"array"}),sheet=wb.Sheets[kind]||wb.Sheets[wb.SheetNames[0]];
    if(!sheet)throw Error("ไม่พบ Sheet ที่อ่านได้");
    const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:"",raw:false});
    if(matrix.length>101)throw Error("นำเข้าได้ครั้งละไม่เกิน 100 รายการ");
    const tsv=matrix.map(row=>row.map(v=>String(v??"").replace(/\t/g," ")).join("\t")).join("\n");
    const parsed=bulkDecode(tsv,kind),safe=bulkSafeRows(parsed),preview=await rpc("bulkPreview",{table:kind,rows:safe},true);
    const failed=preview.rows.filter(r=>r.errors.length).length;
    out.innerHTML=
      '<div class="'+(failed?"warn":"card")+'"><b>'+(failed?"พบข้อมูลต้องแก้ไข "+failed+" แถว":"ตรวจสอบผ่าน "+preview.total+" รายการ")+'</b></div>'+
      table(["แถว","ข้อมูล","ผลตรวจ"],preview.rows.map((r,idx)=>[
        r.row,esc(Object.values(parsed[idx]||{}).filter(Boolean).join(" · ")),
        r.errors.length?'<span class="text-red-600">'+r.errors.map(esc).join("<br>")+'</span>':'<span class="pill green">ผ่าน</span>'
      ]))+
      (!failed?'<button class="btn w-full mt-4" id="excel-save">บันทึก '+preview.total+' รายการ</button>':'');
    if(!failed)$("excel-save").onclick=()=>saveExcelImport(kind,parsed);
  }catch(e){error(e);out.innerHTML="";}finally{busy(false);}
}
async function saveExcelImport(kind,rows){
  const ok=await Swal.fire({icon:"question",title:"ยืนยันนำเข้า "+rows.length+" รายการ?",text:"ระบบจะเพิ่มรายการใหม่โดยไม่เขียนทับข้อมูลเดิม",showCancelButton:true,confirmButtonText:"นำเข้า",cancelButtonText:"ยกเลิก"});
  if(!ok.isConfirmed)return;
  busy(true,"กำลังนำเข้าข้อมูล…");
  try{
    const compiled=[];
    for(const row of rows){
      const {Password,...data}=row;
      if(kind==="Users")data.credential=await newCredential(String(Password||""));
      compiled.push(data);
    }
    const result=await rpc("bulkCreate",{table:kind,rows:compiled},true);
    if(!result.saved)throw Error("ข้อมูลไม่ผ่านการตรวจสอบ กรุณา Preview ใหม่");
    toast("นำเข้าสำเร็จ "+result.count+" รายการ");closeModal();S.master=null;await route();
  }catch(e){error(e);}finally{busy(false);}
}

/* =========================
   4) CERTIFICATE GENERATOR
   ========================= */
let opCertificateData=null;
let opCertificateTemplateImage="";
async function renderCertificateCenter(seq){
  const month=thaiDay().slice(0,7);
  $("app").innerHTML=
    heading(
      "เกียรติบัตรอัตโนมัติ 🏅",
      "สร้างเกียรติบัตรรายเดือนจากผลตรวจที่ผ่านเกณฑ์",
      (S.user?.Role==="Admin"?'<button class="btn secondary" id="cert-template-manage"><i data-lucide="layout-template"></i> จัดการแม่แบบ</button>':'')
    )+
    '<form id="certificate-filter" class="card daily-filter mb-4"><div class="field m-0"><label>เดือน</label><input id="certificate-month" type="month" value="'+month+'" max="'+month+'"></div><button class="btn" type="submit">ประมวลผล</button></form>'+
    '<div id="certificate-content"><div class="card empty">กำลังคำนวณเกียรติบัตร…</div></div>';
  if($("cert-template-manage"))$("cert-template-manage").onclick=certificateTemplateModal;
  $("certificate-filter").onsubmit=e=>{e.preventDefault();loadCertificates(S.seq).catch(error);};icons();
  await loadCertificates(seq);
}
async function loadCertificates(seq=S.seq){
  const month=$("certificate-month").value,d=await rpc("certificateData",{month},true);if(seq!==S.seq)return;
  opCertificateData=d;opCertificateTemplateImage="";
  const groups={ทอง:d.rows.filter(x=>x.medal==="เหรียญทอง"),เงิน:d.rows.filter(x=>x.medal==="เหรียญเงิน"),ทองแดง:d.rows.filter(x=>x.medal==="เหรียญทองแดง")};
  const templateStatus=d.template?.enabled
    ? '<span class="pill green">ใช้แม่แบบที่อัปโหลด</span>'
    : '<span class="pill gray">ใช้แบบมาตรฐานของระบบ</span>';
  $("certificate-content").innerHTML=
    '<div class="exec-kpi-grid">'+
      '<article class="exec-kpi excellent"><span>เหรียญทอง</span><b>'+groups.ทอง.length+'</b><small>ห้องเรียน</small></article>'+
      '<article class="exec-kpi"><span>เหรียญเงิน</span><b>'+groups.เงิน.length+'</b><small>ห้องเรียน</small></article>'+
      '<article class="exec-kpi improve"><span>เหรียญทองแดง</span><b>'+groups.ทองแดง.length+'</b><small>ห้องเรียน</small></article>'+
      '<article class="exec-kpi"><span>รวมได้เกียรติบัตร</span><b>'+d.rows.length+'</b><small>'+esc(d.period?.Label||opMonthText(d.month))+'</small></article>'+
    '</div>'+
    '<section class="card mt-4"><div class="coverage-section-head"><div><h2>รายชื่อที่ผ่านเกณฑ์</h2><p class="muted">'+esc(opMonthText(d.month))+' · '+templateStatus+'</p></div>'+
      '<div class="flex flex-wrap gap-2">'+
        (S.user?.Role==="Admin"?'<button class="btn secondary" id="cert-template-manage-inline"><i data-lucide="layout-template"></i> แม่แบบ</button>':'')+
        '<button class="btn" id="cert-pdf"><i data-lucide="file-down"></i> ดาวน์โหลด PDF ทั้งหมด</button><button class="btn secondary" id="cert-zip"><i data-lucide="archive"></i> ZIP รูป PNG</button></div></div>'+
      (d.rows.length?table(["ห้องเรียน","ระดับ","ปรับปรุง","จำนวนวันตรวจ"],d.rows.map(x=>[esc(x.name),'<b>'+esc(x.medal)+'</b>'+(x.provisional?' <span class="pill gray">ชั่วคราว</span>':''),String(x.improve||0),String(x.inspectionDays||0)])):'<div class="empty">ไม่มีห้องที่ผ่านเกณฑ์ในเดือนนี้</div>')+
    '</section>';
  if($("cert-template-manage-inline"))$("cert-template-manage-inline").onclick=certificateTemplateModal;
  if($("cert-pdf"))$("cert-pdf").onclick=downloadCertificatesPdf;
  if($("cert-zip"))$("cert-zip").onclick=downloadCertificatesZip;
  icons();
}
function certIssueDateText(d){
  try{return new Date(d.generatedAt||Date.now()).toLocaleDateString("th-TH",{day:"numeric",month:"long",year:"numeric",timeZone:"Asia/Bangkok"});}
  catch(e){return "";}
}
function certificateVariableValues(row,d){
  return{
    className:String(row.name||""),
    medal:String(row.medal||""),
    month:opMonthText(d.month),
    period:String(d.period?.Label||""),
    issueDate:certIssueDateText(d)
  };
}
function certificateResolveText(text,values){
  return String(text||"").replace(/\{(className|medal|month|period|issueDate)\}/g,(m,k)=>String(values?.[k]||""));
}
function customCertificateHtml(row,d){
  const t=d.template||{},fields=t.fields||{},values=certificateVariableValues(row,d),image=d.templateImage||opCertificateTemplateImage;
  const overlays=Object.entries(values).map(([key,value])=>{
    const f=fields[key];if(!f||f.visible===false||!value)return "";
    return '<div class="ops-cert-variable" style="left:'+Number(f.x||50)+'%;top:'+Number(f.y||50)+'%;font-size:'+Number(f.size||20)+'px;color:'+esc(f.color||"#17334b")+';font-weight:'+Number(f.weight||400)+';font-family:'+certificateFontCss(f.font)+'">'+esc(value)+'</div>';
  }).join("");
  const custom=(t.textBlocks||[]).map(b=>{
    if(!b||b.visible===false||!String(b.text||"").trim())return "";
    const value=certificateResolveText(b.text,values);
    return '<div class="ops-cert-variable ops-cert-static" style="left:'+Number(b.x||50)+'%;top:'+Number(b.y||50)+'%;font-size:'+Number(b.size||20)+'px;color:'+esc(b.color||"#17334b")+';font-weight:'+Number(b.weight||400)+';font-family:'+certificateFontCss(b.font)+'">'+esc(value)+'</div>';
  }).join("");
  return '<section class="ops-certificate-sheet ops-certificate-custom">'+
    '<img class="ops-cert-template-bg" src="'+esc(image)+'" alt="">'+overlays+custom+
  '</section>';
}
function certificateHtml(row,d){
  if(d.template?.enabled&&(d.templateImage||opCertificateTemplateImage))return customCertificateHtml(row,d);
  const cfg=d.settings||{},period=d.period?.Label||opMonthText(d.month);
  return '<section class="ops-certificate-sheet">'+
    '<div class="ops-cert-border"><div class="ops-cert-inner">'+
      '<img src="'+esc(cfg.schoolLogoUrl||"/school-logo")+'" class="ops-cert-logo" onerror="this.onerror=null;this.src=\'/school-logo\'">'+
      '<div class="ops-cert-school">'+esc(cfg.schoolName||"โรงเรียนรัษฎา")+'</div>'+
      '<h1>เกียรติบัตร</h1><p>ขอมอบเกียรติบัตรฉบับนี้ให้แก่</p>'+
      '<h2>'+esc(row.name)+'</h2>'+
      '<p>มีผลการตรวจเขตพื้นที่ประจำเดือนอยู่ในเกณฑ์</p>'+
      '<h3>'+esc(row.medal)+'</h3>'+
      '<p class="ops-cert-period">'+esc(opMonthText(d.month))+' · '+esc(period)+'</p>'+
      '<div class="ops-cert-footer">'+esc(cfg.reportFooter||"RSD Clean")+'</div>'+
    '</div></div></section>';
}
async function ensureCertificateTemplateImage(d){
  if(!d?.template?.enabled)return "";
  if(d.templateImage)return d.templateImage;
  if(opCertificateTemplateImage){d.templateImage=opCertificateTemplateImage;return opCertificateTemplateImage;}
  $("loading-text").textContent="กำลังโหลดแม่แบบเกียรติบัตร…";
  const image=await rpc("certificateTemplateImage",{},true);
  d.templateImage=image;opCertificateTemplateImage=image;
  return image;
}
function certificateCanvasFontFamily(font){
  return String(font)==="Kanit" ? '"Kanit", sans-serif' : '"Sarabun", sans-serif';
}
function certificateCanvasLineHeight(size){
  return Math.max(12,Number(size||20)*1.22);
}
async function certificateLoadImage(src){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>reject(Error("โหลดภาพพื้นหลังเกียรติบัตรไม่สำเร็จ"));
    if(/^https?:/i.test(String(src||"")))img.crossOrigin="anonymous";
    img.src=src;
  });
}
function certificateDrawText(ctx,text,style,width,height,multiline=false){
  if(style?.visible===false||!String(text||"").trim())return;
  const size=Math.max(8,Number(style?.size||20)),weight=[300,400,500,600,700].includes(Number(style?.weight))?Number(style.weight):400;
  const x=width*Math.min(100,Math.max(0,Number(style?.x??50)))/100;
  const y=height*Math.min(100,Math.max(0,Number(style?.y??50)))/100;
  const family=certificateCanvasFontFamily(style?.font);
  ctx.save();
  ctx.fillStyle=String(style?.color||"#17334b");
  ctx.textAlign="center";
  ctx.textBaseline="middle";
  ctx.font=weight+" "+size+"px "+family;
  const lines=multiline?String(text).split(/\r?\n/):[String(text).replace(/\r?\n/g," ")];
  const lineHeight=certificateCanvasLineHeight(size),total=(lines.length-1)*lineHeight;
  lines.forEach((line,index)=>ctx.fillText(line,x,y-total/2+index*lineHeight));
  ctx.restore();
}
async function customCertificateCanvas(row,d){
  const t=d.template||{},values=certificateVariableValues(row,d),imageSrc=await ensureCertificateTemplateImage(d);
  if(!imageSrc)throw Error("ไม่พบภาพพื้นหลังเกียรติบัตร");
  await ensureCertificateTemplateFonts(t);
  const bg=await certificateLoadImage(imageSrc);
  const logicalW=1122,logicalH=794,scale=2;
  const canvas=document.createElement("canvas");
  canvas.width=logicalW*scale;canvas.height=logicalH*scale;
  const ctx=canvas.getContext("2d");
  ctx.scale(scale,scale);
  ctx.fillStyle="#fff";ctx.fillRect(0,0,logicalW,logicalH);
  ctx.drawImage(bg,0,0,logicalW,logicalH);
  Object.entries(values).forEach(([key,value])=>{
    const style=t.fields?.[key];
    if(style)certificateDrawText(ctx,value,style,logicalW,logicalH,false);
  });
  (t.textBlocks||[]).forEach(block=>{
    if(!block||block.visible===false)return;
    certificateDrawText(ctx,certificateResolveText(block.text,values),block,logicalW,logicalH,true);
  });
  return canvas;
}
async function certificateCanvas(row,d){
  if(d.template?.enabled){
    await ensureCertificateTemplateImage(d);
    return customCertificateCanvas(row,d);
  }
  await loadCoverageScript("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",()=>!!window.html2canvas);
  const stage=document.createElement("div");stage.className="ops-certificate-stage";stage.innerHTML=certificateHtml(row,d);document.body.appendChild(stage);
  try{
    await document.fonts?.ready?.catch?.(()=>{});
    const imgs=[...stage.querySelectorAll("img")];
    await Promise.all(imgs.map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=img.onerror=resolve;})));
    return await html2canvas(stage.firstElementChild,{scale:1.4,useCORS:true,backgroundColor:"#fff"});
  }finally{stage.remove();}
}
async function confirmProvisionalCertificates(d){
  if(!d?.rows?.some(x=>x.provisional))return true;
  const r=await Swal.fire({icon:"warning",title:"ผลเดือนนี้ยังเป็นข้อมูลชั่วคราว",text:"เดือนที่เลือกยังไม่สิ้นสุด เกียรติบัตรอาจเปลี่ยนได้เมื่อมีผลตรวจเพิ่ม ต้องการสร้างต่อหรือไม่?",showCancelButton:true,confirmButtonText:"สร้างต่อ",cancelButtonText:"ยกเลิก"});
  return r.isConfirmed;
}
async function downloadCertificatesPdf(){
  const d=opCertificateData;if(!d?.rows?.length)return;
  if(!(await confirmProvisionalCertificates(d)))return;
  busy(true,"กำลังสร้างเกียรติบัตร PDF…");
  try{
    if(d.template?.enabled)await ensureCertificateTemplateImage(d);
    await loadCoverageScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",()=>!!window.jspdf?.jsPDF);
    const {jsPDF}=window.jspdf,pdf=new jsPDF("landscape","mm","a4");
    for(let i=0;i<d.rows.length;i++){
      if(i)pdf.addPage("a4","landscape");
      $("loading-text").textContent="กำลังสร้างเกียรติบัตร "+(i+1)+" / "+d.rows.length;
      const canvas=await certificateCanvas(d.rows[i],d),img=canvas.toDataURL("image/jpeg",.94);
      pdf.addImage(img,"JPEG",0,0,297,210);
    }
    pdf.save("RSD-Clean-Certificates-"+d.month+".pdf");toast("สร้าง PDF เกียรติบัตรแล้ว");
  }catch(e){error(e);}finally{busy(false);}
}
async function downloadCertificatesZip(){
  const d=opCertificateData;if(!d?.rows?.length)return;
  if(!(await confirmProvisionalCertificates(d)))return;
  busy(true,"กำลังสร้าง ZIP รูปเกียรติบัตร…");
  try{
    if(d.template?.enabled)await ensureCertificateTemplateImage(d);
    await loadCoverageScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",()=>!!window.JSZip);
    const zip=new JSZip();
    for(let i=0;i<d.rows.length;i++){
      $("loading-text").textContent="กำลังสร้างรูป "+(i+1)+" / "+d.rows.length;
      const canvas=await certificateCanvas(d.rows[i],d),blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
      zip.file((d.rows[i].name||("certificate-"+(i+1))).replace(/[\\/:*?"<>|]/g,"_")+".png",blob);
    }
    const blob=await zip.generateAsync({type:"blob"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="RSD-Clean-Certificates-"+d.month+".zip";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500);
    toast("สร้าง ZIP เกียรติบัตรแล้ว");
  }catch(e){error(e);}finally{busy(false);}
}
function certTemplateDefaults(){
  return{
    enabled:true,
    fields:{
      className:{visible:true,x:50,y:49,size:42,color:"#17334b",weight:700,font:"Kanit"},
      medal:{visible:true,x:50,y:63,size:34,color:"#9a7620",weight:700,font:"Kanit"},
      month:{visible:true,x:50,y:75,size:20,color:"#526b78",weight:500,font:"Kanit"},
      period:{visible:true,x:50,y:82,size:18,color:"#607380",weight:400,font:"Kanit"},
      issueDate:{visible:false,x:50,y:89,size:16,color:"#607380",weight:400,font:"Kanit"}
    },
    textBlocks:[]
  };
}
function certTemplateSampleValues(){
  return{className:"มัธยมศึกษาปีที่ 3/3",medal:"เหรียญทอง",month:"ตุลาคม 2569",period:"ภาคเรียนที่ 2 ปีการศึกษา 2569",issueDate:"31 ตุลาคม 2569"};
}
function certCustomBlock(textValue="",y=50,size=22,color="#17334b",weight=400,font="Sarabun"){
  return{id:"custom-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),text:textValue,visible:true,x:50,y,size,color,weight,font};
}
function certificateFontCss(font){
  return String(font)==="Kanit" ? '"Kanit","Noto Sans Thai",sans-serif' : '"Sarabun","Noto Sans Thai",sans-serif';
}
async function ensureCertificateFont(font,weight=400){
  if(!document.fonts?.load)return false;
  const family=String(font)==="Kanit"?"Kanit":"Sarabun";
  const w=[300,400,500,600,700].includes(Number(weight))?Number(weight):400;
  try{
    await Promise.race([
      document.fonts.load(w+' 32px "'+family+'"',"กขค ABC 123"),
      new Promise(resolve=>setTimeout(resolve,5000))
    ]);
    await document.fonts.ready;
    return document.fonts.check(w+' 32px "'+family+'"',"กขค ABC 123");
  }catch(e){return false;}
}
async function ensureCertificateTemplateFonts(template){
  const jobs=[];
  Object.values(template?.fields||{}).forEach(v=>{if(v?.visible!==false)jobs.push(ensureCertificateFont(v.font,v.weight));});
  (template?.textBlocks||[]).forEach(v=>{if(v?.visible!==false)jobs.push(ensureCertificateFont(v.font,v.weight));});
  if(!jobs.length)jobs.push(ensureCertificateFont("Kanit",400));
  await Promise.all(jobs);
  await document.fonts?.ready?.catch?.(()=>{});
}
function certificateFontOptions(current){
  return [
    ["Kanit","Kanit"],
    ["Sarabun","Sarabun"]
  ].map(([v,label])=>'<option value="'+v+'" '+(String(current||"Kanit")===v?"selected":"")+'>'+label+'</option>').join("");
}
async function certificateTemplateModal(){
  if(S.user?.Role!=="Admin")return;
  openModal("แม่แบบเกียรติบัตร",'<div id="cert-template-body"><div class="muted">กำลังโหลดแม่แบบ…</div></div>');
  const box=$("cert-template-body");
  try{
    const cfg=await rpc("certificateTemplate",{},true),base=certTemplateDefaults();
    let image="",localUrl="",selectedFile=null,uploadTicket="";
    if(cfg.hasImage){
      try{image=await rpc("certificateTemplateImage",{},true);}catch(e){console.warn(e);}
    }
    const state={
      enabled:cfg.hasImage?cfg.enabled:true,
      fields:{},
      textBlocks:Array.isArray(cfg.textBlocks)?cfg.textBlocks.map((b,i)=>({...certCustomBlock("",50,22),...b,id:b.id||("custom-"+i)})):[]
    };
    Object.keys(base.fields).forEach(k=>state.fields[k]={...base.fields[k],...(cfg.fields?.[k]||{})});
    const labels={className:"ชื่อห้องเรียน",medal:"ระดับเหรียญ",month:"เดือน",period:"ภาคเรียน / ปีการศึกษา",issueDate:"วันที่ออกเกียรติบัตร"};
    const controls=Object.keys(state.fields).map(k=>{
      const v=state.fields[k];
      return '<div class="ops-template-field" data-row="'+k+'">'+
        '<label class="ops-template-visible"><input type="checkbox" data-cert-field="'+k+'" data-cert-prop="visible" '+(v.visible?"checked":"")+'><b>'+labels[k]+'</b></label>'+
        '<label>X (%)<input type="number" min="0" max="100" step=".5" value="'+v.x+'" data-cert-field="'+k+'" data-cert-prop="x"></label>'+
        '<label>Y (%)<input type="number" min="0" max="100" step=".5" value="'+v.y+'" data-cert-field="'+k+'" data-cert-prop="y"></label>'+
        '<label>ขนาด<input type="number" min="10" max="96" value="'+v.size+'" data-cert-field="'+k+'" data-cert-prop="size"></label>'+
        '<label>สี<input type="color" value="'+esc(v.color)+'" data-cert-field="'+k+'" data-cert-prop="color"></label>'+
        '<label>น้ำหนัก<select data-cert-field="'+k+'" data-cert-prop="weight">'+[400,500,600,700].map(w=>'<option value="'+w+'" '+(Number(v.weight)===w?"selected":"")+'>'+w+'</option>').join("")+'</select></label>'+
        '<label>ฟอนต์<select data-cert-field="'+k+'" data-cert-prop="font">'+certificateFontOptions(v.font)+'</select></label>'+
      '</div>';
    }).join("");
    box.innerHTML=
      '<div class="warn mb-4"><b>แบบที่แนะนำ:</b> อัปโหลดเฉพาะภาพพื้นหลัง A4 แนวนอน เช่น กรอบ ลวดลาย โลโก้ และลายเซ็น ส่วนข้อความทั้งหมดสามารถเพิ่มและจัดตำแหน่งจากเว็บได้</div>'+
      '<div class="ops-template-layout">'+
        '<div>'+
          '<div class="ops-template-preview" id="cert-template-preview">'+
            '<div class="ops-template-empty" id="cert-template-empty">อัปโหลดภาพพื้นหลังเกียรติบัตรเพื่อเริ่มตั้งค่า</div>'+
            '<img id="cert-template-image" alt="แม่แบบเกียรติบัตร" class="'+(image?"":"hidden")+'" src="'+esc(image)+'">'+
            '<div id="cert-template-overlays"></div>'+
          '</div>'+
          '<p class="muted mt-2">ลากข้อความบน Preview เพื่อจัดตำแหน่งได้โดยตรง หรือกรอก X/Y ด้านขวา</p>'+
        '</div>'+
        '<div class="ops-template-tools">'+
          '<div class="field"><label>ภาพพื้นหลังเกียรติบัตร</label><input id="cert-template-file" type="file" accept="image/png,image/jpeg"><small class="muted">PNG/JPG · สูงสุด 8 MB · แนะนำ A4 แนวนอน</small></div>'+
          '<label class="coverage-toggle"><input id="cert-template-enabled" type="checkbox" '+(state.enabled?"checked":"")+'><span><b>ใช้แม่แบบนี้ในการสร้างเกียรติบัตร</b><small>ปิดได้โดยไม่ลบภาพและตำแหน่งที่ตั้งไว้</small></span></label>'+
          '<div class="ops-template-group"><div class="ops-template-group-head"><div><b>ฟอนต์ทั้งแม่แบบ</b><small>เปลี่ยนข้อความทุกชิ้นพร้อมกัน</small></div><div class="flex gap-2"><button class="btn small secondary" id="cert-all-kanit" type="button">ใช้ Kanit ทั้งหมด</button><button class="btn small secondary" id="cert-all-sarabun" type="button">ใช้ Sarabun ทั้งหมด</button></div></div></div>'+
          '<div class="ops-template-group"><div class="ops-template-group-head"><div><b>ข้อมูลอัตโนมัติ</b><small>ระบบเปลี่ยนค่าให้แต่ละห้องอัตโนมัติ</small></div></div><div class="ops-template-fields">'+controls+'</div></div>'+
          '<div class="ops-template-group">'+
            '<div class="ops-template-group-head"><div><b>ข้อความกำหนดเอง</b><small>ใช้ตัวแปร {className} {medal} {month} {period} {issueDate} ได้</small></div>'+
              '<div class="flex flex-wrap gap-2"><button class="btn small secondary" id="cert-add-sample-text" type="button">ชุดข้อความตัวอย่าง</button><button class="btn small" id="cert-add-text" type="button">+ เพิ่มข้อความ</button></div></div>'+
            '<div id="cert-custom-fields" class="ops-template-custom-list"></div>'+
          '</div>'+
          '<div class="flex flex-wrap gap-2"><button class="btn" id="cert-template-save"><i data-lucide="save"></i> บันทึกแม่แบบ</button>'+
            (cfg.hasImage?'<button class="btn danger" id="cert-template-delete"><i data-lucide="trash-2"></i> ลบแม่แบบ</button>':'')+
          '</div>'+
        '</div>'+
      '</div>';

    const sample=certTemplateSampleValues();
    const findCustom=id=>state.textBlocks.find(x=>x.id===id);
    const syncField=(field)=>{
      const v=state.fields[field];
      box.querySelectorAll('[data-cert-field="'+field+'"]').forEach(el=>{
        const p=el.dataset.certProp;
        if(p==="visible")el.checked=!!v.visible;
        else if(p==="color")el.value=v.color;
        else el.value=v[p];
      });
    };
    const syncCustom=(id)=>{
      const v=findCustom(id);if(!v)return;
      box.querySelectorAll('[data-custom-id="'+id+'"]').forEach(el=>{
        const p=el.dataset.customProp;
        if(p==="visible")el.checked=!!v.visible;
        else if(p==="color")el.value=v.color;
        else if(p==="text")el.value=v.text;
        else el.value=v[p];
      });
    };
    const renderCustomControls=()=>{
      const wrap=$("cert-custom-fields");if(!wrap)return;
      wrap.innerHTML=state.textBlocks.length?state.textBlocks.map((v,index)=>
        '<div class="ops-template-custom-row">'+
          '<div class="ops-template-custom-top"><label class="ops-template-visible"><input type="checkbox" data-custom-id="'+esc(v.id)+'" data-custom-prop="visible" '+(v.visible!==false?"checked":"")+'><b>ข้อความ '+(index+1)+'</b></label><button class="btn small danger cert-remove-text" type="button" data-id="'+esc(v.id)+'">ลบ</button></div>'+
          '<textarea rows="2" maxlength="500" data-custom-id="'+esc(v.id)+'" data-custom-prop="text" placeholder="พิมพ์ข้อความ เช่น ขอมอบเกียรติบัตรฉบับนี้ให้ไว้เพื่อแสดงว่า">'+esc(v.text||"")+'</textarea>'+
          '<div class="ops-template-custom-grid">'+
            '<label>X (%)<input type="number" min="0" max="100" step=".5" value="'+v.x+'" data-custom-id="'+esc(v.id)+'" data-custom-prop="x"></label>'+
            '<label>Y (%)<input type="number" min="0" max="100" step=".5" value="'+v.y+'" data-custom-id="'+esc(v.id)+'" data-custom-prop="y"></label>'+
            '<label>ขนาด<input type="number" min="10" max="96" value="'+v.size+'" data-custom-id="'+esc(v.id)+'" data-custom-prop="size"></label>'+
            '<label>สี<input type="color" value="'+esc(v.color)+'" data-custom-id="'+esc(v.id)+'" data-custom-prop="color"></label>'+
            '<label>น้ำหนัก<select data-custom-id="'+esc(v.id)+'" data-custom-prop="weight">'+[400,500,600,700].map(w=>'<option value="'+w+'" '+(Number(v.weight)===w?"selected":"")+'>'+w+'</option>').join("")+'</select></label>'+
            '<label>ฟอนต์<select data-custom-id="'+esc(v.id)+'" data-custom-prop="font">'+certificateFontOptions(v.font)+'</select></label>'+
          '</div>'+
        '</div>'
      ).join(""):'<div class="empty">ยังไม่มีข้อความกำหนดเอง</div>';
      wrap.querySelectorAll("[data-custom-id]").forEach(el=>{
        el.oninput=async()=>{
          const v=findCustom(el.dataset.customId);if(!v)return;
          const p=el.dataset.customProp;
          v[p]=p==="visible"?el.checked:(p==="text"||p==="color"||p==="font"?el.value:Number(el.value));
          if(p==="font")await ensureCertificateFont(v.font,v.weight);
          renderPreview();
        };
      });
      wrap.querySelectorAll(".cert-remove-text").forEach(b=>b.onclick=()=>{
        state.textBlocks=state.textBlocks.filter(x=>x.id!==b.dataset.id);
        renderCustomControls();renderPreview();
      });
    };
    const wireDrag=()=>{
      box.querySelectorAll(".ops-template-drag").forEach(el=>{
        el.onpointerdown=e=>{
          e.preventDefault();el.setPointerCapture?.(e.pointerId);
          const kind=el.dataset.kind||"field",id=el.dataset.id,preview=$("cert-template-preview");
          const target=kind==="custom"?findCustom(id):state.fields[id];
          if(!target)return;
          const move=ev=>{
            const r=preview.getBoundingClientRect();
            target.x=Math.round(Math.min(100,Math.max(0,(ev.clientX-r.left)/r.width*100))*10)/10;
            target.y=Math.round(Math.min(100,Math.max(0,(ev.clientY-r.top)/r.height*100))*10)/10;
            el.style.left=target.x+"%";el.style.top=target.y+"%";
            kind==="custom"?syncCustom(id):syncField(id);
          };
          const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);};
          window.addEventListener("pointermove",move);window.addEventListener("pointerup",up,{once:true});
        };
      });
    };
    const renderPreview=()=>{
      const overlay=$("cert-template-overlays");if(!overlay)return;
      const autoHtml=Object.entries(sample).map(([k,value])=>{
        const v=state.fields[k];if(!v?.visible)return "";
        return '<div class="ops-template-drag" data-kind="field" data-id="'+k+'" style="left:'+v.x+'%;top:'+v.y+'%;font-size:'+(Number(v.size||20)/11.22)+'cqw;color:'+esc(v.color)+';font-weight:'+v.weight+';font-family:'+certificateFontCss(v.font)+'">'+esc(value)+'</div>';
      }).join("");
      const customHtml=state.textBlocks.map(v=>{
        if(v.visible===false||!String(v.text||"").trim())return "";
        return '<div class="ops-template-drag ops-template-drag-custom" data-kind="custom" data-id="'+esc(v.id)+'" style="left:'+v.x+'%;top:'+v.y+'%;font-size:'+(Number(v.size||20)/11.22)+'cqw;color:'+esc(v.color)+';font-weight:'+v.weight+';font-family:'+certificateFontCss(v.font)+'">'+esc(certificateResolveText(v.text,sample))+'</div>';
      }).join("");
      overlay.innerHTML=autoHtml+customHtml;
      wireDrag();
    };

    box.querySelectorAll("[data-cert-field]").forEach(el=>{
      el.oninput=async()=>{
        const k=el.dataset.certField,p=el.dataset.certProp;
        state.fields[k][p]=p==="visible"?el.checked:(p==="color"||p==="font"?el.value:Number(el.value));
        if(p==="font")await ensureCertificateFont(state.fields[k].font,state.fields[k].weight);
        renderPreview();
      };
    });
    const applyFontAll=async(font)=>{
      Object.values(state.fields).forEach(v=>v.font=font);
      state.textBlocks.forEach(v=>v.font=font);
      await ensureCertificateFont(font,400);
      Object.keys(state.fields).forEach(syncField);
      renderCustomControls();
      renderPreview();
      toast("เปลี่ยนฟอนต์ทั้งแม่แบบเป็น "+font+" แล้ว");
    };
    if($("cert-all-kanit"))$("cert-all-kanit").onclick=()=>applyFontAll("Kanit");
    if($("cert-all-sarabun"))$("cert-all-sarabun").onclick=()=>applyFontAll("Sarabun");
    $("cert-add-text").onclick=()=>{
      state.textBlocks.push(certCustomBlock("",50,22));
      renderCustomControls();renderPreview();
      setTimeout(()=>$("cert-custom-fields")?.querySelector("textarea:last-of-type")?.focus(),0);
    };
    $("cert-add-sample-text").onclick=()=>{
      if(state.textBlocks.length){
        return Swal.fire({icon:"info",title:"มีข้อความกำหนดเองอยู่แล้ว",text:"ลบข้อความเดิมก่อน หากต้องการใช้ชุดข้อความตัวอย่าง"});
      }
      state.textBlocks=[
        certCustomBlock("โรงเรียนรัษฎา อำเภอรัษฎา จังหวัดตรัง",31,34,"#4c86b7",700,"Kanit"),
        certCustomBlock("ขอมอบเกียรติบัตรฉบับนี้ให้ไว้เพื่อแสดงว่า",39,24,"#111827",500,"Kanit"),
        certCustomBlock("นักเรียนระดับชั้น {className}",53,38,"#4c86b7",700,"Kanit"),
        certCustomBlock("ได้ดูแลเขตพื้นที่ของห้องเรียนอยู่ในระดับ {medal}",65,25,"#111827",500,"Kanit"),
        certCustomBlock("ประจำเดือน {month}",72,23,"#111827",500,"Kanit"),
        certCustomBlock("ให้ไว้ ณ วันที่ {issueDate}",78,20,"#111827",500,"Kanit")
      ];
      Object.keys(state.fields).forEach(k=>state.fields[k].visible=false);
      box.querySelectorAll("[data-cert-field]").forEach(el=>{if(el.dataset.certProp==="visible")el.checked=false;});
      renderCustomControls();renderPreview();
    };
    $("cert-template-file").onchange=()=>{
      const file=$("cert-template-file").files?.[0];if(!file)return;
      if(!["image/png","image/jpeg"].includes(file.type))return error(Error("รองรับเฉพาะ PNG หรือ JPG"));
      if(file.size>8*1024*1024)return error(Error("ไฟล์แม่แบบต้องไม่เกิน 8 MB"));
      if(localUrl)URL.revokeObjectURL(localUrl);
      selectedFile=file;uploadTicket="";localUrl=URL.createObjectURL(file);
      $("cert-template-image").src=localUrl;$("cert-template-image").classList.remove("hidden");$("cert-template-empty").classList.add("hidden");renderPreview();
    };
    if(image)$("cert-template-empty").classList.add("hidden");
    await ensureCertificateTemplateFonts(state);
    renderCustomControls();renderPreview();

    $("cert-template-save").onclick=async()=>{
      busy(true,selectedFile?"กำลังอัปโหลดแม่แบบ…":"กำลังบันทึกแม่แบบ…");
      try{
        if(selectedFile&&!uploadTicket){
          const up=await rpc("certificateTemplateUploadStart",{mime:selectedFile.type,size:selectedFile.size,origin:location.origin},true);
          const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
          let res;
          try{
            res=await fetch(up.url,{method:"PUT",headers:{"Content-Type":selectedFile.type,"Content-Range":"bytes 0-"+(selectedFile.size-1)+"/"+selectedFile.size},body:selectedFile,signal:controller.signal});
          }finally{clearTimeout(timer);}
          if(!(res.status===200||res.status===201))throw Error("อัปโหลดแม่แบบไม่สำเร็จ (HTTP "+res.status+")");
          uploadTicket=up.ticket;
        }
        state.enabled=$("cert-template-enabled").checked;
        await rpc("saveCertificateTemplate",{uploadTicket,config:state},true);
        opCertificateTemplateImage="";
        toast("บันทึกแม่แบบเกียรติบัตรแล้ว");closeModal();
        if(S.route==="certificates")await loadCertificates(S.seq);
      }catch(e){error(e);}finally{busy(false);}
    };
    if($("cert-template-delete"))$("cert-template-delete").onclick=async()=>{
      const ok=await Swal.fire({icon:"warning",title:"ลบแม่แบบเกียรติบัตร?",text:"ระบบจะกลับไปใช้รูปแบบมาตรฐาน",showCancelButton:true,confirmButtonText:"ลบแม่แบบ",cancelButtonText:"ยกเลิก"});
      if(!ok.isConfirmed)return;
      try{await rpc("deleteCertificateTemplate",{},true);opCertificateTemplateImage="";toast("ลบแม่แบบแล้ว");closeModal();if(S.route==="certificates")await loadCertificates(S.seq);}catch(e){error(e);}
    };
    icons();
  }catch(e){box.innerHTML='<div class="warn">'+esc(e.message||String(e))+'</div>';}
}

/* =========================
   5) WEB PUSH ENROLLMENT
   ========================= */
function opBytesToBase64Url(bytes){
  let bin="";for(const b of new Uint8Array(bytes))bin+=String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
async function generateVapidSetup(){
  try{
    const keys=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
    const raw=await crypto.subtle.exportKey("raw",keys.publicKey),jwk=await crypto.subtle.exportKey("jwk",keys.privateKey);
    const publicKey=opBytesToBase64Url(raw),privateJwk=JSON.stringify(jwk);
    await Swal.fire({
      width:760,
      title:"VAPID Key สำหรับ RSD Clean",
      html:
        '<div style="text-align:left"><p class="muted">คีย์นี้สร้างในเบราว์เซอร์ของ Admin และไม่ได้ส่งขึ้น GitHub กรุณานำไปตั้งใน Cloudflare Pages → Settings → Environment variables</p>'+
        '<label style="font-weight:600">VAPID_PUBLIC_KEY</label><textarea id="vapid-public-copy" class="swal2-textarea" style="width:100%;height:75px">'+esc(publicKey)+'</textarea>'+
        '<label style="font-weight:600">VAPID_PRIVATE_JWK</label><textarea id="vapid-private-copy" class="swal2-textarea" style="width:100%;height:145px">'+esc(privateJwk)+'</textarea>'+
        '<label style="font-weight:600">VAPID_SUBJECT</label><textarea class="swal2-textarea" style="width:100%;height:60px">https://rsd-clean.pages.dev</textarea>'+
        '<div class="warn mt-3"><b>สำคัญ:</b> VAPID_PRIVATE_JWK เป็น Secret ห้ามใส่ลง GitHub หรือส่งต่อสาธารณะ หลังตั้งค่าให้ Deploy ใหม่แล้วกลับมากด “การแจ้งเตือนมือถือ” อีกครั้ง</div></div>',
      confirmButtonText:"ปิด"
    });
  }catch(e){error(e);}
}

function base64UrlToUint8Array(base64String){
  const padding="=".repeat((4-base64String.length%4)%4),base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(base64),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;
}
async function pushNotificationModal(){
  openModal("การแจ้งเตือนมือถือ",'<div id="push-body"><div class="muted">กำลังตรวจสอบ Push Notification…</div></div>');
  const box=$("push-body");
  try{
    const r=await rpc("pushStatus",{},true),supported="serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window;
    let localSub=null;
    if(supported){const reg=await navigator.serviceWorker.ready;localSub=await reg.pushManager.getSubscription();}
    box.innerHTML=
      '<div class="ops-push-card">'+
        '<div class="ops-push-icon"><i data-lucide="bell-ring"></i></div>'+
        '<div><h3>แจ้งเตือนแม้ไม่ได้เปิดหน้าเว็บ</h3><p class="muted">เมื่อเปิดใช้งาน อุปกรณ์จะลงทะเบียนรับ Web Push จาก RSD Clean</p></div>'+
      '</div>'+
      (!supported?'<div class="warn mt-4">เบราว์เซอร์/โหมดนี้ไม่รองรับ Web Push กรุณาติดตั้ง PWA หรือใช้เบราว์เซอร์ที่รองรับ</div>':
        !r.configured?'<div class="warn mt-4"><b>ยังไม่ได้ตั้ง VAPID ที่ Cloudflare</b><br>โค้ดรองรับ Web Push แล้ว แต่ต้องเพิ่ม Environment Variables ก่อน</div>'+(S.user?.Role==="Admin"?'<button class="btn secondary mt-3" id="push-generate-vapid"><i data-lucide="key-round"></i> สร้าง VAPID Key สำหรับตั้งค่า</button>':''):
        '<div class="card mt-4"><p>สถานะอุปกรณ์นี้: <b>'+(localSub?"เปิดรับ Push แล้ว":"ยังไม่ได้เปิด")+'</b></p>'+
          '<div class="flex flex-wrap gap-2"><button class="btn '+(localSub?"danger":"")+'" id="push-toggle">'+(localSub?"ปิดการแจ้งเตือนบนอุปกรณ์นี้":"เปิดการแจ้งเตือน")+'</button>'+
          (localSub?'<button class="btn secondary" id="push-test"><i data-lucide="send"></i> ทดสอบ Push</button>':'')+'</div></div>')+
      '<p class="muted mt-4">Subscription ในบัญชีนี้: '+Number(r.subscriptions?.length||0)+' อุปกรณ์</p>';
    if($("push-generate-vapid"))$("push-generate-vapid").onclick=generateVapidSetup;
    if($("push-test"))$("push-test").onclick=async()=>{
      try{
        const result=await rpc("sendPushTest",{},true);
        toast(result.sent?"ส่ง Push ทดสอบแล้ว":"ยังส่ง Push ไม่สำเร็จ");
      }catch(e){error(e);}
    };
    if($("push-toggle"))$("push-toggle").onclick=async()=>{
      try{
        const reg=await navigator.serviceWorker.ready,current=await reg.pushManager.getSubscription();
        if(current){
          await rpc("deletePushSubscription",{endpoint:current.endpoint},true).catch(()=>{});
          await current.unsubscribe();toast("ปิด Push Notification แล้ว");await pushNotificationModal();
        }else{
          const permission=await Notification.requestPermission();if(permission!=="granted")throw Error("ไม่ได้รับอนุญาตให้ส่งการแจ้งเตือน");
          const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64UrlToUint8Array(r.publicKey)});
          await rpc("savePushSubscription",{subscription:sub.toJSON(),deviceLabel:getDeviceIdentity().label},true);
          toast("เปิด Push Notification แล้ว");await pushNotificationModal();
        }
      }catch(e){error(e);}
    };
    icons();
  }catch(e){box.innerHTML='<div class="warn">'+esc(e.message||String(e))+'</div>';}
}
