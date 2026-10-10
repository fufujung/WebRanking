/**
 * Pure bracket logic: building single elimination, double elimination and round robin
 * brackets, moving winners and losers along, handling byes, undoing results and
 * working out final placements. Nothing here touches the database.
 */

export const FORMATS = ["SINGLE_ELIMINATION", "DOUBLE_ELIMINATION", "ROUND_ROBIN"] as const;
export type Format = (typeof FORMATS)[number];
export type Stage = "W" | "L" | "GF" | "P3" | "RR";
export type Side = "A" | "B";
export type SlotStatus = "PENDING" | "READY" | "DONE" | "SKIPPED";
export type Outcome = "PLAYED" | "WALKOVER" | "BYE";

export interface Slot {
  code: string;
  stage: Stage;
  round: number;
  position: number;
  number: number;
  teamAId: string | null;
  teamBId: string | null;
  byeA: boolean;
  byeB: boolean;
  winnerTo: string | null;
  winnerSide: Side | null;
  loserTo: string | null;
  loserSide: Side | null;
  status: SlotStatus;
  outcome: Outcome | null;
  winnerId: string | null;
  loserId: string | null;
  scoreA: number | null;
  scoreB: number | null;
}

export interface BuildOptions {
  thirdPlaceMatch?: boolean;
  grandFinalReset?: boolean;
}

const blank = (code: string, stage: Stage, round: number, position: number): Slot => ({
  code,
  stage,
  round,
  position,
  number: 0,
  teamAId: null,
  teamBId: null,
  byeA: false,
  byeB: false,
  winnerTo: null,
  winnerSide: null,
  loserTo: null,
  loserSide: null,
  status: "PENDING",
  outcome: null,
  winnerId: null,
  loserId: null,
  scoreA: null,
  scoreB: null,
});

export const nextPow2 = (n: number) => {
  let size = 2;
  while (size < n) size *= 2;
  return size;
};

/** Standard seed order for a bracket of `size`: 1 v size, then the halves mirror, e.g. 8 → 1,8,4,5,2,7,3,6. */
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/** First-round positions for teams in seed order (best first); null = bye. Top seeds get the byes. */
export function seededPositions(teamIds: string[]): (string | null)[] {
  const size = nextPow2(teamIds.length);
  return seedOrder(size).map((s) => teamIds[s - 1] ?? null);
}

/** Checks a hand-made first-round layout. Returns a Thai problem, or null when it is usable. */
export function positionsProblem(positions: (string | null)[], teamIds: string[]): string | null {
  const size = nextPow2(teamIds.length);
  if (positions.length !== size) return `ต้องมี ${size} ช่องพอดี (${teamIds.length} ทีม)`;
  const placed = positions.filter((p): p is string => p !== null);
  if (new Set(placed).size !== placed.length) return "มีทีมซ้ำในสาย";
  const wanted = new Set(teamIds);
  if (placed.length !== wanted.size || placed.some((p) => !wanted.has(p))) return "ต้องวางทุกทีมที่สมัคร ทีมละ 1 ช่อง";
  for (let i = 0; i < size; i += 2) {
    if (positions[i] === null && positions[i + 1] === null) return `คู่ที่ ${i / 2 + 1} ไม่มีทีมทั้งสองฝั่ง ให้ย้ายทีมไปเติม`;
  }
  return null;
}

const link = (from: Slot, kind: "winner" | "loser", to: Slot, side: Side) => {
  if (kind === "winner") {
    from.winnerTo = to.code;
    from.winnerSide = side;
  } else {
    from.loserTo = to.code;
    from.loserSide = side;
  }
};

function placeFirstRound(round1: Slot[], positions: (string | null)[]) {
  round1.forEach((slot, i) => {
    const a = positions[i * 2];
    const b = positions[i * 2 + 1];
    slot.teamAId = a;
    slot.byeA = a === null;
    slot.teamBId = b;
    slot.byeB = b === null;
  });
}

