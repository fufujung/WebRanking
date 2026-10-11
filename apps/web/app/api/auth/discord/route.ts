import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { callbackUrl, discord, discordEnabled } from "@/lib/discord";

const STATE = "tr_oauth_state";

/** Sends the visitor to Discord to log in. */
export async function GET(req: Request) {
  if (!discordEnabled()) return NextResponse.redirect(new URL("/me?error=off", req.url));
  const state = randomBytes(16).toString("hex");
  const url = new URL(discord.authorizeUrl());
  url.search = new URLSearchParams({
    client_id: discord.clientId(),
    redirect_uri: callbackUrl(req),
    response_type: "code",
    scope: "identify",
    state,
    prompt: "none",
  }).toString();
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE, state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: new URL(callbackUrl(req)).protocol === "https:" });
  return res;
}
