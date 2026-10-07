import { prisma } from "./db.js";
import { normaliseName } from "./validate.js";
import type { ExtractedSeries, ReadGame } from "./extract.js";

/**
 * A suggested series result, ready to review and then send to POST /matches
 * (with a tournamentId). Teams/players without an id are created on save.
 */
export interface DraftPlayer {
  playerId: string | null;
  name: string;
  side: "A" | "B";
  pts: number;
  reb: number;
  blk: number;
  stl: number;
  ast: number;
  lbr: number;
  rating: number | null;
  award: "MVP" | "SVP" | null;
}
export interface Draft {
  teamAId: string | null;
  teamAName: string;
  teamBId: string | null;
  teamBName: string;
  scoreA: number;
  scoreB: number;
  games: { scoreA: number; scoreB: number; imageUrl: string | null; players: DraftPlayer[] }[];
  /** Things a person should check before saving, in Thai. */
  warnings: string[];
  notes: string;
}

/** "Pai Nai 2 - 0 ฉันมีไม่ตาย" → teams and series score. Only the first line counts. */
export function parseResultText(text: string) {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const m = /^(.+?)\s+(\d{1,2})\s*[-–—:]\s*(\d{1,2})\s+(.+)$/u.exec(line);
  if (!m) return null;
  return { teamA: m[1].trim(), scoreA: Number(m[2]), teamB: m[4].trim(), scoreB: Number(m[3]) };
}

type Side = "A" | "B";
const flip = (s: Side): Side => (s === "A" ? "B" : "A");
const names = (g: ReadGame, side: "ally" | "rival") => new Set(g.players.filter((p) => p.side === side).map((p) => normaliseName(p.name)));
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length;

/**
 * Decides which team was "Ally" in each scoreboard. Evidence, strongest first:
 * players already registered to a team, the same players appearing across games,
 * and the series score in the text. Falls back to Ally = team A.
 */
export function allySides(
  games: ReadGame[],
  rosterA: Set<string>,
  rosterB: Set<string>,
  series: { scoreA: number; scoreB: number } | null,
): { sides: Side[]; confident: boolean } {
  if (!games.length) return { sides: [], confident: true };
  const fromRoster = games.map((g): Side | null => {
    const ally = names(g, "ally");
    const rival = names(g, "rival");
    const asA = overlap(ally, rosterA) + overlap(rival, rosterB);
    const asB = overlap(ally, rosterB) + overlap(rival, rosterA);
    return asA > asB ? "A" : asB > asA ? "B" : null;
  });
  const first = { ally: names(games[0], "ally"), rival: names(games[0], "rival") };
  const sameAsFirst = games.map((g): boolean | null => {
    const ally = names(g, "ally");
    const rival = names(g, "rival");
    const same = overlap(ally, first.ally) + overlap(rival, first.rival);
    const swapped = overlap(ally, first.rival) + overlap(rival, first.ally);
    return same > swapped ? true : swapped > same ? false : null;
  });

  const candidates = (["A", "B"] as Side[]).map((base) => {
    const sides = games.map((_, i) => fromRoster[i] ?? (sameAsFirst[i] === false ? flip(base) : base));
    let score = sides.filter((s, i) => fromRoster[i] === s).length * 10;
    if (series) {
      const winsA = games.filter((g, i) => {
        const a = sides[i] === "A" ? g.allyScore : g.rivalScore;
        const b = sides[i] === "A" ? g.rivalScore : g.allyScore;
        return a !== null && b !== null && a > b;
      }).length;
      const winsB = games.filter((g, i) => {
        const a = sides[i] === "A" ? g.allyScore : g.rivalScore;
        const b = sides[i] === "A" ? g.rivalScore : g.allyScore;
        return a !== null && b !== null && b > a;
      }).length;
      if (winsA === series.scoreA && winsB === series.scoreB) score += 5;
    }
    return { sides, score };
  });
  const [a, b] = candidates;
  const best = b.score > a.score ? b : a;
  const same = a.sides.every((side, i) => side === b.sides[i]);
  return { sides: best.sides, confident: same || a.score !== b.score };
}

