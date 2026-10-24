# Public UI sprint

## เป้าหมายและสถานะ

ปรับเว็บผู้ชมให้หาทัวร์ ติดตามสายแข่ง และอ่านผลแข่งได้ง่ายขึ้น โดยใช้แบรนด์ **The Ranking / Overtime** สไตล์ Esports พร้อมรักษาระบบที่ใช้งานจริง

- กำลังคน: ผู้พัฒนา 1 คน เวลา 1 สัปดาห์ หรือ 5 วันทำงาน
- Branch implementation: `feat/revise-public-ui`
- Branch เอกสาร: `docs/rewrite-docs`
- งาน UI ใน source code: **ยังไม่ได้ implement ตามแผนนี้**
- Figma: มีแบบร่าง 3 หน้า × desktop/mobile ต้องผ่าน [design review](figma-review.md) ก่อนใช้เป็น handoff ฉบับพร้อมพัฒนา
- งานในสัปดาห์นี้: ออกแบบและทำหน้าแรก รายการทัวร์ รายละเอียดทัวร์ ใช้องค์ประกอบสายแข่งและฟอร์มเดิม

## หน้าที่ต้องส่งมอบ

| Route | โครงเนื้อหา | Behavior ที่ต้องรักษา |
| --- | --- | --- |
| `/` | รายการกำลังแข่ง ผลล่าสุด รายการถัดไป อันดับเด่น ชุมชนและสปอนเซอร์ | ลิงก์ไปทัวร์/ผล/Ranking, Discord, โฆษณา และข้อมูลรวมตามระบบเดิม |
| `/tournaments` | ค้นหา กรองสถานะ การ์ดรายการ และ pagination | query parameters เดิม ผลลัพธ์ว่าง และการกด Back/Forward |
| `/tournaments/[id]` | ข้อมูลรายการ เมนูข้ามไปสาย/ผล/ทีม/เรื่องราว และเนื้อหาเดิมที่จัดลำดับใหม่ | สายแข่ง ตารางคะแนน รายชื่อ ผลแมตช์ เรื่องราว สมัคร Solo เชียร์ และทางไปทายผลตามเงื่อนไขเดิม |

หน้าแรกใช้ข้อมูล `ONGOING` เป็นลำดับแรก ตามด้วย `UPCOMING` ถ้าไม่มีรายการให้ใช้ empty state ตามจริง ไม่สร้างสถานะ LIVE หรือเวลานับถอยหลังจากข้อมูลที่ API ไม่ได้ให้

หน้ารายการคงตัวกรองที่ API รองรับจริง ได้แก่ข้อความค้นหาและสถานะ ใน sprint นี้ไม่เพิ่ม game-filter API ใหม่ หากแบบมีช่องชื่อเกมให้ใช้เป็นข้อมูลประกอบจนกว่าจะมีงานรองรับตัวกรองแยกต่างหาก

เมนูหลักเน้นหน้าแรก ทัวร์นาเมนต์ Ranking และผลแข่ง โดยทุกฟีเจอร์เดิมยังเข้าถึงได้ เมนูอื่นอยู่ในส่วนเพิ่มเติมได้ แต่ต้องไม่ทำให้เส้นทางเดิมหายไป

## ข้อเลือกด้านการออกแบบ

- แบบหลักเป็น dark theme โทนดำ เทา แดง ขาว และต้องรักษาการใช้ light theme ของระบบเดิม
- ฟอนต์ไทยในแบบคือ **IBM Plex Sans Thai**; อังกฤษและตัวเลข display ใช้ **Barlow Condensed**
- Source ปัจจุบันยัง import IBM Plex Sans Thai Looped ต้องเปลี่ยนแพ็กเกจ/import/token ของเว็บใน implementation PR พร้อมตรวจภาษาไทยและ font loading
- ออกแบบที่ desktop 1440 และ mobile 390 พิกเซล และตรวจช่วงกลางที่ 768 พิกเซลด้วย
- ใช้ชื่อและภาพที่ backend รองรับ ถ้ายังไม่มีรูปให้ใช้ fallback ที่ตั้งใจออกแบบ ไม่เพิ่มช่องภาพปกหรือ CMS ใน sprint นี้
- โครงมือถือให้สายแข่งเลื่อนภายในกรอบของตัวเอง ไม่ดัน document ทั้งหน้าให้กว้างเกินจอ
- Prototype ใช้สื่อ flow และหน้าตา การกดได้ใน Figma ไม่ได้ยืนยันว่า business logic พร้อมใช้งาน

## Foundation ที่รวมในงาน

- สร้าง feature components สำหรับ home/tournaments และแยก public navigation ให้ตรวจผลกระทบกับหลังบ้านได้
- แยก loading, empty, not found และ error states; error ที่ผู้ชมเห็นต้องเป็นภาษาผู้ใช้ ไม่บอกให้ตรวจ API configuration
- ใช้ scoped CSS กับส่วนใหม่ แยก tokens ที่ใช้ร่วม และคงการทำงานของ UI เดิมนอก 3 หน้านี้
- สร้าง shared components เฉพาะที่ใช้จริง เช่น Button, StatusBadge, TournamentCard, MatchCard และ SectionHeader
- เก็บ auth และ API key ฝั่ง server คงขอบเขต cache 10 วินาทีของข้อมูลร่วม ไม่ cache wallet/picks/admin ร่วมกับผู้ชม
- ใช้ routes และ API response เดิม ไม่เปลี่ยน schema หรือการคำนวณอันดับ

