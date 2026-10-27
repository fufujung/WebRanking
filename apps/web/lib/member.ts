import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { membershipConfigured } from "./discordMembership";

/** A player logged in with Discord. Separate from the admin login. */
export interface Member {
  id: string;
  name: string;
  avatar: string | null;
}

const COOKIE = "tr_member";
const MAX_AGE = 60 * 60 * 24 * 30;

function sign(value: string) {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return createHmac("sha256", `member:${s}`).update(value).digest("base64url");
}

export async function startMemberSession(m: Member, guildId?: string) {
  const payload = Buffer.from(JSON.stringify({ ...m, guildId, exp: Date.now() + MAX_AGE * 1000 })).toString("base64url");
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function endMemberSession() {
  (await cookies()).delete(COOKIE);
}

export async function getMember(): Promise<Member | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  const [payload, sig] = value?.split(".") ?? [];
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const m = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof m.id !== "string" || !(m.exp > Date.now())) return null;
    if (membershipConfigured() && (!m.guildId || m.guildId !== process.env.DISCORD_REQUIRED_GUILD_ID?.trim())) return null;
    return { id: m.id, name: String(m.name ?? ""), avatar: typeof m.avatar === "string" ? m.avatar : null };
  } catch {
    return null;
  }
}
