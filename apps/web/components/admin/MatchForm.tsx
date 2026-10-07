"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { saveMatch, type MatchPayload } from "@/app/admin/actions";
import { STAT_KEYS, type Award, type MatchDetail, type Player, type StatKey, type Tournament } from "@/lib/types";
import { statLabels, statusLabel, toDateTimeInput } from "@/lib/format";
import { ImageDrop } from "../ImageDrop";
import { TeamPicker, type PickerTeam } from "../TeamPicker";

type Side = "A" | "B";
type Stats = Record<StatKey, string>;
interface Row extends Stats {
  key: number;
  side: Side;
  /** Kept only while the name still matches the player it came from. */
  playerId: string | null;
  name: string;
  rating: string;
  award: "" | Award;
}
interface Game {
  key: number;
  scoreA: string;
  scoreB: string;
  imageUrl: string | null;
  rows: Row[];
}
/** A team chosen from the list, or a new name that will be created on save. */
interface TeamChoice {
  id: string | null;
  newName: string;
}

interface Draft {
  teamAId: string | null;
  teamAName: string;
  teamBId: string | null;
  teamBName: string;
  scoreA: number;
  scoreB: number;
  games: { scoreA: number; scoreB: number; imageUrl: string | null; players: ({ playerId: string | null; name: string; side: Side; rating: number | null; award: Award | null } & Record<StatKey, number>)[] }[];
  warnings: string[];
  notes: string;
}

interface Props {
  match?: MatchDetail;
  tournaments: Pick<Tournament, "id" | "name" | "status">[];
  teams: PickerTeam[];
  players: Pick<Player, "id" | "name" | "nickname" | "teamId">[];
  defaultTournamentId?: string;
  extractEnabled: boolean;
}

let nextKey = 1;
const emptyStats = (): Stats => ({ pts: "", reb: "", blk: "", stl: "", ast: "", lbr: "" });
const row = (side: Side, p?: { id: string | null; name: string }): Row => ({
  key: nextKey++, side, playerId: p?.id ?? null, name: p?.name ?? "", rating: "", award: "", ...emptyStats(),
});
const num = (s: string) => (s.trim() === "" ? 0 : Number(s));
const validCount = (s: string) => s.trim() === "" || (/^\d+$/.test(s.trim()) && Number(s) <= 100000);
const validRating = (s: string) => s.trim() === "" || (/^\d+(\.\d+)?$/.test(s.trim()) && Number(s) <= 1000);
const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const digits = (s: string) => s.replace(/[^\d]/g, "");
const decimal = (s: string) => s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");

const STATUS_ORDER = { ONGOING: 0, UPCOMING: 1, COMPLETED: 2 } as const;

