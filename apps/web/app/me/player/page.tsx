import Link from "@/components/LoadingLink";
import { redirect } from "next/navigation";
import { api, qs } from "@/lib/api";
import { getMember } from "@/lib/member";
import { allGames } from "@/lib/games";
import { safeNext } from "@/lib/discord";
import type { GameRank, MyCharacter } from "@/lib/types";
import { PlayerRegistrationForm, RegistrationClaimForm } from "@/components/RegistrationForms";

export const metadata = { title: "ข้อมูลสมัครแข่งขัน", robots: { index: false } };

export default async function PlayerSetupPage({ searchParams }: { searchParams: Promise<{ next?: string; gameId?: string; playerId?: string }> }) {
  const sp = await searchParams;
  const here = `/me/player${qs({ next: sp.next, gameId: sp.gameId, playerId: sp.playerId })}`;
  const member = await getMember();
  if (!member) redirect(`/login?next=${encodeURIComponent(here)}`);
  const next = safeNext(sp.next) ? sp.next! : "/me";
  const [mine, games] = await Promise.all([api<{ data: MyCharacter[] }>(`/members/${member.id}`), allGames()]);
  const eligible = mine.data.filter((p) => (!sp.gameId || !p.game || p.game.id === sp.gameId) && (!sp.playerId || p.id === sp.playerId));
  const forms = await Promise.all(eligible.map(async (p) => ({ player: p, ranks: (await api<{ data: GameRank[] }>(`/members/${member.id}/player-ranks${qs({ gameId: sp.gameId ?? p.game?.id })}`)).data })));
  return <>
    <div className="page-head"><div><h1>ข้อมูลสมัครแข่งขัน</h1><p className="muted">เลือกตำแหน่งและแรงค์ก่อนกลับไปสมัคร ข้อมูลนี้ใช้กับตัวละครของคุณในเกมนั้น</p></div><Link className="btn" href={next}>กลับ</Link></div>
    <div className="stack registration-workspace">
      {forms.map((f) => <PlayerRegistrationForm key={f.player.id} player={f.player} ranks={f.ranks} gameId={sp.gameId} next={next} />)}
      <RegistrationClaimForm games={games} gameId={sp.gameId} next={here} />
    </div>
  </>;
}
