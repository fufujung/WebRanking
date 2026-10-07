"use client";

import { useFormAction } from "./useFormAction";
import { saveTournament } from "@/app/admin/actions";
import type { Tournament } from "@/lib/types";
import { statusLabel, toDateInput } from "@/lib/format";

export function TournamentForm({ tournament }: { tournament?: Tournament }) {
  const [state, onSubmit, pending] = useFormAction(saveTournament.bind(null, tournament?.id ?? null), undefined);
  return (
    <form onSubmit={onSubmit} className="form card">
      <div className="form-row">
        <label>ชื่อรายการ *<input name="name" required maxLength={150} defaultValue={tournament?.name} autoFocus={!tournament} /></label>
        <label>เกม<input name="game" maxLength={100} defaultValue={tournament?.game ?? ""} /></label>
        <label>สถานที่<input name="location" maxLength={150} defaultValue={tournament?.location ?? ""} placeholder="เช่น Bangkok หรือ Online" /></label>
      </div>
      <div className="form-row">
        <label>
          สถานะ
          <select name="status" defaultValue={tournament?.status ?? "UPCOMING"}>
            {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>วันเริ่ม *<input type="date" name="startDate" required defaultValue={toDateInput(tournament?.startDate)} /></label>
        <label>วันจบ<input type="date" name="endDate" defaultValue={toDateInput(tournament?.endDate)} /></label>
      </div>
      <label>รายละเอียด<textarea name="description" rows={3} maxLength={2000} defaultValue={tournament?.description ?? ""} /></label>
      {state?.error && <div className="error">{state.error}</div>}
      <div className="row"><button className="btn btn-primary" disabled={pending}>{pending ? "กำลังบันทึก…" : tournament ? "บันทึกการแก้ไข" : "สร้างทัวร์นาเมนต์"}</button></div>
    </form>
  );
}
