# Audit Log + Backup — RSD Clean D1

## สิ่งที่เพิ่ม

- Audit Log สำหรับการเปลี่ยนแปลงสำคัญ
  - เพิ่ม/แก้/ลบ ผู้ใช้ ห้องเรียน และเขตพื้นที่
  - Bulk Import
  - ตั้งเวรและแก้วันเวร
  - บันทึกผลตรวจ
  - เปลี่ยนรหัสผ่าน (ไม่เก็บรหัสผ่านหรือ credential)
  - แก้วันหยุด
  - ดาวน์โหลด Backup
  - Backup อัตโนมัติ
- หน้า Admin มีปุ่ม **ประวัติการเปลี่ยนแปลง**
- หน้า Admin มีปุ่ม **ดาวน์โหลด Backup**
- Backup อัตโนมัติวันละครั้ง เมื่อมีผู้ใช้ที่ล็อกอินแล้วเข้าใช้งานครั้งแรกของวัน
- Backup ถูกส่งไป Google Drive ผ่าน Drive Gateway เดิม
- โฟลเดอร์ Backup จะเก็บล่าสุด 30 ชุด

## ไม่ต้องสร้าง D1 ใหม่

ตาราง `audit_log` จะถูกสร้างอัตโนมัติเมื่อ API รุ่นใหม่ถูกเรียกครั้งแรก
ข้อมูลเดิมใน D1 ไม่ถูกลบหรือย้าย

`schema.sql` ถูกอัปเดตไว้สำหรับการติดตั้งใหม่ด้วย

## ต้องอัปเดต Drive Gateway 1 ครั้ง

1. เปิด Apps Script ของ Drive Gateway ที่ใช้อยู่
2. แทนที่ `Code.gs` ด้วยไฟล์ `drive-gateway/Code.gs` จาก repo รุ่นล่าสุด
3. Save
4. Deploy → Manage deployments → Edit → New version → Deploy

ไม่ต้องเปลี่ยน:
- `GAS_DRIVE_URL`
- `DRIVE_GATEWAY_KEY`

Gateway รุ่นใหม่เพิ่ม action `saveBackup` และจะสร้างโฟลเดอร์
`RSD-Clean-D1-Backups` อัตโนมัติ

## การทำงานของ Backup อัตโนมัติ

เมื่อมีผู้ใช้ที่ Login แล้วเรียก API ครั้งแรกของวัน:
1. Cloudflare ตรวจว่า Backup ของวันนั้นมีแล้วหรือยัง
2. ถ้ายังไม่มี จะสร้าง JSON จาก D1
3. ส่ง JSON ไป Google Drive
4. บันทึกสถานะใน `settings`
5. เพิ่มรายการ `Backup อัตโนมัติ` ลง Audit Log

งาน Backup ทำผ่าน `waitUntil` เพื่อไม่ให้ผู้ใช้ต้องรอไฟล์ Backup สร้างเสร็จก่อนหน้าเว็บตอบกลับ

หาก Backup ล้มเหลว ระบบจะล้าง marker ของวันนั้นเพื่อให้ลองใหม่ในการเข้าใช้งานครั้งถัดไป

## Backup แบบกดเอง

Admin → จัดการข้อมูลระบบ → **ดาวน์โหลด Backup**

ไฟล์ JSON มีข้อมูลระบบและ password hash ดังนั้น:
- ห้ามอัปโหลดเข้า GitHub สาธารณะ
- ควรเก็บในพื้นที่ที่จำกัดสิทธิ์
- ไม่ควรส่งผ่านช่องทางสาธารณะ

## Audit Log

Admin → จัดการข้อมูลระบบ → **ประวัติการเปลี่ยนแปลง**

ระบบแสดงรายการล่าสุด 200 รายการ พร้อม:
- วันเวลา
- ผู้ดำเนินการ
- บทบาท
- รายการที่ทำ
- ประเภท/รหัสข้อมูล
- รายละเอียดที่ไม่ใช่ข้อมูลลับ

Audit Log ไม่บันทึก:
- รหัสผ่าน
- password proof
- credential
- session token


## Restore จาก Backup

หน้า Admin → **สำรองและกู้คืน**

มี 3 ทางเลือก:

- **Backup ไป Google Drive ตอนนี้** — สร้าง JSON จาก D1 และเก็บในโฟลเดอร์ Backup
- **ดาวน์โหลด Backup ลงเครื่อง** — ดาวน์โหลดไฟล์ JSON มาเก็บเอง
- **กู้คืนจากไฟล์ที่เลือก** — แทนที่ข้อมูล D1 ปัจจุบันด้วยข้อมูลในไฟล์ Backup

ขั้นตอน Restore:

1. เลือกไฟล์ `RSD-Clean-D1-backup-*.json` หรือ Backup อัตโนมัติที่ดาวน์โหลดจาก Google Drive
2. ระบบตรวจรูปแบบไฟล์และแสดงจำนวนข้อมูลก่อน
3. พิมพ์ `RESTORE` เพื่อยืนยัน
4. ระบบสร้าง **Safety Backup ของ D1 ปัจจุบันไป Google Driveก่อนทุกครั้ง**
5. จึงเริ่มกู้คืน users, classrooms, areas, assignments, inspections, inspector teams, rewards, holidays, settings และ audit log
6. Session ปัจจุบันทั้งหมดจะถูกยกเลิก และ Admin ต้อง Login ใหม่หลัง Restore

หากสร้าง Safety Backup ไม่สำเร็จ ระบบจะ **ไม่เริ่ม Restore**

รูปหลักฐานใน Google Drive ไม่ถูกลบหรือคัดลอกใหม่ เพราะ Backup ของ D1 เก็บ Drive file ID เดิมไว้

> ควรเลือกไฟล์จากวันที่ระบบยังทำงานปกติ และไม่ควรแก้ JSON ด้วยมือก่อน Restore
