# Tournament Ranking

เว็บสำหรับเก็บสถิติและจัดอันดับ (Ranking) ทีมและผู้เล่นที่ลงแข่งทัวร์นาเมนต์ พร้อม API สำหรับเชื่อมกับเว็บไซต์อื่น

A website for tournament results, team and player rankings, with an API-key–protected REST API so other websites can use the data.

| ส่วน | เทคโนโลยี | ที่อยู่ตอนรันในเครื่อง |
| --- | --- | --- |
| Frontend (`apps/web`) | Next.js 16, React 19, TypeScript, ฟอนต์ Inter + Noto Sans Thai | http://localhost:3000 |
| Backend (`apps/api`) | Node.js, Express 5, TypeScript, Prisma, SQLite | http://localhost:4000 |
| เอกสาร API | OpenAPI 3 + Swagger UI | http://localhost:4000/docs |

## เริ่มใช้งาน

ต้องมี Node.js 22 ขึ้นไป

```bash
npm install
npm run setup   # สร้างฐานข้อมูล, API key ของเว็บ, รหัสผ่านผู้ดูแล และข้อมูลตัวอย่าง
npm run dev     # เปิดทั้ง API และเว็บพร้อมกัน
```

`npm run setup` จะพิมพ์ **รหัสผ่านผู้ดูแล** ออกมา (เก็บไว้ใน `apps/web/.env.local`) ใช้รหัสนี้เข้า http://localhost:3000/admin

ไม่อยากได้ข้อมูลตัวอย่าง: `node scripts/setup.mjs --no-demo` บนฐานข้อมูลว่าง

## ใช้งานอะไรได้บ้าง

**หน้าสาธารณะ**
- Ranking ทีม (Elo rating เริ่มที่ 1000 คำนวณใหม่ทุกครั้งที่มีผลการแข่ง) และ Ranking ผู้เล่น (เรียงตามคะแนน, Kills, KDA, ชนะ ฯลฯ)
- หน้าทีม ผู้เล่น ทัวร์นาเมนต์ (ตารางคะแนน ชนะ 3 เสมอ 1) และผลการแข่งแต่ละแมตช์
- ช่องค้นหาพร้อมปุ่มค้นหาทุกหน้า และ dropdown เลือกทีมที่พิมพ์ค้นหาได้

**หน้าจัดการ (`/admin`)**
- เพิ่ม/แก้/ลบ ทีม ผู้เล่น ทัวร์นาเมนต์ และผลการแข่ง
- ทุกช่องรูป (โลโก้ทีม, รูปผู้เล่น, ภาพผลการแข่ง) **ลากรูปมาวาง, วางด้วย Ctrl+V หรือคลิกเลือกไฟล์ได้**
- บันทึกผลการแข่ง: เลือกทีม แล้วรายชื่อผู้เล่นขึ้นมาให้กรอก Kills / Deaths / Assists / คะแนน ได้ทันที
- **ให้ AI อ่านผลจากภาพหน้าจอ** แล้วกรอกฟอร์มให้ (ต้องตั้ง `ANTHROPIC_API_KEY` ใน `apps/api/.env`) ระบบจะไม่บันทึกเองจนกว่าจะกดยืนยัน ถ้าไม่ตั้ง key ก็พิมพ์กรอกเองได้ตามปกติ
- สร้าง/ยกเลิก API key สำหรับเว็บอื่น

## เชื่อมกับเว็บไซต์อื่น

1. เข้า `/admin/keys` สร้าง key แบบ "อ่านอย่างเดียว"
2. เรียก API โดยส่ง key ใน header `X-API-Key`

```bash
curl -H "X-API-Key: trk_..." http://localhost:4000/api/v1/rankings/teams
```

```js
// ตัวอย่างฝั่งเซิร์ฟเวอร์ของเว็บคุณ (อย่าใส่ key ในโค้ดฝั่งเบราว์เซอร์)
const res = await fetch("https://api.your-domain.com/api/v1/rankings/teams?limit=10", {
  headers: { "X-API-Key": process.env.TOURNAMENT_API_KEY },
});
const { data } = await res.json(); // [{ rank, name, rating, stats: { wins, losses, ... } }, ...]
```

