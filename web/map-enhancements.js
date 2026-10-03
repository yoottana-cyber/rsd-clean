"use strict";

/* RSD Clean map enhancements
   - centralized mapStatus consumption in editor
   - undo/redo
   - polygon vertex editing
   - decoration/context layers
   - mobile pan/zoom
   - PNG clipboard/share/PDF
   - QR shortcut from the map
*/

const rsdMapEnh={
  undo:[],
  redo:[],
  selectedVertex:-1,
  pan:false,
  panGesture:null,
  observer:null
};

function rsdMapIsCompactView(){return window.matchMedia("(max-width: 900px)").matches;}

function rsdMapClone(v){return JSON.parse(JSON.stringify(v));}
function rsdMapSnapshot(){
  return JSON.stringify({
    shapes:areaMapState.shapes||[]
  });
}
function rsdMapRecordBefore(){
  const snap=rsdMapSnapshot();
  if(rsdMapEnh.undo[rsdMapEnh.undo.length-1]!==snap){
    rsdMapEnh.undo.push(snap);
    if(rsdMapEnh.undo.length>50)rsdMapEnh.undo.shift();
  }
  rsdMapEnh.redo=[];
  rsdMapUpdateHistoryButtons();
}
function rsdMapRestoreSnapshot(snap){
  const x=JSON.parse(snap);
  areaMapState.shapes=Array.isArray(x.shapes)?x.shapes:[];
  areaMapState.selectedShapeId="";
  areaMapState.selectedAreaId="";
  rsdMapEnh.selectedVertex=-1;
  areaMapState.dirty=true;
  areaMapRenderEditor();
}
function rsdMapUndo(){
  if(!rsdMapEnh.undo.length)return;
  const current=rsdMapSnapshot(),previous=rsdMapEnh.undo.pop();
  rsdMapEnh.redo.push(current);
  rsdMapRestoreSnapshot(previous);
}
function rsdMapRedo(){
  if(!rsdMapEnh.redo.length)return;
  const current=rsdMapSnapshot(),next=rsdMapEnh.redo.pop();
  rsdMapEnh.undo.push(current);
  rsdMapRestoreSnapshot(next);
}
function rsdMapUpdateHistoryButtons(){
  const u=$("area-map-undo"),r=$("area-map-redo");
  if(u)u.disabled=!rsdMapEnh.undo.length;
  if(r)r.disabled=!rsdMapEnh.redo.length;
}

function rsdMapDailyFromStatus(data){
  const s=data.summary||{};
  return{
    date:data.date,
    items:data.items||[],
    summary:{
      total:Number(s.total||0),
      done:Number(s.completed||0),
      pending:Number(s.pending||0)+Number(s.no_inspector||0),
      skipped:Number(s.skipped||0)
    },
    updatedAt:data.updatedAt||""
  };
}

