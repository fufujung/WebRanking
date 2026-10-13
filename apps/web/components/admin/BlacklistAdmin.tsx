"use client";

import { useState, useTransition } from "react";
import { addBlacklist, changeBlacklist, setBlacklistPenalty, type FormState } from "@/app/admin/actions";
import type { BlacklistEntry } from "@/lib/types";
import { TeamPicker, type PickerTeam } from "../TeamPicker";
import { useFormAction } from "./useFormAction";

/** Lift (MMR back), put back, or delete a hand-added entry. */
export function BlacklistActions({ entry }: { entry: BlacklistEntry }) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const act = (change: "lift" | "restore" | "delete") => {
    let note: string | undefined;
    if (change === "lift") {
      const answer = prompt(`ยกเลิกโทษของ ${entry.player.name}? MMR ${entry.penalty} จะคืนให้\nเหตุผล (ไม่ใส่ก็ได้):`, "");
      if (answer === null) return;
      note = answer.trim() || undefined;
    } else if (change === "delete" && !confirm(`ลบรายการนี้ของ ${entry.player.name}? MMR ${entry.penalty} จะคืนให้`)) return;
    start(async () => setState(await changeBlacklist(entry.id, change, note)));
  };
  const editPenalty = () => {
    const answer = prompt(`หัก MMR ของ ${entry.player.name} กี่แต้ม? (0-500 ใส่ 0 = ไม่หัก แต่ยังอยู่ใน Blacklist)`, String(entry.penalty));
    if (answer === null) return;
    const n = Number(answer.trim());
    if (!Number.isInteger(n) || n < 0 || n > 500) return setState({ error: "ใส่ตัวเลข 0 ถึง 500" });
    start(async () => setState(await setBlacklistPenalty(entry.id, n)));
  };
  return (
    <span className="row-actions">
      {!entry.liftedAt && <button className="btn btn-sm" disabled={pending} onClick={editPenalty}>แก้ MMR</button>}
      {entry.liftedAt ? (
        <button className="btn btn-sm" disabled={pending} onClick={() => act("restore")}>ใส่โทษกลับ</button>
      ) : (
        <button className="btn btn-sm" disabled={pending} onClick={() => act("lift")}>ยกเลิกโทษ</button>
      )}
      {entry.source === "ADMIN" && <button className="btn btn-sm btn-danger" disabled={pending} onClick={() => act("delete")}>ลบ</button>}
      {state?.error && <span className="error small">{state.error}</span>}
      {state?.ok && <span className="success small">{state.ok}</span>}
    </span>
  );
}

/** Put a player on the blacklist by hand, with a reason and how much MMR it costs. */
export function AddBlacklist({ players }: { players: PickerTeam[] }) {
  const [state, onSubmit, pending] = useFormAction(addBlacklist, undefined);
  const [playerId, setPlayerId] = useState<string | null>(null);
  return (
    <form
      className="form card"
      onSubmit={(e) => {
        const name = players.find((p) => p.id === playerId)?.name;
        if (!playerId || !confirm(`เพิ่ม ${name} เข้า Blacklist และหัก MMR?`)) {
          e.preventDefault();
          return;
        }
        onSubmit(e);
      }}
    >
      <div>
        <h2 style={{ marginBottom: 4 }}>เพิ่มเข้า Blacklist เอง</h2>
        <p className="muted small" style={{ margin: 0 }}>สำหรับเหตุอื่นนอกจากแพ้บาย เช่น ทำผิดกติกา ผู้เล่นจะถูกหัก MMR ตามที่ใส่ จนกว่าจะยกเลิกโทษ</p>
      </div>
      <TeamPicker teams={players} value={playerId} onChange={setPlayerId} name="playerId" placeholder="พิมพ์ชื่อผู้เล่นหรือ UID…" label="ผู้เล่น" />
      <label>
        สาเหตุ
        <input name="reason" required maxLength={300} placeholder="เช่น ทำผิดกติกา ใช้ตัวละครคนอื่นลงแข่ง" />
      </label>
      <label>
        หัก MMR
        <input name="penalty" type="number" min={0} max={500} defaultValue={20} />
      </label>
      {state?.error && <div className="error">{state.error}</div>}
      {state?.ok && <div className="success">{state.ok}</div>}
      <div className="row">
        <button className="btn btn-primary" disabled={pending || !playerId}>{pending ? "กำลังบันทึก…" : "เพิ่มเข้า Blacklist"}</button>
      </div>
    </form>
  );
}
