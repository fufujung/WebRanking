import "server-only";
import { cookies } from "next/headers";
import {
  decodePendingDiscord,
  encodePendingDiscord,
  PENDING_DISCORD_COOKIE,
  PENDING_DISCORD_MAX_AGE,
  type PendingDiscord,
} from "./discordMembership";

export const pendingCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === "true"
    : process.env.NODE_ENV === "production",
  path: "/",
  maxAge: PENDING_DISCORD_MAX_AGE,
});

export async function getPendingDiscord() {
  const pending = decodePendingDiscord(
    (await cookies()).get(PENDING_DISCORD_COOKIE)?.value,
    process.env.SESSION_SECRET ?? "",
  );
  return pending?.guildId === process.env.DISCORD_REQUIRED_GUILD_ID?.trim()
    ? pending
    : null;
}

export async function setPendingDiscord(pending: Omit<PendingDiscord, "exp">) {
  (await cookies()).set(
    PENDING_DISCORD_COOKIE,
    encodePendingDiscord(pending, process.env.SESSION_SECRET ?? ""),
    pendingCookieOptions(),
  );
}
