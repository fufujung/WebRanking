import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { notFound } from "../lib/errors.js";
import { emptyPlayerStats, statLineSelect, statsByPlayer } from "../lib/stats.js";
import { mergeInput, playerInput, searchQuery } from "../lib/validate.js";
import { requireAdmin } from "../lib/apiKeys.js";
import { gameSummary, matchInclude, teamSummary } from "../lib/selects.js";
import { assertUidFree, findByUid, mergePlayers, playerSearch, renamePlayer } from "../lib/players.js";
import { recomputeRatings } from "../lib/elo.js";
import { gameIdOrNull } from "../lib/games.js";
import { playerBoard, tierInfo } from "../lib/leaderboard.js";
import { PLACEMENT_SERIES } from "../lib/mmr.js";
import { claimByUid, claimInput, discordId, playersOfDiscord, unlinkDiscord } from "../lib/members.js";

export const players = Router();

players.get("/", async (req, res) => {
  const q = searchQuery.extend({ teamId: z.string().optional() }).parse(req.query);
  const where = {
    ...(q.teamId ? { teamId: q.teamId } : {}),
    ...(q.search ? playerSearch(q.search) : {}),
  };
  const [data, total] = await Promise.all([
    prisma.player.findMany({ where, orderBy: { name: "asc" }, take: q.limit, skip: q.offset, include: { team: teamSummary } }),
    prisma.player.count({ where }),
  ]);
  res.json({ data, total, limit: q.limit, offset: q.offset });
});

players.post("/", requireAdmin, async (req, res) => {
  const input = playerInput.parse(req.body);
  if (input.gameId !== undefined) input.gameId = await gameIdOrNull(prisma, input.gameId);
  const player = await prisma.$transaction(async (tx) => {
    await assertUidFree(tx, input.uid, input.server);
    return tx.player.create({ data: input, include: { team: teamSummary } });
  });
  res.status(201).json(player);
});

/** Looks a player up by in-game UID (add ?server= when the same UID exists on several servers). */
players.get("/uid/:uid", async (req, res) => {
  const server = typeof req.query.server === "string" ? req.query.server : null;
  const found = await findByUid(prisma, String(req.params.uid), server);
  if (!found) throw notFound("Player");
  res.json(await playerDetail(found.id));
});

/** Players a Discord account plays as (for "Log in with Discord" on the website). */
players.get("/discord/:discordId", requireAdmin, async (req, res) => {
  res.json({ data: await playersOfDiscord(discordId.parse(req.params.discordId)) });
});

/** Links the player with this UID to the Discord account, or creates the player when nobody has the UID. */
players.post("/discord/:discordId/claim", requireAdmin, async (req, res) => {
  const { player, created } = await claimByUid(discordId.parse(req.params.discordId), claimInput.parse(req.body));
  res.status(created ? 201 : 200).json(player);
});

/** Removes the Discord link from a player. */
players.delete("/:id/discord", requireAdmin, async (req, res) => {
  res.json(await unlinkDiscord(String(req.params.id)));
});

players.get("/:id", async (req, res) => {
  res.json(await playerDetail(String(req.params.id)));
});

async function playerDetail(id: string) {
  const player = await prisma.player.findUnique({
    where: { id },
    include: { team: teamSummary, game: gameSummary, guild: { select: { id: true, name: true, tag: true, logoUrl: true } }, names: { orderBy: { lastSeen: "desc" }, select: { name: true, firstSeen: true, lastSeen: true } } },
  });
  if (!player) throw notFound("Player");
  const [lines, history, board] = await Promise.all([
    prisma.matchPlayerStat.findMany({
      where: { playerId: player.id },
      select: {
        ...statLineSelect,
        game: { select: { number: true, scoreA: true, scoreB: true } },
        match: { include: matchInclude },
        team: teamSummary,
      },
      orderBy: [{ match: { playedAt: "desc" } }, { match: { createdAt: "desc" } }, { game: { number: "asc" } }],
    }),
    prisma.playerMmrChange.findMany({
      where: { playerId: player.id },
      select: { before: true, delta: true, result: true, match: { include: matchInclude } },
      orderBy: [{ match: { playedAt: "asc" } }, { match: { createdAt: "asc" } }],
    }),
    playerBoard(player.gameId),
  ]);
  const onBoard = board.ranked.find((p) => p.id === player.id);
  return {
    ...player,
    ...tierInfo(player.mmr),
    series: history.length,
    placed: history.length >= PLACEMENT_SERIES,
    seriesToPlace: Math.max(0, PLACEMENT_SERIES - history.length),
    mmrRank: onBoard?.rank ?? null,
    rankedPlayers: board.ranked.length,
    rankChange: onBoard?.rankChange ?? null,
    /** Oldest first, one point per series. */
    mmrHistory: history.map(({ match, before, delta, result }) => ({ match, before, delta, after: before + delta, result })),
    stats: statsByPlayer(lines).get(player.id) ?? emptyPlayerStats(),
    recentGames: lines.slice(0, 30).map(({ match, team, game, pts, reb, blk, stl, ast, lbr, rating, award }) => ({
      match,
      game,
      team,
      pts, reb, blk, stl, ast, lbr, rating, award,
    })),
  };
}

players.patch("/:id", requireAdmin, async (req, res) => {
  const input = playerInput.partial().parse(req.body);
  if (input.gameId !== undefined) input.gameId = await gameIdOrNull(prisma, input.gameId);
  const id = String(req.params.id);
  const player = await prisma.$transaction(async (tx) => {
    const current = await tx.player.findUnique({ where: { id } });
    if (!current) throw notFound("Player");
    const uid = input.uid !== undefined ? input.uid : current.uid;
    const server = input.server !== undefined ? input.server : current.server;
    if (uid && (uid !== current.uid || server !== current.server)) await assertUidFree(tx, uid, server, id);
    const { name, ...rest } = input;
    if (name !== undefined) await renamePlayer(tx, current, name);
    return tx.player.update({ where: { id }, data: rest, include: { team: teamSummary } });
  });
  res.json(player);
});

/** Merges a duplicate into this player: one person whose stats were split across two records. */
players.post("/:id/merge", requireAdmin, async (req, res) => {
  const { fromId } = mergeInput.parse(req.body);
  await mergePlayers(String(req.params.id), fromId);
  res.json(await playerDetail(String(req.params.id)));
});

players.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.player.delete({ where: { id: String(req.params.id) } });
  // Their scoreboard lines are gone, which changes the MMR of everyone they played with or against.
  await recomputeRatings();
  res.status(204).end();
});
