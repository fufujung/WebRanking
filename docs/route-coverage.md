# Route coverage inventory

Regenerate from the repository root with `node scripts/route-inventory.mjs`.

All existing routes are retained. External API usage is unknown. Static references below are path candidates, not method-level runtime telemetry; helper-built URLs require manual tracing. Absence of a reference is not a removal recommendation.

## Website routes

| Route | Audience / entry point |
| --- | --- |
| `/[entry]` | Admin; restricted navigation / configured sign-in address |
| `/admin/ads/[id]` | Admin; restricted navigation / configured sign-in address |
| `/admin/ads/new` | Admin; restricted navigation / configured sign-in address |
| `/admin/ads` | Admin; restricted navigation / configured sign-in address |
| `/admin/blacklist` | Admin; restricted navigation / configured sign-in address |
| `/admin/draws/[id]` | Admin; restricted navigation / configured sign-in address |
| `/admin/draws` | Admin; restricted navigation / configured sign-in address |
| `/admin/games/[id]` | Admin; restricted navigation / configured sign-in address |
| `/admin/games` | Admin; restricted navigation / configured sign-in address |
| `/admin/guilds/[id]` | Admin; restricted navigation / configured sign-in address |
| `/admin/guilds` | Admin; restricted navigation / configured sign-in address |
| `/admin/keys` | Admin; restricted navigation / configured sign-in address |
| `/admin/matches/[id]` | Admin; restricted navigation / configured sign-in address |
| `/admin/matches/new` | Admin; restricted navigation / configured sign-in address |
| `/admin/matches` | Admin; restricted navigation / configured sign-in address |
| `/admin` | Admin; restricted navigation / configured sign-in address |
| `/admin/players/[id]` | Admin; restricted navigation / configured sign-in address |
| `/admin/players/new` | Admin; restricted navigation / configured sign-in address |
| `/admin/players` | Admin; restricted navigation / configured sign-in address |
| `/admin/predict` | Admin; restricted navigation / configured sign-in address |
| `/admin/reserve` | Admin; restricted navigation / configured sign-in address |
| `/admin/seasons/[id]` | Admin; restricted navigation / configured sign-in address |
| `/admin/seasons` | Admin; restricted navigation / configured sign-in address |
| `/admin/settings` | Admin; restricted navigation / configured sign-in address |
| `/admin/teams/[id]` | Admin; restricted navigation / configured sign-in address |
| `/admin/teams/new` | Admin; restricted navigation / configured sign-in address |
| `/admin/teams` | Admin; restricted navigation / configured sign-in address |
| `/admin/tournaments/[id]` | Admin; restricted navigation / configured sign-in address |
| `/admin/tournaments/new` | Admin; restricted navigation / configured sign-in address |
| `/admin/tournaments` | Admin; restricted navigation / configured sign-in address |
| `/admin/trash` | Admin; restricted navigation / configured sign-in address |
| `/admin/login` | Admin; restricted navigation / configured sign-in address |
| `/api/auth/discord/callback` | Supporting handler; auth, forms, refresh, broadcast, or ads (not a menu destination) |
| `/api/auth/discord` | Supporting handler; auth, forms, refresh, broadcast, or ads (not a menu destination) |
| `/api/extract` | Supporting handler; auth, forms, refresh, broadcast, or ads (not a menu destination) |
| `/api/upload` | Supporting handler; auth, forms, refresh, broadcast, or ads (not a menu destination) |
| `/blacklist` | Public; footer and contextual links |
| `/go/ad/[id]` | Supporting handler; auth, forms, refresh, broadcast, or ads (not a menu destination) |
| `/guilds/[id]` | Public; directory tabs, entity links, search / Discord |
| `/guilds` | Public; directory tabs, entity links, search / Discord |
| `/join/[code]` | Member; team invitation link |
| `/live` | Supporting handler; auth, forms, refresh, broadcast, or ads (not a menu destination) |
| `/login` | Member; account navigation / sign-in redirects |
| `/matches/[id]` | Public; primary navigation / homepage / contextual detail links |
| `/matches` | Public; primary navigation / homepage / contextual detail links |
| `/me` | Member; account navigation / sign-in redirects |
| `/overlay/draw/data` | Supporting handler; auth, forms, refresh, broadcast, or ads (not a menu destination) |
| `/overlay/draw` | Supporting handler; auth, forms, refresh, broadcast, or ads (not a menu destination) |
| `/overlay/predict/data` | Supporting handler; auth, forms, refresh, broadcast, or ads (not a menu destination) |
| `/overlay/predict` | Supporting handler; auth, forms, refresh, broadcast, or ads (not a menu destination) |
| `/` | Public; primary navigation / homepage / contextual detail links |
| `/players/[id]` | Public; directory tabs, entity links, search / Discord |
| `/players` | Public; directory tabs, entity links, search / Discord |
| `/predict` | Public; footer and contextual links |
| `/rankings` | Public; primary navigation / homepage / contextual detail links |
| `/rankings/players` | Public; primary navigation / homepage / contextual detail links |
| `/rankings/stats` | Public; primary navigation / homepage / contextual detail links |
| `/search` | Public; header / homepage search |
| `/special` | Public; footer and contextual links |
| `/special/story` | Public; special-season stories; return link preserves season |
| `/teams/[id]` | Public; directory tabs, entity links, search / Discord |
| `/teams` | Public; directory tabs, entity links, search / Discord |
| `/tournaments/[id]` | Public; primary navigation / homepage / contextual detail links |
| `/tournaments/[id]/picks` | Public; tournament link when draft data exists |
| `/tournaments` | Public; primary navigation / homepage / contextual detail links |

