"use client";

import { useMemo, useState, useTransition, useEffect } from "react";
import { registerPickedTeam, type FormState } from "@/app/admin/actions";
import { POSITIONS, positionLabel } from "@/lib/solo";
import type { SoloPosition } from "@/lib/types";

/** A player the organizer can put on a team: from the substitutes list, or the season's list. */
export interface Candidate {
  playerId: string;
  name: string;
  uid: string | null;
  server: string | null;
  discordId: string | null;
  position: SoloPosition | null;
  rank: string | null;
  mmr: number;
  /** The team they already play for in this tournament. */
  takenBy: string | null;
}

const label = (c: Candidate) => `${c.name}${c.uid ? ` · UID ${c.uid}` : ""}`;

/** Search, position and rank filters over the list. */
function useFilter(candidates: Candidate[]) {
  const [q, setQ] = useState("");
  const [position, setPosition] = useState<string>("");
  const [rank, setRank] = useState("");
  const ranks = useMemo(() => [...new Set(candidates.map((c) => c.rank).filter((r): r is string => Boolean(r)))], [candidates]);
  const shown = candidates.filter(
    (c) =>
      (!q || label(c).toLowerCase().includes(q.toLowerCase())) &&
      (!position || c.position === position || (position !== "ALL" && c.position === "ALL")) &&
      (!rank || c.rank === rank),
  );
  const bar = (
    <div className="form-row pick-filter">
      <label>ค้นหา<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ชื่อหรือ UID" /></label>
      <label>
        ตำแหน่ง
        <select value={position} onChange={(e) => setPosition(e.target.value)}>
          <option value="">ทุกตำแหน่ง</option>
          {POSITIONS.map((p) => <option key={p} value={p}>{positionLabel[p]}</option>)}
        </select>
      </label>
      {ranks.length > 0 && (
        <label>
          แรงค์
          <select value={rank} onChange={(e) => setRank(e.target.value)}>
            <option value="">ทุกแรงค์</option>
            {ranks.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      )}
    </div>
  );
  return { shown, bar };
}

/** Typed lines, one player each: "name UID" (either order, tabs from a sheet are fine) or just a name. */
export function parseTyped(text: string): { name: string; uid: string | null }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().split(/[\s,]+/).filter(Boolean))
    .filter((parts) => parts.length > 0)
    .map((parts) => {
      const at = parts.findLastIndex((x) => /^\d{5,20}$/.test(x));
      const uid = at >= 0 && parts.length > 1 ? parts[at] : null;
      const name = (uid ? parts.filter((_, i) => i !== at) : parts).join(" ").slice(0, 100);
      return { name, uid };
    });
}

