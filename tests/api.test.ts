import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { FeedCache } from '../server/feeds.js';
import { defaultFavorites } from '../server/catalog.js';

let server: Server;
let origin: string;
let favorites = [...defaultFavorites];
let failed = false;
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
            feeds: new FeedCache(async () => []),
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
        expect(dashboard.feeds).toHaveLength(24);
        expect(dashboard.liveAvailable).toBe(false);
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
    it('rejects malformed JSON rather than returning success', async () => {
        const response = await fetch(origin + '/api/favorites', {
            method: 'POST',
            headers: { Origin: origin, 'Content-Type': 'application/json' },
            body: '{',
        });
        expect(response.status).toBe(400);
    });
});