การย้าย backend เป็น hexagonal, แก้ identity/ranking ทั้งระบบ, ออกแบบหลังบ้านใหม่ และสร้างระบบ backup/deploy/staging อัตโนมัติ อยู่ในงานต่อเนื่อง ดู [Architecture](architecture.md)

## แผน 5 วัน

| วัน | ผลงาน |
| --- | --- |
| 1 | เปิดระบบทดสอบแยก เก็บ baseline ตรวจ Figma และปิดประเด็น design ที่ขวาง 3 หน้า |
| 2 | ทำ tokens/components, public navigation และหน้าแรก |
| 3 | ทำรายการทัวร์ การค้นหา สถานะ และ pagination |
| 4 | ทำรายละเอียดทัวร์ เชื่อม bracket/form เดิม และเก็บ mobile layout |
| 5 | ตรวจ regression เทียบ Figma แก้บั๊ก และเตรียม release/rollback |

เวลานี้เป็นเป้าหมายภายใต้ขอบเขตที่จำกัด ไม่ใช่รับรองว่า backend findings จะถูกแก้พร้อมกัน ถ้า baseline build/tests ไม่ผ่าน หรือ design ยังมีข้อขัดแย้งสำคัญ ให้บันทึก blocker และผลต่อเวลาให้ชัดก่อนขยายงาน

## เกณฑ์รับงาน

### การใช้งานและข้อมูล

- [ ] ทั้ง 3 หน้าใช้ข้อมูลจริงจาก test API ไม่ฝังตัวเลข ทีม ผลแข่ง หรือวันเวลาจากข้อมูลสาธิตใน Figma
- [ ] การค้นหา/สถานะ/pagination ใช้ URL เดิมและ Back/Forward ได้
- [ ] ใช้ได้กับก่อนเริ่ม ระหว่างแข่ง จบแล้ว ไม่มีข้อมูล ไม่พบรายการ และโหลดผิดพลาด
- [ ] รายการที่ยัง draft ไม่เปิดเผยสายให้ผู้ชมก่อนเงื่อนไขเดิมอนุญาต
- [ ] ตรวจ Single/Double Elimination, Round Robin และรายการไม่มี bracket ตามโค้ดเดิม
- [ ] ตรวจ Solo signup, cheer, stories, rosters และลิงก์ทายผลไม่หายหรือถูกตัดด้วย layout ใหม่
- [ ] ไม่เปลี่ยน auth, API contracts, admin behavior หรือ Discord business logic

### หน้าตาและการเข้าถึง

- [ ] ตรวจที่ 390, 768, 1440 พิกเซล ไม่มี document overflow แนวนอน
- [ ] ชื่อทีม/รายการยาว รูปหาย โลโก้ไม่มี และจำนวนทีมมากไม่ทำให้ข้อมูลทับกัน
- [ ] โฟกัสคีย์บอร์ดชัด ปุ่มกดได้สะดวก และสถานะสื่อด้วยข้อความประกอบสี
- [ ] ตรวจภาษาไทยจริง สระ/วรรณยุกต์ และ line height หลังเปลี่ยนฟอนต์
- [ ] Light theme ยังใช้งานได้ แม้ Figma ชุดแรกเน้น dark theme
- [ ] เปรียบเทียบหน้าจอจริงกับ Figma และบันทึกความต่างที่ตกลงแล้ว

### การตรวจโค้ด

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

รันกับ environment ทดสอบเท่านั้น ปรับ E2E ที่ผูกกับข้อความ/CSS เดิมให้ตรวจพฤติกรรมผู้ใช้ และไม่ลด coverage เพียงเพื่อให้ UI ใหม่ผ่าน tests ระบุ commit และผล checks จริงใน PR

## Release และ rollback

1. ยืนยัน backup/restore ที่ใช้ได้ของ SQLite, uploads และ bot state เก็บ configuration/secrets แยกจาก Git
2. ทดสอบด้วยข้อมูลตัวอย่างหรือข้อมูลที่ลบส่วนอ่อนไหวแล้วใน environment แยก ไม่ชี้ E2E ไป production
3. เก็บ release/build/config เวอร์ชันก่อนหน้า และตรวจขั้นตอนคืนเวอร์ชันให้ทำซ้ำได้
4. ปล่อยนอกช่วงไลฟ์ 18:00–24:00 เวลา Asia/Bangkok ตาม requirement ที่ใช้วางแผน
5. Smoke test ทั้งผู้ชม สมาชิก และผู้จัด ตรวจ API/bot ต่อเนื่อง หากเส้นทางหลักเสียให้ rollback แล้วตรวจซ้ำ

Sprint นี้ไม่เปลี่ยน schema จึงไม่ควรต้อง rollback database เพียงเพราะย้อน UI release หากมีงานเขียนข้อมูลเพิ่มนอกขอบเขต ต้องทำแผน recovery ใหม่ก่อนปล่อย
