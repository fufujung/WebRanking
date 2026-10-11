import { fetchAll } from "@/lib/fetchAll";
import type { Team } from "@/lib/types";
import { PlayerForm } from "@/components/admin/PlayerForm";
import { allGames } from "@/lib/games";

export const metadata = { title: "เพิ่มผู้เล่น" };

export default async function NewPlayer({ searchParams }: { searchParams: Promise<{ teamId?: string; added?: string }> }) {
  const sp = await searchParams;
  const [teams, games] = await Promise.all([fetchAll<Team>("/teams"), allGames()]);
  return (
    <>
      <h1>เพิ่มผู้เล่น</h1>
      {sp.added && <div className="success" style={{ marginBottom: 16 }}>เพิ่มผู้เล่นแล้ว เพิ่มคนต่อไปได้เลย</div>}
      <PlayerForm key={sp.added ? Date.now() : "new"} teams={teams} games={games} defaultTeamId={sp.teamId || undefined} />
    </>
  );
}
