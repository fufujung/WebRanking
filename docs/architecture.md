# สถาปัตยกรรม API: ย้ายไปเป็น modular monolith แบบ Hexagonal

- วิเคราะห์ครั้งแรกจาก `main` ที่ commit `9b0ac22`
- ทบทวนรอบสองตามคำสั่งฉบับเต็มจาก `main` ที่ `6cfc398` (2026-10-25) หลัง PR #47 ขึ้นเว็บแล้ว

งานย้ายทำทีละส่วน โดย HTTP API, เว็บ และบอทต้องทำงานเหมือนเดิมทุกครั้ง เอกสารนี้แยกเป็น **ข้อเท็จจริง** (ตรวจในโค้ดหรือวัดจริง), **ข้อเสนอ** และ **สิ่งที่ยังไม่ทราบ**

## 1. สภาพปัจจุบัน (ข้อเท็จจริง)

- **npm workspaces 3 ตัว:**
  - `apps/web`: Next.js 16 อ่านข้อมูลผ่าน `apps/web/lib/api.ts`
  - `apps/api`: Express 5, Prisma 6, SQLite WAL, zod
  - `apps/bot`: discord.js เรียก API ผ่าน HTTP ที่ `apps/bot/src/api.ts`
  - โค้ดจริงของ web และ bot ไม่ import โค้ดของ API (มีเทสตรวจ ดูข้อ 4) type ที่ตรงกับ API เขียนซ้ำไว้ใน `apps/web/lib/types.ts` และ `apps/bot/src/types.ts` ส่วนเทสของบอทเปิด API จริงใน process เดียวกันโดยตั้งใจ
- **`apps/api/src`:**
  - `routes/` มี 18 ไฟล์ 10 ไฟล์ในนั้นเรียก `prisma.` เองโดยตรง
  - `lib/` มี 34 ไฟล์ 22 ไฟล์ในนั้นเรียก Prisma
  - ไฟล์ใหญ่: `competition.ts` 814 บรรทัด, `predict.ts` 648 บรรทัด, `bracket.ts` 518 บรรทัด
  - กฎธุรกิจ, query และงานภายนอกอยู่ปนกัน เช่น `lib/announce.ts` ส่ง Discord webhook, `lib/draws.ts` เรียก YouTube API, `lib/extract.ts` เรียก Anthropic/OCR
  - `process.env` ถูกอ่านกระจายใน `lib/` ทั้ง announce, db, draws, extract และ uploads
- **การบันทึกผลแมตช์** (`lib/matchWrite.ts` `saveMatch`):
  1. เขียนแมตช์และสถิติใน `$transaction` เดียว
  2. **หลัง commit** เรียก `recomputeRatings()`
  3. แล้วส่งประกาศ Discord แบบไม่รอผล (`announceMatch`)
  - ถ้าข้อ 2 ล้ม ผลแมตช์อยู่แล้วแต่ MMR/Elo ค้างค่าเก่า จนมีการเขียนครั้งถัดไปหรือ API เริ่มใหม่ (`index.ts` replay ตอนเปิดเสมอ)
  - ถ้าข้อ 3 ล้มหรือ process ดับกลางทาง ประกาศหายไปเลย ไม่มีที่จดว่ายังค้างส่ง
- **Rating replay** (`lib/elo.ts`):
  - อ่านทุกทีม ทุกผู้เล่น ทุกแมตช์ และทุก `PlayerMmrChange` แล้วคำนวณใหม่ตั้งแต่แมตช์แรก จากนั้นเขียนเฉพาะค่าที่เปลี่ยนใน `$transaction` แบบ array
  - การอ่านอยู่นอก transaction กันการทำงานซ้อนด้วยคิว `Promise` ในหน่วยความจำของ process เดียว
  - มีผู้เรียก 13 จุด เวลาที่ใช้โตตามจำนวนแมตช์ทั้งหมด
