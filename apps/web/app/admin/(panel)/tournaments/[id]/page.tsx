import Link from "next/link";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import { fetchAll } from "@/lib/fetchAll";
import type { Bracket, Team, TournamentDetail } from "@/lib/types";
import { TournamentForm } from "@/components/admin/TournamentForm";
import { EntryManager } from "@/components/admin/EntryManager";
import { DeleteButton } from "@/components/admin/DeleteButton";
import { BracketAdmin } from "@/components/admin/BracketAdmin";
import { RosterManager } from "@/components/admin/RosterManager";

export const metadata = { title: "แก้ไขทัวร์นาเมนต์" };

export default async function EditTournament({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const [t, teams, sp] = await Promise.all([
    apiOrNull<TournamentDetail>(`/tournaments/${encodeURIComponent((await params).id)}`),
    fetchAll<Team>("/teams"),
    searchParams,
  ]);
  if (!t) notFound();
  const bracket = t.format ? await apiOrNull<Bracket>(`/tournaments/${t.id}/bracket`) : null;
  return (
    <>
      <div className="page-head">
        <h1>{t.name}</h1>
        <div className="row">
          <Link className="btn btn-sm" href={`/tournaments/${t.id}`}>ดูหน้ารายการ</Link>
          <Link className="btn btn-sm btn-primary" href={`/admin/matches/new?tournamentId=${t.id}`}>+ บันทึกผลการแข่งในรายการนี้</Link>
          <DeleteButton kind="tournaments" id={t.id} label={`ทัวร์นาเมนต์ ${t.name} (แมตช์ทั้งหมดในรายการจะถูกลบด้วย)`} />
        </div>
      </div>
      {sp.saved && <div className="success" style={{ marginBottom: 16 }}>บันทึกแล้ว</div>}
      <TournamentForm tournament={t} />
      {t.format && (
        <>
          <h2 className="mt" id="bracket">สายการแข่งขัน</h2>
          <BracketAdmin tournamentId={t.id} format={t.format} bracket={bracket} entries={bracket?.teams ?? t.teams} />
        </>
      )}
      <h2 className="mt">ทีมที่ลงแข่ง ({t.teams.length})</h2>
      <p className="muted small">
        {t.format
          ? "ทีมสมัครเองผ่าน Discord (/register) หรือผู้จัดเพิ่มที่นี่ก่อนเริ่มแข่ง อันดับสุดท้ายจะลงให้อัตโนมัติเมื่อจบสาย"
          : "ทีมจะถูกเพิ่มอัตโนมัติเมื่อบันทึกผลการแข่ง หรือเพิ่มเองล่วงหน้าได้ที่นี่ ใส่อันดับสุดท้ายเมื่อจบรายการ"}
      </p>
      <EntryManager tournamentId={t.id} entries={t.teams} teams={teams} />
      {t.format && bracket && (
        <>
          <h2 className="mt">รายชื่อผู้เล่น</h2>
          <RosterManager tournamentId={t.id} entries={bracket.teams} rosterMin={t.rosterMin} rosterMax={t.rosterMax} locked={bracket.rosterLocked} lockAt={bracket.rosterLockAt} />
        </>
      )}
    </>
  );
}
