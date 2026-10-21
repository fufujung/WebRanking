/**
 * Prizes for the best predictors. Organizers paste single-use shop codes into a pool (grouped by a label
 * such as "ส่วนลด 50 บาท") and hand them to the top of a tournament or season leaderboard; gear and other
 * items are tracked by hand (pending, sent, received). Winners see their codes on their own page and the
 * Discord bot sends them a DM. Prizes go by rank only, never by a random draw.
 */
import { z } from "zod";
import { prisma } from "./db.js";
import { fail, notFound } from "./errors.js";
import { leaderboard } from "./predict.js";

const noControl = /^[^\u0000-\u001f\u007f]*$/;
const label = z.string().trim().min(1).max(60).regex(noControl);

export const codesInput = z.object({ label, text: z.string().max(50_000) });

/** Codes are one per line (or separated by commas or spaces). Duplicates, already known codes and odd tokens are reported. */
export async function addCodes(body: unknown) {
  const { label: name, text } = codesInput.parse(body);
  const tokens = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!tokens.length) throw fail(400, "No codes", "วางโค้ดอย่างน้อย 1 โค้ด", { field: "text" });
  if (tokens.length > 2000) throw fail(400, "Too many codes", "วางได้ครั้งละไม่เกิน 2000 โค้ด", { field: "text" });
  const bad = tokens.filter((t) => !/^[A-Za-z0-9_-]{4,64}$/.test(t));
  const good = [...new Set(tokens.filter((t) => !bad.includes(t)))];
  const known = new Set((await prisma.rewardCode.findMany({ where: { code: { in: good } }, select: { code: true } })).map((c) => c.code));
  const fresh = good.filter((c) => !known.has(c));
  if (fresh.length) await prisma.rewardCode.createMany({ data: fresh.map((code) => ({ label: name, code })) });
  return { added: fresh.length, duplicates: tokens.length - bad.length - fresh.length, invalid: bad.slice(0, 20) };
}

/** The pool by label: how many codes are left and how many were given. Codes themselves are never listed. */
export async function codePool() {
  const rows = await prisma.rewardCode.groupBy({ by: ["label"], _count: { _all: true }, where: {} });
  const free = await prisma.rewardCode.groupBy({ by: ["label"], _count: { _all: true }, where: { rewardId: null } });
  const left = new Map(free.map((r) => [r.label, r._count._all]));
  return rows.map((r) => ({ label: r.label, total: r._count._all, left: left.get(r.label) ?? 0 })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Removes the unused codes of a label (given codes stay with their winners). */
export async function deleteFreeCodes(name: string) {
  const { count } = await prisma.rewardCode.deleteMany({ where: { label: name, rewardId: null } });
  return { deleted: count };
}

const discordIdText = z.string().trim().regex(/^\d{5,25}$/);

export const awardInput = z
  .object({
    title: z.string().trim().min(1).max(100).regex(noControl),
    kind: z.enum(["CODE", "ITEM"]).default("CODE"),
    /** For CODE: the label of the pool to take codes from. */
    codeLabel: label.optional(),
    note: z.string().trim().max(300).regex(noControl).optional(),
    /** Award the top N of a leaderboard... */
    tournamentId: z.string().trim().max(40).optional(),
    seasonId: z.string().trim().max(40).optional(),
    from: z.coerce.number().int().min(1).max(100).default(1),
    to: z.coerce.number().int().min(1).max(100).optional(),
    /** ...or one person by Discord id. */
    discordId: discordIdText.optional(),
  })
  .refine((v) => v.kind === "ITEM" || v.codeLabel, { message: "Choose the codes to give", path: ["codeLabel"] })
  .refine((v) => v.discordId || v.tournamentId || v.seasonId, { message: "Choose who wins", path: ["tournamentId"] });

/**
 * Gives prizes: to places from..to of a tournament or season leaderboard (only people who won coins there),
 * or to one Discord account. CODE prizes each take one unused code of the label; all of them or none.
 */
export async function award(body: unknown) {
  const parsed = awardInput.safeParse(body);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    const th: Record<string, string> = { title: "ใส่ชื่อรางวัล", codeLabel: "เลือกกลุ่มโค้ดที่จะแจก", tournamentId: "เลือกรายการหรือซีซั่น หรือใส่ Discord ID ของผู้ได้รางวัล", discordId: "Discord ID ต้องเป็นตัวเลข" };
    throw fail(400, "Validation failed", th[field] ?? "ข้อมูลไม่ถูกต้อง", { field });
  }
  const input = parsed.data;
  let winners: { discordId: string; place: number | null }[];
  if (input.discordId) {
    if (!(await prisma.predictor.findUnique({ where: { discordId: input.discordId } }))) throw fail(404, "Unknown predictor", "ยังไม่มีผู้เล่นทายผลที่ใช้ Discord นี้");
    winners = [{ discordId: input.discordId, place: null }];
  } else {
    if (input.tournamentId && !(await prisma.tournament.findUnique({ where: { id: input.tournamentId } }))) throw notFound("Tournament");
    if (input.seasonId && !(await prisma.specialSeason.findUnique({ where: { id: input.seasonId } }))) throw notFound("Season");
    const to = input.to ?? input.from;
    if (to < input.from) throw fail(400, "Bad range", "อันดับสุดท้ายต้องไม่น้อยกว่าอันดับแรก", { field: "to" });
    const board = await leaderboard({ tournamentId: input.tournamentId, seasonId: input.tournamentId ? undefined : input.seasonId }, 100);
    winners = board.filter((r) => r.rank >= input.from && r.rank <= to && (r.net ?? 0) > 0).map((r) => ({ discordId: r.discordId, place: r.rank }));
    if (!winners.length) throw fail(409, "Nobody in those places", "ไม่มีคนในอันดับนี้ที่ได้เหรียญเป็นบวก");
  }
  return prisma.$transaction(async (tx) => {
    let codes: { id: string }[] = [];
    if (input.kind === "CODE") {
      codes = await tx.rewardCode.findMany({ where: { label: input.codeLabel, rewardId: null }, orderBy: { createdAt: "asc" }, take: winners.length, select: { id: true } });
      if (codes.length < winners.length) throw fail(409, "Not enough codes", `โค้ด "${input.codeLabel}" เหลือ ${codes.length} โค้ด ต้องใช้ ${winners.length}`);
    }
    const made = [];
    for (const [i, w] of winners.entries()) {
      const r = await tx.reward.create({
        data: { discordId: w.discordId, title: input.title, kind: input.kind, place: w.place, tournamentId: input.tournamentId ?? null, seasonId: input.seasonId ?? null, note: input.note ?? null, status: input.kind === "CODE" ? "SENT" : "PENDING", deliveredAt: input.kind === "CODE" ? new Date() : null },
      });
      if (codes[i]) await tx.rewardCode.update({ where: { id: codes[i].id }, data: { rewardId: r.id } });
      made.push(r);
    }
    return { data: made, given: made.length };
  });
}

const rewardSelect = {
  id: true,
  discordId: true,
  title: true,
  kind: true,
  status: true,
  place: true,
  tournamentId: true,
  seasonId: true,
  note: true,
  notifiedAt: true,
  deliveredAt: true,
  createdAt: true,
  predictor: { select: { name: true, avatarUrl: true } },
  code: { select: { label: true } },
} as const;

/** Prizes given, newest first (codes stay hidden here; only the winner sees theirs). */
export async function listRewards(query: { status?: unknown } = {}) {
  const status = typeof query.status === "string" && ["PENDING", "SENT", "RECEIVED"].includes(query.status) ? query.status : undefined;
  const rows = await prisma.reward.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 200, select: rewardSelect });
  return { data: rows.map(({ code, ...r }) => ({ ...r, codeLabel: code?.label ?? null })) };
}

