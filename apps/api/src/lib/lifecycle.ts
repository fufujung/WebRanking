/**
 * Start-up state and the deploy's write gate.
 *
 * - Liveness (`/health`): the process answers. Unchanged, for anything that already polls it.
 * - Readiness (`/health/ready`): start-up work finished and the database answers with the schema this
 *   code expects. The auto-deploy waits for it before it accepts a new version.
 * - Write gate: while the auto-deploy checks a new version it creates the file named by
 *   THERANKING_WRITE_GATE. Requests that would save something get 503 until the version is accepted, so
 *   if the deploy has to roll the database back, nothing anyone saved in between is lost.
 */
import fs from "node:fs";
import type { RequestHandler } from "express";
import { prisma } from "./db.js";

type StartState = { state: "starting" } | { state: "ready" } | { state: "failed"; reason: string };
let start: StartState = { state: "starting" };

/** Runs the start-up work once; the API counts as ready only when it all succeeded. */
export async function runStartup(steps: () => Promise<void>) {
  try {
    await steps();
    start = { state: "ready" };
  } catch (e) {
    // Only the error's kind and first line: no connection strings or data in the health answer.
    const reason = e instanceof Error ? `${e.name}: ${e.message.split("\n").find((l) => l.trim()) ?? ""}`.slice(0, 200) : "unknown error";
    start = { state: "failed", reason };
    console.error("API start-up failed:", e);
  }
}

export const readiness: RequestHandler = async (_req, res) => {
  if (start.state !== "ready") return void res.status(503).json({ ok: false, ...start });
  try {
    await prisma.$queryRaw`SELECT 1`;
    // Touches the tables this code reads most, with its own column list: an older or newer schema fails here.
    await prisma.player.findFirst({ select: { id: true, mmr: true, specialMmr: true, gameId: true } });
    await prisma.match.findFirst({ select: { id: true, playedAt: true } });
    res.json({ ok: true, state: "ready" });
  } catch (e) {
    res.status(503).json({ ok: false, state: "database", reason: e instanceof Error ? e.name : "unknown error" });
  }
};

/** Test hook: back to "starting". */
export const resetStartupForTests = () => void (start = { state: "starting" });

const GATE_MAX_AGE_MS = 30 * 60_000;
let checkedAt = 0;
let gateUp = false;

/** Is the deploy holding writes right now? A gate older than 30 minutes is a leftover and is ignored. */
export function writesHeld(now = Date.now()) {
  // deploy/run.mjs passes the path; app processes started before it did (the server's first update with
  // this code) use the server's default deploy folder.
  const file = process.env.THERANKING_WRITE_GATE ?? (process.platform === "win32" && process.env.NODE_ENV === "production" ? "C:\\theranking-deploy\\WRITE_GATE" : undefined);
  if (!file) return false;
  if (now - checkedAt < 500) return gateUp;
  checkedAt = now;
  try {
    gateUp = now - fs.statSync(file).mtimeMs < GATE_MAX_AGE_MS;
  } catch {
    gateUp = false;
  }
  return gateUp;
}

/** Test hook: read the gate file again on the next check. */
export const forgetGateCheckForTests = () => void (checkedAt = 0);

// GET requests that still save something.
const writingGets = [/^\/api\/v1\/teams\/[^/]+\/invite$/];

export const writeGate: RequestHandler = (req, res, next) => {
  const writes = !["GET", "HEAD", "OPTIONS"].includes(req.method) || writingGets.some((re) => re.test(req.path));
  if (writes && writesHeld()) {
    res.setHeader("Retry-After", "15");
    return void res.status(503).json({ error: "The site is updating", details: { th: "เว็บกำลังอัปเดต ลองใหม่อีกครั้งในไม่กี่วินาที" } });
  }
  next();
};
