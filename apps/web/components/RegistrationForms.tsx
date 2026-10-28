"use client";

import { useActionState, useState } from "react";
import { createRegistrationTeam, savePlayerRegistration, claimRegistrationPlayer } from "@/app/me/registrationActions";
import { ImageDrop } from "@/components/ImageDrop";
import { POSITIONS, positionLabel } from "@/lib/solo";
import type { GameRank } from "@/lib/types";

type Character = { id: string; name: string; role?: string | null; inGameRank?: string | null; game?: { id: string; name: string } | null };

export function PlayerRegistrationForm({ player, ranks, gameId, next }: { player: Character; ranks: GameRank[]; gameId?: string; next: string }) {
  const [state, action, pending] = useActionState(savePlayerRegistration, undefined);
  return <form action={action} className="form card registration-form">
    <h2>{player.name}{player.game ? ` · ${player.game.name}` : ""}</h2>
    <input type="hidden" name="playerId" value={player.id} /><input type="hidden" name="gameId" value={gameId ?? player.game?.id ?? ""} /><input type="hidden" name="next" value={next} />
    <label>ตำแหน่งที่เล่น *<select name="position" required defaultValue={POSITIONS.some((p) => p === player.role) ? player.role! : ""}><option value="" disabled>เลือกตำแหน่ง</option>{POSITIONS.map((p) => <option key={p} value={p}>{positionLabel[p]}</option>)}</select></label>
    <label>แรงค์ในเกมตอนนี้ *<select name="inGameRank" required defaultValue={ranks.some((r) => r.name === player.inGameRank) ? player.inGameRank! : ""}><option value="" disabled>เลือกแรงค์</option>{ranks.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}</select></label>
    <p className="muted small">บันทึกไว้ใช้สมัคร Solo ครั้งถัดไป แรงค์ในเกมแยกจาก MMR ของเว็บไซต์</p>
    {state?.error && <p role="alert" className="error">{state.error}</p>}
    <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังบันทึก…" : "บันทึกและกลับ"}</button>
  </form>;
}

export function RegistrationClaimForm({ games, gameId, next }: { games: { id: string; name: string }[]; gameId?: string; next: string }) {
  const [state, action, pending] = useActionState(claimRegistrationPlayer, undefined);
  return <form action={action} className="form card registration-form">
    <h2>ผูกตัวละครก่อนสมัคร</h2><p className="muted small">ใส่ UID และชื่อในเกม หากมีตัวละครเดิมที่ยังไม่ได้ผูกบัญชี ต้องรอผู้จัดยืนยันเจ้าของก่อน</p>
    <input type="hidden" name="next" value={next} />
    {gameId ? <input type="hidden" name="gameId" value={gameId} /> : <label>เกม *<select name="gameId" required defaultValue=""><option value="" disabled>เลือกเกม</option>{games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
    <label>UID ในเกม *<input name="uid" required maxLength={40} /></label>
    <label>Server<input name="server" maxLength={40} /></label>
    <label>ชื่อในเกม (สำหรับตัวละครใหม่)<input name="name" maxLength={100} required={state?.needsName} /></label>
    {state?.error && <p role="alert" className="error">{state.error}</p>}{state?.ok && <p role="status" className="success">{state.ok}</p>}
    <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังตรวจสอบ…" : "ผูกตัวละคร"}</button>
  </form>;
}

export function NewRegistrationTeamForm({ characters, next }: { characters: Character[]; next: string }) {
  const [state, action, pending] = useActionState(createRegistrationTeam, undefined);
  const [logo, setLogo] = useState<string | null>(null);
  return <form action={action} className="form card registration-form">
    <input type="hidden" name="next" value={next} />
    <label>ตัวละคร / เกม *<select name="playerId" required defaultValue={characters[0]?.id ?? ""}>{characters.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.game?.name ?? "ยังไม่ระบุเกม"}</option>)}</select></label>
    <label>ชื่อทีม *<input name="name" required maxLength={100} /></label>
    <label>ตัวย่อทีม (ไม่บังคับ)<input name="tag" maxLength={12} /></label>
    <label>โลโก้ (ไม่บังคับ)<ImageDrop name="logoUrl" value={logo} onChange={setLogo} compact label="เลือกโลโก้ทีม" /></label>
    {state?.error && <p role="alert" className="error">{state.error}</p>}
    <p className="muted small">คุณจะเป็นหัวหน้าทีม สร้างเสร็จแล้วเชิญสมาชิกและกด Join Tournament เมื่อพร้อม</p>
    <button className="btn btn-primary" disabled={pending}>{pending ? "กำลังสร้างทีม…" : "สร้างทีม"}</button>
  </form>;
}