export async function updateReward(id: string, body: unknown) {
  const input = z.object({ status: z.enum(["PENDING", "SENT", "RECEIVED"]).optional(), note: z.string().trim().max(300).regex(noControl).nullish() }).parse(body);
  const r = await prisma.reward.findUnique({ where: { id } });
  if (!r) throw notFound("Reward");
  return prisma.reward.update({
    where: { id },
    data: { ...input, ...(input.status && input.status !== "PENDING" && !r.deliveredAt ? { deliveredAt: new Date() } : {}) },
  });
}

/**
 * Takes a prize back. Its code is used up either way: the winner sees it on their page the moment it is
 * given, so putting it back in the pool could hand someone else a code that was already seen.
 */
export async function deleteReward(id: string) {
  const r = await prisma.reward.findUnique({ where: { id }, include: { code: true } });
  if (!r) throw notFound("Reward");
  await prisma.$transaction(async (tx) => {
    if (r.code) await tx.rewardCode.delete({ where: { id: r.code.id } });
    await tx.reward.delete({ where: { id } });
  });
}

/** For the bot: prizes whose winner has not had a DM yet, with the code to send. */
export async function unnotifiedRewards() {
  const rows = await prisma.reward.findMany({ where: { notifiedAt: null }, orderBy: { createdAt: "asc" }, take: 50, include: { code: { select: { code: true, label: true } } } });
  const tournaments = new Map((await prisma.tournament.findMany({ where: { id: { in: rows.map((r) => r.tournamentId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  return { data: rows.map(({ code, ...r }) => ({ ...r, code: code?.code ?? null, codeLabel: code?.label ?? null, tournamentName: r.tournamentId ? (tournaments.get(r.tournamentId) ?? null) : null })) };
}

export async function markNotified(id: string) {
  const { count } = await prisma.reward.updateMany({ where: { id, notifiedAt: null }, data: { notifiedAt: new Date() } });
  return { ok: count > 0 };
}

/** The winner says the item arrived. */
export async function confirmReceived(discordId: string, id: string) {
  const r = await prisma.reward.findUnique({ where: { id } });
  if (!r || r.discordId !== discordId) throw notFound("Reward");
  return prisma.reward.update({ where: { id }, data: { status: "RECEIVED", deliveredAt: r.deliveredAt ?? new Date() } });
}
