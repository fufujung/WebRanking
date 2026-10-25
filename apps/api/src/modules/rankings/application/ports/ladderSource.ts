/** What the ladder use cases read. The Prisma adapter is one implementation; tests use an in-memory one. */

/** A player as the ladder shows it (the public player fields plus a short team card). */
export interface LadderPlayerRecord {
  id: string;
  name: string;
  nickname: string | null;
  country: string | null;
  role: string | null;
  avatarUrl: string | null;
  teamId: string | null;
  uid: string | null;
  server: string | null;
  discordId: string | null;
  mmr: number;
  peakMmr: number;
  specialMmr: number;
  specialPeakMmr: number;
  gameId: string | null;
  guildId: string | null;
  createdAt: Date;
  updatedAt: Date;
  team: { id: string; name: string; tag: string | null; logoUrl: string | null; rating: number } | null;
}

export interface LadderMmrChange {
  playerId: string;
  delta: number;
  result: string;
  playedAt: Date;
}

/** main = the normal ranking; special = the separate rating of the special events. */
export type LadderBoard = "main" | "special";

export interface LadderSource {
  /**
   * Everything one ladder needs: the players (one game, or all when gameId is empty), every MMR change of
   * that board newest first (by when the series was played, then when it was recorded), and the ids of
   * players with an active blacklist entry.
   */
  load(query: { gameId?: string | null; board: LadderBoard }): Promise<{
    players: LadderPlayerRecord[];
    changes: LadderMmrChange[];
    blacklistedPlayerIds: string[];
  }>;
}
