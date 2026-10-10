export type Status = "UPCOMING" | "ONGOING" | "COMPLETED";

export interface Page<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface TeamSummary {
  id: string;
  name: string;
  tag: string | null;
  logoUrl: string | null;
  rating: number;
}

export interface Team extends TeamSummary {
  country: string | null;
  playerCount?: number;
}

export interface TeamStats {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  pointsFor: number;
  pointsAgainst: number;
  titles?: number;
  tournaments?: number;
  podiums?: number;
}

export interface PlayerStats {
  /** Series played. */
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

export type Award = "MVP" | "SVP";

/** The six numbers on the in-game scoreboard. */
export const STAT_KEYS = ["pts", "reb", "blk", "stl", "ast", "lbr"] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export interface Player {
  id: string;
  name: string;
  nickname: string | null;
  country: string | null;
  role: string | null;
  avatarUrl: string | null;
  teamId: string | null;
  team?: TeamSummary | null;
}

export interface Tournament {
  id: string;
  name: string;
  game: string | null;
  location: string | null;
  description: string | null;
  status: Status;
  startDate: string;
  endDate: string | null;
  teamCount?: number;
  matchCount?: number;
  format: Format | null;
  bestOf: number;
  lateMinutes: number;
  rosterMin: number;
  rosterMax: number;
  maxTeams: number | null;
  registrationOpen: boolean;
  thirdPlaceMatch: boolean;
  grandFinalReset: boolean;
  bracketStatus: BracketStatus;
}

export type Format = "SINGLE_ELIMINATION" | "DOUBLE_ELIMINATION" | "ROUND_ROBIN";
export type BracketStatus = "NONE" | "DRAFT" | "LIVE" | "DONE";

/** A team in a tournament, with the players it registered. */
export interface Entry extends TeamSummary {
  seed: number | null;
  placement: number | null;
  captainDiscordId: string | null;
  registeredAt: string;
  roster: { playerId: string; name: string; discordId: string | null }[];
}

export interface BracketSlot {
  id: string;
  code: string;
  number: number;
  stage: "W" | "L" | "GF" | "P3" | "RR";
  round: number;
  position: number;
  label: string;
  teamA: Entry | null;
  teamB: Entry | null;
  byeA: boolean;
  byeB: boolean;
  sourceA: string | null;
  sourceB: string | null;
  status: "PENDING" | "READY" | "DONE" | "SKIPPED";
  outcome: "PLAYED" | "WALKOVER" | "BYE" | null;
  winnerId: string | null;
  loserId: string | null;
  scoreA: number | null;
  scoreB: number | null;
  matchId: string | null;
  scheduledAt: string | null;
  deadline: string | null;
  checkInA: string | null;
  checkInB: string | null;
  disputed: boolean;
  disputeNote: string | null;
  winnerTo: string | null;
  loserTo: string | null;
  completedAt: string | null;
}

export interface Bracket {
  tournamentId: string;
  name: string;
  format: Format | null;
  status: BracketStatus;
  bestOf: number;
  lateMinutes: number;
  rosterMin: number;
  rosterMax: number;
  maxTeams: number | null;
  registrationOpen: boolean;
  startDate: string;
  rosterLocked: boolean;
  rosterLockAt: string | null;
  teams: Entry[];
  positions: (string | null)[] | null;
  matches: BracketSlot[];
  standings: { position: number; teamId: string; played: number; wins: number; draws: number; losses: number; gamesFor: number; gamesAgainst: number; diff: number; points: number; team: Entry | null }[] | null;
  placements: { placement: number; team: Entry }[];
}

export interface Match {
  id: string;
  tournamentId: string;
  round: string | null;
  teamAId: string;
  teamBId: string;
  scoreA: number;
  scoreB: number;
  winnerId: string | null;
  ratingDeltaA: number;
  ratingDeltaB: number;
  imageUrl: string | null;
  notes: string | null;
  playedAt: string;
  teamA: TeamSummary;
  teamB: TeamSummary;
  tournament: { id: string; name: string };
}

export interface StatLine extends Record<StatKey, number> {
  id: string;
  playerId: string;
  teamId: string;
  rating: number | null;
  award: Award | null;
  player: Pick<Player, "id" | "name" | "nickname" | "avatarUrl" | "teamId">;
}

export interface MatchGame {
  id: string;
  number: number;
  scoreA: number;
  scoreB: number;
  imageUrl: string | null;
  playerStats: StatLine[];
}

export interface SeriesTotals extends Record<StatKey, number> {
  player: StatLine["player"];
  teamId: string;
  games: number;
  mvp: number;
  svp: number;
  avgRating: number | null;
}

export interface MatchDetail extends Match {
  /** The bracket match this series decides, if any. */
  bracketSlot: { id: string; code: string; number: number } | null;
  source: string | null;
  sourceRef: string | null;
  games: MatchGame[];
  players: SeriesTotals[];
}

export interface TeamDetail extends Team {
  rank: number;
  stats: TeamStats;
  players: (Player & { stats: PlayerStats })[];
  tournaments: { placement: number | null; tournament: Tournament }[];
  recentMatches: Match[];
}

export interface PlayerDetail extends Player {
  stats: PlayerStats;
  recentGames: ({ match: Match; game: { number: number; scoreA: number; scoreB: number }; team: TeamSummary; rating: number | null; award: Award | null } & Record<StatKey, number>)[];
}

export interface Standing extends TeamStats {
  position: number;
  teamId: string;
  points: number;
  diff: number;
  placement: number | null;
  team: TeamSummary | null;
}

export interface TournamentDetail extends Tournament {
  teams: Entry[];
  standings: Standing[];
  matches: Match[];
}

export interface Overview {
  totals: { teams: number; players: number; tournaments: number; matches: number; ongoingTournaments: number };
  topTeams: Team[];
  recentMatches: Match[];
  upcomingTournaments: Tournament[];
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  scope: "read" | "admin";
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
