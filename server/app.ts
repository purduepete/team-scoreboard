import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';
import type { Dashboard } from '../shared/contracts.js';
import { expandFavorites, teams } from './catalog.js';
import type { FeedCache } from './feeds.js';
import type { FavoritesStore } from './storage.js';

export const notice =
    'Free schedules/results only, not live scores. At most one upcoming game and one recent result per team; the provider documents possible home-game-only restrictions. Empty feeds do not establish that a team has no games. Refreshes are cached for 15 minutes.';

export function createApp(options: {
    store: FavoritesStore;
    feeds: FeedCache;
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
    app.get('/api/dashboard', async (_req, res) => {
        const favorites = await options.store.list();
        const unknown = favorites.filter((id) => !teams.some((team) => team.id === id));
        if (unknown.length) throw new Error('Stored favorites contain unsupported team identifiers.');
        const dashboard: Dashboard = {
            favorites,
            teams,
            feeds: expandFavorites(favorites).map((team) => options.feeds.get(team)),
            liveAvailable: false,
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
