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
async function renderCertificateCenter(seq){
  const month=thaiDay().slice(0,7);
  $("app").innerHTML=
    heading("เกียรติบัตรอัตโนมัติ 🏅","สร้างเกียรติบัตรรายเดือนจากผลตรวจที่ผ่านเกณฑ์")+
    '<form id="certificate-filter" class="card daily-filter mb-4"><div class="field m-0"><label>เดือน</label><input id="certificate-month" type="month" value="'+month+'" max="'+month+'"></div><button class="btn" type="submit">ประมวลผล</button></form>'+
    '<div id="certificate-content"><div class="card empty">กำลังคำนวณเกียรติบัตร…</div></div>';
  $("certificate-filter").onsubmit=e=>{e.preventDefault();loadCertificates(S.seq).catch(error);};icons();
  await loadCertificates(seq);
}
async function loadCertificates(seq=S.seq){
  const month=$("certificate-month").value,d=await rpc("certificateData",{month},true);if(seq!==S.seq)return;opCertificateData=d;
  const groups={ทอง:d.rows.filter(x=>x.medal==="เหรียญทอง"),เงิน:d.rows.filter(x=>x.medal==="เหรียญเงิน"),ทองแดง:d.rows.filter(x=>x.medal==="เหรียญทองแดง")};
  $("certificate-content").innerHTML=
    '<div class="exec-kpi-grid">'+
      '<article class="exec-kpi excellent"><span>เหรียญทอง</span><b>'+groups.ทอง.length+'</b><small>ห้องเรียน</small></article>'+
      '<article class="exec-kpi"><span>เหรียญเงิน</span><b>'+groups.เงิน.length+'</b><small>ห้องเรียน</small></article>'+
      '<article class="exec-kpi improve"><span>เหรียญทองแดง</span><b>'+groups.ทองแดง.length+'</b><small>ห้องเรียน</small></article>'+
      '<article class="exec-kpi"><span>รวมได้เกียรติบัตร</span><b>'+d.rows.length+'</b><small>'+esc(d.period?.Label||opMonthText(d.month))+'</small></article>'+
    '</div>'+
    '<section class="card mt-4"><div class="coverage-section-head"><div><h2>รายชื่อที่ผ่านเกณฑ์</h2><p class="muted">'+esc(opMonthText(d.month))+'</p></div>'+
      '<div class="flex flex-wrap gap-2"><button class="btn" id="cert-pdf"><i data-lucide="file-down"></i> ดาวน์โหลด PDF ทั้งหมด</button><button class="btn secondary" id="cert-zip"><i data-lucide="archive"></i> ZIP รูป PNG</button></div></div>'+
      (d.rows.length?table(["ห้องเรียน","ระดับ","ปรับปรุง","จำนวนวันตรวจ"],d.rows.map(x=>[esc(x.name),'<b>'+esc(x.medal)+'</b>'+(x.provisional?' <span class="pill gray">ชั่วคราว</span>':''),String(x.improve||0),String(x.inspectionDays||0)])):'<div class="empty">ไม่มีห้องที่ผ่านเกณฑ์ในเดือนนี้</div>')+
    '</section>';
  if($("cert-pdf"))$("cert-pdf").onclick=downloadCertificatesPdf;
  if($("cert-zip"))$("cert-zip").onclick=downloadCertificatesZip;
  icons();
}
function certificateHtml(row,d){
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
async function certificateCanvas(row,d){
  await loadCoverageScript("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",()=>!!window.html2canvas);
  const stage=document.createElement("div");stage.className="ops-certificate-stage";stage.innerHTML=certificateHtml(row,d);document.body.appendChild(stage);
  try{
    await document.fonts?.ready?.catch?.(()=>{});
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
