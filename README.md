# Team Scoreboard

Personal schedules, live scores and recent results for the Colts, Seahawks, Pacers, Giants, and Purdue varsity sports, with editable favorites shared across devices.

## Status

Local application implemented with passing unit and browser tests. Not deployed. No production database has been created. Real PostgreSQL persistence, public/private access, and startup acceptance remain unverified.

## Data and coverage

The app reads ESPN's public, undocumented `site.api.espn.com` team schedule endpoint (`/apis/site/v2/sports/{sport}/{league}/teams/{id}/schedule`). It needs no key. ESPN can change or remove it without notice, so a broken feed shows an error and keeps the last good data.

Each team shows live games, its last 3 results and its next 5 games. When the default schedule is empty (for example MLB in October or college basketball before its season), the server retries once with `?seasontype=2`. Postseason games outside the default schedule may be missing. ESPN answers HTTP 400 for some sports with no current season; that is treated as no games.

ESPN feeds cover the pro teams and Purdue football, men's and women's basketball, volleyball, women's soccer (team 20519), baseball (189) and softball (601, under `baseball/college-softball`). Other Purdue programs link to their official schedule. The catalog keeps its original app IDs, which are stored in PostgreSQL; each team's `providerId` holds the ESPN `sport/league/teamId` path.

Each feed is cached in process for 15 minutes. Requests share a queue with 500 ms between calls, bounded timeouts and rate-limit backoff. A failed refresh keeps prior data and shows an error/stale label. Restarting clears this cache; favorites remain in PostgreSQL. The browser pauses refresh while hidden.

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
