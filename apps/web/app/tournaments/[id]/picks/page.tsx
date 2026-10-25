import Link from "next/link";
import { notFound } from "next/navigation";
import { apiOrNull, PUBLIC } from "@/lib/api";
import type { Draft, DraftCharStat, DraftSlot, TournamentDetail, TournamentDrafts } from "@/lib/types";
import { fmtThaiTime } from "@/lib/format";
import { Avatar, Empty, StatusBadge } from "@/components/ui";
import { AutoRefresh } from "@/components/AutoRefresh";

export const metadata = { title: "สถิติแบน/พิค" };

function Char({ slot }: { slot: Pick<DraftSlot, "char" | "name" | "kind"> }) {
  const name = slot.name || slot.char;
  return (
    <span className={`pb-char ${slot.kind === "ban" ? "pb-ban" : ""}`} title={slot.kind === "ban" ? `แบน ${name}` : name}>
      <Avatar name={name} />
      <span>{name}</span>
    </span>
  );
}

function Leaders({ title, rows, value }: { title: string; rows: DraftCharStat[]; value: (r: DraftCharStat) => string }) {
  return (
    <div className="card">
      <h3 className="pb-lead-title">{title}</h3>
      {rows.length === 0 ? <p className="muted small">ยังไม่มีข้อมูล</p> : (
        <ol className="pb-leaders">
          {rows.map((r) => (
            <li key={r.char}>
              <span className="entity"><Avatar name={r.name} /><strong>{r.name}</strong></span>
              <span className="muted small nowrap">{value(r)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TeamName({ name, id, side }: { name: string; id: string | null; side: "A" | "B" }) {
  const cls = side === "A" ? "pb-blue" : "pb-red";
  return id ? <Link href={`/teams/${id}`} className={cls}>{name}</Link> : <span className={cls}>{name}</span>;
}

function DraftRow({ d }: { d: Draft }) {
  const of = (side: "A" | "B", kind: "ban" | "pick") => d.slots.filter((s) => s.side === side && s.kind === kind);
  return (
    <div className="card pb-game">
      <div className="row between">
        <span>
          <TeamName name={d.teamA} id={d.teamAId} side="A" /> <span className="muted">vs</span> <TeamName name={d.teamB} id={d.teamBId} side="B" />
          <span className="badge" style={{ marginLeft: 8 }}>เกม {d.gameNo}</span>
        </span>
        <span className="muted small">
          {d.winner ? <>ชนะ: <strong className={d.winner === "A" ? "pb-blue" : "pb-red"}>{d.winner === "A" ? d.teamA : d.teamB}</strong></> : "ยังไม่มีผล"} · {fmtThaiTime(d.playedAt)}
        </span>
      </div>
      <div className="pb-sides">
        {(["A", "B"] as const).map((side) => (
          <div key={side} className={`pb-side ${side === "A" ? "pb-side-blue" : "pb-side-red"}`}>
            <div className="pb-chars">{of(side, "pick").map((s, i) => <Char key={i} slot={s} />)}</div>
            {of(side, "ban").length > 0 && <div className="pb-chars">{of(side, "ban").map((s, i) => <Char key={i} slot={s} />)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function TournamentPicksPage({ params }: { params: Promise<{ id: string }> }) {
  const id = encodeURIComponent((await params).id);
  const [t, drafts] = await Promise.all([
    apiOrNull<TournamentDetail>(`/tournaments/${id}`, PUBLIC),
    apiOrNull<TournamentDrafts>(`/tournaments/${id}/drafts`, { revalidate: 5 }),
  ]);
  if (!t || !drafts) notFound();
  const chars = drafts.characters;
  const top = (key: "picks" | "bans", filter: (r: DraftCharStat) => boolean = () => true) =>
    [...chars].filter(filter).sort((a, b) => b[key] - a[key]).slice(0, 3);
  const best = [...chars].filter((r) => r.wins + r.losses >= 2).sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0) || b.wins - a.wins).slice(0, 3);
  return (
    <>
      {t.status === "ONGOING" && <AutoRefresh seconds={10} />}
      <div className="page-head">
        <div>
          <div className="row" style={{ marginBottom: 8 }}>
            <StatusBadge status={t.status} />
            {t.status === "ONGOING" && <span className="badge badge-accent">● อัปเดตสดระหว่างแข่ง</span>}
          </div>
          <h1>สถิติแบน/พิค</h1>
          <span className="muted">
            <Link href={`/tournaments/${t.id}`}>{t.name}</Link> · {drafts.games} เกม{drafts.games ? ` · มีผลแล้ว ${drafts.decided}` : ""}
          </span>
        </div>
      </div>

      {drafts.games === 0 ? (
        <Empty>ยังไม่มีดราฟของรายการนี้ ระหว่างไลฟ์ บอทจะส่งแบน/พิคของแต่ละเกมขึ้นมาที่นี่</Empty>
      ) : (
        <>
          <div className="grid grid-3">
            <Leaders title="🔥 พิคบ่อยสุด" rows={top("picks", (r) => r.picks > 0)} value={(r) => `${r.picks} ครั้ง · ${r.pickRate}%`} />
            <Leaders title="🚫 แบนบ่อยสุด" rows={top("bans", (r) => r.bans > 0)} value={(r) => `${r.bans} ครั้ง · ${r.banRate}%`} />
            <Leaders title="🏆 อัตราชนะสูงสุด (ลง 2 เกมขึ้นไป)" rows={best} value={(r) => `${r.winRate}% (${r.wins}-${r.losses})`} />
          </div>

          <h2 className="mt">ตัวละครทั้งหมด</h2>
          <p className="muted small">โผล่ในดราฟ = ถูกพิคหรือแบน กี่ % ของเกมทั้งหมด · อัตราชนะนับเฉพาะเกมที่มีผลแล้ว</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>ตัวละคร</th><th className="num">โผล่ในดราฟ</th><th className="num">พิค</th><th className="num">แบน</th><th className="num">ชนะ-แพ้</th><th className="num">อัตราชนะ</th></tr>
              </thead>
              <tbody>
                {chars.map((r) => (
                  <tr key={r.char}>
                    <td><span className="entity"><Avatar name={r.name} /><span>{r.name}</span></span></td>
                    <td className="num">
                      {r.presence}%
                      <div className="pb-bar"><span style={{ width: `${Math.min(100, r.presence)}%` }} /></div>
                    </td>
                    <td className="num">{r.picks} <span className="muted small">({r.pickRate}%)</span></td>
                    <td className="num">{r.bans} <span className="muted small">({r.banRate}%)</span></td>
                    <td className="num">{r.wins}-{r.losses}</td>
                    <td className="num">{r.winRate === null ? "-" : `${r.winRate}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mt">ดราฟแต่ละเกม</h2>
          <p className="muted small"><span className="pb-blue">ฝั่งน้ำเงิน</span> / <span className="pb-red">ฝั่งแดง</span> · ตัวสีเทาขีดฆ่า = ตัวที่ถูกแบน</p>
          <div className="stack">{drafts.data.map((d) => <DraftRow key={d.id} d={d} />)}</div>
        </>
      )}
    </>
  );
}
