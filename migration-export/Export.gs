/** เพิ่มไฟล์นี้ใน Apps Script ระบบเดิม แล้ว Run exportForD1Migration() เพียงครั้งเดียว */
function exportForD1Migration(){
  const p=PropertiesService.getScriptProperties(),ssid=p.getProperty('SPREADSHEET_ID');
  if(!ssid)throw Error('ไม่พบ SPREADSHEET_ID');
  const ss=SpreadsheetApp.openById(ssid),names=['Users','Classrooms','Areas','Assignments','Inspections','RewardsLog'],tables={};
  names.forEach(name=>{const sh=ss.getSheetByName(name);if(!sh)throw Error('ไม่พบชีต '+name);const v=sh.getDataRange().getDisplayValues();const h=v.shift()||[];tables[name]=v.filter(r=>r.some(x=>String(x)!=='')).map(r=>Object.fromEntries(h.map((k,i)=>[k,String(r[i]??'')])));});
  const bundle={format:'rsd-clean-d1-migration-v1',createdAt:new Date().toISOString(),tables,holidays:JSON.parse(p.getProperty('HOLIDAYS')||'[]')};
  const blob=Utilities.newBlob(JSON.stringify(bundle,null,2),'application/json','RSD-Clean-D1-export.json');
  const file=DriveApp.createFile(blob);console.log('Export file: '+file.getUrl());console.log('ดาวน์โหลดไฟล์ JSON แล้วใช้หน้า /migrate.html ในระบบ D1');return file.getId();
}
function showD1Pepper(){
  const p=PropertiesService.getScriptProperties(),pepper=p.getProperty('PEPPER');if(!pepper)throw Error('ไม่พบ PEPPER');
  console.log('PEPPER พร้อมใช้งานแล้ว (ระบบจะไม่แสดงค่า Secret ใน Log)');
  return true;
}