- **Transaction:** มี `$transaction` ราว 57 จุด ส่วนใหญ่อยู่ใน `competition.ts`, `guilds.ts`, `predict.ts` และ `teamSelf.ts` ยังไม่มีกฎกลางว่างานไหนต้อง retry หรือ recover อย่างไร
- **การจ่ายเหรียญทายผล** (`lib/predict.ts`): ปรับ `payout` ตามส่วนต่างจากค่าที่เก็บไว้ (`target - payout`) ภายใน transaction จึงตั้งใจให้เรียกซ้ำได้โดยไม่จ่ายซ้ำ **ยังไม่มีเทสความล้มเหลวที่ยืนยันเรื่องนี้กรณีคำขอพร้อมกัน**
- **สถานะในหน่วยความจำ ที่ทำให้ยังเพิ่ม API replica ไม่ได้:**
  - `lib/revision.ts`: ตัวนับ revision ที่บอทใช้ติดตามการเปลี่ยนแปลง (เริ่มใหม่ที่ 0 ทุกครั้งที่ API เปิด)
  - `lib/rateLimit.ts`: ตัวจำกัดอัตราคำขอ (แต่ละ process นับแยก)
  - `lib/apiKeys.ts`: การจดเวลาใช้คีย์ล่าสุด
  - คิวของ `recomputeRatings`: ถ้าสอง process replay พร้อมกัน ผลจะทับกัน
- **ไฟล์ที่อยู่บนเครื่องเดียว:** รูปอัปโหลด (`UPLOAD_DIR`), สถานะบอท (`apps/bot/data`), ฐานข้อมูล SQLite
- **วงจร import ที่มีอยู่เดิม:** `lib/extract.ts ↔ lib/ocr.ts` (ตรวจด้วย madge)
- **`GET /api/v1/rankings/mmr`** ส่งทุกฟิลด์ของ Player ออกไป รวม `discordId` และ `uid` ใช้ API key อ่านอย่างเดียวก็เห็นได้ PR นี้คงพฤติกรรมเดิมไว้ ดูข้อ 8
- **ค้นหาได้แค่ 200 คน:** หน้า `/rankings/players` ของเว็บดึง `/rankings/mmr?limit=200` (`apps/web/app/rankings/players/page.tsx:23`) และ API จำกัด `limit` ไว้ที่ 200 คนอันดับที่ 201 ขึ้นไปจึงไม่อยู่ในหน้าและค้นหาไม่เจอ PR refactor ไม่แก้เรื่องนี้ จะแยกทำเป็น behavior change พร้อมเทส (PR R3)
- **ข้อมูลจริงตอนนี้:** สำเนาฐานข้อมูลเว็บจริงมีผู้เล่น 89 คน แต่ยังไม่มีแมตช์และ `PlayerMmrChange` เลย การเทียบผลจึงต้องใช้ข้อมูลจำลอง

## 2. Baseline ก่อนแก้

- **ที่ `9b0ac22`:**
  - `npm run typecheck` ผ่าน
  - `npm test` ผ่าน: API 196, บอท 102, deploy 11
  - `npm run build` ผ่าน
  - CI บน Linux และ Windows ผ่าน
  - ไม่พบปัญหาเดิมที่ทำให้เทสแดง
- **ที่ `6cfc398`:** ตรวจซ้ำบน Windows (เครื่องของ Bank): typecheck ทั้ง 3 แอปผ่าน และ API 208, บอท 102, deploy 11 ผ่านทั้งหมด

## 3. โครงสร้างเป้าหมายและขอบเขตโมดูล

```
apps/api/src/
  modules/<module>/
    domain/              กฎธุรกิจล้วน ไม่มี Express/Prisma/Discord/zod/node:*/process.env
    application/
      ports/             สิ่งที่ use case ต้องการจากภายนอก (อ่าน/เขียนข้อมูล, แจ้งเตือน)
      use-cases/         ขั้นตอนของงาน เรียก domain และ port เท่านั้น
    adapters/
      inbound/http/      แปลง request (zod) → input ของ use case → JSON
      outbound/prisma/   implement port ด้วย Prisma
    contract/            (เฉพาะเทส) oracle ของพฤติกรรมเดิมและ fixtures
    index.ts             public API ของโมดูล โค้ดอื่นใช้ได้เฉพาะสิ่งที่ส่งออกจากไฟล์นี้
  bootstrap/container.ts composition root: สร้างโมดูลและส่ง dependency ให้
  shared/                เฉพาะของที่ใช้ร่วมกันจริง (ยังว่าง)
```

**ขอบเขตโมดูลที่เสนอ** แบ่งตามว่าใครเป็นเจ้าของข้อมูลและกฎ ไม่ได้แบ่งตามชนิดไฟล์:

