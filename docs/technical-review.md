# ข้อสังเกตทางเทคนิค

ตรวจ source ที่ commit `a7866c7` เมื่อ 25 ตุลาคม 2026 รายการนี้เป็น code review เพื่อวางแผน ไม่ใช่ผล penetration test, load test หรือการยืนยัน incident บน production

ฐานที่ใช้ต่อได้มี npm workspaces, strict TypeScript, Zod validation, integration tests ที่สร้างฐานข้อมูลแยก และ CI ปัญหาที่ควรแก้คือความรับผิดชอบที่ปะปน การรักษาความถูกต้องข้ามหลายขั้นตอน และขั้นตอนดูแลระบบที่ยังต้องยืนยัน

## ลำดับความสำคัญ

- **P1:** อาจกระทบความถูกต้องของข้อมูลหรือการกู้คืน ควรทำก่อนขยายระบบหรือเปลี่ยนข้อมูลส่วนที่เกี่ยวข้อง
- **P2:** ปัญหาความครบถ้วน การดูแลต่อ และประสิทธิภาพ ควรวางเป็นงานเฉพาะ
- ลำดับนี้ไม่ใช่คำสั่งให้รวมทุกอย่างใน UI sprint

| ID | ระดับ | ประเด็น | สถานะ |
| --- | --- | --- | --- |
| TR-01 | P1 | การตรวจ UID ยังไม่รับขอบเขตเกม | พบจากโค้ด ต้องทดสอบข้ามเกม |
| TR-02 | P1 | บันทึกแมตช์และคำนวณอันดับอยู่คนละขั้น | พบจากโค้ด ต้องทดสอบ failure ระหว่างขั้น |
| TR-03 | P1 | ไม่มี migration history ใน repo | พบจากโค้ด ต้องยืนยันวิธี deploy จริง |
| TR-04 | P1 | สถานะ backup และ restore ของ production | ต้องยืนยันกับผู้ดูแล ยังไม่ใช่ข้อสรุปจาก repo |
| TR-05 | P2 | ค้นหา MMR เฉพาะ 200 คนแรกที่โหลดมา | พบจากโค้ด ยังไม่ได้รันกรณีข้อมูลเกิน 200 |
| TR-06 | P2 | มีคิว rate limit และ revision ใน process memory | พบจากโค้ด ต้องตรวจเมื่อ restart/เพิ่ม replicas |
| TR-07 | P2 | API contracts ดูแลแยกหลายชุด | พบจากโค้ด |
| TR-08 | P2 | UI/CSS/actions รวมหลายความรับผิดชอบ | พบจากโค้ด |
| TR-09 | P2 | API backfill และ rating replay ทำตอนเริ่ม server | พบจากโค้ด ต้องตรวจ readiness และการกู้คืน |

## TR-01 ตัวตนของผู้เล่นกับเกม

`findByUid` รับ UID, server และ ID ที่ให้ยกเว้น แต่ไม่มี `gameId` และอ่านผู้เล่นที่มี UID จากทั้งระบบ ขณะที่ข้อมูลผู้เล่นมีความสัมพันธ์กับเกม ส่วน schema มี index ของ UID แต่ไม่มี composite unique constraint ที่บังคับกฎตัวตนตามเกม

ผลที่ต้องพิสูจน์: UID/Server เดียวกันในคนละเกมอาจถูกมองว่ามีเจ้าของแล้วหรือเชื่อมผิดตัวละคร การเติม unique constraint ทันทีอาจทำไม่ได้เพราะกฎ server ว่างและข้อมูลซ้ำเดิม

งานแก้ต้องเริ่มจากกำหนดกฎ `(game, UID, server)` ให้ชัด ทดสอบ UID ซ้ำข้ามเกม การเปลี่ยนชื่อ server ว่าง และคำขอผูก Discord จากนั้นสำรวจข้อมูลซ้ำและออกแบบ migration จึงค่อยบังคับในฐานข้อมูล

หลักฐาน: [Player identity](../apps/api/src/lib/players.ts), [Player schema](../apps/api/prisma/schema.prisma)

## TR-02 ผลแข่งกับอันดับอาจสำเร็จไม่พร้อมกัน

`saveMatch` commit transaction ของผลแข่งก่อน แล้วจึง `await recomputeRatings()` และอ่านผลกลับ ถ้าการคำนวณอันดับล้มเหลวหลัง commit ผู้เรียกอาจได้รับ error ทั้งที่แมตช์ถูกบันทึกแล้ว จึงต้องพิจารณาการลองซ้ำและสถานะอันดับด้วย

ไม่ควรรวม replay ทั้งประวัติเข้า transaction ใหญ่โดยไม่มีการประเมิน lock บน SQLite งานแก้ควรกำหนดขอบเขตธุรกรรม สถานะงานคำนวณ วิธี retry/reconcile และความเป็นเอกลักษณ์ของคำขอบันทึก โดยรักษาการแก้ผลย้อนหลังและผลต่อ bracket/predictions

เกณฑ์ทดสอบ: จำลองล้มเหลวหลังบันทึกผล ลองคำขอเดิมซ้ำ และรัน recovery แล้วผลแข่งไม่ซ้ำและอันดับตรงกับการ replay ที่สำเร็จ

หลักฐาน: [Match write](../apps/api/src/lib/matchWrite.ts), [Rating replay](../apps/api/src/lib/elo.ts), [Competition](../apps/api/src/lib/competition.ts)

## TR-03 Migration และ TR-04 Backup

