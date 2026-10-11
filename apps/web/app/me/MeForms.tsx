"use client";

import { startTransition, useActionState, useState } from "react";
import { claimPlayer, unlinkMyPlayer, updateMyPlayer, type MeState } from "./actions";
import { ImageDrop } from "@/components/ImageDrop";
import type { Player } from "@/lib/types";

function useSubmit(action: (s: MeState, f: FormData) => Promise<MeState>) {
  const [state, dispatch, pending] = useActionState<MeState, FormData>(action, undefined);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => dispatch(form));
  };
  return [state, onSubmit, pending] as const;
}

export function ClaimForm({ first }: { first: boolean }) {
  const [state, onSubmit, pending] = useSubmit(claimPlayer);
  return (
    <form onSubmit={onSubmit} className="form card claim-form">
      <div>
        <h2 style={{ margin: 0 }}>{first ? "ผูกโปรไฟล์ผู้เล่นของคุณ" : "ผูกตัวละครอื่นเพิ่ม"}</h2>
        <p className="muted small" style={{ margin: 0 }}>
          ใส่ UID ในเกม ถ้ามีโปรไฟล์อยู่แล้วระบบจะผูกให้ทันที สถิติและ MMR เดิมยังอยู่ครบ ถ้ายังไม่มี ใส่ชื่อในเกมเพื่อสร้างใหม่
        </p>
      </div>
      <div className="form-row">
        <label>UID ในเกม *<input name="uid" required maxLength={40} inputMode="numeric" placeholder="เช่น 812345678" /></label>
        <label>Server<input name="server" maxLength={40} placeholder="เช่น Asia" /></label>
        <label>ชื่อในเกม {state?.needsName ? "*" : "(ถ้าสร้างใหม่)"}<input name="name" maxLength={100} required={state?.needsName} autoFocus={state?.needsName} /></label>
      </div>
      {state?.error && <div className="error">{state.error}</div>}
      {state?.ok && <div className="success">{state.ok}</div>}
      <div><button className="btn btn-primary" disabled={pending}>{pending ? "กำลังตรวจสอบ…" : "ผูกโปรไฟล์"}</button></div>
    </form>
  );
}

export function EditMyPlayer({ player }: { player: Player }) {
  const [state, onSubmit, pending] = useSubmit(updateMyPlayer.bind(null, player.id));
  const [avatar, setAvatar] = useState<string | null>(player.avatarUrl);
  const [unlink, setUnlink] = useState<MeState>(undefined);
  const [unlinking, setUnlinking] = useState(false);
  return (
    <form onSubmit={onSubmit} className="form">
      <div className="form-row">
        <label>ชื่อเล่น<input name="nickname" maxLength={100} defaultValue={player.nickname ?? ""} /></label>
        <label>ตำแหน่ง<input name="role" maxLength={60} defaultValue={player.role ?? ""} placeholder="เช่น Center, Guard" /></label>
        <label>ประเทศ<input name="country" maxLength={60} defaultValue={player.country ?? ""} /></label>
      </div>
      <label>
        รูปโปรไฟล์
        <ImageDrop name="avatarUrl" value={avatar} onChange={setAvatar} compact label="ลากรูปมาวาง หรือคลิกเพื่อเลือกไฟล์" />
      </label>
      {state?.error && <div className="error">{state.error}</div>}
      {state?.ok && <div className="success">{state.ok}</div>}
      {unlink?.error && <div className="error">{unlink.error}</div>}
      <div className="row between">
        <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={unlinking}
          onClick={async () => {
            if (!confirm(`ยกเลิกการผูก ${player.name} กับบัญชี Discord นี้? สถิติยังอยู่ครบ`)) return;
            setUnlinking(true);
            setUnlink(await unlinkMyPlayer(player.id));
            setUnlinking(false);
          }}
        >
          ยกเลิกการผูก
        </button>
      </div>
    </form>
  );
}
