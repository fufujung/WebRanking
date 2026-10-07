/** The parts of the API's responses the bot reads. */
export const STAT_KEYS = ["pts", "reb", "blk", "stl", "ast", "lbr"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Award = "MVP" | "SVP";

export interface DraftPlayer extends Record<StatKey, number> {
  playerId: string | null;
  name: string;
  side: "A" | "B";
  rating: number | null;
  award: Award | null;
}
export interface Draft {
  teamAId: string | null;
  teamAName: string;
  teamBId: string | null;
  teamBName: string;
  scoreA: number;
  scoreB: number;
  games: { scoreA: number; scoreB: number; imageUrl: string | null; players: DraftPlayer[] }[];
  warnings: string[];
  notes: string;
}

export interface TeamSummary {
  id: string;
  name: string;
  tag: string | null;
  logoUrl: string | null;
  rating: number;
}
export interface Match {
  id: string;
  scoreA: number;
  scoreB: number;
  winnerId: string | null;
  ratingDeltaA: number;
  ratingDeltaB: number;
  round: string | null;
  playedAt: string;
  createdAt?: string;
  teamA: TeamSummary;
  teamB: TeamSummary;
  tournament: { id: string; name: string };
}
export interface MatchDetail extends Match {
  games: { number: number; scoreA: number; scoreB: number; playerStats: { teamId: string; pts: number; award: Award | null; player: { name: string } }[] }[];
}
export interface Tournament {
  id: string;
  name: string;
  status: "UPCOMING" | "ONGOING" | "COMPLETED";
  startDate: string;
}
export interface PlayerStats extends Record<StatKey, number> {
  matches: number;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  ppg: number;
  rpg: number;
  apg: number;
  avgRating: number;
  mvp: number;
  svp: number;
}
export interface TeamStats {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  titles?: number;
}
export interface Page<T> {
  data: T[];
  total: number;
}
export type RankedTeam = TeamSummary & { rank: number; stats: TeamStats };
export type RankedPlayer = { id: string; name: string; rank: number; team: TeamSummary | null; stats: PlayerStats };
export interface TeamDetail extends TeamSummary {
  rank: number;
  country: string | null;
  stats: TeamStats;
  players: { id: string; name: string; stats: PlayerStats }[];
  recentMatches: Match[];
}
export interface PlayerDetail {
  id: string;
  name: string;
  nickname: string | null;
  team: TeamSummary | null;
  stats: PlayerStats;
}
