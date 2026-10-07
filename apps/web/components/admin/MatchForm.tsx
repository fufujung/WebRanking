"use client";

import { useMemo, useState, useTransition } from "react";
import { saveMatch, type MatchPayload } from "@/app/admin/actions";
import type { MatchDetail, Player, Tournament } from "@/lib/types";
import { statusLabel, toDateTimeInput } from "@/lib/format";
import { ImageDrop } from "../ImageDrop";
import { TeamPicker, type PickerTeam } from "../TeamPicker";

type Side = "A" | "B";
interface Line {
  playerId: string;
  side: Side;
  played: boolean;
  kills: string;
  deaths: string;
  assists: string;
  score: string;
}
const STATS = ["kills", "deaths", "assists", "score"] as const;
const STAT_LABEL = { kills: "Kills", deaths: "Deaths", assists: "Assists", score: "คะแนน" };

interface Props {
  match?: MatchDetail;
  tournaments: Pick<Tournament, "id" | "name" | "status">[];
  teams: PickerTeam[];
  players: Pick<Player, "id" | "name" | "nickname" | "teamId">[];
  defaultTournamentId?: string;
  extractEnabled: boolean;
}

const blank = (playerId: string, side: Side): Line => ({ playerId, side, played: true, kills: "", deaths: "", assists: "", score: "" });
const num = (s: string) => (s.trim() === "" ? 0 : Number(s));
const validCount = (s: string) => s.trim() === "" || (/^\d+$/.test(s.trim()) && Number(s) <= 100000);

const STATUS_ORDER = { ONGOING: 0, UPCOMING: 1, COMPLETED: 2 } as const;

