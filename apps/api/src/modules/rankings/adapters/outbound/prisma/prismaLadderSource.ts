import type { PrismaClient } from "@prisma/client";
import type { LadderSource } from "../../../application/ports/ladderSource.js";

const teamCard = { select: { id: true, name: true, tag: true, logoUrl: true, rating: true } } as const;

/**
 * The player fields the ladder returns, named one by one (the same set it has always sent), so a column
 * added to Player later never becomes public by accident. Leaving a field out is an API change.
 */
const ladderPlayer = {
  id: true,
  name: true,
  nickname: true,
  country: true,
  role: true,
  avatarUrl: true,
  teamId: true,
  uid: true,
  server: true,
  discordId: true,
  mmr: true,
  peakMmr: true,
  specialMmr: true,
  specialPeakMmr: true,
  gameId: true,
  guildId: true,
  createdAt: true,
  updatedAt: true,
  team: teamCard,
} as const;

export function prismaLadderSource(prisma: PrismaClient): LadderSource {
  return {
    async load({ gameId, board }) {
      const [players, changes, blacklisted] = await Promise.all([
        prisma.player.findMany({ where: gameId ? { gameId } : {}, select: ladderPlayer }),
        prisma.playerMmrChange.findMany({
          where: { match: { tournament: { special: board === "special" } } },
          select: { playerId: true, delta: true, result: true, match: { select: { playedAt: true } } },
          orderBy: [{ match: { playedAt: "desc" } }, { match: { createdAt: "desc" } }],
        }),
        prisma.blacklistEntry.findMany({ where: { liftedAt: null }, select: { playerId: true }, distinct: ["playerId"] }),
      ]);
      return {
        players,
        changes: changes.map((c) => ({ playerId: c.playerId, delta: c.delta, result: c.result, playedAt: c.match.playedAt })),
        blacklistedPlayerIds: blacklisted.map((b) => b.playerId),
      };
    },
  };
}