areaMapStatusInfo=function(areaId){
  const item=(areaMapState.daily?.items||[]).find(x=>String(x.AreaID)===String(areaId));
  if(!item)return{key:"no_assignment",label:"ไม่มีเวร",color:"#94a3b8",item:null};
  if(item.StatusKey)return{key:item.StatusKey,label:item.StatusLabel||item.StatusKey,color:item.StatusColor||"#94a3b8",item};
  if(item.Status==="งดตรวจ")return{key:"skipped",label:"งดตรวจ",color:"#64748b",item};
  if(item.Status==="รอตรวจ")return{key:"pending",label:"รอตรวจ",color:"#facc15",item};
  if(item.Status==="ตรวจแล้ว"){
    if(Number(item.Score)===3)return{key:"excellent",label:item.Rating||"ยอดเยี่ยม",color:"#22c55e",item};
    if(Number(item.Score)===2)return{key:"medium",label:item.Rating||"ปานกลาง",color:"#f59e0b",item};
    if(Number(item.Score)===1)return{key:"improve",label:item.Rating||"ปรับปรุง",color:"#ef4444",item};
    return{key:"done",label:item.Rating||"ตรวจแล้ว",color:"#14b8a6",item};
  }
  return{key:"no_assignment",label:"ไม่มีเวร",color:"#94a3b8",item};
};
areaMapStatusCounts=function(){
  const c={holiday:0,no_assignment:0,no_inspector:0,pending:0,excellent:0,medium:0,improve:0,skipped:0,done:0,none:0,other_area:0};
  for(const a of S.master.Areas){
    const st=areaMapStatusInfo(a.AreaID);
    c[st.key]=(c[st.key]||0)+1;
  }
  c.none=c.no_assignment+c.holiday;
  return c;
};
areaMapStatusLegend=function(){
  const c=areaMapStatusCounts();
  const rows=[
    ["#cbd5e1","วันหยุด",c.holiday],
    ["#94a3b8","ไม่มีเวร",c.no_assignment],
    ["#a78bfa","ยังไม่มีผู้ตรวจ",c.no_inspector],
    ["#facc15","รอตรวจ",c.pending],
    ["#22c55e","ยอดเยี่ยม",c.excellent],
    ["#f59e0b","ปานกลาง",c.medium],
    ["#ef4444","ปรับปรุง",c.improve],
    ["#64748b","งดตรวจ",c.skipped]
  ];
  return rows.filter(x=>x[2]>0).map(x=>'<span class="area-map-legend-item"><i style="background:'+x[0]+'"></i>'+x[1]+' <b>'+x[2]+'</b></span>').join("");
};

async function rsdEnsureMapReference(meta){
  const serverVersion=String(meta?.ReferenceVersion||"");
  const hasReference=!!meta?.HasReference;
  const localData=areaMapLocalGet(AREA_MAP_REFERENCE_KEY,"");
  const localVersion=areaMapLocalGet(AREA_MAP_REFERENCE_VERSION_KEY,"");

  if(!hasReference){
    if(S.user?.Role==="Admin"&&localData&&!localVersion){
      try{
        const saved=await rpc("saveAreaMapReference",{dataUrl:localData},true);
        areaMapLocalSet(AREA_MAP_REFERENCE_VERSION_KEY,String(saved?.ReferenceVersion||""));
        return localData;
      }catch(e){}
    }
    try{localStorage.removeItem(AREA_MAP_REFERENCE_KEY);}catch(e){}
    areaMapLocalSet(AREA_MAP_REFERENCE_VERSION_KEY,serverVersion);
    return"";
  }
  if(localData&&localVersion===serverVersion)return localData;
  const remote=await rpc("areaMapReference",{},true);
  const data=String(remote?.DataUrl||"");
  if(data){
    areaMapLocalSet(AREA_MAP_REFERENCE_KEY,data);
    areaMapLocalSet(AREA_MAP_REFERENCE_VERSION_KEY,String(remote?.ReferenceVersion||serverVersion));
  }
  return data;
}
window.rsdEnsureMapReference=rsdEnsureMapReference;

areaMapContent=async function(){
  $("admin-content").innerHTML='<div class="map-editor-loading"><div class="spinner"></div><b>กำลังเปิดผังพื้นที่…</b></div>';
  try{
    const date=areaMapState.statusDate||thaiDay(),data=await rpc("mapStatus",{date},true);
    if(adminTab!=="AreaMap")return;
    await rsdEnsureMapReference(data);
    areaMapState={
      shapes:(data.shapes||[]).map(s=>({...s,Points:Array.isArray(s.Points)?s.Points:[]})),
      selectedAreaId:"",
      selectedShapeId:"",
      mode:"select",
      zoom:.7,
      dirty:false,
      viewOnly:false,
      draftPoints:[],
      gesture:null,
      statusMode:areaMapState.statusMode!==false,
      statusDate:date,
      daily:rsdMapDailyFromStatus(data),
      mapMeta:{isHoliday:!!data.isHoliday,holidayReason:data.holidayReason||""},
      ...areaMapReferencePrefs()
    };
    rsdMapEnh.undo=[];
    rsdMapEnh.redo=[];
      rsdMapEnh.selectedVertex=-1;
    areaMapRenderEditor();
    areaMapScheduleStatusRefresh();
  }catch(e){
    error(e);
    $("admin-content").innerHTML='<div class="empty">เปิดผังพื้นที่ไม่สำเร็จ</div>';
  }
};

