"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { discord, safeNext } from "@/lib/discord";
import {
  checkDiscordMembership,
  membershipConfigured,
  PENDING_DISCORD_COOKIE,
} from "@/lib/discordMembership";
import { getPendingDiscord } from "@/lib/discordPending";
import { endMemberSession, startMemberSession } from "@/lib/member";

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
