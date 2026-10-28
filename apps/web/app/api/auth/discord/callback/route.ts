import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  avatarUrl,
  callbackUrl,
  discordEnabled,
  discordUser,
  safeNext,
} from "@/lib/discord";
import { startMemberSession } from "@/lib/member";
import {
  checkDiscordMembership,
  membershipConfigured,
  PENDING_DISCORD_COOKIE,
} from "@/lib/discordMembership";
import { setPendingDiscord } from "@/lib/discordPending";
import { discord } from "@/lib/discord";

/** Discord sends the visitor back here with a one-time code. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) =>
    NextResponse.redirect(new URL(`/login${q}`, callbackUrl(req)));
  const jar = await cookies();
  const expected = jar.get("tr_oauth_state")?.value;
  jar.delete("tr_oauth_state");
  const next = jar.get("tr_oauth_next")?.value;
  jar.delete("tr_oauth_next");
  if (!discordEnabled()) return back("?error=off");
  // Pressed "Cancel" on Discord's page.
  if (url.searchParams.get("error")) return back("?error=cancelled");
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected)
    return back("?error=state");
  try {
    const user = await discordUser(code, callbackUrl(req));
    const member = {
      id: user.id,
      name: user.global_name || user.username,
      avatar: avatarUrl(user),
    };
    // Temporary compatibility with installations that only have the original OAuth settings.
    if (!membershipConfigured()) {
      await startMemberSession(member);
      jar.delete(PENDING_DISCORD_COOKIE);
      return back(`?verified=1${safeNext(next) ? `&next=${encodeURIComponent(next)}` : ""}`);
    }
    const guildId = process.env.DISCORD_REQUIRED_GUILD_ID!.trim();
    await setPendingDiscord({
      ...member,
      guildId,
      next: safeNext(next) ? next : "/me",
    });
    let verified: boolean;
    try {
      verified = await checkDiscordMembership(user.id, {
        guildId,
        botToken: process.env.DISCORD_MEMBERSHIP_BOT_TOKEN!.trim(),
        apiUrl: discord.apiUrl(),
      });
    } catch {
      return back("?error=verification");
    }
    if (!verified) return back("?membership=required");
    await startMemberSession(member, guildId);
    jar.delete(PENDING_DISCORD_COOKIE);
  } catch (e) {
    console.error(
      "Discord sign-in failed",
      e instanceof Error ? e.message : "Unknown error",
    );
    return back("?error=discord");
  }
  return back(
    `?verified=1${safeNext(next) ? `&next=${encodeURIComponent(next)}` : ""}`,
  );
}
