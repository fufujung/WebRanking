"use client";

import { useState, useTransition } from "react";
import { placeBet, type PredictState } from "@/app/predict/actions";
import type { Market } from "@/lib/types";
import { fmtThaiTime } from "@/lib/format";
import { LogoMark } from "@/components/public/LogoMark";

const STAGE: Record<string, string> = { L: "สายล่าง", GF: "ชิงชนะเลิศ", P3: "ชิงที่ 3" };
const CHIPS = [10, 50, 100];

/** One match: a big button per team; pressing one puts the chosen coins on it. Without coins (logged out) the buttons only show the split. */
export function CheerCard({ market: m, coins }: { market: Market; coins: number | null }) {
  const spendable = coins === null ? 0 : coins + (m.mine?.amount ?? 0);
  const [amount, setAmount] = useState(Math.max(1, Math.min(m.mine?.amount ?? 10, spendable || 10)));
  const [state, setState] = useState<PredictState>();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState(m.mine?.teamId ?? null);
  const cheer = (teamId: string) =>
    start(async () => {
      const form = new FormData();
      form.set("teamId", teamId);
      form.set("amount", String(amount));
      const r = await placeBet(m.id, undefined, form);
      setState(r);
      if (r?.ok) setPicked(teamId);
    });
  const title = m.kind === "CHAMPION" ? "ใครจะเป็นแชมป์" : m.kind === "CUSTOM" ? m.title : `คู่ที่ ${m.number ?? m.key}${m.stage && STAGE[m.stage] ? ` · ${STAGE[m.stage]}` : ""}`;
  return (
    <article className="card cheer-card">
      <header className="row between">
        <strong>{m.kind === "CHAMPION" && <><LogoMark /> </>}{title}</strong>
        {m.locksAt && <span className="badge badge-accent">ถึง {fmtThaiTime(m.locksAt)}</span>}
      </header>
      <div className={`cheer-teams ${m.options.length > 2 ? "cheer-many" : ""}`}>
        {m.options.map((o) => {
          const ratio = o.coins > 0 ? Math.floor((m.pool / o.coins) * 100) / 100 : null;
          return (
            <button
              key={o.team.id}
              type="button"
              className={`cheer-team ${picked === o.team.id ? "cheer-team-on" : ""}`}
              disabled={coins === null || pending || spendable < 1}
              onClick={() => cheer(o.team.id)}
              aria-pressed={picked === o.team.id}
            >
              <span className="cheer-fill" style={{ width: `${o.percent}%` }} aria-hidden />
              <span className="cheer-label">
                <span className="cheer-name">{picked === o.team.id ? "เลือกแล้ว · " : ""}{o.team.name}</span>
                <span className="small">{o.percent}% · {o.people} คน{ratio ? ` · x${ratio.toFixed(ratio >= 10 ? 1 : 2)}` : ""}</span>
              </span>
            </button>
          );
        })}
      </div>
      {coins !== null && (
        <div className="row small cheer-amount" role="group" aria-label="จำนวนเหรียญ">
          <span className="muted">ลง</span>
          {CHIPS.filter((c) => c <= spendable).map((c) => (
            <button key={c} type="button" className={`chip ${amount === c ? "chip-on" : ""}`} onClick={() => setAmount(c)}>{c}</button>
          ))}
          {spendable > 0 && <button type="button" className={`chip ${amount === spendable ? "chip-on" : ""}`} onClick={() => setAmount(spendable)}>ทั้งหมด {spendable}</button>}
          <input type="number" min={1} max={Math.max(spendable, 1)} value={amount} onChange={(e) => setAmount(Math.max(1, Math.min(Number(e.target.value) || 1, Math.max(spendable, 1))))} aria-label="จำนวนเหรียญ" className="cheer-input" />
          <span className="muted">เหรียญ</span>
        </div>
      )}
      {coins !== null && spendable < 1 && <p className="muted small" style={{ margin: 0 }}>เหรียญหมด รับเหรียญประจำวันก่อนนะ</p>}
      {m.mine && !state && <p className="small market-mine" style={{ margin: 0 }}>คุณเชียร์ <strong>{m.options.find((o) => o.team.id === m.mine!.teamId)?.team.name}</strong> {m.mine.amount} เหรียญ · กดทีมอีกครั้งเพื่อเปลี่ยน</p>}
      {state?.ok && <p className="success small" style={{ margin: 0 }}>เชียร์แล้ว {amount} เหรียญ · {state.ok.replace("ทายแล้ว ", "")}</p>}
      {state?.error && <p className="error small" style={{ margin: 0 }}>{state.error}</p>}
    </article>
  );
}
