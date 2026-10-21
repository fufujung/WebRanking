/**
 * Lucky draws on stream. The organizer sets a keyword ("#OT500"); while the draw is open, people who type
 * it in the YouTube live chat (read every few seconds) or press the button in Discord get one entry each.
 * Then the organizer draws winners at random (crypto-random), can strike out one who did not claim and
 * draw again, and every result stays on record. Entering is free: nothing is bought.
 */
import { randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "./db.js";
import { fail, notFound } from "./errors.js";
import { discordId } from "./members.js";

const YOUTUBE = () => process.env.YOUTUBE_API_URL ?? "https://www.googleapis.com/youtube/v3";
/** YouTube says how long to wait between chat reads; never more often than this. */
const MIN_POLL_MS = 5_000;

/** The video id from a YouTube link (watch?v=, youtu.be/, /live/, /shorts/) or a bare id. */
export function videoIdOf(input: string | null | undefined): string | null {
  const v = (input ?? "").trim();
  if (!v) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    const host = url.hostname.replace(/^(www\.|m\.)/, "");
    if (host === "youtu.be") return url.pathname.slice(1, 12) || null;
    if (host === "youtube.com") {
      const id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:live|shorts|embed)\/([A-Za-z0-9_-]{11})/)?.[1];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
  } catch {
    return null;
  }
  return null;
}

const drawInput = z.object({
  title: z.string().trim().min(1).max(100),
  keyword: z.string().trim().min(1).max(40),
  prize: z.string().trim().max(200).nullish().transform((v) => v || null),
  winners: z.coerce.number().int().min(1).max(50).default(1),
  minutes: z.coerce.number().int().min(1).max(240).nullish().transform((v) => v ?? null),
  youtubeUrl: z.string().trim().max(300).nullish().transform((v) => v || null),
  allowDiscord: z.boolean().default(true),
});

const PROBLEMS: Record<string, string> = { title: "ใส่ชื่อรอบ", keyword: "ใส่คำที่ให้พิมพ์ (ไม่เกิน 40 ตัว)", winners: "จำนวนผู้โชคดี 1-50 คน", minutes: "เวลาเปิดรับ 1-240 นาที", youtubeUrl: "ลิงก์ YouTube ไม่ถูกต้อง" };

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) {
    const field = String(r.error.issues[0]?.path[0] ?? "");
    throw fail(400, "Validation failed", PROBLEMS[field] ?? "ข้อมูลไม่ถูกต้อง", { field });
  }
  return r.data;
}

function withVideo<T extends { youtubeUrl?: string | null }>(data: T) {
  if (data.youtubeUrl === undefined) return data;
  const videoId = videoIdOf(data.youtubeUrl);
  if (data.youtubeUrl && !videoId) throw fail(400, "Not a YouTube link", "ลิงก์ YouTube ไม่ถูกต้อง ใช้ลิงก์ไลฟ์ เช่น https://www.youtube.com/watch?v=…", { field: "youtubeUrl" });
  // A new video: start reading its chat from scratch.
  return { ...data, videoId, liveChatId: null, pageToken: null, nextPollAt: null, chatError: null };
}

export async function createDraw(body: unknown) {
  return prisma.luckyDraw.create({ data: withVideo(parse(drawInput, body)) });
}

export async function updateDraw(id: string, body: unknown) {
  const d = await prisma.luckyDraw.findUnique({ where: { id } });
  if (!d) throw notFound("Draw");
  const data = parse(drawInput.partial(), body);
  const same = data.youtubeUrl === undefined || videoIdOf(data.youtubeUrl) === d.videoId;
  return prisma.luckyDraw.update({ where: { id }, data: same ? { ...data, youtubeUrl: data.youtubeUrl ?? d.youtubeUrl } : withVideo(data) });
}

export async function deleteDraw(id: string) {
  if (!(await prisma.luckyDraw.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Draw");
  await prisma.luckyDraw.delete({ where: { id } });
}

const winnerOrder = [{ place: "asc" as const }];

/** Every draw, newest first, with how many entered and who won. */
export async function listDraws() {
  const draws = await prisma.luckyDraw.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { _count: { select: { entries: true } } } });
  const winners = await prisma.drawEntry.findMany({ where: { drawId: { in: draws.map((d) => d.id) }, place: { not: null } }, orderBy: winnerOrder });
  return draws.map(({ _count, pageToken: _p, liveChatId: _l, ...d }) => ({ ...d, entries: _count.entries, winnerList: winners.filter((w) => w.drawId === d.id) }));
}

