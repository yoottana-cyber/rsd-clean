
const AREA_MAP_W=1600, AREA_MAP_H=1000;
const AREA_MAP_REFERENCE_KEY="rsd-area-map-reference-v1";
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
let areaMapState={shapes:[],selectedAreaId:"",selectedShapeId:"",mode:"select",zoom:.7,dirty:false,viewOnly:false,draftPoints:[],gesture:null,...areaMapReferencePrefs()};

function areaMapUid(){try{return crypto.randomUUID();}catch(e){return "map_"+Date.now()+"_"+Math.random().toString(36).slice(2);}}
function areaMapArea(id){return S.master.Areas.find(a=>a.AreaID===id);}
function areaMapClass(area){return area?masterLabel("ResponsibleClassroomID",area.ResponsibleClassroomID):"—";}
function areaMapShape(areaId){return areaMapState.shapes.find(s=>s.AreaID===areaId);}
function areaMapMarkDirty(){areaMapState.dirty=true;const badge=$("area-map-dirty"),save=$("area-map-save");if(badge){badge.textContent="มีการแก้ไขที่ยังไม่บันทึก";badge.classList.add("show");}if(save)save.disabled=false;}

async function areaMapContent(){
  $("admin-content").innerHTML='<div class="map-editor-loading"><div class="spinner"></div><b>กำลังเปิดผังพื้นที่…</b></div>';
  try{
    const data=await rpc("areaMapLayout");
    if(adminTab!=="AreaMap")return;
    areaMapState={
      shapes:(data.shapes||[]).map(s=>({...s,Points:Array.isArray(s.Points)?s.Points:[]})),
      selectedAreaId:"",selectedShapeId:"",mode:"select",zoom:.7,dirty:false,viewOnly:false,draftPoints:[],gesture:null,
      ...areaMapReferencePrefs()
    };
    areaMapRenderEditor();
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
      '<div class="area-map-stats"><span>พื้นที่ทั้งหมด <b>'+areas.length+'</b></span><span>วางบนผังแล้ว <b>'+mapped.size+'</b></span><span>ยังไม่วาง <b>'+(areas.length-mapped.size)+'</b></span></div>'+
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
      (hasReference?'<div class="area-map-reference-note">ภาพอ้างอิงใช้ช่วยวาดเท่านั้น · ถูกล็อกไว้ด้านล่างและไม่ถูกบันทึกลง D1</div>':"")+
      '<div class="area-map-scroll"><svg id="area-map-svg" viewBox="0 0 '+AREA_MAP_W+' '+AREA_MAP_H+'"></svg></div></div><aside class="area-map-side" id="area-map-side"></aside></div>'+
    '</div>';

  areaMapBindEditor();
  areaMapRenderSvg();
  areaMapRenderSide();
  areaMapUpdateToolbar();
}
function areaMapBindEditor(){
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
  busy(true,"กำลังเตรียมภาพอ้างอิง…");
  try{
    const dataUrl=await areaMapCompressReference(file);
    areaMapState.referenceDataUrl=dataUrl;
    areaMapState.referenceVisible=true;
    const saved=areaMapLocalSet(AREA_MAP_REFERENCE_KEY,dataUrl);
    toast(saved?"เพิ่มภาพอ้างอิงแล้ว":"ใช้ภาพได้ในครั้งนี้ แต่พื้นที่เก็บข้อมูลของเบราว์เซอร์ไม่พอ");
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
  const ok=await Swal.fire({icon:"question",title:"ลบภาพอ้างอิงจากเครื่องนี้?",text:"กรอบพื้นที่ที่วาดและบันทึกไว้จะไม่ถูกลบ",showCancelButton:true,confirmButtonText:"ลบภาพอ้างอิง",cancelButtonText:"ยกเลิก"});
  if(!ok.isConfirmed)return;
  try{localStorage.removeItem(AREA_MAP_REFERENCE_KEY);}catch(e){}
  areaMapState.referenceDataUrl="";
  areaMapState.referenceVisible=false;
  areaMapRenderEditor();
  toast("ลบภาพอ้างอิงแล้ว");
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
        color=/^#[0-9a-f]{6}$/i.test(s.FillColor||"")?s.FillColor:"#38bdf8",
        geo=s.ShapeType==="polygon"
          ? '<polygon class="map-shape-geometry" points="'+s.Points.map(p=>p.x+","+p.y).join(" ")+'" fill="'+color+'"/>'
          : '<rect class="map-shape-geometry" x="'+s.X+'" y="'+s.Y+'" width="'+s.Width+'" height="'+s.Height+'" rx="10" fill="'+color+'"/>',
        handle=selected&&!areaMapState.viewOnly&&!s.Locked&&s.ShapeType==="rect"
          ? '<rect class="map-resize-handle" data-resize="1" x="'+(Number(s.X)+Number(s.Width)-9)+'" y="'+(Number(s.Y)+Number(s.Height)-9)+'" width="18" height="18" rx="4"/>'
          : "";
      return '<g class="map-shape-group '+(selected?"selected ":"")+(s.Locked?"locked":"")+'" data-shape="'+esc(s.ShapeID)+'">'+
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
  const side=$("area-map-side");if(!side)return;const s=areaMapState.shapes.find(x=>x.ShapeID===areaMapState.selectedShapeId);
  if(!s){const unplaced=[...S.master.Areas].sort(assignmentAreaSort).filter(a=>!areaMapShape(a.AreaID));side.innerHTML='<div class="area-map-side-title"><b>ข้อมูลพื้นที่</b><small>คลิกพื้นที่บนผังเพื่อจัดการ</small></div><div class="area-map-empty-panel"><span>ยังไม่วางบนผัง</span><b>'+unplaced.length+' พื้นที่</b></div><div class="area-map-unplaced">'+unplaced.slice(0,14).map(a=>'<button type="button" data-area="'+esc(a.AreaID)+'">'+esc(a.AreaName)+'</button>').join("")+(unplaced.length>14?'<small>และอีก '+(unplaced.length-14)+' พื้นที่</small>':"")+'</div>';side.querySelectorAll("[data-area]").forEach(b=>b.onclick=()=>{areaMapState.selectedAreaId=b.dataset.area;$("area-map-area").value=b.dataset.area;});return;}
  const area=areaMapArea(s.AreaID);side.innerHTML='<div class="area-map-side-title"><b>'+esc(area?.AreaName||"พื้นที่")+'</b><small>'+esc(areaMapClass(area))+'</small></div><div class="area-map-props"><div><span>ชนิด</span><b>'+(s.ShapeType==="polygon"?"หลายเหลี่ยม":"สี่เหลี่ยม")+'</b></div><div><span>ขนาด</span><b>'+Math.round(s.Width)+' × '+Math.round(s.Height)+'</b></div></div><label class="field"><span>สีพื้นที่</span><input id="area-map-color" type="color" value="'+esc(s.FillColor||"#38bdf8")+'" '+(areaMapState.viewOnly?"disabled":"")+'></label><label class="area-map-lock"><input id="area-map-lock" type="checkbox" '+(s.Locked?"checked":"")+' '+(areaMapState.viewOnly?"disabled":"")+'> ล็อกตำแหน่ง</label>'+(areaMapState.viewOnly?"":'<div class="area-map-side-actions"><button class="btn danger w-full" id="area-map-delete-shape">ลบออกจากผัง</button></div>')+'<div class="area-map-tip">การลบจากผังจะไม่ลบพื้นที่ตรวจ QR เวร หรือประวัติผลตรวจ</div>';
  const color=$("area-map-color");if(color)color.oninput=()=>{s.FillColor=color.value;areaMapMarkDirty();areaMapRenderSvg();};const lock=$("area-map-lock");if(lock)lock.onchange=()=>{s.Locked=lock.checked;areaMapMarkDirty();areaMapRenderSvg();};const del=$("area-map-delete-shape");if(del)del.onclick=async()=>{const ok=await Swal.fire({icon:"warning",title:"ลบออกจากผัง?",text:(area?.AreaName||"พื้นที่")+" จะยังคงอยู่ในระบบตรวจ",showCancelButton:true,confirmButtonText:"ลบจากผัง",cancelButtonText:"ยกเลิก"});if(!ok.isConfirmed)return;areaMapState.shapes=areaMapState.shapes.filter(x=>x.ShapeID!==s.ShapeID);areaMapState.selectedShapeId="";areaMapState.dirty=true;areaMapRenderEditor();};
}
async function areaMapSave(){busy(true,"กำลังบันทึกผังพื้นที่…");try{const shapes=areaMapState.shapes.map((s,i)=>({ShapeID:s.ShapeID,AreaID:s.AreaID,ShapeType:s.ShapeType,X:Number(s.X||0),Y:Number(s.Y||0),Width:Number(s.Width||0),Height:Number(s.Height||0),Points:(s.Points||[]).map(p=>({x:Number(p.x),y:Number(p.y)})),FillColor:s.FillColor||"#38bdf8",Locked:!!s.Locked,SortOrder:i}));const r=await rpc("saveAreaMapLayout",{shapes});areaMapState.dirty=false;toast("บันทึกผังแล้ว "+Number(r.saved||0)+" พื้นที่");areaMapRenderEditor();}catch(e){error(e);}finally{busy(false);}}
