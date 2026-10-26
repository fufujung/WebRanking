# Approved public UI implementation

Implemented from [TR / New edit](https://www.figma.com/design/UADyUvdhR8AgxeurDdm5cu?node-id=32-551) and the approved [Discord authentication flow](https://www.figma.com/design/UADyUvdhR8AgxeurDdm5cu?node-id=35-338), 26 October 2026. Figma MCP extraction was quota-limited, so the implementation uses the original authored design sources and the verified exports from that same file.

## Delivered scope

- Shared navigation, footer, IBM Plex Sans Thai and Barlow Condensed fonts, neutral surfaces and red action color.
- Shared navbar stays sticky at the top and its menu scrolls horizontally on narrow screens. Menu links use the existing routes and update the URL; the active destination is highlighted. Additional public destinations remain available in the footer.
- Responsive homepage: original Kagami artwork, search, discovery links, API-backed totals, team ranking with real win/loss counts, recent results and upcoming tournaments.
- Game selection opens the corresponding ranking board; season selection opens the existing special-season board. Neither pretends to filter the all-time homepage statistics. No seasons means the control is disabled.
- `/login`: Discord sign-in, required membership, recheck/loading/error, verified member, and account switching. `/me` remains the existing member profile and redirects guests to `/login`.
- Existing public routes, admin tools, ads and theme preference remain available. Other detail pages inherit shared typography/colors; this change does not replace their domain-specific layouts.

The homepage uses real API responses and existing ten-second public data caching. Missing data shows a service/empty state, never fabricated counts. Figma sample teams, seasons and dates are not production fixtures. The source artwork is local at `apps/web/public/images/hero-kagami.png`; Next Image optimizes delivery. Fonts are bundled locally.

## Discord configuration before release

Set these **server-side** in `apps/web/.env.local` (or the deployment environment):

```dotenv
DISCORD_CLIENT_ID=<application client ID>
DISCORD_CLIENT_SECRET=<application client secret>
DISCORD_REQUIRED_GUILD_ID=<Overtime server ID>
DISCORD_MEMBERSHIP_BOT_TOKEN=<token of a bot in that server>
SESSION_SECRET=<existing strong session secret>
PUBLIC_SITE_URL=https://<website host>
```

Keep the existing session secret. Never put credentials into `NEXT_PUBLIC_*` variables or commit env files. Add `https://<website host>/api/auth/discord/callback` to the Discord application's OAuth2 redirects. Set the real server invite in the existing admin site settings. Missing OAuth or membership configuration disables sign-in; missing invitation settings shows a clear notice instead of an invented link.

OAuth retains the `identify` scope. The website checks the authenticated user's ID with Discord's [Get Guild Member endpoint](https://docs.discord.com/developers/resources/guild#get-guild-member) using the server-side bot token. A confirmed unknown member, or a member still pending Discord screening, gets the join/rules step. An outage, timeout, rate limit or configuration error cannot grant access.

Before membership is verified, only a signed HttpOnly pending identity is stored, with a ten-minute expiry; it cannot authorize member actions. A member session is issued only after successful verification and is bound to the configured guild. Legacy sessions without that verification marker require sign-in again. Existing member-session lifetime remains thirty days: this verifies membership **at sign-in**, not continuously after a member leaves Discord. Joining is an explicit user action, not automatic server enrollment.

## Verification

- `npm run typecheck -w apps/web`
- `npm test -w apps/web`: pending identity tampering/expiry, correct target guild and user, membership screening, unknown member, configuration failures, rate limits and outages.
- `npm run build -w apps/web`
- Browser checks against local seeded API data and a local Discord fixture: nonmember blocked from `/me`, recheck after joining, verified profile access, logout, verification failure/retry, desktop and narrow-screen layouts, menu and search.

The existing full E2E suite has been updated for the new design, success step and membership gate; CI supplies only dummy credentials to its Discord mock. The complete historical E2E suite has not been executed as part of this local revision. No production Discord connection, deployment or load test is claimed.

For a second isolated local preview, `NEXT_DIST_DIR=.next-preview` avoids another running Next development server's output. It is a local preview option; leave it unset in production. `apps/web/tests/fixtures/discord.mjs` is a loopback-only development fixture and is not part of production routes.
