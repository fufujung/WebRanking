import type { Tournament } from "@/lib/types";
import { fmtDate, fmtThaiTime, formatLabel, statusLabel } from "@/lib/format";
import { bracketStatusLabel, registrationLabel } from "@/lib/tournamentWorkflow";

export function TournamentSummary({ tournament: t, teams }: { tournament: Tournament; teams: number }) {
  return (
    <dl className="tournament-facts">
      <div><dt>สถานะรายการ</dt><dd>{statusLabel[t.status]}</dd></div>
      <div><dt>การรับสมัคร</dt><dd>{registrationLabel(t, teams)}</dd></div>
      <div><dt>สถานะสาย</dt><dd>{t.format ? bracketStatusLabel[t.bracketStatus] : "ไม่ใช้สายการแข่งขัน"}</dd></div>
      <div><dt>รูปแบบ</dt><dd>{t.format ? `${formatLabel[t.format]} · BO${t.bestOf}` : "บันทึกผลรายแมตช์"}</dd></div>
      <div><dt>การลงทะเบียน</dt><dd>{t.entryMode === "SOLO" ? `ลงเดี่ยว · จัดทีมละ ${t.teamSize ?? 3} คน` : "สมัครเป็นทีม"}</dd></div>
      <div><dt>จำนวนทีม</dt><dd>{teams}{t.maxTeams != null ? ` / ${t.maxTeams} ทีม` : " ทีม · ไม่จำกัดจำนวน"}</dd></div>
      <div><dt>ผู้เล่นต่อทีม</dt><dd>{t.rosterMin}–{t.rosterMax} คน</dd></div>
      <div><dt>วันเวลาเริ่ม (ไทย)</dt><dd>{fmtThaiTime(t.startDate)}{t.endDate ? ` ถึง ${fmtDate(t.endDate)}` : ""}</dd></div>
    </dl>
  );
}
