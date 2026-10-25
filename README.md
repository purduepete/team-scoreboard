# Team Scoreboard

Personal schedules, live scores and recent results for every NFL, NBA and MLB game, Big Ten football and men's basketball, plus Purdue varsity sports. Games are grouped into Purdue, Big Ten, NFL, NBA and MLB sections, each split by day, and times use a 24-hour clock. Purdue's Big Ten games appear in both the Purdue and Big Ten sections. With Show set to All teams, sections start collapsed; any other Show filter opens every section. Switching back to All teams collapses them again. Select a section header to expand or collapse it, or use the icon-only Expand all / Collapse all pill to the right of the Show filter. Three tabs run Current, Upcoming and Recent. Current opens by default and shows all of today's games. Feed coverage and fetch status are on a separate Source status page (#status), opened from Tools. Favorite teams are highlighted and listed first within each league/day group (except when Show is Favorites, a single team or Purdue), and favorites are shared across devices.

Within each league/day group, favorites come first, even before they start. In the Purdue group, favorite cards keep the normal background; their star and accent left border remain. In Current, favorites and non-favorites each run in progress, final, then still to start, with start times oldest to newest within each status. Final games have a bold accent-filled Final badge only in Current. Recent uses plain status text, and final cards have no hatch in any view.

## Compact mode

The header's Active games only toggle keeps the selected teams/leagues and shows only games in progress, including eligible Custom games. It temporarily uses Current and disables the schedule tabs; turning it off restores the previous tab. It works in both grouped and compact mode, and this browser remembers the setting. The clock icon and Last refresh time are at the bottom of the page; the manual Refresh button stays in the header.

The header's Compact mode button shows a single grid using the current schedule view and Show selections. It hides the toolbar, filters, league/date headings and section controls, and includes matching games even from collapsed sections. Exit compact mode restores those controls and their selections. Filter/view keyboard shortcuts are paused in compact mode; refresh remains available. This browser remembers compact mode across reloads.

Favorites appear first across leagues, ordered by start time from oldest to newest. Remaining cards follow Purdue, Big Ten, NFL, NBA, MLB, then other leagues, each ordered by start time from oldest to newest. Games without a start time come last in their group. Eligible Custom games join the grid, shared events appear once, and Custom loading/error/no-game cards remain visible. Source status is in Tools; its page has a Back to scores link.

Tools has 2 rows: Find team and Edit favorites first, then the icon-only Source status link and Calendar. Each row uses one-third of the available button width on the left and two-thirds on the right. Calendar appears when the server has a configured feed.

## Add a college team for today

Custom stays hidden until at least 1 team is added. Removing the last team or reaching local midnight hides it again. Find team remains available when Custom is hidden.

On Current, select the magnifying glass immediately left of Edit favorites to find a team. Find team switches Show to All teams. Custom is the last group below the league sections and appears only on Current with Show set to All teams. It collapses like the other groups, including with the expand/collapse pill and X shortcut. The search opens in a modal; close it with Escape, its close button or a click outside. Choose College football or College basketball, and enter at least 2 characters. College basketball covers men's games. Select Add to pin a team's games in Custom. NBA, MLB and NFL already have full scoreboard coverage and aren't included in this search.

Adding a team closes the modal and clears the search. Custom teams stay in this browser until local midnight, including across reloads. Remove a team with the X button left of the time inside its score card (or in its status card when no game is available); up to 20 teams can be added. Custom cards use the same responsive grid as league cards, without extra team-name labels or a pinned note. These additions don't change favorites, calendar subscriptions or game alerts. A game shared by 2 custom teams appears once in Custom and can also appear in its normal league section. If a team has no game today, the page says so. Loading, failed and stale feeds have separate messages.

The server validates team IDs against ESPN's college directories. Directory requests are cached for 24 hours with shared in-flight requests and retry backoff. Ad-hoc feeds use full schedules, with the browser selecting today's local date. Live games also fetch ESPN event details because team schedules can omit live scores. Routine background refreshes keep the existing score card visible without an extra loading card; failures remain visible. Their separate cache holds up to 128 teams, refreshing hot schedules every 30 seconds and other schedules every 15 minutes. The browser polls every 20 seconds while visible; Refresh requests these feeds after the main dashboard refresh, respecting the same cache intervals.

## Status

Deployed on jimbrownhome1 through the solution-deploy framework: https://team-scoreboard.jimlertech.com/ behind Cloudflare Access, with a Tailscale fallback on port 8801. Favorites live in the `team_scoreboard` PostgreSQL database. iPhone and iPad layout checked on device 10/24/2026.

## Data and coverage