| โมดูล | เป็นเจ้าของ | เหตุผล |
|---|---|---|
| **rankings** (เริ่มแล้ว) | การอ่าน ladder, tier, movement | อ่านอย่างเดียว ไม่มี transaction เสี่ยงต่ำสุด จึงเริ่มก่อน |
| **competition** | ทัวร์, สาย, ผลแมตช์, rating replay | งานเขียนที่สำคัญที่สุด ต้องมีแผนธุรกรรมก่อน (ข้อ 6) |
| **players/teams** | ผู้เล่น, ทีม, กิลด์, การผูก Discord | ข้อมูลที่โมดูลอื่นอ้างถึง |
| **predictions/rewards** | ตลาดทายผล, เหรียญ, รางวัล | กฎเงินจำลองที่ต้อง idempotent |
| **audience** | Lucky Draw, เชียร์, ต้นเรื่อง | ผูกกับบริการภายนอก (YouTube) |

ยังไม่สร้างโมดูลที่ยังไม่ย้าย การมีโฟลเดอร์ว่างไม่นับว่าเสร็จ

## 4. ส่วนที่ implement แล้ว: rankings (อันดับ MMR)

**เส้นทางของ `GET /api/v1/rankings/mmr`:**

```
routes/rankings.ts
  → rankingsModule.http.mmrLadder           (bootstrap/container.ts สร้างให้)
  → adapters/inbound/http/mmrLadderRoute.ts  zod ตรวจ query, query ผิด = ZodError → 400 เหมือนเดิม
  → application/use-cases/playerLadder.ts    makeMmrLadder → makePlayerLadder
  → application/ports/ladderSource.ts        LadderSource.load({ gameId, board })
  → adapters/outbound/prisma/prismaLadderSource.ts   3 query เดิม
  (กฎ: domain/ladder.ts buildLadder/withRanks/rankMap, domain/tiers.ts, domain/rules.ts)
```

**สิ่งที่รักษาไว้:**

- URL และการตรวจ API key
- status และรูปแบบ error
- ค่าเริ่มต้น `limit=50` และ `offset=0`
- การกรองเกมและทีม การแบ่งหน้า และ `total`
- `placing` และจำนวนคนต่อ tier
- ลำดับอันดับ การเสมอ (อันดับร่วม แล้วเรียงตามจำนวนซีรีส์และชื่อ) และ `rankChange`
- กฎ MMR

**สิ่งที่ยังเป็นทางผ่านชั่วคราว (บอกตรง ๆ):**

- `lib/leaderboard.ts` `playerBoard()` ยังอยู่ แต่เรียกโมดูลแทน ผู้เรียกเดิม 6 จุด (players, stats, guilds, teamSelf, special) ยังเข้าทาง shim นี้ จะย้ายใน PR R2
- `lib/mmr.ts` re-export กฎและ tier ให้โค้ดเดิม
- `lib/leaderboard.ts` `teamMovement()` ยังเรียก Prisma เอง (ยังไม่ย้าย)
- HTTP adapter ใช้ `pagination` จาก `lib/validate.ts` ซึ่งเป็นของเดิมที่ใช้ทั้งระบบ เมื่อโมดูลที่สองต้องใช้จะย้ายไป `shared/`
- `bootstrap/container.ts` ใช้ Prisma client ตัวเดียวของ `lib/db.ts`
- Prisma adapter เลือกฟิลด์ผู้เล่นทีละชื่อ (ชุดเดิมที่เคยส่ง รวม `uid` และ `discordId`) คอลัมน์ใหม่ใน Player จะไม่หลุดออก API เอง ส่วนการตัดฟิลด์เป็นการเปลี่ยน contract แยกต่างหาก (R4)
- domain และ application **ไม่** import อะไรจาก `lib/` เลย (เทสบังคับ)

**เทสที่มี:**

| ชนิด | ไฟล์ | ครอบคลุม |
|---|---|---|
| domain (ไม่ใช้ DB/Express) | `domain/ladder.test.ts` | 6 เคส: เสมอ, placement, movement, blacklist, ไม่มีข้อมูล |
| application (source จำลอง) | `application/use-cases/playerLadder.test.ts` | 3 เคส: กรองทีม, แบ่งหน้า, special board |
| Prisma adapter (DB แยกของตัวเอง) | `adapters/outbound/prisma/prismaLadderSource.test.ts` | 4 เคส: กรองเกม, team card, board main/special, ลำดับ, blacklist ซ้ำ/ยกเลิก, DB ว่าง |
| HTTP contract | `mmrLadder.contract.test.ts` | 7 เคส |
| dependency | `architecture.test.ts` | 8 เคส |

