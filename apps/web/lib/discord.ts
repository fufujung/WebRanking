import "server-only";

/**
 * "Log in with Discord" (OAuth2, scope identify). Needs the Client ID and Client Secret from
 * https://discord.com/developers/applications → OAuth2, and the callback address added there as a Redirect.
 * The two URLs can point at a stand-in server for tests.
 */
export const discord = {
  clientId: () => process.env.DISCORD_CLIENT_ID?.trim() ?? "",
  clientSecret: () => process.env.DISCORD_CLIENT_SECRET?.trim() ?? "",
  apiUrl: () => (process.env.DISCORD_API_URL ?? "https://discord.com/api").replace(/\/+$/, ""),
  authorizeUrl: () => process.env.DISCORD_AUTHORIZE_URL ?? "https://discord.com/oauth2/authorize",
};

export const discordEnabled = () => Boolean(discord.clientId() && discord.clientSecret());

/** The public address Discord sends people back to. PUBLIC_SITE_URL wins over the request's own host. */
export function callbackUrl(req: Request) {
  const site = process.env.PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (site) return `${site}/api/auth/discord/callback`;
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}/api/auth/discord/callback`;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

/** Trades the code from Discord's redirect for the user's id, name and avatar. */
export async function discordUser(code: string, redirectUri: string): Promise<DiscordUser> {
  const tokenRes = await fetch(`${discord.apiUrl()}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: discord.clientId(),
      client_secret: discord.clientSecret(),
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });
  if (!tokenRes.ok) throw new Error(`Discord token exchange failed (${tokenRes.status})`);
  const token = (await tokenRes.json()) as { access_token?: string; token_type?: string };
  if (!token.access_token) throw new Error("Discord sent no access token");
  const meRes = await fetch(`${discord.apiUrl()}/users/@me`, {
    headers: { Authorization: `${token.token_type ?? "Bearer"} ${token.access_token}` },
    cache: "no-store",
  });
  if (!meRes.ok) throw new Error(`Discord user lookup failed (${meRes.status})`);
  const me = (await meRes.json()) as DiscordUser;
  if (!/^\d{5,25}$/.test(me.id ?? "")) throw new Error("Discord sent an invalid user id");
  return me;
}

export const avatarUrl = (u: DiscordUser) => (u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null);
