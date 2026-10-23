"use client";

import { useMemo, useState } from "react";
import type { GameRank, SoloPosition } from "@/lib/types";
import { POSITIONS, positionLabel, positionText } from "@/lib/solo";

export interface DrawPerson {
  id: string;
  name: string;
  uid: string | null;
  rank: string | null;
  position: SoloPosition | null;
}

/** A fair random number in [0, n) from the browser's crypto source. */
function pick(n: number) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}
function shuffle<T>(xs: T[]) {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Draws substitutes from the เล่นเก่งปากเก่ง list: the organizer ticks ranks, picks a position, how many
 * and how many sides, then presses สุ่ม. One person can be redrawn (🔁) without touching the others.
 * Players who play All Around count for any position, as in the Discord /pool draw.
 */
export function ReserveDraw({ people, ranks }: { people: DrawPerson[]; ranks: GameRank[] }) {
  const [chosenRanks, setChosenRanks] = useState<string[]>([]);
  const [position, setPosition] = useState<SoloPosition | "">("");
  const [count, setCount] = useState(3);
  const [sides, setSides] = useState(1);
  const [picked, setPicked] = useState<string[][]>([]);
  const [out, setOut] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const fits = (p: DrawPerson) =>
    (!chosenRanks.length || (p.rank !== null && chosenRanks.includes(p.rank))) && (!position || p.position === position || p.position === "ALL");
  const pool = people.filter(fits);
  const total = count * sides;

  const draw = () => {
    setCopied(false);
    setOut([]);
    if (pool.length < total) {
      setPicked([]);
      return setNote(`มีคนตรงเงื่อนไขแค่ ${pool.length} คน (ต้องการ ${total} คน)`);
    }
    const ids = shuffle(pool.map((p) => p.id)).slice(0, total);
    setPicked(Array.from({ length: sides }, (_, s) => ids.filter((_, n) => n % sides === s)));
    setNote(null);
  };

  const redraw = (side: number, id: string) => {
    setCopied(false);
    const taken = new Set([...picked.flat(), ...out, id]);
    const free = pool.filter((p) => !taken.has(p.id));
    if (!free.length) return setNote("ไม่เหลือคนตรงเงื่อนไขให้สุ่มแทนแล้ว");
    const next = free[pick(free.length)].id;
    setOut([...out, id]);
    setPicked(picked.map((ids, s) => (s === side ? ids.map((x) => (x === id ? next : x)) : ids)));
    setNote(`สุ่มแทน ${byId.get(id)?.name ?? ""} แล้ว`);
  };

  const sideName = (s: number) => (sides === 1 ? "รายชื่อที่สุ่มได้" : `ฝั่ง ${String.fromCharCode(65 + s)}`);
  const text = picked
    .map((ids, s) => [`${sideName(s)}`, ...ids.map((id, n) => { const p = byId.get(id)!; return `${n + 1}. ${p.name} (UID ${p.uid ?? "-"}) ${p.rank ?? ""} ${positionText(p.position) ?? ""}`.trim(); })].join("\n"))
    .join("\n\n");

  return (
    <section className="card stack reserve-draw" id="draw">
      <strong>🎲 สุ่มรายชื่อตัวสำรอง</strong>
      <div className="reserve-draw-ranks" role="group" aria-label="แรงค์">
        <span className="muted small">แรงค์ (ไม่ติ๊ก = ทุกแรงค์)</span>
        {ranks.map((r) => (
          <label key={r.name} className="check">
            <input
              type="checkbox"
              checked={chosenRanks.includes(r.name)}
              onChange={(e) => setChosenRanks(e.target.checked ? [...chosenRanks, r.name] : chosenRanks.filter((x) => x !== r.name))}
            />
            {r.name}
          </label>
        ))}
      </div>
      <div className="row reserve-draw-opts">
        <label>
          ตำแหน่ง
          <select name="drawPosition" value={position} onChange={(e) => setPosition(e.target.value as SoloPosition | "")}>
            <option value="">ทุกตำแหน่ง</option>
            {POSITIONS.filter((p) => p !== "ALL").map((p) => <option key={p} value={p}>{positionLabel[p]}</option>)}
          </select>
        </label>
        <label>
          จำนวนต่อฝั่ง
          <input name="drawCount" type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
        </label>
        <label>
          จำนวนฝั่ง
          <select name="drawSides" value={sides} onChange={(e) => setSides(Number(e.target.value))}>
            <option value={1}>1 (สุ่มรายชื่อ)</option>
            <option value={2}>2 (A vs B)</option>
          </select>
        </label>
        <button type="button" className="btn btn-primary" onClick={draw}>🎲 สุ่ม</button>
      </div>
      <span className="muted small">ตรงเงื่อนไข {pool.length} คน · คนที่เล่นได้ทุกตำแหน่ง (All Around) นับทุกตำแหน่ง</span>
      {note && <div className={picked.length ? "success small" : "error small"}>{note}</div>}
      {picked.length > 0 && (
        <>
          <div className="reserve-draw-sides">
            {picked.map((ids, s) => (
              <div key={s} className="reserve-draw-side" data-draw-side={s}>
                <strong>{sideName(s)}</strong>
                <ol>
                  {ids.map((id) => {
                    const p = byId.get(id)!;
                    return (
                      <li key={id} data-draw-pick={id}>
                        <span>
                          <strong>{p.name}</strong> <span className="muted small">UID {p.uid ?? "-"} · {p.rank ?? "-"} · {positionText(p.position) ?? "-"}</span>
                        </span>
                        <button type="button" className="btn btn-sm" title="สุ่มคนอื่นแทนคนนี้" onClick={() => redraw(s, id)}>🔁 สุ่มแทน</button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={draw}>🎲 สุ่มใหม่ทั้งหมด</button>
            <button
              type="button"
              className="btn"
              onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false))}
            >
              {copied ? "✓ คัดลอกแล้ว" : "📋 คัดลอกรายชื่อ"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
