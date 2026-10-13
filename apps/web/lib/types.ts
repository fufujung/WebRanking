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
  gameId?: string | null;
  captainId?: string | null;
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
  gameId?: string | null;
  name: string;
  nickname: string | null;
  country: string | null;
  role: string | null;
  avatarUrl: string | null;
  teamId: string | null;
  /** In-game UID: the same player whatever name they use. */
  uid?: string | null;
  server?: string | null;
  /** Discord account that logged in on the website as this player. */
  discordId?: string | null;
  mmr?: number;
  peakMmr?: number;
  team?: TeamSummary | null;
}

/** An MMR tier, e.g. Gold: 975 up to (not including) next. */
export interface Tier {
  key: string;
  name: string;
  nameTh: string;
  color: string;
  min: number;
  next: number | null;
}

export type SeriesResult = "W" | "L" | "D";

/** Tier, recent form and rank movement for a player or team on a ladder. */
export interface Movement {
  tier: Tier;
  /** 0-100 % of the way to the next tier. */
  tierProgress: number;
  toNextTier: number;
  /** Last five series, newest first. */
  form: SeriesResult[];
  lastDelta: number | null;
  /** Places gained (+) or lost (-) this week; null = new on the ladder. */
  rankChange: number | null;
}

export interface LadderPlayer extends Player, Movement {
  rank: number;
  /** On the blacklist right now. */
  blacklisted?: boolean;
  mmr: number;
  peakMmr: number;
  /** Series played, won and lost. */
  series: number;
  wins: number;
  losses: number;
}

export interface MmrLadder extends Page<LadderPlayer> {
  placing: (Player & { mmr: number; series: number; seriesToPlace: number; tier: Tier })[];
  tiers: (Tier & { players: number })[];
  rules: { start: number; k: number; placementK: number; placementSeries: number; mvpBonus: number; svpBonus: number; movementDays: number };
}

export interface Tournament {
  id: string;
  name: string;
  game: string | null;
  gameId?: string | null;
  /** TEAM: teams sign up. SOLO: players sign up alone and are drawn into teams. */
  entryMode?: "TEAM" | "SOLO";
  teamSize?: number;
  location: string | null;
  description: string | null;
  status: Status;
  startDate: string;
  endDate: string | null;
  teamCount?: number;
  matchCount?: number;
  format: Format | null;
  bestOf: number;
  finalBestOf: number | null;
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
  /** Other Discord accounts of the team, let into match rooms. */
  memberDiscordIds?: string[];
  registeredAt: string;
  roster: { playerId: string; name: string; discordId: string | null; uid?: string | null; server?: string | null }[];
}

export interface BracketSlot {
  id: string;
  code: string;
  number: number;
  stage: "W" | "L" | "GF" | "P3" | "RR";
  round: number;
  position: number;
  label: string;
  bestOf: number;
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
  finalBestOf: number | null;
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
  /** Where the result came from, e.g. "discord"; null when typed in on the website. */
  source?: string | null;
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
  sourceRef: string | null;
  games: MatchGame[];
  players: SeriesTotals[];
}

export interface TeamDetail extends Team, Movement {
  rank: number;
  game?: { id: string; name: string } | null;
  stats: TeamStats;
  players: (Player & { mmr: number; tier: Tier; stats: PlayerStats })[];
  tournaments: { placement: number | null; tournament: Tournament }[];
  recentMatches: Match[];
}

export interface BlacklistEntry {
  id: string;
  playerId: string;
  tournamentId: string | null;
  slotCode: string | null;
  matchNumber: number | null;
  teamName: string | null;
  source: "AUTO" | "ADMIN";
  reason: string;
  penalty: number;
  createdAt: string;
  liftedAt: string | null;
  liftNote: string | null;
  player: { id: string; name: string; nickname: string | null; avatarUrl: string | null; uid: string | null; server: string | null; discordId: string | null; mmr: number };
  tournament: { id: string; name: string } | null;
}

export interface PlayerBlacklist {
  active: boolean;
  penalty: number;
  entries: BlacklistEntry[];
}

