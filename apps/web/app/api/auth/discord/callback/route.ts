import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { avatarUrl, callbackUrl, discordEnabled, discordUser, safeNext } from "@/lib/discord";
import { startMemberSession } from "@/lib/member";

/** Discord sends the visitor back here with a one-time code. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/me${q}`, callbackUrl(req)));
  const jar = await cookies();
  const expected = jar.get("tr_oauth_state")?.value;
  jar.delete("tr_oauth_state");
  const next = jar.get("tr_oauth_next")?.value;
  jar.delete("tr_oauth_next");
  if (!discordEnabled()) return back("?error=off");
  // Pressed "Cancel" on Discord's page.
  if (url.searchParams.get("error")) return back("?error=cancelled");
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) return back("?error=state");
  try {
    const user = await discordUser(code, callbackUrl(req));
    await startMemberSession({ id: user.id, name: user.global_name || user.username, avatar: avatarUrl(user) });
  } catch (e) {
    console.error(e);
    return back("?error=discord");
  }
  if (safeNext(next)) return NextResponse.redirect(new URL(next, callbackUrl(req)));
  return back("");
}