/** One draw for the organizer: every entry, newest first, and the winners in order. */
export async function drawDetail(id: string) {
  await closeIfDue(id);
  const d = await prisma.luckyDraw.findUnique({ where: { id }, include: { entries: { orderBy: { createdAt: "desc" } } } });
  if (!d) throw notFound("Draw");
  const { pageToken: _p, liveChatId: _l, ...rest } = d;
  return { ...rest, winnerList: d.entries.filter((e) => e.place !== null).sort((a, b) => a.place! - b.place!) };
}

/**
 * What the stream overlay, the public page and Discord show: the count, a sample of names for the spinning
 * animation, and the winners. No ids or anything private.
 */
export async function publicDraw(id: string) {
  await closeIfDue(id);
  const d = await prisma.luckyDraw.findUnique({ where: { id } });
  if (!d) throw notFound("Draw");
  const [count, sample, winners, latest] = await Promise.all([
    prisma.drawEntry.count({ where: { drawId: id } }),
    prisma.drawEntry.findMany({ where: { drawId: id }, select: { name: true }, take: 60, orderBy: { createdAt: "desc" } }),
    prisma.drawEntry.findMany({ where: { drawId: id, place: { not: null } }, orderBy: winnerOrder, select: { name: true, avatarUrl: true, source: true, place: true, wonAt: true, voided: true } }),
    prisma.drawEntry.findMany({ where: { drawId: id }, select: { name: true, source: true }, take: 8, orderBy: { createdAt: "desc" } }),
  ]);
  return {
    id: d.id,
    title: d.title,
    keyword: d.keyword,
    prize: d.prize,
    winners: d.winners,
    status: d.status,
    allowDiscord: d.allowDiscord,
    youtube: Boolean(d.videoId),
    openedAt: d.openedAt,
    closesAt: d.closesAt,
    count,
    names: sample.map((s) => s.name),
    latest,
    winnerList: winners,
    updatedAt: d.updatedAt,
  };
}

