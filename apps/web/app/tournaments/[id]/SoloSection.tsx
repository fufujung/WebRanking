import Link from "@/components/LoadingLink";
import { api } from "@/lib/api";
import { getMember } from "@/lib/member";
import { positionLabel } from "@/lib/solo";
import type { MyCharacter, SoloView, TournamentDetail } from "@/lib/types";
import { SoloForm } from "./SoloForm";
import { RankBadge } from "@/components/RankBadge";
import { Avatar, Empty } from "@/components/ui";
/** Solo roster and explicit signup edits; the main Join action lives near the tournament title. */
export async function SoloSection({ t }: { t: TournamentDetail }) {
  const [solo, me] = await Promise.all([api<SoloView>(`/tournaments/${t.id}/solo`), getMember()]);
  const current = solo.signups.find((s) => s.discordId === me?.id);
  const mine = current && me ? (await api<{ data: MyCharacter[] }>(`/members/${me.id}`)).data.filter((p) => !t.gameId || !p.game || p.game.id === t.gameId) : [];
  const teams = Math.floor(solo.signups.length / solo.teamSize);
  return (
    <section className="mt solo-section">
      {current && mine.length > 0 && solo.registrationOpen && !solo.drawn && t.status !== "COMPLETED" && t.bracketStatus !== "LIVE" && t.bracketStatus !== "DONE" && <details className="card"><summary>แก้ไขข้อมูลการสมัครเดี่ยว</summary><SoloForm tournamentId={t.id} ranks={solo.ranks} current={{ playerId: current.playerId, position: current.position, rank: current.rank }} characters={mine.map((p) => ({ id: p.id, label: `${p.name}${p.uid ? ` (UID ${p.uid})` : ""}` }))} /></details>}
      <h2 className="mt">
        ผู้ลงทะเบียน ({solo.signups.length} คน{teams > 0 ? ` · ได้ ${teams} ทีม` : ""}{solo.signups.length % solo.teamSize ? ` · สำรอง ${solo.signups.length % solo.teamSize}` : ""})
      </h2>
      {solo.signups.length === 0 ? (
        <Empty>ยังไม่มีคนลงทะเบียน</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>ผู้เล่น</th><th>ตำแหน่ง</th><th>แรงค์</th></tr>
            </thead>
            <tbody>
              {solo.signups.map((s, i) => (
                <tr key={s.playerId} className={s.discordId && s.discordId === me?.id ? "row-me" : undefined}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <Link href={`/players/${s.playerId}`} className="entity">
                      <Avatar src={s.avatarUrl} name={s.name} round />
                      <span>{s.nickname || s.name}</span>
                    </Link>
                  </td>
                  <td>{positionLabel[s.position]}</td>
                  <td><RankBadge rank={s.rank} ranks={solo.ranks} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