areaMapRefreshStatus=async function(silent=false){
  const date=areaMapState.statusDate||thaiDay();
  try{
    const data=await rpc("mapStatus",{date},true);
    if(adminTab!=="AreaMap")return;
    await rsdEnsureMapReference(data);
    areaMapState.daily=rsdMapDailyFromStatus(data);
    areaMapState.mapMeta={isHoliday:!!data.isHoliday,holidayReason:data.holidayReason||""};
    areaMapState.referenceDataUrl=areaMapLocalGet(AREA_MAP_REFERENCE_KEY,"");
    areaMapRenderEditor();
    if(!silent)toast("อัปเดตสถานะผังแล้ว");
  }catch(e){if(!silent)error(e);}
  finally{areaMapScheduleStatusRefresh();}
};

const rsdBaseMapRenderSvg=areaMapRenderSvg;
areaMapRenderSvg=function(){
  rsdBaseMapRenderSvg();
  rsdMapRenderVertices();
  rsdMapWireEditorGestures();
};

function rsdMapRenderVertices(){
  const svg=$("area-map-svg");if(!svg)return;
  const s=(areaMapState.shapes||[]).find(x=>String(x.ShapeID)===String(areaMapState.selectedShapeId));
  if(!s||s.ShapeType!=="polygon"||s.Locked||areaMapState.viewOnly||areaMapState.mode!=="select")return;
  const layer=document.createElementNS("http://www.w3.org/2000/svg","g");layer.id="map-vertex-layer";
  (s.Points||[]).forEach((p,i)=>{
    const c=document.createElementNS("http://www.w3.org/2000/svg","circle");
    c.setAttribute("cx",Number(p.x));c.setAttribute("cy",Number(p.y));c.setAttribute("r",i===rsdMapEnh.selectedVertex?"10":"8");
    c.setAttribute("class","map-vertex-handle"+(i===rsdMapEnh.selectedVertex?" selected":""));c.dataset.index=String(i);layer.appendChild(c);
    c.addEventListener("pointerdown",e=>{
      e.preventDefault();e.stopPropagation();rsdMapRecordBefore();rsdMapEnh.selectedVertex=i;
      try{c.setPointerCapture(e.pointerId);}catch(x){}
      const move=ev=>{const pt=areaMapPoint(ev);s.Points[i]={x:Math.round(pt.x),y:Math.round(pt.y)};areaMapRecalcPolygon(s);areaMapRenderSvg();};
      const up=()=>{c.removeEventListener("pointermove",move);c.removeEventListener("pointerup",up);c.removeEventListener("pointercancel",up);areaMapMarkDirty();areaMapRenderSide();};
      c.addEventListener("pointermove",move);c.addEventListener("pointerup",up);c.addEventListener("pointercancel",up);
    });
  });
  svg.appendChild(layer);
}
function rsdMapWireEditorGestures(){
  const svg=$("area-map-svg"),scroll=svg?.closest(".area-map-scroll");if(!svg||!scroll)return;
  if(svg.dataset.rsdGestures==="1")return;
  svg.dataset.rsdGestures="1";
  svg.addEventListener("pointerdown",e=>{
    if(rsdMapEnh.pan){
      e.preventDefault();e.stopImmediatePropagation();
      rsdMapEnh.panGesture={x:e.clientX,y:e.clientY,left:scroll.scrollLeft,top:scroll.scrollTop,id:e.pointerId};
      try{svg.setPointerCapture(e.pointerId);}catch(x){}
      return;
    }
    if(areaMapState.viewOnly)return;
    if(e.target.closest?.(".map-shape-group")&&areaMapState.mode==="select")rsdMapRecordBefore();
    else if(areaMapState.mode==="rect"&&areaMapState.selectedAreaId)rsdMapRecordBefore();
  },true);
  svg.addEventListener("pointermove",e=>{
    const g=rsdMapEnh.panGesture;if(!g||g.id!==e.pointerId)return;
    scroll.scrollLeft=g.left-(e.clientX-g.x);scroll.scrollTop=g.top-(e.clientY-g.y);
  },true);
  const end=e=>{if(rsdMapEnh.panGesture&&(!e||rsdMapEnh.panGesture.id===e.pointerId))rsdMapEnh.panGesture=null;};
  svg.addEventListener("pointerup",end,true);svg.addEventListener("pointercancel",end,true);
  let pinch=null;
  scroll.addEventListener("touchstart",e=>{
    if(e.touches.length===2){
      const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY;
      pinch={dist:Math.hypot(dx,dy),zoom:areaMapState.zoom};
    }
  },{passive:true});
  scroll.addEventListener("touchmove",e=>{
    if(e.touches.length!==2||!pinch)return;
    e.preventDefault();
    const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY;
    areaMapSetZoom(Math.max(.35,Math.min(1.5,pinch.zoom*Math.hypot(dx,dy)/pinch.dist)));
  },{passive:false});
  scroll.addEventListener("touchend",()=>{pinch=null;},{passive:true});
}

