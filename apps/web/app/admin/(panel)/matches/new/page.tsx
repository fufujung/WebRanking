import Link from "next/link";
import { api, apiOrNull } from "@/lib/api";
import { fetchAll } from "@/lib/fetchAll";
import type { BracketSlot, Player, Team, Tournament } from "@/lib/types";
import { MatchForm, type BracketTarget } from "@/components/admin/MatchForm";

export const metadata = { title: "บันทึกผลการแข่ง" };

export default async function NewMatch({ searchParams }: { searchParams: Promise<{ tournamentId?: string; slot?: string }> }) {
  const [sp, tournaments, teams, players, extract] = await Promise.all([
    searchParams,
    fetchAll<Tournament>("/tournaments"),
    fetchAll<Team>("/teams"),
    fetchAll<Player>("/players"),
    api<{ enabled: boolean }>("/extract/status"),
  ]);
  // Recording a bracket match: the bracket decides the teams.
  const slot =
    sp.tournamentId && sp.slot
      ? await apiOrNull<BracketSlot & { tournament: { id: string; name: string } }>(`/tournaments/${encodeURIComponent(sp.tournamentId)}/bracket/matches/${encodeURIComponent(sp.slot)}`)
      : null;
  if (sp.slot && (!slot || !slot.teamA || !slot.teamB || slot.status === "PENDING" || slot.status === "SKIPPED" || slot.outcome === "BYE" || slot.matchId)) {
    return (
      <div className="card empty">
        <h1>บันทึกผลแมตช์นี้ไม่ได้</h1>
        <p>{!slot ? "ไม่พบแมตช์ในสาย" : slot.matchId ? "แมตช์นี้บันทึกผลไว้แล้ว ให้แก้จากหน้าแก้ไขผล" : "แมตช์นี้ยังไม่พร้อมแข่ง (รอทีมจากรอบก่อน)"}</p>
        <div className="row" style={{ justifyContent: "center" }}>
          {slot?.matchId && <Link className="btn btn-primary" href={`/admin/matches/${slot.matchId}`}>แก้ไขผล</Link>}
          <Link className="btn" href={`/admin/tournaments/${encodeURIComponent(sp.tournamentId ?? "")}#bracket`}>กลับไปที่สาย</Link>
        </div>
      </div>
    );
  }
  const target: BracketTarget | undefined =
    slot && slot.teamA && slot.teamB
      ? {
          tournamentId: slot.tournament.id,
          id: slot.id,
          title: `M${slot.number} · ${slot.label}`,
          replace: slot.status === "DONE",
          teamA: { id: slot.teamA.id, name: slot.teamA.name },
          teamB: { id: slot.teamB.id, name: slot.teamB.name },
        }
      : undefined;
  const rosters = slot
    ? Object.fromEntries([slot.teamA, slot.teamB].filter((e) => e !== null).map((e) => [e.id, e.roster.map((p) => ({ id: p.playerId, name: p.name }))]))
    : undefined;
  if (tournaments.length === 0) {
    return (
      <div className="card empty">
        <h1>ยังบันทึกผลไม่ได้</h1>
        <p>ต้องมีทัวร์นาเมนต์อย่างน้อย 1 รายการก่อน</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link className="btn" href="/admin/tournaments/new">+ ทัวร์นาเมนต์</Link>
          <Link className="btn" href="/admin/teams/new">+ ทีม</Link>
        </div>
      </div>
    );
  }
  return (
    <>
      <h1>{target ? `บันทึกผล ${slot!.tournament.name} · ${target.title}` : "บันทึกผลการแข่ง"}</h1>
      <MatchForm
        tournaments={tournaments}
        teams={teams}
        players={players}
        defaultTournamentId={tournaments.some((t) => t.id === sp.tournamentId) ? sp.tournamentId : undefined}
        extractEnabled={extract.enabled}
        slot={target}
        rosters={rosters}
      />
    </>
  );
}
