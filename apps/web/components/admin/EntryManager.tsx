"use client";

import { useFormAction } from "./useFormAction";
import { useState, useTransition } from "react";
import { removeEntry, saveEntry } from "@/app/admin/actions";
import { TeamPicker, type PickerTeam } from "../TeamPicker";

type Entry = PickerTeam & { placement: number | null };

/** Register teams in a tournament and set their final placements. */
export function EntryManager({ tournamentId, entries, teams }: { tournamentId: string; entries: Entry[]; teams: PickerTeam[] }) {
  const [state, onSubmit, pending] = useFormAction(saveEntry.bind(null, tournamentId), undefined);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [removing, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  return (
    <div className="stack">
      <form onSubmit={onSubmit} className="card form">
        <div className="form-row" style={{ alignItems: "end" }}>
          <label>
            ทีม
            <TeamPicker teams={teams} value={teamId} onChange={setTeamId} name="teamId" required />
          </label>
          <label>อันดับสุดท้าย (ถ้ามี)<input type="number" name="placement" min={1} placeholder="เช่น 1 = แชมป์" /></label>
          <button className="btn btn-primary" disabled={pending || !teamId}>{pending ? "กำลังบันทึก…" : "เพิ่ม / อัปเดตทีม"}</button>
        </div>
        {state?.error && <div className="error">{state.error}</div>}
        {state?.ok && <div className="success">{state.ok}</div>}
      </form>
      {removeError && <div className="error">{removeError}</div>}
      {entries.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>ทีม</th><th className="num">อันดับสุดท้าย</th><th /></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td className="num">{e.placement ?? "-"}</td>
                  <td className="right">
                    <span className="row" style={{ justifyContent: "flex-end" }}>
                      <button type="button" className="btn btn-sm" onClick={() => setTeamId(e.id)}>ตั้งอันดับ</button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={removing}
                        onClick={() =>
                          startRemove(async () => {
                            setRemoveError(null);
                            const res = await removeEntry(tournamentId, e.id);
                            if (res?.error) setRemoveError(res.error);
                          })
                        }
                      >
                        เอาออก
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
