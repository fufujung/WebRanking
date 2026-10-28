# Public registration and homepage

Implemented 28 October 2026 in `WebRanking-ui-first-edition`. Eventory at `c4e290f` is the UX reference for a tournament entry point, a short create-team page, visible roster requirements and invite links. Registration uses this project's existing permanent teams and competition rules; it does not introduce tournament lobbies, payments or organizer approval.

## Visitor flow

- Home order: existing hero and discovery controls → เล่นเก่ง ปากเก่ง → normal tournaments → recent results. Each tournament section shows up to three active/upcoming events, filtered before limiting. Results retain both categories with a special-event label.
- `/tournaments` contains normal events; `/special` contains special events and their separate MMR board. Community totals moved to `/tournaments` and remain site-wide regardless of list filters.
- Header search and `/search` search tournament names only across both categories. Existing API search behavior remains available without the new scope parameter.
- The tournament page checks the authenticated member's actual entry before showing Join. Guests sign in and return to the same event. Team captains submit the real team roster; members see captain guidance. Oversized teams select their competing roster, including the captain. Insufficient teams see the shortage and invite link.
- `/teams/new?tournamentId=…` shows the source event and a short create-team form. Creating a team returns to that event without registering it. Team invitations continue using `/join/[code]`, and `/me#my-teams` manages the permanent team.
- Solo Join uses saved character position and in-game rank. Missing or retired details go to `/me/player` with the game, character and return destination. Saving returns to the event; Join is a separate action. Existing explicit solo-signup editing and withdrawal remain available before the applicable locks.
- Predictions are linked from the navbar, the event join area and the event section navigation. `/predict?t=…` never silently substitutes another event when the requested event has no markets.

## Interfaces and data

- `GET /tournaments?category=normal|special|all`: defaults to `all` for existing callers. Both rows and counts use the category filter before pagination.
- `GET /stats/search?scope=tournaments&q=…`: tournament names only; omitting `scope` preserves the existing search contract.
- `GET /stats/overview`: adds `normalTournaments` and `specialTournaments`; retains `upcomingTournaments` and existing totals for compatibility. Match tournament summaries add `special`.
- `GET /members/:discordId/player-ranks?gameId=…`: rank options for setup, using the same fallback as Solo.
- `POST /members/:discordId/player-profile`: `{ playerId, position, inGameRank, gameId? }`. Checks ownership, game and valid rank.
- `POST /members/:discordId/tournaments/:tournamentId/join`: `{ playerId, playerIds? }`. Checks the owning captain and derives all team identity and player data on the server. Uses the shared registration transaction, duplicate/season checks, draft invalidation, game adoption and prediction sync. Retries return the existing entry.
- `POST /members/:discordId/solo/:tournamentId/join`: `{ playerId }`. Uses the owned character's saved details, enforces capacity and returns an existing signup on retry. The prior Solo endpoints remain available for explicit edits and withdrawal.
- Member API methods require the server-side admin API key, following the existing member API boundary. Website Server Actions derive the Discord ID from the authenticated session; no browser-supplied account identity or organizer override is accepted.
- `Player.inGameRank` is nullable and separate from leaderboard position and both MMR ratings. The explicit main-ranking API field list remains unchanged. Solo/reserve writes save reusable rank information; profile edits do not rewrite historic signup snapshots.

## Database update

Back up the existing database, run `npm exec -w apps/api -- prisma db push --skip-generate`, regenerate the Prisma client and restart the API. Startup fills missing ranks from valid, same-game Solo/reserve history after the existing identity/position backfills. The backfill is repeatable and preserves existing saved ranks and both MMR ratings. No database reset or demo seed is required.

The local development database was snapshotted under the ignored `.next-preview/` directory before its additive column update. Backfill verified that player IDs and both MMR values were unchanged.

## Verification

- `npm run typecheck` and builds for API, web and bot.
- API registration integration tests: category filtering before pagination, name-only search, captain/ownership checks, exact roster selection, duplicate retries, capacity races, closed registrations, game/season restrictions, saved Solo details and historical backfill.
- Existing API, bot, web and simulated deployment regression suites. Windows test runs require pre-created SQLite files; the existing environment workaround was applied only to temporary test databases.
- `npm run test:e2e:registration` creates an isolated database/API/web server, uses test-only signed member sessions and never contacts real Discord. Covers search, category separation, prediction fallback, profile setup/return, Solo Join/reload/withdrawal, team creation/return, invite acceptance, member restrictions, captain Join/reload, mobile overflow and keyboard search. Screenshots are saved under ignored `e2e/screenshots/registration-*.png`.
- On Windows, set `CHROMIUM_PATH` to an installed Chrome executable if Playwright's bundled browser is unavailable. API key, session secret, uploads and database used by this browser suite are isolated from development configuration.