function winnersBracket(positions: (string | null)[]) {
  const k = Math.log2(positions.length);
  const rounds: Slot[][] = [];
  for (let r = 1; r <= k; r++) {
    rounds.push(Array.from({ length: 2 ** (k - r) }, (_, p) => blank(`W${r}-${p}`, "W", r, p)));
  }
  for (let r = 0; r < k - 1; r++) {
    rounds[r].forEach((s, p) => link(s, "winner", rounds[r + 1][Math.floor(p / 2)], p % 2 === 0 ? "A" : "B"));
  }
  placeFirstRound(rounds[0], positions);
  return { k, rounds };
}

function singleElimination(positions: (string | null)[], opts: BuildOptions): Slot[] {
  const { k, rounds } = winnersBracket(positions);
  const slots = rounds.flat();
  if (opts.thirdPlaceMatch && k >= 2) {
    const p3 = blank("P3", "P3", k, 1);
    rounds[k - 2].forEach((s, p) => link(s, "loser", p3, p === 0 ? "A" : "B"));
    slots.push(p3);
  }
  return slots;
}

function doubleElimination(positions: (string | null)[], opts: BuildOptions): Slot[] {
  const { k, rounds: wr } = winnersBracket(positions);
  const gf1 = blank("GF1", "GF", 1, 0);
  const lr: Slot[][] = [];
  for (let j = 1; j <= k - 1; j++) {
    const count = 2 ** (k - 1 - j);
    lr.push(Array.from({ length: count }, (_, p) => blank(`L${2 * j - 1}-${p}`, "L", 2 * j - 1, p)));
    lr.push(Array.from({ length: count }, (_, p) => blank(`L${2 * j}-${p}`, "L", 2 * j, p)));
  }
  link(wr[k - 1][0], "winner", gf1, "A");
  if (k === 1) {
    link(wr[0][0], "loser", gf1, "B");
  } else {
    // Winners round 1 losers pair up in losers round 1.
    wr[0].forEach((s, p) => link(s, "loser", lr[0][Math.floor(p / 2)], p % 2 === 0 ? "A" : "B"));
    // Later winners-round losers drop into the even losers rounds, order flipped every other round to avoid quick rematches.
    for (let r = 2; r <= k; r++) {
      const target = lr[2 * (r - 1) - 1];
      const flip = r % 2 === 0;
      wr[r - 1].forEach((s, p) => link(s, "loser", target[flip ? target.length - 1 - p : p], "B"));
    }
    for (let j = 1; j <= k - 1; j++) {
      const odd = lr[2 * j - 2];
      const even = lr[2 * j - 1];
      odd.forEach((s, p) => link(s, "winner", even[p], "A"));
      if (j < k - 1) {
        const next = lr[2 * j];
        even.forEach((s, p) => link(s, "winner", next[Math.floor(p / 2)], p % 2 === 0 ? "A" : "B"));
      } else {
        link(even[0], "winner", gf1, "B");
      }
    }
  }
  const slots = [...wr.flat(), ...lr.flat(), gf1];
  if (opts.grandFinalReset !== false) slots.push(blank("GF2", "GF", 2, 0));
  return slots;
}

/** Circle method: every team meets every other once. An odd count gives one team a rest each round. */
function roundRobin(teamIds: string[]): Slot[] {
  const list: (string | null)[] = [...teamIds];
  if (list.length % 2) list.push(null);
  const n = list.length;
  const slots: Slot[] = [];
  for (let r = 0; r < n - 1; r++) {
    let position = 0;
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a === null || b === null) continue;
      // Alternate home/away so the first listed team is not always side A.
      const [x, y] = (r + i) % 2 === 0 ? [a, b] : [b, a];
      const s = blank(`R${r + 1}-${position}`, "RR", r + 1, position++);
      s.teamAId = x;
      s.teamBId = y;
      slots.push(s);
    }
    list.splice(1, 0, list.pop()!);
  }
  return slots;
}

/** Order in which matches are expected to be played; used for match numbers. */
function playOrder(s: Slot): number {
  switch (s.stage) {
    case "W":
    case "RR":
      return s.round * 2 - 1;
    case "L":
      return s.round % 2 === 1 ? s.round + 1 : s.round + 1.5;
    case "P3":
      return 1000;
    case "GF":
      return 2000 + s.round;
  }
}

/**
 * Builds a bracket. For elimination formats `seeds` are teams best first, or `positions`
 * gives a hand-made first round (pairs of slots, null = bye). Byes are already resolved.
 */
