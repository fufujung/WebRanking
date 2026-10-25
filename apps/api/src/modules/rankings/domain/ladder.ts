/**
 * The player MMR ladder, worked out from plain data: who is ranked, who is still placing, recent form,
 * the change from the latest series and how many places each player moved over the last week.
 */
import { PLACEMENT_SERIES, type SeriesResult } from "./rules.js";
import { tierInfo } from "./tiers.js";

/** Rank movement is measured against this many days ago. */
export const MOVEMENT_DAYS = 7;
export const FORM_LENGTH = 5;

/** Competition ranking: equal values share a rank (1, 2, 2, 4 …). */
export function withRanks<T>(rows: T[], value: (row: T) => number) {
  let rank = 0;
  return rows.map((row, i) => {
    if (i === 0 || value(row) !== value(rows[i - 1])) rank = i + 1;
    return { rank, ...row };
  });
}

/** Rank of every row by value, keyed by id. */
export function rankMap<T extends { id: string }>(rows: T[], value: (row: T) => number) {
  const sorted = [...rows].sort((a, b) => value(b) - value(a));
  return new Map(withRanks(sorted, value).map((r) => [r.id, r.rank]));
}

/** What a ladder row needs from a player; any other fields are carried through to the row unchanged. */
export interface LadderPlayer {
  id: string;
  name: string;
  mmr: number;
}

/** One MMR change, newest first in the list given to buildLadder. */
export interface LadderChange {
  playerId: string;
  delta: number;
  result: string;
  playedAt: Date;
}

export function buildLadder<P extends LadderPlayer>(input: {
  players: P[];
  changes: LadderChange[];
  blacklisted: Iterable<string>;
  now: Date;
}) {
  const since = new Date(input.now.getTime() - MOVEMENT_DAYS * 86400_000);
  const banned = new Set(input.blacklisted);
  const empty = () => ({ series: 0, wins: 0, losses: 0, seriesBefore: 0, recentDelta: 0, form: [] as SeriesResult[], lastDelta: null as number | null });
  const info = new Map<string, ReturnType<typeof empty>>();
  for (const c of input.changes) {
    let i = info.get(c.playerId);
    if (!i) info.set(c.playerId, (i = empty()));
    i.series++;
    if (c.result === "W") i.wins++;
    if (c.result === "L") i.losses++;
    if (i.lastDelta === null) i.lastDelta = c.delta;
    if (i.form.length < FORM_LENGTH) i.form.push(c.result as SeriesResult);
    if (c.playedAt >= since) i.recentDelta += c.delta;
    else i.seriesBefore++;
  }
  const rows = input.players.map((p) => {
    const i = info.get(p.id) ?? empty();
    return {
      ...p,
      ...tierInfo(p.mmr),
      blacklisted: banned.has(p.id),
      series: i.series,
      wins: i.wins,
      losses: i.losses,
      placed: i.series >= PLACEMENT_SERIES,
      form: i.form,
      lastDelta: i.lastDelta,
      weekAgo: { mmr: p.mmr - i.recentDelta, placed: i.seriesBefore >= PLACEMENT_SERIES },
    };
  });
  const rankedNow = rows.filter((r) => r.placed);
  const nowRanks = rankMap(rankedNow, (r) => r.mmr);
  const thenRanks = rankMap(rows.filter((r) => r.weekAgo.placed), (r) => r.weekAgo.mmr);
  const order = (a: (typeof rows)[number], b: (typeof rows)[number]) => b.mmr - a.mmr || b.series - a.series || a.name.localeCompare(b.name);
  const ranked = withRanks(rankedNow.sort(order), (r) => r.mmr).map(({ weekAgo, ...r }) => {
    const before = thenRanks.get(r.id);
    return { ...r, rankChange: before === undefined ? null : before - nowRanks.get(r.id)! };
  });
  const placing = rows
    .filter((r) => !r.placed && r.series > 0)
    .sort(order)
    .map(({ weekAgo, ...r }) => ({ ...r, seriesToPlace: PLACEMENT_SERIES - r.series }));
  return { ranked, placing, unplayed: rows.filter((r) => r.series === 0).length };
}
