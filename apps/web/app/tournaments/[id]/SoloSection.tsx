import Link from "next/link";
import { api } from "@/lib/api";
import { getMember } from "@/lib/member";
import { discordEnabled } from "@/lib/discord";
import { positionLabel } from "@/lib/solo";
import type { MyCharacter, SoloView, TournamentDetail } from "@/lib/types";
import { DiscordMark } from "@/components/DiscordMark";
import { RankBadge } from "@/components/RankBadge";
import { Avatar, Empty } from "@/components/ui";
import { SoloForm } from "./SoloForm";

/** Solo sign-up box and the list of who signed up, for SOLO tournaments. */
export async function SoloSection({ t }: { t: TournamentDetail }) {
  const [solo, me] = await Promise.all([api<SoloView>(`/tournaments/${t.id}/solo`), getMember()]);
  const mine = me ? (await api<{ data: MyCharacter[] }>(`/members/${me.id}`)).data : [];
  const eligible = mine.filter((p) => !t.gameId || !p.game || p.game.id === t.gameId);
  const current = solo.signups.find((s) => s.discordId === me?.id) ?? null;
  const started = t.bracketStatus === "LIVE" || t.bracketStatus === "DONE";
  const teams = Math.floor(solo.signups.length / solo.teamSize);
  const open = solo.registrationOpen && !solo.drawn && !started;
  const here = `/tournaments/${t.id}`;
  return (
    <section className="mt solo-section">
      <div className="card stack">
        <div className="row between">
          <div>
            <h2 style={{ margin: 0 }}>ลงทะเบียนเดี่ยว</h2>
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              ลงชื่อคนเดียว เลือกตำแหน่งและแรงค์ในเกม แล้วผู้จัดจะสุ่มจัดทีมละ {solo.teamSize} คน ให้แรงค์สูงคละกับแรงค์น้อย และตำแหน่งไม่ซ้ำกัน
            </p>
          </div>
          {open && <span className="badge badge-accent">เปิดรับสมัคร</span>}
        </div>
        {solo.drawn ? (
          <div className="notice">ผู้จัดสุ่มทีมเรียบร้อยแล้ว ดูทีมของคุณได้ที่รายชื่อผู้เล่นด้านล่าง</div>
        ) : !open ? (
          <div className="notice">{started ? "ทัวร์นาเมนต์เริ่มแข่งแล้ว" : "ยังไม่เปิดรับสมัคร"}</div>
        ) : !me ? (
          discordEnabled() ? (
            <div className="row">
              <a className="btn btn-discord" href={`/api/auth/discord?next=${encodeURIComponent(here)}`}><DiscordMark /> เข้าสู่ระบบด้วย Discord เพื่อลงทะเบียน</a>
            </div>
          ) : (
            <div className="notice small">ระบบเข้าสู่ระบบด้วย Discord ยังไม่เปิด</div>
          )
        ) : eligible.length === 0 ? (
          <div className="row">
            <span className="muted">ผูกตัวละคร (UID) ของคุณก่อน แล้วกลับมาลงทะเบียน</span>
            <Link className="btn btn-primary" href="/me">ไปผูกตัวละคร</Link>
          </div>
        ) : (
          <SoloForm
            tournamentId={t.id}
            ranks={solo.ranks}
            current={current ? { playerId: current.playerId, position: current.position, rank: current.rank } : null}
            characters={eligible.map((p) => ({ id: p.id, label: `${p.name}${p.uid ? ` (UID ${p.uid})` : ""}` }))}
          />
        )}
      </div>

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
