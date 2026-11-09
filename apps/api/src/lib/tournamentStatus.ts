import { prisma } from "./db.js";
import { writesHeld } from "./lifecycle.js";
import { noteAutomaticChange } from "./revision.js";
import { syncPredictions } from "./predict.js";

/** Event status follows the clock; bracket confirmation and completed events remain untouched. */
export async function refreshTournamentStatuses(now = new Date()) {
  if (writesHeld()) return 0;
  const where = { status: "UPCOMING", startDate: { lte: now }, bracketStatus: { not: "DONE" } };
  const due = await prisma.tournament.findMany({ where, select: { id: true } });
  if (!due.length) return 0;
  const result = await prisma.tournament.updateMany({ where: { ...where, id: { in: due.map((t) => t.id) } }, data: { status: "ONGOING" } });
  if (result.count) {
    noteAutomaticChange();
    for (const t of due) await syncPredictions(t.id);
  }
  return result.count;
}

export function startTournamentStatusPoller() {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || writesHeld()) return;
    busy = true;
    try { await refreshTournamentStatuses(); }
    catch (error) { console.error("Automatic tournament status update failed:", error); }
    finally { busy = false; }
  }, 1_000);
  timer.unref();
  return timer;
}
