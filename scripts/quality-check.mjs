import fs from "node:fs";

const files=[
  "functions/api.js",
  "functions/migrate-api.js",
  "functions/health.js",
  "functions/school-logo.js",
  "drive-gateway/Code.gs",
  "migration-export/Export.gs",
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
    if(path.startsWith("functions/"))src=src.replace(/^\s*export\s+/gm,"");
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
const migrate=read("functions/migrate-api.js");
const driveGateway=read("drive-gateway/Code.gs");
const migrationExport=read("migration-export/Export.gs");

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
  [api.includes("function currentInspectionLabels")&&api.includes("async function currentInspectionNameMaps")&&api.includes("AreaName:label.AreaName")&&api.includes("พื้นที่:label.AreaName"),"historical views resolve current master names"],
  [api.includes("async function applyCurrentInspectionNames")&&api.includes("await applyCurrentInspectionNames(db,ins)")&&api.includes("await applyCurrentInspectionNames(env.DB,ins)"),"leaderboards and certificates use current master names"],
  [api.includes('"deleteInspection"].includes(action)')&&api.includes('action === "restoreTrash" && data?.entityType === "Inspections"'),"inspection delete/restore rebuilds rewards"],
  [api.includes("async function fakeCredentialSalt")&&api.includes('/^[a-f0-9]{32}$/.test(String(c.salt||""))'),"unknown usernames receive indistinguishable PBKDF2 salt shape"],
  [api.includes("async function deleteInspection")&&api.includes('"Inspections",id,recycleLabel("Inspections",snapshot)')&&api.includes('type==="Inspections"'),"recoverable inspection deletion exists"],
  [api.includes('assert(String(row.inspection_date)<thaiDay()')&&api.includes('["ตรวจแล้ว","งดตรวจ"].includes'),"inspection deletion is limited to completed historical records"],
  [coverage.includes("รายงาน อันดับ และเกียรติบัตรของเดือนนั้นเปลี่ยนแปลง"),"inspection delete warning mentions award recalculation"],
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
  [inspector.includes("function wireInspectorTaskQuickNav")&&inspector.includes('id="task-jump-map"')&&inspector.includes('id="task-jump-top"'),"inspector task page has smart map/top quick navigation"],
  [read("web/style.css").includes(".task-float-nav")&&read("web/style.css").includes("bottom:calc(91px + env(safe-area-inset-bottom))"),"inspector quick navigation clears the mobile bottom bar"],
  [admin.includes('rpc("mapStatus"'),"executive dashboard uses centralized map status"],
  [core.includes("async function ensureRouteModules(route)")&&core.includes('["/map-enhancements.js",()=>typeof window.rsdEnsureMapReference==="function"]'),"feature modules are lazy-loaded by route"],
  [!index.includes("cdn.tailwindcss.com")&&read("web/style.css").includes("Minimal utility layer"),"production UI uses local utility CSS instead of Tailwind browser CDN"],
  [!index.includes("fonts.googleapis.com")&&!read("web/style.css").includes("fonts.googleapis.com")&&index.includes("fontsource-kanit@4.0.0")&&index.includes("fontsource-sarabun@4.0.0"),"app fonts use Fontsource instead of Google Fonts"],
  [admin.includes('fontsource-kanit@4.0.0/thai.css')&&admin.includes('html,body,button{font-family:"Kanit"')&&!admin.includes('font-family:Arial,"Noto Sans Thai"'),"QR display and print pages use Kanit"],
  [admin.includes('id="print-qr-page"')&&admin.includes('printButton.addEventListener("click"')&&!admin.includes('onclick="window.print()"'),"QR print action is CSP-safe without inline handlers"],
  [read("web/style.css").includes('.qr-panel,.qr-scan-panel{text-align:center;font-family:"Kanit"'),"QR modal and scanner explicitly inherit Kanit"],
  [read("web/_headers").includes("style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net data:"),"CSP permits Fontsource styles and font files"],
  [read("web/_headers").includes("https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com"),"CSP permits trusted CDN source-map connections"],
  [index.includes('<script src="/core.js"></script>')&&!index.includes('<script src="/admin.js"></script>')&&!index.includes('<script src="/operations.js"></script>'),"startup HTML loads only the core app bundle"],
  [sw.includes("TRUSTED_RUNTIME_ORIGINS")&&sw.includes("staleWhileRevalidate(RUNTIME,req)"),"trusted CDN and font dependencies have runtime offline cache"],
  [sw.includes('const CERT_CACHE="rsd-certificate-template-v1"')&&sw.includes("k!==CERT_CACHE"),"certificate template cache survives service-worker upgrades"],
  [migrate.includes("ปิดการแทนที่ข้อมูลผ่านหน้า Migration แล้ว")&&migrate.includes("async function clearImported"),"migration cannot erase a populated D1 and rolls back partial imports"],
  [!driveGateway.includes("DRIVE_GATEWAY_KEY='+p.getProperty")&&!migrationExport.includes("RSD_PEPPER='+pepper"),"setup scripts do not print secrets to logs"],
  [/const CACHE="rsd-clean-v2-shell-\d+"/.test(sw),"service worker cache version is valid"]
];

for(const [pass,label] of checks)pass?ok(label):fail(label);

if(process.exitCode)process.exit(process.exitCode);
console.log("\nRSD Clean quality checks passed.");
