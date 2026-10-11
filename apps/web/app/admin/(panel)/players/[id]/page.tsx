import Link from "next/link";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import { fetchAll } from "@/lib/fetchAll";
import type { Player, PlayerDetail, Team } from "@/lib/types";
import { PlayerForm } from "@/components/admin/PlayerForm";
import { DeleteButton } from "@/components/admin/DeleteButton";
import { MergePlayer } from "@/components/admin/MergePlayer";
import { UnlinkDiscord } from "@/components/admin/UnlinkDiscord";

export const metadata = { title: "แก้ไขผู้เล่น" };

export default async function EditPlayer({ params }: { params: Promise<{ id: string }> }) {
  const [player, teams, players] = await Promise.all([
    apiOrNull<PlayerDetail>(`/players/${encodeURIComponent((await params).id)}`),
    fetchAll<Team>("/teams"),
    fetchAll<Player>("/players"),
  ]);
  if (!player) notFound();
  const others = players
    .filter((p) => p.id !== player.id)
    .map((p) => ({ id: p.id, name: p.name, tag: [p.team?.name, p.uid && `UID ${p.uid}`].filter(Boolean).join(" · ") || null, logoUrl: p.avatarUrl }));
  return (
    <>
      <div className="page-head">
        <h1>แก้ไขผู้เล่น: {player.name}</h1>
        <div className="row">
          <Link className="btn btn-sm" href={`/players/${player.id}`}>ดูหน้าผู้เล่น</Link>
          <DeleteButton kind="players" id={player.id} label={`ผู้เล่น ${player.name} (สถิติรายแมตช์จะถูกลบด้วย)`} />
        </div>
      </div>
      {player.discordId && <div style={{ marginBottom: 16 }}><UnlinkDiscord playerId={player.id} discordId={player.discordId} /></div>}
      <PlayerForm key={`${player.name}-${player.uid}`} player={player} teams={teams} />
      {player.names.length > 0 && (
        <p className="muted small" style={{ marginTop: 10 }}>เคยใช้ชื่อ: {player.names.map((n) => n.name).join(", ")}</p>
      )}
      <div className="mt"><MergePlayer playerId={player.id} playerName={player.name} others={others} /></div>
    </>
  );
}
