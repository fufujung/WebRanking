/**
 * Pick/ban drafts sent live by the broadcast bot (vMix). The bot sends a game's draft once the picks lock and
 * again when the organizer presses the winner, so a tournament's character stats fill in while it is played.
 */
import { z } from "zod";
import { prisma } from "./db.js";
import { fail, notFound } from "./errors.js";

const side = z.enum(["A", "B"]);
const slot = z.object({
  side,
  kind: z.enum(["ban", "pick"]),
  char: z.string().trim().min(1).max(60),
  name: z.string().trim().max(80).nullish().transform((v) => v || null),
});

export const draftInput = z.object({
  teamA: z.string().trim().min(1).max(100),
  teamB: z.string().trim().min(1).max(100),
  gameNo: z.coerce.number().int().min(1).max(15).default(1),
  slots: z.array(slot).max(30),
  winner: side.nullish().transform((v) => v ?? null),
  playedAt: z.coerce.date().optional(),
});

/** The bot's game id: letters, digits and a few separators, so it is safe in a URL. */
export const draftRef = z.string().trim().regex(/^[\w.:-]{1,80}$/, "ref must be 1-80 letters, digits, . _ : or -");

type Slot = z.infer<typeof slot>;
type Row = { id: string; ref: string; teamA: string; teamB: string; teamAId: string | null; teamBId: string | null; gameNo: number; slots: string; winner: string | null; playedAt: Date; updatedAt: Date };

const view = ({ slots, ...d }: Row) => ({ ...d, slots: JSON.parse(slots) as Slot[] });

async function teamIdByName(name: string) {
  const t = await prisma.team.findFirst({ where: { name: { equals: name } }, select: { id: true } });
  return t?.id ?? null;
}

async function tournamentExists(id: string) {
  if (!(await prisma.tournament.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Tournament");
}

/** Creates or replaces the draft with this ref. */
export async function saveDraft(tournamentId: string, ref: string, body: unknown) {
  await tournamentExists(tournamentId);
  const parsed = draftInput.safeParse(body);
  if (!parsed.success) throw fail(400, "Validation failed", "ข้อมูลดราฟไม่ถูกต้อง", { issues: parsed.error.issues });
  const d = parsed.data;
  const data = {
    teamA: d.teamA,
    teamB: d.teamB,
    teamAId: await teamIdByName(d.teamA),
    teamBId: await teamIdByName(d.teamB),
    gameNo: d.gameNo,
    slots: JSON.stringify(d.slots),
    winner: d.winner,
    ...(d.playedAt ? { playedAt: d.playedAt } : {}),
  };
  const row = await prisma.draft.upsert({
    where: { tournamentId_ref: { tournamentId, ref } },
    create: { tournamentId, ref, ...data },
    update: data,
  });
  return view(row);
}

export async function deleteDraft(tournamentId: string, ref: string) {
  const { count } = await prisma.draft.deleteMany({ where: { tournamentId, ref } });
  if (!count) throw notFound("Draft");
}

export type CharStat = {
  char: string;
  name: string;
  picks: number;
  bans: number;
  wins: number;
  losses: number;
  pickRate: number;
  banRate: number;
  presence: number;
  winRate: number | null;
};

const pct = (n: number, of: number) => Math.round((1000 * n) / of) / 10;

/** Per character: how often it was picked and banned in the tournament's drafts, and how its picks did. */
export function draftStats(drafts: { slots: Slot[]; winner: string | null }[]): CharStat[] {
  const byChar = new Map<string, CharStat>();
  for (const d of drafts) {
    for (const s of d.slots) {
      const c = byChar.get(s.char) ?? { char: s.char, name: s.name ?? s.char, picks: 0, bans: 0, wins: 0, losses: 0, pickRate: 0, banRate: 0, presence: 0, winRate: null };
      if (s.name) c.name = s.name;
      if (s.kind === "ban") c.bans++;
      else {
        c.picks++;
        if (d.winner) c[d.winner === s.side ? "wins" : "losses"]++;
      }
      byChar.set(s.char, c);
    }
  }
  const n = drafts.length || 1;
  return [...byChar.values()]
    .map((c) => ({
      ...c,
      pickRate: pct(c.picks, n),
      banRate: pct(c.bans, n),
      presence: pct(c.picks + c.bans, n),
      winRate: c.wins + c.losses ? pct(c.wins, c.wins + c.losses) : null,
    }))
    .sort((a, b) => b.picks + b.bans - (a.picks + a.bans) || b.picks - a.picks || a.name.localeCompare(b.name));
}

/** The tournament's drafts, newest first, with the character stats they add up to. */
export async function tournamentDrafts(tournamentId: string) {
  await tournamentExists(tournamentId);
  const rows = (await prisma.draft.findMany({ where: { tournamentId }, orderBy: [{ playedAt: "desc" }, { id: "desc" }] })).map(view);
  return { data: rows, games: rows.length, decided: rows.filter((d) => d.winner).length, characters: draftStats(rows) };
}
