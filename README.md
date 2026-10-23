# Team Scoreboard

Personal schedules, live scores and recent results for every NFL, NBA and MLB game, Big Ten football and men's basketball, plus Purdue varsity sports. Games are grouped into Purdue, Big Ten, NFL, NBA and MLB sections, each split by day, and times use a 24-hour clock. Purdue's Big Ten games appear in both the Purdue and Big Ten sections. With Show set to All teams, sections start collapsed; any other Show filter opens every section. Switching back to All teams collapses them again. Select a section header to expand or collapse it, or use Expand all and Collapse all above the sections. Three tabs run Current, Recent and Upcoming. Current opens by default and shows all of today's games: in progress first, then finals, then games still to start. Feed coverage and fetch status are on a separate Source status page (#status), opened from the header. Favorite teams are highlighted and listed first within each day (except when Show is Favorites, a single team or Purdue), and favorites are shared across devices.

## Status

Deployed on jimbrownhome1 through the solution-deploy framework: https://team-scoreboard.jimlertech.com/ behind Cloudflare Access, with a Tailscale fallback on port 8801. Favorites live in the `team_scoreboard` PostgreSQL database. iPhone and iPad layout is unverified on device.

## Data and coverage

The app reads ESPN's public, undocumented `site.api.espn.com` endpoints. They need no key. ESPN can change or remove them without notice, so a broken feed shows an error and keeps the last good data.

NFL, NBA and MLB come from each league's scoreboard (`/apis/site/v2/sports/{sport}/{league}/scoreboard`), which carries live scores. Big Ten football and men's basketball use the college scoreboards filtered to the conference (`?groups=5` for football, `?groups=7` for basketball). NBA, MLB and Big Ten basketball are fetched one Eastern day per request (`?dates=YYYYMMDD`) from 14 days back through 7 days ahead. NFL and Big Ten football are fetched by week (`?week=N&seasontype=T`): the current week, enough past weeks to cover 14 days, and next week. Recent shows finals from the last 14 days plus past postponed or canceled games, and Upcoming shows today through the next 7 days plus games without a date, never a past date. The Show filter (all teams, favorites, a league or one team) sits on the same row as the tabs.

Purdue programs use the team schedule endpoint (`/teams/{id}/schedule`) and show live games, the last 3 results and the next 5 games. When the default schedule is empty the server retries once with `?seasontype=2`. ESPN answers HTTP 400 for some sports with no current season; that is treated as no games. Purdue feeds cover football, men's and women's basketball, volleyball, women's soccer (team 20519), baseball (189) and softball (601, under `baseball/college-softball`). Other Purdue programs link to their official schedule.

The catalog lists all 92 pro teams. The 34 teams from the first release keep their original IDs because favorites are stored in PostgreSQL; new teams use `<league>-<espnId>`. Each team's `providerId` holds the ESPN `sport/league/teamId` path.

Caching is in process. Scoreboard pages with a live game or one starting within 30 minutes refetch every 5 minutes, today's page every 10 minutes and future pages every 30 minutes. Past days whose games are all final, postponed or canceled stay cached for 24 hours and are saved to `SCOREBOARD_CACHE_FILE` (on the host, `shared\data\scoreboard-cache.json`), so a restart or deploy doesn't refetch two weeks of finals. Purdue feeds refresh every 5 minutes while hot and every 15 minutes otherwise. Opening or reloading the page shows cached scores, then requests `GET /api/dashboard?refresh=all`, which refetches every page and Purdue feed that can still change before answering; settled past days keep their scores. It is a GET so the read-only web-standard check passes. The Refresh button and last-updated time sit in the sticky header on every page. Refresh posts `/api/refresh` with `scope: live` and refetches only pages and feeds with a game in progress or starting within 30 minutes. Each scope forces at most one ESPN fetch per 30 seconds. Requests share a queue with 500 ms between calls, bounded timeouts and rate-limit backoff, so a cold load of every scoreboard takes about 40 seconds. Favorites remain in PostgreSQL. The browser polls every 20 seconds and pauses while hidden. The server also reads the dashboard feeds every 60 seconds with no page open, so caches stay warm and alerts fire on time.

Each card shows the TV channel (ESPN `broadcasts`) and each team's overall record (`records` on scoreboards, `record` on Purdue schedules, and the team's current `recordSummary` on games still to play). Rankings are not shown.

Keyboard shortcuts: `1`, `2` and `3` (number row or numpad) open Current, Recent and Upcoming; `A`, `P`, `F`, `K` and `B` set Show to All teams, Purdue, NFL, NBA and MLB; `X` expands all sections, `C` collapses them and `R` refreshes live scores. They are ignored while typing in a field, while a dropdown is open, and with Ctrl, Alt or Cmd held. Hovering each button shows its key, and `?` opens an overlay listing every shortcut (Esc, `?` or a click outside closes it).

