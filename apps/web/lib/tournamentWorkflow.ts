import type { Tournament } from "./types";

export const bracketStatusLabel = {
  NONE: "ยังไม่จัดสาย", DRAFT: "สายฉบับร่าง", LIVE: "กำลังแข่ง", DONE: "จบสายแล้ว",
} as const;

export function registrationLabel(t: Tournament, teams: number) {
  if (t.status === "COMPLETED" || t.bracketStatus === "DONE") return "สิ้นสุดการรับสมัคร";
  if (t.bracketStatus === "LIVE" || !t.registrationOpen) return "ปิดรับสมัคร";
  // The solo API treats any confirmed tournament teams as a completed draw.
  if (t.entryMode === "SOLO" && teams > 0) return "สุ่มทีมแล้ว / ปิดรับสมัคร";
  if (t.maxTeams != null && teams >= t.maxTeams) return "ทีมครบแล้ว";
  return "เปิดรับสมัคร";
}

/** Guidance only; the backend remains responsible for eligibility and transitions. */
export function tournamentNextStep(t: Tournament, teams: number, drawn = false, signups = 0) {
  if (t.bracketStatus === "DONE" || t.status === "COMPLETED")
    return { label: "ตรวจผลและอันดับสุดท้าย", target: t.format ? "bracket" : "register", description: "ตรวจผลการแข่งขันและอันดับ ก่อนเผยแพร่หน้ารายการ" };
  if (t.bracketStatus === "LIVE")
    return { label: "จัดการแมตช์ที่กำลังแข่ง", target: "bracket", description: "ตั้งเวลา บันทึกผล และตรวจเรื่องแย้งผลในสายการแข่งขัน" };
  if (!t.format)
    return { label: "บันทึกผลการแข่งขัน", target: "results", description: "รายการนี้ไม่ใช้สายการแข่งขัน เพิ่มผลแต่ละแมตช์และระบุอันดับทีมเมื่อจบรายการ" };
  if (t.bracketStatus === "DRAFT")
    return { label: "ตรวจสายและยืนยันเริ่มแข่ง", target: "bracket", description: "ตรวจทีมและตำแหน่งในสายก่อนเริ่ม ระบบจะปิดรับสมัครเมื่อเริ่มแข่ง" };
  if (t.entryMode === "SOLO" && !drawn)
    return !t.registrationOpen && signups === 0
      ? { label: "ตั้งค่าการรับสมัครเดี่ยว", target: "settings", description: "ตรวจรูปแบบ จำนวนคนต่อทีม และเปิดรับสมัครก่อนรวบรวมรายชื่อ" }
      : { label: "ตรวจรายชื่อและสุ่มทีม", target: "draw", description: "ตรวจผู้สมัครเดี่ยว สุ่มทีม แล้วตรวจและยืนยันรายชื่อก่อนจัดสาย" };
  if (teams >= 2)
    return { label: "จัดสายการแข่งขัน", target: "bracket", description: "เลือกจัดตามเรตติ้ง สุ่ม หรือจัดเอง แล้วตรวจสายฉบับร่าง" };
  return { label: t.registrationOpen ? "ตรวจทีมที่สมัคร" : "ตั้งค่าการรับสมัคร", target: t.registrationOpen ? "register" : "settings", description: "ต้องมีอย่างน้อย 2 ทีมจึงจะจัดสายได้ ตรวจจำนวนผู้เล่นและการรับสมัครก่อนเริ่ม" };
}