const rsdBaseMapFinishPolygon=areaMapFinishPolygon;
areaMapFinishPolygon=function(){
  if(areaMapState.draftPoints?.length>=3)rsdMapRecordBefore();
  rsdBaseMapFinishPolygon();
};

const rsdBaseMapRenderSide=areaMapRenderSide;
areaMapRenderSide=function(){
  rsdBaseMapRenderSide();
  const side=$("area-map-side"),s=(areaMapState.shapes||[]).find(x=>String(x.ShapeID)===String(areaMapState.selectedShapeId));
  if(!side||!s)return;
  const controls=[];
  if(s.ShapeType==="polygon"&&!areaMapState.viewOnly&&!s.Locked){
    controls.push('<div class="area-map-poly-tools"><b>แก้จุด Polygon</b><small>แตะจุดบนรูปแล้วลากเพื่อปรับมุม</small><div class="flex gap-2 mt-2"><button class="btn small secondary" id="map-vertex-add">+ เพิ่มจุด</button><button class="btn small danger" id="map-vertex-delete" '+((s.Points||[]).length<=3?"disabled":"")+'>ลบจุด</button></div></div>');
  }
  if(S.user?.Role==="Admin")controls.push('<button class="btn small secondary w-full mt-3" id="map-area-qr">▦ QR พื้นที่นี้</button>');
  if(controls.length)side.insertAdjacentHTML("beforeend",controls.join(""));
  const color=$("area-map-color"),lock=$("area-map-lock"),del=$("area-map-delete-shape");
  [color,lock,del].filter(Boolean).forEach(el=>el.addEventListener("pointerdown",rsdMapRecordBefore,{once:true}));
  if($("map-area-qr"))$("map-area-qr").onclick=()=>qrAreaModal(s.AreaID);
  if($("map-vertex-add"))$("map-vertex-add").onclick=()=>{
    rsdMapRecordBefore();
    const pts=s.Points||[],i=rsdMapEnh.selectedVertex>=0?rsdMapEnh.selectedVertex:0,j=(i+1)%pts.length;
    pts.splice(i+1,0,{x:Math.round((Number(pts[i].x)+Number(pts[j].x))/2),y:Math.round((Number(pts[i].y)+Number(pts[j].y))/2)});
    rsdMapEnh.selectedVertex=i+1;areaMapRecalcPolygon(s);areaMapMarkDirty();areaMapRenderEditor();
  };
  if($("map-vertex-delete"))$("map-vertex-delete").onclick=()=>{
    if((s.Points||[]).length<=3)return toast("Polygon ต้องมีอย่างน้อย 3 จุด");
    rsdMapRecordBefore();const i=rsdMapEnh.selectedVertex>=0?rsdMapEnh.selectedVertex:s.Points.length-1;s.Points.splice(i,1);
    rsdMapEnh.selectedVertex=Math.min(i,s.Points.length-1);areaMapRecalcPolygon(s);areaMapMarkDirty();areaMapRenderEditor();
  };
};
const rsdBaseMapRenderEditor=areaMapRenderEditor;
areaMapRenderEditor=function(){
  rsdBaseMapRenderEditor();
  rsdMapEnhanceEditorUi();
};
function rsdMapEnhanceEditorUi(){
  const actions=document.querySelector(".area-map-head-actions");
  if(actions&&!$("area-map-undo")){
    actions.insertAdjacentHTML("afterbegin",'<button class="btn secondary" id="area-map-undo">↶ ย้อนกลับ</button><button class="btn secondary" id="area-map-redo">↷ ทำซ้ำ</button>');
    $("area-map-undo").onclick=rsdMapUndo;$("area-map-redo").onclick=rsdMapRedo;
  }
  const zoom=document.querySelector(".area-map-zoom");
  if(rsdMapIsCompactView()&&zoom&&!$("area-map-fit")){
    zoom.insertAdjacentHTML("afterbegin",'<button class="btn small secondary" id="area-map-fit">⌖ พอดี</button><button class="btn small secondary" id="area-map-pan">✋ เลื่อนผัง</button>');
    $("area-map-fit").onclick=()=>{
      const sc=document.querySelector(".area-map-scroll");if(!sc)return;
      areaMapSetZoom(Math.max(.35,Math.min(1.5,(sc.clientWidth-20)/AREA_MAP_W)));
    };
    $("area-map-pan").onclick=()=>{
      rsdMapEnh.pan=!rsdMapEnh.pan;
      $("area-map-pan").classList.toggle("active",rsdMapEnh.pan);
      $("area-map-pan").textContent=rsdMapEnh.pan?"✓ กำลังเลื่อน":"✋ เลื่อนผัง";
      const svg=$("area-map-svg");if(svg)svg.classList.toggle("map-pan-mode",rsdMapEnh.pan);
    };
  }
  const live=document.querySelector(".area-map-live-controls");
  if(live&&!$("area-map-copy-image")){
    live.insertAdjacentHTML("beforeend",'<button class="btn small secondary" id="area-map-copy-image">📋 คัดลอกภาพ</button><button class="btn small secondary" id="area-map-share-image">↗ แชร์</button><button class="btn small secondary" id="area-map-export-pdf">PDF</button>');
    $("area-map-copy-image").onclick=rsdMapCopyImage;$("area-map-share-image").onclick=rsdMapShareImage;$("area-map-export-pdf").onclick=rsdMapExportPdf;
  }
  if(areaMapState.mapMeta?.isHoliday){
    const livebar=document.querySelector(".area-map-livebar");
    if(livebar&&!document.querySelector(".area-map-holiday-banner"))livebar.insertAdjacentHTML("afterend",'<div class="area-map-holiday-banner">วันหยุด · '+esc(areaMapState.mapMeta.holidayReason||"ไม่มีการตรวจในวันดังกล่าว")+'</div>');
  }
  rsdMapUpdateHistoryButtons();
  areaMapRenderSide();
  rsdMapRenderVertices();
}

