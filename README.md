# Tournament Ranking

เว็บสำหรับเก็บสถิติและจัดอันดับ (Ranking) ทีมและผู้เล่นที่ลงแข่งทัวร์นาเมนต์ พร้อม API สำหรับเชื่อมกับเว็บไซต์อื่น

A website for tournament results, team and player rankings, with an API-key–protected REST API so other websites can use the data.

| ส่วน | เทคโนโลยี | ที่อยู่ตอนรันในเครื่อง |
| --- | --- | --- |
| Frontend (`apps/web`) | Next.js 16, React 19, TypeScript, ฟอนต์ IBM Plex Sans Thai Looped, ธีมขาว แดง ดำ | http://localhost:3000 |
| Backend (`apps/api`) | Node.js, Express 5, TypeScript, Prisma, SQLite | http://localhost:4000 |
| บอท Discord (`apps/bot`) | discord.js 14 | ใน Discord ของคุณ |
| เอกสาร API | OpenAPI 3 + Swagger UI | http://localhost:4000/docs |

## เริ่มใช้งาน

ต้องมี Node.js 22 ขึ้นไป

```bash
npm install
npm run setup   # สร้างฐานข้อมูล, API key ของเว็บและบอท, รหัสผ่านผู้ดูแล และข้อมูลตัวอย่าง
npm run dev     # เปิด API เว็บ และบอทพร้อมกัน (บอทจะรอจนกว่าจะใส่ DISCORD_TOKEN)
```

`npm run setup` จะพิมพ์ **รหัสผ่านผู้ดูแล** ออกมา (เก็บไว้ใน `apps/web/.env.local`) ใช้รหัสนี้เข้า http://localhost:3000/admin

ไม่อยากได้ข้อมูลตัวอย่าง: `npm run setup -- --no-demo` บนฐานข้อมูลว่าง

## ใช้งานอะไรได้บ้าง

**หน้าสาธารณะ**
- Ranking ทีม (Elo rating เริ่มที่ 1000 คำนวณใหม่ทุกครั้งที่มีผลการแข่ง) และ Ranking ผู้เล่น (เรียงตามแต้ม, แต้มเฉลี่ย, เรตติ้ง, MVP, รีบาวด์, แอสซิสต์ ฯลฯ)
- หน้าทีม ผู้เล่น ทัวร์นาเมนต์ (ตารางคะแนน ชนะ 3 เสมอ 1) และผลการแข่งแต่ละซีรีส์ พร้อมสกอร์บอร์ดทุกเกม (PTS REB BLK STL AST LBR, เรตติ้ง, MVP/SVP)
- ช่องค้นหาพร้อมปุ่มค้นหาทุกหน้า และ dropdown เลือกทีมที่พิมพ์ค้นหาได้

**หน้าจัดการ (`/admin`)**
- เพิ่ม/แก้/ลบ ทีม ผู้เล่น ทัวร์นาเมนต์ และผลการแข่ง
- ทุกช่องรูป (โลโก้ทีม, รูปผู้เล่น, ภาพผลการแข่ง) **ลากรูปมาวาง, วางด้วย Ctrl+V หรือคลิกเลือกไฟล์ได้**
- บันทึกผลการแข่งเป็นซีรีส์ (เช่น Bo3) กรอกสกอร์บอร์ดทีละเกม พิมพ์ชื่อทีมหรือผู้เล่นใหม่ได้เลย ระบบสร้างให้ตอนบันทึก
- **ให้ AI อ่านผลจากข้อความผลและรูปสกอร์บอร์ดหลายรูป** แล้วกรอกฟอร์มให้ (ต้องตั้ง `ANTHROPIC_API_KEY` ใน `apps/api/.env`) ระบบจะไม่บันทึกเองจนกว่าจะกดยืนยัน ถ้าไม่ตั้ง key ก็พิมพ์กรอกเองได้ตามปกติ
- สร้าง/ยกเลิก API key สำหรับเว็บอื่น

## บอท Discord: ดึงผลจากห้องส่งผล

คนส่งผลโพสต์ข้อความ เช่น `WD 2-0 มาช้าแต่ทันไหม` พร้อมรูปสกอร์บอร์ดทุกเกม บอทจะอ่านแล้วตอบกลับเป็นสรุปให้ตรวจ แอดมินกด **✅ บันทึก** (หรือกด ✅ ที่โพสต์ต้นทาง) ผลจึงเข้าเว็บ ทีมหรือผู้เล่นที่ยังไม่มีจะถูกสร้างให้อัตโนมัติ โพสต์เดิมบันทึกซ้ำไม่ได้

1. สร้างแอปที่ https://discord.com/developers/applications → เมนู **Bot** กด **Reset Token** แล้วเปิด **Message Content Intent**
2. เชิญบอทเข้าเซิร์ฟเวอร์ (OAuth2 → scope `bot` + `applications.commands` สิทธิ์ View Channels, Send Messages, Embed Links, Read Message History, Add Reactions)
3. เปิด `apps/bot/.env` (สร้างโดย `npm run setup`) ใส่ token หลัง `DISCORD_TOKEN=` และใส่ `ANTHROPIC_API_KEY` ใน `apps/api/.env` เพื่อให้อ่านรูปได้
4. `npm run dev` แล้วพิมพ์ `/setup` ในห้องส่งผล เลือกยศแอดมิน (และห้องประกาศผลถ้าต้องการ)

