
const AREA_MAP_W=1600, AREA_MAP_H=1000;
const AREA_MAP_REFERENCE_KEY="rsd-area-map-reference-v1";
const AREA_MAP_REFERENCE_VERSION_KEY="rsd-area-map-reference-server-version-v1";
const AREA_MAP_REFERENCE_OPACITY_KEY="rsd-area-map-reference-opacity-v1";
const AREA_MAP_GRID_KEY="rsd-area-map-grid-v1";
function areaMapLocalGet(key,fallback=""){try{const v=localStorage.getItem(key);return v===null?fallback:v;}catch(e){return fallback;}}
function areaMapLocalSet(key,value){try{localStorage.setItem(key,value);return true;}catch(e){return false;}}
function areaMapReferencePrefs(){
  const raw=Number(areaMapLocalGet(AREA_MAP_REFERENCE_OPACITY_KEY,"65"));
  return{
    referenceDataUrl:areaMapLocalGet(AREA_MAP_REFERENCE_KEY,""),
    referenceVisible:true,
    referenceOpacity:Math.max(.1,Math.min(1,Number.isFinite(raw)?raw/100:.65)),
    gridVisible:areaMapLocalGet(AREA_MAP_GRID_KEY,"0")==="1"
  };
}
let areaMapState={shapes:[],selectedAreaId:"",selectedShapeId:"",mode:"select",zoom:.7,dirty:false,viewOnly:false,draftPoints:[],gesture:null,statusMode:true,statusDate:thaiDay(),daily:{items:[],summary:{},updatedAt:""},...areaMapReferencePrefs()};
let areaMapStatusTimer=0;

function areaMapUid(){try{return crypto.randomUUID();}catch(e){return "map_"+Date.now()+"_"+Math.random().toString(36).slice(2);}}
function areaMapArea(id){return S.master.Areas.find(a=>a.AreaID===id);}
function areaMapClass(area){return area?masterLabel("ResponsibleClassroomID",area.ResponsibleClassroomID):"—";}
function areaMapShape(areaId){return areaMapState.shapes.find(s=>s.AreaID===areaId);}
function areaMapMarkDirty(){areaMapState.dirty=true;const badge=$("area-map-dirty"),save=$("area-map-save");if(badge){badge.textContent="มีการแก้ไขที่ยังไม่บันทึก";badge.classList.add("show");}if(save)save.disabled=false;}


