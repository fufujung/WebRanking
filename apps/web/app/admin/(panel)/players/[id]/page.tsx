import Link from "next/link";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import { fetchAll } from "@/lib/fetchAll";
import type { PlayerDetail, Team } from "@/lib/types";
import { PlayerForm } from "@/components/admin/PlayerForm";
import { DeleteButton } from "@/components/admin/DeleteButton";

export const metadata = { title: "แก้ไขผู้เล่น" };

export default async function EditPlayer({ params }: { params: Promise<{ id: string }> }) {
  const [player, teams] = await Promise.all([
    apiOrNull<PlayerDetail>(`/players/${encodeURIComponent((await params).id)}`),
    fetchAll<Team>("/teams"),
  ]);
  if (!player) notFound();
  return (
    <>
      <div className="page-head">
        <h1>แก้ไขผู้เล่น: {player.name}</h1>
        <div className="row">
          <Link className="btn btn-sm" href={`/players/${player.id}`}>ดูหน้าผู้เล่น</Link>
          <DeleteButton kind="players" id={player.id} label={`ผู้เล่น ${player.name} (สถิติรายแมตช์จะถูกลบด้วย)`} />
        </div>
      </div>
      <PlayerForm player={player} teams={teams} />
    </>
  );
}