endpoint หลัก: `/api/v1/rankings/teams`, `/api/v1/rankings/players`, `/api/v1/teams`, `/api/v1/players`, `/api/v1/tournaments`, `/api/v1/matches`, `/api/v1/stats/overview`, `/api/v1/stats/search` ดูทั้งหมดพร้อมทดลองยิงได้ที่ `/docs` (ไฟล์ spec: `apps/api/openapi.yaml`)

- key แบบ `read` ใช้ได้เฉพาะ GET ส่วน `admin` เพิ่ม/แก้/ลบได้
- ถ้าจะเรียกจากเบราว์เซอร์โดยตรง ให้ใส่โดเมนเว็บนั้นใน `CORS_ORIGINS` ของ `apps/api/.env`
- สร้าง key จาก command line ได้ด้วย: `npm run key:create -w apps/api -- "ชื่อเว็บ" read`

## การตั้งค่า

`apps/api/.env`

| ตัวแปร | ความหมาย |
| --- | --- |
| `DATABASE_URL` | ฐานข้อมูล (ค่าเริ่มต้น SQLite `file:./dev.db`) |
| `PORT` | พอร์ตของ API (4000) |
| `CORS_ORIGINS` | โดเมนที่เรียก API จากเบราว์เซอร์ได้ คั่นด้วย `,` |
| `UPLOAD_DIR` | โฟลเดอร์เก็บรูปที่อัปโหลด (ค่าเริ่มต้น `uploads`) |
| `ANTHROPIC_API_KEY` | ใส่เพื่อเปิดระบบ AI อ่านผลจากรูป |

`apps/web/.env.local` (สร้างให้อัตโนมัติโดย `npm run setup`)

| ตัวแปร | ความหมาย |
| --- | --- |
| `API_URL` | ที่อยู่ API ที่เว็บเรียก |
| `API_KEY` | API key สิทธิ์ admin ใช้ฝั่งเซิร์ฟเวอร์เท่านั้น |
| `ADMIN_PASSWORD` | รหัสผ่านเข้า `/admin` |
| `SESSION_SECRET` | ใช้เซ็นคุกกี้ล็อกอิน |
| `PUBLIC_API_URL` | ที่อยู่ API สาธารณะสำหรับลิงก์เอกสาร (ถ้าต่างจาก `API_URL`) |
| `COOKIE_SECURE` | ตั้ง `false` เฉพาะกรณีเปิดเว็บแบบ http ธรรมดาบนโปรดักชัน |

## ทดสอบ

```bash
npm test            # เทส API 41 เคส (auth, ranking, สถิติ, อัปโหลดรูป, AI อ่านรูปแบบจำลอง ฯลฯ)
npm run typecheck   # ตรวจ TypeScript ทั้ง API และเว็บ
npm run test:e2e    # เปิดเบราว์เซอร์จริงทดสอบทุกหน้าและทุกฟอร์ม (ต้องรัน npm run dev ไว้ก่อน)
```

ครั้งแรกที่รัน e2e ให้ติดตั้งเบราว์เซอร์: `npx playwright install chromium`

GitHub Actions (`.github/workflows/ci.yml`) รันทั้งหมดนี้ทุกครั้งที่ push

## ขึ้นโปรดักชัน

```bash
npm run build
npm start
```

- SQLite เหมาะกับเริ่มต้นและเครื่องเดียว ถ้าจะขยายให้เปลี่ยน `provider` ใน `apps/api/prisma/schema.prisma` เป็น `postgresql` แล้วตั้ง `DATABASE_URL`
- สำรองไฟล์ฐานข้อมูล (`apps/api/prisma/dev.db`) และโฟลเดอร์ `apps/api/uploads`
- เปลี่ยน `ADMIN_PASSWORD` และ `SESSION_SECRET` เป็นค่าของคุณเอง
