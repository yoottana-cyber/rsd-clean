"use strict";

function coverageDateText(date){
  try{return new Date(date+"T12:00:00+07:00").toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"numeric",timeZone:"Asia/Bangkok"});}
  catch(e){return date;}
}
function coverageStatusPill(status,score){
  if(status==="งดตรวจ")return '<span class="pill gray">งดตรวจ</span>';
  if(status==="รอตรวจ")return '<span class="pill gray">รอตรวจ</span>';
  return pill(Number(score||0));
}
function coverageApprovalPill(status){
  const cls=status==="รับรองแล้ว"?"green":status==="รอรับรอง"?"yellow":status==="ส่งกลับแก้ไข"?"red":"gray";
  return '<span class="pill '+cls+'">'+esc(status||"—")+'</span>';
}

/* =========================
   1) SUBSTITUTE / DUTY OVERRIDE
   ========================= */
async function dutyOverrideModal(){
  if(S.user?.Role!=="Admin")return;
  if(!S.master)S.master=await rpc("master");
  openModal("ผู้ตรวจทดแทน / สลับเวร",'<div id="duty-override-body"><div class="muted">กำลังโหลดรายการ…</div></div>');
  await refreshDutyOverrideModal();
}
async function refreshDutyOverrideModal(){
  const box=$("duty-override-body");if(!box)return;
  try{
    const today=thaiDay(),end=(()=>{const d=new Date(today+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+45);return d.toISOString().slice(0,10);})();
    const rows=await rpc("dutyOverrides",{start:today,end},true);
    const inspectors=(S.master?.Users||[]).filter(x=>x.Role==="Inspector"),areas=S.master?.Areas||[];
    const option=(rows,key,label,empty)=>'<option value="">'+esc(empty||"— เลือก —")+'</option>'+rows.map(x=>'<option value="'+esc(x[key])+'">'+esc(x[label])+'</option>').join("");
    box.innerHTML=
      '<form id="duty-override-form" class="coverage-form-grid">'+
        '<div class="field"><label>วันที่</label><input name="date" type="date" min="'+today+'" value="'+today+'" required></div>'+
        '<div class="field"><label>พื้นที่</label><select name="areaId" required>'+option(areas,"AreaID","AreaName","— เลือกพื้นที่ —")+'</select></div>'+
        '<div class="field"><label>ผู้ตรวจเดิม (ถ้ามี)</label><select name="replaceUserId">'+option(inspectors,"UserID","FullName","— เพิ่มผู้ตรวจทดแทนโดยไม่แทนใคร —")+'</select></div>'+
        '<div class="field"><label>ผู้ตรวจทดแทน</label><select name="substituteUserId" required>'+option(inspectors,"UserID","FullName","— เลือกผู้ตรวจทดแทน —")+'</select></div>'+
        '<div class="field coverage-span-2"><label>เหตุผล</label><input name="reason" maxlength="300" placeholder="เช่น ผู้ตรวจเดิมลา / ติดภารกิจ"></div>'+
        '<div class="coverage-span-2"><button class="btn" type="submit"><i data-lucide="user-round-check"></i> บันทึกเวรทดแทน</button></div>'+
      '</form>'+
      '<div class="coverage-section-head mt-5"><div><h3>รายการวันนี้และล่วงหน้า</h3><p class="muted">เวรทดแทนมีผลเฉพาะวันที่กำหนด ไม่แก้เวรประจำ</p></div></div>'+
      (rows.length?table(["วันที่","พื้นที่","ผู้ตรวจเดิม","ผู้ตรวจทดแทน","เหตุผล","จัดการ"],rows.map(r=>[
        coverageDateText(r.override_date),esc(r.area_name||"—"),esc(r.replace_name||"—"),esc(r.substitute_name||"—"),esc(r.reason||"—"),
        '<button class="btn small danger duty-delete" data-id="'+esc(r.override_id)+'">ลบ</button>'
      ])):'<div class="empty">ยังไม่มีเวรทดแทน</div>');
    $("duty-override-form").onsubmit=async e=>{
      e.preventDefault();const f=e.target.elements;
      try{
        await rpc("saveDutyOverride",{date:f.date.value,areaId:f.areaId.value,replaceUserId:f.replaceUserId.value,substituteUserId:f.substituteUserId.value,reason:f.reason.value});
        toast("บันทึกผู้ตรวจทดแทนแล้ว");await refreshDutyOverrideModal();
      }catch(err){error(err);}
    };
    box.querySelectorAll(".duty-delete").forEach(b=>b.onclick=async()=>{
      const ok=await Swal.fire({icon:"question",title:"ยกเลิกเวรทดแทนนี้?",showCancelButton:true,confirmButtonText:"ยกเลิกเวรทดแทน",cancelButtonText:"กลับ"});
      if(!ok.isConfirmed)return;
      try{await rpc("deleteDutyOverride",{id:b.dataset.id});toast("ยกเลิกเวรทดแทนแล้ว");await refreshDutyOverrideModal();}catch(e){error(e);}
    });
    icons();
  }catch(e){box.innerHTML='<div class="warn">'+esc(e.message||String(e))+'</div>';}
}

