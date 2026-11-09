"use client";

import { useState, useTransition } from "react";
import { saveSpecialTeamSides } from "@/app/admin/actions";
import type { Candidate } from "./PickPlayers";
import { positionLabel } from "@/lib/solo";

type Slot = { playerId?: string; name: string } | null;
type Side = { teamId?: string; name: string; slots: Slot[] };
export interface SpecialTeamsView { size: number; locked: boolean; teams: Side[] }

export function SpecialTeamEditor({ tournamentId, eventName, view, candidates, maxSlots, rosterMin }: { tournamentId: string; eventName: string; view: SpecialTeamsView; candidates: Candidate[]; maxSlots: number; rosterMin: number }) {
  const [size, setSize] = useState(view.size);
  const [sides, setSides] = useState<Side[]>(() => [0, 1].map((i) => view.teams[i] ?? { name: `${eventName.slice(0, 85)} ทีม ${i ? "B" : "A"}`, slots: Array.from({ length: view.size }, () => null) }));
  const [rank, setRank] = useState("");
  const [position, setPosition] = useState("");
  const [message, setMessage] = useState<{ error?: string; ok?: string }>({});
  const [pending, start] = useTransition();
  const locked = view.locked || view.teams.length > 2;
  const disabled = locked || pending;
  const used = sides.flatMap((s) => s.slots.filter((p): p is NonNullable<Slot> => p !== null));
  const pool = candidates.filter((c) => (!rank || c.rank === rank) && (!position || c.position === position || c.position === "ALL") &&
    !used.some((p) => p.playerId === c.playerId || p.name.trim().toLowerCase() === c.name.trim().toLowerCase()));
  const setSlot = (side: number, slot: number, value: Slot) => {
    setMessage({});
    setSides((prev) => prev.map((s, i) => i === side ? { ...s, slots: s.slots.map((p, j) => j === slot ? value : p) } : s));
  };
  function fill(side?: number, slot?: number) {
    const targets = sides.flatMap((s, i) => s.slots.flatMap((p, j) => !p && (side === undefined || side === i) && (slot === undefined || slot === j) ? [[i, j]] : []));
    if (!targets.length) return setMessage({ error: "ไม่มีช่องว่างให้เติม" });
    if (pool.length < targets.length) return setMessage({ error: `มีผู้เล่นตรงเงื่อนไข ${pool.length} คน ต้องการ ${targets.length} คน ลองเปลี่ยนตัวกรองหรือเลือกเติมทีละช่อง` });
    const available = [...pool];
    const next = sides.map((s) => ({ ...s, slots: [...s.slots] }));
    for (const [i, j] of targets) {
      const random = new Uint32Array(1); crypto.getRandomValues(random);
      const [picked] = available.splice(random[0] % available.length, 1);
      next[i].slots[j] = { playerId: picked.playerId, name: picked.name };
    }
    setSides(next); setMessage({});
  }
  function resize(next: number) {
    if (!Number.isInteger(next) || next < 1 || next > maxSlots) return;
    if (sides.some((s) => s.slots.slice(next).some(Boolean))) return setMessage({ error: "ล้างผู้เล่นในช่องท้ายก่อนลดจำนวนช่อง" });
    setSize(next); setSides(sides.map((s) => ({ ...s, slots: Array.from({ length: next }, (_, i) => s.slots[i] ?? null) })));
  }
  function save() {
    start(async () => {
      setMessage({});
      const result = await saveSpecialTeamSides(tournamentId, { teams: sides.map((s) => ({ ...s, slots: s.slots.map((p) => p?.playerId ? { playerId: p.playerId } : p) })) });
      if (result.error) setMessage({ error: result.error });
      else if (result.view) { setSides(result.view.teams); setSize(result.view.size); setMessage({ ok: "บันทึกทีมทั้งสองฝั่งแล้ว" }); }
    });
  }
  return (
    <div className="stack">
      <h2>จัดทีมเล่นเก่งปากเก่ง · 2 ฝั่ง</h2>
      <p className="muted small">ตั้งชื่อทีม พิมพ์ชื่อผู้เล่น หรือเลือกจากรายชื่อ การสุ่มจะเติมเฉพาะช่องว่างโดยไม่เปลี่ยนคนที่ใส่ไว้ บันทึกร่างที่ยังมีช่องว่างได้ แต่ต้องมีอย่างน้อยทีมละ {rosterMin} คนก่อนจัดสาย</p>
      {locked && <p className="notice">{view.teams.length > 2 ? "รายการเดิมมีมากกว่า 2 ทีม กรุณาถอนทีมส่วนเกินก่อน" : "เริ่มแข่ง จบรายการ หรือมีผลการแข่งขันแล้ว รายชื่อถูกล็อก"}</p>}
      <div className="form-row">
        <label>จำนวนช่องต่อทีม<input aria-label="จำนวนช่องต่อทีม" type="number" min={1} max={maxSlots} value={size} disabled={disabled} onChange={(e) => resize(Number(e.target.value))} /></label>
        <label>แรงค์สำหรับเลือก / สุ่ม<select value={rank} disabled={disabled} onChange={(e) => setRank(e.target.value)}><option value="">ทุกแรงค์</option>{[...new Set(candidates.flatMap((c) => c.rank ? [c.rank] : []))].map((r) => <option key={r}>{r}</option>)}</select></label>
        <label>ตำแหน่งสำหรับเลือก / สุ่ม<select value={position} disabled={disabled} onChange={(e) => setPosition(e.target.value)}><option value="">ทุกตำแหน่ง</option>{["GUARD", "FORWARD", "CENTER"].map((p) => <option key={p} value={p}>{positionLabel[p as keyof typeof positionLabel]}</option>)}</select></label>
      </div>
      <p className="muted small">เหลือผู้เล่นตรงเงื่อนไข {pool.length} คน · <a href="/admin/reserve">จัดการรายชื่อตัวสำรอง</a></p>
      <div className="form-row">
        {sides.map((s, i) => (
          <fieldset key={i} className="card stack" disabled={disabled} style={{ minWidth: 0, flex: "1 1 300px" }}>
            <legend>ฝั่ง {i ? "B" : "A"} · {s.slots.filter(Boolean).length}/{size} คน</legend>
            <label>ชื่อทีม {i ? "B" : "A"}<input maxLength={100} value={s.name} onChange={(e) => setSides((prev) => prev.map((side, n) => n === i ? { ...side, name: e.target.value } : side))} /></label>
            {s.slots.map((p, j) => (
              <div className="stack" key={j} style={{ gap: 8 }}>
                <label>ผู้เล่น {i ? "B" : "A"} ช่อง {j + 1}<input maxLength={100} value={p?.name ?? ""} placeholder="พิมพ์ชื่อผู้เล่น" onChange={(e) => setSlot(i, j, e.target.value.trim() ? { name: e.target.value } : null)} /></label>
                <select aria-label={`เลือกผู้เล่น ${i ? "B" : "A"} ช่อง ${j + 1}`} value={p?.playerId ?? ""} onChange={(e) => { const c = candidates.find((c) => c.playerId === e.target.value); if (c) setSlot(i, j, { playerId: c.playerId, name: c.name }); }}>
                  <option value="">เลือกจากรายชื่อ…</option>
                  {p?.playerId && <option value={p.playerId}>{p.name}</option>}
                  {pool.map((c) => <option key={c.playerId} value={c.playerId}>{c.name} · {c.rank ?? "ไม่ระบุแรงค์"}</option>)}
                </select>
                <div className="row">
                  <button type="button" className="btn btn-sm" disabled={disabled || Boolean(p)} onClick={() => fill(i, j)}>สุ่มเติมช่องนี้</button>
                  <button type="button" className="btn btn-sm" disabled={disabled || !p} onClick={() => setSlot(i, j, null)}>ล้างช่อง</button>
                </div>
              </div>
            ))}
            <button type="button" className="btn" onClick={() => fill(i)}>สุ่มเติมช่องว่างฝั่ง {i ? "B" : "A"}</button>
          </fieldset>
        ))}
      </div>
      {message.error && <p className="error" role="alert">{message.error}</p>}
      {message.ok && <p className="success" role="status">{message.ok}</p>}
      <div className="row">
        <button type="button" className="btn" disabled={disabled} onClick={() => fill()}>สุ่มเติมทุกช่องว่าง</button>
        <button type="button" className="btn btn-primary" disabled={disabled || sides.some((s) => !s.name.trim())} onClick={save}>{pending ? "กำลังบันทึก…" : "บันทึกทีมทั้งสองฝั่ง"}</button>
      </div>
    </div>
  );
}
