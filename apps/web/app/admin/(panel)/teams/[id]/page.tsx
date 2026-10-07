import Link from "next/link";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import type { TeamDetail } from "@/lib/types";
import { TeamForm } from "@/components/admin/TeamForm";
import { DeleteButton } from "@/components/admin/DeleteButton";

export const metadata = { title: "แก้ไขทีม" };

export default async function EditTeam({ params }: { params: Promise<{ id: string }> }) {
  const team = await apiOrNull<TeamDetail>(`/teams/${encodeURIComponent((await params).id)}`);
  if (!team) notFound();
  return (
    <>
      <div className="page-head">
        <h1>แก้ไขทีม: {team.name}</h1>
        <div className="row">
          <Link className="btn btn-sm" href={`/teams/${team.id}`}>ดูหน้าทีม</Link>
          <Link className="btn btn-sm" href={`/admin/players/new?teamId=${team.id}`}>+ เพิ่มผู้เล่นในทีมนี้</Link>
          <DeleteButton kind="teams" id={team.id} label={`ทีม ${team.name} (แมตช์ของทีมนี้จะถูกลบด้วย)`} />
        </div>
      </div>
      <TeamForm team={team} />
      <h2 className="mt">ผู้เล่น ({team.players.length})</h2>
      <div className="stack" style={{ gap: 8 }}>
        {team.players.map((p) => (
          <Link key={p.id} href={`/admin/players/${p.id}`} className="card card-link row between" style={{ padding: 12 }}>
            <span>{p.name}</span><span className="muted small">แก้ไข →</span>
          </Link>
        ))}
      </div>
    </>
  );
}
