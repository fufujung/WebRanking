import Link from "next/link";
import { api, qs } from "@/lib/api";
import type { Market, Wallet } from "@/lib/types";
import { getMember } from "@/lib/member";
import { discordEnabled } from "@/lib/discord";
import { DailyButton } from "@/app/predict/PredictForms";
import { CheerCard } from "./CheerCard";

/**
 * "เชียร์ทีมไหน": the open picks of a tournament with one big button per team, right on its page.
 * A press puts the chosen coins on that team (the same prediction as /predict).
 */
export async function CheerSection({ tournamentId, next, title = "🔮 เชียร์ทีมไหน" }: { tournamentId: string; next: string; title?: string }) {
  const member = await getMember();
  const [view, wallet] = await Promise.all([
    api<{ markets: Market[] }>(`/predict/tournaments/${encodeURIComponent(tournamentId)}${qs({ discordId: member?.id })}`).catch(() => null),
    member ? api<Wallet>(`/predict/members/${member.id}`).catch(() => null) : null,
  ]);
  const open = (view?.markets ?? []).filter((m) => m.open && m.kind !== "GAME");
  if (!open.length) return null;
  return (
    <section className="mt cheer" id="cheer">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span className="row small">
          {wallet && <span className="badge">🪙 {wallet.coins} เหรียญ</span>}
          <Link href={`/predict?t=${tournamentId}`} className="badge">ดูทั้งหมด / ทายรายเกม</Link>
        </span>
      </div>
      <p className="muted small">กดปุ่มทีมที่เชียร์ ใช้เหรียญฟรีทายผล ทีมชนะได้แบ่งเหรียญของฝั่งที่แพ้ เหรียญไม่มีมูลค่าเป็นเงิน</p>
      {member && wallet && !wallet.dailyClaimed && <DailyButton amount={wallet.nextDaily + wallet.welcome} claimed={false} />}
      {!member && discordEnabled() && (
        <a href={`/api/auth/discord?next=${encodeURIComponent(next)}`} className="btn btn-primary">เข้าสู่ระบบด้วย Discord เพื่อเชียร์</a>
      )}
      <div className="grid grid-2 mt-sm">
        {open.map((m) => <CheerCard key={m.id} market={m} coins={wallet?.coins ?? null} />)}
      </div>
    </section>
  );
}
