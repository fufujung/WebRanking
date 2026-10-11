import Link from "next/link";
import { api } from "@/lib/api";
import { fetchAll } from "@/lib/fetchAll";
import { adminDashboard } from "@/lib/adminData";
import type { Match, Page, Player, Team, Tournament } from "@/lib/types";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Avatar, Empty } from "@/components/ui";
import { TierEmblem } from "@/components/Tier";
import { AdminSearch } from "@/components/admin/AdminSearch";
import { DayBars, Donut, Sparkline } from "@/components/admin/Charts";
import { Icon, type IconName } from "@/components/admin/Icons";

export const metadata = { title: "หลังบ้าน" };

const todayTh = new Intl.DateTimeFormat("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" });

/** Running total from today's count backwards, so a sparkline shows growth. */
function cumulative(total: number, perDay: number[]) {
  const out: number[] = [];
  let n = total;
  for (let i = perDay.length - 1; i >= 0; i--) {
    out.unshift(n);
    n -= perDay[i];
  }
  return out;
}

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const sp = await searchParams;
  const [dash, recent, teams, players, tournaments, extract] = await Promise.all([
    adminDashboard(),
    api<Page<Match>>("/matches?limit=6&sort=created"),
    fetchAll<Team>("/teams"),
    fetchAll<Player>("/players"),
    fetchAll<Tournament>("/tournaments"),
    api<{ enabled: boolean }>("/extract/status"),
  ]);
  const { totals, week, days, todo } = dash;
  const weekChange = week.prevMatches ? Math.round(((week.matches - week.prevMatches) / week.prevMatches) * 100) : null;
  const ranked = dash.tiers.reduce((n, t) => n + t.players, 0);

  const cards: { href: string; label: string; value: number; note: string; tone: string; icon: IconName; spark: number[] }[] = [
    { href: "/admin/teams", label: "ทีมทั้งหมด", value: totals.teams, note: week.newTeams ? `+${week.newTeams} ทีมใน 7 วัน` : "ไม่มีทีมใหม่ใน 7 วัน", tone: "red", icon: "teams", spark: cumulative(totals.teams, days.map((d) => d.newTeams)) },
    { href: "/admin/players", label: "ผู้เล่นทั้งหมด", value: totals.players, note: `${totals.rankedPlayers} คนติด Ranking${week.newPlayers ? ` · +${week.newPlayers} ใหม่` : ""}`, tone: "blue", icon: "players", spark: cumulative(totals.players, days.map((d) => d.newPlayers)) },
    { href: "/admin/matches", label: "แมตช์ 7 วันล่าสุด", value: week.matches, note: weekChange === null ? `ทั้งหมด ${totals.matches} แมตช์` : weekChange === 0 ? "เท่ากับสัปดาห์ก่อน" : `${weekChange > 0 ? "▲" : "▼"} ${Math.abs(weekChange)}% จากสัปดาห์ก่อน`, tone: "green", icon: "matches", spark: days.map((d) => d.matches) },
    { href: "/admin/tournaments?status=ONGOING", label: "ทัวร์กำลังแข่ง", value: totals.ongoingTournaments, note: `จากทั้งหมด ${totals.tournaments} รายการ`, tone: "amber", icon: "tournaments", spark: [] },
  ];

  const actions: { href: string; title: string; text: string; icon: IconName; tone: string }[] = [
    { href: "/admin/matches/new", title: "บันทึกผลการแข่ง", text: "ลากรูปสกอร์บอร์ดหรือกรอกเอง", icon: "matches", tone: "red" },
    { href: "/admin/tournaments/new", title: "สร้างทัวร์นาเมนต์", text: "ตั้งสาย เปิดรับสมัคร", icon: "tournaments", tone: "amber" },
    { href: "/admin/teams/new", title: "เพิ่มทีม + โลโก้", text: "ลากโลโก้ใส่แล้วตั้งชื่อ", icon: "upload", tone: "blue" },
    { href: "/admin/players/new", title: "เพิ่มผู้เล่น", text: "ใส่ UID เก็บสถิติได้ตลอด", icon: "players", tone: "green" },
  ];

  const tasks: { href: string; icon: IconName; text: React.ReactNode; tone: "warn" | "info" | "danger" }[] = [
    ...todo.disputes.map((d) => ({ href: `/admin/tournaments/${d.tournamentId}#bracket`, icon: "flag" as const, tone: "danger" as const, text: <>มีการโต้แย้งผล M{d.number} ใน <b>{d.name}</b></> })),
    ...todo.readyMatches.map((r) => ({ href: `/admin/tournaments/${r.tournamentId}#bracket`, icon: "matches" as const, tone: "warn" as const, text: <><b>{r.count} แมตช์</b> ใน {r.name} พร้อมแข่ง รอบันทึกผล</> })),
    ...todo.openRegistration.map((t) => ({ href: `/admin/tournaments/${t.id}`, icon: "tournaments" as const, tone: "info" as const, text: <>{t.name} เปิดรับสมัคร <b>{t.teams}{t.maxTeams ? `/${t.maxTeams}` : ""} ทีม</b></> })),
    ...(todo.playersWithoutUid ? [{ href: "/admin/players?show=nouid", icon: "id" as const, tone: "info" as const, text: <><b>{todo.playersWithoutUid} ผู้เล่น</b> ยังไม่มี UID (เปลี่ยนชื่อแล้วสถิติจะไม่ตามไป)</> }] : []),
    ...(todo.teamsWithoutLogo ? [{ href: "/admin/teams?show=nologo", icon: "image" as const, tone: "info" as const, text: <><b>{todo.teamsWithoutLogo} ทีม</b> ยังไม่มีโลโก้</> }] : []),
  ];

  return (
    <>
      <div className="dash-head">
        <div>
          <h1>ภาพรวม</h1>
          <p className="muted" style={{ margin: 0 }}>{todayTh.format(new Date())} · ทุกอย่างของ The Ranking ในหน้าเดียว</p>
        </div>
        <span className="health-pill"><i aria-hidden="true" /> ระบบปกติ</span>
      </div>

      {sp.deleted && <div className="success" style={{ marginBottom: 16 }}>ลบเรียบร้อยแล้ว</div>}

      <div className="dash-cards">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className={`dash-card tone-${c.tone}`}>
            <div className="dash-card-top">
              <span className="dash-card-label">{c.label}</span>
              <span className="dash-card-icon"><Icon name={c.icon} /></span>
            </div>
            <strong className="dash-card-value">{c.value.toLocaleString("th-TH")}</strong>
            <span className="dash-card-note">{c.note}</span>
            <Sparkline values={c.spark} label={`${c.label} 14 วันล่าสุด`} />
          </Link>
        ))}
      </div>

      <div className="quick-actions">
        {actions.map((a) => (
          <Link key={a.href} href={a.href} className={`quick tone-${a.tone}`}>
            <span className="quick-icon"><Icon name={a.icon} size={22} /></span>
            <span>
              <strong>{a.title}</strong>
              <span className="muted small">{a.text}</span>
            </span>
          </Link>
        ))}
      </div>

      <AdminSearch
        teams={teams.map((t) => ({ id: t.id, label: t.name, sub: t.tag ?? "" }))}
        players={players.map((p) => ({ id: p.id, label: p.name, sub: [p.team?.name ?? "ไม่มีสังกัด", p.uid && `UID ${p.uid}`].filter(Boolean).join(" · ") }))}
        tournaments={tournaments.map((t) => ({ id: t.id, label: t.name, sub: fmtDate(t.startDate) }))}
      />

      <div className="dash-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>แมตช์ต่อวัน</h2>
              <span className="muted small">{days.length} วันล่าสุด · รวม {days.reduce((n, d) => n + d.matches, 0)} แมตช์ {days.reduce((n, d) => n + d.games, 0)} เกม</span>
            </div>
            <Link className="small muted" href="/admin/matches">ดูทั้งหมด →</Link>
          </div>
          <DayBars days={days} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>งานที่รอทำ</h2>
              <span className="muted small">{tasks.length ? `${tasks.length} เรื่อง` : "ไม่มีงานค้าง"}</span>
            </div>
          </div>
          {tasks.length === 0 ? (
            <div className="todo-done"><Icon name="check" size={28} /> เรียบร้อยทุกอย่าง</div>
          ) : (
            <ul className="todo">
              {tasks.slice(0, 8).map((t, i) => (
                <li key={i}>
                  <Link href={t.href} className={`todo-item todo-${t.tone}`}>
                    <span className="todo-icon"><Icon name={t.icon} size={18} /></span>
                    <span className="grow">{t.text}</span>
                    <span className="muted" aria-hidden="true">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="dash-grid dash-grid-3">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>ผู้เล่นแต่ละแรงค์</h2>
              <span className="muted small">{totals.placingPlayers ? `อีก ${totals.placingPlayers} คนกำลังจัดอันดับ` : "ผู้เล่นที่ติด Ranking"}</span>
            </div>
          </div>
          {ranked === 0 ? <Empty>ยังไม่มีผู้เล่นติดอันดับ</Empty> : (
            <div className="tier-donut">
              <Donut total={ranked} caption="ผู้เล่น" parts={dash.tiers.map((t) => ({ key: t.key, value: t.players, color: t.color, label: t.name }))} />
              <ul className="legend">
                {[...dash.tiers].reverse().map((t) => (
                  <li key={t.key} className={t.players ? "" : "legend-zero"}>
                    <i style={{ background: t.color }} />
                    <span className="grow">{t.name}</span>
                    <b>{t.players}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Top 5 MMR</h2>
              <span className="muted small">อันดับบนสุดของ Ranking ผู้เล่น</span>
            </div>
            <Link className="small muted" href="/rankings/players">ดูหน้าเว็บ →</Link>
          </div>
          {dash.topPlayers.length === 0 ? <Empty>ยังไม่มี</Empty> : (
            <ol className="top-list">
              {dash.topPlayers.map((p) => (
                <li key={p.id}>
                  <span className={`top-rank rank-${p.rank}`}>{p.rank}</span>
                  <Avatar src={p.avatarUrl} name={p.name} round />
                  <Link href={`/admin/players/${p.id}`} className="grow top-name">
                    {p.name}
                    <span className="muted small">{p.team?.name ?? "ไม่มีสังกัด"}</span>
                  </Link>
                  <TierEmblem tier={p.tier} size={26} />
                  <b className="top-mmr">{p.mmr}</b>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>ผลที่บันทึกล่าสุด</h2>
              <span className="muted small">กดเพื่อแก้ไข</span>
            </div>
            <Link className="small muted" href="/admin/matches">ทั้งหมด →</Link>
          </div>
          {recent.data.length === 0 ? <Empty>ยังไม่มีผลการแข่ง</Empty> : (
            <ul className="recent-list">
              {recent.data.map((m) => (
                <li key={m.id}>
                  <Link href={`/admin/matches/${m.id}`} className="recent-item">
                    <span className="grow">
                      <span className={m.winnerId === m.teamA.id ? "winner" : "loser"}>{m.teamA.name}</span>
                      <span className="recent-score">{m.scoreA}:{m.scoreB}</span>
                      <span className={m.winnerId === m.teamB.id ? "winner" : "loser"}>{m.teamB.name}</span>
                      <span className="muted small recent-meta">{m.tournament.name} · {fmtDateTime(m.playedAt)}</span>
                    </span>
                    {m.source === "discord" && <span className="badge">Discord</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {!extract.enabled && (
        <p className="muted small mt">
          ระบบอ่านผลจากรูปด้วย AI ยังไม่เปิด (ตั้งค่า ANTHROPIC_API_KEY ที่เซิร์ฟเวอร์ API) ตอนนี้ใช้ตัวอ่านตัวเลขฟรีและพิมพ์กรอกเองได้ตามปกติ
        </p>
      )}
    </>
  );
}
