import { createHmac, timingSafeEqual } from "node:crypto";

export const PENDING_DISCORD_COOKIE = "tr_discord_pending";
export const PENDING_DISCORD_MAX_AGE = 600;
export interface PendingDiscord {
  id: string;
  name: string;
  avatar: string | null;
  next: string;
  guildId: string;
  exp: number;
}

export function membershipConfigured() {
  return (
    /^\d{5,25}$/.test(process.env.DISCORD_REQUIRED_GUILD_ID?.trim() ?? "") &&
    Boolean(process.env.DISCORD_MEMBERSHIP_BOT_TOKEN?.trim())
  );
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", `discord-pending:${secret}`)
    .update(payload)
    .digest("base64url");
}

export function encodePendingDiscord(
  value: Omit<PendingDiscord, "exp">,
  secret: string,
  now = Date.now(),
) {
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const payload = Buffer.from(
    JSON.stringify({
      ...value,
      name: value.name.slice(0, 100),
      exp: now + PENDING_DISCORD_MAX_AGE * 1000,
    }),
  ).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function decodePendingDiscord(
  cookie: string | undefined,
  secret: string,
  now = Date.now(),
): PendingDiscord | null {
  if (!cookie || !secret || cookie.length > 3000) return null;
  const [payload, sig, extra] = cookie.split(".");
  if (!payload || !sig || extra) return null;
  const expected = Buffer.from(signature(payload, secret));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return null;
  try {
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      !/^\d{5,25}$/.test(value.id) ||
      !/^\d{5,25}$/.test(value.guildId) ||
      typeof value.name !== "string" ||
      typeof value.next !== "string" ||
      !(value.exp > now) ||
      value.exp > now + PENDING_DISCORD_MAX_AGE * 1000
    )
      return null;
    return {
      ...value,
      avatar: typeof value.avatar === "string" ? value.avatar : null,
    };
  } catch {
    return null;
  }
}

/** Unknown member is the only negative lookup; outages and bad configuration must never grant access. */
export async function checkDiscordMembership(
  userId: string,
  options: { guildId: string; botToken: string; apiUrl: string },
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (
    !/^\d{5,25}$/.test(userId) ||
    !/^\d{5,25}$/.test(options.guildId) ||
    !options.botToken
  )
    throw new Error("Discord membership verification is not configured");
  const response = await fetcher(
    `${options.apiUrl.replace(/\/+$/, "")}/guilds/${options.guildId}/members/${userId}`,
    {
      headers: { Authorization: `Bot ${options.botToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    },
  );
  if (response.status === 404) {
    const body = await response.json().catch(() => null);
    if (body?.code === 10007) return false;
  }
  if (!response.ok)
    throw new Error(
      `Discord membership verification unavailable (${response.status})`,
    );
  const member = await response.json();
  if (member?.user?.id !== userId)
    throw new Error("Discord membership identity mismatch");
  return member.pending !== true;
}