/* =========================
   8) CENTRAL SETTINGS
   ========================= */
async function appSettingsModal(){
  if(S.user?.Role!=="Admin")return;
  openModal("ตั้งค่าระบบ",'<div id="app-settings-body"><div class="muted">กำลังโหลดการตั้งค่า…</div></div>');
  try{
    const cfg=await rpc("appSettings",{},true);S.config=cfg;
    const box=$("app-settings-body");if(!box)return;
    box.innerHTML=
      '<form id="app-settings-form">'+
        '<div class="coverage-settings-grid">'+
          '<div class="field"><label>ชื่อโรงเรียน</label><input name="schoolName" maxlength="200" value="'+esc(cfg.schoolName||"")+'" required></div>'+
          '<div class="field"><label>URL โลโก้โรงเรียน</label><input name="schoolLogoUrl" maxlength="500" value="'+esc(cfg.schoolLogoUrl||"/school-logo")+'" placeholder="/school-logo"></div>'+
          '<div class="field"><label>ข้อความท้ายรายงาน</label><input name="reportFooter" maxlength="300" value="'+esc(cfg.reportFooter||"")+'"></div>'+
          '<div class="field"><label>ชื่อระดับ 3 คะแนน</label><input name="score3" maxlength="50" value="'+esc(cfg.scoreLabels?.["3"]||"ยอดเยี่ยม")+'"></div>'+
          '<div class="field"><label>ชื่อระดับ 2 คะแนน</label><input name="score2" maxlength="50" value="'+esc(cfg.scoreLabels?.["2"]||"ปานกลาง")+'"></div>'+
          '<div class="field"><label>ชื่อระดับ 1 คะแนน</label><input name="score1" maxlength="50" value="'+esc(cfg.scoreLabels?.["1"]||"ปรับปรุง")+'"></div>'+
          '<div class="field"><label>เวลาเริ่มตรวจ</label><input name="inspectionStart" type="time" value="'+esc(cfg.inspectionStart||"07:30")+'" required></div>'+
          '<div class="field"><label>เวลาสิ้นสุดการตรวจ</label><input name="inspectionEnd" type="time" value="'+esc(cfg.inspectionEnd||"16:30")+'" required></div>'+
          '<div class="field"><label>เก็บถังขยะ (วัน)</label><input name="recycleDays" type="number" min="1" max="180" value="'+Number(cfg.recycleDays||30)+'"></div>'+
          '<div class="field"><label>เหรียญเงิน: ปรับปรุงไม่เกิน</label><input name="certificateSilverMax" type="number" min="0" max="20" value="'+Number(cfg.certificateSilverMax||3)+'"></div>'+
          '<div class="field"><label>เหรียญทองแดง: ปรับปรุงไม่เกิน</label><input name="certificateBronzeMax" type="number" min="0" max="30" value="'+Number(cfg.certificateBronzeMax||5)+'"></div>'+
        '</div>'+
        '<div class="coverage-toggle-grid">'+
          '<label class="coverage-toggle"><input name="approvalEnabled" type="checkbox" '+(cfg.approvalEnabled?"checked":"")+'><span><b>เปิดระบบรับรองผลตรวจ</b><small>ผลตรวจ/งดตรวจจะเป็น “รอรับรอง” ก่อนนำไปใช้</small></span></label>'+
          '<label class="coverage-toggle"><input name="offlineEnabled" type="checkbox" '+(cfg.offlineEnabled!==false?"checked":"")+'><span><b>อนุญาต Offline Sync</b><small>ผู้ตรวจบันทึกไว้ในเครื่องเมื่ออินเทอร์เน็ตหลุด</small></span></label>'+
        '</div>'+
        '<div class="field"><label>เหตุผล “งดตรวจ” (1 บรรทัดต่อ 1 เหตุผล)</label><textarea name="skipReasons" rows="7">'+esc((cfg.skipReasons||[]).join("\n"))+'</textarea></div>'+
        '<button class="btn w-full" type="submit"><i data-lucide="save"></i> บันทึกการตั้งค่า</button>'+
      '</form>';
    $("app-settings-form").onsubmit=async e=>{
      e.preventDefault();const f=e.target.elements;
      const settings={
        schoolName:f.schoolName.value,schoolLogoUrl:f.schoolLogoUrl.value,reportFooter:f.reportFooter.value,
        scoreLabels:{"1":f.score1.value,"2":f.score2.value,"3":f.score3.value},
        inspectionStart:f.inspectionStart.value,inspectionEnd:f.inspectionEnd.value,
        recycleDays:Number(f.recycleDays.value),certificateSilverMax:Number(f.certificateSilverMax.value),certificateBronzeMax:Number(f.certificateBronzeMax.value),
        approvalEnabled:f.approvalEnabled.checked,offlineEnabled:f.offlineEnabled.checked,
        skipReasons:f.skipReasons.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)
      };
      try{
        const saved=await rpc("saveAppSettings",{settings});S.config=saved;
        try{localStorage.setItem("rsd-config-cache",JSON.stringify(saved));}catch(e){}
        if(typeof applyBrandSettings==="function")applyBrandSettings();
        toast("บันทึกการตั้งค่าระบบแล้ว");closeModal();
      }catch(err){error(err);}
    };
    icons();
  }catch(e){$("app-settings-body").innerHTML='<div class="warn">'+esc(e.message||String(e))+'</div>';}
}

