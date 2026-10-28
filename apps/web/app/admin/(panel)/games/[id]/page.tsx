import Link from "@/components/LoadingLink";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import type { Game } from "@/lib/types";
import { RankEditor } from "@/components/admin/RankEditor";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "แรงค์ในเกม" };

export default async function GameRanks({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const game = await apiOrNull<Game>(`/games/${encodeURIComponent((await params).id)}`);
  if (!game) notFound();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>แรงค์ในเกม: {game.name}</h1>
          <p className="muted" style={{ margin: 0 }}>เรียงจากต่ำไปสูง ผู้เล่นเลือกแรงค์ตอนลงทัวร์เดี่ยว และระบบใช้คละทีมให้แรงค์สูงอยู่กับแรงค์น้อย</p>
        </div>
        <Link className="btn btn-sm" href="/admin/games">← กลับไปหน้าเกม</Link>
      </div>
      <RankEditor gameId={game.id} initial={game.ranks ?? []} />
    </>
  );
}