- **HTTP contract:**
  - เทียบคำตอบของทางใหม่กับ handler เดิมที่แช่แข็งไว้ใน `contract/legacyMmrLadder.ts` (คัดจาก `9b0ac22`) บนฐานข้อมูลเดียวกัน
  - ครอบ 14 แบบ query, query ผิด 8 แบบ, กรณีไม่ใส่ key, กรณีไม่มีข้อมูล และการไล่ทุกหน้า
  - fixtures (`contract/fixtures.ts`): เสมอ 3 คน, placing, คนที่ยังไม่เคยเล่น, 2 เกม, movement, เสมอ/ซีรีส์วันเดียวกัน, blacklist ซ้ำและที่ยกเลิกแล้ว, คนที่เล่นเฉพาะรายการพิเศษ
- **dependency (แบบ allowlist ไม่ใช่รายชื่อห้าม):**
  - domain ใช้ได้เฉพาะ domain, application ใช้ได้เฉพาะ domain และ application ห้ามทุก package รวมถึง `index.ts`, `wiring.ts`, adapters และ `contract/` ของโมดูลเอง
  - มี fixture ด้านลบ 11 แบบ (เช่น `@prisma/client`, `better-sqlite3`, `../../index.js`) และด้านบวก
  - จับ import ทุกแบบ: type-only, side-effect, `import()` (รวมแบบ type), `require` และห้าม `import()`/`require()` ที่ชื่อคำนวณตอนรัน
  - `index.ts` (public API) ต้องไม่ลากโค้ด adapter/Prisma/Express มาด้วย การประกอบกับ adapter จริงอยู่ที่ `wiring.ts` ซึ่ง `bootstrap/` เท่านั้นที่ import ได้
  - ห้าม deep import เข้าโมดูลจากข้างนอก
  - ห้ามโค้ดจริงใช้ `contract/`
  - ห้ามโค้ดจริงของ web/bot import API หรือ Prisma
- **ตรวจว่าเทสจับได้จริง:** ลองใส่ bug 5 แบบ แดงทุกแบบ ได้แก่ type import Prisma ใน domain, `import("@prisma/client")` ใน application, deep import จาก routes, สลับลำดับตอนเสมอ และสลับลำดับ `createdAt` ใน adapter
- **การเทียบแยกอิสระบน Windows:** ใช้ข้อมูลจำลอง 336 คน, 268 แมตช์, เสมอ 62 จุด, 66 แบบ query ได้ JSON และ status ตรงกันทุกไบต์

## 5. ผลทดสอบที่รันจริง (รอบนี้, Linux, Node 24)

- `npm run typecheck`: ผ่าน
- `npm test`: ผ่านทั้งหมด (ตัวเลขดู README)
- `npm run build`: ผ่าน
- e2e ไม่ได้รันในรอบนี้ เพราะไม่มีการแก้หน้าเว็บ CI จะรันให้

## 6. ธุรกรรมและงาน background: แผนก่อนย้าย competition/predictions

ยังไม่ย้าย `saveMatch`, competition หรือ predictions จนกว่าจะมี failure tests ของกรณีเหล่านี้ (เขียนกับโค้ดเดิมก่อน เพื่อให้รู้ว่าพฤติกรรมเดิมคืออะไร):

| กรณี | พฤติกรรมเดิมที่ต้องยืนยัน | ทิศทางที่เสนอ |
|---|---|---|
| บันทึกผลสำเร็จ แต่ replay ล้ม | ผลอยู่ rating ค้าง จนเขียนครั้งต่อไปหรือ restart | จดสถานะ "rating ต้องคำนวณใหม่" ลง DB ใน transaction เดียวกับผล แล้วงานที่ทนต่อ restart อ่านไปทำ |
| คำขอซ้ำ/พร้อมกัน | มี `sourceRef @unique` กันโพสต์ Discord ซ้ำ ช่องทางอื่นยังไม่มี | idempotency key ต่อคำขอเขียน **ก่อน** เพิ่ม retry ใด ๆ |
| แก้ผลย้อนหลัง/ลบผล | replay ทั้งประวัติ ตลาดทายผลตาม bracket | เทสว่าเหรียญที่จ่ายแล้วถูกปรับตามส่วนต่าง ไม่จ่ายซ้ำ |
| process ดับกลางงาน | replay อยู่ใน transaction เดียว (ไม่ครึ่ง ๆ) แต่ประกาศ Discord หาย | outbox: แถวประกาศเขียนใน transaction เดียวกับผล ส่งแล้วจด `sentAt` |
| จ่ายเหรียญซ้ำ/ประกาศซ้ำ | payout แบบส่วนต่าง | เทสเรียก settle 2 ครั้งและพร้อมกัน |
| transaction ข้ามหลาย repository | ใช้ `tx` ของ Prisma ส่งต่อกันเอง | Unit of Work: `uow.run(async (repos) => ...)` adapter ทุกตัวในรอบนั้นใช้ `tx` เดียวกันจริง application ไม่เห็น `Prisma.TransactionClient` |

