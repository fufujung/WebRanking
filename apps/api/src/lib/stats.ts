import type { Match, MatchPlayerStat } from "@prisma/client";

type MatchResult = Pick<Match, "teamAId" | "teamBId" | "scoreA" | "scoreB" | "winnerId">;

export interface TeamStats {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  pointsFor: number;
  pointsAgainst: number;
}

export function emptyTeamStats(): TeamStats {
  return { matches: 0, wins: 0, losses: 0, draws: 0, winRate: 0, pointsFor: 0, pointsAgainst: 0 };
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

/** Win/loss/draw stats for every team appearing in the given matches. */
export function statsByTeam(matches: MatchResult[]) {
  const stats = new Map<string, TeamStats>();
  const get = (id: string) => {
    let s = stats.get(id);
    if (!s) stats.set(id, (s = emptyTeamStats()));
    return s;
  };
  for (const m of matches) {
    const a = get(m.teamAId);
    const b = get(m.teamBId);
    a.matches++;
    b.matches++;
    a.pointsFor += m.scoreA;
    a.pointsAgainst += m.scoreB;
    b.pointsFor += m.scoreB;
    b.pointsAgainst += m.scoreA;
    if (m.winnerId === null) {
      a.draws++;
      b.draws++;
    } else if (m.winnerId === m.teamAId) {
      a.wins++;
      b.losses++;
    } else {
      b.wins++;
      a.losses++;
    }
  }
  for (const s of stats.values()) s.winRate = pct(s.wins, s.matches);
  return stats;
}

export interface Standing extends TeamStats {
  teamId: string;
  points: number;
  diff: number;
}

/** League table: 3 points per win, 1 per draw; ties broken by score difference, then score for. */
export function standings(teamIds: string[], matches: MatchResult[]): Standing[] {
  const stats = statsByTeam(matches);
  const ids = new Set([...teamIds, ...stats.keys()]);
  return [...ids]
    .map((teamId) => {
      const s = stats.get(teamId) ?? emptyTeamStats();
      return { teamId, ...s, points: s.wins * 3 + s.draws, diff: s.pointsFor - s.pointsAgainst };
    })
    .sort((x, y) => y.points - x.points || y.diff - x.diff || y.pointsFor - x.pointsFor);
}

export interface PlayerStats {
  /** Series the player appeared in. */
  matches: number;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  pts: number;
  reb: number;
  blk: number;
  stl: number;
  ast: number;
  lbr: number;
  ppg: number;
  rpg: number;
  apg: number;
  avgRating: number;
  mvp: number;
  svp: number;
}

export function emptyPlayerStats(): PlayerStats {
  return {
    matches: 0, games: 0, wins: 0, losses: 0, winRate: 0,
    pts: 0, reb: 0, blk: 0, stl: 0, ast: 0, lbr: 0,
    ppg: 0, rpg: 0, apg: 0, avgRating: 0, mvp: 0, svp: 0,
  };
}

export type StatLine = Pick<MatchPlayerStat, "playerId" | "teamId" | "matchId" | "pts" | "reb" | "blk" | "stl" | "ast" | "lbr" | "rating" | "award"> & {
  game: { scoreA: number; scoreB: number };
  match: { teamAId: string };
};

/** Per-game scoreboard rows → career stats. A game is won when the player's side scored more. */
export function statsByPlayer(lines: StatLine[]) {
  const stats = new Map<string, PlayerStats & { series: Set<string>; ratingSum: number; rated: number }>();
  for (const l of lines) {
    let s = stats.get(l.playerId);
    if (!s) stats.set(l.playerId, (s = { ...emptyPlayerStats(), series: new Set(), ratingSum: 0, rated: 0 }));
    s.series.add(l.matchId);
    s.games++;
    s.pts += l.pts;
    s.reb += l.reb;
    s.blk += l.blk;
    s.stl += l.stl;
    s.ast += l.ast;
    s.lbr += l.lbr;
    if (l.rating !== null) {
      s.ratingSum += l.rating;
      s.rated++;
    }
    if (l.award === "MVP") s.mvp++;
    if (l.award === "SVP") s.svp++;
    const onA = l.teamId === l.match.teamAId;
    const own = onA ? l.game.scoreA : l.game.scoreB;
    const other = onA ? l.game.scoreB : l.game.scoreA;
    if (own > other) s.wins++;
    else if (own < other) s.losses++;
  }
  const avg = (n: number, d: number) => (d ? Math.round((n / d) * 10) / 10 : 0);
  const out = new Map<string, PlayerStats>();
  for (const [id, { series, ratingSum, rated, ...s }] of stats) {
    out.set(id, {
      ...s,
      matches: series.size,
      winRate: pct(s.wins, s.games),
      ppg: avg(s.pts, s.games),
      rpg: avg(s.reb, s.games),
      apg: avg(s.ast, s.games),
      avgRating: avg(ratingSum, rated),
    });
  }
  return out;
}

/** The select that feeds statsByPlayer. */
export const statLineSelect = {
  playerId: true, teamId: true, matchId: true,
  pts: true, reb: true, blk: true, stl: true, ast: true, lbr: true, rating: true, award: true,
  game: { select: { scoreA: true, scoreB: true } },
  match: { select: { teamAId: true } },
} as const;
