import { z } from "zod";
import { prisma } from "./db.js";
import { fail } from "./errors.js";

/** Only real Discord invites: the button sends visitors straight to the server. */
const INVITE = /^https:\/\/(?:discord\.gg\/[A-Za-z0-9-]{2,32}|(?:www\.)?discord(?:app)?\.com\/invite\/[A-Za-z0-9-]{2,32})\/?$/;

const inviteUrl = z
  .string()
  .trim()
  .max(100)
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
  .refine((v) => !v || INVITE.test(v), "ใส่ลิงก์เชิญ Discord (https://discord.gg/… หรือ https://discord.com/invite/…)");

export const settingsInput = z.object({ discordInvite: inviteUrl.nullish().transform((v) => v || null) }).partial();

export interface SiteSettings {
  discordInvite: string | null;
}

export async function getSettings(): Promise<SiteSettings> {
  const rows = await prisma.siteSetting.findMany({ where: { key: { in: ["discordInvite"] } } });
  const value = (key: string) => rows.find((r) => r.key === key)?.value || null;
  return { discordInvite: value("discordInvite") };
}

/** Changes only the keys sent; null or "" clears one. */
export async function updateSettings(body: unknown): Promise<SiteSettings> {
  const parsed = settingsInput.safeParse(body);
  if (!parsed.success) throw fail(400, "Validation failed", parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง", { issues: parsed.error.issues });
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    if (value === null) await prisma.siteSetting.deleteMany({ where: { key } });
    else await prisma.siteSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  return getSettings();
}