/** Matches the read result against the database and returns a reviewable draft. */
export async function buildDraft(read: ExtractedSeries, text: string, imageUrls: string[], hint: { teamAId?: string; teamBId?: string } = {}): Promise<Draft> {
  const warnings: string[] = [];
  const parsed = parseResultText(text);
  const [teams, players] = await Promise.all([
    prisma.team.findMany({ select: { id: true, name: true, tag: true } }),
    prisma.player.findMany({ select: { id: true, name: true, nickname: true, teamId: true } }),
  ]);
  const findTeam = (name: string) => {
    const key = normaliseName(name);
    return key ? (teams.find((t) => normaliseName(t.name) === key) ?? teams.find((t) => t.tag && normaliseName(t.tag) === key)) : undefined;
  };

  const teamAName = parsed?.teamA ?? read.teamA.trim();
  const teamBName = parsed?.teamB ?? read.teamB.trim();
  const teamA = hint.teamAId ? teams.find((t) => t.id === hint.teamAId) : findTeam(teamAName);
  const teamB = hint.teamBId ? teams.find((t) => t.id === hint.teamBId) : findTeam(teamBName);
  if (!teamA && !teamAName) warnings.push("หาชื่อทีม A ในข้อความไม่เจอ กรุณาเลือกทีมเอง");
  if (!teamB && !teamBName) warnings.push("หาชื่อทีม B ในข้อความไม่เจอ กรุณาเลือกทีมเอง");
  if (!teamA && teamAName) warnings.push(`ทีม "${teamAName}" ยังไม่มีในเว็บ จะสร้างใหม่ตอนบันทึก`);
  if (!teamB && teamBName) warnings.push(`ทีม "${teamBName}" ยังไม่มีในเว็บ จะสร้างใหม่ตอนบันทึก`);

  const roster = (teamId?: string) =>
    new Set(players.filter((p) => teamId && p.teamId === teamId).flatMap((p) => [p.name, p.nickname].filter((n): n is string => Boolean(n)).map(normaliseName)));
  const series = parsed ? { scoreA: parsed.scoreA, scoreB: parsed.scoreB } : read.seriesScoreA !== null && read.seriesScoreB !== null ? { scoreA: read.seriesScoreA, scoreB: read.seriesScoreB } : null;
  const { sides, confident } = allySides(read.games, roster(teamA?.id), roster(teamB?.id), series);
  if (read.games.length > 1 && !confident) warnings.push("ไม่แน่ใจว่าทีมไหนเป็นฝั่ง Ally ในแต่ละเกม กรุณาตรวจฝั่งทีม");

  let unreadable = false;
  const num = (n: number | null) => {
    if (n === null) unreadable = true;
    return n ?? 0;
  };
  const newPlayers = new Set<string>();
  const games = read.games.map((g, i) => {
    const allySide = sides[i];
    const teamIdOf = (side: Side) => (side === "A" ? teamA?.id : teamB?.id);
    const gamePlayers = g.players.map((p): DraftPlayer => {
      const side = p.side === "ally" ? allySide : flip(allySide);
      const key = normaliseName(p.name);
      const same = (x: (typeof players)[number]) => normaliseName(x.name) === key || (x.nickname !== null && normaliseName(x.nickname) === key);
      const found = players.find((x) => x.teamId === teamIdOf(side) && same(x)) ?? players.find(same);
      if (!found) newPlayers.add(p.name);
      return {
        playerId: found?.id ?? null,
        name: found?.name ?? p.name,
        side,
        pts: num(p.pts),
        reb: num(p.reb),
        blk: num(p.blk),
        stl: num(p.stl),
        ast: num(p.ast),
        lbr: num(p.lbr),
        rating: p.rating,
        award: p.award,
      };
    });
    for (const side of ["A", "B"] as Side[]) {
      const n = gamePlayers.filter((p) => p.side === side).length;
      if (n !== 3) warnings.push(`เกม ${i + 1}: อ่านผู้เล่นทีม ${side} ได้ ${n} คน (ปกติ 3 คน)`);
    }
    const scoreA = num(allySide === "A" ? g.allyScore : g.rivalScore);
    const scoreB = num(allySide === "A" ? g.rivalScore : g.allyScore);
    const expected = g.result === "WIN" ? allySide : g.result === "LOSE" ? flip(allySide) : null;
    const winner = scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : null;
    if (expected && winner && expected !== winner) warnings.push(`เกม ${i + 1}: สกอร์กับคำว่า WIN/LOSE ไม่ตรงกัน กรุณาตรวจสกอร์`);
    return {
      scoreA,
      scoreB,
      imageUrl: imageUrls[i] ?? imageUrls.at(-1) ?? null,
      players: gamePlayers,
    };
  });
  if (unreadable) warnings.push("มีตัวเลขบางช่องที่อ่านไม่ออก ใส่เป็น 0 ไว้ กรุณาตรวจ");
  if (newPlayers.size) warnings.push(`ผู้เล่นใหม่ (จะสร้างให้ตอนบันทึก): ${[...newPlayers].join(", ")}`);
  if (!read.games.length) warnings.push("ไม่พบสกอร์บอร์ดในรูป");

  const winsA = games.filter((g) => g.scoreA > g.scoreB).length;
  const winsB = games.filter((g) => g.scoreB > g.scoreA).length;
  if (series && games.length && (series.scoreA !== winsA || series.scoreB !== winsB)) {
    warnings.push(`ผลในข้อความ ${series.scoreA}-${series.scoreB} ไม่ตรงกับเกมในรูป (${winsA}-${winsB}) กรุณาตรวจ`);
  }

  return {
    teamAId: teamA?.id ?? null,
    teamAName: teamA?.name ?? teamAName,
    teamBId: teamB?.id ?? null,
    teamBName: teamB?.name ?? teamBName,
    scoreA: series?.scoreA ?? winsA,
    scoreB: series?.scoreB ?? winsB,
    games,
    warnings,
    notes: read.notes,
  };
}