export function MatchForm({ match, tournaments: allTournaments, teams, players, defaultTournamentId, extractEnabled }: Props) {
  // Running tournaments first: that is where results are usually entered.
  const tournaments = useMemo(
    () => [...allTournaments].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [allTournaments],
  );
  const listId = useId();
  const [tournamentId, setTournamentId] = useState(match?.tournamentId ?? defaultTournamentId ?? tournaments[0]?.id ?? "");
  const [teamA, setTeamA] = useState<TeamChoice>({ id: match?.teamAId ?? null, newName: "" });
  const [teamB, setTeamB] = useState<TeamChoice>({ id: match?.teamBId ?? null, newName: "" });
  // Blank means "count from the games".
  const [seriesA, setSeriesA] = useState(match && !match.games.length ? String(match.scoreA) : "");
  const [seriesB, setSeriesB] = useState(match && !match.games.length ? String(match.scoreB) : "");
  const [round, setRound] = useState(match?.round ?? "");
  const [notes, setNotes] = useState(match?.notes ?? "");
  const [playedAt, setPlayedAt] = useState(() => toDateTimeInput(match?.playedAt ?? new Date()));
  const [games, setGames] = useState<Game[]>(() =>
    (match?.games ?? []).map((g) => ({
      key: nextKey++,
      scoreA: String(g.scoreA),
      scoreB: String(g.scoreB),
      imageUrl: g.imageUrl,
      rows: g.playerStats.map((s) => ({
        key: nextKey++,
        side: s.teamId === match!.teamAId ? "A" : "B",
        playerId: s.playerId,
        name: s.player.name,
        rating: s.rating === null ? "" : String(s.rating),
        award: s.award ?? "",
        ...(Object.fromEntries(STAT_KEYS.map((k) => [k, String(s[k])])) as Stats),
      })),
    })),
  );
  const [postText, setPostText] = useState("");
  const [shots, setShots] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [extractMsg, setExtractMsg] = useState<string[] | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, startSave] = useTransition();

  const teamName = (c: TeamChoice, side: Side) => teams.find((t) => t.id === c.id)?.name ?? (c.newName || `ทีม ${side}`);
  const known = useMemo(() => new Set(players.flatMap((p) => [p.name, p.nickname].filter((n): n is string => Boolean(n)).map(normalise))), [players]);

  /** The first three players of a team, for a fresh scoreboard. */
  const starters = (c: TeamChoice, side: Side) => {
    const roster = c.id ? players.filter((p) => p.teamId === c.id).slice(0, 3) : [];
    const rows = roster.map((p) => row(side, { id: p.id, name: p.name }));
    while (rows.length < 3) rows.push(row(side));
    return rows;
  };

  function addGame() {
    setGames((prev) => {
      // Later games usually have the same line-up as the one before.
      const last = prev.at(-1);
      const rows = last
        ? last.rows.map((r) => ({ ...row(r.side, { id: r.playerId, name: r.name }) }))
        : [...starters(teamA, "A"), ...starters(teamB, "B")];
      return [...prev, { key: nextKey++, scoreA: "", scoreB: "", imageUrl: null, rows }];
    });
  }

  /** Choosing a team refills that side of scoreboards that are still empty. */
  function pickTeam(side: Side, id: string | null) {
    const choice = { id, newName: "" };
    (side === "A" ? setTeamA : setTeamB)(choice);
    setGames((prev) =>
      prev.map((g) => {
        const sideRows = g.rows.filter((r) => r.side === side);
        if (sideRows.some((r) => r.name.trim())) return g;
        return { ...g, rows: [...g.rows.filter((r) => r.side !== side), ...starters(choice, side)] };
      }),
    );
  }

  const updateGame = (key: number, patch: Partial<Game>) => setGames((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  const updateRow = (gameKey: number, rowKey: number, patch: Partial<Row>) =>
    setGames((prev) => prev.map((g) => (g.key === gameKey ? { ...g, rows: g.rows.map((r) => (r.key === rowKey ? { ...r, ...patch } : r)) } : g)));

  /** Several screenshots dropped at once: one game each. */
  function addShots(urls: string[]) {
    setShots((prev) => [...prev, ...urls].slice(0, 6));
  }

  async function readPost() {
    if (!shots.length) return;
    setReading(true);
    setExtractMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrls: shots, text: postText, teamAId: teamA.id ?? undefined, teamBId: teamB.id ?? undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "อ่านรูปไม่สำเร็จ");
      applyDraft(body.draft as Draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "อ่านรูปไม่สำเร็จ");
    } finally {
      setReading(false);
    }
  }

  function applyDraft(d: Draft) {
    setTeamA({ id: d.teamAId, newName: d.teamAId ? "" : d.teamAName });
    setTeamB({ id: d.teamBId, newName: d.teamBId ? "" : d.teamBName });
    const counted = (side: Side) => d.games.filter((g) => (side === "A" ? g.scoreA > g.scoreB : g.scoreB > g.scoreA)).length;
    // Keep the series score from the post only when it differs from the games.
    setSeriesA(d.games.length && d.scoreA === counted("A") && d.scoreB === counted("B") ? "" : String(d.scoreA));
    setSeriesB(d.games.length && d.scoreA === counted("A") && d.scoreB === counted("B") ? "" : String(d.scoreB));
    setGames(
      d.games.map((g) => ({
        key: nextKey++,
        scoreA: String(g.scoreA),
        scoreB: String(g.scoreB),
        imageUrl: g.imageUrl,
        rows: g.players.map((p) => ({
          key: nextKey++,
          side: p.side,
          playerId: p.playerId,
          name: p.name,
          rating: p.rating === null ? "" : String(p.rating),
          award: p.award ?? "",
          ...(Object.fromEntries(STAT_KEYS.map((k) => [k, String(p[k])])) as Stats),
        })),
      })),
    );
    if (d.notes && !notes.trim()) setNotes(d.notes);
    setShots([]);
    setExtractMsg([`อ่านแล้ว ${d.games.length} เกม กรุณาตรวจตัวเลขก่อนบันทึก`, ...d.warnings]);
  }

  const counted = {
    A: games.filter((g) => num(g.scoreA) > num(g.scoreB)).length,
    B: games.filter((g) => num(g.scoreB) > num(g.scoreA)).length,
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!tournamentId) return setError("กรุณาเลือกทัวร์นาเมนต์");
    if (!teamA.id && !teamA.newName.trim()) return setError("กรุณาเลือกทีม A");
    if (!teamB.id && !teamB.newName.trim()) return setError("กรุณาเลือกทีม B");
    if (teamA.id && teamA.id === teamB.id) return setError("ทีมทั้งสองฝั่งต้องไม่ใช่ทีมเดียวกัน");
    if (!teamA.id && !teamB.id && normalise(teamA.newName) === normalise(teamB.newName)) return setError("ทีมทั้งสองฝั่งต้องไม่ใช่ทีมเดียวกัน");
    if ((seriesA.trim() === "") !== (seriesB.trim() === "")) return setError("กรอกผลซีรีส์ให้ครบทั้งสองทีม หรือเว้นว่างทั้งคู่");
    if (!games.length && seriesA.trim() === "") return setError("กรุณากรอกผลซีรีส์ หรือเพิ่มอย่างน้อย 1 เกม");
    for (const [i, g] of games.entries()) {
      const label = `เกม ${i + 1}`;
      if (g.scoreA.trim() === "" || g.scoreB.trim() === "") return setError(`${label}: กรุณากรอกสกอร์ทั้งสองทีม`);
      const used = g.rows.filter((r) => r.name.trim());
      const unnamed = g.rows.find((r) => !r.name.trim() && (STAT_KEYS.some((k) => r[k].trim()) || r.rating.trim()));
      if (unnamed) return setError(`${label}: มีแถวที่กรอกตัวเลขแต่ไม่มีชื่อผู้เล่น`);
      const bad = used.find((r) => STAT_KEYS.some((k) => !validCount(r[k])));
      if (bad) return setError(`${label}: ตัวเลขของ ${bad.name} ไม่ถูกต้อง (ต้องเป็นจำนวนเต็มตั้งแต่ 0)`);
      const badRating = used.find((r) => !validRating(r.rating));
      if (badRating) return setError(`${label}: เรตติ้งของ ${badRating.name} ไม่ถูกต้อง (เช่น 16.9)`);
      const names = used.map((r) => normalise(r.name));
      const dup = used.find((_, j) => names.indexOf(names[j]) !== j);
      if (dup) return setError(`${label}: ${dup.name} ถูกใส่ซ้ำ`);
    }
    const ref = (c: TeamChoice) => (c.id ? { id: c.id, name: undefined } : { id: undefined, name: c.newName.trim() });
    const payload: MatchPayload = {
      tournamentId,
      teamAId: ref(teamA).id,
      teamAName: ref(teamA).name,
      teamBId: ref(teamB).id,
      teamBName: ref(teamB).name,
      scoreA: seriesA.trim() === "" ? undefined : num(seriesA),
      scoreB: seriesB.trim() === "" ? undefined : num(seriesB),
      round: round.trim() || null,
      notes: notes.trim() || null,
      imageUrl: match?.imageUrl ?? null,
      source: match?.source ?? null,
      sourceRef: match?.sourceRef ?? null,
      playedAt: playedAt ? new Date(playedAt).toISOString() : undefined,
      games: games.map((g) => ({
        scoreA: num(g.scoreA),
        scoreB: num(g.scoreB),
        imageUrl: g.imageUrl,
        players: g.rows
          .filter((r) => r.name.trim())
          .map((r) => ({
            playerId: r.playerId ?? undefined,
            name: r.name.trim(),
            side: r.side,
            rating: r.rating.trim() === "" ? null : Number(r.rating),
            award: r.award || null,
            ...(Object.fromEntries(STAT_KEYS.map((k) => [k, num(r[k])])) as Record<StatKey, number>),
          })),
      })),
    };
    startSave(async () => {
      const res = await saveMatch(match?.id ?? null, payload);
      if (res?.error) setError(res.error);
    });
  }

  const teamField = (side: Side, choice: TeamChoice, other: TeamChoice) => (
    <label>
      ทีม {side} *
      {choice.newName && !choice.id ? (
        <span className="new-team">
          <input
            value={choice.newName}
            onChange={(e) => (side === "A" ? setTeamA : setTeamB)({ id: null, newName: e.target.value })}
            maxLength={100}
            aria-label={`ชื่อทีมใหม่ ${side}`}
          />
          <span className="muted small">ทีมใหม่ จะสร้างตอนบันทึก · <button type="button" className="link-btn" onClick={() => pickTeam(side, null)}>เลือกทีมที่มีอยู่แทน</button></span>
        </span>
      ) : (
        <TeamPicker teams={teams} value={choice.id} onChange={(id) => pickTeam(side, id)} exclude={other.id ? [other.id] : []} label={`ทีม ${side}`} />
      )}
    </label>
  );

  const scoreboard = (g: Game, side: Side) => {
    const rows = g.rows.filter((r) => r.side === side);
    const team = teamName(side === "A" ? teamA : teamB, side);
    return (
      <div className="stack" style={{ gap: 8 }}>
        <h4 style={{ margin: 0 }}>{team}</h4>
        <div style={{ overflowX: "auto" }}>
          <table className="stat-table">
            <thead>
              <tr>
                <th>ผู้เล่น</th>
                <th className="num">เรตติ้ง</th>
                <th>รางวัล</th>
                {STAT_KEYS.map((k) => <th key={k} className="num" title={statLabels[k].th}>{statLabels[k].short}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isNew = r.name.trim() !== "" && !known.has(normalise(r.name));
                return (
                  <tr key={r.key}>
                    <td>
                      <input
                        list={listId}
                        value={r.name}
                        onChange={(e) => updateRow(g.key, r.key, { name: e.target.value, playerId: null })}
                        placeholder="ชื่อผู้เล่น"
                        aria-label={`ชื่อผู้เล่น ${team}`}
                        style={{ minWidth: 130 }}
                      />
                      {isNew && <div className="muted small">ผู้เล่นใหม่</div>}
                    </td>
                    <td className="num">
                      <input inputMode="decimal" value={r.rating} onChange={(e) => updateRow(g.key, r.key, { rating: decimal(e.target.value) })} placeholder="0.0" aria-label={`เรตติ้งของ ${r.name}`} style={{ width: 64, textAlign: "right", padding: "6px 8px" }} />
                    </td>
                    <td>
                      <select value={r.award} onChange={(e) => updateRow(g.key, r.key, { award: e.target.value as Row["award"] })} aria-label={`รางวัลของ ${r.name}`} style={{ padding: "6px 8px" }}>
                        <option value="">-</option>
                        <option value="MVP">MVP</option>
                        <option value="SVP">SVP</option>
                      </select>
                    </td>
                    {STAT_KEYS.map((k) => (
                      <td key={k} className="num">
                        <input
                          inputMode="numeric"
                          value={r[k]}
                          onChange={(e) => updateRow(g.key, r.key, { [k]: digits(e.target.value) })}
                          aria-label={`${statLabels[k].short} ของ ${r.name}`}
                          placeholder="0"
                          style={{ width: 52, textAlign: "right", padding: "6px 8px" }}
                        />
                      </td>
                    ))}
                    <td>
                      <button type="button" className="btn btn-sm" aria-label={`ลบแถว ${r.name}`} onClick={() => updateGame(g.key, { rows: g.rows.filter((x) => x.key !== r.key) })}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => updateGame(g.key, { rows: [...g.rows, row(side)] })}>
          + เพิ่มผู้เล่น {team}
        </button>
      </div>
    );
  };

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <datalist id={listId}>
        {players.map((p) => <option key={p.id} value={p.name}>{teams.find((t) => t.id === p.teamId)?.name ?? ""}</option>)}
      </datalist>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>1. ให้ AI อ่านผลจากโพสต์ (ไม่บังคับ)</h2>
        <p className="muted small" style={{ margin: 0 }}>วางข้อความผล เช่น “WD 2-0 Pai Nai” แล้วลากรูปสกอร์บอร์ดทุกเกมมาวางพร้อมกัน (เรียงตามเกม) หรือข้ามไปกรอกเองด้านล่าง</p>
        <label>ข้อความผล<input value={postText} onChange={(e) => setPostText(e.target.value)} maxLength={500} placeholder="ทีม A 2-0 ทีม B" /></label>
        <ImageDrop value={null} onChange={() => {}} onMany={addShots} label="ลากรูปสกอร์บอร์ดมาวาง (ได้หลายรูป) วาง (Ctrl+V) หรือคลิกเพื่อเลือกไฟล์" />
        {shots.length > 0 && (
          <div className="row" style={{ alignItems: "flex-start" }}>
            {shots.map((url, i) => (
              <figure key={url} className="shot-chip">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`รูปเกม ${i + 1}`} />
                <figcaption className="small">เกม {i + 1} <button type="button" className="link-btn" onClick={() => setShots(shots.filter((s) => s !== url))}>ลบ</button></figcaption>
              </figure>
            ))}
          </div>
        )}
        {shots.length > 0 && (
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={readPost} disabled={!extractEnabled || reading}>
              {reading ? "กำลังอ่านรูป…" : `🪄 ให้ AI อ่าน ${shots.length} รูปแล้วกรอกให้`}
            </button>
            <button type="button" className="btn" onClick={() => {
              setGames((prev) => [...prev, ...shots.map((url) => ({ key: nextKey++, scoreA: "", scoreB: "", imageUrl: url, rows: [...starters(teamA, "A"), ...starters(teamB, "B")] }))]);
              setShots([]);
            }}>ใช้รูปนี้แล้วกรอกเอง</button>
            {!extractEnabled && <span className="muted small">ยังไม่ได้เปิดระบบอ่านรูป (ตั้ง ANTHROPIC_API_KEY ที่ API) กรอกเองได้</span>}
          </div>
        )}
        {extractMsg && (
          <div className="notice small" role="status">
            {extractMsg.map((m, i) => <div key={i}>{i === 0 ? m : `⚠ ${m}`}</div>)}
          </div>
        )}
      </section>

      <section className="card form">
        <h2 style={{ margin: 0 }}>2. ข้อมูลซีรีส์</h2>
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
          {teamField("A", teamA, teamB)}
          <label>ชนะ (เกม) A<input inputMode="numeric" value={seriesA} onChange={(e) => setSeriesA(digits(e.target.value))} placeholder={String(counted.A)} aria-label="ผลซีรีส์ทีม A" /></label>
          <label>ชนะ (เกม) B<input inputMode="numeric" value={seriesB} onChange={(e) => setSeriesB(digits(e.target.value))} placeholder={String(counted.B)} aria-label="ผลซีรีส์ทีม B" /></label>
          {teamField("B", teamB, teamA)}
        </div>
        <span className="muted small">ผลซีรีส์เว้นว่างได้ ระบบจะนับจากสกอร์แต่ละเกมให้ (ตอนนี้ {counted.A} - {counted.B})</span>
        <label>หมายเหตุ<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} /></label>
      </section>

      <h2 style={{ margin: 0 }}>3. สกอร์บอร์ดแต่ละเกม</h2>
      {games.length === 0 && <div className="muted">ยังไม่มีเกม กด “+ เพิ่มเกม” เพื่อกรอกสถิติ หรือกรอกแค่ผลซีรีส์ด้านบนก็ได้</div>}
      {games.map((g, i) => (
        <section key={g.key} className="card stack game-form" aria-label={`เกม ${i + 1}`}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>เกม {i + 1}</h3>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setGames(games.filter((x) => x.key !== g.key))}>ลบเกมนี้</button>
          </div>
          <div className="game-form-top">
            <div className="form-row versus-row" style={{ flex: 1 }}>
              <label>สกอร์ {teamName(teamA, "A")} *<input inputMode="numeric" value={g.scoreA} onChange={(e) => updateGame(g.key, { scoreA: digits(e.target.value) })} placeholder="0" aria-label={`สกอร์ทีม A เกม ${i + 1}`} /></label>
              <label>สกอร์ {teamName(teamB, "B")} *<input inputMode="numeric" value={g.scoreB} onChange={(e) => updateGame(g.key, { scoreB: digits(e.target.value) })} placeholder="0" aria-label={`สกอร์ทีม B เกม ${i + 1}`} /></label>
            </div>
            <div style={{ width: 220 }}>
              <ImageDrop compact value={g.imageUrl} onChange={(url) => updateGame(g.key, { imageUrl: url })} label="รูปสกอร์บอร์ดเกมนี้" />
            </div>
          </div>
          {scoreboard(g, "A")}
          {scoreboard(g, "B")}
        </section>
      ))}
      <div className="row">
        <button type="button" className="btn" onClick={addGame}>+ เพิ่มเกม</button>
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "กำลังบันทึก…" : match ? "บันทึกการแก้ไข" : "บันทึกผลการแข่ง"}</button>
      </div>
    </form>
  );
}
