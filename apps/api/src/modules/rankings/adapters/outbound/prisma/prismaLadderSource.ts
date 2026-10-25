import type { PrismaClient } from "@prisma/client";
import type { LadderSource } from "../../../application/ports/ladderSource.js";

const teamCard = { select: { id: true, name: true, tag: true, logoUrl: true, rating: true } } as const;

export function prismaLadderSource(prisma: PrismaClient): LadderSource {
  return {
    async load({ gameId, board }) {
      const [players, changes, blacklisted] = await Promise.all([
        prisma.player.findMany({ where: gameId ? { gameId } : {}, include: { team: teamCard } }),
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
