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
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  kda: number;
  avgScore: number;
}

export function emptyPlayerStats(): PlayerStats {
  return {
    matches: 0, wins: 0, losses: 0, draws: 0, winRate: 0,
    kills: 0, deaths: 0, assists: 0, score: 0, kda: 0, avgScore: 0,
  };
}

/** Aggregates per-match stat lines into career stats. Win/loss is judged by the team the player played for in that match. */
export function statsByPlayer(
  lines: (Pick<MatchPlayerStat, "playerId" | "teamId" | "kills" | "deaths" | "assists" | "score"> & {
    match: Pick<Match, "winnerId">;
  })[],
) {
  const stats = new Map<string, PlayerStats>();
  for (const l of lines) {
    let s = stats.get(l.playerId);
    if (!s) stats.set(l.playerId, (s = emptyPlayerStats()));
    s.matches++;
    s.kills += l.kills;
    s.deaths += l.deaths;
    s.assists += l.assists;
    s.score += l.score;
    if (l.match.winnerId === null) s.draws++;
    else if (l.match.winnerId === l.teamId) s.wins++;
    else s.losses++;
  }
  for (const s of stats.values()) {
    s.winRate = pct(s.wins, s.matches);
    s.kda = Math.round(((s.kills + s.assists) / Math.max(1, s.deaths)) * 100) / 100;
    s.avgScore = s.matches ? Math.round((s.score / s.matches) * 10) / 10 : 0;
  }
  return stats;
}
