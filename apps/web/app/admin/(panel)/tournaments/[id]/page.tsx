import Link from "@/components/LoadingLink";
import { notFound } from "next/navigation";
import { api, apiOrNull, qs } from "@/lib/api";
import { fetchAll } from "@/lib/fetchAll";
import type {
  Bracket,
  GameRank,
  Market,
  ReservePlayer,
  SeasonView,
  SoloView,
  Story,
  Team,
  TournamentDetail,
} from "@/lib/types";
import { PredictControls } from "@/components/admin/PredictControls";
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
import { requireAdmin } from "@/lib/auth";
import { AdminTabs, type AdminTab } from "@/components/admin/AdminTabs";
import { ReserveDraw } from "@/components/admin/ReserveDraw";
import { TournamentLifecycle } from "@/components/admin/TournamentLifecycle";
import { LogoMark } from "@/components/public/LogoMark";

export const metadata = { title: "แก้ไขทัวร์นาเมนต์" };

export default async function EditTournament({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAdmin();
  const [t, teams, sp, games, seasons] = await Promise.all([
    apiOrNull<TournamentDetail>(
      `/tournaments/${encodeURIComponent((await params).id)}`,
    ),
    fetchAll<Team>("/teams"),
    searchParams,
    allGames(),
    allSeasons(),
  ]);
  if (!t) notFound();
  const [bracket, solo] = await Promise.all([
    t.format ? apiOrNull<Bracket>(`/tournaments/${t.id}/bracket`) : null,
    t.entryMode === "SOLO"
      ? apiOrNull<SoloView>(`/tournaments/${t.id}/solo`)
      : null,
  ]);
  // Organizers put teams together from the season's list (when the event has a season) or the substitutes list.
  const stories = (await api<{ data: Story[] }>(`/tournaments/${t.id}/stories`))
    .data;
  const predictions = await apiOrNull<{ markets: Market[] }>(
    `/predict/tournaments/${t.id}`,
  );
  const [reserve, season, { data: ranks }] = await Promise.all([
    api<{ data: ReservePlayer[] }>(
      `/special/reserve/private${qs({ gameId: t.gameId })}`,
    ).then((r) => r.data),
    t.seasonId
      ? apiOrNull<SeasonView>(
          `/special/seasons/${encodeURIComponent(t.seasonId)}`,
        )
      : null,
    api<{ data: GameRank[] }>(`/special/ranks${qs({ gameId: t.gameId })}`),
  ]);
  const takenBy = new Map(
    (bracket?.teams ?? t.teams).flatMap((e) =>
      e.roster.map((p) => [p.playerId, e.name] as const),
    ),
  );
  const signUp = new Map(reserve.map((r) => [r.playerId, r]));
  const candidates: Candidate[] = (
    season
      ? season.players.map((p) => ({
          id: p.id,
          name: p.name,
          uid: p.uid ?? null,
          server: p.server ?? null,
          mmr: p.specialMmr,
        }))
      : reserve.map((r) => ({
          id: r.playerId,
          name: r.player.name,
          uid: r.player.uid,
          server: r.player.server,
          mmr: r.player.specialMmr,
        }))
  ).map((p) => {
    const r = signUp.get(p.id);
    return {
      playerId: p.id,
      name: p.name,
      uid: p.uid,
      server: p.server,
      discordId: r?.discordId ?? null,
      position: r?.position ?? null,
      rank: r?.rank ?? null,
      mmr: p.mmr,
      takenBy: takenBy.get(p.id) ?? null,
    };
  });
  const canAdd = t.bracketStatus === "NONE" || t.bracketStatus === "DRAFT";
  const started = t.bracketStatus === "LIVE" || t.bracketStatus === "DONE";
  const entries = bracket?.teams ?? t.teams;
  const tabs: AdminTab[] = [
    {
      key: "register",
      icon: "📝",
      label: "ลงทะเบียน / ทีม",
      hint: "เพิ่มทีม ใส่อันดับ สร้างทีมจากรายชื่อ",
      count: t.teams.length,
      aliases: ["pick", "teams"],
      content: (
        <>
          <h2>ทีมที่ลงแข่ง ({t.teams.length})</h2>
          <p className="muted small">
            {t.format
              ? "ทีมสมัครเองผ่าน Discord (/register) หรือผู้จัดเพิ่มที่นี่ก่อนเริ่มแข่ง อันดับสุดท้ายจะลงให้อัตโนมัติเมื่อจบสาย"
              : "ทีมจะถูกเพิ่มอัตโนมัติเมื่อบันทึกผลการแข่ง หรือเพิ่มเองล่วงหน้าได้ที่นี่ ใส่อันดับสุดท้ายเมื่อจบรายการ"}
          </p>
          <EntryManager tournamentId={t.id} entries={t.teams} teams={teams} />
          {canAdd && (
            <>
              <h3 className="mt" id="pick">
                สร้างทีมใหม่: พิมพ์รายชื่อเอง หรือติ๊กจากรายชื่อ
                {season ? ` ${season.name}` : "ตัวสำรอง"}
              </h3>
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
        </>
      ),
    },
    {
      key: "draw",
      icon: "🎲",
      label: "สุ่มทีม",
      hint: solo ? "คนลงเดี่ยว สุ่มจัดทีม" : "สุ่มรายชื่อตามแรงค์และตำแหน่ง",
      count: solo ? solo.signups.length : undefined,
      aliases: ["solo"],
      content: solo ? (
        <>
          <h2 id="solo">ลงเดี่ยว / สุ่มทีม</h2>
          <SoloAdmin tournamentId={t.id} view={solo} started={started} />
        </>
      ) : (
        <>
          <h2>สุ่มรายชื่อ{season ? ` ${season.name}` : "ตัวสำรอง"}</h2>
          <p className="muted small">
            สุ่มเฉพาะคนที่ยังไม่มีทีมในรายการนี้ สุ่มได้แล้วไปที่ "ลงทะเบียน /
            ทีม" ติ๊กชื่อที่สุ่มได้เพื่อสร้างทีม
          </p>
          <ReserveDraw
            ranks={ranks}
            people={candidates
              .filter((c) => !c.takenBy)
              .map((c) => ({
                id: c.playerId,
                name: c.name,
                uid: c.uid,
                rank: c.rank,
                position: c.position,
              }))}
          />
        </>
      ),
    },
    ...(t.format && bracket
      ? [
          {
            key: "roster",
            icon: "👥",
            label: "รายชื่อทีม",
            hint: "ผู้เล่นในแต่ละทีม แก้ก่อนล็อก",
            count: bracket.teams.length,
            content: (
              <>
                <h2>รายชื่อผู้เล่น</h2>
                <RosterManager
                  tournamentId={t.id}
                  entries={bracket.teams}
                  rosterMin={t.rosterMin}
                  rosterMax={t.rosterMax}
                  locked={bracket.rosterLocked}
                  lockAt={bracket.rosterLockAt}
                  candidates={candidates}
                />
              </>
            ),
          },
        ]
      : []),
    ...(t.format
      ? [
          {
            key: "bracket",
            icon: <LogoMark size={24} />,
            label: "สายการแข่งขัน",
            hint: "จัดสาย เริ่มแข่ง บันทึกผล",
            content: (
              <>
                <h2 id="bracket">สายการแข่งขัน</h2>
                <BracketAdmin
                  tournamentId={t.id}
                  format={t.format}
                  bracket={bracket}
                  entries={entries}
                />
              </>
            ),
          },
        ]
      : []),
    {
      key: "predict",
      icon: "",
      label: "ทายผล",
      hint: "เปิด/ปิดรับทาย ตั้งคู่เอง",
      content: (
        <>
          <h2 id="predict"> ทายผล</h2>
          <PredictControls
            tournamentId={t.id}
            markets={predictions?.markets ?? []}
            teams={entries.map((e) => ({ id: e.id, name: e.name }))}
          />
        </>
      ),
    },
    {
      key: "story",
      icon: "📖",
      label: "ต้นเรื่อง",
      hint: "ลิงก์โพสต์ Facebook",
      count: stories.length,
      content: (
        <>
          <h2 id="story">📖 ต้นเรื่อง ({stories.length})</h2>
          <StoryEditor owner={{ tournamentId: t.id }} stories={stories} />
        </>
      ),
    },
    {
      key: "settings",
      icon: "⚙️",
      label: "ตั้งค่าทัวร์",
      hint: "ชื่อ วันที่ รูปแบบ จำนวนคน",
      content: (
        <>
          <h2>ตั้งค่าทัวร์</h2>
          <TournamentForm
            key={t.gameId ?? ""}
            tournament={t}
            games={games}
            seasons={seasons}
          />
        </>
      ),
    },
  ];
  // Open where the organizer most likely is: the bracket once it runs, otherwise teams / the solo draw.
  const initial =
    started && t.format ? "bracket" : solo && !started ? "draw" : "register";
  return (
    <>
      <div className="page-head">
        <h1>{t.name}</h1>
        <div className="row">
          <Link className="btn btn-sm" href={`/tournaments/${t.id}`}>
            ดูหน้ารายการ
          </Link>
          <Link
            className="btn btn-sm btn-primary"
            href={`/admin/matches/new?tournamentId=${t.id}`}
          >
            + บันทึกผลการแข่งในรายการนี้
          </Link>
          <DeleteButton
            kind="tournaments"
            id={t.id}
            label={`ทัวร์นาเมนต์ ${t.name} พร้อมแมตช์ทั้งหมดในรายการ`}
          />
        </div>
      </div>
      {sp.saved && (
        <div className="success" style={{ marginBottom: 16 }}>
          บันทึกแล้ว
        </div>
      )}
      <TournamentLifecycle
        tournament={t}
        teams={t.teams.length}
        drawn={solo?.drawn ?? false}
        signups={solo?.signups.length ?? 0}
      />
      <AdminTabs initial={initial} tabs={tabs} />
    </>
  );
}
