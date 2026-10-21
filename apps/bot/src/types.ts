/** The parts of the API's responses the bot reads. */
export const STAT_KEYS = ["pts", "reb", "blk", "stl", "ast", "lbr"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Award = "MVP" | "SVP";

export interface DraftPlayer extends Record<StatKey, number> {
  playerId: string | null;
  name: string;
  /** In-game UID, when the name was taken from the tournament roster. */
  uid?: string | null;
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
  /** Position: GUARD, FORWARD, CENTER or ALL. */
  role?: string | null;
  mmr?: number;
  blacklist?: { active: boolean; penalty: number; entries: BlacklistEntry[] };
  team: TeamSummary | null;
  stats: PlayerStats;
}

// ---------- Brackets ----------

export type Format = "SINGLE_ELIMINATION" | "DOUBLE_ELIMINATION" | "ROUND_ROBIN";
export interface RosterPlayer {
  playerId: string;
  name: string;
  discordId: string | null;
  uid?: string | null;
  server?: string | null;
}
export interface Entry extends TeamSummary {
  seed: number | null;
  placement: number | null;
  captainDiscordId: string | null;
  /** Other Discord accounts of the team, let into match rooms. */
  memberDiscordIds?: string[];
  roster: RosterPlayer[];
}
export interface BracketMatch {
  id: string;
  code: string;
  number: number;
  stage: "W" | "L" | "GF" | "P3" | "RR";
  round: number;
  label: string;
  /** This match's best of (the final may differ from the other rounds). */
  bestOf?: number;
  teamA: Entry | null;
  teamB: Entry | null;
  byeA: boolean;
  byeB: boolean;
  sourceA: string | null;
  sourceB: string | null;
  status: "PENDING" | "READY" | "DONE" | "SKIPPED";
  outcome: "PLAYED" | "WALKOVER" | "BYE" | null;
  winnerId: string | null;
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
}
export interface BracketBlacklist {
  id: string;
  slotCode: string | null;
  matchNumber: number | null;
  teamName: string | null;
  penalty: number;
  reason: string;
  player: { id: string; name: string; nickname: string | null; discordId: string | null };
}

export interface BlacklistEntry {
  id: string;
  playerId: string;
  tournamentId: string | null;
  matchNumber: number | null;
  teamName: string | null;
  source: "AUTO" | "ADMIN";
  reason: string;
  penalty: number;
  createdAt: string;
  liftedAt: string | null;
  liftNote: string | null;
  player: { id: string; name: string; nickname: string | null; uid: string | null; discordId: string | null; mmr: number };
  tournament: { id: string; name: string } | null;
}

export interface Bracket {
  tournamentId: string;
  name: string;
  format: Format | null;
  status: "NONE" | "DRAFT" | "LIVE" | "DONE";
  bestOf: number;
  /** The final's best of; null = the same as the other rounds. */
  finalBestOf?: number | null;
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
  matches: BracketMatch[];
  standings: { position: number; teamId: string; played: number; wins: number; draws: number; losses: number; diff: number; points: number; team: Entry | null }[] | null;
  placements: { placement: number; team: Entry }[];
  /** Standing blacklist entries from this tournament's walkovers (one per player of the team that did not come). */
  blacklist?: BracketBlacklist[];
}

// ---------- MMR ladder, search, the player's own team and guild ----------

export interface Tier {
  key: string;
  name: string;
  nameTh: string;
  color: string;
  min: number;
  next: number | null;
}
export interface Game {
  id: string;
  name: string;
  players?: number;
}
/** One row of GET /rankings/mmr. */
export interface LadderPlayer {
  id: string;
  name: string;
  nickname: string | null;
  rank: number;
  mmr: number;
  tier: Tier;
  series: number;
  wins: number;
  losses: number;
  rankChange: number | null;
  blacklisted?: boolean;
  team: { id: string; name: string } | null;
}
export interface MmrLadder extends Page<LadderPlayer> {
  placing: { id: string; name: string; nickname: string | null; mmr: number; series: number; seriesToPlace: number }[];
  tiers: (Tier & { players: number })[];
  rules: { start: number; placementSeries: number };
}
export interface SearchResults {
  teams: { id: string; name: string; tag: string | null; rating: number }[];
  players: { id: string; name: string; nickname: string | null; team: { id: string; name: string } | null }[];
  tournaments: { id: string; name: string; status: Tournament["status"]; startDate: string }[];
}
/** One of the caller's characters, as GET /members/{discordId} returns it (the website's "my profile"). */
export interface MyCharacter {
  id: string;
  name: string;
  nickname: string | null;
  uid: string | null;
  mmr: number;
  tier: Tier;
  toNextTier: number;
  game: { id: string; name: string } | null;
  rank: number | null;
  rankedPlayers: number;
  series: number;
  seriesToPlace: number;
  team: {
    id: string;
    name: string;
    tag: string | null;
    rating: number;
    isCaptain: boolean;
    inviteCode: string | null;
    members: { id: string; name: string; nickname: string | null; mmr: number; linked: boolean; captain: boolean }[];
  } | null;
  guild: {
    id: string;
    name: string;
    tag: string | null;
    capacity: number;
    memberCount: number;
    isLeader: boolean;
    myRank: number | null;
    members: { id: string; name: string; nickname: string | null; mmr: number; guildRank: number | null; leader: boolean; linked: boolean }[];
    invites: { id: string; player: { id: string; name: string; uid: string | null; linked: boolean; inGuild: boolean } }[];
  } | null;
  guildInvites: { id: string; guild: { id: string; name: string; tag: string | null; capacity: number; memberCount: number } }[];
}
export interface GuildRow {
  id: string;
  name: string;
  tag: string | null;
  score: number | null;
  rank: number | null;
  memberCount: number;
  capacity: number;
  game: { id: string; name: string } | null;
  leader: { name: string; nickname: string | null } | null;
}
export interface GuildDetail extends GuildRow {
  description: string | null;
  guilds: number;
  full: boolean;
  members: { id: string; name: string; nickname: string | null; mmr: number; tier: Tier; guildRank: number | null; leader: boolean; mmrRank: number | null; team: { name: string } | null }[];
}
