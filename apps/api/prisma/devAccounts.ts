import type { Prisma } from "@prisma/client";
import accounts from "../../../dev-accounts.json";
import { parseRanks } from "../src/lib/games.js";
import { DEFAULT_SOLO_RANKS } from "../src/lib/solo.js";

/** Stable identities, repeatable rank fixtures, and no changes to MMR or match history. */
export async function seedDevAccounts(db: Prisma.TransactionClient) {
  const game = await db.game.upsert({
    where: { name: "Kuroko's Basketball: Street Rivals" },
    create: { name: "Kuroko's Basketball: Street Rivals" },
    update: {},
  });
  const configured = parseRanks(game.ranks);
  const ranks = new Set((configured.length ? configured : DEFAULT_SOLO_RANKS).map((r) => r.name));
  for (const account of accounts) {
    if (!ranks.has(account.rank)) throw new Error(`Test rank is not available in this game: ${account.rank}`);
  }
  for (const [index, account] of accounts.entries()) {
    const existing = await db.player.findFirst({ where: { discordId: account.id } });
    let player;
    if (existing) {
      if (existing.gameId && existing.gameId !== game.id) throw new Error(`Dev account belongs to another game: ${account.name}`);
      player = await db.player.update({ where: { id: existing.id }, data: {
        gameId: game.id, inGameRank: account.rank,
        ...(existing.role ? {} : { role: ["GUARD", "FORWARD", "CENTER"][index % 3] }),
      } });
    } else {
      if (await db.player.findUnique({ where: { id: account.playerId } })) {
        throw new Error(`Dev player id already exists: ${account.playerId}`);
      }
      player = await db.player.create({ data: {
        id: account.playerId, name: `[DEV] ${account.name}`, discordId: account.id,
        gameId: game.id, role: ["GUARD", "FORWARD", "CENTER"][index % 3], inGameRank: account.rank,
      } });
    }
    // The admin reserve draw reads ReservePlayer, not the general player directory.
    // Keep any existing signup/contact edits when reseeding.
    await db.reservePlayer.upsert({
      where: { playerId: player.id },
      create: { playerId: player.id, discordId: account.id, rank: account.rank, position: player.role },
      update: {},
    });
  }
  return accounts.length;
}
