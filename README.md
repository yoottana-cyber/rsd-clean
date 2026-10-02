# RSD Clean v2.1 — Cloudflare D1 Edition

ระบบตรวจความสะอาดและให้คะแนนเขตพื้นที่โรงเรียนรัษฎา

## สถาปัตยกรรม

```text
PWA / HTML
   ↓
Cloudflare Pages + Pages Functions
   ↓
Cloudflare D1
   ↓ เฉพาะรูปหลักฐาน
Google Apps Script Drive Gateway
   ↓
Google Drive
```

## โครงสร้าง repo

- `web/` หน้า PWA
- `functions/api.js` API หลัก
- `functions/migrate.js` API ย้ายข้อมูล
- `schema.sql` โครงสร้างฐานข้อมูล D1
- `drive-gateway/` Apps Script สำหรับอัปโหลด/อ่านรูป Google Drive
- `migration-export/` ตัวช่วย export ข้อมูลจากระบบ Google Sheets เดิม
- `DEPLOY-D1-TH.md` คู่มือติดตั้ง
- `MIGRATE-FROM-SHEETS-TH.md` คู่มือย้ายข้อมูล

## Cloudflare Pages (GitHub Integration)

ตั้งค่า Pages project ดังนี้:

- Production branch: `main`
- Root directory: เว้นว่าง
- Build command: `exit 0`
- Build output directory: `web`

Bindings / Variables:

- D1 binding: `DB`
- Secret: `RSD_PEPPER`
- Secret: `MIGRATION_SECRET`
- Variable/Secret: `GAS_DRIVE_URL`
- Secret: `DRIVE_GATEWAY_KEY`

ก่อนเปิดใช้งานให้รัน `schema.sql` เข้า D1 และทำ Acceptance Test ตามคู่มือ


## Audit Log + Backup

ระบบมี Audit Log, ดาวน์โหลด Backup จากหน้า Admin และ Backup D1 อัตโนมัติวันละครั้งไป Google Drive ผ่าน Drive Gateway

อ่านรายละเอียด: `AUDIT-BACKUP-TH.md`
