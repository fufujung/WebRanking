import Link from "@/components/LoadingLink";
import { notFound, redirect } from "next/navigation";
import { api, apiOrNull, qs } from "@/lib/api";
import { getMember } from "@/lib/member";
import type { MyCharacter, TournamentDetail } from "@/lib/types";
import { TournamentSummary } from "@/components/TournamentSummary";
import { NewRegistrationTeamForm } from "@/components/RegistrationForms";

export const metadata = { title: "สร้างทีม", robots: { index: false } };

export default async function NewTeamPage({ searchParams }: { searchParams: Promise<{ tournamentId?: string }> }) {
  const sp = await searchParams;
  const here = `/teams/new${qs({ tournamentId: sp.tournamentId })}`;
  const member = await getMember();
  if (!member) redirect(`/login?next=${encodeURIComponent(here)}`);
  const [mine, tournament] = await Promise.all([
    api<{ data: MyCharacter[] }>(`/members/${member.id}`),
    sp.tournamentId ? apiOrNull<TournamentDetail>(`/tournaments/${encodeURIComponent(sp.tournamentId)}`) : null,
  ]);
  if (sp.tournamentId && !tournament) notFound();
  const next = tournament ? `/tournaments/${tournament.id}` : "/me#my-teams";
  const eligible = mine.data.filter((p) => !p.team && (!tournament?.gameId || !p.game || p.game.id === tournament.gameId));
  const setup = `/me/player${qs({ gameId: tournament?.gameId, next: here })}`;
  return <>
    <div className="page-head"><div><h1>สร้างทีม</h1><p className="muted">{tournament ? `เตรียมทีมเพื่อสมัคร ${tournament.name}` : "สร้างทีมและเชิญเพื่อนก่อนลงแข่งขัน"}</p></div><Link className="btn" href={next}>กลับ{tournament ? "หน้ารายการ" : "โปรไฟล์"}</Link></div>
    <div className="stack registration-workspace">
      {tournament && <TournamentSummary tournament={tournament} teams={tournament.teams.length} />}
      {tournament?.entryMode === "SOLO" ? <p className="notice">รายการนี้ลงชื่อเดี่ยว ไม่ต้องสร้างทีม <Link href={next}>กลับไป Join Tournament</Link></p> : eligible.length ? <NewRegistrationTeamForm characters={eligible} next={next} /> : <div className="notice"><p>ยังไม่มีตัวละครที่ว่างสำหรับสร้างทีมในเกมนี้ ถ้ามีทีมแล้วให้ใช้ทีมเดิมสมัคร</p><Link className="btn btn-primary" href={setup}>ผูกตัวละคร / กรอกข้อมูลผู้เล่น</Link><Link className="btn" href="/me#my-teams">จัดการทีมของฉัน</Link></div>}
    </div>
  </>;
}
