/** RSD Clean v2.1 D1 — Google Drive Gateway
 * เก็บเฉพาะงาน Drive: เริ่ม resumable upload, ตรวจไฟล์, thumbnail proxy, trash
 * ฐานข้อมูลหลักอยู่ Cloudflare D1
 */
const DG = Object.freeze({ MAX_IMAGE: 100 * 1024 * 1024 });
function doGet(){return ContentService.createTextOutput(JSON.stringify({ok:true,service:'RSD Clean Drive Gateway',time:new Date().toISOString()})).setMimeType(ContentService.MimeType.JSON);}
function doPost(e){
  try{
    const body=JSON.parse((e&&e.postData&&e.postData.contents)||'{}');
    const p=PropertiesService.getScriptProperties();
    if(!body.gatewayKey || body.gatewayKey!==p.getProperty('DRIVE_GATEWAY_KEY')) throw Error('DRIVE_GATEWAY_DENIED');
    const action=String(body.action||''), x=body.payload||{};
    const handlers={uploadStart:()=>uploadStart_(x),verifyUpload:()=>verifyUpload_(x),consumeUpload:()=>consumeUpload_(x),photo:()=>photo_(x),trashFiles:()=>trashFiles_(x)};
    if(!handlers[action]) throw Error('ไม่พบ Drive API');
    return out_({ok:true,data:handlers[action]()});
  }catch(err){console.error(err);return out_({ok:false,error:err.message||String(err)});}
}
function out_(x){return ContentService.createTextOutput(JSON.stringify(x)).setMimeType(ContentService.MimeType.JSON);}
function props_(){return PropertiesService.getScriptProperties();}
function cfg_(k){const v=props_().getProperty(k);if(!v)throw Error('ยังไม่ได้ตั้งค่า '+k);return v;}
function id_(){return Utilities.getUuid();}
function uploadStart_(p){
  const origin=String(p.origin||'');
  if(!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin) && !/^https:\/\/[a-z0-9-]+\.googleusercontent\.com$/i.test(origin)) throw Error('ต้นทางอัปโหลดต้องเป็น HTTPS');
  const mime=String(p.mime||''),size=Number(p.size),inspectionId=String(p.inspectionId||''),userId=String(p.userId||'');
  if(!['image/jpeg','image/png','image/webp'].includes(mime)) throw Error('รองรับ JPG PNG WebP');
  if(!Number.isInteger(size)||size<=0||size>DG.MAX_IMAGE) throw Error('รูปภาพต้องไม่เกิน 100 MB');
  if(!inspectionId||!userId) throw Error('ข้อมูลอัปโหลดไม่ครบ');
  const ticket=id_(),fileId=Drive.Files.generateIds({count:1,space:'drive',type:'files'}).ids[0];
  const res=UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',{method:'post',contentType:'application/json',headers:{Origin:origin,Authorization:'Bearer '+ScriptApp.getOAuthToken(),'X-Upload-Content-Type':mime,'X-Upload-Content-Length':String(size)},payload:JSON.stringify({id:fileId,name:inspectionId+'_'+ticket+'.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[mime]),mimeType:mime,parents:[cfg_('PHOTO_FOLDER_ID')],appProperties:{ticket,inspection:inspectionId,user:userId}}),muteHttpExceptions:true});
  if(res.getResponseCode()!==200) throw Error('เริ่มอัปโหลดไม่สำเร็จ: '+res.getResponseCode());
  const h=res.getAllHeaders(),url=h.Location||h.location;if(!url)throw Error('ไม่ได้รับ Upload URL');
  props_().setProperty('upload:'+ticket,JSON.stringify({fileId,size,mime,inspectionId,userId,exp:Date.now()+3600000}));
  return {ticket,url,fileId};
}
function verifyUpload_(p){
  const ticket=String(p.ticket||''),t=JSON.parse(props_().getProperty('upload:'+ticket)||'null');
  if(!t||t.exp<Date.now())throw Error('สิทธิ์อัปโหลดหมดอายุ');
  if(t.fileId!==String(p.fileId)||t.inspectionId!==String(p.inspectionId)||Number(t.size)!==Number(p.size)||t.mime!==String(p.mime))throw Error('ข้อมูลอัปโหลดไม่ตรง');
  const f=Drive.Files.get(t.fileId,{fields:'id,size,mimeType,parents,trashed,appProperties'});
  if(f.trashed||Number(f.size)!==Number(t.size)||f.mimeType!==t.mime||!(f.parents||[]).includes(cfg_('PHOTO_FOLDER_ID'))||f.appProperties?.ticket!==ticket)throw Error('ไฟล์ยังไม่สมบูรณ์หรือไม่ถูกต้อง');
  return true;
}
function consumeUpload_(p){const ticket=String(p.ticket||'');if(ticket)props_().deleteProperty('upload:'+ticket);return true;}
function photo_(p){
  const id=String(p.fileId||'');if(!id)throw Error('ไม่พบไฟล์');
  const f=Drive.Files.get(id,{fields:'thumbnailLink'});if(!f.thumbnailLink)throw Error('Drive กำลังสร้างภาพย่อ กรุณาลองใหม่');
  const res=UrlFetchApp.fetch(f.thumbnailLink,{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
  if(res.getResponseCode()!==200)throw Error('โหลดภาพย่อไม่สำเร็จ');
  const b=res.getBlob();if(b.getBytes().length>2*1024*1024)throw Error('ภาพย่อใหญ่เกินกำหนด');
  return 'data:'+b.getContentType()+';base64,'+Utilities.base64Encode(b.getBytes());
}
function trashFiles_(p){
  const ids=Array.isArray(p.fileIds)?p.fileIds.slice(0,20):[];ids.forEach(id=>{try{DriveApp.getFileById(String(id)).setTrashed(true);}catch(e){console.warn(e.message)}});return true;
}
function driveGatewaySetup(){
  const p=props_();
  if(!p.getProperty('DRIVE_GATEWAY_KEY'))p.setProperty('DRIVE_GATEWAY_KEY',Utilities.getUuid()+Utilities.getUuid());
  if(!p.getProperty('PHOTO_FOLDER_ID'))p.setProperty('PHOTO_FOLDER_ID',DriveApp.createFolder('RSD-Clean-D1-Photos').getId());
  console.log('DRIVE_GATEWAY_KEY='+p.getProperty('DRIVE_GATEWAY_KEY'));
  console.log('PHOTO_FOLDER_ID='+p.getProperty('PHOTO_FOLDER_ID'));
  console.log('Deploy เป็น Web app: Execute as Me / Anyone แล้วนำ URL /exec ไปตั้ง GAS_DRIVE_URL ใน Cloudflare');
}
