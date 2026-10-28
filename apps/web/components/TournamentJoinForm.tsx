"use client";

import Link from "@/components/LoadingLink";
import { useActionState, useState } from "react";
import { joinTournament } from "@/app/tournaments/[id]/joinActions";
import { POSITIONS } from "@/lib/solo";
import type { MyCharacter } from "@/lib/types";

type JoinCharacter = Pick<MyCharacter, "id" | "name" | "role" | "inGameRank" | "team">;

export function TournamentJoinForm({ id, solo, characters, ranks, registered, closed, rosterMin, rosterMax, gameId }: {
  id: string; solo: boolean; characters: JoinCharacter[]; ranks: string[]; registered: boolean; closed: string | null; rosterMin: number; rosterMax: number; gameId?: string | null;
}) {
  const [playerId, setPlayerId] = useState(characters[0]?.id ?? "");
  const [state, action, pending] = useActionState(joinTournament.bind(null, id, solo), undefined);
  const [selected, setSelected] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const player = characters.find((p) => p.id === playerId);
  const team = player?.team;
  const members = team?.members ?? [];
  const needsSelection = !solo && members.length > rosterMax;
  const picked = needsSelection ? [playerId, ...selected.filter((v) => v !== playerId)] : members.map((p) => p.id);
  const readyProfile = player && POSITIONS.some((p) => p === player.role) && ranks.includes(player.inGameRank ?? "");
  const params = new URLSearchParams({ next: `/tournaments/${id}` });
  if (gameId) params.set("gameId", gameId);
  if (playerId) params.set("playerId", playerId);
  const setup = `/me/player?${params}`;
  const succeeded = !state?.left && (registered || Boolean(state?.ok));
  const tooSmall = !solo && members.length < rosterMin;
  const validSelection = picked.length >= rosterMin && picked.length <= rosterMax;
  return <div className="stack">
    {succeeded ? <p role="status" className="success">Join success / สมัครสำเร็จแล้ว{solo ? " · รอผู้จัดสุ่มทีม" : ""}</p> : closed ? <>
      {closed !== "ปิดรับสมัคร" && <p role="status" className="notice">{closed}</p>}
      <button type="button" className="btn btn-primary tournament-join-closed" disabled>ปิดรับสมัคร</button>
    </> : <>
      {!characters.length ? <div><p>ยังไม่มีตัวละครสำหรับเกมนี้</p><Link className="btn btn-primary" href={setup}>กรอกข้อมูลผู้เล่น</Link></div> : <form action={action} className="form tournament-join-form">
        {characters.length > 1 ? <label>ตัวละครที่จะใช้สมัคร<select name="playerId" value={playerId} onChange={(e) => { setPlayerId(e.target.value); setSelected([]); }}>{characters.map((p) => <option key={p.id} value={p.id}>{p.name}{p.team ? ` · ${p.team.name}` : ""}</option>)}</select></label> : <><input type="hidden" name="playerId" value={playerId} /><p className="muted">ผู้เล่น: {player?.name}</p></>}
        {!solo && team && <div className="join-team-summary">
          <div className="row between"><h3>ทีมของฉัน · {team.name}</h3><Link href="/me#my-teams" className="btn btn-sm">จัดการทีม</Link></div>
          <p className="muted small">{members.length} คน · รายการรับ {rosterMin}–{rosterMax} คนต่อทีม{team.isCaptain ? " · คุณเป็นหัวหน้าทีม" : ""}</p>
          {needsSelection && team.isCaptain && <p>เลือกผู้เข้าแข่ง {rosterMin}–{rosterMax} คน รวมคุณด้วย</p>}
          <ul className="join-roster">{members.map((m) => <li key={m.id}>{needsSelection && team.isCaptain ? <label><input type="checkbox" checked={m.id === playerId || selected.includes(m.id)} disabled={m.id === playerId} onChange={(e) => setSelected(e.target.checked ? [...selected, m.id] : selected.filter((v) => v !== m.id))} />{m.nickname || m.name}{m.captain ? " · หัวหน้า" : ""}</label> : <span>{m.nickname || m.name}{m.captain ? " · หัวหน้า" : ""}</span>}</li>)}</ul>
          {needsSelection && picked.map((pid) => <input key={pid} type="hidden" name="playerIds" value={pid} />)}
          {tooSmall && <p role="status">ทีมยังขาดอีก {rosterMin - members.length} คน เชิญเพื่อนก่อนสมัคร</p>}
          {team.isCaptain && team.inviteCode && <div className="invite-box"><label>ลิงก์เชิญเข้าทีม<input readOnly aria-label="ลิงก์เชิญเข้าทีม" value={`/join/${team.inviteCode}`} onFocus={(e) => e.currentTarget.select()} /></label><button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/join/${team.inviteCode}`); setCopied(true); setCopyError(""); } catch { setCopyError("คัดลอกไม่ได้ ใช้รหัสเชิญที่แสดงแทน"); } }}>{copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์เชิญ"}</button><span className="muted small">รหัส {team.inviteCode}</span>{copyError && <p role="alert">{copyError}</p>}</div>}
        </div>}
        {state?.error && <p role="alert" className="error">{state.error}</p>}
        {solo && !readyProfile ? <div><p>กรอกตำแหน่งและแรงค์ในเกมก่อน แล้วกลับมากด Join ได้เลย</p><Link className="btn btn-primary" href={setup}>กรอกข้อมูลผู้เล่น</Link></div> : !solo && !team ? <div><p>คุณยังไม่มีทีม สร้างทีมและเชิญเพื่อนเพื่อสมัครรายการนี้</p><Link href={`/teams/new?tournamentId=${id}`} className="btn btn-primary">สร้างทีม</Link></div> : !solo && !team?.isCaptain ? <p className="notice">ให้หัวหน้าทีมกด Join Tournament เพื่อสมัครทั้งทีม</p> : <button className="btn btn-primary" disabled={pending || Boolean(closed) || tooSmall || (!solo && !validSelection)}>{pending ? "กำลังสมัคร…" : "Join Tournament"}</button>}
      </form>}
    </>}
    {succeeded && <><Link href={solo ? "#teams" : "/me#my-teams"}>ดู{solo ? "รายชื่อผู้สมัคร" : "ทีมของฉัน"}</Link>{solo && !closed && <form action={action}><input type="hidden" name="intent" value="leave" /><button className="btn" disabled={pending}>{pending ? "กำลังถอนชื่อ…" : "ถอนชื่อ"}</button></form>}{state?.error && <p role="alert" className="error">{state.error}</p>}</>}
  </div>;
}
