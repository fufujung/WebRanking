import Link from "next/link";
import { api } from "@/lib/api";
import { fetchAll } from "@/lib/fetchAll";
import type { Match, Page, Player, Team, Tournament } from "@/lib/types";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Empty, StatusBadge } from "@/components/ui";
import { DeleteButton } from "@/components/admin/DeleteButton";
import { AdminSearch } from "@/components/admin/AdminSearch";

export const metadata = { title: "จัดการข้อมูล" };

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const sp = await searchParams;
  const [teams, players, tournaments, matches, extract] = await Promise.all([
    fetchAll<Team>("/teams"),
    fetchAll<Player>("/players"),
    fetchAll<Tournament>("/tournaments"),
    api<Page<Match>>("/matches?limit=20"),
    api<{ enabled: boolean }>("/extract/status"),
  ]);
  return (
    <>
      <div className="page-head">
        <h1>จัดการข้อมูล</h1>
        <Link className="btn btn-primary" href="/admin/matches/new">+ บันทึกผลการแข่ง</Link>
      </div>
      {sp.deleted && <div className="success" style={{ marginBottom: 16 }}>ลบเรียบร้อยแล้ว</div>}
      {!extract.enabled && (
        <div className="notice small" style={{ marginBottom: 16 }}>
          ระบบอ่านผลจากรูปยังไม่เปิด (ตั้งค่า ANTHROPIC_API_KEY ที่เซิร์ฟเวอร์ API) ตอนนี้ยังลากรูปแนบเป็นหลักฐานและพิมพ์กรอกเองได้ตามปกติ
        </div>
      )}

      <AdminSearch
        teams={teams.map((t) => ({ id: t.id, label: t.name, sub: t.tag ?? "" }))}
        players={players.map((p) => ({ id: p.id, label: p.name, sub: p.team?.name ?? "ไม่มีสังกัด" }))}
        tournaments={tournaments.map((t) => ({ id: t.id, label: t.name, sub: fmtDate(t.startDate) }))}
      />

      <h2 className="mt">ผลการแข่งล่าสุด</h2>
      {matches.data.length === 0 ? <Empty>ยังไม่มีผลการแข่ง</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>วันที่</th><th>รายการ</th><th>คู่แข่ง</th><th className="num">สกอร์</th><th /></tr></thead>
            <tbody>
              {matches.data.map((m) => (
                <tr key={m.id}>
                  <td className="muted">{fmtDateTime(m.playedAt)}</td>
                  <td>{m.tournament.name}{m.round ? <span className="muted small"> · {m.round}</span> : null}</td>
                  <td>{m.teamA.name} vs {m.teamB.name}</td>
                  <td className="num">{m.scoreA} : {m.scoreB}</td>
                  <td className="right">
                    <span className="row" style={{ justifyContent: "flex-end" }}>
                      <Link className="btn btn-sm" href={`/admin/matches/${m.id}`}>แก้ไข</Link>
                      <DeleteButton kind="matches" id={m.id} label={`แมตช์ ${m.teamA.name} vs ${m.teamB.name}`} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-3 mt">
        <section>
          <h2>ทัวร์นาเมนต์ ({tournaments.length})</h2>
          <div className="stack" style={{ gap: 8 }}>
            {tournaments.slice(0, 15).map((t) => (
              <Link key={t.id} href={`/admin/tournaments/${t.id}`} className="card card-link row between" style={{ padding: 12 }}>
                <span>{t.name}</span><StatusBadge status={t.status} />
              </Link>
            ))}
            {tournaments.length === 0 && <Empty>ยังไม่มี</Empty>}
          </div>
        </section>
        <section>
          <h2>ทีม ({teams.length})</h2>
          <div className="stack" style={{ gap: 8 }}>
            {teams.slice(0, 15).map((t) => (
              <Link key={t.id} href={`/admin/teams/${t.id}`} className="card card-link row between" style={{ padding: 12 }}>
                <span>{t.name}</span><span className="muted small">{t.playerCount} คน</span>
              </Link>
            ))}
            {teams.length === 0 && <Empty>ยังไม่มี</Empty>}
          </div>
        </section>
        <section>
          <h2>ผู้เล่น ({players.length})</h2>
          <div className="stack" style={{ gap: 8 }}>
            {players.slice(0, 15).map((p) => (
              <Link key={p.id} href={`/admin/players/${p.id}`} className="card card-link row between" style={{ padding: 12 }}>
                <span>{p.name}</span><span className="muted small">{p.team?.name ?? "-"}</span>
              </Link>
            ))}
            {players.length === 0 && <Empty>ยังไม่มี</Empty>}
          </div>
        </section>
      </div>
    </>
  );
}