Live cards show the game situation when ESPN sends it: down, distance, red zone and a possession square for football; outs, runners and the count for baseball. When a poll changes a score, that score flashes for 2.5 seconds (a static outline with reduced motion). The two loads at page open only set the starting scores, so nothing flashes then.

Purdue's Big Ten games arrive from both the Purdue schedule and the Big Ten scoreboard. `shared/reconcile.ts` keeps one copy per ESPN event, preferring the scoreboard copy, and every section shows its score and situation.

## Calendar feed

`GET /calendar/<CALENDAR_TOKEN>.ics` serves an iCalendar subscription for the alert teams (pro favorites plus Purdue football and men's basketball): the last 30 days and the rest of the season, one event per game with a stable `UID`, finals titled with the score, and `REFRESH-INTERVAL` of 1 hour. Team seasons are cached 6 hours. If any team's schedule has never loaded, the feed answers 503 with `Retry-After: 900` so a calendar keeps its events instead of receiving an empty feed.

Cloudflare Access bypasses only `team-scoreboard.jimlertech.com/calendar/*` (an Everyone bypass app made by `Set-CloudflareHostnames.ps1 -PublishTeamScoreboardCalendar`), so calendar apps can fetch it. The token is the protection: `CALENDAR_TOKEN` in the host `shared\secrets\app.env` is 32 random bytes in base64url, compared in constant time. A wrong token, or a missing or shorter than 32 character token, returns 404. The page heading shows a Calendar menu with Download, Copy link and Subscribe (`webcal://`) only when the feed is configured; `/api/calendar` stays behind Access. `CALENDAR_ORIGIN` overrides the public origin in that link.

To rotate the token, replace `CALENDAR_TOKEN` in `app.env`, restart the app, and subscribe again with the new link; the old link then returns 404.

## Game alerts

When `PUSHOVER_USER_KEY` and `PUSHOVER_APP_TOKEN` are set, the server sends a Pushover alert when a favorite's game starts (with the channel) and when it ends (with the final score). Purdue alerts cover football and men's basketball only. The first sighting of a game after a restart only records its status, so a deploy never replays alerts. Without both values, alerts are off and the server logs that once. The Pushover application icon is [deploy/pushover-icon.png](deploy/pushover-icon.png) (72×72).

Terms: [Disney terms of use section 2.B.x](https://disneytermsofuse.com/english/) limits automated extraction. This is a personal app behind Cloudflare Access, used with that risk accepted. No ESPN artwork is used.

## Development

Use Node 22.12 or newer:

```powershell
npm ci
npm run dev
```

Vite serves the frontend at `http://127.0.0.1:5173`. It proxies `/api` to loopback port 8801. A separately started backend needs a reviewed, initialized PostgreSQL database and the protected runtime environment values described in `.env.example`. Build before starting:

```powershell
npm run build
npm start
```

The backend never creates or migrates a database at startup. Missing configuration fails startup; failed storage/schema checks fail readiness. There is no JSON/SQLite fallback. Tests use in-memory store doubles or HTTP fixture routes, with no real database writes.

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Browser tests use installed Microsoft Edge. Test data is explicitly synthetic and is never used as production fallback.

## Database and deployment

Proposed production database: `team_scoreboard` on `jimbrownhome1:5432`, `public` schema, with separate owner/migration/runtime roles. The runtime can modify favorites, but cannot create schema objects or write deployment ledgers. The schema is in `deploy\postgresql\001_initial.sql`; run only through the framework after independent review and explicit provisioning approval. Test database creation, writes, and deletion also require independent review.

The app listens only on loopback. Public frontend and API routes require the same Cloudflare Access policy, with no write-API bypass. Private access relies on Tailscale ACLs. Mutations require an allowed Origin and JSON content type, and validate IDs against the catalog. Do not expose the origin directly to the public internet.

Production allocation, pending port checks and approval:

- Hostname: `https://team-scoreboard.jimlertech.com/`
- Tailscale: `https://jimbrownhome1.tail8ad282.ts.net:8801/`
- Startup task: `\JimlerTech\SolutionDeploy-team-scoreboard`, limited account at system startup.
- Manifest: `deploy\application.json`.

Follow `solution-deploy\docs\Deployment.md`, `PostgreSQL.md`, and `PostgreSQLBackups.md`. Use FirstInstall, not legacy conversion. Generate exact provisioning/grant SQL with the framework. Validate backup and isolated restore before activation. Do not run ad-hoc DDL or hand-copy release files.

Database creation, staging, and activation are separate production approvals. Add the live directory entry, checker theme key `team-scoreboard-theme`, Cloudflare allowlist/Access route via `Set-CloudflareHostnames.ps1`, Tailscale Serve route, and Site Dock favorite as part of approved deployment. Verify both private and public paths and windowless startup/reboot before claiming deployment is complete.

The theme defaults to Midnight and supports Light and live System preference. PWA appearance remains unverified until checked on iPhone portrait and iPad landscape, both themes across two launches.
