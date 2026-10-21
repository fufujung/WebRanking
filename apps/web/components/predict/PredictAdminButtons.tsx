"use client";

import { useState, useTransition } from "react";
import { setAllMarketsOpen, setMarketOpen, type FormState } from "@/app/admin/actions";
import type { Market } from "@/lib/types";

/**
 * The organizer's quick lock on /predict: shown only to a logged-in admin (the page checks the session,
 * and each server action checks it again). Discord's cards follow within seconds.
 */
export function MarketLock({ tournamentId, market }: { tournamentId: string; market: Market }) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  if (market.status !== "OPEN" && market.status !== "CLOSED") return null;
  const open = market.status === "OPEN";
  return (
    <div className="row predict-lock" data-lock={market.id}>
      <button
        type="button"
        className={`btn btn-sm${open ? " btn-danger" : ""}`}
        disabled={pending}
        onClick={() => start(async () => setState(await setMarketOpen(tournamentId, market.id, !open)))}
      >
        {open ? "🔒 ปิดรับทาย" : "🔓 เปิดรับทาย"}
      </button>
      {state?.error && <span className="error small">{state.error}</span>}
    </div>
  );
}

/** Close (or open) every pick of the shown event at once. */
export function LockAll({ tournamentId, markets }: { tournamentId: string; markets: Market[] }) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const anyOpen = markets.some((m) => m.status === "OPEN");
  const anyClosed = markets.some((m) => m.status === "CLOSED");
  if (!anyOpen && !anyClosed) return null;
  return (
    <div className="card row between predict-lock-all">
      <span className="small">👑 แอดมิน · คนทั่วไปไม่เห็นแถบนี้</span>
      <div className="row">
        <button type="button" className="btn btn-sm btn-danger" disabled={pending || !anyOpen} onClick={() => start(async () => setState(await setAllMarketsOpen(tournamentId, false)))}>
          🔒 ปิดรับทายทั้งหมด
        </button>
        <button type="button" className="btn btn-sm" disabled={pending || !anyClosed} onClick={() => start(async () => setState(await setAllMarketsOpen(tournamentId, true)))}>
          🔓 เปิดทั้งหมด
        </button>
      </div>
      {state?.ok && <span className="success small">{state.ok}</span>}
      {state?.error && <span className="error small">{state.error}</span>}
    </div>
  );
}