export function buildBracket(format: Format, seeds: string[], opts: BuildOptions = {}, positions?: (string | null)[]): Slot[] {
  if (seeds.length < 2) throw new Error("A bracket needs at least 2 teams");
  let slots: Slot[];
  if (format === "ROUND_ROBIN") slots = roundRobin(seeds);
  else {
    const layout = positions ?? seededPositions(seeds);
    slots = format === "SINGLE_ELIMINATION" ? singleElimination(layout, opts) : doubleElimination(layout, opts);
  }
  [...slots]
    .sort((a, b) => playOrder(a) - playOrder(b) || a.round - b.round || a.position - b.position)
    .forEach((s, i) => (s.number = i + 1));
  settle(slots);
  return slots;
}

/** First-round layout of an elimination bracket, read back from its slots. */
export function firstRoundPositions(slots: Slot[]): (string | null)[] {
  return slots
    .filter((s) => s.stage === "W" && s.round === 1)
    .sort((a, b) => a.position - b.position)
    .flatMap((s) => [s.byeA ? null : s.teamAId, s.byeB ? null : s.teamBId]);
}

const byCode = (slots: Slot[]) => new Map(slots.map((s) => [s.code, s]));

const sideFilled = (s: Slot, side: Side) => (side === "A" ? s.teamAId !== null || s.byeA : s.teamBId !== null || s.byeB);

/** Puts a team (or a bye when teamId is null) into one side of a slot. */
function fill(s: Slot, side: Side, teamId: string | null) {
  if (side === "A") {
    s.teamAId = teamId;
    s.byeA = teamId === null;
  } else {
    s.teamBId = teamId;
    s.byeB = teamId === null;
  }
}

function clearSide(s: Slot, side: Side) {
  if (side === "A") {
    s.teamAId = null;
    s.byeA = false;
  } else {
    s.teamBId = null;
    s.byeB = false;
  }
}

/** Sends a finished slot's winner and loser (or byes) on to the next slots. */
function propagate(map: Map<string, Slot>, s: Slot) {
  if (s.code === "GF1") {
    const gf2 = map.get("GF2");
    if (!gf2) return;
    if (s.winnerId !== null && s.winnerId === s.teamBId) {
      // The losers-bracket team won the first final: both teams now have one loss, play again.
      fill(gf2, "A", s.teamAId);
      fill(gf2, "B", s.teamBId);
    } else {
      gf2.status = "SKIPPED";
    }
    return;
  }
  const winnerBye = s.winnerId === null;
  if (s.winnerTo) fill(map.get(s.winnerTo)!, s.winnerSide!, winnerBye ? null : s.winnerId);
  if (s.loserTo) fill(map.get(s.loserTo)!, s.loserSide!, s.loserId);
}

/**
 * Resolves everything that follows from the current state: slots whose teams are both
 * known become READY, slots with a bye finish on their own and pass teams along.
 */
export function settle(slots: Slot[]) {
  const map = byCode(slots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of slots) {
      if (s.status !== "PENDING" || !sideFilled(s, "A") || !sideFilled(s, "B")) continue;
      changed = true;
      if (s.teamAId && s.teamBId) {
        s.status = "READY";
        continue;
      }
      // At least one bye: the other side (if any) goes through without playing.
      s.status = "DONE";
      s.outcome = "BYE";
      s.winnerId = s.teamAId ?? s.teamBId;
      s.loserId = null;
      propagate(map, s);
    }
  }
}

/** Records a result on a READY slot and moves teams on. */
export function complete(slots: Slot[], code: string, result: { winnerId: string | null; scoreA: number | null; scoreB: number | null; outcome: Outcome }) {
  const map = byCode(slots);
  const s = map.get(code);
  if (!s) throw new Error(`Unknown slot ${code}`);
  if (s.status !== "READY") throw new Error(`Slot ${code} is not ready`);
  if (result.winnerId !== null && result.winnerId !== s.teamAId && result.winnerId !== s.teamBId) throw new Error("Winner is not in this match");
  if (result.winnerId === null && s.stage !== "RR") throw new Error("Elimination matches need a winner");
  s.status = "DONE";
  s.outcome = result.outcome;
  s.winnerId = result.winnerId;
  s.loserId = result.winnerId === null ? null : result.winnerId === s.teamAId ? s.teamBId : s.teamAId;
  s.scoreA = result.scoreA;
  s.scoreB = result.scoreB;
  if (s.stage !== "RR") propagate(map, s);
  settle(slots);
}