**ข้อห้ามที่ตั้งไว้:**

- ไม่ย้าย replay ทั้งประวัติเข้า transaction ใหญ่ก่อนวัดเวลาและ lock
  - SQLite มี writer ได้ทีละตัว ถ้า transaction ยาว คำขอเขียนอื่นจะรอจนเกิน `socket_timeout=20`
- ไม่เพิ่ม retry ให้งานเขียนก่อนมี idempotency
- ถ้าเลือก eventual consistency ต้องมีครบทุกข้อนี้:
  - สถานะงานเก็บใน DB
  - เขียนงานใน transaction เดียวกับข้อมูล (outbox)
  - retry แบบมีจำนวนครั้งและ backoff
  - ลำดับต่อทัวร์
  - กันซ้ำด้วย key
  - คิวในหน่วยความจำหรือการเรียกหลัง commit อย่างเดียวไม่นับว่าทนต่อ restart

## 7. Scalability: สิ่งที่วัดได้ และสิ่งที่ยังไม่รองรับ

**ผลวัด `GET /rankings/mmr?limit=50` ในเครื่องพัฒนา:**

- เครื่อง: Xeon 2.8 GHz 4 core, Linux, SQLite WAL, API process เดียว ไม่ผ่านเว็บหรือ Cloudflare
- ข้อมูลจำลอง: 6 แถว MMR ต่อแมตช์ ทุกคนอยู่ในเกมเดียว
- เครื่องจริงของเว็บ (VPS 2 core) น่าจะช้ากว่านี้ ยังไม่ได้วัดบนนั้น

| ข้อมูล | ต่อเนื่องทีละคำขอ p50 / p95 | 10 พร้อมกัน p50 / p95 | คำขอ/วินาที | error |
|---|---|---|---|---|
| 100 คน, 300 แมตช์ (1.8k แถว) | 37 / 53 ms | 124 / 195 ms | 75 | 0 |
| 2,000 คน, 5,000 แมตช์ (30k แถว) | 757 / 882 ms | 2.4 / 3.2 s | 4.2 | 0 |
| 10,000 คน, 25,000 แมตช์ (150k แถว) | 4.6 / 5.1 s | 13 / 20 s | 0.7 | 0 |

**สาเหตุ:** ทุกคำขออ่านผู้เล่นทุกคนของเกม และประวัติ MMR ทั้งหมดของ board (ไม่กรองตามเกม) แล้วจึงแบ่งหน้าในหน่วยความจำ เวลาจึงโตตามประวัติ ไม่ใช่ตามขนาดหน้า ตอนนี้ข้อมูลจริงยังเล็ก (แถวแรก) แต่จะช้าลงเรื่อย ๆ ตามจำนวนแมตช์ การ refactor **ไม่ได้ทำให้เร็วขึ้น** แค่ทำให้เปลี่ยนวิธีอ่านได้ที่ adapter เดียว

**ทางเลือกตามหลักฐาน** (แต่ละข้อต้องวัดก่อน/หลังด้วยสคริปต์เดียวกัน):

1. เก็บสรุปต่อผู้เล่น (series, wins, losses, form, lastDelta, MMR เมื่อ 7 วันก่อน) ไว้ใน DB โดยให้ replay เขียนตอนเดียวกับ MMR ทำให้ `/mmr` อ่านแค่ตารางผู้เล่น
2. หรือกรอง `playerMmrChange` ตามเกมใน query และเพิ่ม index `(playerId)` ร่วมกับ `match.playedAt`
3. cache คำตอบอ่านสาธารณะตาม revision ของข้อมูล (ทำได้เมื่อ revision อยู่ใน DB ไม่ใช่หน่วยความจำ)

