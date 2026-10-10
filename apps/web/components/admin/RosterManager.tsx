"use client";

import { useState, useTransition } from "react";
import { saveRoster, type FormState } from "@/app/admin/actions";
import type { Entry } from "@/lib/types";
import { fmtThaiTime } from "@/lib/format";

interface Row {
  key: number;
  name: string;
  uid: string;
  server: string;
  discordId: string;
}
const emptyRow = (): Row => ({ key: nextKey++, name: "", uid: "", server: "", discordId: "" });
const character = (p: Entry["roster"][number]) => [p.uid && `UID ${p.uid}`, p.server].filter(Boolean).join(" · ");
let nextKey = 1;

/** The registered players of every team. Organizers can change a roster even after it locks. */
export function RosterManager({ tournamentId, entries, rosterMin, rosterMax, locked, lockAt }: { tournamentId: string; entries: Entry[]; rosterMin: number; rosterMax: number; locked: boolean; lockAt: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        ทีมละ {rosterMin}–{rosterMax} คน · หัวหน้าทีมเปลี่ยนรายชื่อเองใน Discord ได้ด้วยปุ่ม ⚙️ จัดการทีมของฉัน{" "}
        {locked ? "· ตอนนี้ล็อกรายชื่อแล้ว (ผู้จัดยังแก้ได้ที่นี่)" : lockAt ? `· ล็อกเมื่อแมตช์แรกเริ่ม ${fmtThaiTime(lockAt)}` : "· ล็อกเมื่อแมตช์แรกเริ่ม"}
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>ทีม</th><th>ผู้เล่น</th><th /></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td className="small">
                  {e.roster.length ? (
                    e.roster.map((p, i) => (
                      <span key={p.playerId}>
                        {i > 0 && ", "}
                        {p.name}
                        {character(p) && <span className="muted"> ({character(p)})</span>}
                      </span>
                    ))
                  ) : (
                    <span className="muted">ยังไม่ได้ส่งรายชื่อ</span>
                  )}
                </td>
                <td className="right">
                  <button type="button" className="btn btn-sm" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? "ปิด" : "แก้รายชื่อ"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.filter((e) => e.id === open).map((e) => (
        <RosterEditor key={e.id + e.roster.map((p) => p.playerId).join()} tournamentId={tournamentId} entry={e} rosterMax={rosterMax} onDone={() => setOpen(null)} />
      ))}
    </div>
  );
}

function RosterEditor({ tournamentId, entry, rosterMax, onDone }: { tournamentId: string; entry: Entry; rosterMax: number; onDone: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => {
    const r = entry.roster.map((p) => ({ key: nextKey++, name: p.name, uid: p.uid ?? "", server: p.server ?? "", discordId: p.discordId ?? "" }));
    return r.length ? r : [emptyRow()];
  });
  const [captain, setCaptain] = useState(entry.captainDiscordId ?? "");
  const [state, setState] = useState<FormState>(undefined);
  const [pending, start] = useTransition();
  const update = (key: number, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function save() {
    const players = rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), uid: r.uid.trim() || null, server: r.server.trim() || null, discordId: r.discordId.trim() || null }));
    if (!players.length) return setState({ error: "ใส่ชื่อผู้เล่นอย่างน้อย 1 คน" });
    const bad = players.find((p) => p.discordId && !/^\d{5,25}$/.test(p.discordId));
    if (bad) return setState({ error: `Discord ID ของ ${bad.name} ต้องเป็นตัวเลข (คลิกขวาที่ชื่อใน Discord แล้วเลือก Copy User ID)` });
    start(async () => {
      const res = await saveRoster(tournamentId, entry.id, players, captain.trim() || null);
      setState(res);
      if (!res?.error) onDone();
    });
  }

  return (
    <div className="card stack">
      <strong>รายชื่อ {entry.name}</strong>
      {rows.map((r, i) => (
        <div key={r.key} className="form-row" style={{ alignItems: "end" }}>
          <label>ผู้เล่น {i + 1} (ชื่อตัวละคร)<input value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} maxLength={100} /></label>
          <label>UID<input value={r.uid} onChange={(e) => update(r.key, { uid: e.target.value })} maxLength={40} /></label>
          <label>Server<input value={r.server} onChange={(e) => update(r.key, { server: e.target.value })} maxLength={40} /></label>
          <label>Discord ID (ไม่บังคับ)<input value={r.discordId} onChange={(e) => update(r.key, { discordId: e.target.value })} inputMode="numeric" placeholder="เช่น 123456789012345678" /></label>
          <button type="button" className="btn btn-sm" onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))} disabled={rows.length === 1}>เอาออก</button>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn btn-sm" disabled={rows.length >= rosterMax} onClick={() => setRows((prev) => [...prev, emptyRow()])}>+ เพิ่มผู้เล่น</button>
      </div>
      <label>
        Discord ID หัวหน้าทีม (คนที่ใช้ /roster ได้)
        <input value={captain} onChange={(e) => setCaptain(e.target.value)} inputMode="numeric" placeholder="ว่างไว้ = ไม่มีหัวหน้าทีมใน Discord" />
      </label>
      {state?.error && <div className="error">{state.error}</div>}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>{pending ? "กำลังบันทึก…" : "บันทึกรายชื่อ"}</button>
        <button type="button" className="btn" onClick={onDone}>ยกเลิก</button>
      </div>
    </div>
  );
}
