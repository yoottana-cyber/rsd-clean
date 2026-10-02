# ติดตั้ง RSD Clean v2.1 D1 แบบ GitHub + Cloudflare Pages

## 1. สร้าง D1 และ Schema

สร้าง D1 database ชื่อแนะนำ `rsd-clean`

จากเครื่องที่ติดตั้ง Node.js/Wrangler:

```bash
npx wrangler login
npx wrangler d1 execute rsd-clean --remote --file=./schema.sql
```

ถ้าต้องการใช้ Wrangler config ให้คัดลอก `wrangler.jsonc.example` เป็น `wrangler.jsonc` แล้วใส่ database_id จริงก่อนใช้งาน

## 2. ตั้ง Cloudflare Pages จาก GitHub

เชื่อม repo นี้กับ Cloudflare Pages แล้วตั้ง:

- Production branch: `main`
- Root directory: เว้นว่าง
- Build command: `exit 0`
- Build output directory: `web`

Cloudflare จะอ่าน `functions/` ที่ root เป็น Pages Functions อัตโนมัติ

## 3. ผูก D1 Binding

Workers & Pages → rsd-clean → Settings → Bindings → D1 database

- Variable name: `DB`
- D1 database: `rsd-clean`

## 4. ตั้ง Secrets / Variables

ตั้ง Production secrets/variables:

- `RSD_PEPPER` = ค่า PEPPER เดิม เพื่อให้รหัสผ่านและ QR เดิมใช้ต่อได้
- `MIGRATION_SECRET` = สุ่มยาว 32–64 ตัว
- `GAS_DRIVE_URL` = URL /exec ของ Drive Gateway
- `DRIVE_GATEWAY_KEY` = key จาก Drive Gateway

## 5. ตั้ง Google Drive Gateway

1. เปิด script.google.com → New project
2. วาง `drive-gateway/Code.gs`
3. เปิด manifest แล้ววาง `drive-gateway/appsscript.json`
4. เพิ่ม Drive API v3
5. Run `driveGatewaySetup`
6. เก็บ `DRIVE_GATEWAY_KEY`
7. Deploy เป็น Web app:
   - Execute as: Me
   - Who has access: Anyone
8. เก็บ URL /exec เป็น `GAS_DRIVE_URL`

## 6. Deploy

เมื่อ Pages เชื่อม GitHub แล้ว เพียง push/commit เข้า `main` Cloudflare จะ deploy อัตโนมัติ

ถ้าจะ deploy ด้วย Wrangler แทน:

```bash
npx wrangler pages deploy ./web --project-name=rsd-clean
```

## 7. ย้ายข้อมูลเดิม

ทำตาม `MIGRATE-FROM-SHEETS-TH.md`

หน้า migration:

```text
https://rsd-clean.pages.dev/migrate.html
```

หรือเปิด `/migrate` ซึ่งจะ redirect ไปหน้า migration

## 8. Acceptance Test

1. Login Admin ด้วยบัญชีเดิม
2. ตรวจผู้ใช้ ห้องเรียน พื้นที่
3. ตรวจเวร จ.–ศ.
4. Login Inspector และโหลดงานวันนี้
5. สแกน QR เดิม/ใหม่
6. ผู้ไม่มีเวรต้องเปิดงานพื้นที่นั้นไม่ได้
7. บันทึกคะแนน 3/2/1
8. อัปโหลดรูป Google Drive
9. Teacher เห็นเฉพาะห้องตนเอง
10. Report/เหรียญรายเดือนตรงกับระบบเดิม
11. Remember Login ยังทำงาน
12. ผู้ตรวจหลายคนในพื้นที่เดียวกันเห็นงานเดียวกัน

หลังย้ายสำเร็จควรเปลี่ยนหรือลบ `MIGRATION_SECRET`
