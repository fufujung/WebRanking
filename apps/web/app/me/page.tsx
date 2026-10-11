import Link from "next/link";
import { api } from "@/lib/api";
import { getMember } from "@/lib/member";
import { discordEnabled } from "@/lib/discord";
import type { MyCharacter } from "@/lib/types";
import { siteOrigin } from "@/lib/site";
import { allGames } from "@/lib/games";
import { Avatar } from "@/components/ui";
import { TierBadge } from "@/components/Tier";
import { ClaimForm, EditMyPlayer } from "./MeForms";
import { TeamPanel } from "./TeamPanel";
import { GuildPanel } from "./GuildPanel";
import { memberLogout } from "./actions";
import { DiscordMark } from "@/components/DiscordMark";

export const metadata = { title: "โปรไฟล์ของฉัน", robots: { index: false } };

const ERRORS: Record<string, string> = {
  off: "ระบบเข้าสู่ระบบด้วย Discord ยังไม่เปิด",
  cancelled: "ยกเลิกการเข้าสู่ระบบแล้ว",
  state: "ลิงก์เข้าสู่ระบบหมดอายุ กรุณากดเข้าสู่ระบบใหม่",
  discord: "เชื่อมต่อ Discord ไม่สำเร็จ กรุณาลองใหม่",
};

function RankLine({ p }: { p: MyCharacter }) {
  return (
    <span className="me-rank small">
      {p.game && <span className="pill">{p.game.name}</span>}
      <TierBadge tier={p.tier} size={20} />
      <strong>{p.mmr} MMR</strong>
      {p.rank ? (
        <span>อันดับ <strong>#{p.rank}</strong> จาก {p.rankedPlayers} คน{p.game ? ` ใน ${p.game.name}` : ""}</span>
      ) : (
        <span className="muted">ยังไม่ติดอันดับ · แข่งอีก {p.seriesToPlace} ซีรีส์</span>
      )}
    </span>
  );
}

export default async function MePage({ searchParams }: { searchParams: Promise<{ error?: string; joined?: string }> }) {
  const sp = await searchParams;
  const me = await getMember();
  const error = sp.error ? ERRORS[sp.error] ?? ERRORS.discord : null;

  if (!me) {
    return (
      <div className="card me-login">
        <h1>เข้าสู่ระบบสำหรับผู้เล่น</h1>
        <p className="muted">ใช้บัญชี Discord เดียวกับที่ใช้ในเซิร์ฟเวอร์ทัวร์นาเมนต์ แล้วแก้รูปโปรไฟล์ ชื่อเล่น และผูก UID ของคุณได้เอง</p>
        {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
        {discordEnabled() ? (
          <a className="btn btn-discord" href="/api/auth/discord"><DiscordMark /> เข้าสู่ระบบด้วย Discord</a>
        ) : (
          <div className="notice small">ระบบเข้าสู่ระบบด้วย Discord ยังไม่เปิด ผู้จัดต้องใส่ DISCORD_CLIENT_ID และ DISCORD_CLIENT_SECRET ก่อน</div>
        )}
        <p className="muted small" style={{ marginTop: 14, marginBottom: 0 }}>เราขอแค่ชื่อและรูปโปรไฟล์ Discord ไม่ขออีเมลหรือรหัสผ่าน</p>
      </div>
    );
  }

  const [{ data: mine }, games, origin] = await Promise.all([api<{ data: MyCharacter[] }>(`/members/${me.id}`), allGames(), siteOrigin()]);
  return (
    <>
      <div className="page-head">
        <div className="row">
          <Avatar src={me.avatar} name={me.name} size="lg" round />
          <div>
            <h1>{me.name}</h1>
            <span className="muted small discord-chip"><DiscordMark /> เข้าสู่ระบบด้วย Discord</span>
          </div>
        </div>
        <form action={memberLogout}><button className="btn btn-sm">ออกจากระบบ</button></form>
      </div>
      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}
      {sp.joined && <div className="success" style={{ marginBottom: 16 }}>เข้าร่วมทีมแล้ว ยินดีต้อนรับ!</div>}

      {mine.length > 0 && (
        <section className="stack" style={{ marginBottom: 24 }}>
          <h2 style={{ margin: 0 }}>โปรไฟล์ของคุณ ({mine.length})</h2>
          {mine.map((p) => (
            <div key={p.id} className="card me-player">
              <div className="row between" style={{ marginBottom: 12 }}>
                <Link href={`/players/${p.id}`} className="entity">
                  <Avatar src={p.avatarUrl} name={p.name} round />
                  <span>
                    <strong>{p.name}</strong>
                    <span className="muted small"> · {p.uid ? `UID ${p.uid}${p.server ? ` (${p.server})` : ""}` : "ยังไม่มี UID"}</span>
                  </span>
                </Link>
                <Link href={`/players/${p.id}`} className="muted small">ดูหน้าโปรไฟล์ →</Link>
              </div>
              <RankLine p={p} />
              <h3 className="me-sub">ทีม</h3>
              <TeamPanel me={p} inviteBase={origin} />
              <h3 className="me-sub">กิลด์{p.guildInvites.length > 0 && !p.guild ? <span className="pill pill-warn" style={{ marginLeft: 8 }}>มีคำเชิญ {p.guildInvites.length}</span> : null}</h3>
              <GuildPanel me={p} />
              <h3 className="me-sub">แก้ไขโปรไฟล์</h3>
              <EditMyPlayer player={{ ...p, team: null }} />
            </div>
          ))}
        </section>
      )}
      <ClaimForm first={mine.length === 0} games={games} />
      <p className="muted small mt">ชื่อในเกม ทีม และสถิติ อัปเดตจากผลการแข่งและบอท Discord อัตโนมัติ ถ้าข้อมูลผิด แจ้งผู้จัดได้เลย</p>
    </>
  );
}
