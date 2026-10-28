import Link from "@/components/LoadingLink";
import { api, qs } from "@/lib/api";
import { currentGame } from "@/lib/games";
import type { SpecialSeason } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Empty } from "@/components/ui";
import { GameTabs } from "@/components/GameTabs";
import { ListHead } from "@/components/admin/ListParts";
import { SeasonForm } from "@/components/admin/SeasonAdmin";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "ซีซั่น เล่นเก่งปากเก่ง" };

/** Seasons of the special events: each lists the players (name + UID) allowed to play in its events. */
export default async function AdminSeasons({ searchParams }: { searchParams: Promise<{ game?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const { games, game } = await currentGame(sp.game);
  const { data } = await api<{ data: SpecialSeason[] }>(`/special/seasons${qs({ gameId: game?.id })}`);
  return (
    <>
      <ListHead
        title={`ซีซั่น เล่นเก่งปากเก่ง${games.length > 1 && game ? ` · ${game.name}` : ""}`}
        sub="ใส่รายชื่อผู้เล่น (ชื่อ + UID) ของแต่ละซีซั่น ทัวร์ที่ผูกกับซีซั่นจะรับเฉพาะคนที่มีชื่อ MMR เล่นเก่งปากเก่งสะสมต่อจากซีซั่นก่อน ไม่รีเซ็ต"
        action={{ href: "/special", label: "ดูหน้าเว็บ" }}
      />
      <GameTabs games={games} active={game?.id ?? null} />
      <SeasonForm games={games} gameId={game?.id} />
      {data.length === 0 ? (
        <Empty>ยังไม่มีซีซั่น สร้างซีซั่นแรกด้านบน</Empty>
      ) : (
        <div className="table-wrap admin-table">
          <table>
            <thead>
              <tr><th>ซีซั่น</th><th>ช่วงเวลา</th><th className="num">ผู้เล่น</th><th className="num">ทัวร์</th><th /></tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/admin/seasons/${s.id}`}><strong>{s.name}</strong></Link></td>
                  <td className="small">{fmtDate(s.startDate)} – {s.endDate ? fmtDate(s.endDate) : "ไม่กำหนด"}</td>
                  <td className="num">{s.players}</td>
                  <td className="num">{s.events}</td>
                  <td><Link className="btn btn-sm" href={`/admin/seasons/${s.id}`}>จัดการรายชื่อ</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
