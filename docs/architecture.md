# สถาปัตยกรรม API: ย้ายไปเป็น modular monolith แบบ Hexagonal

วิเคราะห์จาก `main` ที่ commit `9b0ac22` (2026-10-25) งานย้ายทำทีละส่วน โดย HTTP API, เว็บ และบอทต้องทำงานเหมือนเดิมทุกครั้ง

## สภาพปัจจุบัน (ข้อเท็จจริงที่ตรวจในโค้ด)

- **npm workspaces 3 ตัว:**
  - `apps/web`: Next.js 16 อ่านข้อมูลผ่าน `apps/web/lib/api.ts`
  - `apps/api`: Express 5, Prisma 6, SQLite WAL, zod
  - `apps/bot`: discord.js เรียก API ผ่าน HTTP ที่ `apps/bot/src/api.ts`
  - web และ bot ไม่ได้ import โค้ดของ API (type ที่ตรงกับ API เขียนซ้ำไว้ใน `apps/web/lib/types.ts` และ `apps/bot/src/types.ts`)
- **`apps/api/src`:**
  - `routes/` มี 18 ไฟล์ 10 ไฟล์ในนั้นเรียก `prisma.` เองโดยตรง
  - `lib/` มี 34 ไฟล์ 22 ไฟล์ในนั้นเรียก Prisma
  - ไฟล์ใหญ่: `competition.ts` 814 บรรทัด, `predict.ts` 648 บรรทัด, `bracket.ts` 518 บรรทัด
  - กฎธุรกิจ, query และงานภายนอกอยู่ปนกัน เช่น:
    - `lib/announce.ts` ส่ง Discord webhook
    - `lib/draws.ts` เรียก YouTube API
    - `lib/extract.ts` เรียก Anthropic/OCR
  - `process.env` ถูกอ่านกระจายใน `lib/` ทั้ง announce, db, draws, extract และ uploads
- **Transaction:** มี `$transaction` ราว 57 จุด ส่วนใหญ่อยู่ใน `competition.ts`, `guilds.ts`, `predict.ts` และ `teamSelf.ts` ยังไม่มีกฎกลางว่างานไหนต้อง retry หรือ recover อย่างไร
- **Rating:**
  - `lib/elo.ts` `recomputeRatings()` เล่น MMR และ Elo ใหม่ตั้งแต่แมตช์แรกทุกครั้งที่มีการเขียนผล (มีผู้เรียก 13 จุด)
  - กัน replay ซ้อนกันด้วยคิวในหน่วยความจำของ process เดียว
- **สถานะในหน่วยความจำ ที่ทำให้ยังเพิ่ม API replica ไม่ได้:**
  - `lib/revision.ts`: ตัวนับ revision ที่บอทใช้ติดตามการเปลี่ยนแปลง
  - `lib/rateLimit.ts`: ตัวจำกัดอัตราคำขอ
  - `lib/apiKeys.ts`: การจดเวลาใช้คีย์ล่าสุด
  - คิวของ `recomputeRatings`: ถ้าสอง process replay พร้อมกัน ผลจะทับกัน
- **วงจร import ที่มีอยู่เดิม:** `lib/extract.ts ↔ lib/ocr.ts` (ตรวจด้วย madge)
- **`GET /api/v1/rankings/mmr`** ส่งทุกฟิลด์ของ Player ออกไป รวม `discordId` และ `uid` ต้องใช้ API key อ่านอย่างเดียวก็เห็นได้ ส่วนนี้ยังคงพฤติกรรมเดิมไว้ ดู "สิ่งที่ยังต้องตัดสินใจ"

## Baseline ก่อนแก้ (commit 9b0ac22)

`npm run typecheck` ผ่าน, `npm test` ผ่าน (API 196, บอท 102, deploy 11), `npm run build` ผ่าน, CI บน Linux และ Windows ผ่านใน PR #46 ยังไม่พบปัญหาเดิมที่ทำให้เทสแดง

## โครงสร้างเป้าหมาย

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
    index.ts             public API ของโมดูล โมดูลอื่นใช้ได้เฉพาะสิ่งที่ส่งออกจากไฟล์นี้
  bootstrap/container.ts composition root: สร้างโมดูลและส่ง dependency ให้
  shared/                เฉพาะของที่ใช้ร่วมกันจริง (ยังว่าง)