areaMapSave=async function(){
  busy(true,"กำลังบันทึกผังพื้นที่…");
  try{
    const shapes=(areaMapState.shapes||[]).map((s,i)=>({ShapeID:s.ShapeID,AreaID:s.AreaID,ShapeType:s.ShapeType,X:Number(s.X||0),Y:Number(s.Y||0),Width:Number(s.Width||0),Height:Number(s.Height||0),Points:(s.Points||[]).map(p=>({x:Number(p.x),y:Number(p.y)})),FillColor:s.FillColor||"#38bdf8",Locked:!!s.Locked,SortOrder:i}));
    const result=await rpc("saveAreaMapLayout",{shapes});
    areaMapState.dirty=false;
    toast("บันทึกผังแล้ว "+Number(result.saved||0)+" พื้นที่");
    areaMapRenderEditor();
  }catch(e){error(e);}finally{busy(false);}
};

function rsdMapRedrawAreaShapes(ctx){
  for(const s of areaMapState.shapes||[]){
    const area=areaMapArea(s.AreaID),st=areaMapStatusInfo(s.AreaID),
      saved=/^#[0-9a-f]{6}$/i.test(String(s.FillColor||""))?s.FillColor:"#38bdf8",
      fill=areaMapState.statusMode?st.color:saved,c=areaMapExportShapeCenter(s);
    ctx.save();
    ctx.fillStyle=fill;
    ctx.globalAlpha=areaMapState.statusMode&&st.key==="no_assignment"?.33:areaMapState.statusMode&&st.key==="holiday"?.3:areaMapState.statusMode&&st.key==="pending"?.52:.58;
    ctx.strokeStyle=areaMapState.statusMode&&st.key==="improve"?"#991b1b":areaMapState.statusMode&&st.key==="excellent"?"#166534":"#315c69";
    ctx.lineWidth=2.4;if(s.Locked)ctx.setLineDash([8,5]);ctx.beginPath();
    if(s.ShapeType==="polygon"&&s.Points?.length>=3){ctx.moveTo(Number(s.Points[0].x),Number(s.Points[0].y));for(let i=1;i<s.Points.length;i++)ctx.lineTo(Number(s.Points[i].x),Number(s.Points[i].y));ctx.closePath();}
    else{const x=Number(s.X||0),y=Number(s.Y||0),w=Number(s.Width||0),h=Number(s.Height||0),r=Math.min(10,w/2,h/2);ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
    ctx.fill();ctx.globalAlpha=1;ctx.stroke();ctx.restore();
    ctx.save();ctx.textAlign="center";ctx.textBaseline="middle";ctx.lineJoin="round";ctx.strokeStyle="#fff";ctx.lineWidth=4;ctx.fillStyle="#173943";ctx.font='700 15px "Kanit"';
    const name=String(area?.AreaName||s.AreaName||"พื้นที่");ctx.strokeText(name,c.x,c.y-5);ctx.fillText(name,c.x,c.y-5);
    ctx.lineWidth=3;ctx.fillStyle="#415f68";ctx.font='500 11px "Kanit"';const cls=String(areaMapClass(area)||s.ClassName||"");ctx.strokeText(cls,c.x,c.y+14);ctx.fillText(cls,c.x,c.y+14);ctx.restore();
  }
}

async function rsdMapBuildReportCanvas(kind="169"){
  const includeReference=!!$("area-map-export-reference")?.checked&&!!areaMapState.referenceDataUrl,layout=kind==="a4"?{w:1754,h:1240,p:46}:{w:1920,h:1080,p:44};
  await areaMapEnsureKanitFont();
  const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");canvas.width=layout.w;canvas.height=layout.h;ctx.fillStyle="#f3f8f9";ctx.fillRect(0,0,layout.w,layout.h);
  ctx.fillStyle="#143b47";ctx.font='700 30px "Kanit"';ctx.fillText("รายงานสถานะการตรวจความสะอาดตามพื้นที่",layout.p,48);
  ctx.fillStyle="#607983";ctx.font='14px "Kanit"';ctx.fillText((S.config?.schoolName||"โรงเรียนรัษฎา")+" · "+areaMapExportDateText(),layout.p,76);
  ctx.font='11px "Kanit"';ctx.fillText("สร้างรายงานเมื่อ "+areaMapExportGeneratedText(),layout.p,96);
  const c=areaMapStatusCounts(),summary=[
    ["ยอดเยี่ยม",c.excellent,"#22c55e"],["ปานกลาง",c.medium,"#f59e0b"],["ปรับปรุง",c.improve,"#ef4444"],["รอตรวจ",c.pending,"#facc15"],
    ["ไม่มีเวร/ผู้ตรวจ",c.no_assignment+c.no_inspector,"#94a3b8"],["งดตรวจ/วันหยุด",c.skipped+c.holiday,"#64748b"]
  ],gap=10,cardY=112,cardH=64,cardW=(layout.w-layout.p*2-gap*(summary.length-1))/summary.length;
  summary.forEach((v,i)=>areaMapExportSummaryCard(ctx,layout.p+i*(cardW+gap),cardY,cardW,cardH,v[0],v[1],v[2]));
  const mapTop=194,legendH=58,mapBottom=layout.h-layout.p-legendH,boxW=layout.w-layout.p*2,boxH=mapBottom-mapTop,scale=Math.min(boxW/AREA_MAP_W,boxH/AREA_MAP_H),drawW=AREA_MAP_W*scale,drawH=AREA_MAP_H*scale,drawX=layout.p+(boxW-drawW)/2,drawY=mapTop+(boxH-drawH)/2;
  ctx.save();ctx.fillStyle="#fff";ctx.strokeStyle="#d7e4e8";ctx.lineWidth=1.2;areaMapExportRoundRect(ctx,drawX-8,drawY-8,drawW+16,drawH+16,16);ctx.fill();ctx.stroke();ctx.restore();
  const mapCanvas=await areaMapExportMapCanvas(includeReference),mapCtx=mapCanvas.getContext("2d");rsdMapRedrawAreaShapes(mapCtx);ctx.drawImage(mapCanvas,drawX,drawY,drawW,drawH);
  const ly=layout.h-layout.p-20;let lx=layout.p;summary.forEach(v=>{areaMapExportLegend(ctx,lx,ly,v[2],v[0],v[1]);lx+=kind==="a4"?128:150;});
  return canvas;
}
areaMapExportImage=async function(kind="169"){
  busy(true,"กำลังสร้างภาพรายงาน…");try{const canvas=await rsdMapBuildReportCanvas(kind);await areaMapExportDownload(canvas,areaMapExportFilename(kind));toast(kind==="a4"?"ส่งออก PNG A4 แล้ว":"ส่งออก PNG 16:9 แล้ว");}catch(e){error(e);}finally{busy(false);}
};
function rsdMapCanvasBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("สร้างไฟล์ภาพไม่สำเร็จ")),"image/png"));}
async function rsdMapCopyImage(){
  busy(true,"กำลังคัดลอกภาพ…");try{
    if(!navigator.clipboard?.write||typeof ClipboardItem==="undefined")throw new Error("เบราว์เซอร์นี้ยังไม่รองรับการคัดลอกรูปภาพ");
    const canvas=await rsdMapBuildReportCanvas("169"),blob=await rsdMapCanvasBlob(canvas);await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]);toast("คัดลอกภาพแล้ว");
  }catch(e){error(e);}finally{busy(false);}
}
async function rsdMapShareImage(){
  busy(true,"กำลังเตรียมภาพสำหรับแชร์…");try{
    const canvas=await rsdMapBuildReportCanvas("169"),blob=await rsdMapCanvasBlob(canvas),file=new File([blob],areaMapExportFilename("169"),{type:"image/png"});
    if(navigator.canShare?.({files:[file]})&&navigator.share){await navigator.share({files:[file],title:"RSD Clean · ผังสถานะพื้นที่"});}
    else{await areaMapExportDownload(canvas,areaMapExportFilename("169"));toast("อุปกรณ์นี้ไม่รองรับ Share โดยตรง จึงบันทึก PNG ให้แทน");}
  }catch(e){if(e?.name!=="AbortError")error(e);}finally{busy(false);}
}
async function rsdMapExportPdf(){
  busy(true,"กำลังสร้าง PDF…");try{
    await window.rsdLoadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",()=>!!window.jspdf?.jsPDF);
    const canvas=await rsdMapBuildReportCanvas("a4"),pdf=new window.jspdf.jsPDF({orientation:"landscape",unit:"mm",format:"a4"});
    pdf.addImage(canvas.toDataURL("image/jpeg",.92),"JPEG",0,0,297,210,undefined,"FAST");pdf.save("RSD-Clean-Area-Map-"+String(areaMapState.statusDate||thaiDay()).replace(/-/g,"")+".pdf");
    toast("ส่งออก PDF แล้ว");
  }catch(e){error(e);}finally{busy(false);}
}