/** Draws people can join now or just drew (for Discord's cards). */
export async function activeDraws() {
  const recent = new Date(Date.now() - 6 * 3600_000);
  const draws = await prisma.luckyDraw.findMany({ where: { OR: [{ status: "OPEN" }, { status: "CLOSED", updatedAt: { gte: recent } }] }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return Promise.all(draws.map((d) => publicDraw(d.id)));
}

async function closeIfDue(id: string, now = new Date()) {
  await prisma.luckyDraw.updateMany({ where: { id, status: "OPEN", closesAt: { lte: now } }, data: { status: "CLOSED", closedAt: now } });
}

export async function openDraw(id: string, now = new Date()) {
  const d = await prisma.luckyDraw.findUnique({ where: { id } });
  if (!d) throw notFound("Draw");
  return prisma.luckyDraw.update({
    where: { id },
    data: { status: "OPEN", openedAt: d.status === "DRAFT" || !d.openedAt ? now : d.openedAt, closesAt: d.minutes ? new Date(now.getTime() + d.minutes * 60_000) : null, closedAt: null, nextPollAt: now, chatError: null },
  });
}

export async function closeDraw(id: string, now = new Date()) {
  const d = await prisma.luckyDraw.findUnique({ where: { id } });
  if (!d) throw notFound("Draw");
  if (d.status !== "OPEN") return d;
  return prisma.luckyDraw.update({ where: { id }, data: { status: "CLOSED", closedAt: now } });
}

const entryInput = z.object({
  source: z.enum(["DISCORD", "MANUAL"]),
  externalId: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(100),
  avatarUrl: z.string().trim().url().max(500).nullish(),
});

/** One entry from Discord's button (open draws only) or typed in by the organizer. Joining twice changes nothing. */
export async function addEntry(drawId: string, body: unknown) {
  const input = parse(entryInput, body);
  await closeIfDue(drawId);
  const d = await prisma.luckyDraw.findUnique({ where: { id: drawId } });
  if (!d) throw notFound("Draw");
  if (input.source === "DISCORD") {
    if (!discordId.safeParse(input.externalId).success) throw fail(400, "Discord id", "ไม่พบบัญชี Discord");
    if (!d.allowDiscord) throw fail(409, "Discord entries are off", "รอบนี้ร่วมได้เฉพาะทางแชท YouTube");
    if (d.status !== "OPEN") throw fail(409, "The draw is not open", d.status === "DRAFT" ? "รอบนี้ยังไม่เปิดรับ" : "ปิดรับแล้ว");
  }
  const externalId = input.source === "MANUAL" ? input.name.toLowerCase() : input.externalId!;
  const existing = await prisma.drawEntry.findUnique({ where: { drawId_source_externalId: { drawId, source: input.source, externalId } } });
  if (existing) return { entry: existing, added: false };
  const entry = await prisma.drawEntry.create({ data: { drawId, source: input.source, externalId, name: input.name, avatarUrl: input.avatarUrl ?? null } });
  return { entry, added: true };
}

/** Many names at once, one per line (pasted by the organizer). */
export async function addManualEntries(drawId: string, text: unknown) {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 5000);
  let added = 0;
  for (const name of lines) if ((await addEntry(drawId, { source: "MANUAL", name: name.slice(0, 100) })).added) added++;
  return { added, skipped: lines.length - added };
}

export async function removeEntry(drawId: string, entryId: string) {
  const e = await prisma.drawEntry.findUnique({ where: { id: entryId } });
  if (!e || e.drawId !== drawId) throw notFound("Entry");
  await prisma.drawEntry.delete({ where: { id: entryId } });
}

let drawing = Promise.resolve();
/** One draw at a time, so two presses never pick the same person twice. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = drawing.then(fn, fn);
  drawing = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Picks winners at random among those who have not won yet (each entry has the same chance). By default as
 * many as the draw is set for; `count` picks more (a redraw after striking someone out).
 */
export function drawWinners(id: string, body: unknown = {}, now = new Date()) {
  const { count } = z.object({ count: z.coerce.number().int().min(1).max(50).optional() }).parse(body ?? {});
  return serial(async () => {
    await closeIfDue(id, now);
    const d = await prisma.luckyDraw.findUnique({ where: { id } });
    if (!d) throw notFound("Draw");
    if (d.status === "DRAFT") throw fail(409, "Not opened yet", "ยังไม่ได้เปิดรับ");
    // Entries close before the draw, so nobody joins while names are spinning.
    if (d.status === "OPEN") await prisma.luckyDraw.update({ where: { id }, data: { status: "CLOSED", closedAt: now } });
    const pool = await prisma.drawEntry.findMany({ where: { drawId: id, place: null }, select: { id: true } });
    const want = Math.min(count ?? d.winners, pool.length);
    if (!want) throw fail(409, "Nobody left to draw", "ไม่มีรายชื่อเหลือให้สุ่ม");
    const top = await prisma.drawEntry.aggregate({ where: { drawId: id }, _max: { place: true } });
    let place = top._max.place ?? 0;
    const picked: string[] = [];
    const left = pool.map((p) => p.id);
    for (let i = 0; i < want; i++) picked.push(left.splice(randomInt(left.length), 1)[0]);
    for (const entryId of picked) await prisma.drawEntry.update({ where: { id: entryId }, data: { place: ++place, wonAt: now } });
    return prisma.drawEntry.findMany({ where: { id: { in: picked } }, orderBy: winnerOrder });
  });
}

/** A winner who did not claim: struck out (kept on record); the organizer then draws again. */
export async function voidWinner(drawId: string, entryId: string, body: unknown) {
  const { voided } = z.object({ voided: z.boolean() }).parse(body);
  const e = await prisma.drawEntry.findUnique({ where: { id: entryId } });
  if (!e || e.drawId !== drawId || e.place === null) throw notFound("Winner");
  return prisma.drawEntry.update({ where: { id: entryId }, data: { voided } });
}

// ---------- Reading the YouTube live chat ----------

interface ChatItem {
  snippet?: { type?: string; displayMessage?: string; publishedAt?: string; textMessageDetails?: { messageText?: string } };
  authorDetails?: { channelId?: string; displayName?: string; profileImageUrl?: string; isChatOwner?: boolean; isChatModerator?: boolean };
}

async function youtube<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${YOUTUBE()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", process.env.YOUTUBE_API_KEY ?? "");
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; errors?: { reason?: string }[] } };
  if (!res.ok) {
    const reason = body.error?.errors?.[0]?.reason ?? String(res.status);
    throw Object.assign(new Error(body.error?.message ?? `YouTube ${res.status}`), { reason });
  }
  return body;
}

const CHAT_PROBLEMS: Record<string, string> = {
  quotaExceeded: "โควตา YouTube API ของวันนี้หมดแล้ว (รีเซ็ตเที่ยงคืนเวลาแปซิฟิก) ใช้ปุ่ม Discord หรือวางรายชื่อเองไปก่อน",
  liveChatEnded: "ไลฟ์จบแล้ว อ่านแชทต่อไม่ได้",
  liveChatNotFound: "ไม่พบแชทของไลฟ์นี้ (ไลฟ์ยังไม่เริ่ม หรือปิดแชทไว้)",
  liveChatDisabled: "ไลฟ์นี้ปิดแชทไว้",
  keyInvalid: "YOUTUBE_API_KEY ไม่ถูกต้อง",
  forbidden: "YouTube ไม่ให้อ่านแชทนี้ (ไลฟ์ส่วนตัว?)",
};