export interface PlayerDetail extends Player {
  blacklist?: PlayerBlacklist;
  guild?: GuildSummary | null;
  mmr: number;
  peakMmr: number;
  tier: Tier;
  tierProgress: number;
  toNextTier: number;
  series: number;
  placed: boolean;
  seriesToPlace: number;
  /** The game this character plays; the rank below is within it. */
  game?: { id: string; name: string } | null;
  gameId?: string | null;
  /** Place on the MMR ladder; null while placing. */
  mmrRank: number | null;
  rankedPlayers: number;
  rankChange: number | null;
  /** Names used before, newest first. */
  names: { name: string; firstSeen: string; lastSeen: string }[];
  /** Oldest first, one point per series. */
  mmrHistory: { match: Match; before: number; delta: number; after: number; result: SeriesResult }[];
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
  topPlayers: LadderPlayer[];
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

/** GET /stats/admin: everything the admin dashboard shows. */
export interface AdminDashboard {
  totals: { teams: number; players: number; tournaments: number; matches: number; ongoingTournaments: number; rankedPlayers: number; placingPlayers: number };
  week: { matches: number; prevMatches: number | null; newPlayers: number; newTeams: number; matchesToday: number };
  days: { date: string; matches: number; games: number; newPlayers: number; newTeams: number }[];
  tiers: (Tier & { players: number })[];
  topPlayers: LadderPlayer[];
  todo: {
    playersWithoutUid: number;
    teamsWithoutLogo: number;
    playersWithoutTeam: number;
    readyMatches: { tournamentId: string; name: string; count: number }[];
    disputes: { id: string; number: number; tournamentId: string; name: string }[];
    openRegistration: { id: string; name: string; teams: number; maxTeams: number | null }[];
  };
}

export type AdPlacement = "banner" | "card" | "popup";

export interface Ad {
  id: string;
  title: string;
  placement: AdPlacement;
  imageUrl: string;
  mobileImageUrl: string | null;
  linkUrl: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  clicks: number;
  createdAt: string;
}

export interface GameRank {
  name: string;
  iconUrl: string | null;
}

export interface Game {
  id: string;
  name: string;
  /** In-game ranks, lowest first. */
  ranks?: GameRank[];
  players?: number;
  teams?: number;
  tournaments?: number;
}

export interface TeamMember {
  id: string;
  name: string;
  nickname: string | null;
  avatarUrl: string | null;
  mmr: number;
  linked: boolean;
  captain: boolean;
}

/** One of the logged-in player's characters, with its game, rank in that game and team. */
export interface MyCharacter extends Omit<Player, "team"> {
  mmr: number;
  tier: Tier;
  game: { id: string; name: string } | null;
  rank: number | null;
  rankedPlayers: number;
  series: number;
  seriesToPlace: number;
  team: {
    id: string;
    name: string;
    tag: string | null;
    logoUrl: string | null;
    rating: number;
    captainId: string | null;
    isCaptain: boolean;
    inviteCode: string | null;
    members: TeamMember[];
  } | null;
  guild: MyGuild | null;
  guildInvites: GuildInviteReceived[];
}

export interface GuildSummary {
  id: string;
  name: string;
  tag: string | null;
  logoUrl: string | null;
}

/** A member as the guild shows them: guildRank is their place inside the guild by MMR (null until they play). */
export interface GuildMember {
  id: string;
  name: string;
  nickname: string | null;
  avatarUrl: string | null;
  role: string | null;
  mmr: number;
  tier: Tier;
  series: number;
  linked: boolean;
  leader: boolean;
  guildRank: number | null;
}

export interface Guild extends GuildSummary {
  description: string | null;
  gameId: string | null;
  game: { id: string; name: string } | null;
  leaderId: string | null;
  capacity: number;
  memberCount: number;
  createdAt: string;
}

/** Guilds rank by score: the average MMR of their best 5 members who have played (null until someone plays). */
export interface GuildStanding {
  score: number | null;
  rank: number | null;
}

export interface GuildListItem extends Guild, GuildStanding {
  leader: Pick<GuildMember, "id" | "name" | "nickname" | "avatarUrl" | "mmr" | "tier"> | null;
  top: Pick<GuildMember, "id" | "name" | "nickname" | "avatarUrl" | "mmr" | "tier"> | null;
}

export interface GuildDetail extends Guild, GuildStanding {
  /** How many guilds the rank is out of. */
  guilds: number;
  full: boolean;
  leader: (GuildMember & { team: TeamSummary | null; mmrRank: number | null }) | null;
  top: (GuildMember & { team: TeamSummary | null; mmrRank: number | null }) | null;
  members: (GuildMember & { team: Omit<TeamSummary, "rating"> | null; mmrRank: number | null })[];
}

export interface MyGuild extends GuildSummary {
  description: string | null;
  capacity: number;
  leaderId: string | null;
  memberCount: number;
  isLeader: boolean;
  myRank: number | null;
  members: GuildMember[];
  invites: { id: string; createdAt: string; player: { id: string; name: string; uid: string | null; server: string | null; linked: boolean; inGuild: boolean } }[];
}

export interface GuildInviteReceived {
  id: string;
  createdAt: string;
  guild: GuildSummary & { capacity: number; memberCount: number };
}

export interface InviteInfo {
  id: string;
  name: string;
  tag: string | null;
  logoUrl: string | null;
  rating: number;
  game: { id: string; name: string } | null;
  memberCount: number;
  full: boolean;
}

export type SoloPosition = "GUARD" | "FORWARD" | "CENTER" | "ALL";

export interface SoloSignup {
  playerId: string;
  name: string;
  nickname: string | null;
  avatarUrl: string | null;
  uid: string | null;
  server: string | null;
  mmr: number;
  discordId: string | null;
  position: SoloPosition;
  rank: string;
  signedUpAt: string;
}

export interface SoloView {
  entryMode: "TEAM" | "SOLO";
  teamSize: number;
  ranks: GameRank[];
  registrationOpen: boolean;
  drawn: boolean;
  signups: SoloSignup[];
}

export interface SoloDraw {
  teams: { players: SoloSignup[]; rankTotal: number; mmrAverage: number; positionsOk: boolean }[];
  reserves: SoloSignup[];
}
