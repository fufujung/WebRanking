import Link from "next/link";
import { notFound } from "next/navigation";
import { api, apiOrNull, qs } from "@/lib/api";
import { fetchAll } from "@/lib/fetchAll";
import type { Bracket, ReservePlayer, SeasonView, SoloView, Story, Team, TournamentDetail } from "@/lib/types";
import { StoryEditor } from "@/components/admin/StoryEditor";
import { TournamentForm } from "@/components/admin/TournamentForm";
import { EntryManager } from "@/components/admin/EntryManager";
import { DeleteButton } from "@/components/admin/DeleteButton";
import { BracketAdmin } from "@/components/admin/BracketAdmin";
import { RosterManager } from "@/components/admin/RosterManager";
import { allGames } from "@/lib/games";
import { allSeasons } from "@/lib/seasons";
import { SoloAdmin } from "@/components/admin/SoloAdmin";
import { PickTeam, type Candidate } from "@/components/admin/PickPlayers";

export const metadata = { title: "แก้ไขทัวร์นาเมนต์" };

export default async function EditTournament({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const [t, teams, sp, games, seasons] = await Promise.all([
    apiOrNull<TournamentDetail>(`/tournaments/${encodeURIComponent((await params).id)}`),
    fetchAll<Team>("/teams"),
    searchParams,
    allGames(),
    allSeasons(),
  ]);
  if (!t) notFound();
  const [bracket, solo] = await Promise.all([
    t.format ? apiOrNull<Bracket>(`/tournaments/${t.id}/bracket`) : null,
    t.entryMode === "SOLO" ? apiOrNull<SoloView>(`/tournaments/${t.id}/solo`) : null,
  ]);
  // Organizers put teams together from the season's list (when the event has a season) or the substitutes list.
  const stories = (await api<{ data: Story[] }>(`/tournaments/${t.id}/stories`)).data;
  const [reserve, season] = await Promise.all([
    t.format ? api<{ data: ReservePlayer[] }>(`/special/reserve/private${qs({ gameId: t.gameId })}`).then((r) => r.data) : [],
    t.format && t.seasonId ? apiOrNull<SeasonView>(`/special/seasons/${encodeURIComponent(t.seasonId)}`) : null,
  ]);
  const takenBy = new Map((bracket?.teams ?? []).flatMap((e) => e.roster.map((p) => [p.playerId, e.name] as const)));
  const signUp = new Map(reserve.map((r) => [r.playerId, r]));
  const candidates: Candidate[] = (season
    ? season.players.map((p) => ({ id: p.id, name: p.name, uid: p.uid ?? null, server: p.server ?? null, mmr: p.specialMmr }))
    : reserve.map((r) => ({ id: r.playerId, name: r.player.name, uid: r.player.uid, server: r.player.server, mmr: r.player.specialMmr }))
  ).map((p) => {
    const r = signUp.get(p.id);
    return { playerId: p.id, name: p.name, uid: p.uid, server: p.server, discordId: r?.discordId ?? null, position: r?.position ?? null, rank: r?.rank ?? null, mmr: p.mmr, takenBy: takenBy.get(p.id) ?? null };
  });
  const canAdd = t.format && (t.bracketStatus === "NONE" || t.bracketStatus === "DRAFT");
  return (
    <>
      <div className="page-head">
        <h1>{t.name}</h1>
        <div className="row">
          <Link className="btn btn-sm" href={`/tournaments/${t.id}`}>ดูหน้ารายการ</Link>
          <Link className="btn btn-sm btn-primary" href={`/admin/matches/new?tournamentId=${t.id}`}>+ บันทึกผลการแข่งในรายการนี้</Link>
          <DeleteButton kind="tournaments" id={t.id} label={`ทัวร์นาเมนต์ ${t.name} (แมตช์ทั้งหมดในรายการจะถูกลบด้วย)`} />
        </div>
      </div>
      {sp.saved && <div className="success" style={{ marginBottom: 16 }}>บันทึกแล้ว</div>}
      <TournamentForm key={t.gameId ?? ""} tournament={t} games={games} seasons={seasons} />
      {solo && (
        <>
          <h2 className="mt" id="solo">ลงเดี่ยว / สุ่มทีม</h2>
          <SoloAdmin tournamentId={t.id} view={solo} started={t.bracketStatus === "LIVE" || t.bracketStatus === "DONE"} />
        </>
      )}
      {t.format && (
        <>
          <h2 className="mt" id="bracket">สายการแข่งขัน</h2>
          <BracketAdmin tournamentId={t.id} format={t.format} bracket={bracket} entries={bracket?.teams ?? t.teams} />
        </>
      )}
      <h2 className="mt" id="story">📖 ต้นเรื่อง ({stories.length})</h2>
      <StoryEditor owner={{ tournamentId: t.id }} stories={stories} />
      <h2 className="mt">ทีมที่ลงแข่ง ({t.teams.length})</h2>
      <p className="muted small">
        {t.format
          ? "ทีมสมัครเองผ่าน Discord (/register) หรือผู้จัดเพิ่มที่นี่ก่อนเริ่มแข่ง อันดับสุดท้ายจะลงให้อัตโนมัติเมื่อจบสาย"
          : "ทีมจะถูกเพิ่มอัตโนมัติเมื่อบันทึกผลการแข่ง หรือเพิ่มเองล่วงหน้าได้ที่นี่ ใส่อันดับสุดท้ายเมื่อจบรายการ"}
      </p>
      <EntryManager tournamentId={t.id} entries={t.teams} teams={teams} />
      {canAdd && (
        <>
          <h3 className="mt" id="pick">จัดทีมจากรายชื่อ{season ? ` ${season.name}` : "ตัวสำรอง"}</h3>
          <PickTeam
            tournamentId={t.id}
            candidates={candidates}
            source={season ? `รายชื่อ ${season.name}` : "รายชื่อตัวสำรอง"}
            rosterMin={t.rosterMin}
            rosterMax={t.rosterMax}
            nextName={`ทีม ${t.teams.length + 1}`}
          />
        </>
      )}
      {t.format && bracket && (
        <>
          <h2 className="mt">รายชื่อผู้เล่น</h2>
          <RosterManager tournamentId={t.id} entries={bracket.teams} rosterMin={t.rosterMin} rosterMax={t.rosterMax} locked={bracket.rosterLocked} lockAt={bracket.rosterLockAt} candidates={candidates} />
        </>
      )}
    </>
  );
}
