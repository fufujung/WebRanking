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

export interface StatLine {
  id: string;
  playerId: string;
  teamId: string;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  player: Pick<Player, "id" | "name" | "nickname" | "avatarUrl" | "teamId">;
}

export interface MatchDetail extends Match {
  playerStats: StatLine[];
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
  recentMatches: { match: Match; team: TeamSummary; kills: number; deaths: number; assists: number; score: number }[];
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
  teams: (TeamSummary & { placement: number | null })[];
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
