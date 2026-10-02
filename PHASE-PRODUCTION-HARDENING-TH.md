# Production Hardening Phase — RSD Clean

รอบนี้เพิ่มชั้นความปลอดภัยและมอนิเตอร์สำหรับการใช้งานจริง โดยไม่เปลี่ยนวิธีใช้งานของผู้ตรวจ/ครู

## 1) Rate Limit

Cloudflare Pages Function มี rate limit ชั้นแอปแบบ in-memory ต่อ Worker instance:

- Login: 8 ครั้ง / 5 นาที ต่อ IP + Username
- Login รวมต่อ IP: 120 ครั้ง / 5 นาที
- Challenge: 30 ครั้ง / 5 นาที ต่อ IP + Username
- Public Dashboard: 90 ครั้ง / นาที ต่อ IP
- API ที่มี Session: 180 ครั้ง / นาที ต่อ Session
- Anonymous API: 60 ครั้ง / นาที ต่อ IP

เมื่อเกินกำหนด API ตอบ HTTP 429 และหน้าเว็บจะแสดงข้อความจาก API

> หมายเหตุ: ชั้นนี้ช่วยป้องกัน abuse เบื้องต้น แต่ไม่ใช่ global distributed rate limit เพราะ Worker แต่ละ instance มี memory แยกกัน หากต้องการป้องกันระดับ edge ทั้งหมด ควรเสริม Cloudflare WAF / Rate Limiting Rule ใน Dashboard

## 2) Error / Slow / Security Monitor

เพิ่มตาราง `system_events` สำหรับเก็บเฉพาะเหตุการณ์สำคัญ:

- `error` — server error และ browser error ที่ไม่ใช่ validation ปกติ
- `slow` — API ที่ใช้เวลาตั้งแต่ 1,200 ms
- `security` — rate limit ถูกเรียกเกิน

Admin เข้า:

**จัดการข้อมูลระบบ → มอนิเตอร์ระบบ**

ข้อมูลเก็บย้อนหลัง 30 วัน และไม่บันทึก:
- Password
- Session token
- QR token
- Request payload
- ข้อมูลฟอร์ม

IP ไม่ถูกเก็บตรง ๆ ระบบเก็บเพียง HMAC hash แบบย่อสำหรับ correlation ภายในเท่านั้น

Browser error ถูก deduplicate ต่อข้อความ/หน้า 60 วินาที เพื่อลด log ซ้ำ

## 3) System Status

หน้า **สถานะระบบ** เพิ่มตัวเลขย้อนหลัง 24 ชั่วโมง:

- Error
- Slow API
- Security events

หากมี Error ใน 24 ชั่วโมงล่าสุด ระบบจะแสดง warning

## 4) Health Check

เพิ่ม endpoint:

`GET /health`

ตอบข้อมูลขั้นต่ำ เช่น:

```json
{
  "ok": true,
  "service": "RSD Clean",
  "db": "ok",
  "time": "...",
  "responseMs": 12
}
```

ไม่เปิดเผยจำนวนผู้ใช้ ชื่อฐานข้อมูล Secret หรือข้อมูลภายใน

ผลตรวจ health ถูก cache ใน memory 10 วินาทีต่อ Worker instance เพื่อลด D1 reads

## 5) Security Headers

เพิ่ม:

- HSTS
- X-Frame-Options: DENY
- X-Content-Type-Options
- Referrer-Policy
- Permissions-Policy
- Cross-Origin-Opener-Policy
- X-Permitted-Cross-Domain-Policies
- Content-Security-Policy-Report-Only

CSP เริ่มแบบ **Report-Only** เพื่อไม่ให้ CDN/QR/กล้อง/PWA ที่ใช้อยู่หยุดทำงานทันที ก่อนย้าย library สำคัญมา self-host ในอนาคต

## 6) Migration Endpoint

`/migrate-api` ถูกปิดเป็นค่าเริ่มต้นแล้ว

หากจำเป็นต้องย้ายข้อมูลอีกครั้ง ต้องตั้ง Cloudflare variable:

`MIGRATION_ENABLED=true`

เมื่อเสร็จให้ลบ variable หรือเปลี่ยนเป็น false ทันที

## 7) Secret Hygiene

เพิ่ม `.gitignore` ป้องกันไฟล์:

- `.dev.vars`
- `.env*`
- `wrangler.toml`
- `wrangler.json/jsonc`
- local tooling/log files

`wrangler.jsonc.example` ยังคงเก็บได้เพราะมีเพียง placeholder

### ตรวจ current main branch
จากไฟล์ที่อยู่ใน main ปัจจุบัน:
- ไม่พบค่า RSD_PEPPER จริง
- ไม่พบ DRIVE_GATEWAY_KEY จริง
- ไม่พบ MIGRATION_SECRET จริง
- ไม่พบ Private Key / Google API key literal
- Google Apps Script ใช้ Script Properties สำหรับ secrets

การตรวจนี้ครอบคลุม source ปัจจุบัน ไม่ใช่การรับรองว่า Git history จากทุก commit ไม่เคยมี secret หากเคย commit secret จริง ต้อง rotate secret และล้าง history เพิ่มเติม

## 8) Server Timing

API response เพิ่ม header:

`Server-Timing: app;dur=<milliseconds>`

ใช้ดูเวลา backend จาก Browser DevTools ได้โดยไม่เพิ่ม request ใหม่
