# เอกสาร The Ranking

เอกสารชุดนี้ใช้ส่งต่องานปรับ UI และวาง foundation ของ The Ranking / Overtime สำหรับคนที่รับช่วงดูแลเว็บ API และ Discord bot ต่อจากระบบเดิม

**ข้อสรุป:** ใช้ monorepo และ stack เดิมต่อ ปรับ UI ผู้ชมก่อน แล้วค่อยแยก backend เป็นโมดูลตามงานและใช้หลัก hexagonal architecture ภายในแต่ละโมดูล การสร้างเอกสารนี้ยังไม่ได้เปลี่ยน implementation หรือ deploy ระบบ

## เริ่มอ่านตามงานที่ต้องทำ

| งาน | เอกสาร |
| --- | --- |
| เข้าใจระบบและ tech stack | [Current state](current-state.md) |
| ตรวจจุดเสี่ยงและเลือกงานแก้ | [Technical review](technical-review.md) |
| เข้าใจ architecture ปัจจุบันและเป้าหมาย | [Architecture](architecture.md) |
| ลงมือทำ sprint หน้าเว็บผู้ชม | [Public UI sprint](public-ui-sprint.md) |
| เปิด Figma ขอรีวิว หรือส่งต่องานออกแบบ | [Figma review and handoff](figma-review.md) |
| ใช้งานฟีเจอร์ ตั้งค่าเว็บ API และบอท | [คู่มือใน README หลัก](../README.md) |

## สถานะและขอบเขตหลักฐาน

- วันที่สรุป: **25 ตุลาคม 2026** ตามเวลา Asia/Bangkok
- โค้ดที่ตรวจ: `a7866c7a421c84f2e373a324ff241f6391554471` บน `main`
- Branch เอกสาร: `docs/rewrite-docs`
- Branch งาน UI ที่ผู้ดูแลเลือก: `feat/revise-public-ui`
- แผนที่ตกลง: ผู้พัฒนา 1 คน เวลา 1 สัปดาห์ ทำหน้าแรก รายการทัวร์ และรายละเอียดทัวร์ ทั้ง desktop/mobile
- ระบบใช้งานจริงแล้ว ต้องรักษาข้อมูล URL และการเชื่อมต่อ Discord
- Figma มีแบบร่าง 6 หน้าจอและองค์ประกอบร่วม ฟอนต์ไทยกลางเปลี่ยนเป็น **IBM Plex Sans Thai** แล้ว แต่ยังมีงานรีวิวและเก็บรายละเอียด ดู [สถานะ Figma](figma-review.md)

ผลการตรวจมาจาก source code, manifests, workflow และ requirement ที่ผู้ดูแลให้บริบทไว้ ไม่ใช่ผลทดสอบ production เอกสารไม่ได้ยืนยันจำนวนผู้ใช้จริง สมรรถนะเครื่อง สถานะ backup หรือผล tests ล่าสุด

ข้อมูลที่ยังไม่ยืนยันให้ใช้คำว่า **ต้องตรวจ**, ข้อเสนอที่ยังไม่ได้ทำให้ใช้ **แผน**, และการตรวจจาก source ให้แสดงไฟล์หลักฐาน หลีกเลี่ยงการเขียนแผนให้ดูเหมือนฟีเจอร์ที่ส่งมอบแล้ว

## การดูแลเอกสาร

- อัปเดตเอกสารใน PR เดียวกับการเปลี่ยน behavior, API หรือวิธีเปิดระบบที่เกี่ยวข้อง
- ถ้าเปลี่ยนขอบเขต sprint ให้แก้ [แผน sprint](public-ui-sprint.md) และ [Figma handoff](figma-review.md) ให้ตรงกัน
- เมื่อแก้ finding ให้เพิ่ม PR/commit และผลการทดสอบใน [technical review](technical-review.md) ก่อนปิดสถานะ
- ใส่ลิงก์ frame Figma และ commit ที่เกี่ยวข้องแทนภาพหน้าจอที่ไม่บอกเวอร์ชัน
- เก็บ credentials, environment จริง, database, uploads และข้อมูลบอทไว้นอก Git
