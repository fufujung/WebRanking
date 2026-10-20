import Link from "next/link";
import { api, qs } from "@/lib/api";
import type { Market, PredictLeader, PredictRules, PredictTournament, Wallet } from "@/lib/types";
import { fmtThaiTime } from "@/lib/format";
import { getMember } from "@/lib/member";
import { discordEnabled } from "@/lib/discord";
import { siteSettings } from "@/lib/settings";
import { DiscordJoin } from "@/components/DiscordJoin";
import { Avatar, Empty } from "@/components/ui";
import { DailyButton, PickForm } from "./PredictForms";

export const metadata = { title: "ทายผล · ใช้เหรียญฟรี ลุ้นรางวัล" };

/** Twitch-style: what one coin on this side brings back if it wins (stake included). */
const ratio = (m: Market, coins: number) => (coins > 0 ? ` · x${(Math.floor((m.pool / coins) * 100) / 100).toFixed(m.pool / coins >= 10 ? 1 : 2)}` : "");

const STAGE: Record<string, string> = { W: "สายบน", L: "สายล่าง", GF: "ชิงชนะเลิศ", P3: "ชิงที่ 3", RR: "ตารางแข่ง" };
const marketTitle = (m: Market) => (m.kind === "CHAMPION" ? "🏆 ใครจะเป็นแชมป์" : `คู่ที่ ${m.number ?? m.key}${m.stage && m.stage !== "W" ? ` · ${STAGE[m.stage] ?? m.stage}` : ""}`);

function marketState(m: Market) {
  if (m.status === "SETTLED") return { text: "มีผลแล้ว", cls: "badge" };
  if (m.status === "REFUNDED") return { text: "คืนเหรียญแล้ว", cls: "badge" };
  if (m.open) return { text: m.locksAt ? `เปิดทายถึง ${fmtThaiTime(m.locksAt)}` : "เปิดทาย", cls: "badge badge-accent" };
  if (m.kind !== "CHAMPION" && !m.locksAt && m.status === "OPEN") return { text: "รอตั้งเวลาแข่ง", cls: "badge" };
  return { text: "ปิดทายแล้ว รอผล", cls: "badge" };
}

function Options({ m }: { m: Market }) {
  return (
    <ul className="market-options">
      {m.options.map((o) => {
        const won = m.winnerTeamId === o.team.id;
        return (
          <li key={o.team.id} className={won ? "market-won" : ""}>
            <div className="row between">
              <span className="entity">
                <strong>{won ? "✓ " : ""}{o.team.name}</strong>
              </span>
              <span className="muted small">{o.percent}% · {o.coins} เหรียญ · {o.people} คน{ratio(m, o.coins)}</span>
            </div>
            <div className="market-bar" aria-hidden><span style={{ width: `${o.percent}%` }} /></div>
          </li>
        );
      })}
    </ul>
  );
}

function Mine({ m }: { m: Market }) {
  if (!m.mine) return null;
  return (
    <p className="small market-mine">
      คุณทาย <strong>{m.options.find((o) => o.team.id === m.mine!.teamId)?.team.name ?? "ทีม"}</strong> {m.mine.amount} เหรียญ
      {m.mine.payout !== null && (m.status === "REFUNDED" ? " · ได้คืนแล้ว" : m.mine.payout > 0 ? ` · ได้ ${m.mine.payout} เหรียญ 🎉` : " · ทายพลาด")}
    </p>
  );
}

/** Each game of a series (BO3, BO5) with its own pool, folded under the match. */
function Games({ games, coins, member }: { games: Market[]; coins: number | null; member: boolean }) {
  const open = games.filter((g) => g.open).length;
  return (
    <details className="market-games" open={games.some((g) => g.mine) || undefined}>
      <summary>🎯 ทายรายเกม · {games.length} เกม{open ? ` (เปิด ${open})` : ""}</summary>
      <p className="muted small">แต่ละเกมแบ่งเหรียญแยกกัน เกมที่ไม่ได้แข่ง (เช่นจบ 3-0 ใน BO5) หรือบันทึกผลไม่มีคะแนนรายเกม คืนเหรียญ</p>
      {games.map((g) => {
        const state = marketState(g);
        return (
          <div key={g.id} className="market-game">
            <div className="row between">
              <strong>เกม {g.game}</strong>
              <span className={state.cls}>{state.text}</span>
            </div>
            <Options m={g} />
            <Mine m={g} />
            {g.open && member && coins !== null && <PickForm market={g} coins={coins} />}
          </div>
        );
      })}
    </details>
  );
}

