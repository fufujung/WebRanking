"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { soloLeave, soloSignUp, type SoloState } from "./actions";
import { POSITIONS, positionLabel } from "@/lib/solo";
import type { GameRank, SoloPosition } from "@/lib/types";

/** Sign-up for a SOLO tournament: character, position and in-game rank. */
export function SoloForm({
  tournamentId,
  characters,
  ranks,
  current,
}: {
  tournamentId: string;
  characters: { id: string; label: string }[];
  ranks: GameRank[];
  current: { playerId: string; position: SoloPosition; rank: string } | null;
}) {
  const [state, dispatch, pending] = useActionState<SoloState, FormData>(soloSignUp.bind(null, tournamentId), undefined);
  const [left, setLeft] = useState<SoloState>(undefined);
  const [leaving, startLeave] = useTransition();
  const shown = left ?? state;
  return (
    <form
      className="form solo-form"
      onSubmit={(e) => {
        e.preventDefault();
        setLeft(undefined);
        const form = new FormData(e.currentTarget);
        startTransition(() => dispatch(form));
      }}
    >
      <div className="form-row">
        {characters.length > 1 ? (
          <label>
            ตัวละคร
            <select name="playerId" defaultValue={current?.playerId ?? characters[0].id}>
              {characters.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        ) : (
          <label>
            ตัวละคร
            <input type="hidden" name="playerId" value={characters[0].id} />
            <input readOnly value={characters[0].label} aria-label="ตัวละคร" />
          </label>
        )}
        <label>
          ตำแหน่งที่เล่น *
          <select name="position" required defaultValue={current?.position ?? ""}>
            <option value="" disabled>เลือกตำแหน่ง</option>
            {POSITIONS.map((p) => <option key={p} value={p}>{positionLabel[p]}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="rank-field">
        <legend>แรงค์ในเกมตอนนี้ *</legend>
        <div className="rank-pick">
          {ranks.map((r, i) => (
            <label key={r.name}>
              <input type="radio" name="rank" value={r.name} required defaultChecked={current?.rank === r.name} />
              {r.iconUrl && <img src={r.iconUrl} alt="" />}
              <span>{r.name}</span>
              {i === 0 && <span className="muted small">ต่ำสุด</span>}
              {i === ranks.length - 1 && ranks.length > 1 && <span className="muted small">สูงสุด</span>}
            </label>
          ))}
        </div>
      </fieldset>
      {shown?.error && <div className="error">{shown.error}</div>}
      {shown?.ok && <div className="success">{shown.ok}</div>}
      <div className="row">
        <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังบันทึก…" : current ? "บันทึกการเปลี่ยนแปลง" : "ลงทะเบียน"}</button>
        {current && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={leaving}
            onClick={() => {
              if (!confirm("ถอนชื่อจากทัวร์นาเมนต์นี้?")) return;
              startLeave(async () => setLeft(await soloLeave(tournamentId)));
            }}
          >
            ถอนชื่อ
          </button>
        )}
      </div>
    </form>
  );
}
