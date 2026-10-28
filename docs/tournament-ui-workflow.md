# Navigation and tournament workflow

Follow-up: [public registration and homepage](public-registration.md) describes the 28 October changes to website Join, player setup, team creation, navigation and category separation. The implementation notes below describe the preceding revision.

Implemented in `WebRanking-ui-first-edition` on 27 October 2026.

## Entry points

- The five primary destinations remain unchanged. Teams, Players and Guilds share directory navigation on lists and details; Guilds also activates the Teams and players header destination.
- Predictions and เล่นเก่งปากเก่ง have footer links. Special stories return to the selected season.
- Ranking tabs, searches, team-board filters, statistics sorts and legacy statistics redirects preserve game selection. Changing games or team filters resets pagination.
- [Route coverage](route-coverage.md) lists website routes and backend methods with static reference evidence. Regenerate with `node scripts/route-inventory.mjs`. External usage remains unknown; no routes were removed.

## Tournament experience

- Discovery cards show event status separately from registration, Bangkok start time, format, entry mode, capacity and results count. Search/status filters and pagination retain their existing contracts.
- Public details expose Overview, Teams, Schedule / Bracket and Results anchors. Existing Stories, Picks, Cheer and solo registration remain available. Loading, failure, empty and unpublished-bracket states are explicit.
- The shared summary distinguishes event, registration and bracket states. Team events explain Discord `/register` and use only the configured invitation. Closed/full events do not advertise open registration; confirmed solo draws close the displayed registration state.
- Draft brackets remain admin-only. Live/completed brackets, round-robin standings and free-form match results use the existing components and APIs.
- The admin summary links to the relevant existing tab or free-form result form. Solo events without sign-ups direct organizers to settings; confirmed teams lead to seeding; draft/live/completed brackets lead to review, operation or final results. These links provide guidance, while the API continues to validate each operation.

## Compatibility and verification

No endpoint, schema, permission, rating, prediction, blacklist or Discord competition logic was changed. Existing admin hashes, public URLs and member forms remain in place.

Verification uses type checks, production builds, existing API/bot/web/deployment tests, new lifecycle guidance tests, and browser regression checks for directory navigation, game preservation, private draft brackets, lifecycle links and mobile tournament overflow.

Local browser runs use a separate seeded SQLite database, local uploads and dummy Discord credentials. They do not connect to production Discord or change the development database or environment files. This Windows execution environment required loopback access and pre-creating empty test SQLite files before Prisma setup; the temporary test workaround is not application code.

The historical browser suite now checks the theme toggle only when present, preserving the current UI's hidden switch, and locates admin navigation through its current footer link.

Verified locally:

- `npm run typecheck` and `npm run build`: all three workspaces passed.
- Regression tests: 242 API, 102 bot, 7 web and 16 deployment tests passed (367 total), using the Windows test-database workaround described above. The web tests also passed again after the final lifecycle changes.
- `npm run test:e2e`: the complete suite passed against the production build with a fresh fixture and mocked Discord, including the added route, draft-visibility, lifecycle-link, game-filter and mobile-overflow checks.
- `git diff --check`: passed.