/** Put a new team together by typing players in and/or ticking them on a list (name, UID and Discord come from the list). */
export function PickTeam({ tournamentId, candidates, source, rosterMin, rosterMax, nextName }: { tournamentId: string; candidates: Candidate[]; source: string; rosterMin: number; rosterMax: number; nextName: string }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [typedText, setTypedText] = useState("");
  const [teamName, setTeamName] = useState(nextName);
  // After a team is added the page suggests the next name ("ทีม 3"); the success message stays.
  useEffect(() => setTeamName(nextName), [nextName]);
  const [captain, setCaptain] = useState("");
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const { shown, bar } = useFilter(candidates);
  const byId = new Map(candidates.map((c) => [c.playerId, c]));
  const typed = parseTyped(typedText);
  const total = picked.length + typed.length;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : total >= rosterMax ? p : [...p, id]));
  const withDiscord = picked.map((id) => byId.get(id)!).filter((c) => c.discordId);

  function save() {
    setState(undefined);
    start(async () => {
      const res = await registerPickedTeam(tournamentId, teamName, [...picked.map((playerId) => ({ playerId })), ...typed], captain || null);
      setState(res);
      if (!res?.error) {
        setPicked([]);
        setTypedText("");
        setCaptain("");
      }
    });
  }

  return (
    <div className="card stack pick-team-card">
      <label>
        พิมพ์รายชื่อเอง (บรรทัดละคน: ชื่อ + UID)
        <textarea rows={4} value={typedText} onChange={(e) => setTypedText(e.target.value)} placeholder={"Kite 81000108\nLynx 7730586"} />
      </label>
      <p className="muted small" style={{ margin: 0 }}>
        UID ที่มีในระบบแล้วจะผูกกับผู้เล่นคนเดิม ไม่สร้างซ้ำ ก๊อปจาก Excel หรือ Google Sheets มาวางได้ ทีมละ {rosterMin}–{rosterMax} คน
      </p>
      {candidates.length > 0 ? (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            หรือติ๊กเลือกจาก{source} {candidates.length} คน ชื่อ UID และ Discord จะดึงจากรายชื่อให้เอง ใช้ร่วมกับที่พิมพ์ได้
          </p>
          {bar}
          <div className="pick-list" role="group" aria-label="รายชื่อให้เลือก">
            {shown.map((c) => {
              const on = picked.includes(c.playerId);
              return (
                <label key={c.playerId} className={`pick-row ${on ? "pick-row-on" : ""} ${c.takenBy ? "pick-row-taken" : ""}`}>
                  <input type="checkbox" checked={on} disabled={Boolean(c.takenBy) || (!on && total >= rosterMax)} onChange={() => toggle(c.playerId)} />
                  <span className="grow">
                    <strong>{c.name}</strong>
                    <span className="muted small"> · {c.uid ? `UID ${c.uid}` : "ไม่มี UID"}</span>
                  </span>
                  <span className="small muted pick-meta">
                    {[c.position ? positionLabel[c.position] : null, c.rank, `${c.mmr} MMR`, c.takenBy ? `อยู่ทีม ${c.takenBy}` : null].filter(Boolean).join(" · ")}
                  </span>
                </label>
              );
            })}
            {shown.length === 0 && <p className="muted small">ไม่พบผู้เล่นตามตัวกรอง</p>}
          </div>
        </>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>ยังไม่มี{source}ให้ติ๊กเลือก พิมพ์รายชื่อด้านบนได้เลย</p>
      )}
      <div className="form-row" style={{ alignItems: "end" }}>
        <label>ชื่อทีม *<input value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={100} /></label>
        <label>
          หัวหน้าทีม (Discord)
          <select value={captain} onChange={(e) => setCaptain(e.target.value)}>
            <option value="">ไม่มี</option>
            {withDiscord.map((c) => <option key={c.playerId} value={c.discordId!}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <p className={`small ${total > rosterMax ? "error" : ""}`} style={{ margin: 0 }}>
        เลือกแล้ว {total}/{rosterMax}: {total ? [...picked.map((id) => byId.get(id)?.name), ...typed.map((p) => (p.uid ? `${p.name} (${p.uid})` : p.name))].join(", ") : "-"}
        {total > rosterMax && ` · เกิน ${rosterMax} คน`}
      </p>
      {state?.ok && <div className="success">{state.ok}</div>}
      {state?.error && <div className="error">{state.error}</div>}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={pending || total < Math.max(rosterMin, 1) || total > rosterMax} onClick={save}>{pending ? "กำลังเพิ่ม…" : "+ เพิ่มทีมนี้"}</button>
      </div>
    </div>
  );
}

/** In the roster editor: add one player from the list as a new line. */
export function CandidateSelect({ candidates, exclude, onPick }: { candidates: Candidate[]; exclude: string[]; onPick: (c: Candidate) => void }) {
  const options = candidates.filter((c) => !c.takenBy && !exclude.includes(c.uid ?? `#${c.playerId}`));
  if (!options.length) return null;
  return (
    <label>
      เพิ่มจากรายชื่อ
      <select
        value=""
        onChange={(e) => {
          const c = options.find((x) => x.playerId === e.target.value);
          if (c) onPick(c);
        }}
      >
        <option value="">เลือกผู้เล่น…</option>
        {options.map((c) => (
          <option key={c.playerId} value={c.playerId}>
            {label(c)}{c.position ? ` · ${positionLabel[c.position]}` : ""}{c.rank ? ` · ${c.rank}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
