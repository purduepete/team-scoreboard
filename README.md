# Team Scoreboard

Personal schedules and recent results for the Colts, Seahawks, Pacers, Giants, and Purdue varsity sports, with editable favorites shared across devices.

## Status

Local application implemented with passing unit and browser tests. Not deployed. No production database has been created. Real PostgreSQL persistence, public/private access, and startup acceptance remain unverified.

## Data and coverage

The app uses [TheSportsDB's documented free API](https://www.thesportsdb.com/documentation). No live scores, full-season schedules, or complete team coverage are promised. The free endpoints return at most **one upcoming event and one previous result** and document possible home-game-only restrictions. Empty results do not mean that a team has no games. Data can be missing, delayed, or changed.

The initial professional teams and Purdue football returned usable data during read-only probes. The Giants returned a recent result but no upcoming event. Other Purdue programs have verified official schedule links, with no configured free score feed. The editable catalog includes a limited selection of NFL, NBA, and MLB teams obtained from the provider's free league listings, plus the Purdue programs. It is deliberately not a worldwide team search.

Each feed is cached in process for 15 minutes and refreshed on demand. Requests share a queue with at least 6 seconds between calls (10/minute), bounded timeouts, and rate-limit backoff. First fetches can take a minute or longer. A failed refresh retains prior data and shows an error/stale label. Restarting clears this cache; favorites remain in PostgreSQL. The browser pauses refresh while hidden.

Source permissions: [API terms](https://www.thesportsdb.com/docs_terms_of_use.php), [pricing and free-tier limits](https://www.thesportsdb.com/pricing). The free API key `123` is the documented public development key, not a secret. No provider artwork is used. The undocumented ESPN endpoints are excluded because permission for automated extraction has not been established under [Disney section 2.B.x](https://disneytermsofuse.com/english/).

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
