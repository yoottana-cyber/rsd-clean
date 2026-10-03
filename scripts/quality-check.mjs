import fs from "node:fs";

const files=[
  "functions/api.js",
  "web/core.js",
  "web/admin.js",
  "web/map-editor.js",
  "web/map-enhancements.js",
  "web/inspector.js",
  "web/coverage.js",
  "web/operations.js",
  "web/sw.js"
];

const read=p=>fs.readFileSync(p,"utf8");
const fail=msg=>{console.error("QUALITY CHECK FAILED:",msg);process.exitCode=1;};
const ok=msg=>console.log("✓",msg);

for(const path of files){
  try{
    let src=read(path);
    if(path==="functions/api.js")src=src.replace(/^\s*export\s+/gm,"");
    new Function(src);
    ok("syntax "+path);
  }catch(e){fail("syntax "+path+" — "+e.message);}
}

const api=read("functions/api.js");
const core=read("web/core.js");
const admin=read("web/admin.js");
const editor=read("web/map-editor.js");
const enh=read("web/map-enhancements.js");
const inspector=read("web/inspector.js");
const coverage=read("web/coverage.js");
const ops=read("web/operations.js");
const index=read("web/index.html");
const sw=read("web/sw.js");

const checks=[
  [api.includes("async function mapStatus(env,u,p)"),"central mapStatus API exists"],
  [api.includes('role(u,["Admin","Supervisor","Inspector","Teacher"])'),"map read roles include all required viewers"],
  [api.includes("async function saveAreaMapReferenceChunk")&&api.includes("async function finalizeAreaMapReferenceUpload")&&api.includes("async function areaMapReference"),"chunked shared map reference API exists"],
  [api.includes("i.status===\"รอตรวจ\"&&!byArea.has(i.area_id)"),"stale pending duty cleanup exists"],
  [api.includes("function dutyWeekday")&&api.includes("/[^1-7]+/")&&api.includes("saturdayDutyEnabled")&&api.includes("sundayDutyEnabled"),"weekend duties are configurable"],
  [admin.includes("activeDutyDayOptions")&&admin.includes('[6, "เสาร์", "ส."]')&&admin.includes('[7, "อาทิตย์", "อา."]'),"assignment UI supports enabled weekend tabs"],
  [admin.includes("function assignmentCopyTeamModal")&&admin.includes("assignment-copy-team")&&admin.includes('rpc("assign",{userIds:sourceUserIds,areaIds'),"multi-area inspector team assignment exists"],
  [api.includes("runDbBatches(db,stmts,40)")&&api.includes("users.length<=100&&areas.length<=100"),"large multi-area assignment batches are safe"],
  [coverage.includes('name="saturdayDutyEnabled"')&&coverage.includes('name="sundayDutyEnabled"'),"system settings expose weekend duty switches"],
  [ops.includes("async function certificateOptimizeTemplateFile")&&ops.includes("CERT_TEMPLATE_WIDTH=2244")&&ops.includes("CERT_TEMPLATE_HEIGHT=1588"),"certificate templates are optimized before upload"],
  [ops.includes("CERT_TEMPLATE_CACHE_NAME")&&ops.includes("certificateTemplateCacheGet")&&ops.includes("certificateTemplateCachePut"),"certificate template browser cache exists"],
  [ops.includes("async function certificateDecodedTemplate")&&ops.includes("opCertificateTemplateDecodedKey"),"certificate background decode is reused"],
  [api.includes("CERT_TEMPLATE_ORIGINAL")&&api.includes("CERT_TEMPLATE_WORKING")&&api.includes("originalFileId"),"certificate original and working copies are preserved"],
  [sw.includes('k!=="rsd-certificate-template-v1"'),"certificate template cache survives service-worker upgrades"],
  [api.includes("function currentInspectionLabels")&&api.includes("async function currentInspectionNameMaps")&&api.includes("AreaName:label.AreaName")&&api.includes("พื้นที่:label.AreaName"),"historical views resolve current master names"],
  [api.includes("async function deleteInspection")&&api.includes('"Inspections",id,recycleLabel("Inspections",snapshot)')&&api.includes('type==="Inspections"'),"recoverable inspection deletion exists"],
  [api.includes('assert(String(row.inspection_date)<thaiDay()')&&api.includes('["ตรวจแล้ว","งดตรวจ"].includes'),"inspection deletion is limited to completed historical records"],
  [editor.includes("async function areaMapExportImage"),"base PNG export exists"],
  [enh.includes("function rsdMapUndo")&&enh.includes("function rsdMapRedo"),"map undo/redo exists"],
  [enh.includes("map-vertex-handle")&&enh.includes("map-vertex-add")&&enh.includes("map-vertex-delete"),"polygon vertex editing exists"],
  [enh.includes("function rsdEnsureMapReference")&&enh.includes("AREA_MAP_REFERENCE_VERSION_KEY"),"shared reference version cache exists"],
  [enh.includes("chunkSize=60000")&&enh.includes("saveAreaMapReferenceChunk")&&enh.includes("finalizeAreaMapReferenceUpload"),"shared reference upload stays below API payload limit"],
  [!api.slice(api.indexOf("async function saveAreaMapReferenceChunk"),api.indexOf("async function mapStatus")).match(/\\b(?:LIKE|GLOB)\\b/),"reference chunk queries avoid LIKE/GLOB"],
  [!editor.includes('rpc("saveAreaMapReference"')&&!enh.includes('rpc("saveAreaMapReference"'),"no monolithic reference-image upload remains"],
  [enh.includes("navigator.share")&&enh.includes("ClipboardItem"),"share/copy image exists"],
  [enh.includes("jspdf")&&enh.includes("rsdMapExportPdf"),"PDF export exists"],
  [enh.includes("qrAreaModal"),"map QR shortcut exists"],
  [!enh.includes("rsdMapAddDecoration")&&!enh.includes("saveAreaMapDecorations"),"obsolete decoration layer is removed"],
  [ops.includes('rpc("mapStatus"'),"daily control uses centralized map status"],
  [core.includes('rpc("mapStatus"'),"admin dashboard uses centralized map status"],
  [inspector.includes('rpc("mapStatus"'),"inspector/teacher maps use centralized map status"],
  [admin.includes('rpc("mapStatus"'),"executive dashboard uses centralized map status"],
  [index.includes('<script src="/map-enhancements.js"></script>'),"map enhancement script is loaded"],
  [sw.includes('"/map-enhancements.js"'),"map enhancement script is cached by service worker"],
  [/const CACHE="rsd-clean-v2-shell-\d+"/.test(sw),"service worker cache version is valid"]
];

for(const [pass,label] of checks)pass?ok(label):fail(label);

if(process.exitCode)process.exit(process.exitCode);
console.log("\nRSD Clean quality checks passed.");
