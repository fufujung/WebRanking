"use client";

import { useRef, useState, useTransition } from "react";
import { addSeasonPlayers, createSeason, deleteSeason, removeSeasonPlayer, saveSeason, type FormState } from "@/app/admin/actions";
import type { Game, SpecialSeason } from "@/lib/types";
import { toBangkokInput } from "@/lib/format";
import { useFormAction } from "./useFormAction";

const day = (d: string | null | undefined) => toBangkokInput(d).slice(0, 10);

/** Create a season, or rename one and change its dates. */
export function SeasonForm({ season, games, gameId }: { season?: SpecialSeason; games: Game[]; gameId?: string | null }) {
  const [state, onSubmit, pending] = useFormAction(season ? saveSeason.bind(null, season.id) : createSeason, undefined);
  return (
    <form onSubmit={onSubmit} className="form card" style={{ marginBottom: 16 }}>
      {!season && <h3 style={{ margin: 0 }}>สร้างซีซั่นใหม่</h3>}
      <div className="form-row">
        <label>ชื่อซีซั่น *<input name="name" required maxLength={60} defaultValue={season?.name} placeholder="เช่น Season 1" /></label>
        {games.length > 0 && (
          <label>
            เกม
            <select name="gameId" defaultValue={season?.gameId ?? gameId ?? ""}>
              <option value="">ไม่ระบุ</option>
              {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        )}
        <label>วันเริ่ม *<input type="date" name="startDate" required defaultValue={day(season?.startDate)} /></label>
        <label>วันจบ<input type="date" name="endDate" defaultValue={day(season?.endDate)} /></label>
      </div>
      {state?.error && <div className="error">{state.error}</div>}
      {state?.ok && <div className="success">{state.ok}</div>}
      <div className="row">
        <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังบันทึก…" : season ? "บันทึก" : "+ สร้างซีซั่น"}</button>
        {season && <DeleteSeason season={season} />}
      </div>
    </form>
  );
}

function DeleteSeason({ season }: { season: SpecialSeason }) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const remove = () => {
    if (!confirm(`ลบ ${season.name}? รายชื่อผู้เล่นของซีซั่นจะหายไป ส่วนทัวร์และผลการแข่งยังอยู่`)) return;
    start(async () => setState(await deleteSeason(season.id)));
  };
  return (
    <>
      <button type="button" className="btn btn-danger" disabled={pending} onClick={remove}>ลบซีซั่น</button>
      {state?.error && <span className="error small">{state.error}</span>}
    </>
  );
}

/** Paste players, one per line: name and UID in any order. */
export function SeasonPaste({ seasonId }: { seasonId: string }) {
  const [state, onSubmit, pending] = useFormAction(addSeasonPlayers.bind(null, seasonId), undefined);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      onSubmit={(e) => {
        onSubmit(e);
        setTimeout(() => ref.current?.reset(), 0);
      }}
      className="form card"
      style={{ marginBottom: 16 }}
    >
      <label>
        เพิ่มผู้เล่น (บรรทัดละคน: ชื่อ + UID)
        <textarea name="text" rows={6} required maxLength={30000} placeholder={"Kite 81000108\nLynx 7730586\n7730600 Moss"} />
      </label>
      <p className="muted small" style={{ margin: 0 }}>
        UID ที่มีอยู่ในระบบแล้วจะผูกกับผู้เล่นคนเดิม (ชื่อเดิมไม่เปลี่ยน) UID ใหม่จะสร้างผู้เล่นให้ ก๊อปจาก Excel หรือ Google Sheets มาวางได้เลย
      </p>
      {state?.ok && <div className="success">{state.ok}</div>}
      {state?.error && <div className="error" style={{ whiteSpace: "pre-line" }}>{state.error}</div>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังเพิ่ม…" : "+ เพิ่มเข้าซีซั่น"}</button>
    </form>
  );
}

export function RemoveSeasonPlayer({ seasonId, playerId, name }: { seasonId: string; playerId: string; name: string }) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const remove = () => {
    if (!confirm(`เอา ${name} ออกจากซีซั่นนี้?`)) return;
    start(async () => setState(await removeSeasonPlayer(seasonId, playerId)));
  };
  return (
    <>
      <button type="button" className="btn btn-sm btn-danger" disabled={pending} onClick={remove}>เอาออก</button>
      {state?.error && <span className="error small">{state.error}</span>}
    </>
  );
}
