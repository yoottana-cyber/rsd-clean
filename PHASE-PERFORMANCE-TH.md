# Performance Phase — RSD Clean

รอบนี้ปรับประสิทธิภาพโดยไม่เปลี่ยนหน้าตาและรูปแบบข้อมูลหลัก

## สิ่งที่ปรับ

### 1. Daily Sync ทำเพียงเมื่อจำเป็น
เดิม `ensureToday()` มีโอกาสวนตรวจพื้นที่และทีมผู้ตรวจซ้ำทุกครั้งที่หลาย API ถูกเรียก

รุ่นใหม่ใช้ `settings.today_sync_marker`:
- วันเดียวกันและเวรไม่เปลี่ยน → ข้ามการสร้าง/Sync งานซ้ำ
- เมื่อแก้ Users / Classrooms / Areas / Assignments / Holidays / Bulk import / Restore → marker ถูกล้าง
- งานวันนี้จะ Sync ใหม่เฉพาะเมื่อจำเป็น
- การสร้างและ Sync ใช้ D1 batch เป็นชุด

### 2. ตัด N+1 Query ของงานผู้ตรวจ
เดิมรายการงานแต่ละงานไปอ่านทีมผู้ตรวจเพิ่มทีละรายการ

รุ่นใหม่:
- อ่านงานของผู้ตรวจ 1 query
- อ่านทีมของทุกงาน 1 query
- ประกอบข้อมูลใน Worker

ดังนั้นจำนวน query ไม่โตตามจำนวนพื้นที่แบบเดิม

### 3. Dashboard / Report อ่านเฉพาะช่วงวันที่
เดิม Dashboard และ Report โหลด inspections จำนวนมากแล้วค่อยกรองใน JavaScript

รุ่นใหม่:
- Dashboard อ่านวันที่เลือกย้อนหลัง 30 วัน
- Report อ่านเฉพาะ start → end
- เกียรติบัตรอ่านเฉพาะเดือนที่เกี่ยวข้อง

ใช้ index `idx_inspections_date` ที่มีอยู่แล้ว

### 4. Inspector Home รวม API
หน้า "งานตรวจวันนี้" เปลี่ยนจากการเรียกแยก:
- tasks
- myRewards
- notifications

เป็น `inspectorHome` สำหรับข้อมูลหลักใน request เดียว และ reuse ข้อมูลแจ้งเตือนช่วงสั้นเพื่อลด request ซ้ำ

### 5. บันทึกผลตรวจตอบกลับเร็วขึ้น
การคำนวณ Rewards ทั้งระบบถูกย้ายไปทำผ่าน `waitUntil` หลังบันทึกผลตรวจสำเร็จ
ผู้ตรวจไม่ต้องรอการคำนวณรางวัลทั้งหมดก่อนหน้า UI ตอบกลับ

### 6. ลดการตรวจ Auto Backup ซ้ำ
ใน Worker instance เดียวกัน ระบบจำว่าได้ตรวจ Auto Backup ของวันนั้นแล้ว เพื่อลด D1 query ซ้ำ

## สิ่งที่ไม่ได้เปลี่ยน
- D1 schema หลักของผลตรวจ
- QR
- Offline Sync
- Backup / Restore
- Audit Log
- เกณฑ์รางวัลและเกียรติบัตร
- UI / Mobile Navigation

## หมายเหตุ
ผลความเร็วจริงขึ้นกับเครือข่าย อุปกรณ์ จำนวนข้อมูล และ Cloudflare/Google Drive latency ควรวัดจากการใช้งานจริงก่อนและหลัง deployment