The view and expand/collapse controls have square corners. Their selected background slides between buttons, including keyboard changes. Expand all starts the slide before rendering the opened sections, opened sections fade in over 200 ms, and the page reserves scrollbar space so the toolbar does not shift. Reduced-motion preferences disable these animations.

Live football cards keep a missing down-and-distance value for up to 60 seconds from its last observation, labeled “last reported,” while the clock/status, scores and possession remain unchanged. A new play snapshot or non-live status clears it immediately. This is temporary browser memory shared by the league and Custom card component, and resets when a card is removed or the page reloads. Red-zone and possession indicators always use the current feed.

The Show dropdown accepts multiple teams, leagues and Favorites, and shows games matching any checked choice. It stays open while specific choices are toggled. Selecting All teams clears the other checks, shows every team and closes the dropdown; choosing a specific option clears All teams. Removing the last specific choice returns to All teams. Escape, Tab or clicking outside closes the dropdown. Letter shortcuts replace the selection with their corresponding filter.

The app reads ESPN's public, undocumented `site.api.espn.com` endpoints. They need no key. ESPN can change or remove them without notice, so a broken feed shows an error and keeps the last good data.

NFL, NBA and MLB come from each league's scoreboard (`/apis/site/v2/sports/{sport}/{league}/scoreboard`), which carries live scores. Big Ten football and men's basketball use the college scoreboards filtered to the conference (`?groups=5` for football, `?groups=7` for basketball). NBA, MLB and Big Ten basketball are fetched one Eastern day per request (`?dates=YYYYMMDD`) from 14 days back through 7 days ahead. NFL and Big Ten football are fetched by week (`?week=N&seasontype=T`): the current week, enough past weeks to cover 14 days, and next week. Recent shows finals from the last 14 days plus past postponed or canceled games, and Upcoming shows today through the next 7 days plus games without a date, never a past date. The Show filter (all teams, favorites, leagues or teams) sits on the same row as the tabs.

Purdue programs use the team schedule endpoint (`/teams/{id}/schedule`) and show live games, the last 3 results and the next 5 games. When the default schedule is empty the server retries once with `?seasontype=2`. ESPN answers HTTP 400 for some sports with no current season; that is treated as no games. Purdue feeds cover football, men's and women's basketball, volleyball, women's soccer (team 20519), baseball (189) and softball (601, under `baseball/college-softball`). Other Purdue programs link to their official schedule.

The catalog lists all 92 pro teams. The 34 teams from the first release keep their original IDs because favorites are stored in PostgreSQL; new teams use `<league>-<espnId>`. Each team's `providerId` holds the ESPN `sport/league/teamId` path.

Caching is in process. Scoreboard pages with a live game or one starting within 30 minutes refetch every 30 seconds, today's page every 10 minutes and future pages every 30 minutes. Past days whose games are all final, postponed or canceled stay cached for 24 hours and are saved to `SCOREBOARD_CACHE_FILE` (on the host, `shared\data\scoreboard-cache.json`), so a restart or deploy doesn't refetch two weeks of finals. League feeds read those pages every 30 seconds while hot and every 60 seconds otherwise. Purdue feeds refresh every 30 seconds while hot and every 15 minutes otherwise. Opening or reloading the page shows cached scores, then requests `GET /api/dashboard?refresh=all`, which refetches every page and Purdue feed that can still change before answering; settled past days keep their scores. It is a GET so the read-only web-standard check passes. The Refresh button and last-updated time sit in the sticky header on every page. Refresh posts `/api/refresh` with `scope: live` and refetches only pages and feeds with a game in progress or starting within 30 minutes. Each scope forces at most one ESPN fetch per 30 seconds. Requests share a queue with 500 ms between calls, bounded timeouts and rate-limit backoff, so a cold load of every scoreboard takes about 40 seconds. Favorites remain in PostgreSQL. The browser polls every 20 seconds and pauses while hidden. When a poll finds a feed due, the server waits up to 5 seconds for that refetch so the same poll returns the new scores, so live scores show within about 30 to 40 seconds. The server also reads the dashboard feeds every 60 seconds with no page open, so caches stay warm and alerts fire on time.

Each card shows the TV channel (ESPN `broadcasts`) and each team's overall record (`records` on scoreboards, `record` on Purdue schedules, and the team's current `recordSummary` on games still to play). Rankings are not shown. NBA cards on a national network (an ESPN `national` market entry other than NBA TV, League Pass or NBCSN, for example ESPN, ABC, NBC or Peacock) get an accent corner in the top-right.

