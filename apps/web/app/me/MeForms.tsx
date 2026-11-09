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
    <form id="claim-profile" onSubmit={onSubmit} className="form card claim-form">
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

/**
 * Sign up as a substitute for a season of the special "เล่นเก่งปากเก่ง" events, or change the details.
 * The details are entered once and kept: signing up for the next season only needs the season picked.
 */
export function ReserveForm({
  characters,
  current,
  ranks,
  game,
  anchor,
  openSeasons,
}: {
  characters: Pick<Player, "id" | "name" | "uid">[];
  current: ReservePlayer | null;
  ranks: GameRank[];
  /** The game this list is for: each game keeps its own list. */
  game: { id: string; name: string } | null;
  anchor?: boolean;
  /** Seasons taking substitutes now, newest first. */
  openSeasons: { id: string; name: string }[];
}) {
  const [state, onSubmit, pending] = useSubmit(saveMyReserve);
  const [left, setLeft] = useState<MeState>();
  const [leaving, setLeaving] = useState(false);
  const joined = current?.seasons ?? [];
  const toJoin = openSeasons.filter((s) => !joined.some((j) => j.id === s.id));
  const leave = async (season?: { id: string; name: string }) => {
    if (!confirm(season ? `ถอนชื่อจากซีซั่น ${season.name}?` : "ถอนชื่อออกจากรายชื่อตัวสำรองทุกซีซั่น?")) return;
    setLeaving(true);
    setLeft(await leaveMyReserve(game?.id ?? null, season?.id ?? null));
    setLeaving(false);
  };
  if (!current && !openSeasons.length)
    return (
      <section className="card" id={anchor ? "reserve" : undefined} data-game={game?.id ?? ""} style={{ marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}> ลงชื่อตัวสำรอง: รายการเล่นเก่งปากเก่ง{game ? <span className="muted"> · {game.name}</span> : null}</h2>
        <p className="muted" style={{ margin: 0 }}>ตอนนี้ยังไม่เปิดรับตัวสำรองซีซั่นไหน รอผู้จัดประกาศเปิดรับซีซั่นใหม่นะ</p>
      </section>
    );
  return (
    <form onSubmit={onSubmit} className="form card" id={anchor ? "reserve" : undefined} data-game={game?.id ?? ""} style={{ marginBottom: 24 }}>
      <div>
        <h2 style={{ margin: 0 }}> ลงชื่อตัวสำรอง: รายการเล่นเก่งปากเก่ง{game ? <span className="muted"> · {game.name}</span> : null}</h2>
        <p className="muted small" style={{ margin: 0 }}>
          สมัครแยกแต่ละซีซั่น ผู้จัดจะสุ่มคนจากรายชื่อของซีซั่นนั้นไปช่วยแข่ง ข้อมูลกรอกครั้งเดียวแล้วใช้ต่อได้ทุกซีซั่น
          สถิติและ MMR ของรายการนี้แยกจากรายการหลัก Facebook และเบอร์โทรเห็นเฉพาะผู้จัด
        </p>
      </div>
      {current && (
        <div className="notice small">
          ลงชื่อไว้แล้วด้วย <strong>{current.player.nickname || current.player.name}</strong>
          {current.rank ? ` · แรงค์ ${current.rank}` : " · ยังไม่ได้เลือกแรงค์ เลือกด้านล่างแล้วกดบันทึก"}
          <div className="row" style={{ marginTop: 6, gap: 6 }} data-my-seasons>
            {joined.length ? "ซีซั่นที่สมัครแล้ว:" : "ยังไม่ได้สมัครซีซั่นไหน"}
            {joined.map((s) => (
              <span key={s.id} className="badge" data-season={s.id}>
                {s.name}
                <button type="button" className="link-btn" disabled={leaving} onClick={() => leave(s)} aria-label={`ถอนชื่อจากซีซั่น ${s.name}`} style={{ marginLeft: 6 }}>✕</button>
              </span>
            ))}
          </div>
        </div>
      )}
      {toJoin.length > 0 ? (
        <label>
          สมัครซีซั่น{current ? " (ไม่เลือก = แก้ข้อมูลอย่างเดียว)" : " *"}
          <select name="seasonId" required={!current} defaultValue={current ? "" : toJoin[0].id}>
            {current && <option value="">ไม่สมัครเพิ่ม แก้ข้อมูลอย่างเดียว</option>}
            {toJoin.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      ) : current && openSeasons.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>ตอนนี้ยังไม่เปิดรับซีซั่นใหม่ แก้ข้อมูลของคุณได้ตามปกติ</p>
      ) : null}
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
        <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังบันทึก…" : current ? "บันทึก" : "ลงชื่อตัวสำรอง"}</button>
        {current && <button type="button" className="btn" disabled={leaving} onClick={() => leave()}>ถอนชื่อทุกซีซั่น</button>}
      </div>
    </form>
  );
}
