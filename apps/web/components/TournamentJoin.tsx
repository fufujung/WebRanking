import Link from "@/components/LoadingLink";
import { api } from "@/lib/api";
import { getMember } from "@/lib/member";
import { registrationLabel } from "@/lib/tournamentWorkflow";
import type { MyCharacter, SoloView, TournamentDetail } from "@/lib/types";
import { TournamentJoinForm } from "./TournamentJoinForm";

export async function TournamentJoin({
  tournament: t,
}: {
  tournament: TournamentDetail;
}) {
  const member = await getMember();
  const solo = t.entryMode === "SOLO";
  const [mine, view] = await Promise.all([
    member ? api<{ data: MyCharacter[] }>(`/members/${member.id}`) : null,
    solo ? api<SoloView>(`/tournaments/${t.id}/solo`) : null,
  ]);
  const eligible =
    mine?.data.filter((p) => !t.gameId || !p.game || p.game.id === t.gameId) ??
    [];
  const current = solo
    ? view?.signups.some((s) => s.discordId === member?.id)
    : t.teams.some(
        (e) =>
          e.captainDiscordId === member?.id ||
          e.roster.some((r) => r.discordId === member?.id) ||
          eligible.some((p) => p.team?.id === e.id),
      );
  const state = registrationLabel(t, t.teams.length);
  const fullSolo =
    solo &&
    t.maxTeams != null &&
    (view?.signups.length ?? 0) >= t.maxTeams * (t.teamSize ?? 1);
  const closed =
    state === "เปิดรับสมัคร"
      ? fullSolo
        ? "ผู้สมัครครบจำนวนแล้ว"
        : null
      : state;
  return (
    <div className="tournament-join-action">
      {!member ? (
        <div>
          {closed && closed !== "ปิดรับสมัคร" && <p className="notice">{closed}</p>}
          {closed ? <button type="button" className="btn btn-primary tournament-join-closed" disabled>ปิดรับสมัคร</button> : <Link
            href={`/login?next=${encodeURIComponent(`/tournaments/${t.id}`)}`}
            className="btn btn-primary"
          >
            สมัครเข้าร่วม
          </Link>}
        </div>
      ) : (
        <TournamentJoinForm
          id={t.id}
          solo={solo}
          characters={eligible.map(({ id, name, role, inGameRank, team }) => ({
            id,
            name,
            role,
            inGameRank,
            team,
          }))}
          ranks={view?.ranks.map((r) => r.name) ?? []}
          registered={Boolean(current)}
          closed={closed}
          rosterMin={t.rosterMin}
          rosterMax={t.rosterMax}
          gameId={t.gameId}
        />
      )}
    </div>
  );
}
