import { prisma } from "./db.js";
import { nameDistance, normaliseName } from "./validate.js";
import type { ExtractedSeries, ReadGame } from "./extract.js";

/**
 * A suggested series result, ready to review and then send to POST /matches
 * (with a tournamentId). Teams/players without an id are created on save.
 */
export interface DraftPlayer {
  playerId: string | null;
  name: string;
  /** In-game UID from the tournament roster, when the player was taken from it. */
  uid: string | null;
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

/** A player on a team's tournament roster: the only names a bracket match result may use. */
export interface RosterName {
  playerId: string;
  name: string;
  uid: string | null;
}

/**
 * Gives each name read off the scoreboard a different player of the roster, the pairing
 * whose names are most alike overall. Rows beyond the roster's size get -1.
 */
export function assignRoster(read: string[], roster: RosterName[]): { picks: number[]; cost: number } {
  const dist = read.map((r) => roster.map((p) => nameDistance(r, p.name)));
  let best = { picks: read.map(() => -1), cost: Infinity };
  const used = new Array<boolean>(roster.length).fill(false);
  const picks: number[] = [];
  const walk = (i: number, cost: number) => {
    if (cost >= best.cost) return;
    if (i === read.length) {
      best = { picks: [...picks], cost };
      return;
    }
    let placed = false;
    for (let k = 0; k < roster.length; k++) {
      if (used[k]) continue;
      placed = true;
      used[k] = true;
      picks.push(k);
      walk(i + 1, cost + dist[i][k]);
      picks.pop();
      used[k] = false;
    }
    // More rows than players on the roster: this row stays unmatched.
    if (!placed || read.length - i > roster.length - used.filter(Boolean).length) {
      picks.push(-1);
      walk(i + 1, cost + 1);
      picks.pop();
    }
  };
  walk(0, 0);
  return best;
}

/** Above this, a row's name is too unlike the roster player it was given to pass without a look. */
const DOUBTFUL = 0.5;

/** Matches the read result against the database and returns a reviewable draft. */
export async function buildDraft(
  read: ExtractedSeries,
  text: string,
  imageUrls: string[],
  hint: { teamAId?: string; teamBId?: string; rosters?: { A: RosterName[]; B: RosterName[] } } = {},
): Promise<Draft> {
  const warnings: string[] = [];
  const parsed = parseResultText(text);
  const [teams, players] = await Promise.all([
    prisma.team.findMany({ select: { id: true, name: true, tag: true } }),
    prisma.player.findMany({ select: { id: true, name: true, nickname: true, teamId: true, names: { select: { name: true } } } }),
  ]);
  const findTeam = (name: string) => {
    const key = normaliseName(name);
    return key ? (teams.find((t) => normaliseName(t.name) === key) ?? teams.find((t) => t.tag && normaliseName(t.tag) === key)) : undefined;
  };

  // In a bracket match the teams are known; a post written "B 2-1 A" is turned around to match.
  if (parsed && hint.teamAId && hint.teamBId) {
    const a = teams.find((t) => t.id === hint.teamAId);
    const b = teams.find((t) => t.id === hint.teamBId);
    const is = (name: string, t?: { name: string; tag: string | null }) => Boolean(t) && (normaliseName(name) === normaliseName(t!.name) || (t!.tag !== null && normaliseName(name) === normaliseName(t!.tag)));
    if (is(parsed.teamA, b) && is(parsed.teamB, a) && !is(parsed.teamA, a)) {
      [parsed.teamA, parsed.teamB, parsed.scoreA, parsed.scoreB] = [parsed.teamB, parsed.teamA, parsed.scoreB, parsed.scoreA];
    }
  }
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
  const rosterOf = (side: Side) => hint.rosters?.[side] ?? [];
  // In a bracket match the two rosters are known: every row is one of those players, never a new name.
  const locked = Boolean(teamA && teamB && rosterOf("A").length && rosterOf("B").length);
  const rowNames = (g: ReadGame, s: "ally" | "rival") => g.players.filter((p) => p.side === s).map((p) => p.name);
  const fit = (g: ReadGame, allySide: Side) =>
    assignRoster(rowNames(g, "ally"), rosterOf(allySide)).cost + assignRoster(rowNames(g, "rival"), rosterOf(flip(allySide))).cost;
  let { sides, confident } = allySides(read.games, roster(teamA?.id), roster(teamB?.id), series);
  if (locked) {
    // The side whose rows read most like a team's roster is that team; a near tie keeps the other evidence.
    sides = read.games.map((g, i) => {
      const asA = fit(g, "A");
      const asB = fit(g, "B");
      return Math.abs(asA - asB) < 0.3 ? sides[i] : asA < asB ? "A" : "B";
    });
    confident = read.games.every((g) => Math.abs(fit(g, "A") - fit(g, "B")) >= 0.3) || confident;
  }
  if (read.games.length > 1 && !confident) warnings.push("ไม่แน่ใจว่าทีมไหนเป็นฝั่ง Ally ในแต่ละเกม กรุณาตรวจฝั่งทีม");

  let unreadable = false;
  const num = (n: number | null) => {
    if (n === null) unreadable = true;
    return n ?? 0;
  };
  const newPlayers = new Set<string>();
  const doubtful: string[] = [];
  const wrongGames: number[] = [];
  const games = read.games.map((g, i) => {
    const allySide = sides[i];
    const teamIdOf = (side: Side) => (side === "A" ? teamA?.id : teamB?.id);
    // Locked to the rosters: which roster player each row is.
    const chosen = new Map<ReadGame["players"][number], RosterName | null>();
    let strangers = 0;
    if (locked) {
      for (const s of ["ally", "rival"] as const) {
        const rows = g.players.filter((p) => p.side === s);
        const team = rosterOf(s === "ally" ? allySide : flip(allySide));
        const { picks } = assignRoster(rows.map((p) => p.name), team);
        rows.forEach((p, k) => {
          if (picks[k] >= 0 && nameDistance(p.name, team[picks[k]].name) > DOUBTFUL) strangers++;
          const who = picks[k] >= 0 ? team[picks[k]] : null;
          chosen.set(p, who);
          if (!who) doubtful.push(`เกม ${i + 1}: แถว "${p.name}" เกินจำนวนคนในรายชื่อทีม ไม่ได้ใส่`);
          else if (nameDistance(p.name, who.name) > DOUBTFUL) doubtful.push(`เกม ${i + 1}: อ่านได้ "${p.name}" ใส่เป็น ${who.name}${who.uid ? ` (UID ${who.uid})` : ""}`);
        });
      }
    }
    // Most names unlike both rosters: likely a screenshot of another game.
    if (locked && strangers * 2 > g.players.length) wrongGames.push(i + 1);
    // Locked: a row no roster player is left for is dropped rather than saved as a new name.
    const rows = locked ? g.players.filter((p) => chosen.get(p)) : g.players;
    const gamePlayers = rows.map((p): DraftPlayer => {
      const side = p.side === "ally" ? allySide : flip(allySide);
      if (locked) {
        const who = chosen.get(p)!;
        return {
          playerId: who.playerId,
          name: who.name,
          uid: who.uid,
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
      }
      const key = normaliseName(p.name);
      const same = (x: (typeof players)[number]) => normaliseName(x.name) === key || (x.nickname !== null && normaliseName(x.nickname) === key);
      // A name the player used before a rename still finds them.
      const before = (x: (typeof players)[number]) => x.names.some((n) => normaliseName(n.name) === key);
      const found =
        players.find((x) => x.teamId === teamIdOf(side) && same(x)) ?? players.find(same) ??
        players.find((x) => x.teamId === teamIdOf(side) && before(x)) ?? players.find(before);
      if (!found) newPlayers.add(p.name);
      return {
        playerId: found?.id ?? null,
        name: found?.name ?? p.name,
        uid: null,
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
  if (wrongGames.length) warnings.unshift(`รูปเกม ${wrongGames.join(", ")} ชื่อผู้เล่นแทบไม่ตรงกับทั้งสองทีม อาจเป็นรูปของเกมอื่น ตรวจหรือลบเกมนั้นก่อนบันทึก`);
  if (doubtful.length) warnings.push(`ชื่อในรูปไม่ชัด ใช้ชื่อจากรายชื่อทีมแทน กรุณาตรวจ: ${doubtful.join(" · ")}`);
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