/* =========================
   2) APPROVAL / REVIEW
   ========================= */
async function renderReviewQueue(seq){
  $("app").innerHTML=heading("รับรองผลตรวจ ✅","ตรวจสอบผลก่อนนำไปใช้ในรายงานและเกียรติบัตร",'<button class="btn" id="review-refresh"><i data-lucide="refresh-cw"></i> รีเฟรช</button>')+'<div id="review-content"></div>';
  $("review-refresh").onclick=()=>loadReviewQueue(S.seq).catch(error);icons();
  await loadReviewQueue(seq);
}
async function loadReviewQueue(seq=S.seq){
  const r=await rpc("reviewQueue",{},true);if(seq!==S.seq)return;
  if(!r.enabled){
    $("review-content").innerHTML='<section class="card empty"><h3 class="mb-2">ระบบรับรองผลยังไม่ได้เปิด</h3><p class="muted">Admin สามารถเปิดได้ที่ จัดการข้อมูล → ตั้งค่าระบบ</p></section>';return;
  }
  const rows=r.rows||[],waiting=rows.filter(x=>x.ApprovalStatus==="รอรับรอง"),returned=rows.filter(x=>x.ApprovalStatus==="ส่งกลับแก้ไข");
  $("review-content").innerHTML=
    '<div class="exec-kpi-grid mb-4"><article class="exec-kpi"><span>รอรับรอง</span><b>'+waiting.length+'</b><small>ต้องตรวจสอบ</small></article><article class="exec-kpi improve"><span>ส่งกลับแก้ไข</span><b>'+returned.length+'</b><small>รอผู้ตรวจแก้ไข</small></article></div>'+
    '<section class="card"><div class="flex flex-wrap items-center justify-between gap-3 mb-4"><h2>รายการผลตรวจ</h2><div class="search-box"><i data-lucide="search"></i><input id="review-search" type="search" placeholder="ค้นหาห้อง / พื้นที่ / ผู้ตรวจ…"></div></div>'+
    (rows.length?table(["วันที่","ห้อง/พื้นที่","ผล","ผู้ตรวจ","สถานะรับรอง","หลักฐาน","จัดการ"],rows.map((x,idx)=>[
      coverageDateText(x.Date),'<b>'+esc(x.ClassName)+'</b><br><span class="muted">'+esc(x.AreaName)+'</span>',
      x.Status==="งดตรวจ"?'<span class="pill gray">งดตรวจ</span><br><small>'+esc(x.SkipReason||"")+'</small>':pill(x.Score,x.Rating),
      esc(x.CompletedBy||"—"),coverageApprovalPill(x.ApprovalStatus),
      x.PhotoLinks?.length?'<button class="btn small secondary review-photo" data-index="'+idx+'">ดูรูป</button>':'—',
      x.ApprovalStatus==="รอรับรอง"?'<button class="btn small review-approve" data-index="'+idx+'">รับรอง</button> <button class="btn small danger review-return" data-index="'+idx+'">ส่งกลับ</button>':'<span class="muted">'+esc(x.ReviewNote||"รอแก้ไข")+'</span>'
    ])):'<div class="empty">ไม่มีผลตรวจรอรับรอง</div>')+'</section>';
  const search=$("review-search");if(search)search.oninput=()=>{const q=search.value.trim().toLocaleLowerCase("th");document.querySelectorAll("#review-content tbody tr").forEach(tr=>tr.style.display=!q||tr.textContent.toLocaleLowerCase("th").includes(q)?"":"none");};
  document.querySelectorAll(".review-photo").forEach(b=>b.onclick=()=>coveragePhoto(rows[Number(b.dataset.index)]));
  document.querySelectorAll(".review-approve").forEach(b=>b.onclick=async()=>{
    const x=rows[Number(b.dataset.index)],ok=await Swal.fire({icon:"question",title:"รับรองผลตรวจนี้?",text:x.ClassName+" · "+x.AreaName,showCancelButton:true,confirmButtonText:"รับรอง",cancelButtonText:"ยกเลิก"});
    if(!ok.isConfirmed)return;
    try{await rpc("reviewInspection",{id:x.InspectionID,decision:"approve",note:""});toast("รับรองผลตรวจแล้ว");await loadReviewQueue();}catch(e){error(e);}
  });
  document.querySelectorAll(".review-return").forEach(b=>b.onclick=async()=>{
    const x=rows[Number(b.dataset.index)],r=await Swal.fire({icon:"warning",title:"ส่งกลับให้ผู้ตรวจแก้ไข",input:"textarea",inputLabel:"เหตุผล/สิ่งที่ต้องแก้ไข",inputPlaceholder:"กรุณาระบุรายละเอียด",showCancelButton:true,confirmButtonText:"ส่งกลับ",cancelButtonText:"ยกเลิก",preConfirm:v=>{if(!String(v||"").trim()){Swal.showValidationMessage("กรุณาระบุเหตุผล");return false;}return String(v).trim();}});
    if(!r.isConfirmed)return;
    try{await rpc("reviewInspection",{id:x.InspectionID,decision:"return",note:r.value});toast("ส่งกลับให้ผู้ตรวจแก้ไขแล้ว");await loadReviewQueue();}catch(e){error(e);}
  });
  icons();
}
async function coveragePhoto(x){
  try{
    const link=x.PhotoLinks?.[0];if(!link)throw Error("ไม่พบรูปหลักฐาน");
    const src=await rpc("photo",{inspectionId:x.InspectionID,fileId:link.id});
    openModal("รูปหลักฐาน: "+(x.AreaName||""),'<img class="photo" alt="หลักฐาน" src="'+esc(src)+'">');
  }catch(e){error(e);}
}

