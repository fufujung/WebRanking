import { Router, type RequestHandler } from "express";
import { requireAdmin } from "../lib/apiKeys.js";
import { discordId } from "../lib/members.js";
import { cancelBet, claimDaily, COINS, createCustomMarket, deleteCustomMarket, leaderboard, predictionTournaments, placeBet, setMarketStatus, setTournamentMarketsStatus, settleCustomMarket, tournamentMarkets, wallet, watchCoins } from "../lib/predict.js";
import { addCodes, award, codePool, confirmReceived, deleteFreeCodes, deleteReward, listRewards, markNotified, unnotifiedRewards, updateReward } from "../lib/rewards.js";

/**
 * The prediction game (free coins, no money) and its prizes. Anyone with a key sees the markets and the
 * leaderboards; the website and the bot (admin key) act for a Discord account and manage prizes.
 */
export const predict = Router();

const who = (id: unknown) => discordId.parse(String(id));
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : undefined);
/** A personal view (someone's own pick) needs the admin key, like everything else about one member. */
const adminIf = (needed: (q: Record<string, unknown>) => boolean): RequestHandler => (req, res, next) => (needed(req.query) ? requireAdmin(req, res, next) : next());

predict.get("/rules", (_req, res) => {
  res.json(COINS);
});

predict.get("/tournaments", async (_req, res) => {
  res.json({ data: await predictionTournaments() });
});

predict.get(
  "/tournaments/:id",
  adminIf((q) => Boolean(q.discordId)),
  async (req, res) => {
    const id = req.query.discordId ? who(req.query.discordId) : null;
    res.json(await tournamentMarkets(String(req.params.id), id));
  },
);

predict.get("/leaderboard", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  res.json({ data: await leaderboard({ tournamentId: text(req.query.tournamentId), seasonId: text(req.query.seasonId) }, limit) });
});

// ---------- One member (website or bot, for a Discord account) ----------

predict.get("/members/:discordId", requireAdmin, async (req, res) => {
  res.json(await wallet(who(req.params.discordId)));
});
predict.post("/members/:discordId/daily", requireAdmin, async (req, res) => {
  res.json(await claimDaily(who(req.params.discordId), req.body));
});
predict.post("/members/:discordId/watch", requireAdmin, async (req, res) => {
  res.json(await watchCoins(who(req.params.discordId), req.body));
});
predict.post("/members/:discordId/bets", requireAdmin, async (req, res) => {
  res.json(await placeBet(who(req.params.discordId), req.body));
});
predict.delete("/members/:discordId/bets/:marketId", requireAdmin, async (req, res) => {
  await cancelBet(who(req.params.discordId), String(req.params.marketId));
  res.status(204).end();
});
predict.post("/members/:discordId/rewards/:id/received", requireAdmin, async (req, res) => {
  res.json(await confirmReceived(who(req.params.discordId), String(req.params.id)));
});

// ---------- Organizers ----------

predict.patch("/markets/:id", requireAdmin, async (req, res) => {
  res.json(await setMarketStatus(String(req.params.id), req.body));
});
/** Close (or open again) every market of a tournament without a result. */
predict.post("/tournaments/:id/status", requireAdmin, async (req, res) => {
  res.json(await setTournamentMarketsStatus(String(req.params.id), req.body));
});
/** A pair set up by hand ("ทีม A vs ทีม B"), for events without a bracket. */
predict.post("/tournaments/:id/markets", requireAdmin, async (req, res) => {
  res.status(201).json(await createCustomMarket(String(req.params.id), req.body));
});
predict.post("/markets/:id/settle", requireAdmin, async (req, res) => {
  res.json(await settleCustomMarket(String(req.params.id), req.body));
});
predict.delete("/markets/:id", requireAdmin, async (req, res) => {
  await deleteCustomMarket(String(req.params.id));
  res.status(204).end();
});

predict.get("/codes", requireAdmin, async (_req, res) => {
  res.json({ data: await codePool() });
});
predict.post("/codes", requireAdmin, async (req, res) => {
  res.status(201).json(await addCodes(req.body));
});
predict.delete("/codes", requireAdmin, async (req, res) => {
  const label = typeof req.query.label === "string" ? req.query.label : "";
  res.json(await deleteFreeCodes(label));
});

predict.get("/rewards", requireAdmin, async (req, res) => {
  res.json(await listRewards(req.query));
});
predict.post("/rewards", requireAdmin, async (req, res) => {
  res.status(201).json(await award(req.body));
});
/** For the bot: prizes whose winner still needs a DM. */
predict.get("/rewards/unnotified", requireAdmin, async (_req, res) => {
  res.json(await unnotifiedRewards());
});
predict.post("/rewards/:id/notified", requireAdmin, async (req, res) => {
  res.json(await markNotified(String(req.params.id)));
});
predict.patch("/rewards/:id", requireAdmin, async (req, res) => {
  res.json(await updateReward(String(req.params.id), req.body));
});
predict.delete("/rewards/:id", requireAdmin, async (req, res) => {
  await deleteReward(String(req.params.id));
  res.status(204).end();
});
