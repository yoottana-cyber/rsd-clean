# ย้ายข้อมูล RSD Clean เดิมจาก Google Sheets → Cloudflare D1

## 1. Export จาก Apps Script เดิม

ในโปรเจกต์ Apps Script ระบบเดิม:

1. เพิ่มไฟล์ Script ใหม่ เช่น `ExportD1.gs`
2. วางโค้ดจาก `migration-export/Export.gs`
3. Run `exportForD1Migration`
4. Execution log จะแสดงลิงก์ไฟล์ `RSD-Clean-D1-export.json`
5. ดาวน์โหลดไฟล์ JSON ลงเครื่อง

## 2. ใช้ PEPPER เดิม

Run:

```text
showD1Pepper
```

แล้วนำค่าหลัง `RSD_PEPPER=` ไปตั้ง Secret `RSD_PEPPER` ใน Cloudflare

ค่านี้ทำให้รหัสผ่านเดิมและ QR เดิมใช้ต่อได้

## 3. Import เข้า D1

เปิด:

```text
https://ชื่อเว็บ.pages.dev/migrate.html
```

1. เลือกไฟล์ export JSON
2. กรอก `MIGRATION_SECRET`
3. ครั้งแรกไม่ต้องเลือกแทนที่ข้อมูลเดิม
4. กดเริ่มย้ายข้อมูล

## 4. นำเข้าใหม่

ถ้าจำเป็นให้เลือก “แทนที่ข้อมูล D1 เดิมทั้งหมด” ก่อนนำเข้าใหม่

คำเตือน: โหมดนี้จะลบข้อมูลปัจจุบันใน D1 ก่อนนำเข้า

## 5. หลังย้ายเสร็จ

- Login ด้วยบัญชีเดิม
- ตรวจ QR เดิม
- ทดสอบบันทึกผลตรวจ
- ทดสอบรูป Drive
- ลบไฟล์ export เมื่อไม่ใช้แล้ว
- เปลี่ยนหรือลบ `MIGRATION_SECRET`
