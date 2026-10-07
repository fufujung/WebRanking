import Link from "next/link";
import { notFound } from "next/navigation";
import { api, apiOrNull } from "@/lib/api";
import { fetchAll } from "@/lib/fetchAll";
import type { MatchDetail, Player, Team, Tournament } from "@/lib/types";
import { MatchForm } from "@/components/admin/MatchForm";
import { DeleteButton } from "@/components/admin/DeleteButton";

export const metadata = { title: "แก้ไขผลการแข่ง" };

export default async function EditMatch({ params }: { params: Promise<{ id: string }> }) {
  const [match, tournaments, teams, players, extract] = await Promise.all([
    apiOrNull<MatchDetail>(`/matches/${encodeURIComponent((await params).id)}`),
    fetchAll<Tournament>("/tournaments"),
    fetchAll<Team>("/teams"),
    fetchAll<Player>("/players"),
    api<{ enabled: boolean }>("/extract/status"),
  ]);
  if (!match) notFound();
  return (
    <>
      <div className="page-head">
        <h1>แก้ไขผล: {match.teamA.name} vs {match.teamB.name}</h1>
        <div className="row">
          <Link className="btn btn-sm" href={`/matches/${match.id}`}>ดูหน้าแมตช์</Link>
          <DeleteButton kind="matches" id={match.id} label={`แมตช์ ${match.teamA.name} vs ${match.teamB.name}`} />
        </div>
      </div>
      <MatchForm match={match} tournaments={tournaments} teams={teams} players={players} extractEnabled={extract.enabled} />
    </>
  );
}
