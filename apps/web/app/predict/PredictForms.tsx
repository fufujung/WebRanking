"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { cancelBet, claimDaily, confirmReward, placeBet, type PredictState } from "./actions";
import type { Market } from "@/lib/types";

/** The daily coins button. */
export function DailyButton({ amount, claimed }: { amount: number; claimed: boolean }) {
  const [state, setState] = useState<PredictState>();
  const [pending, start] = useTransition();
  return (
    <div className="predict-daily">
      <button type="button" className="btn btn-primary" disabled={pending || claimed || Boolean(state?.ok)} onClick={() => start(async () => setState(await claimDaily()))}>
        {claimed || state?.ok ? "รับเหรียญวันนี้แล้ว" : pending ? "กำลังรับ…" : `รับ ${amount} เหรียญวันนี้`}
      </button>
      {state?.ok && <span className="success small">{state.ok}</span>}
      {state?.error && <span className="error small">{state.error}</span>}
    </div>
  );
}

/** Pick a team and how many coins to put on it. Changing the pick returns the old coins first. */
export function PickForm({ market, coins }: { market: Market; coins: number }) {
  const [state, dispatch, pending] = useActionState<PredictState, FormData>(placeBet.bind(null, market.id), undefined);
  const [cancelled, setCancelled] = useState<PredictState>();
  const [cancelling, startCancel] = useTransition();
  const spendable = coins + (market.mine?.amount ?? 0);
  const [team, setTeam] = useState(market.mine?.teamId ?? "");
  const shown = cancelled ?? state;
  return (
    <form
      className="form pick-form"
      onSubmit={(e) => {
        e.preventDefault();
        setCancelled(undefined);
        const form = new FormData(e.currentTarget);
        startTransition(() => dispatch(form));
      }}
    >
      <div className="pick-teams" role="radiogroup" aria-label="เลือกทีม">
        {market.options.map((o) => (
          <label key={o.team.id} className={`pick-team ${team === o.team.id ? "pick-team-on" : ""}`}>
            <input type="radio" name="teamId" value={o.team.id} required checked={team === o.team.id} onChange={() => setTeam(o.team.id)} />
            {o.team.name}
          </label>
        ))}
      </div>
      <div className="row pick-amount">
        <label className="grow">
          เหรียญ (มี {spendable})
          <input type="number" name="amount" min={1} max={Math.max(spendable, 1)} required defaultValue={market.mine?.amount ?? Math.min(10, Math.max(spendable, 1))} inputMode="numeric" />
        </label>
        <button className="btn btn-primary" disabled={pending || spendable < 1}>{pending ? "กำลังทาย…" : market.mine ? "เปลี่ยนคำทาย" : "ทายเลย"}</button>
        {market.mine && (
          <button type="button" className="btn btn-sm" disabled={cancelling} onClick={() => startCancel(async () => setCancelled(await cancelBet(market.id)))}>
            ยกเลิก
          </button>
        )}
      </div>
      {shown?.ok && <div className="success small">{shown.ok}</div>}
      {shown?.error && <div className="error small">{shown.error}</div>}
    </form>
  );
}

/** The winner says a prize (gear) has arrived. */
export function ConfirmReward({ id }: { id: string }) {
  const [state, setState] = useState<PredictState>();
  const [pending, start] = useTransition();
  if (state?.ok) return <span className="success small">{state.ok}</span>;
  return (
    <>
      <button type="button" className="btn btn-sm" disabled={pending} onClick={() => start(async () => setState(await confirmReward(id)))}>ได้รับของแล้ว</button>
      {state?.error && <span className="error small">{state.error}</span>}
    </>
  );
}