```

กฎ dependency ของแต่ละโมดูลตรวจด้วยเทส `modules/<module>/architecture.test.ts` ทำผิดแล้ว CI จะแดง

## ส่วนแรกที่ย้ายแล้ว: rankings (อันดับ MMR)

`GET /api/v1/rankings/mmr` เดินตามเส้นทางนี้:

1. `routes/rankings.ts` ส่งต่อไปที่ `rankingsModule.http.mmrLadder`
2. `adapters/inbound/http/mmrLadderRoute.ts` ตรวจ query ด้วย zod (query ผิดได้ 400 เหมือนเดิม)
3. `application/use-cases/playerLadder.ts` (`makeMmrLadder` / `makePlayerLadder`) กรองทีม, แบ่งหน้า, นับคนต่อ tier และแนบกฎ
4. port `application/ports/ladderSource.ts` (`LadderSource.load`)
5. `adapters/outbound/prisma/prismaLadderSource.ts`
6. กฎอยู่ใน `domain/ladder.ts` (`buildLadder`, `withRanks`, `rankMap`), `domain/tiers.ts` และ `domain/rules.ts`

การย้ายนี้รักษาพฤติกรรมเดิมทุกอย่าง:

- `lib/leaderboard.ts` `playerBoard()` ยังอยู่ แต่เรียกโมดูลแทน ผู้เรียกเดิม 6 จุด (players, stats, guilds, teamSelf, special) จึงไม่ต้องแก้ในรอบนี้
- `lib/mmr.ts` re-export กฎและ tier ให้โค้ดเดิม
- เทียบผลจริงก่อน/หลังบนฐานข้อมูลเดียวกัน 10 คำขอ ได้ JSON เหมือนกันทุกตัว ทั้งลำดับคีย์และค่า:
  - `/rankings/mmr` แบบไม่มี query, `gameId`, `teamId`, การแบ่งหน้า, `gameId` ที่ไม่มีอยู่ และ query ผิด 2 แบบ
  - `/stats/overview` และหน้าทีม
  - หน้าโปรไฟล์ผู้เล่นต่างกันแค่ id กับเวลาของแถว blacklist ที่สคริปต์สร้างใหม่ทุกรอบ
- **เทสใหม่ที่ไม่ต้องเปิด server หรือฐานข้อมูล:**
  - กฎ ladder 6 เคส
  - use case กับ source จำลอง 3 เคส
  - กฎ dependency 3 เคส (ลองใส่ import Prisma ใน application แล้ว เทสแดงจริง)

## แผน PR ถัดไป

แต่ละ PR ต้อง deploy ได้เอง ผ่าน CI ทั้งสองระบบ และผลลัพธ์ API เทียบก่อน/หลังต้องเหมือนเดิม

| # | งาน | เกณฑ์ตรวจรับ |
|---|---|---|
| 1 | **(PR นี้)** rankings: `/rankings/mmr` ครบเส้นทาง | ผลลัพธ์เดิม, เทส domain/use case ไม่ใช้ DB, เทส dependency |
| 2 | rankings: ย้ายผู้เรียก `playerBoard` (players, stats, guilds, teamSelf, special) ไปใช้ public API ของโมดูล แล้วลบ shim ใน `lib/leaderboard.ts` | ไม่มีโค้ดนอกโมดูล import `lib/leaderboard.playerBoard`, ผลลัพธ์ของ 5 endpoint เหมือนเดิม |
| 3 | rankings: `/rankings/teams`, `/rankings/players`, `teamMovement` และ `/tiers` | `routes/rankings.ts` ไม่มี `prisma.` เหลือ |
| 4 | competition (rating): ย้าย `scoreSeries` และ `eloDelta` ไป domain, ทำ `recomputeRatings` เป็น use case ที่มี port `RatingStore` และจุด lock เดียว | เทส replay บนข้อมูลจำลองได้ผลตรงกับ DB, กำหนด transaction/retry ของการบันทึกผลแมตช์ชัดเจน |
| 5 | competition: บันทึกผลแมตช์ (`matchWrite`) เป็น use case แยก port การแจ้ง Discord (`announce.ts`) ออกจาก transaction | เขียนผลแล้วแจ้งเตือนพลาดก็ไม่ทำให้ผลหาย และ retry ได้ |
| 6 | predictions/rewards: ทายผลและการจ่ายเหรียญ ซึ่งเป็นงานเงินจำลองที่ต้องแม่นที่สุด | กฎ parimutuel และการปัดเศษเทสได้โดยไม่ใช้ DB, การ settle ทำซ้ำได้ไม่จ่ายซ้ำ (idempotent) |
| 7 | players/teams, audience activities (Lucky Draw, เชียร์) | ทีละโมดูล เกณฑ์เดียวกัน |
| 8 | เตรียม replica: ย้าย revision, rate limit และคิว replay ไปไว้ที่เก็บร่วม หลังวัดโหลดจริงแล้ว | load test ก่อน/หลัง และ 2 process ทำงานพร้อมกันแล้วข้อมูลไม่ทับกัน |

## สิ่งที่ยังต้องตัดสินใจ / ยังไม่ทราบ

- **`/rankings/mmr` ส่ง `discordId` และ `uid` ของทุกคน** เว็บและบอทใช้ฟิลด์ไหนบ้างต้องตรวจก่อนตัด ถ้าตัดจะเป็นการเปลี่ยน contract จึงควรแยกเป็น PR ที่ตั้งใจเปลี่ยนเอง
- **ขอบเขตของ "rating":**
  - กฎ MMR ตอนนี้อยู่ใน `modules/rankings/domain/rules.ts` เพราะ rankings ใช้ก่อน
  - เมื่อย้าย competition (PR 4) อาจต้องย้ายไปโมดูล rating ที่ทั้งสองฝั่งใช้ร่วมกัน
- **เงื่อนไขก่อนเพิ่ม API replica หรือเปลี่ยนไป PostgreSQL:**
  - ตอนนี้ยังไม่มีตัวเลขโหลดของ API แยกจากเว็บ (ที่มีคือการทดสอบ 300 คนพร้อมกันผ่านหน้าเว็บ เมื่อ 2026-10-24)
  - ต้องวัด API แยกก่อน แล้วจึงตัดสินใจ
