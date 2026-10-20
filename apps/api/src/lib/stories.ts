import { z } from "zod";
import { prisma } from "./db.js";
import { fail, notFound } from "./errors.js";

/** Facebook only: the posts are where the story of a "เล่นเก่งปากเก่ง" event is told. */
const FACEBOOK = /^(?:[a-z0-9-]+\.)*(?:facebook\.com|fb\.com|fb\.watch)$/i;

const storyUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && FACEBOOK.test(u.hostname) && !u.username && !u.password;
    } catch {
      return false;
    }
  }, "ใส่ลิงก์โพสต์ Facebook (https://www.facebook.com/… หรือ https://fb.watch/…)");

/** The whole list, in order: adding, removing and moving posts all save the list again. */
export const storiesInput = z.object({
  stories: z
    .array(z.object({ title: z.string().trim().max(120).nullish().transform((v) => v || null), url: storyUrl }))
    .max(30, "ใส่ได้ไม่เกิน 30 โพสต์"),
});

const select = { id: true, title: true, url: true, position: true } as const;

export async function tournamentStories(tournamentId: string) {
  return prisma.tournamentStory.findMany({ where: { tournamentId }, orderBy: { position: "asc" }, select });
}

export async function setStories(tournamentId: string, body: unknown) {
  const parsed = storiesInput.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const row = typeof issue?.path[1] === "number" ? `โพสต์ที่ ${issue.path[1] + 1}: ` : "";
    throw fail(400, "Validation failed", `${row}${issue?.message ?? "ข้อมูลไม่ถูกต้อง"}`, { issues: parsed.error.issues });
  }
  if (!(await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true } }))) throw notFound("Tournament");
  await prisma.$transaction([
    prisma.tournamentStory.deleteMany({ where: { tournamentId } }),
    prisma.tournamentStory.createMany({ data: parsed.data.stories.map((s, position) => ({ tournamentId, title: s.title, url: s.url, position })) }),
  ]);
  return tournamentStories(tournamentId);
}

/** Special events with their story posts, newest first; optionally one season's. */
export async function specialStories(seasonId?: string) {
  const list = await prisma.tournament.findMany({
    where: { special: true, stories: { some: {} }, ...(seasonId ? { seasonId } : {}) },
    orderBy: { startDate: "desc" },
    take: 50,
    select: { id: true, name: true, startDate: true, status: true, season: { select: { id: true, name: true } }, stories: { orderBy: { position: "asc" }, select } },
  });
  return list;
}
