import Link from "@/components/LoadingLink";
import { notFound } from "next/navigation";
import { api, apiOrNull, PUBLIC } from "@/lib/api";
import type { Bracket, Story, TournamentDetail, TournamentDrafts } from "@/lib/types";
import { fmtDate, fmtThaiTime, formatLabel } from "@/lib/format";
import { BracketView, Rosters } from "@/components/Bracket";
import { Empty, MatchCard, StatusBadge, TeamLink } from "@/components/ui";
import { SoloSection } from "./SoloSection";
import { CheerSection } from "@/components/predict/Cheer";
import { StoryList } from "@/components/Stories";
import { LiveRefresh } from "@/components/LiveRefresh";
import { TournamentSummary } from "@/components/TournamentSummary";
import { TournamentJoin } from "@/components/TournamentJoin";


import { registrationLabel } from "@/lib/tournamentWorkflow";
import { LogoMark } from "@/components/public/LogoMark";

export default async function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await apiOrNull<TournamentDetail>(`/tournaments/${encodeURIComponent((await params).id)}`, PUBLIC);
  if (!t) notFound();
  // Only a started bracket is public; a draft can still change.
  const bracket = t.format && (t.bracketStatus === "LIVE" || t.bracketStatus === "DONE") ? await apiOrNull<Bracket>(`/tournaments/${t.id}/bracket`, PUBLIC) : null;
  const podium = t.teams.filter((x) => x.placement && x.placement <= 3);
  const stories = (await api<{ data: Story[] }>(`/tournaments/${t.id}/stories`, PUBLIC).catch(() => ({ data: [] as Story[] }))).data;
  const drafts = await api<TournamentDrafts>(`/tournaments/${t.id}/drafts`, PUBLIC).catch(() => null);

  const registration = registrationLabel(t, t.teams.length);
  return (
    <>
      <LiveRefresh />
      <div className="page-head">
        <div>
          <div className="row" style={{ marginBottom: 8 }}>
            <StatusBadge status={t.status} />
            {t.special && <Link href={t.season ? `/special?season=${t.season.id}` : "/special"} className="badge badge-accent" title="สถิติและ MMR แยกจาก Ranking หลัก"> รายการพิเศษ เล่นเก่งปากเก่ง{t.season ? ` · ${t.season.name}` : ""}</Link>}
          </div>
          <h1>{t.name}</h1>
          <span className="muted">
            {[t.game, t.location, `${t.format ? fmtThaiTime(t.startDate) : fmtDate(t.startDate)}${t.endDate ? ` – ${fmtDate(t.endDate)}` : ""}`].filter(Boolean).join(" · ")}
          </span>
          <TournamentJoin tournament={t} />
          {!t.format && drafts && drafts.games > 0 && (
            <div className="row small" style={{ marginTop: 8 }}>
              <Link href={`/tournaments/${t.id}/picks`} className="badge badge-accent"> สถิติแบน/พิค ({drafts.games} เกม)</Link>
            </div>
          )}
          {t.format && (
            <div className="row small" style={{ marginTop: 8 }}>
              <span className="badge">{formatLabel[t.format]}</span>
              <span className="badge">BO{t.bestOf}</span>
              {t.finalBestOf && t.finalBestOf !== t.bestOf && t.format !== "ROUND_ROBIN" && <span className="badge">รอบชิง BO{t.finalBestOf}</span>}
              <span className="badge">เลทได้ {t.lateMinutes} นาที</span>
              {t.entryMode === "SOLO" && <span className="badge">ลงเดี่ยว · สุ่มทีมละ {t.teamSize} คน</span>}
              {registration === "เปิดรับสมัคร" && t.entryMode !== "SOLO" && <span className="badge badge-accent">เปิดรับสมัครบนเว็บไซต์</span>}
              {stories.length > 0 && <a href="#story" className="badge"> ต้นเรื่อง ({stories.length})</a>}
              {drafts && drafts.games > 0 && <Link href={`/tournaments/${t.id}/picks`} className="badge badge-accent"> สถิติแบน/พิค ({drafts.games} เกม)</Link>}
            </div>
          )}
        </div>
      </div>
      <section id="join" className="tournament-join" aria-labelledby="join-heading">
        <div className="row between">
          <div>
            <h2 id="join-heading">รายละเอียดการแข่งขัน</h2>
            <p className="tournament-description">{t.description || (t.entryMode === "SOLO" ? "สมัครเดี่ยว โดยใช้ข้อมูลผู้เล่นของคุณ ผู้จัดจะสุ่มทีมก่อนเริ่มการแข่งขัน" : `สมัครเป็นทีม โดยให้หัวหน้าทีมส่งรายชื่อผู้เข้าแข่งขัน ${t.rosterMin}–${t.rosterMax} คน`)}</p>
          </div>
        </div>
      </section>
      <nav className="tournament-sections" aria-label="หัวข้อทัวร์นาเมนต์">
        <a href="#overview">ภาพรวม</a><a href="#teams">ทีมและผู้เล่น</a>
        <a href="#bracket">ตาราง / สายการแข่งขัน</a><a href="#results">ผลการแข่งขัน</a>
        <Link href={`/predict?t=${t.id}`}>ทำนายผล</Link>
        {stories.length > 0 && <a href="#story">ต้นเรื่อง</a>}
        {drafts && drafts.games > 0 && <Link href={`/tournaments/${t.id}/picks`}>สถิติแบน / พิค</Link>}
      </nav>
      <section id="overview" className="tournament-section" aria-labelledby="overview-heading">
        <h2 id="overview-heading">ภาพรวมรายการ</h2>
        <TournamentSummary tournament={t} teams={t.teams.length} />

      </section>

      {stories.length > 0 && (
        <section className="mt" id="story">
          <h2> ต้นเรื่อง</h2>
          <p className="muted small">ที่มาของรายการนี้ ตามอ่านได้ตามลำดับ</p>
          <StoryList stories={stories} />
        </section>
      )}

      {t.format && t.teams.length >= 2 && t.status !== "COMPLETED" && <CheerSection tournamentId={t.id} next={`/tournaments/${t.id}#cheer`} />}

      <section id="teams" className="tournament-section" aria-labelledby="teams-heading">
      <h2 id="teams-heading">ทีมและผู้เล่น ({t.teams.length} ทีม)</h2>
      {t.teams.length === 0 && <Empty>ยังไม่มีทีมในรายการนี้</Empty>}
      {podium.length > 0 && (
        <div className="grid grid-3 mt">
          {podium.map((x) => (
            <div key={x.id} className="card row between">
              <TeamLink team={x} />
              <span className={`badge ${x.placement === 1 ? "badge-accent" : ""}`}>{x.placement === 1 ? <><LogoMark size={16} /> แชมป์</> : `อันดับ ${x.placement}`}</span>
            </div>
          ))}
        </div>
      )}

      {t.entryMode === "SOLO" && <SoloSection t={t} />}

      {t.format && t.teams.some((x) => x.roster.length > 0) && (
        <>
          <h2 className="mt">รายชื่อผู้เล่น</h2>
          <Rosters teams={[...t.teams].sort((a, b) => (a.seed ?? Infinity) - (b.seed ?? Infinity) || a.name.localeCompare(b.name))} />
        </>
      )}

      {t.teams.length > 0 && (!t.format || !t.teams.some((x) => x.roster.length > 0)) && (
        <div className="tournament-team-list">{t.teams.map((team) => <div key={team.id}><TeamLink team={team} /></div>)}</div>
      )}
      </section>
      <section id="bracket" className="tournament-section" aria-labelledby="bracket-heading">
        <h2 id="bracket-heading">ตาราง / สายการแข่งขัน</h2>
        {bracket ? <BracketView bracket={bracket} /> : <Empty>{t.format ? "ยังไม่เผยแพร่สายการแข่งขัน ผู้จัดจะเผยแพร่เมื่อยืนยันเริ่มแข่งแล้ว" : "รายการนี้ไม่ใช้สายการแข่งขัน ดูผลรายแมตช์ด้านล่าง"}</Empty>}
      </section>
      <section id="results" className="tournament-section" aria-labelledby="results-heading">
      <h2 id="results-heading">ผลการแข่งขัน</h2>
      {!t.format && (<>
      <h2 className="mt">ตารางคะแนน</h2>
      <p className="muted small">ชนะ 3 แต้ม เสมอ 1 แต้ม เท่ากันดูผลต่างสกอร์</p>
      {t.standings.length === 0 ? (
        <Empty>ยังไม่มีทีมในรายการนี้</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>ทีม</th><th className="num">แข่ง</th><th className="num">ชนะ</th><th className="num">เสมอ</th><th className="num">แพ้</th><th className="num">ได้</th><th className="num">เสีย</th><th className="num">+/-</th><th className="num">แต้ม</th></tr>
            </thead>
            <tbody>
              {t.standings.map((s) => (
                <tr key={s.teamId}>
                  <td className={`rank rank-${s.position}`}>{s.position}</td>
                  <td>{s.team ? <TeamLink team={s.team} /> : "-"}</td>
                  <td className="num">{s.matches}</td>
                  <td className="num">{s.wins}</td>
                  <td className="num">{s.draws}</td>
                  <td className="num">{s.losses}</td>
                  <td className="num">{s.pointsFor}</td>
                  <td className="num">{s.pointsAgainst}</td>
                  <td className="num">{s.diff > 0 ? `+${s.diff}` : s.diff}</td>
                  <td className="num"><strong>{s.points}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      </>)}

      <h3>แมตช์ที่บันทึกผลแล้ว</h3>
      {t.matches.length === 0 ? <Empty>ยังไม่มีผลการแข่ง</Empty> : (
        <div className="grid grid-2">{t.matches.map((m) => <MatchCard key={m.id} match={m} />)}</div>
      )}
      </section>
    </>
  );
}
