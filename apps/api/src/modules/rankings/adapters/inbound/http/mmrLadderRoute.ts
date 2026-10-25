import type { RequestHandler } from "express";
import { z } from "zod";
import { pagination } from "../../../../../lib/validate.js";
import type { MmrLadder } from "../../../application/use-cases/playerLadder.js";

const query = pagination.extend({
  teamId: z.string().optional(),
  /** Limits the ladder to one game; without it every game is mixed (older clients). */
  gameId: z.string().trim().min(1).max(40).optional(),
});

/** GET /api/v1/rankings/mmr. A bad query is a ZodError, which the app's error handler turns into a 400. */
export function mmrLadderRoute(mmrLadder: MmrLadder): RequestHandler {
  return async (req, res) => {
    res.json(await mmrLadder(query.parse(req.query)));
  };
}
