"use client";

import { startTransition, useActionState, useState } from "react";
import { claimPlayer, leaveMyReserve, saveMyReserve, unlinkMyPlayer, updateMyPlayer, type MeState } from "./actions";
import { ImageDrop } from "@/components/ImageDrop";
import type { Game, Player, ReservePlayer, GameRank } from "@/lib/types";
import { PositionSelect } from "@/components/PositionSelect";

function useSubmit(action: (s: MeState, f: FormData) => Promise<MeState>) {
  const [state, dispatch, pending] = useActionState<MeState, FormData>(action, undefined);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => dispatch(form));
  };
  return [state, onSubmit, pending] as const;
}

export function ClaimForm({ first, games }: { first: boolean; games: Game[] }) {
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
        {games.length > 1 && (
          <label>
            เกม *
            <select name="gameId" required defaultValue="">
              <option value="" disabled>เลือกเกม</option>
              {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        )}
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
        <PositionSelect value={player.role} />
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

/** Sign up as a substitute for the special "เล่นเก่งปากเก่ง" events, or change the details. */
export function ReserveForm({
  characters,
  current,
  ranks,
  game,
  anchor,
}: {
  characters: Pick<Player, "id" | "name" | "uid">[];
  current: ReservePlayer | null;
  ranks: GameRank[];
  /** The game this list is for: each game keeps its own list. */
  game: { id: string; name: string } | null;
  anchor?: boolean;
}) {
  const [state, onSubmit, pending] = useSubmit(saveMyReserve);
  const [left, setLeft] = useState<MeState>();
  const [leaving, setLeaving] = useState(false);
  const leave = async () => {
    if (!confirm("ถอนชื่อออกจากรายชื่อตัวสำรอง?")) return;
    setLeaving(true);
    setLeft(await leaveMyReserve(game?.id ?? null));
    setLeaving(false);
  };
  return (
    <form onSubmit={onSubmit} className="form card" id={anchor ? "reserve" : undefined} data-game={game?.id ?? ""} style={{ marginBottom: 24 }}>
      <div>
        <h2 style={{ margin: 0 }}>⭐ ลงชื่อตัวสำรอง: รายการเล่นเก่งปากเก่ง{game ? <span className="muted"> · {game.name}</span> : null}</h2>
        <p className="muted small" style={{ margin: 0 }}>
          เปิดรับตลอด ใช้ได้ทุกงาน ผู้จัดจะสุ่มคนจากรายชื่อนี้ไปช่วยแข่ง สถิติและ MMR ของรายการนี้แยกจากรายการหลัก
          Facebook และเบอร์โทรเห็นเฉพาะผู้จัด
        </p>
      </div>
      {current && (
        <div className="notice small">
          ลงชื่อไว้แล้วด้วย <strong>{current.player.nickname || current.player.name}</strong>
          {current.rank ? ` · แรงค์ ${current.rank}` : " · ยังไม่ได้เลือกแรงค์ เลือกด้านล่างแล้วกดบันทึก"}
        </div>
      )}
      <div className="form-row">
        <label>
          ตัวละคร *
          <select name="playerId" required defaultValue={current?.playerId ?? characters[0]?.id}>
            {characters.map((c) => <option key={c.id} value={c.id}>{c.name}{c.uid ? ` (UID ${c.uid})` : ""}</option>)}
          </select>
        </label>
        <PositionSelect value={current?.position} name="position" />
        <label>Facebook *<input name="facebook" required minLength={2} maxLength={200} defaultValue={current?.facebook ?? ""} placeholder="ชื่อ Facebook หรือลิงก์ facebook.com" /></label>
        <label>เบอร์โทร (ไม่ใส่ก็ได้)<input name="phone" maxLength={20} inputMode="tel" defaultValue={current?.phone ?? ""} placeholder="เช่น 0812345678" /></label>
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
      {(state?.error || left?.error) && <div className="error">{state?.error ?? left?.error}</div>}
      {(state?.ok || left?.ok) && <div className="success">{left?.ok ?? state?.ok}</div>}
      <div className="row">
        <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังบันทึก…" : current ? "บันทึกการแก้ไข" : "ลงชื่อตัวสำรอง"}</button>
        {current && <button type="button" className="btn" disabled={leaving} onClick={leave}>ถอนชื่อ</button>}
      </div>
    </form>
  );
}