/** Reads new chat messages of one open draw and adds whoever typed the keyword. */
async function pollOne(d: { id: string; keyword: string; videoId: string; liveChatId: string | null; pageToken: string | null; openedAt: Date | null }, now: Date) {
  try {
    let liveChatId = d.liveChatId;
    if (!liveChatId) {
      const v = await youtube<{ items?: { liveStreamingDetails?: { activeLiveChatId?: string } }[] }>("videos", { part: "liveStreamingDetails", id: d.videoId });
      liveChatId = v.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
      if (!liveChatId) {
        await prisma.luckyDraw.update({ where: { id: d.id }, data: { chatError: "ยังไม่พบแชทสด (ไลฟ์ยังไม่เริ่ม หรือลิงก์ไม่ใช่ไลฟ์)", nextPollAt: new Date(now.getTime() + 30_000) } });
        return;
      }
    }
    const page = await youtube<{ items?: ChatItem[]; nextPageToken?: string; pollingIntervalMillis?: number }>("liveChat/messages", {
      liveChatId,
      part: "snippet,authorDetails",
      maxResults: "2000",
      ...(d.pageToken ? { pageToken: d.pageToken } : {}),
    });
    const keyword = d.keyword.toLowerCase();
    const since = d.openedAt?.getTime() ?? 0;
    for (const item of page.items ?? []) {
      const a = item.authorDetails;
      const text = item.snippet?.displayMessage ?? item.snippet?.textMessageDetails?.messageText ?? "";
      if (!a?.channelId || a.isChatOwner || a.isChatModerator) continue;
      if (!text.toLowerCase().includes(keyword)) continue;
      // Messages from before the draw opened do not count.
      if (item.snippet?.publishedAt && new Date(item.snippet.publishedAt).getTime() < since) continue;
      await prisma.drawEntry.upsert({
        where: { drawId_source_externalId: { drawId: d.id, source: "YOUTUBE", externalId: a.channelId } },
        create: { drawId: d.id, source: "YOUTUBE", externalId: a.channelId, name: (a.displayName || "ผู้ชม").slice(0, 100), avatarUrl: a.profileImageUrl ?? null },
        update: {},
      });
    }
    const wait = Math.max(page.pollingIntervalMillis ?? MIN_POLL_MS, MIN_POLL_MS);
    // Only while still open: closing in the meantime keeps it closed.
    await prisma.luckyDraw.updateMany({ where: { id: d.id, status: "OPEN" }, data: { liveChatId, pageToken: page.nextPageToken ?? d.pageToken, nextPollAt: new Date(now.getTime() + wait), chatError: null } });
  } catch (e) {
    const reason = (e as { reason?: string }).reason ?? "";
    const stop = reason === "liveChatEnded" || reason === "keyInvalid" || reason === "liveChatDisabled";
    await prisma.luckyDraw.update({
      where: { id: d.id },
      data: { chatError: CHAT_PROBLEMS[reason] ?? `อ่านแชทไม่ได้: ${(e as Error).message}`.slice(0, 300), nextPollAt: new Date(now.getTime() + (stop ? 3600_000 : reason === "quotaExceeded" ? 600_000 : 15_000)) },
    });
  }
}

/** Closes draws whose time is up and reads the chat of the open ones that are due. */
export async function pollDraws(now = new Date()) {
  await prisma.luckyDraw.updateMany({ where: { status: "OPEN", closesAt: { lte: now } }, data: { status: "CLOSED", closedAt: now } });
  const due = await prisma.luckyDraw.findMany({ where: { status: "OPEN", videoId: { not: null }, OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }] } });
  if (!due.length) return;
  if (!process.env.YOUTUBE_API_KEY) {
    await prisma.luckyDraw.updateMany({ where: { id: { in: due.map((d) => d.id) } }, data: { chatError: "ยังไม่ได้ตั้ง YOUTUBE_API_KEY ใน apps/api/.env เลยอ่านแชท YouTube ไม่ได้ (ใช้ปุ่ม Discord หรือวางรายชื่อเองได้)", nextPollAt: new Date(now.getTime() + 60_000) } });
    return;
  }
  for (const d of due) await pollOne({ ...d, videoId: d.videoId! }, now);
}

/** Started with the API: reads open draws' chats every couple of seconds (each draw at YouTube's pace). */
export function startDrawPoller() {
  let busy = false;
  return setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await pollDraws();
    } catch (e) {
      console.error("Lucky draw chat reading failed:", e);
    } finally {
      busy = false;
    }
  }, 2_000);
}