**Metrics ที่ควรเก็บ:**

- p95 latency ต่อ route
- error rate
- จำนวน query ต่อคำขอ (Prisma query event)
- เวลาที่ถือ write lock และจำนวน `SQLITE_BUSY`/P1008
- เวลา replay ต่อจำนวนแมตช์
- job lag เมื่อมี outbox

**ความพร้อมสำหรับหลาย process: ยังไม่พร้อม**

- **ยังห้ามเปิด API มากกว่า 1 process:**
  - revision, rate limit และคิว replay อยู่ในหน่วยความจำ
  - SQLite ให้ writer ได้ทีละตัว
  - รูปอัปโหลดและสถานะบอทอยู่บนดิสก์เครื่องเดียว
- เว็บมี worker 2 ตัวอยู่แล้ว (`balance.mjs`) แต่ทั้งคู่เรียก API ตัวเดียว
- เปลี่ยน provider ของ Prisma อย่างเดียวไม่ได้แปลว่าย้ายเป็น PostgreSQL เสร็จ ยังต้อง:
  - ย้ายข้อมูล
  - ดู query ที่ใช้พฤติกรรมเฉพาะของ SQLite
  - ทดสอบ concurrency
  - ย้ายรูปไปที่เก็บร่วม
  - ย้ายงาน background ไปเป็นงานที่ทนต่อ restart
- **Startup:**
  - API เปิดรับคำขอก่อน backfill และ replay ตอนเริ่มจะเสร็จ
  - ยังไม่มี readiness check (`/health` ตอบ ok ทันที)
  - ยังไม่มี graceful shutdown (deploy ใช้การ kill)

## 8. แผน PR ตาม dependency และความเสี่ยง

แต่ละ PR deploy ได้เอง ผ่าน CI ทั้งสองระบบ และ contract test ของ endpoint ที่แตะต้องตรงกับพฤติกรรมเดิม

| # | งาน | เกณฑ์ตรวจรับ |
|---|---|---|
| R1 | ✅ PR #47 + PR นี้: rankings `/rankings/mmr` ครบเส้นทาง, contract/adapter tests, dependency checks ที่เข้มขึ้น | ข้อ 4 ทั้งหมด |
| R2 | rankings: ย้ายผู้เรียก `playerBoard` (players, stats, guilds, teamSelf, special) ไปใช้ public API ของโมดูล แล้วลบ shim | ไม่มีโค้ดนอกโมดูลใช้ `lib/leaderboard.playerBoard`, contract test ของ 5 endpoint นั้นตรงกับของเดิม |
| R3 | (behavior change) ค้นหาผู้เล่นได้เกิน 200 คน: ค้นหาฝั่ง API (`?q=`) | เทสใหม่สำหรับคนอันดับ 201+, contract เดิมของ query ที่ไม่มี `q` ไม่เปลี่ยน |
| R4 | (behavior change, รอ Bank ตัดสิน) ตัด `discordId`/`uid` ออกจาก `/rankings/mmr` | ตรวจผู้ใช้ฟิลด์ใน web/bot, อัปเดต openapi และ types |
| R5 | rankings: `/rankings/teams`, `/rankings/players`, `teamMovement`, `/tiers` | `routes/rankings.ts` ไม่มี `prisma.` เหลือ |
| R6 | performance ของ ladder ตามข้อ 7 | สคริปต์วัดเดิม: ที่ 30k แถว p95 ลดลงชัดเจน, contract test ไม่เปลี่ยน |
| C1 | failure tests ของ `saveMatch`/replay/settle กับโค้ดเดิม (ข้อ 6) | เทสบอกพฤติกรรมเดิมทุกกรณีในตาราง |
| C2 | competition (rating): `scoreSeries`/`eloDelta` ไป domain, replay เป็น use case มี port `RatingStore` | replay บนข้อมูลจำลองได้ผลตรงกับเดิม, วัดเวลา lock |
| C3 | competition: `saveMatch` เป็น use case + Unit of Work + outbox ประกาศ Discord | ผลไม่หายเมื่อประกาศพลาด, restart กลางงานแล้วส่งต่อได้ไม่ซ้ำ |
| P1 | predictions/rewards | กฎ parimutuel/ปัดเศษเทสได้ไม่ใช้ DB, settle ซ้ำ/พร้อมกันไม่จ่ายซ้ำ |
| M1 | players/teams, audience | ทีละโมดูล เกณฑ์เดียวกัน |
| S1 | เตรียมหลาย process: revision/rate limit/คิวไปไว้ใน DB, readiness, graceful shutdown | วัดโหลดก่อน/หลัง, 2 process พร้อมกันแล้วข้อมูลไม่ทับ |

