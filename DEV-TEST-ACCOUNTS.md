# Developer test accounts

These accounts work only on localhost in development mode with `TEST_LOGIN_ENABLED=1`. They cannot be used in production. Use a separate browser profile or private window for each simultaneous session.

To create 24 test characters in the configured local SQLite database, run in PowerShell:

```powershell
$env:NODE_ENV = 'development'
$env:TEST_LOGIN_ENABLED = '1'
npm run seed:dev-accounts
npm run dev
```

Open `http://localhost:3000/login?test=client` and select Client 01 through Client 24. Log in with a different account in each browser profile. The existing Client test account remains Client 01. The login clears any administrator session in that browser.

| Accounts | In-game rank |
| --- | --- |
| Client 01–06 | แม่ทัพไร้มงกุฎ |
| Client 07–12 | ซูเปอร์สตาร์ ม.ปลาย |
| Client 13–18 | รุ่นแห่งปาฏิหาริย์ |
| Client 19–24 | เจ้าแห่ง ZONE |

The seed is optional and repeatable: it fills missing characters and reapplies these fixture ranks to existing test accounts without creating duplicates. It links characters to Kuroko's Basketball: Street Rivals and assigns new characters Guard, Forward and Center evenly (two of each per rank). It also creates missing reserve signups with their rank and position, making them immediately available in the admin reserve draw for that game. Existing names, positions, MMR, match history and tournament/reserve signup edits are preserved. Test characters still need their player profile completed before registering for events. No tournament or season membership is created automatically; a tournament linked to a season only draws from that season's members. If custom game ranks exclude these four ranks, the seed stops and rolls back instead of changing the game's rank configuration.
