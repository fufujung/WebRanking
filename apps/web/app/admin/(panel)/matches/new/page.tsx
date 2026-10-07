import Link from "next/link";
import { api } from "@/lib/api";
import { fetchAll } from "@/lib/fetchAll";
import type { Player, Team, Tournament } from "@/lib/types";
import { MatchForm } from "@/components/admin/MatchForm";

export const metadata = { title: "บันทึกผลการแข่ง" };

export default async function NewMatch({ searchParams }: { searchParams: Promise<{ tournamentId?: string }> }) {
  const [sp, tournaments, teams, players, extract] = await Promise.all([
    searchParams,
    fetchAll<Tournament>("/tournaments"),
    fetchAll<Team>("/teams"),
    fetchAll<Player>("/players"),
    api<{ enabled: boolean }>("/extract/status"),
  ]);
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
      <h1>บันทึกผลการแข่ง</h1>
      <MatchForm
        tournaments={tournaments}
        teams={teams}
        players={players}
        defaultTournamentId={tournaments.some((t) => t.id === sp.tournamentId) ? sp.tournamentId : undefined}
        extractEnabled={extract.enabled}
      />
    </>
  );
}
