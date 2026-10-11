"use client";

import { useState } from "react";
import { mergePlayer } from "@/app/admin/actions";
import { TeamPicker, type PickerTeam } from "../TeamPicker";
import { useFormAction } from "./useFormAction";

/** Picks a duplicate of this player; on confirm its stats, rosters and names move here and it is deleted. */
export function MergePlayer({ playerId, playerName, others }: { playerId: string; playerName: string; others: PickerTeam[] }) {
  const [state, onSubmit, pending] = useFormAction(mergePlayer.bind(null, playerId), undefined);
  const [fromId, setFromId] = useState<string | null>(null);
  const from = others.find((o) => o.id === fromId);
  return (
    <form
      className="form card"
      onSubmit={(e) => {
        if (!from || !confirm(`รวม "${from.name}" เข้ากับ "${playerName}"?\nสถิติและ MMR ของ ${from.name} จะย้ายมาที่ ${playerName} แล้วลบ ${from.name} ทิ้ง ย้อนกลับไม่ได้`)) {
          e.preventDefault();
          return;
        }
        onSubmit(e);
        setFromId(null);
      }}
    >
      <div>
        <h2 style={{ marginBottom: 4 }}>รวมผู้เล่นที่ซ้ำ</h2>
        <p className="muted small" style={{ margin: 0 }}>
          ถ้าคนเดียวกันถูกบันทึกเป็นสองชื่อ (เช่น เปลี่ยนชื่อในเกมแล้วระบบสร้างผู้เล่นใหม่) เลือกชื่อที่ซ้ำ สถิติ MMR และประวัติชื่อจะรวมมาไว้ที่ {playerName}
        </p>
      </div>
      <TeamPicker teams={others} value={fromId} onChange={setFromId} name="fromId" placeholder="พิมพ์ชื่อผู้เล่นที่ซ้ำ…" label="ผู้เล่นที่ซ้ำ" />
      {state?.error && <div className="error">{state.error}</div>}
      {state?.ok && <div className="success">{state.ok}</div>}
      <div className="row">
        <button className="btn" disabled={pending || !fromId}>{pending ? "กำลังรวม…" : "รวมเข้ากับผู้เล่นนี้"}</button>
      </div>
    </form>
  );
}