งาน CI/CD แยกเป็น PR ของตัวเอง ไม่ปนกับชุดนี้ ดูข้อ 10

## 9. วิธี rollback ของ refactor โดยไม่เสียข้อมูล

- PR ชุด rankings **ไม่เปลี่ยน schema และไม่เขียนข้อมูล** เส้นทางอ่านอย่างเดียว
- ถ้าต้องถอย ให้ `git revert` commit ของ PR นั้นบน `main` CI จะสร้างไฟล์ใหม่ และเซิร์ฟเวอร์จะติดตั้งเอง ฐานข้อมูลไม่ถูกแตะ
- ถ้าเวอร์ชันใหม่เปิดไม่ขึ้น ระบบอัปเดตจะคืนโค้ดเดิมให้เอง (ข้อมูลไม่ถูกคืนเพราะ schema ไม่เปลี่ยน)
- PR ที่เปลี่ยน schema ในอนาคต (C3, S1) ต้องเขียนวิธีถอยของตัวเอง (schema แบบเพิ่มอย่างเดียวก่อน ลบทีหลัง)

## 10. ผล review CI/CD (ตรวจแยก, แก้ใน PR แยก)

ตรวจ `deploy/auto-deploy.mjs` และ `.github/workflows/deploy.yml` ที่ `6cfc398`:

| ข้อ | จริงไหม | แก้ |
|---|---|---|
| สำรองฐานข้อมูลล้มแล้วทิ้ง HOLD ไว้ | จริง: `copyDb` อยู่หลัง `stopAll()` แต่นอก `try` เว็บดับได้ถึง 30 นาที | ล้มตรงนี้ = ปล่อย HOLD เปิดเวอร์ชันเดิมทันที ยังไม่แก้อะไร |
| rollback ทับข้อมูลที่รับหลังเปิดแอป | จริง เฉพาะรอบที่แก้ schema/แพ็กเกจ: ข้อมูลที่เขียนระหว่างรอ health (ไม่กี่วินาทีถึงไม่กี่นาที) หายจากฐานข้อมูลที่คืน | เก็บฐานข้อมูลของเวอร์ชันที่พังไว้ที่ `db-after-failed-deploy` ก่อนคืน และบันทึกใน log (ยังต้องเติมคืนเอง) |
| rollback schema ไม่คืน Prisma Client | จริง เมื่อแก้แค่ schema (แพ็กเกจไม่ได้ถูกย้ายออก) | สร้าง client ใหม่จาก schema เดิมหลังคืนโค้ด |
| กดรันเองข้าม CI | จริงบางส่วน: `workflow_dispatch` บน `main` สร้างไฟล์ได้แม้ CI ของ commit นั้นยังไม่ผ่าน | รันเองได้เฉพาะ commit ที่ CI ผ่านบน `main` แล้ว |

`--now` บนเซิร์ฟเวอร์ยังลองเวอร์ชันที่เคยพังซ้ำได้โดยตั้งใจ (ต้องมีคนสั่งบนเครื่องเอง)

## 11. สิ่งที่ยังต้องตัดสินใจ / ยังไม่ทราบ

- **R4 `discordId`/`uid` ใน `/rankings/mmr`:** ให้ตัดไหม (เสนอให้ตัด)
- **ขอบเขต rating:** กฎ MMR อยู่ใน `modules/rankings/domain/rules.ts` เพราะ rankings ใช้ก่อน เมื่อย้าย competition อาจต้องเป็นโมดูล rating ที่ทั้งสองฝั่งใช้ร่วมกัน
- **ตัวเลขบนเครื่องจริง:**
  - ยังไม่มีผลวัด API แยกบน VPS
  - ที่มีคือการทดสอบผ่านหน้าเว็บ 300 คนพร้อมกัน เมื่อ 2026-10-24
  - ต้องวัดก่อนตัดสินใจเรื่อง replica หรือ PostgreSQL