function areaMapStatusInfo(areaId){
  const item=(areaMapState.daily?.items||[]).find(x=>String(x.AreaID)===String(areaId));
  if(!item)return{key:"none",label:"ไม่มีเวร",color:"#94a3b8",item:null};
  if(item.Status==="งดตรวจ")return{key:"skipped",label:"งดตรวจ",color:"#64748b",item};
  if(item.Status==="รอตรวจ")return{key:"pending",label:"รอตรวจ",color:"#facc15",item};
  if(item.Status==="ตรวจแล้ว"){
    const score=Number(item.Score||0);
    if(score===3)return{key:"excellent",label:"ยอดเยี่ยม",color:"#22c55e",item};
    if(score===2)return{key:"medium",label:"ปานกลาง",color:"#f59e0b",item};
    if(score===1)return{key:"improve",label:"ปรับปรุง",color:"#ef4444",item};
    return{key:"done",label:item.Rating||"ตรวจแล้ว",color:"#14b8a6",item};
  }
  return{key:"other",label:item.Status||"มีงานตรวจ",color:"#38bdf8",item};
}
function areaMapStatusCounts(){
  const counts={none:0,pending:0,excellent:0,medium:0,improve:0,skipped:0,done:0,other:0};
  for(const area of S.master.Areas){
    const s=areaMapStatusInfo(area.AreaID);
    counts[s.key]=(counts[s.key]||0)+1;
  }
  return counts;
}
function areaMapStatusLegend(){
  const c=areaMapStatusCounts();
  const items=[
    ["#94a3b8","ไม่มีเวร",c.none],
    ["#facc15","รอตรวจ",c.pending],
    ["#22c55e","ยอดเยี่ยม",c.excellent],
    ["#f59e0b","ปานกลาง",c.medium],
    ["#ef4444","ปรับปรุง",c.improve],
    ["#64748b","งดตรวจ",c.skipped]
  ];
  return items.map(x=>'<span class="area-map-legend-item"><i style="background:'+x[0]+'"></i>'+x[1]+' <b>'+Number(x[2]||0)+'</b></span>').join("");
}
function areaMapStatusDateText(date){
  try{return new Date(date+"T12:00:00+07:00").toLocaleDateString("th-TH",{weekday:"short",day:"numeric",month:"short",year:"numeric",timeZone:"Asia/Bangkok"});}
  catch(e){return date;}
}
function areaMapScheduleStatusRefresh(){
  clearTimeout(areaMapStatusTimer);
  if(adminTab!=="AreaMap"||!areaMapState.statusMode||areaMapState.statusDate!==thaiDay())return;
  areaMapStatusTimer=setTimeout(()=>areaMapRefreshStatus(true),60000);
}
async function areaMapRefreshStatus(silent=false){
  const date=areaMapState.statusDate||thaiDay();
  try{
    const daily=await rpc("dailyControl",{date},true);
    if(adminTab!=="AreaMap")return;
    areaMapState.daily=daily||{items:[],summary:{},updatedAt:""};
    areaMapRenderEditor();
    if(!silent)toast("อัปเดตสถานะผังแล้ว");
  }catch(e){
    if(!silent)error(e);
  }finally{
    areaMapScheduleStatusRefresh();
  }
}
function areaMapStatusTimeText(){
  const raw=String(areaMapState.daily?.updatedAt||"");
  if(!raw)return"";
  try{return new Date(raw).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Bangkok"})+" น.";}
  catch(e){return"";}
}

async function areaMapContent(){
  clearTimeout(areaMapStatusTimer);
  $("admin-content").innerHTML='<div class="map-editor-loading"><div class="spinner"></div><b>กำลังเปิดผังพื้นที่…</b></div>';
  try{
    const date=areaMapState.statusDate||thaiDay();
    const [data,daily]=await Promise.all([
      rpc("areaMapLayout"),
      rpc("dailyControl",{date},true).catch(()=>({date,items:[],summary:{},updatedAt:""}))
    ]);
    if(adminTab!=="AreaMap")return;
    areaMapState={
      shapes:(data.shapes||[]).map(s=>({...s,Points:Array.isArray(s.Points)?s.Points:[]})),
      selectedAreaId:"",selectedShapeId:"",mode:"select",zoom:.7,dirty:false,viewOnly:false,draftPoints:[],gesture:null,
      statusMode:areaMapState.statusMode!==false,statusDate:date,daily:daily||{items:[],summary:{},updatedAt:""},
      ...areaMapReferencePrefs()
    };
    areaMapRenderEditor();
    areaMapScheduleStatusRefresh();
  }catch(e){
    error(e);
    $("admin-content").innerHTML='<div class="empty">เปิดผังพื้นที่ไม่สำเร็จ</div>';
  }
}
function areaMapRenderEditor(){
  const areas=[...S.master.Areas].sort(assignmentAreaSort),
    mapped=new Set(areaMapState.shapes.map(s=>s.AreaID)),
    options=areas.map(a=>
      '<option value="'+esc(a.AreaID)+'" '+(a.AreaID===areaMapState.selectedAreaId?"selected":"")+'>'+
      (mapped.has(a.AreaID)?"✓ ":"○ ")+esc(a.AreaName)+" · "+esc(areaMapClass(a))+
      '</option>'
    ).join(""),
    hasReference=!!areaMapState.referenceDataUrl;

  $("admin-content").innerHTML=
    '<div class="area-map-shell">'+
      '<div class="area-map-head"><div><h2 class="text-lg">ผังเขตพื้นที่โรงเรียน</h2><p class="muted mt-1">วาดผังแบบ Vector และเชื่อมกับพื้นที่ตรวจจริงในระบบ</p></div>'+
      '<div class="area-map-head-actions"><span id="area-map-dirty" class="area-map-dirty '+(areaMapState.dirty?"show":"")+'">'+(areaMapState.dirty?"มีการแก้ไขที่ยังไม่บันทึก":"")+'</span><button class="btn secondary" id="area-map-reload">↺ ย้อนการแก้ไข</button><button class="btn" id="area-map-save" '+(areaMapState.dirty?"":"disabled")+'>บันทึกผัง</button></div></div>'+
      '<div class="area-map-stats"><span>พื้นที่ทั้งหมด <b>'+areas.length+'</b></span><span>วางบนผังแล้ว <b>'+mapped.size+'</b></span><span>ยังไม่วาง <b>'+(areas.length-mapped.size)+'</b></span></div>'+      '<div class="area-map-livebar '+(areaMapState.statusMode?"active":"")+'"><div class="area-map-live-title"><div><b>สถานะการตรวจบนผัง</b><small>'+esc(areaMapStatusDateText(areaMapState.statusDate))+(areaMapStatusTimeText()?' · อัปเดต '+esc(areaMapStatusTimeText()):'')+'</small></div><label class="area-map-live-switch"><input id="area-map-status-mode" type="checkbox" '+(areaMapState.statusMode?"checked":"")+'> แสดงสีสถานะ</label></div><div class="area-map-live-controls"><input id="area-map-status-date" type="date" value="'+esc(areaMapState.statusDate)+'" max="'+thaiDay()+'"><button class="btn small secondary" id="area-map-status-refresh">↻ รีเฟรชสถานะ</button><button class="btn small secondary area-map-export-btn" id="area-map-export-169">📸 PNG 16:9</button><button class="btn small secondary area-map-export-btn" id="area-map-export-a4">🖼 PNG A4</button><label class="area-map-export-reference"><input id="area-map-export-reference" type="checkbox"> รวมภาพอ้างอิง</label><div class="area-map-legend">'+areaMapStatusLegend()+'</div></div></div>'+
      '<div class="area-map-toolbar">'+
        '<div class="area-map-area-picker"><label>พื้นที่ที่จะวาด</label><select id="area-map-area"><option value="">— เลือกพื้นที่ —</option>'+options+'</select></div>'+
        '<div class="area-map-tools"><button class="btn small secondary map-tool" data-mode="select">↖ เลือก/ย้าย</button><button class="btn small secondary map-tool" data-mode="rect">▭ สี่เหลี่ยม</button><button class="btn small secondary map-tool" data-mode="polygon">⬠ หลายเหลี่ยม</button><button class="btn small secondary" id="area-map-finish-poly">จบรูป</button><button class="btn small secondary" id="area-map-cancel-poly">ยกเลิกจุด</button></div>'+
        '<div class="area-map-reference-tools">'+
          '<input id="area-map-reference-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>'+
          '<button class="btn small secondary" id="area-map-reference-pick">🖼 '+(hasReference?"เปลี่ยนภาพอ้างอิง":"เลือกภาพอ้างอิง")+'</button>'+
          '<label class="area-map-reference-check"><input id="area-map-reference-visible" type="checkbox" '+(hasReference&&areaMapState.referenceVisible?"checked":"")+' '+(!hasReference?"disabled":"")+'> แสดงภาพ</label>'+
          '<label class="area-map-reference-opacity"><span>ความชัด</span><input id="area-map-reference-opacity" type="range" min="10" max="100" step="5" value="'+Math.round(areaMapState.referenceOpacity*100)+'" '+(!hasReference?"disabled":"")+'><b id="area-map-reference-opacity-label">'+Math.round(areaMapState.referenceOpacity*100)+'%</b></label>'+
          '<label class="area-map-reference-check"><input id="area-map-grid-visible" type="checkbox" '+(areaMapState.gridVisible?"checked":"")+'> เส้นกริด</label>'+
          (hasReference?'<button class="btn small secondary danger-soft" id="area-map-reference-clear">ลบภาพอ้างอิง</button>':"")+
        '</div>'+
        '<div class="area-map-zoom"><button class="btn small secondary" id="area-map-zoom-out">−</button><span id="area-map-zoom-label">'+Math.round(areaMapState.zoom*100)+'%</span><button class="btn small secondary" id="area-map-zoom-in">＋</button><button class="btn small secondary" id="area-map-view-toggle">'+(areaMapState.viewOnly?"✎ กลับโหมดแก้ไข":"👁 โหมดดู")+'</button></div>'+
      '</div>'+
      '<div class="area-map-workspace"><div class="area-map-canvas-card"><div class="area-map-hint" id="area-map-hint"></div>'+
      (hasReference?'<div class="area-map-reference-note">ภาพอ้างอิงกลางของระบบ · ทุกเครื่องใช้ภาพเดียวกัน และเบราว์เซอร์จะ cache ไว้เพื่อความเร็ว</div>':"")+
      '<div class="area-map-scroll"><svg id="area-map-svg" viewBox="0 0 '+AREA_MAP_W+' '+AREA_MAP_H+'"></svg></div></div><aside class="area-map-side" id="area-map-side"></aside></div>'+
    '</div>';

  areaMapBindEditor();
  areaMapRenderSvg();
  areaMapRenderSide();
  areaMapUpdateToolbar();
}
function areaMapBindEditor(){
  $("area-map-status-mode").onchange=e=>{
    areaMapState.statusMode=!!e.target.checked;
    areaMapRenderSvg();
    areaMapRenderSide();
    areaMapScheduleStatusRefresh();
  };
  $("area-map-status-date").onchange=e=>{
    areaMapState.statusDate=String(e.target.value||thaiDay());
    areaMapRefreshStatus(false);
  };
  $("area-map-status-refresh").onclick=()=>areaMapRefreshStatus(false);
  $("area-map-export-169").onclick=()=>areaMapExportImage("169");
  $("area-map-export-a4").onclick=()=>areaMapExportImage("a4");

  $("area-map-area").onchange=e=>{
    areaMapState.selectedAreaId=String(e.target.value||"");
    const s=areaMapShape(areaMapState.selectedAreaId);
    areaMapState.selectedShapeId=s?s.ShapeID:"";
    areaMapRenderSvg();
    areaMapRenderSide();
  };

  document.querySelectorAll(".map-tool").forEach(b=>b.onclick=()=>{
    if(areaMapState.viewOnly)return;
    areaMapState.mode=b.dataset.mode;
    if(areaMapState.mode!=="polygon")areaMapState.draftPoints=[];
    areaMapRenderSvg();
    areaMapUpdateToolbar();
  });

  $("area-map-finish-poly").onclick=areaMapFinishPolygon;
  $("area-map-cancel-poly").onclick=()=>{areaMapState.draftPoints=[];areaMapRenderSvg();areaMapUpdateToolbar();};

  $("area-map-reference-pick").onclick=()=>$("area-map-reference-file").click();
  $("area-map-reference-file").onchange=e=>areaMapReferenceFileSelected(e.target.files?.[0]);
  $("area-map-reference-visible").onchange=e=>{
    areaMapState.referenceVisible=!!e.target.checked;
    areaMapRenderSvg();
  };
  $("area-map-reference-opacity").oninput=e=>{
    areaMapState.referenceOpacity=Math.max(.1,Math.min(1,Number(e.target.value||65)/100));
    areaMapLocalSet(AREA_MAP_REFERENCE_OPACITY_KEY,String(Math.round(areaMapState.referenceOpacity*100)));
    const img=$("area-map-reference-image"),label=$("area-map-reference-opacity-label");
    if(img)img.setAttribute("opacity",String(areaMapState.referenceOpacity));
    if(label)label.textContent=Math.round(areaMapState.referenceOpacity*100)+"%";
  };
  $("area-map-grid-visible").onchange=e=>{
    areaMapState.gridVisible=!!e.target.checked;
    areaMapLocalSet(AREA_MAP_GRID_KEY,areaMapState.gridVisible?"1":"0");
    areaMapRenderSvg();
  };
  if($("area-map-reference-clear"))$("area-map-reference-clear").onclick=areaMapClearReference;

  $("area-map-zoom-out").onclick=()=>areaMapSetZoom(areaMapState.zoom-.1);
  $("area-map-zoom-in").onclick=()=>areaMapSetZoom(areaMapState.zoom+.1);
  $("area-map-view-toggle").onclick=()=>{
    areaMapState.viewOnly=!areaMapState.viewOnly;
    areaMapState.mode="select";
    areaMapState.draftPoints=[];
    areaMapRenderEditor();
  };
  $("area-map-save").onclick=areaMapSave;
  $("area-map-reload").onclick=async()=>{
    if(areaMapState.dirty){
      const ok=await Swal.fire({icon:"question",title:"ย้อนการแก้ไขทั้งหมด?",text:"การแก้ไขที่ยังไม่ได้บันทึกจะหายไป",showCancelButton:true,confirmButtonText:"โหลดผังเดิม",cancelButtonText:"ยกเลิก"});
      if(!ok.isConfirmed)return;
    }
    areaMapContent();
  };
}

async function areaMapReferenceFileSelected(file){
  if(!file)return;
  if(!/^image\/(png|jpeg|webp)$/.test(String(file.type||"")))return error(new Error("รองรับไฟล์ PNG, JPG และ WebP"));
  if(Number(file.size||0)>12*1024*1024)return error(new Error("ภาพอ้างอิงต้องไม่เกิน 12 MB"));
  busy(true,"กำลังบันทึกภาพอ้างอิงกลาง…");
  try{
    const dataUrl=await areaMapCompressReference(file);
    if(typeof window.rsdUploadMapReferenceData!=="function")throw Error("ตัวอัปโหลดภาพยังไม่พร้อม กรุณารีเฟรชหน้าเว็บ");
    const saved=await window.rsdUploadMapReferenceData(dataUrl,true);
    areaMapState.referenceDataUrl=dataUrl;
    areaMapState.referenceVisible=true;
    areaMapLocalSet(AREA_MAP_REFERENCE_KEY,dataUrl);
    areaMapLocalSet(AREA_MAP_REFERENCE_VERSION_KEY,String(saved.ReferenceVersion||""));
    toast("บันทึกภาพอ้างอิงกลางแล้ว · ทุกเครื่องจะใช้ภาพนี้");
    areaMapRenderEditor();
  }catch(e){error(e);}
  finally{busy(false);}
}
function areaMapLoadImage(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file),img=new Image();
    img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("อ่านไฟล์ภาพไม่สำเร็จ"));};
    img.src=url;
  });
}
async function areaMapCompressReference(file){
  const img=await areaMapLoadImage(file),canvas=document.createElement("canvas");
  canvas.width=AREA_MAP_W;
  canvas.height=AREA_MAP_H;
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="#ffffff";
  ctx.fillRect(0,0,AREA_MAP_W,AREA_MAP_H);
  const scale=Math.min(AREA_MAP_W/img.naturalWidth,AREA_MAP_H/img.naturalHeight),
    w=img.naturalWidth*scale,h=img.naturalHeight*scale,
    x=(AREA_MAP_W-w)/2,y=(AREA_MAP_H-h)/2;
  ctx.drawImage(img,x,y,w,h);
  return canvas.toDataURL("image/jpeg",.72);
}
async function areaMapClearReference(){
  const ok=await Swal.fire({icon:"question",title:"ลบภาพอ้างอิงกลาง?",text:"ภาพจะหายจากทุกเครื่อง แต่กรอบพื้นที่ที่วาดไว้จะไม่ถูกลบ",showCancelButton:true,confirmButtonText:"ลบภาพอ้างอิง",cancelButtonText:"ยกเลิก"});
  if(!ok.isConfirmed)return;
  busy(true,"กำลังลบภาพอ้างอิง…");
  try{
    const result=await rpc("clearAreaMapReference",{});
    try{localStorage.removeItem(AREA_MAP_REFERENCE_KEY);}catch(e){}
    areaMapLocalSet(AREA_MAP_REFERENCE_VERSION_KEY,String(result.ReferenceVersion||""));
    areaMapState.referenceDataUrl="";
    areaMapState.referenceVisible=false;
    areaMapRenderEditor();
    toast("ลบภาพอ้างอิงกลางแล้ว");
  }catch(e){error(e);}
  finally{busy(false);}
}
function areaMapUpdateToolbar(){
  document.querySelectorAll(".map-tool").forEach(b=>b.classList.toggle("active",!areaMapState.viewOnly&&b.dataset.mode===areaMapState.mode));
  const finish=$("area-map-finish-poly"),cancel=$("area-map-cancel-poly"),hint=$("area-map-hint");
  if(finish)finish.disabled=areaMapState.viewOnly||areaMapState.mode!=="polygon"||areaMapState.draftPoints.length<3;
  if(cancel)cancel.disabled=areaMapState.viewOnly||areaMapState.mode!=="polygon"||!areaMapState.draftPoints.length;
  if(hint)hint.textContent=areaMapState.viewOnly?"โหมดดู · คลิกพื้นที่เพื่อดูข้อมูล":areaMapState.mode==="select"?"ลากพื้นที่เพื่อย้าย · สี่เหลี่ยมที่เลือกใช้จุดมุมเพื่อปรับขนาด":areaMapState.mode==="rect"?"เลือกพื้นที่ แล้วลากบนผังเพื่อวาดสี่เหลี่ยม":"เลือกพื้นที่ คลิกบนผังอย่างน้อย 3 จุด แล้วกด “จบรูป”";
}
function areaMapSetZoom(z){areaMapState.zoom=Math.max(.35,Math.min(1.5,Math.round(z*10)/10));const svg=$("area-map-svg"),label=$("area-map-zoom-label");if(svg){svg.style.width=(AREA_MAP_W*areaMapState.zoom)+"px";svg.style.height=(AREA_MAP_H*areaMapState.zoom)+"px";}if(label)label.textContent=Math.round(areaMapState.zoom*100)+"%";}
function areaMapPoint(e){const svg=$("area-map-svg"),pt=svg.createSVGPoint(),m=svg.getScreenCTM();pt.x=e.clientX;pt.y=e.clientY;if(!m)return{x:0,y:0};const p=pt.matrixTransform(m.inverse());return{x:Math.max(0,Math.min(AREA_MAP_W,p.x)),y:Math.max(0,Math.min(AREA_MAP_H,p.y))};}
function areaMapCenter(s){if(s.ShapeType==="polygon"&&s.Points.length){const sum=s.Points.reduce((a,p)=>({x:a.x+Number(p.x),y:a.y+Number(p.y)}),{x:0,y:0});return{x:sum.x/s.Points.length,y:sum.y/s.Points.length};}return{x:Number(s.X)+Number(s.Width)/2,y:Number(s.Y)+Number(s.Height)/2};}
function areaMapRenderSvg(){
  const svg=$("area-map-svg");
  if(!svg)return;

  const body=[...areaMapState.shapes]
    .sort((a,b)=>Number(a.SortOrder||0)-Number(b.SortOrder||0))
    .map(s=>{
      const area=areaMapArea(s.AreaID),center=areaMapCenter(s),
        selected=s.ShapeID===areaMapState.selectedShapeId,
        savedColor=/^#[0-9a-f]{6}$/i.test(s.FillColor||"")?s.FillColor:"#38bdf8",
        statusInfo=areaMapStatusInfo(s.AreaID),
        color=areaMapState.statusMode?statusInfo.color:savedColor,
        geo=s.ShapeType==="polygon"
          ? '<polygon class="map-shape-geometry" points="'+s.Points.map(p=>p.x+","+p.y).join(" ")+'" fill="'+color+'"/>'
          : '<rect class="map-shape-geometry" x="'+s.X+'" y="'+s.Y+'" width="'+s.Width+'" height="'+s.Height+'" rx="10" fill="'+color+'"/>',
        handle=selected&&!areaMapState.viewOnly&&!s.Locked&&s.ShapeType==="rect"
          ? '<rect class="map-resize-handle" data-resize="1" x="'+(Number(s.X)+Number(s.Width)-9)+'" y="'+(Number(s.Y)+Number(s.Height)-9)+'" width="18" height="18" rx="4"/>'
          : "";
      return '<g class="map-shape-group '+(selected?"selected ":"")+(s.Locked?"locked ":"")+(areaMapState.statusMode?"status-"+statusInfo.key:"")+'" data-shape="'+esc(s.ShapeID)+'">'+
        geo+
        '<text class="map-shape-label" x="'+center.x+'" y="'+(center.y-4)+'" text-anchor="middle"><tspan x="'+center.x+'">'+esc(area?.AreaName||"พื้นที่")+'</tspan><tspan class="map-shape-sub" x="'+center.x+'" dy="18">'+esc(areaMapClass(area))+'</tspan></text>'+
        handle+
      '</g>';
    }).join("");

  const draft=areaMapState.draftPoints.length
    ? '<polyline class="map-draft-poly" points="'+areaMapState.draftPoints.map(p=>p.x+","+p.y).join(" ")+'"/>'+
      areaMapState.draftPoints.map(p=>'<circle class="map-draft-point" cx="'+p.x+'" cy="'+p.y+'" r="7"/>').join("")
    : "";

  const showReference=!!areaMapState.referenceDataUrl&&areaMapState.referenceVisible,
    reference=showReference
      ? '<image id="area-map-reference-image" href="'+areaMapState.referenceDataUrl+'" x="0" y="0" width="1600" height="1000" preserveAspectRatio="none" opacity="'+areaMapState.referenceOpacity+'" pointer-events="none"/>'
      : "",
    grid=areaMapState.gridVisible
      ? '<rect id="map-grid-layer" width="1600" height="1000" fill="url(#map-grid)" opacity=".55" pointer-events="none"/>'
      : "",
    title=showReference
      ? ""
      : '<text x="800" y="52" text-anchor="middle" class="map-canvas-title">แผนผังแสดงเขตพื้นที่รับผิดชอบของนักเรียน</text><text x="800" y="82" text-anchor="middle" class="map-canvas-subtitle">โรงเรียนรัษฎา · RSD Clean Interactive Map</text>';

  svg.innerHTML=
    '<defs><pattern id="map-grid-small" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#dbe8eb" stroke-width="1"/></pattern><pattern id="map-grid" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#map-grid-small)"/><path d="M100 0H0V100" fill="none" stroke="#b9cfd5" stroke-width="1.6"/></pattern></defs>'+
    '<rect id="map-bg" width="1600" height="1000" fill="#ffffff"/>'+
    reference+grid+title+body+draft;

  areaMapSetZoom(areaMapState.zoom);
  areaMapBindSvg();
}
function areaMapBindSvg(){
  const svg=$("area-map-svg");if(!svg)return;
  svg.onpointerdown=e=>{if(e.target.closest&&e.target.closest(".map-shape-group"))return;if(areaMapState.viewOnly)return;if(areaMapState.mode==="rect"){if(!areaMapState.selectedAreaId)return toast("เลือกพื้นที่ที่จะวาดก่อน");const existing=areaMapShape(areaMapState.selectedAreaId);if(existing&&existing.Locked)return toast("ปลดล็อกพื้นที่นี้ก่อนวาดใหม่");const p=areaMapPoint(e);areaMapState.gesture={type:"draw",start:p,current:p};svg.setPointerCapture(e.pointerId);areaMapDraftRect();}else if(areaMapState.mode==="polygon"){if(!areaMapState.selectedAreaId)return toast("เลือกพื้นที่ที่จะวาดก่อน");const existing=areaMapShape(areaMapState.selectedAreaId);if(existing&&existing.Locked)return toast("ปลดล็อกพื้นที่นี้ก่อนวาดใหม่");const p=areaMapPoint(e);areaMapState.draftPoints.push({x:Math.round(p.x),y:Math.round(p.y)});areaMapRenderSvg();areaMapUpdateToolbar();}else{areaMapState.selectedShapeId="";areaMapRenderSvg();areaMapRenderSide();}};
  svg.onpointermove=e=>{const g=areaMapState.gesture;if(!g)return;const p=areaMapPoint(e);if(g.type==="draw"){g.current=p;areaMapDraftRect();return;}const s=areaMapState.shapes.find(x=>x.ShapeID===g.shapeId);if(!s)return;if(g.type==="move"){const dx=p.x-g.last.x,dy=p.y-g.last.y;g.last=p;if(s.ShapeType==="polygon"){const xs=s.Points.map(v=>v.x),ys=s.Points.map(v=>v.y),mx=Math.max(-Math.min(...xs),Math.min(AREA_MAP_W-Math.max(...xs),dx)),my=Math.max(-Math.min(...ys),Math.min(AREA_MAP_H-Math.max(...ys),dy));s.Points=s.Points.map(v=>({x:v.x+mx,y:v.y+my}));areaMapRecalcPolygon(s);}else{s.X=Math.max(0,Math.min(AREA_MAP_W-s.Width,s.X+dx));s.Y=Math.max(0,Math.min(AREA_MAP_H-s.Height,s.Y+dy));}}else{s.Width=Math.max(30,Math.min(AREA_MAP_W-s.X,p.x-s.X));s.Height=Math.max(30,Math.min(AREA_MAP_H-s.Y,p.y-s.Y));}areaMapUpdateDom(s);};
  svg.onpointerup=()=>{const g=areaMapState.gesture;if(!g)return;areaMapState.gesture=null;if(g.type==="draw"){document.getElementById("map-draft-rect")?.remove();const x=Math.min(g.start.x,g.current.x),y=Math.min(g.start.y,g.current.y),w=Math.abs(g.current.x-g.start.x),h=Math.abs(g.current.y-g.start.y);if(w>=20&&h>=20)areaMapUpsert({ShapeType:"rect",X:Math.round(x),Y:Math.round(y),Width:Math.round(w),Height:Math.round(h),Points:[]});}else{areaMapMarkDirty();areaMapRenderSvg();areaMapRenderSide();}};
  document.querySelectorAll(".map-shape-group").forEach(el=>{el.onpointerdown=e=>{e.stopPropagation();const s=areaMapState.shapes.find(x=>x.ShapeID===el.dataset.shape);if(!s)return;areaMapState.selectedShapeId=s.ShapeID;areaMapState.selectedAreaId=s.AreaID;$("area-map-area").value=s.AreaID;areaMapRenderSide();if(areaMapState.viewOnly||s.Locked||areaMapState.mode!=="select"){areaMapRenderSvg();return;}areaMapState.gesture={type:e.target.dataset.resize?"resize":"move",shapeId:s.ShapeID,last:areaMapPoint(e)};svg.setPointerCapture(e.pointerId);};el.onclick=e=>e.stopPropagation();});
}
function areaMapDraftRect(){const svg=$("area-map-svg"),g=areaMapState.gesture;if(!g||g.type!=="draw")return;let r=document.getElementById("map-draft-rect");if(!r){r=document.createElementNS("http://www.w3.org/2000/svg","rect");r.id="map-draft-rect";r.setAttribute("class","map-draft-rect");svg.appendChild(r);}r.setAttribute("x",Math.min(g.start.x,g.current.x));r.setAttribute("y",Math.min(g.start.y,g.current.y));r.setAttribute("width",Math.abs(g.current.x-g.start.x));r.setAttribute("height",Math.abs(g.current.y-g.start.y));}
function areaMapUpdateDom(s){const el=[...document.querySelectorAll(".map-shape-group")].find(x=>x.dataset.shape===s.ShapeID);if(!el)return;const geo=el.querySelector(".map-shape-geometry"),center=areaMapCenter(s),label=el.querySelector(".map-shape-label");if(s.ShapeType==="polygon")geo.setAttribute("points",s.Points.map(p=>p.x+","+p.y).join(" "));else{geo.setAttribute("x",s.X);geo.setAttribute("y",s.Y);geo.setAttribute("width",s.Width);geo.setAttribute("height",s.Height);}label.setAttribute("x",center.x);label.setAttribute("y",center.y-4);label.querySelectorAll("tspan").forEach(t=>t.setAttribute("x",center.x));const h=el.querySelector(".map-resize-handle");if(h){h.setAttribute("x",s.X+s.Width-9);h.setAttribute("y",s.Y+s.Height-9);}}
function areaMapRecalcPolygon(s){const xs=s.Points.map(p=>p.x),ys=s.Points.map(p=>p.y);s.X=Math.min(...xs);s.Y=Math.min(...ys);s.Width=Math.max(...xs)-s.X;s.Height=Math.max(...ys)-s.Y;}
function areaMapUpsert(part){const id=areaMapState.selectedAreaId;if(!id)return;let s=areaMapShape(id);if(!s){s={ShapeID:areaMapUid(),AreaID:id,ShapeType:"rect",X:100,Y:120,Width:180,Height:110,Points:[],FillColor:"#38bdf8",Locked:false,SortOrder:areaMapState.shapes.length};areaMapState.shapes.push(s);}Object.assign(s,part);if(s.ShapeType==="polygon")areaMapRecalcPolygon(s);areaMapState.selectedShapeId=s.ShapeID;areaMapState.draftPoints=[];areaMapState.dirty=true;areaMapRenderEditor();}
function areaMapFinishPolygon(){if(areaMapState.draftPoints.length<3)return;areaMapUpsert({ShapeType:"polygon",Points:areaMapState.draftPoints.map(p=>({x:p.x,y:p.y}))});}
function areaMapRenderSide(){
  const side=$("area-map-side");if(!side)return;
  const s=areaMapState.shapes.find(x=>x.ShapeID===areaMapState.selectedShapeId);
  if(!s){
    const unplaced=[...S.master.Areas].sort(assignmentAreaSort).filter(a=>!areaMapShape(a.AreaID));
    const daySummary=areaMapState.daily?.summary||{};
    side.innerHTML=
      '<div class="area-map-side-title"><b>ภาพรวมผัง</b><small>'+esc(areaMapStatusDateText(areaMapState.statusDate))+'</small></div>'+
      (areaMapState.statusMode
        ? '<div class="area-map-daily-summary"><div><span>งานตรวจ</span><b>'+Number(daySummary.total||0)+'</b></div><div><span>ตรวจแล้ว</span><b>'+Number(daySummary.done||0)+'</b></div><div><span>รอตรวจ</span><b>'+Number(daySummary.pending||0)+'</b></div><div><span>งดตรวจ</span><b>'+Number(daySummary.skipped||0)+'</b></div></div>'
        : '')+
      '<div class="area-map-empty-panel"><span>ยังไม่วางบนผัง</span><b>'+unplaced.length+' พื้นที่</b></div>'+
      '<div class="area-map-unplaced">'+unplaced.slice(0,14).map(a=>'<button type="button" data-area="'+esc(a.AreaID)+'">'+esc(a.AreaName)+'</button>').join("")+(unplaced.length>14?'<small>และอีก '+(unplaced.length-14)+' พื้นที่</small>':"")+'</div>';
    side.querySelectorAll("[data-area]").forEach(b=>b.onclick=()=>{areaMapState.selectedAreaId=b.dataset.area;$("area-map-area").value=b.dataset.area;});
    return;
  }

  const area=areaMapArea(s.AreaID),status=areaMapStatusInfo(s.AreaID),item=status.item,
    inspectors=item?.Inspectors?.map(x=>x.Name).filter(Boolean)||[],
    completed=item?.CompletedAt?(()=>{try{return new Date(item.CompletedAt).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Bangkok"})+" น.";}catch(e){return item.CompletedAt;}})():"",
    approval=item?.ApprovalStatus||"",
    liveHtml=areaMapState.statusMode
      ? '<div class="area-map-live-detail"><div class="area-map-live-detail-head"><span class="area-map-status-dot" style="background:'+status.color+'"></span><div><b>'+esc(status.label)+'</b><small>'+esc(areaMapStatusDateText(areaMapState.statusDate))+'</small></div></div>'+
        (item?.InspectionID
          ? '<div class="area-map-detail-list">'+
              '<div><span>ผู้ตรวจ</span><b>'+esc(inspectors.join(", ")||"—")+'</b></div>'+
              '<div><span>คะแนน</span><b>'+(item.Status==="ตรวจแล้ว"?esc(String(item.Score||"—"))+" · "+esc(item.Rating||status.label):"—")+'</b></div>'+
              (approval?'<div><span>การรับรอง</span><b>'+esc(approval)+'</b></div>':"")+
              (completed?'<div><span>เสร็จเมื่อ</span><b>'+esc(completed)+'</b></div>':"")+
              (item.Notes?'<div><span>หมายเหตุ</span><b>'+esc(item.Notes)+'</b></div>':"")+
              (item.HasSubstitute?'<div><span>เวรทดแทน</span><b>มี</b></div>':"")+
            '</div>'
          : '<div class="area-map-no-duty">พื้นที่นี้ไม่มีงานตรวจในวันที่เลือก</div>')+
        '<a class="btn small secondary w-full mt-3" href="#control">เปิดศูนย์ควบคุมงาน</a></div>'
      : '';

  side.innerHTML=
    '<div class="area-map-side-title"><b>'+esc(area?.AreaName||"พื้นที่")+'</b><small>'+esc(areaMapClass(area))+'</small></div>'+
    liveHtml+
    '<div class="area-map-props"><div><span>ชนิด</span><b>'+(s.ShapeType==="polygon"?"หลายเหลี่ยม":"สี่เหลี่ยม")+'</b></div><div><span>ขนาด</span><b>'+Math.round(s.Width)+' × '+Math.round(s.Height)+'</b></div></div>'+
    '<label class="field"><span>สีพื้นที่เดิม</span><input id="area-map-color" type="color" value="'+esc(s.FillColor||"#38bdf8")+'" '+(areaMapState.viewOnly?"disabled":"")+'></label>'+
    (areaMapState.statusMode?'<div class="area-map-tip">ขณะนี้ผังใช้สีสถานะการตรวจ สีพื้นที่เดิมจะเห็นเมื่อปิด “แสดงสีสถานะ”</div>':"")+
    '<label class="area-map-lock"><input id="area-map-lock" type="checkbox" '+(s.Locked?"checked":"")+' '+(areaMapState.viewOnly?"disabled":"")+'> ล็อกตำแหน่ง</label>'+
    (areaMapState.viewOnly?"":'<div class="area-map-side-actions"><button class="btn danger w-full" id="area-map-delete-shape">ลบออกจากผัง</button></div>')+
    '<div class="area-map-tip">การลบจากผังจะไม่ลบพื้นที่ตรวจ QR เวร หรือประวัติผลตรวจ</div>';

  const color=$("area-map-color");if(color)color.oninput=()=>{s.FillColor=color.value;areaMapMarkDirty();areaMapRenderSvg();};
  const lock=$("area-map-lock");if(lock)lock.onchange=()=>{s.Locked=lock.checked;areaMapMarkDirty();areaMapRenderSvg();};
  const del=$("area-map-delete-shape");if(del)del.onclick=async()=>{
    const ok=await Swal.fire({icon:"warning",title:"ลบออกจากผัง?",text:(area?.AreaName||"พื้นที่")+" จะยังคงอยู่ในระบบตรวจ",showCancelButton:true,confirmButtonText:"ลบจากผัง",cancelButtonText:"ยกเลิก"});
    if(!ok.isConfirmed)return;
    areaMapState.shapes=areaMapState.shapes.filter(x=>x.ShapeID!==s.ShapeID);
    areaMapState.selectedShapeId="";
    areaMapState.dirty=true;
    areaMapRenderEditor();
  };
}


async function areaMapEnsureKanitFont(){
  if(!document.fonts)return;
  await Promise.all([
    document.fonts.load('300 16px "Kanit"'),
    document.fonts.load('400 16px "Kanit"'),
    document.fonts.load('500 16px "Kanit"'),
    document.fonts.load('600 16px "Kanit"'),
    document.fonts.load('700 16px "Kanit"')
  ]);
  await document.fonts.ready;
}
function areaMapExportLoadImageSource(src){
  return new Promise((resolve,reject)=>{
    if(!src)return resolve(null);
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>reject(new Error("โหลดภาพอ้างอิงไม่สำเร็จ"));
    img.src=src;
  });
}
function areaMapExportShapeCenter(s){
  if(s.ShapeType==="polygon"&&Array.isArray(s.Points)&&s.Points.length){
    const sum=s.Points.reduce((a,p)=>({x:a.x+Number(p.x||0),y:a.y+Number(p.y||0)}),{x:0,y:0});
    return{x:sum.x/s.Points.length,y:sum.y/s.Points.length};
  }
  return{x:Number(s.X||0)+Number(s.Width||0)/2,y:Number(s.Y||0)+Number(s.Height||0)/2};
}
async function areaMapExportMapCanvas(includeReference){
  const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");
  canvas.width=AREA_MAP_W;
  canvas.height=AREA_MAP_H;
  ctx.fillStyle="#ffffff";
  ctx.fillRect(0,0,AREA_MAP_W,AREA_MAP_H);

  if(includeReference&&areaMapState.referenceDataUrl){
    const img=await areaMapExportLoadImageSource(areaMapState.referenceDataUrl);
    if(img){
      ctx.save();
      ctx.globalAlpha=Math.max(.1,Math.min(1,Number(areaMapState.referenceOpacity||.65)));
      ctx.drawImage(img,0,0,AREA_MAP_W,AREA_MAP_H);
      ctx.restore();
    }
  }

  if(areaMapState.gridVisible){
    ctx.save();
    ctx.globalAlpha=.45;
    for(let x=20;x<AREA_MAP_W;x+=20){
      ctx.beginPath();
      ctx.strokeStyle=x%100===0?"#b9cfd5":"#dbe8eb";
      ctx.lineWidth=x%100===0?1.6:1;
      ctx.moveTo(x,0);ctx.lineTo(x,AREA_MAP_H);ctx.stroke();
    }
    for(let y=20;y<AREA_MAP_H;y+=20){
      ctx.beginPath();
      ctx.strokeStyle=y%100===0?"#b9cfd5":"#dbe8eb";
      ctx.lineWidth=y%100===0?1.6:1;
      ctx.moveTo(0,y);ctx.lineTo(AREA_MAP_W,y);ctx.stroke();
    }
    ctx.restore();
  }

  if(!(includeReference&&areaMapState.referenceDataUrl)){
    ctx.textAlign="center";
    ctx.fillStyle="#173e4b";
    ctx.font='700 26px "Kanit"';
    ctx.fillText("แผนผังแสดงเขตพื้นที่รับผิดชอบของนักเรียน",800,52);
    ctx.fillStyle="#78909a";
    ctx.font='400 15px "Kanit"';
    ctx.fillText("โรงเรียนรัษฎา · RSD Clean Interactive Map",800,82);
  }

  const shapes=[...areaMapState.shapes].sort((a,b)=>Number(a.SortOrder||0)-Number(b.SortOrder||0));
  for(const s of shapes){
    const area=areaMapArea(s.AreaID),
      center=areaMapExportShapeCenter(s),
      status=areaMapStatusInfo(s.AreaID),
      savedColor=/^#[0-9a-f]{6}$/i.test(String(s.FillColor||""))?s.FillColor:"#38bdf8",
      fill=areaMapState.statusMode?status.color:savedColor;

    ctx.save();
    ctx.fillStyle=fill;
    ctx.globalAlpha=areaMapState.statusMode&&status.key==="none"?.33:areaMapState.statusMode&&status.key==="pending"?.52:.58;
    ctx.strokeStyle=areaMapState.statusMode&&status.key==="improve"?"#991b1b":areaMapState.statusMode&&status.key==="excellent"?"#166534":"#315c69";
    ctx.lineWidth=2.4;
    if(s.Locked)ctx.setLineDash([8,5]);

    ctx.beginPath();
    if(s.ShapeType==="polygon"&&Array.isArray(s.Points)&&s.Points.length>=3){
      ctx.moveTo(Number(s.Points[0].x),Number(s.Points[0].y));
      for(let i=1;i<s.Points.length;i++)ctx.lineTo(Number(s.Points[i].x),Number(s.Points[i].y));
      ctx.closePath();
    }else{
      const x=Number(s.X||0),y=Number(s.Y||0),w=Number(s.Width||0),h=Number(s.Height||0),r=Math.min(10,w/2,h/2);
      ctx.moveTo(x+r,y);
      ctx.arcTo(x+w,y,x+w,y+h,r);
      ctx.arcTo(x+w,y+h,x,y+h,r);
      ctx.arcTo(x,y+h,x,y,r);
      ctx.arcTo(x,y,x+w,y,r);
      ctx.closePath();
    }
    ctx.fill();
    ctx.globalAlpha=1;
    ctx.stroke();
    ctx.restore();

    // Draw all map labels directly on Canvas with Kanit.
    ctx.save();
    ctx.textAlign="center";
    ctx.textBaseline="middle";
    ctx.lineJoin="round";
    ctx.strokeStyle="#ffffff";
    ctx.lineWidth=4;
    ctx.fillStyle="#173943";
    ctx.font='700 15px "Kanit"';
    const name=String(area?.AreaName||"พื้นที่");
    ctx.strokeText(name,center.x,center.y-5);
    ctx.fillText(name,center.x,center.y-5);

    ctx.strokeStyle="#ffffff";
    ctx.lineWidth=3;
    ctx.fillStyle="#415f68";
    ctx.font='500 11px "Kanit"';
    const classroom=String(areaMapClass(area)||"");
    ctx.strokeText(classroom,center.x,center.y+14);
    ctx.fillText(classroom,center.x,center.y+14);
    ctx.restore();
  }
  return canvas;
}

function areaMapExportFilename(kind){
  const d=String(areaMapState.statusDate||thaiDay()).replace(/-/g,"");
  return kind==="a4"?"RSD-Clean-Area-Map-A4-"+d+".png":"RSD-Clean-Area-Map-16x9-"+d+".png";
}
function areaMapExportDateText(){
  const date=areaMapState.statusDate||thaiDay();
  try{
    return new Date(date+"T12:00:00+07:00").toLocaleDateString("th-TH",{
      weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:"Asia/Bangkok"
    });
  }catch(e){return date;}
}
function areaMapExportGeneratedText(){
  try{
    return new Date().toLocaleString("th-TH",{
      dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Bangkok"
    });
  }catch(e){return"";}
}
function areaMapExportSummary(){
  const c=areaMapStatusCounts();
  return{
    total:S.master.Areas.length,
    excellent:Number(c.excellent||0),
    medium:Number(c.medium||0),
    improve:Number(c.improve||0),
    pending:Number(c.pending||0),
    none:Number(c.none||0),
    skipped:Number(c.skipped||0)
  };
}
function areaMapExportSvg(includeReference){
  const live=$("area-map-svg");
  if(!live)throw new Error("ไม่พบผังสำหรับส่งออก");
  const svg=live.cloneNode(true);

  svg.querySelectorAll(".map-resize-handle,.map-draft-rect,.map-draft-poly,.map-draft-point").forEach(el=>el.remove());
  svg.querySelectorAll(".map-shape-group.selected").forEach(el=>el.classList.remove("selected"));
  if(!includeReference)svg.querySelector("#area-map-reference-image")?.remove();

  const inlineStyle=document.createElementNS("http://www.w3.org/2000/svg","style");
  inlineStyle.textContent=
    '.map-shape-geometry{fill-opacity:.58;stroke:#315c69;stroke-width:2.4;vector-effect:non-scaling-stroke}'+
    '.map-shape-group.status-none .map-shape-geometry{fill-opacity:.33}'+
    '.map-shape-group.status-pending .map-shape-geometry{fill-opacity:.52}'+
    '.map-shape-group.status-improve .map-shape-geometry{stroke:#991b1b}'+
    '.map-shape-group.status-excellent .map-shape-geometry{stroke:#166534}'+
    '.map-shape-group.locked .map-shape-geometry{stroke-dasharray:8 5}'+
    '.map-shape-label{font:700 15px Kanit,Noto Sans Thai,Tahoma,sans-serif;fill:#173943;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}'+
    '.map-shape-sub{font-size:11px;font-weight:500;fill:#415f68}'+
    '.map-canvas-title{font:700 26px Kanit,Noto Sans Thai,Tahoma,sans-serif;fill:#173e4b}'+
    '.map-canvas-subtitle{font:400 15px Kanit,Noto Sans Thai,Tahoma,sans-serif;fill:#78909a}';
  svg.insertBefore(inlineStyle,svg.firstChild);
  svg.setAttribute("xmlns","http://www.w3.org/2000/svg");
  svg.setAttribute("width",String(AREA_MAP_W));
  svg.setAttribute("height",String(AREA_MAP_H));
  svg.removeAttribute("style");
  return svg;
}
function areaMapExportSvgImage(svg){
  return new Promise((resolve,reject)=>{
    const xml=new XMLSerializer().serializeToString(svg),
      blob=new Blob([xml],{type:"image/svg+xml;charset=utf-8"}),
      url=URL.createObjectURL(blob),
      img=new Image();
    img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("สร้างภาพจากผังไม่สำเร็จ"));};
    img.src=url;
  });
}
function areaMapExportRoundRect(ctx,x,y,w,h,r){
  const rr=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y);
  ctx.arcTo(x+w,y,x+w,y+h,rr);
  ctx.arcTo(x+w,y+h,x,y+h,rr);
  ctx.arcTo(x,y+h,x,y,rr);
  ctx.arcTo(x,y,x+w,y,rr);
  ctx.closePath();
}
function areaMapExportSummaryCard(ctx,x,y,w,h,label,value,color){
  ctx.save();
  ctx.fillStyle="#ffffff";ctx.strokeStyle="#dbe7ea";ctx.lineWidth=1;
  areaMapExportRoundRect(ctx,x,y,w,h,13);ctx.fill();ctx.stroke();
  ctx.fillStyle=color;ctx.beginPath();ctx.arc(x+16,y+18,6,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#6d8189";ctx.font='12px "Kanit"';ctx.fillText(label,x+29,y+22);
  ctx.fillStyle="#193d49";ctx.font='700 25px "Kanit"';ctx.fillText(String(value),x+14,y+53);
  ctx.restore();
}
function areaMapExportLegend(ctx,x,y,color,label,value){
  ctx.save();
  ctx.fillStyle=color;ctx.beginPath();ctx.arc(x+5,y-4,5,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#526d76";ctx.font='11px "Kanit"';
  ctx.fillText(label+" "+String(value),x+16,y);
  ctx.restore();
}
function areaMapExportDownload(canvas,filename){
  return new Promise((resolve,reject)=>{
    canvas.toBlob(blob=>{
      if(!blob)return reject(new Error("สร้างไฟล์ PNG ไม่สำเร็จ"));
      const url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
      resolve();
    },"image/png");
  });
}
async function areaMapExportImage(kind="169"){
  const includeReference=!!$("area-map-export-reference")?.checked&&!!areaMapState.referenceDataUrl,
    layout=kind==="a4"?{w:1754,h:1240,p:46}:{w:1920,h:1080,p:44};

  busy(true,"กำลังสร้างภาพรายงาน…");
  try{
    await areaMapEnsureKanitFont();
    const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");
    canvas.width=layout.w;canvas.height=layout.h;
    ctx.fillStyle="#f3f8f9";ctx.fillRect(0,0,layout.w,layout.h);

    ctx.fillStyle="#143b47";ctx.font='700 30px "Kanit"';
    ctx.fillText("รายงานสถานะการตรวจความสะอาดตามพื้นที่",layout.p,48);
    ctx.fillStyle="#607983";ctx.font='14px "Kanit"';
    ctx.fillText("โรงเรียนรัษฎา · "+areaMapExportDateText(),layout.p,76);
    ctx.font='11px "Kanit"';
    ctx.fillText("สร้างรายงานเมื่อ "+areaMapExportGeneratedText(),layout.p,96);

    const s=areaMapExportSummary(),
      summary=[
        ["ยอดเยี่ยม",s.excellent,"#22c55e"],
        ["ปานกลาง",s.medium,"#f59e0b"],
        ["ปรับปรุง",s.improve,"#ef4444"],
        ["รอตรวจ",s.pending,"#facc15"],
        ["ไม่มีเวร",s.none,"#94a3b8"],
        ["งดตรวจ",s.skipped,"#64748b"]
      ],
      gap=10,cardY=112,cardH=64,
      cardW=(layout.w-layout.p*2-gap*(summary.length-1))/summary.length;
    summary.forEach((v,i)=>areaMapExportSummaryCard(ctx,layout.p+i*(cardW+gap),cardY,cardW,cardH,v[0],v[1],v[2]));

    const mapTop=194,legendH=58,mapBottom=layout.h-layout.p-legendH,
      boxW=layout.w-layout.p*2,boxH=mapBottom-mapTop,
      scale=Math.min(boxW/AREA_MAP_W,boxH/AREA_MAP_H),
      drawW=AREA_MAP_W*scale,drawH=AREA_MAP_H*scale,
      drawX=layout.p+(boxW-drawW)/2,drawY=mapTop+(boxH-drawH)/2;

    ctx.save();
    ctx.fillStyle="#fff";ctx.strokeStyle="#d7e4e8";ctx.lineWidth=1.2;
    areaMapExportRoundRect(ctx,drawX-8,drawY-8,drawW+16,drawH+16,16);ctx.fill();ctx.stroke();ctx.restore();

    const mapCanvas=await areaMapExportMapCanvas(includeReference);
    ctx.drawImage(mapCanvas,drawX,drawY,drawW,drawH);

    const ly=layout.h-layout.p-20;
    let lx=layout.p;
    summary.forEach(v=>{
      areaMapExportLegend(ctx,lx,ly,v[2],v[0],v[1]);
      lx+=kind==="a4"?128:140;
    });

    ctx.fillStyle="#81939a";ctx.font='10px "Kanit"';ctx.textAlign="right";
    ctx.fillText(includeReference?"รวมภาพอ้างอิงพื้นหลัง":"ไม่รวมภาพอ้างอิงพื้นหลัง",layout.w-layout.p,ly);
    ctx.textAlign="left";

    await areaMapExportDownload(canvas,areaMapExportFilename(kind));
    toast(kind==="a4"?"ส่งออก PNG A4 แล้ว":"ส่งออก PNG 16:9 แล้ว");
  }catch(e){error(e);}
  finally{busy(false);}
}

async function areaMapSave(){busy(true,"กำลังบันทึกผังพื้นที่…");try{const shapes=areaMapState.shapes.map((s,i)=>({ShapeID:s.ShapeID,AreaID:s.AreaID,ShapeType:s.ShapeType,X:Number(s.X||0),Y:Number(s.Y||0),Width:Number(s.Width||0),Height:Number(s.Height||0),Points:(s.Points||[]).map(p=>({x:Number(p.x),y:Number(p.y)})),FillColor:s.FillColor||"#38bdf8",Locked:!!s.Locked,SortOrder:i}));const r=await rpc("saveAreaMapLayout",{shapes});areaMapState.dirty=false;toast("บันทึกผังแล้ว "+Number(r.saved||0)+" พื้นที่");areaMapRenderEditor();}catch(e){error(e);}finally{busy(false);}}
