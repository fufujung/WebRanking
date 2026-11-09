"use client";

import { useState, useTransition } from "react";
import { removeReserve, saveReserve, setReserveSeason, setSeasonReserveOpen, type FormState } from "@/app/admin/actions";
import type { GameRank, ReservePlayer } from "@/lib/types";
import { PositionSelect } from "../PositionSelect";
import { useFormAction } from "./useFormAction";

/** Opens or closes the season shown for substitute sign-ups on the website and in Discord. */
export function SeasonReserveToggle({ season }: { season: { id: string; name: string; reserveOpen?: boolean } }) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const open = Boolean(season.reserveOpen);
  const flip = () => {
    if (!confirm(open ? `ปิดรับตัวสำรองซีซั่น ${season.name}?` : `เปิดรับตัวสำรองซีซั่น ${season.name}? ผู้เล่นจะสมัครได้ทั้งบนเว็บและ Discord`)) return;
    start(async () => setState(await setSeasonReserveOpen(season.id, !open)));
  };
  return (
    <div className="row" data-season-open={open ? "1" : "0"}>
      <span className={`pill ${open ? "pill-ok" : ""}`}>{open ? "เปิดรับสมัครอยู่" : "ปิดรับสมัคร"}</span>
      <button type="button" className={`btn btn-sm ${open ? "" : "btn-primary"}`} disabled={pending} onClick={flip}>
        {open ? "ปิดรับตัวสำรองซีซั่นนี้" : "เปิดรับตัวสำรองซีซั่นนี้"}
      </button>
      {state?.error && <span className="error small">{state.error}</span>}
    </div>
  );
}

/** Fix a substitute's position, rank, Facebook or phone, the seasons they are on, or take them off the list. */
export function ReserveActions({ row, ranks, seasons }: { row: ReservePlayer; ranks: GameRank[]; seasons: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, onSubmit, pending] = useFormAction(saveReserve.bind(null, row.playerId), undefined);
  const [removed, setRemoved] = useState<FormState>();
  const [removing, start] = useTransition();
  const [seasonState, setSeasonState] = useState<FormState>();
  const [moving, startMove] = useTransition();
  const onSeason = (seasonId: string) => (row.seasons ?? []).some((s) => s.id === seasonId);
  const toggleSeason = (seasonId: string) => startMove(async () => setSeasonState(await setReserveSeason(seasonId, row.playerId, !onSeason(seasonId))));
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
          {seasons.length > 0 && (
            <fieldset className="reserve-seasons">
              <legend className="small">ซีซั่นที่อยู่ในรายชื่อ</legend>
              {seasons.map((s) => (
                <label key={s.id} className="small">
                  <input type="checkbox" checked={onSeason(s.id)} disabled={moving} onChange={() => toggleSeason(s.id)} /> {s.name}
                </label>
              ))}
              {seasonState?.error && <div className="error small">{seasonState.error}</div>}
            </fieldset>
          )}
        </form>
      )}
    </div>
  );
}
