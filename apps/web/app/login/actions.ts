"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { discord, safeNext } from "@/lib/discord";
import {
  checkDiscordMembership,
  membershipConfigured,
  PENDING_DISCORD_COOKIE,
} from "@/lib/discordMembership";
import { getPendingDiscord } from "@/lib/discordPending";
import { endMemberSession, startMemberSession } from "@/lib/member";
import { endSession } from "@/lib/auth";

export async function verifyDiscordMembership(): Promise<void> {
  const pending = await getPendingDiscord();
  if (!pending) redirect("/login?error=expired");
  if (!membershipConfigured()) redirect("/login?error=config");
  let verified: boolean;
  try {
    verified = await checkDiscordMembership(pending.id, {
      guildId: pending.guildId,
      botToken: process.env.DISCORD_MEMBERSHIP_BOT_TOKEN!.trim(),
      apiUrl: discord.apiUrl(),
    });
  } catch {
    redirect("/login?error=verification");
  }
  if (!verified) redirect("/login?membership=required");
  await startMemberSession(
    { id: pending.id, name: pending.name, avatar: pending.avatar },
    pending.guildId,
  );
  (await cookies()).delete(PENDING_DISCORD_COOKIE);
  redirect(
    `/login?verified=1${safeNext(pending.next) ? `&next=${encodeURIComponent(pending.next)}` : ""}`,
  );
}

export async function switchDiscordAccount(): Promise<void> {
  (await cookies()).delete(PENDING_DISCORD_COOKIE);
  await endMemberSession();
  redirect("/login");
}

/** Explicit opt-in and localhost only; never creates a production session. */
export async function testLogin(form: FormData): Promise<void> {
  const host = (await headers()).get("host") ?? "";
  if (process.env.NODE_ENV !== "development" || process.env.TEST_LOGIN_ENABLED !== "1" || !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) throw new Error("Test login unavailable");
  const next = form.get("next");
  await endSession();
  await startMemberSession({ id: "00000000000000000000", name: "บัญชีทดสอบ Client", avatar: null }, process.env.DISCORD_REQUIRED_GUILD_ID?.trim(), true);
  redirect(typeof next === "string" && safeNext(next) && next !== "/login" ? next : "/me");
}
