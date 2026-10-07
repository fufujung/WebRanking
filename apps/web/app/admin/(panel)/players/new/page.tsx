import { fetchAll } from "@/lib/fetchAll";
import type { Team } from "@/lib/types";
import { PlayerForm } from "@/components/admin/PlayerForm";

export const metadata = { title: "เพิ่มผู้เล่น" };

export default async function NewPlayer({ searchParams }: { searchParams: Promise<{ teamId?: string; added?: string }> }) {
  const sp = await searchParams;
  const teams = await fetchAll<Team>("/teams");
  return (
    <>
      <h1>เพิ่มผู้เล่น</h1>
      {sp.added && <div className="success" style={{ marginBottom: 16 }}>เพิ่มผู้เล่นแล้ว เพิ่มคนต่อไปได้เลย</div>}
      <PlayerForm key={sp.added ? Date.now() : "new"} teams={teams} defaultTeamId={sp.teamId || undefined} />
    </>
  );
}
