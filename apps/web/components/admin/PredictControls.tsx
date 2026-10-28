"use client";

import { useState, useTransition } from "react";
import { createPair, deletePair, setAllMarketsOpen, setMarketOpen, settlePair, type FormState } from "@/app/admin/actions";
import { fmtDateTime } from "@/lib/format";
import type { Market } from "@/lib/types";
import { useFormAction } from "./useFormAction";
import { LogoMark } from "@/components/public/LogoMark";

const STATE: Record<Market["status"], string> = { OPEN: "เปิดรับทาย", CLOSED: "ปิดรับแล้ว", SETTLED: "มีผลแล้ว", REFUNDED: "คืนเหรียญแล้ว" };

/**
 * The organizer's prediction controls on a tournament: close or open each pick (or all of them at once),
 * and set up pairs by hand ("ทีม A vs ทีม B") for events without a bracket, then pick their winner.
 * Discord's cards follow within seconds.
 */
export function PredictControls({ tournamentId, markets, teams }: { tournamentId: string; markets: Market[]; teams: { id: string; name: string }[] }) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<FormState>) =>
    start(async () => {
      setState(undefined);
      setState(await fn());
    });
  const [made, onCreate, creating] = useFormAction(createPair.bind(null, tournamentId), undefined);
  const live = markets.filter((m) => m.status === "OPEN" || m.status === "CLOSED");
  const anyOpen = live.some((m) => m.open);
  const anyClosed = live.some((m) => m.status === "CLOSED");
  const label = (m: Market) => (m.kind === "CHAMPION" ? "ใครจะเป็นแชมป์" : m.kind === "CUSTOM" ? `🎯 ${m.title}` : m.title);

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row between">
          <strong>คู่ที่ให้ทาย ({markets.length})</strong>
          <div className="row">
            <button type="button" className="btn btn-sm btn-danger" disabled={pending || !anyOpen} onClick={() => act(() => setAllMarketsOpen(tournamentId, false))}>
              🔒 ปิดรับทายทั้งหมด
            </button>
            <button type="button" className="btn btn-sm" disabled={pending || !anyClosed} onClick={() => act(() => setAllMarketsOpen(tournamentId, true))}>
              🔓 เปิดทั้งหมด
            </button>
          </div>
        </div>
        {!markets.length && <p className="muted small" style={{ margin: 0 }}>ยังไม่มีคู่ให้ทาย สร้างสายแข่ง หรือสร้างคู่เองด้านล่าง</p>}
        {markets.map((m) => {
          const done = m.status === "SETTLED" || m.status === "REFUNDED";
          return (
            <div key={m.id} className="predict-admin-row" data-market={m.id}>
              <div>
                <strong>{m.kind === "CHAMPION" && <><LogoMark /> </>}{label(m)}</strong>
                <div className="muted small">
                  {m.options.map((o) => `${o.team.name} ${o.percent}%`).join(" · ")} · {m.pool} เหรียญ · {m.people} คน
                  {m.locksAt && !done ? ` · ปิดเอง ${fmtDateTime(m.locksAt)}` : ""}
                </div>
              </div>
              <div className="row">
                <span className={`badge${m.open ? " badge-accent" : ""}`}>{m.open ? "เปิดรับทาย" : m.status === "OPEN" ? "ยังไม่เปิด / หมดเวลา" : STATE[m.status]}</span>
                {!done && (m.status === "OPEN" ? (
                  <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => act(() => setMarketOpen(tournamentId, m.id, false))}>🔒 ปิดรับ</button>
                ) : (
                  <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(() => setMarketOpen(tournamentId, m.id, true))}>🔓 เปิดรับ</button>
                ))}
                {m.kind === "CUSTOM" && (
                  <>
                    {m.options.map((o) => (
                      <button
                        key={o.team.id}
                        type="button"
                        className={`btn btn-sm${m.winnerTeamId === o.team.id ? " btn-primary" : ""}`}
                        disabled={pending}
                        onClick={() => confirm(`${o.team.name} ชนะ? คนที่ทายถูกจะได้เหรียญทันที`) && act(() => settlePair(tournamentId, m.id, o.team.id))}
                      >
                        🏁 {o.team.name} ชนะ
                      </button>
                    ))}
                    {m.status !== "REFUNDED" && (
                      <button type="button" className="btn btn-sm" disabled={pending} onClick={() => confirm("ยกเลิกคู่นี้และคืนเหรียญทุกคน?") && act(() => settlePair(tournamentId, m.id, null))}>
                        ↩️ ยกเลิก คืนเหรียญ
                      </button>
                    )}
                    <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => confirm("ลบคู่นี้? เหรียญที่ลงไว้จะคืนทุกคน") && act(() => deletePair(tournamentId, m.id))}>
                      ลบ
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {state?.ok && <div className="success">{state.ok}</div>}
        {state?.error && <div className="error">{state.error}</div>}
        <p className="muted small" style={{ margin: 0 }}>
          คู่ในสายแข่งเปิดให้ทายเมื่อเริ่มแข่ง (หรือเมื่อตั้งเวลา) และปิดเองเมื่อถึงเวลาแข่ง ถ้าไม่ได้ตั้งเวลา กดปิดรับก่อนเริ่มเล่น ผลจะแจกเหรียญเองเมื่อบันทึกผลแมตช์ การ์ดใน Discord อัปเดตตามภายในไม่กี่วินาที
        </p>
      </div>

      {teams.length >= 2 && (
        <form className="form card" onSubmit={onCreate}>
          <h3 style={{ margin: 0 }}>+ สร้างคู่ให้ทายเอง</h3>
          <p className="muted small" style={{ margin: 0 }}>สำหรับรายการที่ไม่ใช้สายแข่ง หรือแมตช์พิเศษ เปิดให้ทายทันที กดปิดรับเมื่อเริ่มแข่ง แล้วกดเลือกทีมที่ชนะ</p>
          <div className="grid grid-2">
            <label>
              ทีม A *
              <select name="teamAId" required defaultValue="">
                <option value="" disabled>เลือกทีม</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label>
              ทีม B *
              <select name="teamBId" required defaultValue="">
                <option value="" disabled>เลือกทีม</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label>
              ชื่อคู่ (ไม่ใส่ก็ได้)
              <input name="label" maxLength={60} placeholder="เช่น รอบชิง, เกมโชว์" />
            </label>
            <label>
              ปิดรับเองเวลา (เวลาไทย, ไม่ใส่ก็ได้)
              <input type="datetime-local" name="locksAt" />
            </label>
          </div>
          {made?.ok && <div className="success">{made.ok}</div>}
          {made?.error && <div className="error">{made.error}</div>}
          <button className="btn btn-primary" disabled={creating}>{creating ? "กำลังสร้าง…" : "เปิดให้ทายคู่นี้"}</button>
        </form>
      )}
    </div>
  );
}