Keyboard shortcuts: `1`, `2` and `3` (number row or numpad) open Current, Upcoming and Recent; `A`, `P`, `F`, `K` and `B` set Show to All teams, Purdue, NFL, NBA and MLB; `X` toggles all sections (collapses when all are open, expands otherwise) and `R` refreshes live scores. They are ignored while typing in a field, while a dropdown is open, and with Ctrl, Alt or Cmd held. Hovering each button shows its key, and `?` opens an overlay listing every shortcut (Esc, `?` or a click outside closes it).

All game cards list the away team first and the home team second, without AWAY or HOME labels. Live cards show the game situation when ESPN sends it: down and distance, a football icon for possession and a red Red zone tag for football; outs, runners and the count for baseball. When a poll changes a score, that score flashes for 2.5 seconds (a static outline with reduced motion). The two loads at page open only set the starting scores, so nothing flashes then.

Purdue's Big Ten games arrive from both the Purdue schedule and the Big Ten scoreboard. `shared/reconcile.ts` keeps one copy per ESPN event, preferring the scoreboard copy, and every section shows its score and situation.

## Calendar feed

`GET /calendar/<CALENDAR_TOKEN>.ics` serves an iCalendar subscription for all favorites with ESPN coverage, including Purdue volleyball and every covered program in Purdue All Varsity: the last 30 days and the rest of the season, one event per game with a stable `UID`, finals titled with the score, and `REFRESH-INTERVAL` of 1 hour. Team seasons are cached 6 hours. If any team's schedule has never loaded, the feed answers 503 with `Retry-After: 900` so a calendar keeps its events instead of receiving an empty feed.

Cloudflare Access bypasses only `team-scoreboard.jimlertech.com/calendar/*` (an Everyone bypass app made by `Set-CloudflareHostnames.ps1 -PublishTeamScoreboardCalendar`), so calendar apps can fetch it. The token is the protection: `CALENDAR_TOKEN` in the host `shared\secrets\app.env` is 32 random bytes in base64url, compared in constant time. A wrong token, or a missing or shorter than 32 character token, returns 404. The page heading shows a Calendar menu with Download, Copy link and Subscribe (`webcal://`) only when the feed is configured; `/api/calendar` stays behind Access. `CALENDAR_ORIGIN` overrides the public origin in that link.

To rotate the token, replace `CALENDAR_TOKEN` in `app.env`, restart the app, and subscribe again with the new link; the old link then returns 404.

## Game alerts

When `PUSHOVER_USER_KEY` and `PUSHOVER_APP_TOKEN` are set, the server sends a Pushover alert when a favorite's game starts (with the channel) and when it ends (with the final score). Alerts follow all saved favorites, including individually selected Purdue programs and every program in Purdue All Varsity; programs without ESPN coverage cannot generate alerts. The first sighting of a game after a restart only records its status, so a deploy never replays alerts. Without both values, alerts are off and the server logs that once. The Pushover application icon is [deploy/pushover-icon.png](deploy/pushover-icon.png) (72×72).

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

Production runs on jimbrownhome1 through the solution-deploy controller:

- Hostname: `https://team-scoreboard.jimlertech.com/`, behind Cloudflare Access with no write-API bypass
- Tailscale: `https://jimbrownhome1.tail8ad282.ts.net:8801/`
- Database: `team_scoreboard` on `jimbrownhome1:5432`, `public` schema, separate owner, migration and runtime roles
- Startup task: `\JimlerTech\SolutionDeploy-team-scoreboard`, limited account at system startup
- Manifest: `deploy\application.json`

The app listens only on loopback. Mutations require an allowed Origin and JSON content type and validate IDs against the catalog.

To release a new version, commit and push, then run from `C:\Files\Dev\main\solution-deploy`:

```powershell
.\Deploy.ps1 -Action Release -App team-scoreboard -Target jimbrownhome1 -Commit origin/main -ApproveRelease -ApprovalReason 'commit, push and deploy' -DatabaseChangesReviewed
```

A new file under `deploy\postgresql\` needs an independent review before release. Procedure details are in `solution-deploy\docs\Deployment.md`.

The theme defaults to Midnight and supports Light and live System preference. PWA appearance was checked on iPhone and iPad on 10/24/2026.

The header shows the last refresh time, an icon-only refresh button, source status and an Appearance palette button. Appearance opens a square segmented theme pill. Refresh uses a centered circular loader while busy and respects reduced motion; source status remains available on both pages.

The theme pill lists Light, Midnight and System, with the same compact spacing and moon icon as Home Automation. On phone widths, Current / Upcoming / Recent fills its row. At every width, Tools sits immediately left of the teams filter and opens Calendar, Search and Edit favorites in one row that fills the popup. The scores page has no introductory heading.

Favorite game cards keep the normal background, with a thin accent outline, a 4px left stripe and a solid 16px star. Source status uses the header link to return to scores.