/* =========================
   4) DOCUMENTED NO-INSPECTION EXCEPTIONS
   ========================= */
async function inspectionExceptionModal(date=thaiDay()){
  if(!["Admin","Supervisor"].includes(S.user?.Role))return;
  openModal("จัดการงดตรวจ / ไม่สามารถตรวจได้",'<div id="inspection-exception-body"><div class="muted">กำลังโหลดงานตรวจ…</div></div>');
  await refreshInspectionExceptionModal(date);
}
async function refreshInspectionExceptionModal(date){
  const box=$("inspection-exception-body");if(!box)return;
  try{
    const r=await rpc("inspectionExceptions",{date},true),cfg=r.settings||S.config||{},rows=r.rows||[];
    const pending=rows.filter(x=>x.Status==="รอตรวจ"),skipped=rows.filter(x=>x.Status==="งดตรวจ");
    box.innerHTML=
      '<div class="coverage-section-head mb-4"><div><h3>'+esc(coverageDateText(r.date))+'</h3><p class="muted">ใช้เมื่อมีเหตุจำเป็นที่ทำให้พื้นที่ไม่ได้รับการตรวจ</p></div></div>'+
      (pending.length
        ? '<form id="exception-form" class="coverage-form-grid">'+
            '<div class="field coverage-span-2"><label>พื้นที่ที่ยังรอตรวจ</label><select name="id" required><option value="">— เลือกพื้นที่ —</option>'+pending.map(x=>'<option value="'+esc(x.InspectionID)+'">'+esc(x.ClassName)+' · '+esc(x.AreaName)+'</option>').join("")+'</select></div>'+
            '<div class="field"><label>เหตุผล</label><select name="reason" required><option value="">— เลือกเหตุผล —</option>'+(cfg.skipReasons||[]).map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("")+'</select></div>'+
            '<div class="field"><label>หมายเหตุเพิ่มเติม</label><input name="note" maxlength="2000" placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"></div>'+
            '<div class="coverage-span-2"><button class="btn" type="submit"><i data-lucide="circle-off"></i> บันทึกเป็นงดตรวจ</button></div>'+
          '</form>'
        : '<div class="empty mb-4">ไม่มีงานรอตรวจในวันที่เลือก</div>')+
      '<div class="coverage-section-head mt-5"><div><h3>รายการงดตรวจแล้ว</h3><p class="muted">วันนี้สามารถเปิดกลับเป็น “รอตรวจ” ได้</p></div></div>'+
      (skipped.length?table(["ห้องเรียน","พื้นที่","เหตุผล","หมายเหตุ","จัดการ"],skipped.map(x=>[
        esc(x.ClassName),esc(x.AreaName),esc(x.SkipReason||"—"),esc(x.Notes||"—"),
        r.date===thaiDay()?'<button class="btn small secondary exception-reopen" data-id="'+esc(x.InspectionID)+'">เปิดกลับเป็นรอตรวจ</button>':'—'
      ])):'<div class="empty">ยังไม่มีรายการงดตรวจ</div>');
    if($("exception-form"))$("exception-form").onsubmit=async e=>{
      e.preventDefault();const f=e.target.elements;
      try{
        await rpc("setInspectionException",{id:f.id.value,action:"skip",reason:f.reason.value,note:f.note.value});
        toast("บันทึกเหตุผลงดตรวจแล้ว");
        await refreshInspectionExceptionModal(date);
      }catch(err){error(err);}
    };
    box.querySelectorAll(".exception-reopen").forEach(b=>b.onclick=async()=>{
      const ok=await Swal.fire({icon:"question",title:"เปิดงานกลับเป็นรอตรวจ?",showCancelButton:true,confirmButtonText:"เปิดงาน",cancelButtonText:"ยกเลิก"});
      if(!ok.isConfirmed)return;
      try{await rpc("setInspectionException",{id:b.dataset.id,action:"reopen"});toast("เปิดงานกลับเป็นรอตรวจแล้ว");await refreshInspectionExceptionModal(date);}catch(e){error(e);}
    });
    icons();
  }catch(e){box.innerHTML='<div class="warn">'+esc(e.message||String(e))+'</div>';}
}