| คำสั่ง | ทำอะไร |
| --- | --- |
| `/setup` | ตั้งห้องส่งผล ยศแอดมิน ทัวร์นาเมนต์ (ไม่เลือก = รายการที่กำลังแข่ง) และห้องประกาศผล |
| `/setup-off` | หยุดอ่านผลในห้องนี้ หรือปิดการประกาศผล |
| `/rank` `/players` | Ranking ทีม / ผู้เล่น |
| `/team` `/player` | ข้อมูลทีม / สถิติผู้เล่น (พิมพ์ชื่อแล้วเลือกได้) |
| `/matches` | ผลล่าสุด |
| คลิกขวาที่โพสต์ → Apps → **อ่านผลจากโพสต์นี้** | อ่านโพสต์เก่าหรือโพสต์จากห้องอื่น |

ผลใหม่ทุกรายการ (ทั้งจาก Discord และจากหน้าเว็บ) จะถูกประกาศในห้องประกาศผลภายใน 1 นาที `SITE_URL` ใน `apps/bot/.env` คือที่อยู่เว็บที่ใช้ทำลิงก์ (ถ้าเป็นโดเมนจริง ลิงก์จะกดได้ใน Discord)

## บอท Discord: จัดทัวร์นาเมนต์ (แบบ Challonge)

รองรับ **Single Elimination**, **Double Elimination** และ **Round Robin** บอทต้องมีสิทธิ์เพิ่ม **Manage Channels**, **Manage Roles**, **Connect** และ **Speak** เพื่อสร้างห้องแชทและห้องเสียงที่เห็นเฉพาะ 2 ทีม (กับผู้จัด) ลิงก์เชิญที่ให้สิทธิ์ครบ (เปลี่ยน `APP_ID`):
`https://discord.com/oauth2/authorize?client_id=APP_ID&scope=bot+applications.commands&permissions=305253968`

1. `/tour create` ตั้งชื่อ รูปแบบ เวลาเริ่ม (เช่น `12/10 19:00` เวลาไทย) Best of เลทได้กี่นาที จำนวนผู้เล่นต่อทีม ยศผู้จัด และหมวดหมู่ที่จะสร้างห้องแข่ง
2. บอทโพสต์ประกาศรับสมัครพร้อมปุ่ม **สมัครทีม**: หัวหน้าทีมกดแล้วกรอกชื่อทีมและรายชื่อบรรทัดละคน `ชื่อตัวละคร, UID, Server` เลือกเพื่อนร่วมทีมใน Discord ที่จะเข้าห้องแข่งได้ด้วย คนกดเป็นหัวหน้าทีม (`/register` ยังใช้ได้) เปิด/ปิดรับสมัครด้วย `/tour registration`
3. หัวหน้าทีมกด **จัดการทีมของฉัน** เพื่อแก้รายชื่อ โอนหัวหน้าทีม หรือถอนทีม ปุ่มพวกนี้เห็นเฉพาะหัวหน้าทีม ใช้ได้จนถึงเวลาแข่งของแมตช์แรก หลังจากนั้นล็อก (ผู้จัดยังแก้ได้บนเว็บ)
4. `/tour seed` จัดสายอัตโนมัติ (ตาม Ranking หรือสุ่ม) ปรับเองได้ด้วย `/tour swap` หรือบนเว็บ (หน้าแก้ไขทัวร์นาเมนต์ → จัดเอง) แล้วกด **ยืนยันและเริ่มแข่ง**
5. ทุกแมตช์ที่พร้อมจะได้ห้องแชทกับห้องเสียงส่วนตัว มีรายชื่อทั้งสองทีม เวลาแข่ง และปุ่ม **เช็คอิน**, **ขอชนะบาย**, **แจ้งผู้จัด / แย้งผล**, **ผู้จัด**
6. ส่งผลในห้องแข่ง (ข้อความ + รูปสกอร์บอร์ด) บอทอ่านสถิติให้ อีกทีม (หรือผู้จัด) กด **ยืนยันผล** แล้วผลกับสถิติขึ้นเว็บ ทีมชนะเข้ารอบถัดไปเอง

ชนะบาย: ถ้าเลยเวลาแข่ง + เวลาเลทแล้วอีกทีมยังไม่เช็คอิน ทีมที่เช็คอินแล้วกด **ขอชนะบาย** ได้ทันที ถ้าอีกทีมแย้ง ผู้จัดกด **ผู้จัด** เพื่อให้ทีมไหนชนะ หรือยกเลิกผลให้แข่งใหม่ (`/tour winner`, `/tour reopen` ก็ได้) ตั้งเวลาแข่งด้วย `/tour schedule` ดูสายด้วย `/tour bracket`

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
npm test            # เทส API 83 เคส และบอท Discord 43 เคส (ใช้ Discord และ AI แบบจำลอง)
npm run typecheck   # ตรวจ TypeScript ทั้ง API เว็บ และบอท
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
