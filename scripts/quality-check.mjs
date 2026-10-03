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
const ops=read("web/operations.js");
const index=read("web/index.html");
const sw=read("web/sw.js");

const checks=[
  [api.includes("async function mapStatus(env,u,p)"),"central mapStatus API exists"],
  [api.includes('role(u,["Admin","Supervisor","Inspector","Teacher"])'),"map read roles include all required viewers"],
  [api.includes("async function saveAreaMapReference")&&api.includes("async function areaMapReference"),"shared map reference API exists"],
  [api.includes("i.status===\"รอตรวจ\"&&!byArea.has(i.area_id)"),"stale pending duty cleanup exists"],
  [editor.includes("async function areaMapExportImage"),"base PNG export exists"],
  [enh.includes("function rsdMapUndo")&&enh.includes("function rsdMapRedo"),"map undo/redo exists"],
  [enh.includes("map-vertex-handle")&&enh.includes("map-vertex-add")&&enh.includes("map-vertex-delete"),"polygon vertex editing exists"],
  [enh.includes("function rsdEnsureMapReference")&&enh.includes("AREA_MAP_REFERENCE_VERSION_KEY"),"shared reference version cache exists"],
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
