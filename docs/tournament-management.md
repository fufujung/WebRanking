# Admin tournament management

The tournament list and detail header expose **แก้ไขรายละเอียด**, linking directly to `#settings`. Saving returns to that tab, preserves submitted fields on errors, and invalidates the public website cache. Existing tab hashes remain supported.

The workspace includes teams, solo draws, rosters, brackets and schedules, predictions, stories, saved results, and settings. The results tab links to the existing match editor. Tournament deletion has its own section and links to the existing 30-day trash; bracket reset stays in a separate lifecycle section with confirmation and keeps recorded matches as free-form results.

## Edit rules

- The API checks scheduled starts once per second and on startup. UPCOMING events with `startDate <= now` become ONGOING, including special and free-form events. COMPLETED events and DONE brackets stay unchanged. Status persists to the database, updates the bot revision and refreshes predictions. This does not start/seed a bracket, close registration or move match schedules. Existing page caches retain their normal short refresh interval. The deploy write gate suspends automatic writes; the next tick catches up afterward.

- `PATCH /tournaments/:id` retains its payload and admin authorization. Checks read current participants and bracket state inside the update transaction; rejected edits roll back related game creation too.
- Game, entry mode and solo team size are locked when entries, solo signups or results exist, or the bracket has started.
- LIVE/DONE brackets lock format, third-place/reset rules, best-of settings and late allowance. Details and event dates remain editable; changing event dates never moves match schedules.
- Bracket lifecycle actions control event status. Started brackets and completed events cannot open registration.
- Capacity cannot fall below existing teams or solo players' team capacity. Tightened roster limits cannot exclude existing rosters. A new season must include all registered players.
- Draft shape changes clear the draft and seeds so the organizer can seed again. Existing rating recomputation for special events remains in place.

## เล่นเก่งปากเก่ง: two-side editor

Special tournaments use **จัดทีม 2 ฝั่ง** instead of the generic team picker and reserve draw tabs. Set both team names and slots per team; type player names, select existing players, or randomly fill a single blank slot, one side, or all blanks. Rank and position filters apply to selection/random fill. Filled slots remain unchanged; players cannot appear twice. Save persists both sides together, including gaps, without changing a selected player's identity, MMR or home team. Typed names reuse an unambiguous same-game player; new names create a player. Season restrictions still apply.

The editor supports partial drafts but bracket seeding requires two teams meeting the configured roster minimum. Editing clears a draft bracket and is locked once a bracket starts or results exist. Legacy special events with more than two teams expose withdrawal controls so organizers can reduce them explicitly; no historical teams are removed automatically.

Admin `GET/PUT /tournaments/:id/special-teams` loads/saves `{ teams: [{ teamId?, name, slots: ({playerId} | {name} | null)[] }, ...] }` with exactly two sides and equal slot counts. Global team names must be unique. Renaming a team used in another tournament requires the team management screen. All creation paths (entries, registration, result enrollment and solo confirmation) reject a third special-event team; new special events have capacity two.

Free-form special events automatically create one custom prediction pair (`SPECIAL_PAIR`) once both rosters meet the configured minimum. They appear on `/predict` and the special page using the existing free-coin system. Existing manual pairs are kept without adding a duplicate. Admins close the automatic pair and settle it with the winner buttons, or refund/cancel it; reads preserve those decisions. Starting the event or recording a result closes open automatic picks. Events using brackets retain the existing champion/match/game predictions. Lineup changes require refunding outstanding picks first. Deleting an automatic pair keeps a refunded tombstone so it does not reappear on the next read; an organizer can create a new custom pair explicitly when needed.

## Verification

Competitors use the same prediction rules as viewers: they may pick their own side, the opposing side, individual games and their event's champion. Coin balances, validation, close times and settlement/refund rules still apply. This is enforced through the shared prediction API used by both the website and Discord.

Run `npm run typecheck`, the API and web tests, and production builds. On machines with limited memory, use `npx tsx --test --test-concurrency=1 "src/*.test.ts" "src/modules/**/*.test.ts"` from `apps/api`.

`node e2e/tournament-management.mjs` starts isolated API/web processes with a temporary SQLite database and dummy session credentials. It checks edit links, failed-save field retention, save navigation, public updates, desktop/mobile overflow, and LIVE field locks with safe edits. It does not use the development database or Discord. Set `CHROMIUM_PATH` if the installed browser differs from Playwright's expected version. Screenshots go to the ignored `e2e/screenshots/tournament-management` folder.
