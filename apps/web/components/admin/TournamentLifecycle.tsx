import type { Tournament } from "@/lib/types";
import { tournamentNextStep } from "@/lib/tournamentWorkflow";
import { TournamentSummary } from "../TournamentSummary";

export function TournamentLifecycle({ tournament, teams, drawn, signups }: { tournament: Tournament; teams: number; drawn: boolean; signups: number }) {
  const next = tournamentNextStep(tournament, teams, drawn, signups);
  return (
    <section className="tournament-lifecycle" aria-label="ขั้นตอนจัดการแข่งขัน">
      <p className="muted small">ตั้งค่า · รับสมัคร / สุ่มทีม · ตรวจสาย · เริ่มแข่ง · จัดการแมตช์ · สรุปผล</p>
      <TournamentSummary tournament={tournament} teams={teams} />
      <div className="row between">
        <div><h2>{next.label}</h2><p className="muted">{next.description}</p></div>
        <a className="btn btn-primary" href={next.target === "results" ? `/admin/matches/new?tournamentId=${encodeURIComponent(tournament.id)}` : `#${next.target}`}>
          {next.label}
        </a>
      </div>
    </section>
  );
}
