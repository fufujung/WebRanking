import Link from "@/components/LoadingLink";
import { notFound } from "next/navigation";
import { apiOrNull, api } from "@/lib/api";
import { getMember } from "@/lib/member";
import { discordEnabled } from "@/lib/discord";
import type { InviteInfo, MyCharacter } from "@/lib/types";
import { Avatar } from "@/components/ui";
import { DiscordMark } from "@/components/DiscordMark";
import { JoinForm } from "./JoinForm";

export const metadata = { title: "เข้าร่วมทีม", robots: { index: false } };

/** Where a team's invite link lands: log in with Discord, pick your character, join. */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[A-Za-z0-9]{4,40}$/.test(code)) notFound();
  const team = await apiOrNull<InviteInfo>(`/members/invites/${code}`);
  if (!team) {
    return (
      <div className="card join-card">
        <h1>ลิงก์เชิญใช้ไม่ได้</h1>
        <p className="muted">ลิงก์นี้อาจถูกเปลี่ยนแล้ว ขอลิงก์ใหม่จากหัวหน้าทีม</p>
        <Link className="btn" href="/">กลับหน้าแรก</Link>
      </div>
    );
  }
  const me = await getMember();
  const mine = me ? (await api<{ data: MyCharacter[] }>(`/members/${me.id}`)).data : [];
  const sameGame = (p: MyCharacter) => !team.game || !p.game || p.game.id === team.game.id;
  const free = mine.filter((p) => !p.team && sameGame(p));
  const already = mine.find((p) => p.team?.id === team.id);
  return (
    <div className="card join-card">
      <Avatar src={team.logoUrl} name={team.tag || team.name} size="lg" />
      <div>
        <span className="muted small">คุณได้รับเชิญเข้าทีม</span>
        <h1 style={{ margin: "4px 0" }}>{team.name}</h1>
        <span className="muted small">{team.game ? `${team.game.name} · ` : ""}{team.memberCount} คน · MMR ทีม {team.rating}</span>
      </div>
      {already ? (
        <>
          <div className="success">{already.name} อยู่ในทีมนี้แล้ว</div>
          <Link className="btn btn-primary" href="/me">ไปที่โปรไฟล์ของฉัน</Link>
        </>
      ) : team.full ? (
        <div className="error">ทีมนี้เต็มแล้ว</div>
      ) : !me ? (
        discordEnabled() ? (
          <>
            <p className="muted small" style={{ margin: 0 }}>เข้าสู่ระบบด้วย Discord ก่อน แล้วระบบจะพากลับมาหน้านี้</p>
            <a className="btn btn-discord" href={`/api/auth/discord?next=${encodeURIComponent(`/join/${code}`)}`}><DiscordMark /> เข้าสู่ระบบด้วย Discord</a>
          </>
        ) : (
          <div className="notice small">ระบบเข้าสู่ระบบด้วย Discord ยังไม่เปิด</div>
        )
      ) : free.length ? (
        <JoinForm code={code} characters={free.map((p) => ({ id: p.id, label: `${p.name}${p.uid ? ` (UID ${p.uid})` : ""}` }))} />
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            {mine.length === 0
              ? "บัญชีนี้ยังไม่ได้ผูกตัวละคร ผูก UID ในเกมก่อน แล้วกลับมากดลิงก์นี้อีกครั้ง"
              : `ตัวละครของคุณ${team.game ? `ใน ${team.game.name}` : ""}อยู่ในทีมอื่นแล้ว ต้องออกจากทีมเดิมก่อน หรือผูกตัวละครใหม่`}
          </p>
          <Link className="btn btn-primary" href="/me">ไปที่โปรไฟล์ของฉัน</Link>
        </>
      )}
    </div>
  );
}
