import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { FeedCache } from '../server/feeds.js';
import { defaultFavorites, expandFavorites } from '../server/catalog.js';

let server: Server;
let origin: string;
let favorites = [...defaultFavorites];
let failed = false;
let forced = 0;
let forcedAll = 0;
const daysSeen: number[] = [];
const sports = {
    async league(_source: unknown, daysBack: number) {
        daysSeen.push(daysBack);
        return [];
    },
    async schedule() {
        return [];
    },
    async season() {
        return [];
    },
    refreshLive() {
        forced += 1;
    },
    refreshAll() {
        forcedAll += 1;
    },
};
const store = {
    async list() {
        if (failed) throw new Error('database unavailable');
        return [...favorites];
    },
    async add(id: string) {
        favorites = [...new Set([...favorites, id])];
    },
    async remove(id: string) {
        favorites = favorites.filter((entry) => entry !== id);
    },
    async ready() {
        if (failed) throw new Error('database unavailable');
    },
};
beforeAll(async () => {
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
    origin = `http://127.0.0.1:${address.port}`;
    server.on(
        'request',
        createApp({
            store,
            feeds: new FeedCache(),
            sports,
            allowedOrigins: [origin],
        })
    );
});
beforeEach(() => {
    favorites = [...defaultFavorites];
    failed = false;
});
afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});
const write = (path: string, method: string, body: unknown, requestOrigin = origin) =>
    fetch(origin + path, {
        method,
        headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

describe('API with in-memory test double (no database writes)', () => {
    it('returns the catalog, persisted favorites and expanded Purdue feeds', async () => {
        const response = await fetch(origin + '/api/dashboard');
        const dashboard = await response.json();
        expect(response.status).toBe(200);
        expect(dashboard.favorites).toEqual(defaultFavorites);
        const purdue = expandFavorites(defaultFavorites).filter((team) => team.purdue).length;
        expect(dashboard.feeds).toHaveLength(5 + purdue);
        expect(dashboard.feeds.slice(0, 5).map((feed: { id: string }) => feed.id)).toEqual([
            'league-nfl-3d',
            'league-nba-3d',
            'league-mlb-3d',
            'league-b1g-football-3d',
            'league-b1g-mens-basketball-3d',
        ]);
        expect(dashboard.liveAvailable).toBe(true);
    });
    it('adds once, removes only the requested favorite, preserves across reads', async () => {
        expect((await write('/api/favorites', 'POST', { teamId: '134946' })).status).toBe(204);
        await write('/api/favorites', 'POST', { teamId: '134946' });
        expect(favorites.filter((id) => id === '134946')).toHaveLength(1);
        await write('/api/favorites/purdue-all', 'DELETE', {});
        const dashboard = await (await fetch(origin + '/api/dashboard')).json();
        expect(dashboard.favorites).not.toContain('purdue-all');
        expect(dashboard.favorites).toContain('134927');
    });
    it('rejects unknown IDs, extra fields, and cross-origin writes', async () => {
        expect((await write('/api/favorites', 'POST', { teamId: 'https://evil.test' })).status).toBe(400);
        expect((await write('/api/favorites', 'POST', { teamId: '134927', url: 'https://evil.test' })).status).toBe(
            400
        );
        expect((await write('/api/favorites', 'POST', { teamId: '134927' }, 'https://evil.test')).status).toBe(403);
        expect((await fetch(origin + '/api/favorites/134927', { method: 'DELETE' })).status).toBe(403);
    });
    it('returns explicit storage and readiness failures', async () => {
        failed = true;
        expect((await fetch(origin + '/api/health')).status).toBe(503);
        expect((await fetch(origin + '/api/dashboard')).status).toBe(503);
    });
    it('applies the requested results window and clamps bad values', async () => {
        const dashboard = await (await fetch(origin + '/api/dashboard?days=7')).json();
        expect(dashboard.feeds[0].id).toBe('league-nfl-7d');
        const fallback = await (await fetch(origin + '/api/dashboard?days=99')).json();
        expect(fallback.feeds[0].id).toBe('league-nfl-3d');
    });
    it('forces a live refresh at most once per 30 seconds and validates the body', async () => {
        const before = forced;
        expect((await write('/api/refresh', 'POST', { days: 7 })).status).toBe(204);
        expect((await write('/api/refresh', 'POST', { days: 7 })).status).toBe(204);
        expect(forced - before).toBe(1);
        expect(daysSeen).toContain(7);
        expect((await fetch(origin + '/api/dashboard?days=3&refresh=all')).status).toBe(200);
        expect((await fetch(origin + '/api/dashboard?days=3&refresh=all')).status).toBe(200);
        expect(forcedAll).toBe(1);
        expect(forced - before).toBe(1);
        expect((await write('/api/refresh', 'POST', { days: 3, scope: 'old' })).status).toBe(400);
        expect((await write('/api/refresh', 'POST', { days: 7, extra: 1 })).status).toBe(400);
        expect((await write('/api/refresh', 'POST', { days: 7 }, 'https://evil.test')).status).toBe(403);
    });
    it('returns scores from a refetch that the same poll started', async () => {
        const dashboard = await (await fetch(origin + '/api/dashboard?days=5')).json();
        const nfl = dashboard.feeds.find((feed: { id: string }) => feed.id === 'league-nfl-5d');
        expect(nfl).toMatchObject({ pending: false, error: null });
        expect(nfl.updatedAt).not.toBeNull();
    });
    it('rejects malformed JSON rather than returning success', async () => {
        const response = await fetch(origin + '/api/favorites', {
            method: 'POST',
            headers: { Origin: origin, 'Content-Type': 'application/json' },
            body: '{',
        });
        expect(response.status).toBe(400);
    });
});
