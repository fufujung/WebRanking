"use client";

import { startTransition, useActionState } from "react";
import { joinFromInvite, type MeState } from "@/app/me/actions";

export function JoinForm({ code, characters }: { code: string; characters: { id: string; label: string }[] }) {
  const [state, dispatch, pending] = useActionState<MeState, FormData>(joinFromInvite.bind(null, code), undefined);
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(() => dispatch(form));
      }}
    >
      {characters.length > 1 ? (
        <label>
          เข้าทีมด้วยตัวละคร
          <select name="playerId" defaultValue={characters[0].id}>
            {characters.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      ) : (
        <>
          <input type="hidden" name="playerId" value={characters[0].id} />
          <p className="muted small" style={{ margin: 0, textAlign: "center" }}>เข้าทีมด้วยตัวละคร <strong>{characters[0].label}</strong></p>
        </>
      )}
      {state?.error && <div className="error">{state.error}</div>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังเข้าร่วม…" : "เข้าร่วมทีม"}</button>
    </form>
  );
}
