import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { callbackUrl, discord, discordEnabled, safeNext } from "@/lib/discord";

import {
  PENDING_DISCORD_COOKIE,
} from "@/lib/discordMembership";

const STATE = "tr_oauth_state";
const NEXT = "tr_oauth_next";

/** Sends the visitor to Discord to log in. */
export async function GET(req: Request) {
  if (!discordEnabled())
    return NextResponse.redirect(new URL("/login?error=off", req.url));
  const state = randomBytes(16).toString("hex");
  const url = new URL(discord.authorizeUrl());
  url.search = new URLSearchParams({
    client_id: discord.clientId(),
    redirect_uri: callbackUrl(req),
    response_type: "code",
    scope: "identify",
    state,
    prompt: "consent",
  }).toString();
  const res = NextResponse.redirect(url);
  // Where to go after logging in (e.g. back to a team invite). Only paths on this site.
  const next = new URL(req.url).searchParams.get("next");
  if (safeNext(next))
    res.cookies.set(NEXT, next, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
      secure: new URL(callbackUrl(req)).protocol === "https:",
    });
  if (!safeNext(next)) res.cookies.delete(NEXT);
  res.cookies.delete(PENDING_DISCORD_COOKIE);
  res.cookies.set(STATE, state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    secure: new URL(callbackUrl(req)).protocol === "https:",
  });
  return res;
}
