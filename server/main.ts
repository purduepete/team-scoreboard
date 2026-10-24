import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { createApp, dashboardSources } from './app.js';
import { SportsProvider, maxDaysBack as resultDays } from './provider.js';
import { FeedCache } from './feeds.js';
import { PostgresFavorites } from './storage.js';
import { GameAlerts, alertTeamIds, pushoverSender } from './alerts.js';

if (!process.env.DATABASE_URL || process.env.STORAGE_BACKEND !== 'postgresql') {
    throw new Error('DATABASE_URL and STORAGE_BACKEND=postgresql are required. There is no file-storage fallback.');
}
const port = Number(process.env.PORT ?? '8801');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('PORT must be an integer from 1024 to 65535.');
const origins = (process.env.ALLOWED_ORIGINS ?? `http://127.0.0.1:${port},http://127.0.0.1:5173`)
    .split(',')
    .map((value) => value.trim());
for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol))
        throw new Error('Invalid ALLOWED_ORIGINS.');
}
const html = readFileSync(resolve('dist', 'index.html'), 'utf8');
const hashes = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .filter((match) => match[1].trim())
    .map((match) => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
const csp = [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Site Dock embeds this app from both of its access paths.
    "frame-ancestors 'self' https://site-dock.jimlertech.com https://jimbrownhome1.tail8ad282.ts.net:8790",
].join('; ');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, max: 4 });
pool.on('error', (error) => console.error('Idle PostgreSQL connection error:', error.message));
const provider = new SportsProvider(fetch, Date.now, undefined, process.env.SCOREBOARD_CACHE_FILE || undefined);
const store = new PostgresFavorites(pool);
const feeds = new FeedCache();
const app = createApp({
    store,
    feeds,
    sports: provider,
    allowedOrigins: origins,
    staticDirectory: resolve('dist'),
    contentSecurityPolicy: csp,
    ...(process.env.CALENDAR_TOKEN
        ? {
              calendar: {
                  token: process.env.CALENDAR_TOKEN,
                  origin: process.env.CALENDAR_ORIGIN ?? 'https://team-scoreboard.jimlertech.com',
              },
          }
        : {}),
});
if (!process.env.CALENDAR_TOKEN || process.env.CALENDAR_TOKEN.length < 32)
    console.warn('The calendar feed is off: CALENDAR_TOKEN is missing or shorter than 32 characters.');
const server = app.listen(port, '127.0.0.1', () => console.info(`Team Scoreboard listening on loopback port ${port}`));
const userKey = process.env.PUSHOVER_USER_KEY;
const appToken = process.env.PUSHOVER_APP_TOKEN;
const alerts = userKey && appToken ? new GameAlerts(pushoverSender(userKey, appToken)) : null;
if (!alerts) console.warn('Game alerts are off: PUSHOVER_USER_KEY and PUSHOVER_APP_TOKEN are not set.');
// Keeps scores current with no page open, so favorite alerts fire on time. Each feed still follows
// its own refresh timer; this only asks for the feeds a 14-day dashboard would show.
const watcher = setInterval(() => {
    void (async () => {
        try {
            const favorites = await store.list();
            const games = dashboardSources(favorites, provider, resultDays).flatMap(
                (source) => feeds.get(source).games
            );
            alerts?.observe(games, alertTeamIds(favorites));
        } catch (error) {
            console.error('Background refresh failed:', error instanceof Error ? error.message : error);
        }
    })();
}, 60_000);
let stopping = false;
async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(stopWatcher);
    clearInterval(watcher);
    const deadline = setTimeout(() => {
        console.error('Graceful stop exceeded 15 seconds.');
        process.exit(1);
    }, 15_000);
    deadline.unref();
    server.close(async () => {
        await pool.end();
        clearTimeout(deadline);
        process.exitCode = 0;
    });
}
const stopWatcher = setInterval(() => {
    if (process.env.SOLUTIONDEPLOY_STOP_FILE && existsSync(process.env.SOLUTIONDEPLOY_STOP_FILE)) void stop();
}, 1000);
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