export function MatchForm({ match, tournaments: allTournaments, teams, players, defaultTournamentId, extractEnabled }: Props) {
  // Running tournaments first: that is where results are usually entered.
  const tournaments = useMemo(
    () => [...allTournaments].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [allTournaments],
  );
  const [tournamentId, setTournamentId] = useState(match?.tournamentId ?? defaultTournamentId ?? tournaments[0]?.id ?? "");
  const [teamAId, setTeamAId] = useState<string | null>(match?.teamAId ?? null);
  const [teamBId, setTeamBId] = useState<string | null>(match?.teamBId ?? null);
  const [scoreA, setScoreA] = useState(match ? String(match.scoreA) : "");
  const [scoreB, setScoreB] = useState(match ? String(match.scoreB) : "");
  const [round, setRound] = useState(match?.round ?? "");
  const [notes, setNotes] = useState(match?.notes ?? "");
  const [playedAt, setPlayedAt] = useState(() => toDateTimeInput(match?.playedAt ?? new Date()));
  const [imageUrl, setImageUrl] = useState<string | null>(match?.imageUrl ?? null);
  const [lines, setLines] = useState<Line[]>(() =>
    (match?.playerStats ?? []).map((s) => ({
      playerId: s.playerId,
      side: s.teamId === match!.teamAId ? "A" : "B",
      played: true,
      kills: String(s.kills),
      deaths: String(s.deaths),
      assists: String(s.assists),
      score: String(s.score),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [extractMsg, setExtractMsg] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, startSave] = useTransition();

  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const teamId = (side: Side) => (side === "A" ? teamAId : teamBId);

  /** Selecting a team fills that side with its roster, keeping numbers already typed for the same players. */
  function pickTeam(side: Side, id: string | null) {
    (side === "A" ? setTeamAId : setTeamBId)(id);
    setLines((prev) => {
      const kept = prev.filter((l) => l.side !== side);
      if (!id) return kept;
      const previous = new Map(prev.filter((l) => l.side === side).map((l) => [l.playerId, l]));
      const roster = players.filter((p) => p.teamId === id).map((p) => previous.get(p.id) ?? blank(p.id, side));
      return [...kept, ...roster];
    });
  }

  function update(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function addPlayer(side: Side, playerId: string) {
    if (!playerId || lines.some((l) => l.playerId === playerId)) return;
    setLines((prev) => [...prev, blank(playerId, side)]);
  }

  async function readImage() {
    if (!imageUrl) return;
    setReading(true);
    setExtractMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, teamAId: teamAId ?? undefined, teamBId: teamBId ?? undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "อ่านรูปไม่สำเร็จ");
      const s = body.suggestion as {
        teamAId: string | null;
        teamBId: string | null;
        scoreA: number | null;
        scoreB: number | null;
        notes: string;
        playerStats: { readName: string; playerId: string | null; teamId: string | null; kills: number | null; deaths: number | null; assists: number | null; score: number | null }[];
      };
      const newA = s.teamAId ?? teamAId;
      const newB = s.teamBId ?? teamBId;
      setTeamAId(newA);
      setTeamBId(newB);
      if (s.scoreA !== null) setScoreA(String(s.scoreA));
      if (s.scoreB !== null) setScoreB(String(s.scoreB));
      const unmatched: string[] = [];
      const read = new Map<string, Line>();
      for (const p of s.playerStats) {
        const side: Side | null = p.teamId && p.teamId === newA ? "A" : p.teamId && p.teamId === newB ? "B" : null;
        if (!p.playerId || !side) {
          unmatched.push(p.readName);
          continue;
        }
        const str = (n: number | null) => (n === null ? "" : String(n));
        read.set(p.playerId, { playerId: p.playerId, side, played: true, kills: str(p.kills), deaths: str(p.deaths), assists: str(p.assists), score: str(p.score) });
      }
      // Rosters of both teams, overwritten by whatever was read from the image.
      const roster = (id: string | null, side: Side) => (id ? players.filter((p) => p.teamId === id).map((p) => read.get(p.id) ?? { ...blank(p.id, side), played: false }) : []);
      const merged = [...roster(newA, "A"), ...roster(newB, "B")];
      for (const l of read.values()) if (!merged.some((m) => m.playerId === l.playerId)) merged.push(l);
      setLines(merged);
      setExtractMsg(
        [
          `อ่านข้อมูลจากรูปแล้ว: ${read.size} ผู้เล่น กรุณาตรวจสอบตัวเลขก่อนบันทึก`,
          !s.teamAId || !s.teamBId ? "บางทีมจับคู่ชื่อไม่ได้ กรุณาเลือกทีมเอง" : "",
          unmatched.length ? `ชื่อที่จับคู่ไม่ได้: ${unmatched.join(", ")}` : "",
          s.notes,
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "อ่านรูปไม่สำเร็จ");
    } finally {
      setReading(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!tournamentId) return setError("กรุณาเลือกทัวร์นาเมนต์");
    if (!teamAId || !teamBId) return setError("กรุณาเลือกทั้งสองทีม");
    if (teamAId === teamBId) return setError("ทีมทั้งสองฝั่งต้องไม่ใช่ทีมเดียวกัน");
    if (scoreA.trim() === "" || scoreB.trim() === "") return setError("กรุณากรอกสกอร์ทั้งสองทีม");
    if (!validCount(scoreA) || !validCount(scoreB)) return setError("สกอร์ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
    const used = lines.filter((l) => l.played);
    const bad = used.find((l) => STATS.some((k) => !validCount(l[k])));
    if (bad) return setError(`ตัวเลขของ ${playerById.get(bad.playerId)?.name ?? "ผู้เล่น"} ไม่ถูกต้อง (ต้องเป็นจำนวนเต็มตั้งแต่ 0)`);
    const payload: MatchPayload = {
      tournamentId,
      teamAId,
      teamBId,
      scoreA: num(scoreA),
      scoreB: num(scoreB),
      round: round.trim() || null,
      notes: notes.trim() || null,
      imageUrl,
      playedAt: playedAt ? new Date(playedAt).toISOString() : undefined,
      playerStats: used.map((l) => ({
        playerId: l.playerId,
        teamId: teamId(l.side)!,
        kills: num(l.kills),
        deaths: num(l.deaths),
        assists: num(l.assists),
        score: num(l.score),
      })),
    };
    startSave(async () => {
      const res = await saveMatch(match?.id ?? null, payload);
      if (res?.error) setError(res.error);
    });
  }

  const sideTable = (side: Side) => {
    const id = teamId(side);
    const team = teams.find((t) => t.id === id);
    const rows = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.side === side);
    const addable = players.filter((p) => !lines.some((l) => l.playerId === p.id));
    return (
      <section className="card stack" style={{ gap: 10 }}>
        <h3 style={{ margin: 0 }}>ผู้เล่น {team?.name ?? `ทีม ${side}`}</h3>
        {!id && <span className="muted small">เลือกทีมก่อน แล้วรายชื่อผู้เล่นจะขึ้นมาให้กรอก</span>}
        {id && rows.length === 0 && <span className="muted small">ทีมนี้ยังไม่มีผู้เล่น เพิ่มจากรายชื่อด้านล่างได้</span>}
        {rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>ลงเล่น</th>
                  <th>ผู้เล่น</th>
                  {STATS.map((k) => <th key={k} className="num">{STAT_LABEL[k]}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ l, i }) => (
                  <tr key={l.playerId} style={{ opacity: l.played ? 1 : 0.45 }}>
                    <td>
                      <input type="checkbox" checked={l.played} onChange={(e) => update(i, { played: e.target.checked })} aria-label="ลงเล่นในแมตช์นี้" style={{ width: 18, height: 18 }} />
                    </td>
                    <td>{playerById.get(l.playerId)?.name ?? l.playerId}</td>
                    {STATS.map((k) => (
                      <td key={k} className="num">
                        <input
                          inputMode="numeric"
                          value={l[k]}
                          disabled={!l.played}
                          onChange={(e) => update(i, { [k]: e.target.value.replace(/[^\d]/g, "") })}
                          aria-label={`${STAT_LABEL[k]} ของ ${playerById.get(l.playerId)?.name ?? ""}`}
                          placeholder="0"
                          style={{ width: 72, textAlign: "right", padding: "6px 8px" }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {id && addable.length > 0 && (
          <select value="" onChange={(e) => addPlayer(side, e.target.value)} aria-label={`เพิ่มผู้เล่นตัวสำรองให้ทีม ${side}`}>
            <option value="">+ เพิ่มผู้เล่นอื่น (ตัวสำรอง / ยืมตัว)</option>
            {addable.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.nickname ? ` (${p.nickname})` : ""}</option>
            ))}
          </select>
        )}
      </section>
    );
  };

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <section className="card stack">
        <h2 style={{ margin: 0 }}>1. ภาพผลการแข่ง (ไม่บังคับ)</h2>
        <ImageDrop value={imageUrl} onChange={setImageUrl} label="ลากภาพหน้าจอผลการแข่งมาวาง วาง (Ctrl+V) หรือคลิกเพื่อเลือกไฟล์" />
        {imageUrl && (
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={readImage} disabled={!extractEnabled || reading}>
              {reading ? "กำลังอ่านรูป…" : "🪄 ให้ AI อ่านผลจากรูปแล้วกรอกให้"}
            </button>
            {!extractEnabled && <span className="muted small">ยังไม่ได้เปิดระบบอ่านรูป (ตั้ง ANTHROPIC_API_KEY ที่ API) กรอกเองด้านล่างได้เลย</span>}
          </div>
        )}
        {extractMsg && <div className="notice small">{extractMsg}</div>}
      </section>

      <section className="card form">
        <h2 style={{ margin: 0 }}>2. ข้อมูลแมตช์</h2>
        <div className="form-row">
          <label>
            ทัวร์นาเมนต์ *
            <select value={tournamentId} onChange={(e) => setTournamentId(e.target.value)} required>
              {tournaments.length === 0 && <option value="">ยังไม่มีทัวร์นาเมนต์</option>}
              {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name} ({statusLabel[t.status]})</option>)}
            </select>
          </label>
          <label>รอบ<input value={round} onChange={(e) => setRound(e.target.value)} maxLength={60} placeholder="เช่น รอบแบ่งกลุ่ม, Final" /></label>
          <label>วันเวลาแข่ง<input type="datetime-local" value={playedAt} onChange={(e) => setPlayedAt(e.target.value)} /></label>
        </div>
        <div className="form-row versus-row">
          <label>
            ทีม A *
            <TeamPicker teams={teams} value={teamAId} onChange={(id) => pickTeam("A", id)} exclude={teamBId ? [teamBId] : []} label="ทีม A" />
          </label>
          <label>สกอร์ A *<input inputMode="numeric" value={scoreA} onChange={(e) => setScoreA(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" aria-label="สกอร์ทีม A" /></label>
          <label>สกอร์ B *<input inputMode="numeric" value={scoreB} onChange={(e) => setScoreB(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" aria-label="สกอร์ทีม B" /></label>
          <label>
            ทีม B *
            <TeamPicker teams={teams} value={teamBId} onChange={(id) => pickTeam("B", id)} exclude={teamAId ? [teamAId] : []} label="ทีม B" />
          </label>
        </div>
        <label>หมายเหตุ<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} /></label>
      </section>

      <h2 style={{ margin: 0 }}>3. สถิติผู้เล่น</h2>
      <div className="grid grid-2">
        {sideTable("A")}
        {sideTable("B")}
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "กำลังบันทึก…" : match ? "บันทึกการแก้ไข" : "บันทึกผลการแข่ง"}</button>
      </div>
    </form>
  );
}
