"use client";

import { useState, useTransition } from "react";
import { removeReserve, saveReserve, type FormState } from "@/app/admin/actions";
import type { GameRank, ReservePlayer } from "@/lib/types";
import { PositionSelect } from "../PositionSelect";
import { useFormAction } from "./useFormAction";

/** Fix a substitute's position, rank, Facebook or phone, or take them off the list. */
export function ReserveActions({ row, ranks }: { row: ReservePlayer; ranks: GameRank[] }) {
  const [open, setOpen] = useState(false);
  const [state, onSubmit, pending] = useFormAction(saveReserve.bind(null, row.playerId), undefined);
  const [removed, setRemoved] = useState<FormState>();
  const [removing, start] = useTransition();
  const remove = () => {
    if (!confirm(`เอา ${row.player.name} ออกจากรายชื่อตัวสำรอง?`)) return;
    start(async () => setRemoved(await removeReserve(row.playerId)));
  };
  return (
    <div className="row-actions" style={{ flexWrap: "wrap" }}>
      <button type="button" className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "ปิด" : "แก้ไข"}</button>
      <button type="button" className="btn btn-sm btn-danger" disabled={removing} onClick={remove}>เอาออก</button>
      {removed?.error && <span className="error small">{removed.error}</span>}
      {open && (
        <form onSubmit={onSubmit} className="form reserve-edit">
          <PositionSelect value={row.position} name="position" />
          <label>
            แรงค์
            <select name="rank" defaultValue={row.rank ?? ""}>
              <option value="">ยังไม่เลือก</option>
              {row.rank && !ranks.some((r) => r.name === row.rank) && <option value={row.rank}>{row.rank} (ไม่อยู่ในรายการแล้ว)</option>}
              {ranks.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
          </label>
          <label>Facebook<input name="facebook" maxLength={200} defaultValue={row.facebook ?? ""} /></label>
          <label>เบอร์โทร<input name="phone" maxLength={20} inputMode="tel" defaultValue={row.phone ?? ""} /></label>
          {state?.error && <div className="error small">{state.error}</div>}
          {state?.ok && <div className="success small">{state.ok}</div>}
          <button className="btn btn-primary btn-sm" disabled={pending}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        </form>
      )}
    </div>
  );
}