/* =========================
   5-6) AREA / CLASS HISTORY
   ========================= */
let coverageHistoryOptions=null,coverageHistoryData=null;
async function renderHistoryHub(seq){
  const opts=await rpc("historyOptions",{},true);if(seq!==S.seq)return;coverageHistoryOptions=opts;
  const teacher=S.user?.Role==="Teacher",inspector=S.user?.Role==="Inspector";
  const types=teacher?["class"]:inspector?["area"]:["area","class"];
  const option=(rows)=>rows.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+(x.class_name?' · '+esc(x.class_name):'')+'</option>').join("");
  $("app").innerHTML=
    heading("ประวัติพื้นที่ / ห้องเรียน 🕘","ดูคะแนน แนวโน้ม หมายเหตุ และหลักฐานย้อนหลัง")+
    '<form id="history-filter" class="card coverage-history-filter mb-4">'+
      '<div class="field"><label>มุมมอง</label><select id="history-type">'+types.map(t=>'<option value="'+t+'">'+(t==="area"?"พื้นที่":"ห้องเรียน")+'</option>').join("")+'</select></div>'+
      '<div class="field"><label>รายการ</label><select id="history-id"></select></div>'+
      '<div class="field"><label>เริ่ม</label><input id="history-start" type="date" value="'+coverageShiftDay(thaiDay(),-89)+'"></div>'+
      '<div class="field"><label>ถึง</label><input id="history-end" type="date" value="'+thaiDay()+'" max="'+thaiDay()+'"></div>'+
      '<button class="btn" type="submit">แสดงประวัติ</button>'+
    '</form><div id="history-content"><div class="card empty">เลือกรายการเพื่อดูประวัติ</div></div>';
  const setIds=()=>{
    const t=$("history-type").value,rows=t==="area"?opts.areas:opts.classes;
    $("history-id").innerHTML=option(rows);
  };
  $("history-type").onchange=()=>{setIds();loadCoverageHistory().catch(error);};
  $("history-filter").onsubmit=e=>{e.preventDefault();loadCoverageHistory().catch(error);};
  setIds();
  try{
    const pref=JSON.parse(sessionStorage.getItem("rsd-history-prefill")||"null");
    if(pref&&types.includes(pref.type)){
      $("history-type").value=pref.type;setIds();
      if([...$("history-id").options].some(o=>o.value===pref.id))$("history-id").value=pref.id;
    }
    sessionStorage.removeItem("rsd-history-prefill");
  }catch(e){}
  icons();
  if($("history-id").value)await loadCoverageHistory(seq);
}
function coverageShiftDay(date,offset){const d=new Date(date+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
async function loadCoverageHistory(seq=S.seq){
  const id=$("history-id")?.value;if(!id)return;
  const type=$("history-type").value,start=$("history-start").value,end=$("history-end").value;
  const d=await rpc("historyData",{type,id,start,end},true);if(seq!==S.seq)return;coverageHistoryData=d;
  const s=d.summary||{};
  $("history-content").innerHTML=
    '<div class="exec-kpi-grid">'+
      '<article class="exec-kpi"><span>ผลตรวจ</span><b>'+s.done+'</b><small>จาก '+s.total+' รายการ</small></article>'+
      '<article class="exec-kpi"><span>คะแนนเฉลี่ย</span><b>'+Number(s.avg||0).toFixed(2)+'</b><small>จากคะแนนเต็ม 3</small></article>'+
      '<article class="exec-kpi excellent"><span>ยอดเยี่ยม</span><b>'+s.excellent+'</b><small>ครั้ง</small></article>'+
      '<article class="exec-kpi improve"><span>ปรับปรุง</span><b>'+s.improve+'</b><small>งดตรวจ '+s.skipped+' ครั้ง</small></article>'+
    '</div>'+
    '<div class="grid xl:grid-cols-2 gap-5 mt-4">'+
      '<section class="card"><h2 class="mb-3">แนวโน้มคะแนน</h2><div class="chart-box"><canvas id="history-chart"></canvas></div></section>'+
      '<section class="card"><h2 class="mb-3">สรุปผล</h2><div class="coverage-result-bars">'+
        coverageBar("ยอดเยี่ยม",s.excellent,s.done,"excellent")+coverageBar("ปานกลาง",s.medium,s.done,"medium")+coverageBar("ปรับปรุง",s.improve,s.done,"improve")+
      '</div></section>'+
    '</div>'+
    '<section class="card mt-5"><div class="flex flex-wrap justify-between items-center gap-3 mb-4"><h2>รายการย้อนหลัง</h2><button class="btn secondary" id="history-export">ส่งออกช่วงนี้</button></div>'+
      (d.rows.length?table(["วันที่","ห้องเรียน","พื้นที่","สถานะ/ผล","หมายเหตุ","รับรอง","รูป"],d.rows.map((x,idx)=>[
        coverageDateText(x.Date),esc(x.ClassName),esc(x.AreaName),coverageStatusPill(x.Status,x.Score)+(x.SkipReason?'<br><small>'+esc(x.SkipReason)+'</small>':''),
        esc(x.Notes||"—"),coverageApprovalPill(x.ApprovalStatus),x.PhotoLinks?.length?'<button class="btn small secondary history-photo" data-index="'+idx+'">ดูรูป</button>':'—'
      ])):'<div class="empty">ไม่พบข้อมูลในช่วงนี้</div>')+
    '</section>';
  S.charts.forEach(c=>c.destroy());S.charts=[];
  if(window.Chart&&$("history-chart")){
    const tr=d.trend||[];
    S.charts.push(new Chart($("history-chart"),{type:"line",data:{labels:tr.map(x=>coverageDateText(x.date)),datasets:[{label:"คะแนน",data:tr.map(x=>x.status==="ตรวจแล้ว"?x.score:null),borderColor:"#0f766e",backgroundColor:"rgba(15,118,110,.12)",fill:true,tension:.3,spanGaps:true}]},options:{maintainAspectRatio:false,scales:{y:{min:0,max:3,ticks:{stepSize:1}},x:{ticks:{maxTicksLimit:8}}},plugins:{legend:{display:false}}}}));
  }
  document.querySelectorAll(".history-photo").forEach(b=>b.onclick=()=>coveragePhoto(d.rows[Number(b.dataset.index)]));
  $("history-export").onclick=()=>{
    try{sessionStorage.setItem("rsd-export-prefill",JSON.stringify({start:d.start,end:d.end,type:d.type,id:d.id}));}catch(e){}
    location.hash="exports";route();
  };
  icons();
}
function coverageBar(label,n,total,cls){
  const pct=total?Math.round(Number(n||0)*100/total):0;
  return '<div class="coverage-bar '+cls+'"><div><span>'+label+'</span><b>'+n+' · '+pct+'%</b></div><div class="coverage-bar-track"><i style="width:'+pct+'%"></i></div></div>';
}

/* =========================
   7) EXPORT EXCEL / PDF
   ========================= */
let coverageExportData=null;
async function renderExportCenter(seq){
  const opts=await rpc("historyOptions",{},true);if(seq!==S.seq)return;
  const teacher=S.user?.Role==="Teacher";
  const classOptions=opts.classes.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join("");
  const areaOptions=opts.areas.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join("");
  $("app").innerHTML=
    heading("ส่งออกรายงาน 📤","สร้างไฟล์ Excel และ PDF สำหรับรายงาน/หลักฐาน")+
    '<form id="export-filter" class="card coverage-export-filter">'+
      '<div class="field"><label>เริ่ม</label><input id="export-start" type="date" value="'+coverageShiftDay(thaiDay(),-29)+'"></div>'+
      '<div class="field"><label>ถึง</label><input id="export-end" type="date" value="'+thaiDay()+'" max="'+thaiDay()+'"></div>'+
      '<div class="field"><label>ห้องเรียน</label><select id="export-class"><option value="">ทุกห้อง</option>'+classOptions+'</select></div>'+
      '<div class="field"><label>พื้นที่</label><select id="export-area"><option value="">ทุกพื้นที่</option>'+areaOptions+'</select></div>'+
      '<button class="btn" type="submit"><i data-lucide="search"></i> เตรียมข้อมูล</button>'+
    '</form>'+
    '<div id="export-content" class="mt-4"><div class="card empty">เลือกช่วงวันที่แล้วกด “เตรียมข้อมูล”</div></div>';
  if(teacher&&opts.classes[0]){$("export-class").value=opts.classes[0].id;$("export-class").disabled=true;}
  try{
    const pref=JSON.parse(sessionStorage.getItem("rsd-export-prefill")||"null");
    if(pref){
      if(pref.start)$("export-start").value=pref.start;
      if(pref.end)$("export-end").value=pref.end;
      if(pref.type==="class"&&[...$("export-class").options].some(o=>o.value===pref.id))$("export-class").value=pref.id;
      if(pref.type==="area"&&[...$("export-area").options].some(o=>o.value===pref.id))$("export-area").value=pref.id;
    }
    sessionStorage.removeItem("rsd-export-prefill");
  }catch(e){}
  $("export-filter").onsubmit=e=>{e.preventDefault();loadExportPreview().catch(error);};icons();
  await loadExportPreview(seq);
}
async function loadExportPreview(seq=S.seq){
  const payload={start:$("export-start").value,end:$("export-end").value,classId:$("export-class").value,areaId:$("export-area").value};
  const d=await rpc("exportData",payload,true);if(seq!==S.seq)return;coverageExportData=d;
  $("export-content").innerHTML=
    '<section class="card"><div class="coverage-section-head"><div><h2>พร้อมส่งออก '+d.rows.length+' รายการ</h2><p class="muted">'+coverageDateText(d.start)+' – '+coverageDateText(d.end)+'</p></div><div class="flex flex-wrap gap-2"><button class="btn" id="export-xlsx"><i data-lucide="sheet"></i> Excel (.xlsx)</button><button class="btn secondary" id="export-pdf"><i data-lucide="file-text"></i> PDF</button></div></div>'+
      (d.rows.length?table(["วันที่","ห้องเรียน","พื้นที่","สถานะ","ระดับ","คะแนน","หมายเหตุ"],d.rows.slice(0,100).map(x=>[esc(x["วันที่"]),esc(x["ห้องเรียน"]),esc(x["พื้นที่"]),esc(x["สถานะ"]),esc(x["ระดับ"]),String(x["คะแนน"]),esc(x["หมายเหตุ"]||"—")])):'<div class="empty">ไม่พบข้อมูล</div>')+
      (d.rows.length>100?'<p class="muted mt-3">ตัวอย่างแสดง 100 รายการแรก · ไฟล์ส่งออกมีครบ '+d.rows.length+' รายการ</p>':'')+
    '</section>';
  $("export-xlsx").onclick=downloadCoverageXlsx;$("export-pdf").onclick=downloadCoveragePdf;icons();
}
function loadCoverageScript(src,test){
  if(test())return Promise.resolve();
  return new Promise((resolve,reject)=>{const sc=document.createElement("script");sc.src=src;sc.async=true;sc.onload=resolve;sc.onerror=()=>reject(Error("โหลดไลบรารีส่งออกไม่สำเร็จ"));document.head.appendChild(sc);});
}
async function downloadCoverageXlsx(){
  if(!coverageExportData)return;busy(true,"กำลังสร้าง Excel…");
  try{
    await loadCoverageScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",()=>!!window.XLSX);
    const wb=XLSX.utils.book_new(),ws=XLSX.utils.json_to_sheet(coverageExportData.rows);
    ws["!cols"]=[{wch:13},{wch:18},{wch:26},{wch:12},{wch:12},{wch:8},{wch:32},{wch:22},{wch:18},{wch:20}];
    XLSX.utils.book_append_sheet(wb,ws,"ผลตรวจ");
    XLSX.writeFile(wb,"RSD-Clean-"+coverageExportData.start+"_"+coverageExportData.end+".xlsx");
    toast("สร้างไฟล์ Excel แล้ว");
  }catch(e){error(e);}finally{busy(false);}
}
function coverageExportHtml(d){
  const cfg=d.settings||{},rows=d.rows||[];
  return '<div class="coverage-pdf-report" id="coverage-pdf-report">'+
    '<div class="coverage-pdf-head"><img src="'+esc(cfg.schoolLogoUrl||"/school-logo")+'" onerror="this.onerror=null;this.src=\'/school-logo\'"><div><h1>รายงานผลการตรวจเขตพื้นที่</h1><h2>'+esc(cfg.schoolName||"โรงเรียนรัษฎา")+'</h2><p>'+coverageDateText(d.start)+' – '+coverageDateText(d.end)+'</p></div></div>'+
    '<table><thead><tr><th>วันที่</th><th>ห้องเรียน</th><th>พื้นที่</th><th>สถานะ</th><th>ระดับ</th><th>คะแนน</th><th>หมายเหตุ/เหตุผลงดตรวจ</th><th>รับรอง</th></tr></thead><tbody>'+
    rows.map(x=>'<tr><td>'+esc(x["วันที่"])+'</td><td>'+esc(x["ห้องเรียน"])+'</td><td>'+esc(x["พื้นที่"])+'</td><td>'+esc(x["สถานะ"])+'</td><td>'+esc(x["ระดับ"])+'</td><td>'+esc(x["คะแนน"])+'</td><td>'+esc(x["หมายเหตุ"]||x["เหตุผลงดตรวจ"]||"")+'</td><td>'+esc(x["สถานะรับรอง"]||"")+'</td></tr>').join("")+
    '</tbody></table><footer>'+esc(cfg.reportFooter||"ข้อมูลจากระบบ RSD Clean")+'</footer></div>';
}
async function downloadCoveragePdf(){
  if(!coverageExportData)return;busy(true,"กำลังสร้าง PDF…");
  let wrap=null;
  try{
    await loadCoverageScript("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",()=>!!window.html2canvas);
    await loadCoverageScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",()=>!!window.jspdf?.jsPDF);
    wrap=document.createElement("div");wrap.className="coverage-pdf-stage";wrap.innerHTML=coverageExportHtml(coverageExportData);document.body.appendChild(wrap);
    await document.fonts?.ready?.catch?.(()=>{});
    const canvas=await html2canvas(wrap.querySelector("#coverage-pdf-report"),{scale:1.35,useCORS:true,backgroundColor:"#ffffff"});
    const {jsPDF}=window.jspdf,pdf=new jsPDF("p","mm","a4"),img=canvas.toDataURL("image/jpeg",.9),w=190,h=canvas.height*w/canvas.width,page=277;
    let offset=0,pageNo=0;
    while(offset<h){if(pageNo++)pdf.addPage();pdf.addImage(img,"JPEG",10,10-offset,w,h);offset+=page;}
    pdf.save("RSD-Clean-"+coverageExportData.start+"_"+coverageExportData.end+".pdf");
    toast("สร้างไฟล์ PDF แล้ว");
  }catch(e){error(e);}finally{wrap?.remove();busy(false);}
}


document.addEventListener("click",(e)=>{
  const el=e.target.closest("[data-history-id][data-history-type]");
  if(!el)return;
  try{sessionStorage.setItem("rsd-history-prefill",JSON.stringify({type:el.dataset.historyType,id:el.dataset.historyId}));}catch(x){}
});
