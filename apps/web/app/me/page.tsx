import Link from "next/link";
import { api, qs } from "@/lib/api";
import { getMember } from "@/lib/member";
import { discordEnabled } from "@/lib/discord";
import type { MyCharacter, ReservePlayer, GameRank, Wallet } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { ConfirmReward } from "@/app/predict/PredictForms";
import { siteOrigin } from "@/lib/site";
import { allGames } from "@/lib/games";
import { Avatar } from "@/components/ui";
import { TierBadge } from "@/components/Tier";
import { ClaimForm, EditMyPlayer, ReserveForm } from "./MeForms";
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

  const [{ data: mine }, games, origin, { data: reserves }, wallet] = await Promise.all([
    api<{ data: MyCharacter[] }>(`/members/${me.id}`),
    allGames(),
    siteOrigin(),
    api<{ data: (ReservePlayer & { player: { gameId: string | null } })[] }>(`/members/${me.id}/reserves`),
    api<Wallet>(`/predict/members/${me.id}`),
  ]);
  // เล่นเก่งปากเก่ง keeps a list per game (UIDs and names differ between games): one form for each game the member plays.
  const byGame = [...new Map(mine.map((c) => [c.game?.id ?? "", c.game])).values()];
  const reserveForms = await Promise.all(
    byGame.map(async (game) => ({
      game,
      characters: mine.filter((c) => (c.game?.id ?? "") === (game?.id ?? "")),
      current: reserves.find((r) => (r.player.gameId ?? "") === (game?.id ?? "")) ?? null,
      ranks: (await api<{ data: GameRank[] }>(`/special/ranks${qs({ gameId: game?.id })}`)).data,
    })),
  );
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

      <section id="rewards" className="card me-coins" style={{ marginBottom: 24 }}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>🔮 ทายผล · {wallet.coins} เหรียญ</h2>
          <Link href="/predict" className="btn btn-sm btn-primary">{wallet.dailyClaimed ? "ไปทายผล" : "รับเหรียญวันนี้"}</Link>
        </div>
        {wallet.rewards.length === 0 ? (
          <p className="muted small" style={{ marginBottom: 0 }}>ยังไม่มีรางวัล ติดอันดับคนทายของรายการหรือซีซั่นเพื่อลุ้นโค้ดส่วนลดและอุปกรณ์เกมมิ่ง</p>
        ) : (
          <ul className="reward-list">
            {wallet.rewards.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>🎁 {r.title}</strong>
                  {r.place ? <span className="muted small"> · อันดับ {r.place}</span> : null}
                  <span className="muted small"> · {fmtDate(r.createdAt)}</span>
                  {r.note && <div className="muted small">{r.note}</div>}
                </div>
                {r.code ? (
                  <code className="reward-code" title={r.codeLabel ?? undefined}>{r.code}</code>
                ) : r.status === "RECEIVED" ? (
                  <span className="badge">ได้รับแล้ว</span>
                ) : (
                  <span className="row" style={{ gap: 8 }}>
                    <span className="badge">{r.status === "SENT" ? "ส่งแล้ว" : "รอผู้จัดส่ง (ติดต่อทาง Discord DM)"}</span>
                    {r.status === "SENT" && <ConfirmReward id={r.id} />}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {wallet.rewards.some((r) => r.code) && <p className="muted small" style={{ marginBottom: 0 }}>นำโค้ดไปใช้ที่ร้าน Overtimeboosboos ได้เลย โค้ดใช้ได้ครั้งเดียว อย่าส่งให้คนอื่น</p>}
      </section>

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
      {mine.length > 0 ? (
        reserveForms.map((f, n) => <ReserveForm key={f.game?.id ?? "none"} anchor={n === 0} game={games.length > 1 ? f.game : null} characters={f.characters} current={f.current} ranks={f.ranks} />)
      ) : (
        <section id="reserve" className="card mt">
          <h2 style={{ marginTop: 0 }}>📝 ลงชื่อตัวสำรอง เล่นเก่งปากเก่ง</h2>
          <p className="muted" style={{ margin: 0 }}>ผูกตัวละครของคุณด้านล่างก่อน (ใส่ชื่อในเกมและ UID) แล้วฟอร์มลงชื่อตัวสำรองจะขึ้นตรงนี้</p>
        </section>
      )}
      <ClaimForm first={mine.length === 0} games={games} />
      <p className="muted small mt">ชื่อในเกม ทีม และสถิติ อัปเดตจากผลการแข่งและบอท Discord อัตโนมัติ ถ้าข้อมูลผิด แจ้งผู้จัดได้เลย</p>
    </>
  );
}