Repo ไม่มีโฟลเดอร์ Prisma migrations และ setup ใช้ `prisma db push` ทำให้ยังไม่มี migration history สำหรับตรวจและทำซ้ำการเปลี่ยน schema ก่อนแก้ schema ครั้งต่อไปต้อง baseline ฐานข้อมูลเดิม และทดสอบทั้งฐานข้อมูลใหม่กับสำเนาที่ restore แล้ว

เอกสาร requirement ที่ใช้เป็นบริบทระบุว่างาน backup อัตโนมัติเป็น backlog แต่ repo ไม่สามารถยืนยันสถานะ production ล่าสุดได้ ให้ขอหลักฐานรอบ backup, ที่เก็บนอกเครื่อง และผล restore ที่ทดสอบได้ก่อน release

ข้อมูลที่ต้องครอบคลุมมี SQLite snapshot ที่สอดคล้องกัน, uploads, bot JSON state และ configuration ที่จำเป็นต่อการกู้คืน โดยเก็บ secrets นอก Git

หลักฐาน: [Setup](../scripts/setup.mjs), [API scripts](../apps/api/package.json), [Prisma schema](../apps/api/prisma/schema.prisma), [Bot state store](../apps/bot/src/store.ts)

## TR-05 ค้นหา Ranking ไม่ครบชุดข้อมูล

หน้า MMR ขอ `limit: 200` แล้วใช้ `ladder.data.filter(matches)` เพื่อค้นหาชื่อ ชื่อเล่น และ UID หากผู้เล่นอยู่หลัง 200 คนแรกอาจไม่ถูกค้นพบจากหน้านี้

งานแก้ควรย้ายการค้นหาไปก่อน pagination ฝั่ง API และเพิ่ม pagination ให้หน้าเว็บ โดยตกลงความหมายของอันดับ tier counts และ placement list เมื่อกรอง ห้ามใช้ลำดับหลังกรองแทนอันดับจริงโดยไม่ได้กำหนด behavior

เกณฑ์ทดสอบ: มีผู้เล่นเกิน 200 คน ค้นหาคนที่อยู่นอกหน้าแรก และใช้ตัวกรองเกม/ทีมร่วมกัน โดย URL และการกด Back ยังคงเงื่อนไขถูกต้อง

หลักฐาน: [Player ranking page](../apps/web/app/rankings/players/page.tsx), [Ranking routes](../apps/api/src/routes/rankings.ts)

## TR-06 ความถูกต้องที่ผูกกับ process

เว็บรันหลาย workers โดยเลือก worker ตาม IP ส่วน login limiter อยู่ในหน่วยความจำของแต่ละ worker API มีคิว prediction/rating และ revision counter ใน process ของตัวเอง โครงนี้มีสมมติฐานเรื่องจำนวน processes และการ restart

การมีคิวใน memory ไม่ได้พิสูจน์ว่ามีการใช้เหรียญซ้ำในระบบปัจจุบัน แต่ไม่ควรใช้คิวนี้เป็นหลักฐานว่าปลอดภัยเมื่อเพิ่ม API replicas ต้องทดสอบ invariants ที่ฐานข้อมูล การส่งคำขอพร้อมกัน และการ retry หลัง restart ก่อนเปลี่ยน topology

หลักฐาน: [Web workers](../apps/web/balance.mjs), [Login guard](../apps/web/lib/loginGuard.ts), [Prediction queue](../apps/api/src/lib/predict.ts), [Revision](../apps/api/src/lib/revision.ts)

## TR-07 Contracts และ TR-08 UI boundaries

เว็บ บอท และ OpenAPI มี types/schema ที่ดูแลแยกกัน และ `api<T>` ของเว็บ cast response เป็นชนิดที่ผู้เรียกระบุ การ typecheck ผ่านจึงไม่ได้ยืนยันว่า wire response ตรงกันทั้งหมด ควรเริ่ม shared contracts และ contract tests เฉพาะ endpoints ที่ย้ายโมดูลก่อน

ส่วน UI มี global CSS รวมหลายหน้า root layout ผูก public navigation, auth และโฆษณาเข้าด้วยกัน และ admin actions รวมหลาย feature การแก้ UI ควรใช้ feature components และ scoped styles พร้อม smoke test หน้าที่ใช้โครงร่วม

หลักฐาน: [Web types](../apps/web/lib/types.ts), [Bot types](../apps/bot/src/types.ts), [OpenAPI](../apps/api/openapi.yaml), [Web API client](../apps/web/lib/api.ts), [Layout](../apps/web/app/layout.tsx), [Admin actions](../apps/web/app/admin/actions.ts)

## TR-09 Startup และ readiness

API เริ่มรับคำขอแล้วจึงรัน backfill และ rating replay ต่อ พร้อมเปิด poller การตอบ `/health` ว่า process ยังอยู่ไม่ได้ยืนยันว่า initialization เสร็จหรือข้อมูลพร้อมใช้

เมื่อทำ foundation ฝั่งระบบ ให้แยก liveness กับ readiness และกำหนดว่างาน migration/backfill ใดต้องเสร็จก่อนรับ traffic รวมถึงวิธี recover เมื่อ initialization ล้มเหลว

หลักฐาน: [API entrypoint](../apps/api/src/index.ts), [Health route](../apps/api/src/app.ts)

## การปิด finding

แต่ละ finding ต้องมี PR/commit, regression test หรือหลักฐานตรวจที่เหมาะสม และข้อจำกัดที่เหลือ งานเอกสารนี้ยังไม่ได้ปิด finding ใดด้วยการแก้ application code
