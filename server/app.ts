import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';
import type { Dashboard, Game, Team } from '../shared/contracts.js';
import { expandFavorites, leagues, teams } from './catalog.js';
import type { LeagueSource } from './catalog.js';
import type { FeedCache, FeedSource } from './feeds.js';
import type { FavoritesStore } from './storage.js';
import { isHot, maxDaysBack } from './provider.js';

export const notice =
    'Every NFL, NBA and MLB game from ESPN, with results for the days you choose and games 7 days ahead. Purdue shows live games, its last 3 results and its next 5 games. Opening the page refetches everything; live scores refresh every 5 minutes, and Refresh refetches games in progress.';

export interface SportsSource {
    league(source: LeagueSource, daysBack: number): Promise<Game[]>;
    schedule(team: Team): Promise<Game[]>;
    refreshLive(): void;
    refreshAll(): void;
}

const daysSchema = z.coerce.number().int().min(1).max(maxDaysBack).catch(3);

export function dashboardSources(favorites: string[], sports: SportsSource, daysBack = 3): FeedSource[] {
    return [
        ...leagues.map((source): FeedSource => ({
            // The window is part of the id so a new setting doesn't reuse a feed built for another window.
            id: `${source.id}-${daysBack}d`,
            label: `${source.league} scoreboard`,
            note: source.byWeek
                ? `Every game from the last ${Math.ceil(daysBack / 7)} week(s) through next week.`
                : `Every game from ${daysBack} day(s) back to 7 days ahead.`,
            officialUrl: `https://www.espn.com/${source.league.toLowerCase()}/scoreboard`,
            load: () => sports.league(source, daysBack),
            // The provider caches each scoreboard page and only refetches pages that are due.
            interval: () => 60_000,
        })),
        ...expandFavorites(favorites)
            .filter((team) => team.purdue)
            .map((team): FeedSource => ({
                id: team.id,
                label: team.name,
                note: team.coverageNote,
                officialUrl: team.officialUrl,
                purdue: true,
                ...(team.providerId ? { load: () => sports.schedule(team) } : {}),
            })),
    ];
}

export function createApp(options: {
    store: FavoritesStore;
    feeds: FeedCache;
    sports: SportsSource;
    allowedOrigins: string[];
    staticDirectory?: string;
    contentSecurityPolicy?: string;
}) {
    const app = express();
    app.disable('x-powered-by');
    const allowedHosts = new Set(options.allowedOrigins.map((origin) => new URL(origin).host));
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'same-origin');
        res.setHeader('Cache-Control', 'no-store');
        if (options.contentSecurityPolicy) res.setHeader('Content-Security-Policy', options.contentSecurityPolicy);
        const loopbackReadiness =
            req.path === '/api/health' &&
            ['GET', 'HEAD'].includes(req.method) &&
            /^127\.0\.0\.1:\d+$/.test(req.headers.host ?? '');
        if (!allowedHosts.has(req.headers.host ?? '') && !loopbackReadiness) {
            res.status(403).json({ error: 'Unrecognized request host.' });
            return;
        }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            if (
                !req.headers.origin ||
                !options.allowedOrigins.includes(req.headers.origin) ||
                !req.is('application/json') ||
                req.headers['sec-fetch-site'] === 'cross-site'
            ) {
                res.status(403).json({ error: 'Favorites writes require an allowed origin and JSON request.' });
                return;
            }
        }
        next();
    });
    app.use(express.json({ limit: '4kb' }));
    app.get('/api/health', async (_req, res) => {
        try {
            await options.store.ready();
            res.json({ ok: true });
        } catch (error) {
            console.error('Readiness failed:', error instanceof Error ? error.message : 'Unknown storage failure');
            res.status(503).json({ ok: false, error: 'Database unavailable or schema not initialized.' });
        }
    });
    const lastForced = { live: 0, all: 0 };
    // "all" (page load) refetches every page and feed; "live" (Refresh button) only games in
    // progress. Each scope forces at most one ESPN fetch per 30 seconds.
    const forceRefresh = async (scope: 'live' | 'all', days: number) => {
        if (Date.now() - lastForced[scope] > 30_000) {
            lastForced[scope] = Date.now();
            if (scope === 'all') {
                options.sports.refreshAll();
                options.feeds.invalidate();
            } else {
                options.sports.refreshLive();
                // League feeds ask the provider, which refetches only its hot pages.
                options.feeds.invalidate((id, games) => id.startsWith('league-') || isHot(games, Date.now()));
            }
        }
        const favorites = await options.store.list();
        for (const source of dashboardSources(favorites, options.sports, days)) options.feeds.get(source);
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([options.feeds.settle(), new Promise((resolve) => (timer = setTimeout(resolve, 20_000)))]);
        clearTimeout(timer);
    };
    app.post('/api/refresh', async (req, res) => {
        const parsed = z
            .object({ days: daysSchema, scope: z.enum(['live', 'all']).default('live') })
            .strict()
            .safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Send the results window in days.' });
            return;
        }
        await forceRefresh(parsed.data.scope, parsed.data.days);
        res.status(204).end();
    });
    app.get('/api/dashboard', async (req, res) => {
        const days = daysSchema.parse(req.query.days);
        // Page load asks for a full refetch with a GET so it stays a read; the refetch only
        // replaces cached public scores and is throttled like the POST.
        if (req.query.refresh === 'all') await forceRefresh('all', days);
        const favorites = await options.store.list();
        const unknown = favorites.filter((id) => !teams.some((team) => team.id === id));
        if (unknown.length) throw new Error('Stored favorites contain unsupported team identifiers.');
        const dashboard: Dashboard = {
            favorites,
            teams,
            feeds: dashboardSources(favorites, options.sports, days).map((source) => options.feeds.get(source)),
            liveAvailable: true,
            notice,
        };
        res.json(dashboard);
    });
    app.post('/api/favorites', async (req, res) => {
        const parsed = z.object({ teamId: z.string() }).strict().safeParse(req.body);
        if (!parsed.success || !teams.some((team) => team.id === parsed.data.teamId)) {
            res.status(400).json({ error: 'Choose a team from the supported catalog.' });
            return;
        }
        await options.store.add(parsed.data.teamId);
        res.status(204).end();
    });
    app.delete('/api/favorites/:teamId', async (req, res) => {
        if (!teams.some((team) => team.id === req.params.teamId)) {
            res.status(400).json({ error: 'Unknown favorite team.' });
            return;
        }
        await options.store.remove(req.params.teamId);
        res.status(204).end();
    });
    app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }));
    if (options.staticDirectory) app.use(express.static(options.staticDirectory, { dotfiles: 'deny' }));
    const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
        if (error instanceof SyntaxError) {
            res.status(400).json({ error: 'Request body must be valid JSON.' });
            return;
        }
        console.error('Request failed:', error instanceof Error ? error.message : 'Unknown request failure');
        res.status(503).json({ error: 'Team Scoreboard could not read or save data. Please retry.' });
    };
    app.use(handleError);
    return app;
}
