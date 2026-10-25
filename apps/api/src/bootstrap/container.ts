/**
 * Composition root: the one place the API's modules are built and given their dependencies.
 * Code still in routes/ and lib/ reaches a module through the objects created here.
 */
import { prisma } from "../lib/db.js";
import { createRankingsModule } from "../modules/rankings/index.js";

export const rankingsModule = createRankingsModule({ prisma });
