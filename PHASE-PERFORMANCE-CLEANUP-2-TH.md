# Performance Cleanup Phase 2 — RSD Clean

รอบนี้ปรับเพื่อการใช้งานจริงที่ **ไม่ใช้รูปหลักฐานเป็นหลัก** และลดงานที่ไม่จำเป็นใน request ปกติ

## 1) Photo-free fast path

เพิ่ม setting:

`photoEvidenceEnabled`

ค่าเริ่มต้น = `false`

เมื่อปิด:
- แบบตรวจไม่แสดงช่องแนบรูป
- ไม่เรียก `uploadStart`
- ไม่เริ่ม Google Drive upload
- Offline queue ไม่เก็บ/อัปโหลดรูปใหม่
- API ปฏิเสธการเริ่ม upload หาก photo mode ถูกปิด

รูปเก่าที่ยังมีอยู่ยังเปิดดูได้ตามสิทธิ์เดิม

Admin เปิดกลับได้ที่:

**จัดการข้อมูล → ตั้งค่าระบบ → เปิดการแนบรูปหลักฐาน**

## 2) System Status ไม่รอ Google Drive

เดิม `systemStatus` รอ Drive Gateway ได้สูงสุด 15 วินาที

ใหม่:
- D1 / Backup / Monitor แสดงก่อนทันที
- Drive Gateway ตรวจผ่าน API `driveStatus` แยกต่างหาก
- หน้า Status ไม่ถูก Drive block
- Drive health cache 60 วินาที
- timeout เหลือ 8 วินาที
- latency ของ `driveStatus` ไม่ถูกนับเป็น Slow API เพราะเป็น external dependency ที่ตั้งใจตรวจแยก

## 3) System Status ลด D1 round trips

จำนวนข้อมูลหลายตารางใช้ D1 `batch()` แทนการ query ทีละตาราง

ข้อมูล:
- counts
- backup settings
- last inspection
- last audit
- monitor 24h

โหลดแบบ parallel

Schema ensure functions มี in-memory ready flag ต่อ Worker instance ลด `CREATE TABLE IF NOT EXISTS` ซ้ำ

## 4) Notifications ใช้ SQL aggregation

เดิมมีบางส่วนโหลด inspection หลายร้อยแถวขึ้น Worker แล้ว parse `meta_json`

ใหม่ใช้:
- `COUNT`
- `GROUP BY`
- `HAVING`
- SQLite `json_extract`

ใน D1 โดยตรง

ผล:
- payload จาก D1 เล็กลง
- parsing ใน Worker ลดลง
- notification cache เพิ่มจาก 15 เป็น 30 วินาที
- Recycle notification ไม่สั่ง DELETE ทุกครั้งที่เช็ก badge

## 5) Dashboard ลด query

Dashboard ทั่วไปไม่โหลด `inspection_inspectors` เพราะไม่ได้ใช้ข้อมูลทีมผู้ตรวจในกราฟ

จึงอ่านเฉพาะ `inspections` ในช่วง 30 วันที่ต้องใช้

## 6) Teacher page แก้ N+1 query

เดิม:
- โหลด inspections ทั้งหมด
- โหลดทีม inspector ทั้งหมด
- แล้วเรียกทีมผู้ตรวจทีละ inspection สูงสุด 200 ครั้ง

ใหม่:
- query เฉพาะห้องของ Teacher
- จำกัด 200 รายการล่าสุด
- query ทีมผู้ตรวจครั้งเดียวสำหรับ inspection ที่เลือก
- query rewards และเดือนปัจจุบันแบบ parallel

## 7) Lazy-load libraries

เอา library ที่ไม่จำเป็นตอนเปิดแอปออกจาก initial HTML:
- Chart.js
- QRCode.js
- html5-qrcode
- jsQR

โหลดเฉพาะเมื่อ:
- เปิด Dashboard/Report/History → Chart.js
- เปิดเครื่องมือสร้าง QR → QRCode.js
- กดสแกน QR → html5-qrcode + jsQR

ช่วยลด JavaScript ที่มือถือทุกเครื่องต้องโหลดตอนเริ่มต้น

## สิ่งที่ยังใช้ Google Drive

แม้ปิดรูปหลักฐาน Google Drive Gateway ยังใช้สำหรับ:
- Backup
- Restore safety backup
- รูปเก่าที่มีอยู่แล้ว

แต่ไม่อยู่ในเส้นทางบันทึกผลตรวจปกติ