/** Slots that received a team (or a skip) from this one. */
function downstream(map: Map<string, Slot>, s: Slot): Slot[] {
  const next = [s.winnerTo, s.loserTo].filter((c): c is string => c !== null).map((c) => map.get(c)!);
  if (s.code === "GF1" && map.has("GF2")) next.push(map.get("GF2")!);
  return next;
}

/** Played or walkover results that undoing this slot would wipe out (not counting the slot itself). */
export function affectedBy(slots: Slot[], code: string): Slot[] {
  const map = byCode(slots);
  const out = new Map<string, Slot>();
  const visit = (s: Slot) => {
    for (const d of downstream(map, s)) {
      if (d.status === "DONE" && d.outcome !== "BYE") out.set(d.code, d);
      if (d.status === "DONE" || d.status === "SKIPPED") visit(d);
    }
  };
  const start = map.get(code);
  if (start) visit(start);
  return [...out.values()].sort((a, b) => a.number - b.number);
}

/**
 * Undoes a slot's result so it can be played again. Every later slot that depended on it
 * is undone too (their teams are taken back out). Returns the codes of all undone slots
 * that had a played or walkover result, including this one.
 */
export function reopen(slots: Slot[], code: string): string[] {
  const map = byCode(slots);
  const undone: string[] = [];
  const reset = (s: Slot) => {
    if (s.outcome === "PLAYED" || s.outcome === "WALKOVER") undone.push(s.code);
    s.status = "PENDING";
    s.outcome = null;
    s.winnerId = null;
    s.loserId = null;
    s.scoreA = null;
    s.scoreB = null;
  };
  const pullBack = (s: Slot) => {
    for (const d of downstream(map, s)) {
      if (d.status === "DONE" || d.status === "SKIPPED") {
        pullBack(d);
        reset(d);
      }
      if (s.code === "GF1" && d.code === "GF2") {
        clearSide(d, "A");
        clearSide(d, "B");
        d.status = "PENDING";
        continue;
      }
      if (s.winnerTo === d.code) clearSide(d, s.winnerSide!);
      if (s.loserTo === d.code) clearSide(d, s.loserSide!);
      if (d.status === "READY") d.status = "PENDING";
    }
  };
  const s = map.get(code);
  if (!s) throw new Error(`Unknown slot ${code}`);
  if (s.status !== "DONE") return [];
  pullBack(s);
  reset(s);
  settle(slots);
  return undone;
}

export const isFinished = (slots: Slot[]) => slots.length > 0 && slots.every((s) => s.status === "DONE" || s.status === "SKIPPED");

export interface RoundRobinRow {
  teamId: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gamesFor: number;
  gamesAgainst: number;
  diff: number;
  points: number;
}

/** Round robin table: 3 points a win, 1 a draw; ties by game difference, games won, then head-to-head. */
export function roundRobinTable(slots: Slot[], teamIds: string[]): RoundRobinRow[] {
  const rows = new Map(teamIds.map((id) => [id, { teamId: id, played: 0, wins: 0, draws: 0, losses: 0, gamesFor: 0, gamesAgainst: 0, diff: 0, points: 0 }]));
  for (const s of slots) {
    if (s.stage !== "RR" || s.status !== "DONE" || !s.teamAId || !s.teamBId) continue;
    const a = rows.get(s.teamAId);
    const b = rows.get(s.teamBId);
    if (!a || !b) continue;
    a.played++;
    b.played++;
    a.gamesFor += s.scoreA ?? 0;
    a.gamesAgainst += s.scoreB ?? 0;
    b.gamesFor += s.scoreB ?? 0;
    b.gamesAgainst += s.scoreA ?? 0;
    if (s.winnerId === null) {
      a.draws++;
      b.draws++;
    } else if (s.winnerId === s.teamAId) {
      a.wins++;
      b.losses++;
    } else {
      b.wins++;
      a.losses++;
    }
  }
  const headToHead = (x: string, y: string) => {
    const m = slots.find((s) => s.stage === "RR" && s.status === "DONE" && ((s.teamAId === x && s.teamBId === y) || (s.teamAId === y && s.teamBId === x)));
    return m?.winnerId === x ? -1 : m?.winnerId === y ? 1 : 0;
  };
  return [...rows.values()]
    .map((r) => ({ ...r, diff: r.gamesFor - r.gamesAgainst, points: r.wins * 3 + r.draws }))
    .sort((x, y) => y.points - x.points || y.diff - x.diff || y.gamesFor - x.gamesFor || headToHead(x.teamId, y.teamId));
}

