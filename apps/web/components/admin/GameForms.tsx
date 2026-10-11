"use client";

import { useRef, useState, useTransition } from "react";
import { useFormAction } from "./useFormAction";
import { addGame, deleteGame, renameGame } from "@/app/admin/actions";
import type { Game } from "@/lib/types";

export function AddGameForm() {
  const [state, onSubmit, pending] = useFormAction(addGame, undefined);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      onSubmit={(e) => {
        onSubmit(e);
        setTimeout(() => ref.current?.reset(), 0);
      }}
      className="card row game-add"
      style={{ marginBottom: 16 }}
    >
      <label className="grow">
        เพิ่มเกม
        <input name="name" required maxLength={100} placeholder="เช่น Basketball 3v3" />
      </label>
      <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังเพิ่ม…" : "+ เพิ่มเกม"}</button>
      {state?.error && <div className="error">{state.error}</div>}
      {state?.ok && <div className="success">{state.ok}</div>}
    </form>
  );
}

export function GameRow({ game }: { game: Game }) {
  const [editing, setEditing] = useState(false);
  const [state, onSubmit, pending] = useFormAction(renameGame.bind(null, game.id), undefined);
  const [deleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inUse = (game.players ?? 0) + (game.teams ?? 0) + (game.tournaments ?? 0) > 0;
  return (
    <tr>
      <td>
        {editing ? (
          <form
            onSubmit={(e) => {
              onSubmit(e);
              setEditing(false);
            }}
            className="row"
          >
            <input name="name" required maxLength={100} defaultValue={game.name} autoFocus aria-label="ชื่อเกม" />
            <button className="btn btn-sm btn-primary" disabled={pending}>บันทึก</button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>ยกเลิก</button>
          </form>
        ) : (
          <strong>{game.name}</strong>
        )}
        {state?.error && <div className="error small">{state.error}</div>}
        {error && <div className="error small">{error}</div>}
      </td>
      <td className="num">{game.players ?? 0}</td>
      <td className="num">{game.teams ?? 0}</td>
      <td className="num hide-sm">{game.tournaments ?? 0}</td>
      <td className="right">
        <span className="row-actions">
          {!editing && <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>เปลี่ยนชื่อ</button>}
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={deleting || inUse}
            title={inUse ? "ยังมีผู้เล่น ทีม หรือทัวร์นาเมนต์ในเกมนี้" : undefined}
            onClick={() => {
              if (!confirm(`ลบเกม ${game.name}?`)) return;
              startDelete(async () => {
                const res = await deleteGame(game.id);
                setError(res?.error ?? null);
              });
            }}
          >
            {deleting ? "กำลังลบ…" : "ลบ"}
          </button>
        </span>
      </td>
    </tr>
  );
}

/** A plain game dropdown for team and player forms. Hidden while the site has no games. */
export function GameSelect({ games, value, label = "เกม" }: { games: Game[]; value?: string | null; label?: string }) {
  if (games.length === 0) return null;
  return (
    <label>
      {label}
      <select name="gameId" defaultValue={value ?? (games.length === 1 ? games[0].id : "")}>
        <option value="">ไม่ระบุ</option>
        {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
    </label>
  );
}

/** The tournament's game: pick one, or type a new name to add it. */
export function TournamentGameField({ games, value, legacyName }: { games: Game[]; value?: string | null; legacyName?: string | null }) {
  const initial = value ?? (games.length === 0 ? "new" : games.length === 1 ? games[0].id : "");
  const [pick, setPick] = useState(initial);
  return (
    <label>
      เกม
      <select name="gameId" value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">ไม่ระบุ</option>
        {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        <option value="new">+ เกมใหม่…</option>
      </select>
      {pick === "new" && <input name="game" maxLength={100} defaultValue={value ? "" : (legacyName ?? "")} placeholder="ชื่อเกมใหม่" aria-label="ชื่อเกมใหม่" autoFocus={games.length > 0} />}
    </label>
  );
}
