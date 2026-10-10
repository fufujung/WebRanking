"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  decideMatch,
  reopenSlot,
  resetBracket,
  resolveDispute,
  scheduleBracket,
  seedBracket,
  startBracket,
  type FormState,
} from "@/app/admin/actions";
import type { Bracket, BracketSlot, Entry, Format } from "@/lib/types";
import { fmtThaiTime, toBangkokInput } from "@/lib/format";
import { BracketView } from "../Bracket";

const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/** First-round slots for a manual draw: every pair gets a team before any pair gets a second, so no pair is empty. */
function defaultPositions(ids: string[]): (string | null)[] {
  const size = nextPow2(ids.length);
  const half = size / 2;
  const out: (string | null)[] = Array(size).fill(null);
  ids.forEach((id, i) => {
    if (i < half) out[i * 2] = id;
    else out[(i - half) * 2 + 1] = id;
  });
  return out;
}

function Message({ state }: { state: FormState }) {
  if (state?.error) return <div className="error">{state.error}</div>;
  if (state?.ok) return <div className="success">{state.ok}</div>;
  return null;
}

/** Seeding (auto or by hand), review, start, and running the live bracket. */
export function BracketAdmin({ tournamentId, format, bracket, entries }: { tournamentId: string; format: Format; bracket: Bracket | null; entries: Entry[] }) {
  const status = bracket?.status ?? "NONE";
  const [state, setState] = useState<FormState>(undefined);
  const [pending, start] = useTransition();
  const [confirmReset, setConfirmReset] = useState(false);
  const act = (fn: () => Promise<FormState>) =>
    start(async () => {
      setState(undefined);
      setState(await fn());
    });

  if (entries.length < 2) {
    return <p className="muted">ต้องมีอย่างน้อย 2 ทีมจึงจะจัดสายได้ (เพิ่มทีมด้านล่าง หรือให้ทีมสมัครผ่าน Discord ด้วยคำสั่ง /register)</p>;
  }

  const started = status === "LIVE" || status === "DONE";
  return (
    <div className="stack">
      {!started && <Seeding key={entries.map((e) => e.id).join()} tournamentId={tournamentId} format={format} bracket={bracket} entries={entries} act={act} pending={pending} />}
      {status === "DRAFT" && bracket && (
        <div className="card stack">
          <div className="row between">
            <strong>ตัวอย่างสาย (ยังไม่เริ่ม)</strong>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => act(() => startBracket(tournamentId))}>
              ยืนยันสายและเริ่มแข่ง
            </button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            เมื่อเริ่มแล้ว การรับสมัครจะปิด บอทจะสร้างห้องแข่งให้ทีมที่พร้อม และแมตช์รอบแรกจะใช้เวลาเริ่มของรายการ (แก้เวลาได้ทีละแมตช์หรือทั้งรอบ)
          </p>
          <BracketView bracket={bracket} />
        </div>
      )}
      {started && bracket && <LiveBracket tournamentId={tournamentId} bracket={bracket} act={act} pending={pending} />}
      <Message state={state} />
      {status !== "NONE" && (
        <div className="row">
          {!confirmReset ? (
            <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={() => setConfirmReset(true)}>
              ลบสายทั้งหมด
            </button>
          ) : (
            <>
              <span className="small">
                {started ? "ลบสายที่เริ่มแข่งแล้ว? ผลที่บันทึกไว้จะยังอยู่เป็นแมตช์ทั่วไป แต่สายและอันดับจะหายทั้งหมด" : "ลบสายที่จัดไว้?"}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={pending}
                onClick={() => {
                  setConfirmReset(false);
                  act(() => resetBracket(tournamentId, started));
                }}
              >
                ยืนยันลบ
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setConfirmReset(false)}>ยกเลิก</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Seeding({
  tournamentId,
  format,
  bracket,
  entries,
  act,
  pending,
}: {
  tournamentId: string;
  format: Format;
  bracket: Bracket | null;
  entries: Entry[];
  act: (fn: () => Promise<FormState>) => void;
  pending: boolean;
}) {
  const ids = entries.map((e) => e.id);
  const name = (id: string | null) => (id ? (entries.find((e) => e.id === id)?.name ?? "?") : "บาย");
  const rr = format === "ROUND_ROBIN";
  const seeded = [...entries].sort((a, b) => (a.seed ?? Infinity) - (b.seed ?? Infinity)).map((e) => e.id);
  const [manual, setManual] = useState(false);
  const [order, setOrder] = useState<string[]>(seeded);
  const [positions, setPositions] = useState<(string | null)[]>(() => {
    const p = bracket?.positions;
    return p && p.length === nextPow2(ids.length) && ids.every((id) => p.includes(id)) ? p : defaultPositions(seeded);
  });

  const move = (i: number, d: -1 | 1) =>
    setOrder((prev) => {
      const next = [...prev];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  /** Putting a team in a slot swaps it with whatever was there. */
  const place = (slot: number, value: string | null) =>
    setPositions((prev) => {
      const next = [...prev];
      const from = value === null ? -1 : next.indexOf(value);
      if (from >= 0) next[from] = next[slot];
      else if (next[slot] !== null) {
        // The team leaving this slot needs a home: the first empty slot.
        const empty = next.findIndex((p, i) => p === null && i !== slot);
        if (empty < 0) return prev;
        next[empty] = next[slot];
      }
      next[slot] = value;
      return next;
    });

  return (
    <div className="card stack">
      <strong>จัดสาย ({entries.length} ทีม)</strong>
      <div className="row">
        <button type="button" className="btn" disabled={pending} onClick={() => act(() => seedBracket(tournamentId, { method: "rating" }))}>
          อัตโนมัติตามเรตติ้ง
        </button>
        <button type="button" className="btn" disabled={pending} onClick={() => act(() => seedBracket(tournamentId, { method: "random" }))}>
          สุ่ม
        </button>
        <button type="button" className={`btn${manual ? " btn-primary" : ""}`} onClick={() => setManual((v) => !v)}>
          จัดเอง (แมนนวล)
        </button>
      </div>
      {manual &&
        (rr ? (
          <div className="stack">
            <p className="muted small" style={{ margin: 0 }}>เรียงลำดับซีด (ทุกทีมพบกันหมด ลำดับนี้ใช้จัดตารางแต่ละรอบ)</p>
            <div className="seed-list">
              {order.map((id, i) => (
                <div key={id} className="seed-item">
                  <span className="badge">{i + 1}</span>
                  <span style={{ flex: 1 }}>{name(id)}</span>
                  <button type="button" className="btn btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="ขึ้น">▲</button>
                  <button type="button" className="btn btn-sm" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label="ลง">▼</button>
                </div>
              ))}
            </div>
            <div className="row">
              <button type="button" className="btn btn-primary" disabled={pending} onClick={() => act(() => seedBracket(tournamentId, { method: "manual", order }))}>
                ใช้ลำดับนี้
              </button>
            </div>
          </div>
        ) : (
          <div className="stack">
            <p className="muted small" style={{ margin: 0 }}>
              วางทีมลงคู่รอบแรก เลือกทีมในช่องไหน ทีมที่อยู่ช่องนั้นจะสลับไปแทน ช่อง “บาย” คือได้ผ่านรอบแรกโดยไม่ต้องแข่ง
            </p>
            <div className="seed-grid">
              {Array.from({ length: positions.length / 2 }, (_, pair) => (
                <div key={pair} className="seed-pair">
                  <span className="muted small" style={{ gridColumn: "1 / -1" }}>คู่ที่ {pair + 1}</span>
                  {[0, 1].map((side) => {
                    const slot = pair * 2 + side;
                    return (
                      <select key={side} value={positions[slot] ?? ""} onChange={(e) => place(slot, e.target.value || null)} aria-label={`คู่ที่ ${pair + 1} ฝั่ง ${side ? "B" : "A"}`}>
                        <option value="">บาย</option>
                        {ids.map((id) => <option key={id} value={id}>{name(id)}</option>)}
                      </select>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="row">
              <button type="button" className="btn btn-primary" disabled={pending} onClick={() => act(() => seedBracket(tournamentId, { method: "manual", positions }))}>
                ใช้สายนี้
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setPositions(defaultPositions(seeded))}>เริ่มใหม่</button>
            </div>
          </div>
        ))}
    </div>
  );
}

function LiveBracket({ tournamentId, bracket, act, pending }: { tournamentId: string; bracket: Bracket; act: (fn: () => Promise<FormState>) => void; pending: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = bracket.matches.find((m) => m.id === selectedId) ?? null;
  const disputed = bracket.matches.filter((m) => m.disputed);
  return (
    <div className="stack">
      {disputed.length > 0 && (
        <div className="notice">
          ⚠️ มีการแย้งผล: {disputed.map((m) => (
            <button key={m.id} type="button" className="link-btn" onClick={() => setSelectedId(m.id)}>M{m.number} </button>
          ))}
        </div>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        {bracket.status === "DONE" ? "จบการแข่งขันแล้ว" : "กดที่แมตช์เพื่อตั้งเวลา บันทึกผล ตัดสินชนะบาย หรือยกเลิกผล"}
      </p>
      <BracketView bracket={bracket} onSelect={(s) => setSelectedId(s.id === selectedId ? null : s.id)} selectedId={selectedId ?? undefined} />
      {selected && <SlotPanel key={selected.id} tournamentId={tournamentId} slot={selected} act={act} pending={pending} />}
    </div>
  );
}

function SlotPanel({ tournamentId, slot, act, pending }: { tournamentId: string; slot: BracketSlot; act: (fn: () => Promise<FormState>) => void; pending: boolean }) {
  const [time, setTime] = useState(toBangkokInput(slot.scheduledAt));
  const [wholeRound, setWholeRound] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<FormState>(undefined);
  // A decision that would wipe later results waits for a second click.
  const [retry, setRetry] = useState<null | { label: string; run: () => Promise<FormState> }>(null);
  const [busy, startBusy] = useTransition();

  const go = (label: string, run: (force: boolean) => Promise<FormState>) =>
    startBusy(async () => {
      setResult(undefined);
      setRetry(null);
      const res = await run(false);
      if (res?.needsForce) setRetry({ label, run: () => run(true) });
      setResult(res);
    });

  const playable = slot.teamA && slot.teamB && (slot.status === "READY" || (slot.status === "DONE" && slot.outcome !== "BYE"));
  const decided = slot.status === "DONE" && slot.outcome !== "BYE";
  const disabled = pending || busy;
  const team = (e: BracketSlot["teamA"], bye: boolean, source: string | null) => e?.name ?? (bye ? "บาย" : (source ?? "รอทีม"));

  return (
    <div className="card stack">
      <div className="row between">
        <strong>
          M{slot.number} · {slot.label}: {team(slot.teamA, slot.byeA, slot.sourceA)} vs {team(slot.teamB, slot.byeB, slot.sourceB)}
        </strong>
        <span className="badge">
          {slot.status === "DONE" ? (slot.outcome === "WALKOVER" ? "ชนะบาย" : slot.outcome === "BYE" ? "บาย" : `จบแล้ว ${slot.scoreA}-${slot.scoreB}`) : slot.status === "READY" ? "รอแข่ง" : "รอทีม"}
        </span>
      </div>
      {slot.status === "READY" && (
        <div className="small muted">
          เช็คอิน: {slot.teamA?.name} {slot.checkInA ? `✅ ${fmtThaiTime(slot.checkInA)}` : "ยังไม่เช็คอิน"} · {slot.teamB?.name}{" "}
          {slot.checkInB ? `✅ ${fmtThaiTime(slot.checkInB)}` : "ยังไม่เช็คอิน"}
          {slot.deadline && ` · เลทได้ถึง ${fmtThaiTime(slot.deadline)}`}
        </div>
      )}
      {slot.disputeNote && <div className={slot.disputed ? "notice" : "muted small"}>{slot.disputed ? "⚠️ แย้งผล: " : "หมายเหตุ: "}{slot.disputeNote}</div>}

      {slot.status !== "DONE" && slot.status !== "SKIPPED" && (
        <div className="form-row" style={{ alignItems: "end" }}>
          <label>
            เวลาแข่ง (เวลาไทย)
            <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={wholeRound} onChange={(e) => setWholeRound(e.target.checked)} /> ใช้กับทุกแมตช์ใน{slot.label}
          </label>
          <span className="row">
            <button
              type="button"
              className="btn btn-sm"
              disabled={disabled}
              onClick={() => act(() => scheduleBracket(tournamentId, wholeRound ? { stage: slot.stage, round: slot.round } : { match: slot.id }, time))}
            >
              บันทึกเวลา
            </button>
            {slot.scheduledAt && (
              <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => act(() => scheduleBracket(tournamentId, wholeRound ? { stage: slot.stage, round: slot.round } : { match: slot.id }, ""))}>
                ล้างเวลา
              </button>
            )}
          </span>
        </div>
      )}

      {playable && (
        <div className="row">
          {slot.matchId ? (
            <Link className="btn btn-sm btn-primary" href={`/admin/matches/${slot.matchId}`}>แก้ผลและสถิติ</Link>
          ) : (
            <Link className="btn btn-sm btn-primary" href={`/admin/matches/new?tournamentId=${tournamentId}&slot=${slot.id}`}>
              {decided ? "บันทึกสถิติ (แทนผลชนะบาย)" : "บันทึกผลและสถิติ"}
            </Link>
          )}
          {slot.matchId && <Link className="btn btn-sm" href={`/matches/${slot.matchId}`}>ดูหน้าแมตช์</Link>}
        </div>
      )}

      {slot.teamA && slot.teamB && slot.outcome !== "BYE" && slot.status !== "PENDING" && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="small muted">ผู้จัดตัดสิน (ชนะบาย หรือกลับคำตัดสินเมื่อมีการแย้ง)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="เหตุผล (ไม่บังคับ) เช่น ทีม B มาช้าเกินเวลา" />
          <div className="row">
            {[slot.teamA, slot.teamB].map((t) => (
              <button
                key={t.id}
                type="button"
                className="btn btn-sm"
                disabled={disabled || slot.winnerId === t.id}
                onClick={() => go(`ให้ ${t.name} ชนะ`, (force) => decideMatch(tournamentId, slot.id, t.id, force, note))}
              >
                ให้ {t.name} ชนะ
              </button>
            ))}
            {decided && (
              <button type="button" className="btn btn-sm btn-danger" disabled={disabled} onClick={() => go("ยกเลิกผล", (force) => reopenSlot(tournamentId, slot.id, force))}>
                ยกเลิกผล (แข่งใหม่)
              </button>
            )}
            {slot.disputed && (
              <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => act(() => resolveDispute(tournamentId, slot.id))}>
                ปิดเรื่องแย้งผล (ผลเดิมถูกต้อง)
              </button>
            )}
          </div>
        </div>
      )}
      <Message state={result} />
      {retry && (
        <div className="row">
          <button type="button" className="btn btn-sm btn-danger" disabled={disabled} onClick={() => go(retry.label, () => retry.run())}>
            ยืนยัน {retry.label} และล้างผลแมตช์ถัดไป
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setRetry(null)}>ยกเลิก</button>
        </div>
      )}
    </div>
  );
}