/**
 * Final placements once the bracket is finished: teams knocked out in the same round
 * share a placement (e.g. two teams 3rd without a third-place match).
 */
export function placements(format: Format, slots: Slot[], teamIds: string[]): Map<string, number> {
  const result = new Map<string, number>();
  if (format === "ROUND_ROBIN") {
    const table = roundRobinTable(slots, teamIds);
    table.forEach((r, i) => {
      const prev = table[i - 1];
      const tied = prev && prev.points === r.points && prev.diff === r.diff && prev.gamesFor === r.gamesFor;
      result.set(r.teamId, tied ? result.get(prev.teamId)! : i + 1);
    });
    return result;
  }
  // How far each team got: the later the elimination, the better.
  const reached = new Map<string, number>();
  const final = slots.find((s) => s.code === "GF2" && s.status === "DONE") ?? slots.find((s) => s.code === "GF1") ?? slots.find((s) => s.stage === "W" && !s.winnerTo);
  for (const s of slots) {
    if (s.status !== "DONE" || !s.loserId) continue;
    if (s.loserTo) continue; // dropped to the losers bracket / third-place match, not out yet
    let depth: number;
    if (s === final) depth = 5000;
    else if (s.stage === "W") depth = s.round * 2;
    else if (s.stage === "L") depth = s.round + 2;
    else if (s.stage === "P3") depth = 900;
    else depth = 1000 + s.round;
    if (s.code === "GF1" && slots.some((x) => x.code === "GF2" && x.status === "DONE")) continue;
    reached.set(s.loserId, depth);
  }
  const p3 = slots.find((s) => s.code === "P3" && s.status === "DONE");
  if (p3?.winnerId) reached.set(p3.winnerId, 950);
  if (final?.winnerId) reached.set(final.winnerId, 10_000);
  const ranked = [...reached.entries()].sort((a, b) => b[1] - a[1]);
  ranked.forEach(([teamId, depth], i) => {
    const firstSame = ranked.findIndex(([, d]) => d === depth);
    result.set(teamId, firstSame === i ? i + 1 : result.get(ranked[firstSame][0])!);
  });
  return result;
}

/** Thai name of a slot's round, e.g. "รอบรองชนะเลิศ" or "สายล่าง รอบ 3". */
export function roundLabel(format: Format, s: Pick<Slot, "stage" | "round">, slots: Pick<Slot, "stage" | "round">[]): string {
  const last = (stage: Stage) => Math.max(0, ...slots.filter((x) => x.stage === stage).map((x) => x.round));
  switch (s.stage) {
    case "RR":
      return `รอบ ${s.round}`;
    case "P3":
      return "ชิงอันดับ 3";
    case "GF":
      return s.round === 1 ? "แกรนด์ไฟนอล" : "แกรนด์ไฟนอล (นัดตัดสิน)";
    case "L":
      return s.round === last("L") ? "ชิงชนะเลิศสายล่าง" : `สายล่าง รอบ ${s.round}`;
    case "W": {
      const fromEnd = last("W") - s.round;
      if (format === "DOUBLE_ELIMINATION") return fromEnd === 0 ? "ชิงชนะเลิศสายบน" : `สายบน รอบ ${s.round}`;
      if (fromEnd === 0) return "รอบชิงชนะเลิศ";
      if (fromEnd === 1) return "รอบรองชนะเลิศ";
      if (fromEnd === 2) return "รอบ 8 ทีมสุดท้าย";
      return `รอบ ${s.round}`;
    }
  }
}
