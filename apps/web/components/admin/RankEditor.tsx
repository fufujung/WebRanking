"use client";

import { useState, useTransition } from "react";
import { saveGameRanks } from "@/app/admin/actions";
import type { GameRank } from "@/lib/types";
import { ImageDrop } from "../ImageDrop";

/** Kuroko's season ranks, lowest first: the same defaults the API uses until a game has its own. */
const DEFAULT = ["แม่ทัพไร้มงกุฎ", "ซูเปอร์สตาร์ ม.ปลาย", "รุ่นแห่งปาฏิหาริย์", "เจ้าแห่ง ZONE"];

/** Edits a game's ranks, lowest first: name, icon, order. */
export function RankEditor({ gameId, initial }: { gameId: string; initial: GameRank[] }) {
  const [rows, setRows] = useState<(GameRank & { key: number })[]>(
    (initial.length ? initial : DEFAULT.map((name) => ({ name, iconUrl: null }))).map((r, key) => ({ ...r, key })),
  );
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<GameRank>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) =>
    setRows((rs) => {
      const a = [...rs];
      const j = i + by;
      if (j < 0 || j >= a.length) return rs;
      [a[i], a[j]] = [a[j], a[i]];
      return a;
    });
  return (
    <form
      className="card form rank-editor"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setMsg((await saveGameRanks(gameId, rows.filter((r) => r.name.trim()).map(({ name, iconUrl }) => ({ name: name.trim(), iconUrl })))) ?? {}));
      }}
    >
      {!initial.length && <div className="notice small">ยังไม่ได้ตั้งแรงค์ของเกมนี้ ตอนนี้ใช้รายการเริ่มต้น แก้ชื่อ ใส่รูป แล้วกดบันทึกได้เลย</div>}
      {rows.map((r, i) => (
        <div key={r.key} className="rank-editor-row">
          <strong className="muted">{i + 1}</strong>
          <input value={r.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={30} required aria-label={`ชื่อแรงค์ที่ ${i + 1}`} placeholder="ชื่อแรงค์" />
          <ImageDrop name={`icon-${r.key}`} value={r.iconUrl} onChange={(v) => set(i, { iconUrl: v })} compact label="ลากรูปไอคอนมาวาง หรือคลิกเลือกไฟล์" />
          <span className="row-actions">
            <button type="button" className="btn btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="เลื่อนขึ้น">↑</button>
            <button type="button" className="btn btn-sm" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="เลื่อนลง">↓</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={rows.length === 1}>ลบ</button>
          </span>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn" onClick={() => setRows((rs) => [...rs, { name: "", iconUrl: null, key: Math.max(-1, ...rs.map((x) => x.key)) + 1 }])}>+ เพิ่มแรงค์</button>
      </div>
      {msg.error && <div className="error">{msg.error}</div>}
      {msg.ok && <div className="success">{msg.ok}</div>}
      <div className="row"><button className="btn btn-primary" disabled={pending}>{pending ? "กำลังบันทึก…" : "บันทึกแรงค์"}</button></div>
    </form>
  );
}