## API routes

Paths are relative to `/api/v1`. Path references may include website links as well as API calls. Tournament bracket mutations also use `bracketPath` / `slotPath` in `apps/web/app/admin/actions.ts`; Discord operations use `apps/bot/src/tour.ts`.

| Method | Path | Static reference candidates / caller evidence |
| --- | --- | --- |
| GET | `/ads` | `apps/web/app/admin/(panel)/ads/page.tsx:19`; `apps/web/app/admin/actions.ts:528`; `apps/web/lib/ads.ts:9` |
| POST | `/ads` | `apps/web/app/admin/(panel)/ads/page.tsx:19`; `apps/web/app/admin/actions.ts:528`; `apps/web/lib/ads.ts:9` |
| GET | `/ads/:id` | `apps/web/app/admin/(panel)/ads/[id]/page.tsx:12`; `apps/web/app/admin/actions.ts:528`; `apps/web/app/admin/actions.ts:538`; `apps/web/app/admin/actions.ts:540` |
| PATCH | `/ads/:id` | `apps/web/app/admin/(panel)/ads/[id]/page.tsx:12`; `apps/web/app/admin/actions.ts:528`; `apps/web/app/admin/actions.ts:538`; `apps/web/app/admin/actions.ts:540` |
| DELETE | `/ads/:id` | `apps/web/app/admin/(panel)/ads/[id]/page.tsx:12`; `apps/web/app/admin/actions.ts:528`; `apps/web/app/admin/actions.ts:538`; `apps/web/app/admin/actions.ts:540` |
| POST | `/ads/:id/click` | `apps/web/app/go/ad/[id]/route.ts:8` |
| GET | `/blacklist` | `apps/web/app/admin/(panel)/blacklist/page.tsx:17`; `apps/web/app/admin/actions.ts:423`; `apps/web/app/layout.tsx:152`; `apps/web/app/players/[id]/page.tsx:48` |
| POST | `/blacklist` | `apps/web/app/admin/(panel)/blacklist/page.tsx:17`; `apps/web/app/admin/actions.ts:423`; `apps/web/app/layout.tsx:152`; `apps/web/app/players/[id]/page.tsx:48` |
| PATCH | `/blacklist/:id` | `apps/web/app/admin/actions.ts:433`; `apps/web/app/admin/actions.ts:442`; `apps/bot/src/blacklist.ts:252`; `apps/bot/src/blacklist.ts:265` |
| DELETE | `/blacklist/:id` | `apps/web/app/admin/actions.ts:433`; `apps/web/app/admin/actions.ts:442`; `apps/bot/src/blacklist.ts:252`; `apps/bot/src/blacklist.ts:265` |
| GET | `/draws/active` | `apps/web/app/overlay/draw/data/route.ts:12`; `apps/bot/src/luckydraw.ts:184` |
| GET | `/draws/:id/public` | `apps/web/app/overlay/draw/data/route.ts:12`; `apps/bot/src/luckydraw.ts:293` |
| GET | `/draws` | `apps/web/app/admin/(panel)/draws/page.tsx:15`; `apps/web/app/admin/actions.ts:814`; `apps/bot/src/luckydraw.ts:277`; `apps/bot/src/luckydraw.ts:308` |
| POST | `/draws` | `apps/web/app/admin/(panel)/draws/page.tsx:15`; `apps/web/app/admin/actions.ts:814`; `apps/bot/src/luckydraw.ts:277`; `apps/bot/src/luckydraw.ts:308` |
| GET | `/draws/:id` | `apps/web/app/admin/(panel)/draws/[id]/page.tsx:14`; `apps/web/app/admin/actions.ts:823`; `apps/web/app/admin/actions.ts:838`; `apps/web/app/overlay/draw/data/route.ts:12` |
| PATCH | `/draws/:id` | `apps/web/app/admin/(panel)/draws/[id]/page.tsx:14`; `apps/web/app/admin/actions.ts:823`; `apps/web/app/admin/actions.ts:838`; `apps/web/app/overlay/draw/data/route.ts:12` |
| DELETE | `/draws/:id` | `apps/web/app/admin/(panel)/draws/[id]/page.tsx:14`; `apps/web/app/admin/actions.ts:823`; `apps/web/app/admin/actions.ts:838`; `apps/web/app/overlay/draw/data/route.ts:12` |
| POST | `/draws/:id/open` | `apps/bot/src/luckydraw.ts:271`; `apps/bot/src/luckydraw.ts:319` |
| POST | `/draws/:id/close` | `apps/bot/src/luckydraw.ts:287` |
| POST | `/draws/:id/draw` | `apps/bot/src/luckydraw.ts:295` |
| POST | `/draws/:id/entries` | `apps/bot/src/luckydraw.ts:248` |
| DELETE | `/draws/:id/entries/:entryId` | No literal caller found; integration / dynamic caller usage unknown |
| POST | `/draws/:id/entries/:entryId/void` | `apps/bot/src/luckydraw.ts:331` |
| GET | `/games` | `apps/web/app/admin/(panel)/games/page.tsx:12`; `apps/web/app/admin/actions.ts:343`; `apps/web/lib/games.ts:11`; `apps/bot/src/ladder.ts:77` |
| GET | `/games/:id` | `apps/web/app/admin/(panel)/games/[id]/page.tsx:12`; `apps/web/app/admin/actions.ts:352`; `apps/web/app/admin/actions.ts:362`; `apps/web/app/admin/actions.ts:371` |
| POST | `/games` | `apps/web/app/admin/(panel)/games/page.tsx:12`; `apps/web/app/admin/actions.ts:343`; `apps/web/lib/games.ts:11`; `apps/bot/src/ladder.ts:77` |
| PATCH | `/games/:id` | `apps/web/app/admin/(panel)/games/[id]/page.tsx:12`; `apps/web/app/admin/actions.ts:352`; `apps/web/app/admin/actions.ts:362`; `apps/web/app/admin/actions.ts:371` |
| DELETE | `/games/:id` | `apps/web/app/admin/(panel)/games/[id]/page.tsx:12`; `apps/web/app/admin/actions.ts:352`; `apps/web/app/admin/actions.ts:362`; `apps/web/app/admin/actions.ts:371` |
| GET | `/guilds` | `apps/web/app/admin/(panel)/guilds/page.tsx:16`; `apps/web/app/guilds/page.tsx:54`; `apps/web/components/DirectoryTabs.tsx:6`; `apps/web/components/public/PublicNavigation.tsx:29` |
| GET | `/guilds/:id` | `apps/web/app/admin/(panel)/guilds/[id]/page.tsx:13`; `apps/web/app/admin/(panel)/guilds/[id]/page.tsx:20`; `apps/web/app/admin/actions.ts:391`; `apps/web/app/guilds/page.tsx:32` |
| PATCH | `/guilds/:id` | `apps/web/app/admin/(panel)/guilds/[id]/page.tsx:13`; `apps/web/app/admin/(panel)/guilds/[id]/page.tsx:20`; `apps/web/app/admin/actions.ts:391`; `apps/web/app/guilds/page.tsx:32` |
| DELETE | `/guilds/:id/members/:playerId` | `apps/web/app/admin/actions.ts:411` |
| DELETE | `/guilds/:id` | `apps/web/app/admin/(panel)/guilds/[id]/page.tsx:13`; `apps/web/app/admin/(panel)/guilds/[id]/page.tsx:20`; `apps/web/app/admin/actions.ts:391`; `apps/web/app/guilds/page.tsx:32` |
| GET | `/keys` | `apps/web/app/admin/(panel)/keys/page.tsx:10`; `apps/web/app/admin/actions.ts:550` |
| POST | `/keys` | `apps/web/app/admin/(panel)/keys/page.tsx:10`; `apps/web/app/admin/actions.ts:550` |
| DELETE | `/keys/:id` | `apps/web/app/admin/actions.ts:560` |
| GET | `/matches` | `apps/web/app/admin/(panel)/page.tsx:34`; `apps/web/app/admin/actions.ts:204`; `apps/web/app/matches/page.tsx:23`; `apps/web/app/page.tsx:165` |
| GET | `/matches/by-source` | `apps/bot/src/bot.ts:222` |
| GET | `/matches/:id` | `apps/web/app/admin/(panel)/matches/[id]/page.tsx:15`; `apps/web/app/admin/(panel)/matches/[id]/page.tsx:27`; `apps/web/app/admin/actions.ts:204`; `apps/web/app/admin/actions.ts:209` |
| POST | `/matches` | `apps/web/app/admin/(panel)/page.tsx:34`; `apps/web/app/admin/actions.ts:204`; `apps/web/app/matches/page.tsx:23`; `apps/web/app/page.tsx:165` |
| PUT | `/matches/:id` | `apps/web/app/admin/(panel)/matches/[id]/page.tsx:15`; `apps/web/app/admin/(panel)/matches/[id]/page.tsx:27`; `apps/web/app/admin/actions.ts:204`; `apps/web/app/admin/actions.ts:209` |
| DELETE | `/matches/:id` | `apps/web/app/admin/(panel)/matches/[id]/page.tsx:15`; `apps/web/app/admin/(panel)/matches/[id]/page.tsx:27`; `apps/web/app/admin/actions.ts:204`; `apps/web/app/admin/actions.ts:209` |
| GET | `/members/invites/:code` | `apps/web/app/join/[code]/page.tsx:17` |
| GET | `/members/:discordId` | `apps/web/app/join/[code]/page.tsx:28`; `apps/web/app/me/page.tsx:50`; `apps/web/app/tournaments/[id]/SoloSection.tsx:15`; `apps/bot/src/ladder.ts:171` |
| POST | `/members/:discordId/teams` | No literal caller found; integration / dynamic caller usage unknown |
| POST | `/members/:discordId/join` | No literal caller found; integration / dynamic caller usage unknown |
| POST | `/members/:discordId/leave` | No literal caller found; integration / dynamic caller usage unknown |
| POST | `/members/:discordId/kick` | No literal caller found; integration / dynamic caller usage unknown |
| POST | `/members/:discordId/captain` | No literal caller found; integration / dynamic caller usage unknown |
| POST | `/members/:discordId/invite` | No literal caller found; integration / dynamic caller usage unknown |
| POST | `/members/:discordId/position` | `apps/bot/src/bot.ts:557` |
| POST | `/members/:discordId/solo/:tournamentId` | `apps/web/app/tournaments/[id]/actions.ts:20`; `apps/web/app/tournaments/[id]/actions.ts:35`; `apps/bot/src/tour.ts:1064`; `apps/bot/src/tour.ts:1137` |
| DELETE | `/members/:discordId/solo/:tournamentId` | `apps/web/app/tournaments/[id]/actions.ts:20`; `apps/web/app/tournaments/[id]/actions.ts:35`; `apps/bot/src/tour.ts:1064`; `apps/bot/src/tour.ts:1137` |
| GET | `/members/:discordId/reserve` | `apps/web/app/me/actions.ts:185`; `apps/bot/src/pool.ts:690`; `apps/bot/src/pool.ts:710` |
| GET | `/members/:discordId/reserves` | `apps/web/app/me/page.tsx:53` |
| POST | `/members/:discordId/reserve` | `apps/web/app/me/actions.ts:185`; `apps/bot/src/pool.ts:690`; `apps/bot/src/pool.ts:710` |
| POST | `/members/:discordId/reserve/check` | `apps/bot/src/pool.ts:670` |
| DELETE | `/members/:discordId/reserve` | `apps/web/app/me/actions.ts:185`; `apps/bot/src/pool.ts:690`; `apps/bot/src/pool.ts:710` |
| POST | `/members/:discordId/guild/:action` | No literal caller found; integration / dynamic caller usage unknown |
| GET | `/players` | `apps/web/app/admin/(panel)/blacklist/page.tsx:17`; `apps/web/app/admin/(panel)/matches/new/page.tsx:16`; `apps/web/app/admin/(panel)/matches/[id]/page.tsx:18`; `apps/web/app/admin/(panel)/page.tsx:36` |
| POST | `/players` | `apps/web/app/admin/(panel)/blacklist/page.tsx:17`; `apps/web/app/admin/(panel)/matches/new/page.tsx:16`; `apps/web/app/admin/(panel)/matches/[id]/page.tsx:18`; `apps/web/app/admin/(panel)/page.tsx:36` |
| GET | `/players/uid/:uid` | No literal caller found; integration / dynamic caller usage unknown |
| GET | `/players/discord/:discordId` | `apps/web/app/me/actions.ts:25`; `apps/web/app/me/page.tsx:55`; `apps/bot/src/tour.ts:1044` |
| POST | `/players/discord/:discordId/claim` | `apps/web/app/me/actions.ts:36`; `apps/bot/src/links.ts:71`; `apps/bot/src/tour.ts:1132` |
| GET | `/players/link-requests` | `apps/web/app/admin/(panel)/players/page.tsx:19`; `apps/bot/src/links.ts:82` |
| POST | `/players/link-requests/:id/approve` | `apps/web/app/admin/actions.ts:579`; `apps/bot/src/links.ts:110` |
| POST | `/players/link-requests/:id/deny` | `apps/web/app/admin/actions.ts:588`; `apps/bot/src/links.ts:114` |
| DELETE | `/players/:id/discord` | `apps/web/app/admin/actions.ts:569`; `apps/web/app/me/actions.ts:70` |
| GET | `/players/:id` | `apps/web/app/admin/(panel)/players/page.tsx:19`; `apps/web/app/admin/(panel)/players/[id]/page.tsx:18`; `apps/web/app/admin/(panel)/players/[id]/page.tsx:32`; `apps/web/app/admin/actions.ts:93` |
| PATCH | `/players/:id` | `apps/web/app/admin/(panel)/players/page.tsx:19`; `apps/web/app/admin/(panel)/players/[id]/page.tsx:18`; `apps/web/app/admin/(panel)/players/[id]/page.tsx:32`; `apps/web/app/admin/actions.ts:93` |
| POST | `/players/:id/merge` | `apps/web/app/admin/actions.ts:107` |
| DELETE | `/players/:id` | `apps/web/app/admin/(panel)/players/page.tsx:19`; `apps/web/app/admin/(panel)/players/[id]/page.tsx:18`; `apps/web/app/admin/(panel)/players/[id]/page.tsx:32`; `apps/web/app/admin/actions.ts:93` |
| GET | `/predict/rules` | `apps/web/app/predict/page.tsx:176` |
| GET | `/predict/tournaments` | `apps/web/app/overlay/predict/data/route.ts:16`; `apps/web/app/predict/page.tsx:175`; `apps/web/app/special/page.tsx:35`; `apps/bot/src/predict.ts:323` |
| GET | `/predict/tournaments/:id` | `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:40`; `apps/web/app/overlay/predict/data/route.ts:18`; `apps/web/app/predict/page.tsx:182`; `apps/web/components/predict/Cheer.tsx:16` |
| GET | `/predict/leaderboard` | `apps/web/app/predict/page.tsx:177`; `apps/bot/src/predict.ts:462` |
| GET | `/predict/members/:discordId` | `apps/web/app/me/page.tsx:54`; `apps/web/app/predict/page.tsx:178`; `apps/web/components/predict/Cheer.tsx:17`; `apps/bot/src/predict.ts:401` |
| POST | `/predict/members/:discordId/daily` | `apps/web/app/predict/actions.ts:22`; `apps/bot/src/predict.ts:451` |
| POST | `/predict/members/:discordId/watch` | `apps/web/app/predict/actions.ts:68` |
| POST | `/predict/members/:discordId/bets` | `apps/web/app/predict/actions.ts:37`; `apps/bot/src/predict.ts:440` |
| DELETE | `/predict/members/:discordId/bets/:marketId` | `apps/web/app/predict/actions.ts:55`; `apps/bot/src/predict.ts:423` |
| POST | `/predict/members/:discordId/rewards/:id/received` | `apps/web/app/predict/actions.ts:78`; `apps/bot/src/predict.ts:396` |
| PATCH | `/predict/markets/:id` | `apps/web/app/admin/actions.ts:765`; `apps/web/app/admin/actions.ts:791`; `apps/bot/src/predict.ts:384` |
| POST | `/predict/tournaments/:id/status` | `apps/web/app/admin/actions.ts:770`; `apps/bot/src/predict.ts:518` |
| POST | `/predict/tournaments/:id/markets` | `apps/web/app/admin/actions.ts:780`; `apps/bot/src/predict.ts:510` |
| POST | `/predict/markets/:id/settle` | `apps/web/app/admin/actions.ts:787`; `apps/bot/src/predict.ts:387` |
| DELETE | `/predict/markets/:id` | `apps/web/app/admin/actions.ts:765`; `apps/web/app/admin/actions.ts:791`; `apps/bot/src/predict.ts:384` |
| GET | `/predict/codes` | `apps/web/app/admin/(panel)/predict/page.tsx:17`; `apps/web/app/admin/actions.ts:665`; `apps/bot/src/manage.ts:373`; `apps/bot/src/manage.ts:473` |
| POST | `/predict/codes` | `apps/web/app/admin/(panel)/predict/page.tsx:17`; `apps/web/app/admin/actions.ts:665`; `apps/bot/src/manage.ts:373`; `apps/bot/src/manage.ts:473` |
| DELETE | `/predict/codes` | `apps/web/app/admin/(panel)/predict/page.tsx:17`; `apps/web/app/admin/actions.ts:665`; `apps/bot/src/manage.ts:373`; `apps/bot/src/manage.ts:473` |
| GET | `/predict/rewards` | `apps/web/app/admin/(panel)/predict/page.tsx:18`; `apps/web/app/admin/actions.ts:690`; `apps/bot/src/manage.ts:332`; `apps/bot/src/manage.ts:495` |
| POST | `/predict/rewards` | `apps/web/app/admin/(panel)/predict/page.tsx:18`; `apps/web/app/admin/actions.ts:690`; `apps/bot/src/manage.ts:332`; `apps/bot/src/manage.ts:495` |
| GET | `/predict/rewards/unnotified` | `apps/bot/src/predict.ts:360` |
| POST | `/predict/rewards/:id/notified` | `apps/bot/src/predict.ts:366` |
| PATCH | `/predict/rewards/:id` | `apps/web/app/admin/actions.ts:712`; `apps/web/app/admin/actions.ts:721`; `apps/bot/src/manage.ts:601`; `apps/bot/src/manage.ts:629` |
| DELETE | `/predict/rewards/:id` | `apps/web/app/admin/actions.ts:712`; `apps/web/app/admin/actions.ts:721`; `apps/bot/src/manage.ts:601`; `apps/bot/src/manage.ts:629` |
| GET | `/rankings/teams` | `apps/web/app/page.tsx:25`; `apps/bot/src/bot.ts:531` |
| GET | `/rankings/players` | `apps/web/app/admin/(panel)/page.tsx:178`; `apps/web/app/page.tsx:117`; `apps/web/app/players/[id]/page.tsx:116`; `apps/web/app/special/page.tsx:61` |
| GET | `/rankings/mmr` | `apps/bot/src/ladder.ts:158` |
| GET | `/rankings/tiers` | `apps/web/app/players/[id]/page.tsx:14` |
| GET | `/settings` | `apps/web/app/admin/actions.ts:745`; `apps/web/lib/settings.ts:10`; `apps/bot/src/invite.ts:10`; `apps/bot/src/invite.ts:14` |
| PATCH | `/settings` | `apps/web/app/admin/actions.ts:745`; `apps/web/lib/settings.ts:10`; `apps/bot/src/invite.ts:10`; `apps/bot/src/invite.ts:14` |
| GET | `/special` | `apps/web/app/admin/(panel)/reserve/page.tsx:37`; `apps/web/app/admin/(panel)/seasons/page.tsx:25`; `apps/web/app/admin/(panel)/seasons/[id]/page.tsx:35`; `apps/web/app/admin/actions.ts:461` |
| GET | `/special/stories` | `apps/bot/src/season.ts:79` |
| GET | `/special/seasons` | `apps/web/app/admin/actions.ts:607`; `apps/web/app/page.tsx:27`; `apps/web/app/special/story/page.tsx:24`; `apps/web/lib/seasons.ts:8` |
| GET | `/special/seasons/:id` | `apps/web/app/admin/(panel)/seasons/[id]/page.tsx:19`; `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:43`; `apps/web/app/admin/actions.ts:617`; `apps/web/app/admin/actions.ts:627` |
| GET | `/special/seasons/:id/stories` | `apps/web/app/admin/(panel)/seasons/[id]/page.tsx:21`; `apps/bot/src/manage.ts:430` |
| PUT | `/special/seasons/:id/stories` | `apps/web/app/admin/(panel)/seasons/[id]/page.tsx:21`; `apps/bot/src/manage.ts:430` |
| POST | `/special/seasons` | `apps/web/app/admin/actions.ts:607`; `apps/web/app/page.tsx:27`; `apps/web/app/special/story/page.tsx:24`; `apps/web/lib/seasons.ts:8` |
| PATCH | `/special/seasons/:id` | `apps/web/app/admin/(panel)/seasons/[id]/page.tsx:19`; `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:43`; `apps/web/app/admin/actions.ts:617`; `apps/web/app/admin/actions.ts:627` |
| DELETE | `/special/seasons/:id` | `apps/web/app/admin/(panel)/seasons/[id]/page.tsx:19`; `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:43`; `apps/web/app/admin/actions.ts:617`; `apps/web/app/admin/actions.ts:627` |
| POST | `/special/seasons/:id/players` | `apps/web/app/admin/actions.ts:639`; `apps/bot/src/season.ts:195` |
| DELETE | `/special/seasons/:id/players/:playerId` | `apps/web/app/admin/actions.ts:653`; `apps/bot/src/season.ts:209` |
| GET | `/special/ranks` | No literal caller found; integration / dynamic caller usage unknown |
| GET | `/special/reserve` | No literal caller found; integration / dynamic caller usage unknown |
| GET | `/special/reserve/private` | No literal caller found; integration / dynamic caller usage unknown |
| PATCH | `/special/reserve/:playerId` | `apps/web/app/admin/(panel)/reserve/page.tsx:24`; `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:42`; `apps/web/app/admin/actions.ts:454`; `apps/web/app/admin/actions.ts:467` |
| DELETE | `/special/reserve/:playerId` | `apps/web/app/admin/(panel)/reserve/page.tsx:24`; `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:42`; `apps/web/app/admin/actions.ts:454`; `apps/web/app/admin/actions.ts:467` |
| POST | `/special/reserve/import` | `apps/bot/src/pool.ts:193` |
| GET | `/stats/overview` | `apps/web/app/page.tsx:24` |
| GET | `/stats/search` | `apps/bot/src/ladder.ts:150` |
| GET | `/stats/admin` | `apps/web/lib/adminData.ts:7` |
| GET | `/teams` | `apps/web/app/admin/(panel)/matches/new/page.tsx:15`; `apps/web/app/admin/(panel)/matches/page.tsx:23`; `apps/web/app/admin/(panel)/matches/[id]/page.tsx:17`; `apps/web/app/admin/(panel)/page.tsx:35` |
| POST | `/teams` | `apps/web/app/admin/(panel)/matches/new/page.tsx:15`; `apps/web/app/admin/(panel)/matches/page.tsx:23`; `apps/web/app/admin/(panel)/matches/[id]/page.tsx:17`; `apps/web/app/admin/(panel)/page.tsx:35` |
| GET | `/teams/:id` | `apps/web/app/admin/(panel)/teams/[id]/page.tsx:16`; `apps/web/app/admin/(panel)/teams/[id]/page.tsx:23`; `apps/web/app/admin/actions.ts:70`; `apps/web/app/admin/actions.ts:75` |
| PATCH | `/teams/:id` | `apps/web/app/admin/(panel)/teams/[id]/page.tsx:16`; `apps/web/app/admin/(panel)/teams/[id]/page.tsx:23`; `apps/web/app/admin/actions.ts:70`; `apps/web/app/admin/actions.ts:75` |
| GET | `/teams/:id/invite` | No literal caller found; integration / dynamic caller usage unknown |
| DELETE | `/teams/:id` | `apps/web/app/admin/(panel)/teams/[id]/page.tsx:16`; `apps/web/app/admin/(panel)/teams/[id]/page.tsx:23`; `apps/web/app/admin/actions.ts:70`; `apps/web/app/admin/actions.ts:75` |
| GET | `/tournaments` | `apps/web/app/admin/(panel)/matches/new/page.tsx:14`; `apps/web/app/admin/(panel)/matches/page.tsx:22`; `apps/web/app/admin/(panel)/matches/[id]/page.tsx:16`; `apps/web/app/admin/(panel)/page.tsx:37` |
| POST | `/tournaments` | `apps/web/app/admin/(panel)/matches/new/page.tsx:14`; `apps/web/app/admin/(panel)/matches/page.tsx:22`; `apps/web/app/admin/(panel)/matches/[id]/page.tsx:16`; `apps/web/app/admin/(panel)/page.tsx:37` |
| GET | `/tournaments/:id` | `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:27`; `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:189`; `apps/web/app/admin/actions.ts:130`; `apps/web/app/admin/actions.ts:730` |
| PATCH | `/tournaments/:id` | `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:27`; `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:189`; `apps/web/app/admin/actions.ts:130`; `apps/web/app/admin/actions.ts:730` |
| DELETE | `/tournaments/:id` | `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:27`; `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:189`; `apps/web/app/admin/actions.ts:130`; `apps/web/app/admin/actions.ts:730` |
| POST | `/tournaments/:id/entries` | `apps/web/app/admin/actions.ts:158` |
| DELETE | `/tournaments/:id/entries/:teamId` | `apps/web/app/admin/actions.ts:170`; `apps/bot/src/tour.ts:539`; `apps/bot/src/tour.ts:1226` |
| POST | `/tournaments/:id/registrations` | `apps/web/app/admin/actions.ts:301`; `apps/bot/src/tour.ts:707`; `apps/bot/src/tour.ts:751`; `apps/bot/src/tour.ts:1341` |
| PUT | `/tournaments/:id/entries/:teamId/roster` | `apps/web/app/admin/actions.ts:288`; `apps/bot/src/tour.ts:792`; `apps/bot/src/tour.ts:1246`; `apps/bot/src/tour.ts:1360` |
| GET | `/tournaments/:id/solo` | `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:36`; `apps/web/app/tournaments/[id]/SoloSection.tsx:14`; `apps/bot/src/tour.ts:1038` |
| POST | `/tournaments/:id/solo/draw` | `apps/web/app/admin/actions.ts:311`; `apps/bot/src/tour.ts:1074`; `apps/bot/src/tour.ts:1086` |
| POST | `/tournaments/:id/solo/teams` | `apps/web/app/admin/actions.ts:321`; `apps/bot/src/tour.ts:1083` |
| DELETE | `/tournaments/:id/solo/:playerId` | `apps/web/app/admin/actions.ts:311`; `apps/web/app/admin/actions.ts:321`; `apps/web/app/admin/actions.ts:332`; `apps/bot/src/tour.ts:1074` |
| GET | `/tournaments/:id/stories` | `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:39`; `apps/web/app/tournaments/[id]/page.tsx:23` |
| PUT | `/tournaments/:id/stories` | `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:39`; `apps/web/app/tournaments/[id]/page.tsx:23` |
| GET | `/tournaments/:id/drafts` | `apps/web/app/tournaments/[id]/page.tsx:24`; `apps/web/app/tournaments/[id]/picks/page.tsx:73` |
| PUT | `/tournaments/:id/drafts/:ref` | External broadcast/draft-key integration; no bundled application caller found |
| DELETE | `/tournaments/:id/drafts/:ref` | External broadcast/draft-key integration; no bundled application caller found |
| GET | `/tournaments/:id/bracket` | `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:35`; `apps/web/app/tournaments/[id]/page.tsx:21`; `apps/bot/src/manage.ts:582`; `apps/bot/src/tour.ts:438`; admin bracket helpers / Discord tour module |
| POST | `/tournaments/:id/bracket/seed` | `apps/bot/src/tour.ts:497`; `apps/bot/src/tour.ts:872`; `apps/bot/src/tour.ts:874`; `apps/bot/src/tour.ts:931`; admin bracket helpers / Discord tour module |
| POST | `/tournaments/:id/bracket/start` | `apps/bot/src/tour.ts:891`; admin bracket helpers / Discord tour module |
| POST | `/tournaments/:id/bracket/end` | `apps/bot/src/tour.ts:1939`; admin bracket helpers / Discord tour module |
| DELETE | `/tournaments/:id/bracket` | `apps/web/app/admin/(panel)/tournaments/[id]/page.tsx:35`; `apps/web/app/tournaments/[id]/page.tsx:21`; `apps/bot/src/manage.ts:582`; `apps/bot/src/tour.ts:438`; admin bracket helpers / Discord tour module |
| POST | `/tournaments/:id/bracket/schedule` | `apps/bot/src/tour.ts:515`; admin bracket helpers / Discord tour module |
| GET | `/tournaments/:id/bracket/matches/:match` | `apps/web/app/admin/(panel)/matches/new/page.tsx:22`; admin bracket helpers / Discord tour module |
| POST | `/tournaments/:id/bracket/matches/:match/result` | `apps/bot/src/bot.ts:321`; admin bracket helpers / Discord tour module |
| POST | `/tournaments/:id/bracket/matches/:match/walkover` | `apps/bot/src/tour.ts:963`; `apps/bot/src/tour.ts:1376`; admin bracket helpers / Discord tour module |
| POST | `/tournaments/:id/bracket/matches/:match/reopen` | `apps/bot/src/tour.ts:1390`; admin bracket helpers / Discord tour module |
| POST | `/tournaments/:id/bracket/matches/:match/checkin` | `apps/bot/src/tour.ts:948`; admin bracket helpers / Discord tour module |
| POST | `/tournaments/:id/bracket/matches/:match/dispute` | `apps/bot/src/tour.ts:990`; `apps/bot/src/tour.ts:1022`; admin bracket helpers / Discord tour module |
| GET | `/trash` | `apps/web/app/admin/(panel)/trash/page.tsx:11`; `apps/bot/src/trash.ts:40` |
| POST | `/trash/:id/restore` | `apps/web/app/admin/actions.ts:493`; `apps/bot/src/trash.ts:59` |
| DELETE | `/trash/:id` | `apps/web/app/admin/actions.ts:504` |
| POST | `/uploads` | `apps/bot/src/api.ts:53` |
| GET | `/extract/status` | `apps/web/app/admin/(panel)/matches/new/page.tsx:17`; `apps/web/app/admin/(panel)/matches/[id]/page.tsx:19`; `apps/web/app/admin/(panel)/page.tsx:38` |
| POST | `/extract/series` | `apps/bot/src/results.ts:87` |

Supporting API routes outside this table: `/health`, `/health/ready`, `/docs`, `/openapi.json`, static `/uploads`, and `/api/v1/revision`. Used by deployment, documentation, uploaded assets, public refresh, and the bot. Rankings `/mmr` is mounted in the rankings router and delegates to the rankings module.

## Manual conclusions

- `GET /players/uid/:uid`: documented integration lookup; no website or bot caller found. Retain.
- `/matches/by-source`: bot result deduplication. Retain.
- Tournament registration, roster, check-in and dispute routes serve admin / Discord workflows. Preserve authorization and backend validation.
- Directory, prediction and special-season navigation has been reconnected; existing detail links and hashes remain valid.