function MarketCard({ m, games, coins, member }: { m: Market; games: Market[]; coins: number | null; member: boolean }) {
  const state = marketState(m);
  return (
    <article className={`card market-card ${m.open ? "market-open" : ""}`}>
      <header className="row between">
        <h3>{marketTitle(m)}</h3>
        <span className={state.cls}>{state.text}</span>
      </header>
      <ul className="market-options">
        {m.options.map((o) => {
          const won = m.winnerTeamId === o.team.id;
          return (
            <li key={o.team.id} className={won ? "market-won" : ""}>
              <div className="row between">
                <Link href={`/teams/${o.team.id}`} className="entity">
                  <Avatar src={o.team.logoUrl} name={o.team.name} />
                  <strong>{won ? "✓ " : ""}{o.team.name}</strong>
                </Link>
                <span className="muted small">{o.percent}% · {o.coins} เหรียญ · {o.people} คน{ratio(m, o.coins)}</span>
              </div>
              <div className="market-bar" aria-hidden><span style={{ width: `${o.percent}%` }} /></div>
            </li>
          );
        })}
      </ul>
      {m.score && m.kind === "MATCH" && <p className="muted small">ผล {m.score.a ?? "-"} : {m.score.b ?? "-"}</p>}
      {m.mine && (
        <p className="small market-mine">
          คุณทาย <strong>{m.options.find((o) => o.team.id === m.mine!.teamId)?.team.name ?? "ทีม"}</strong> {m.mine.amount} เหรียญ
          {m.mine.payout !== null && (m.status === "REFUNDED" ? " · ได้คืนแล้ว" : m.mine.payout > 0 ? ` · ได้ ${m.mine.payout} เหรียญ 🎉` : " · ทายพลาด")}
        </p>
      )}
      {m.open && member && coins !== null && <PickForm market={m} coins={coins} />}
      {m.topWinners.length > 0 && (
        <p className="muted small">ได้มากสุด: {m.topWinners.map((w) => `${w.name} +${w.won}`).join(", ")}</p>
      )}
      {games.length > 0 && <Games games={games} coins={coins} member={member} />}
    </article>
  );
}