function rsdEnhanceViewer(container){
  if(!container||!rsdMapIsCompactView()||container.dataset.rsdMapEnhanced==="1")return;
  const svg=container.querySelector("svg");if(!svg||container.closest(".area-map-canvas-card"))return;
  container.dataset.rsdMapEnhanced="1";
  const controls=document.createElement("div");controls.className="rsd-map-view-controls";controls.innerHTML='<button type="button" data-z="-">−</button><button type="button" data-z="fit">พอดี</button><button type="button" data-z="+">＋</button>';
  container.parentElement?.insertBefore(controls,container);
  let scale=1;
  const apply=()=>{svg.style.width=(scale*100)+"%";svg.style.minWidth="0";svg.style.maxHeight="none";};
  controls.querySelector('[data-z="-"]').onclick=()=>{scale=Math.max(.55,scale-.2);apply();};
  controls.querySelector('[data-z="+"]').onclick=()=>{scale=Math.min(3,scale+.2);apply();};
  controls.querySelector('[data-z="fit"]').onclick=()=>{scale=1;apply();};
  let pinch=null;
  container.addEventListener("touchstart",e=>{if(e.touches.length===2){const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY;pinch={d:Math.hypot(dx,dy),s:scale};}},{passive:true});
  container.addEventListener("touchmove",e=>{if(!pinch||e.touches.length!==2)return;e.preventDefault();const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY;scale=Math.max(.55,Math.min(3,pinch.s*Math.hypot(dx,dy)/pinch.d));apply();},{passive:false});
  container.addEventListener("touchend",()=>{pinch=null;},{passive:true});
}
function rsdEnhanceAllViewerMaps(){
  document.querySelectorAll(".ops-control-map-scroll,.dashboard-map-frame,.inspector-map-scroll,.exec-map-scroll,.teacher-map-scroll").forEach(rsdEnhanceViewer);
}
function rsdRestoreDesktopMapView(){
  document.querySelectorAll(".rsd-map-view-controls").forEach(x=>x.remove());
  document.querySelectorAll(".ops-control-map-scroll,.dashboard-map-frame,.inspector-map-scroll,.exec-map-scroll,.teacher-map-scroll").forEach(container=>{
    delete container.dataset.rsdMapEnhanced;
    const svg=container.querySelector("svg");
    if(svg){
      svg.style.removeProperty("width");
      svg.style.removeProperty("min-width");
      svg.style.removeProperty("max-height");
    }
  });
  if($("area-map-fit"))$("area-map-fit").remove();
  if($("area-map-pan"))$("area-map-pan").remove();
  rsdMapEnh.pan=false;
  $("area-map-svg")?.classList.remove("map-pan-mode");
}
function rsdSyncResponsiveMapView(){
  if(rsdMapIsCompactView()){
    rsdEnhanceAllViewerMaps();
    if($("area-map-svg")&&document.querySelector(".area-map-zoom")&&!$("area-map-fit"))rsdMapEnhanceEditorUi();
  }else{
    rsdRestoreDesktopMapView();
  }
}
rsdMapEnh.observer=new MutationObserver(()=>rsdSyncResponsiveMapView());
rsdMapEnh.observer.observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener("resize",()=>rsdSyncResponsiveMapView(),{passive:true});
rsdSyncResponsiveMapView();