function Board({ rows, overall }: { rows: PredictLeader[]; overall?: boolean }) {
  if (!rows.length) return <Empty>{overall ? "ยังไม่มีใครเล่น" : "ยังไม่มีแมตช์ที่มีผล"}</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>อันดับ</th>
            <th>ผู้เล่น</th>
            {overall ? <th className="num">เหรียญ</th> : <><th className="num">ได้สุทธิ</th><th className="num hide-sm">ทายถูก</th></>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.discordId}>
              <td><span className={`rank rank-${r.rank}`}>{r.rank}</span></td>
              <td>
                <span className="entity">
                  <Avatar src={r.avatarUrl} name={r.name} round />
                  {r.name}
                </span>
              </td>
              {overall ? (
                <td className="num"><strong>{r.coins}</strong></td>
              ) : (
                <>
                  <td className="num"><strong className={(r.net ?? 0) >= 0 ? "delta-up" : "delta-down"}>{(r.net ?? 0) > 0 ? "+" : ""}{r.net}</strong></td>
                  <td className="num hide-sm">{r.correct}/{r.picks}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The prediction game: free coins every day, picks on matches and champions, leaderboards and prizes. */
export default async function PredictPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const sp = await searchParams;
  const { discordInvite } = await siteSettings();
  const member = await getMember();
  const [tournaments, rules, overall, wallet] = await Promise.all([
    api<{ data: PredictTournament[] }>("/predict/tournaments").then((r) => r.data),
    api<PredictRules>("/predict/rules"),
    api<{ data: PredictLeader[] }>("/predict/leaderboard?limit=20").then((r) => r.data),
    member ? api<Wallet>(`/predict/members/${member.id}`) : null,
  ]);
  const active = tournaments.find((t) => t.id === sp.t) ?? tournaments[0] ?? null;
  const [view, board, seasonBoard] = await Promise.all([
    active ? api<{ markets: Market[] }>(`/predict/tournaments/${encodeURIComponent(active.id)}${qs({ discordId: member?.id })}`) : null,
    active ? api<{ data: PredictLeader[] }>(`/predict/leaderboard${qs({ tournamentId: active.id, limit: 20 })}`).then((r) => r.data) : [],
    active?.season ? api<{ data: PredictLeader[] }>(`/predict/leaderboard${qs({ seasonId: active.season.id, limit: 20 })}`).then((r) => r.data) : null,
  ]);
  const all = view?.markets ?? [];
  // Per-game markets show inside their match's card.
  const markets = all.filter((m) => m.kind !== "GAME");
  const gamesOf = (m: Market) => (m.kind === "MATCH" ? all.filter((g) => g.kind === "GAME" && g.match === m.key) : []);
  const open = markets.filter((m) => m.open || gamesOf(m).some((g) => g.open));
  const rest = markets.filter((m) => !open.includes(m));

  return (
    <>
      <section className="ladder-hero predict-hero">
        <div>
          <span className="eyebrow">🔮 ทายผล</span>
          <h1>ทายผลการแข่ง ลุ้นรางวัล</h1>
          <p className="muted">
            ใช้เหรียญฟรีทายว่าใครชนะแต่ละคู่และใครได้แชมป์ คนทายถูกแบ่งเหรียญของฝั่งที่ทายผิดตามสัดส่วนที่ลง
            {" "}เหรียญได้ฟรีจากการเข้าเว็บทุกวันและดูแข่งสด ซื้อหรือแลกเป็นเงินไม่ได้ รางวัลแจกตามอันดับบนตาราง
          </p>
          {member && wallet ? (
            <DailyButton amount={wallet.dailyClaimed ? 0 : wallet.nextDaily + wallet.welcome} claimed={wallet.dailyClaimed} />
          ) : discordEnabled() ? (
            <a href="/api/auth/discord?next=/predict" className="btn btn-primary">เข้าสู่ระบบด้วย Discord เพื่อรับเหรียญ</a>
          ) : null}
          <DiscordJoin href={discordInvite} className="mt" />
        </div>
        <div className="ladder-hero-stats">
          <div><strong>{wallet ? wallet.coins : "-"}</strong><span>เหรียญของคุณ</span></div>
          <div><strong>{wallet ? wallet.streak : "-"}</strong><span>เข้าต่อเนื่อง (วัน)</span></div>
          <div><strong>{tournaments.reduce((n, t) => n + t.open, 0)}</strong><span>คู่ที่เปิดทาย</span></div>
        </div>
      </section>

      {tournaments.length > 0 && (
        <nav className="tabs filter-tabs season-tabs" aria-label="เลือกรายการ">
          {tournaments.map((t) => (
            <Link key={t.id} href={`/predict?t=${t.id}`} className={`tab ${t.id === active?.id ? "tab-active" : ""}`} aria-current={t.id === active?.id ? "page" : undefined}>
              {t.special ? "⭐ " : ""}{t.name}{t.bracketStatus === "LIVE" ? " · 🔴 สด" : t.open ? ` · เปิด ${t.open}` : ""}
            </Link>
          ))}
        </nav>
      )}

      {!active ? (
        <Empty>ตอนนี้ยังไม่มีรายการให้ทาย รอรายการที่มีทีมสมัครอย่างน้อย 2 ทีม</Empty>
      ) : (
        <>
          <section className="mt">
            <h2>
              <Link href={`/tournaments/${active.id}`}>{active.name}</Link>
              {active.season && <span className="muted small"> · {active.season.name}</span>}
            </h2>
            {!member && <p className="muted small">เข้าสู่ระบบด้วย Discord แล้วทายได้เลย หรือกดปุ่มทายใต้การ์ดแมตช์ในห้อง Discord</p>}
            {markets.length === 0 ? (
              <Empty>ยังไม่มีแมตช์ให้ทาย</Empty>
            ) : (
              <div className="grid grid-2 market-grid">
                {[...open, ...rest].map((m) => <MarketCard key={m.id} m={m} games={gamesOf(m)} coins={wallet?.coins ?? null} member={Boolean(member)} />)}
              </div>
            )}
          </section>
          <section className="mt grid grid-2">
            <div>
              <h2>อันดับคนทาย · รายการนี้</h2>
              <Board rows={board} />
            </div>
            {seasonBoard && (
              <div>
                <h2>อันดับคนทาย · {active.season!.name}</h2>
                <Board rows={seasonBoard} />
              </div>
            )}
          </section>
        </>
      )}

      <section className="mt grid grid-2">
        <div>
          <h2>เหรียญมากที่สุด</h2>
          <Board rows={overall} overall />
        </div>
        <div className="card predict-rules">
          <h2>กติกา</h2>
          <ul>
            <li>เข้าครั้งแรกรับ {rules.welcome} เหรียญ จากนั้นกดรับวันละ {rules.daily} เหรียญ เข้าต่อเนื่องได้เพิ่มวันละ {rules.streakStep} (สูงสุด +{rules.streakMax * rules.streakStep})</li>
            <li>เปิดเว็บดูระหว่างมีการแข่งสด ได้ {rules.watch} เหรียญทุก {rules.watchEveryMinutes} นาที (วันละไม่เกิน {rules.watchPerDay} ครั้ง)</li>
            <li>ทายแต่ละคู่ได้จนถึงเวลาเริ่มแข่ง คู่ที่แข่ง BO3/BO5 ทายผลรายเกมแยกได้ด้วย ทายแชมป์ได้จนกว่าจะเริ่มแข่งรอบแรก เปลี่ยนหรือยกเลิกได้ก่อนปิด</li>
            <li>ผู้เล่นทายแมตช์ของทีมตัวเองไม่ได้ และทายแชมป์รายการที่ตัวเองลงแข่งไม่ได้</li>
            <li>ชนะบาย ชนะเพราะอีกทีมไม่มา หรือไม่มีใครทายถูก ทุกคนได้เหรียญคืน</li>
            <li>เหรียญซื้อขายไม่ได้และไม่มีมูลค่าเป็นเงิน ผู้จัดแจกรางวัล (โค้ดส่วนลด อุปกรณ์เกมมิ่ง) ตามอันดับบนตาราง</li>
          </ul>
          {member && <Link href="/me#rewards" className="btn btn-sm">ดูรางวัลของฉัน</Link>}
        </div>
      </section>
    </>
  );
}
