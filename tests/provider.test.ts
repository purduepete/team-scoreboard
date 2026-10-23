import { describe, expect, it } from 'vitest';
import { teams, expandFavorites } from '../server/catalog.js';
import { normalizeEvent, parseEvents, SportsProvider } from '../server/provider.js';
import { FeedCache } from '../server/feeds.js';
import { formatStart, visibleGames } from '../src/games.js';

const team = teams[0];
const event = {
    idEvent: '12345',
    strEvent: 'Colts vs Seahawks',
    strHomeTeam: 'Colts',
    strAwayTeam: 'Seahawks',
    idHomeTeam: '134927',
    idAwayTeam: '134949',
    intHomeScore: '0',
    intAwayScore: '21',
    dateEvent: '2026-10-25',
    strTimestamp: '2026-10-25T17:00:00',
    strStatus: 'FT',
};

describe('provider normalization', () => {
    it('preserves zero scores, UTC instants and source IDs', () => {
        const game = normalizeEvent(event, team);
        expect(game.homeScore).toBe(0);
        expect(game.startTime).toBe('2026-10-25T17:00:00.000Z');
        expect(game.status).toBe('final');
        expect(game.sourceUrl).toBe('https://www.thesportsdb.com/event/12345');
    });
    it('does not infer a final from an elapsed start time or partial score', () => {
        expect(normalizeEvent({ ...event, strStatus: '2Q' }, team).status).toBe('unknown');
    });
    it('handles postponed, canceled and after-overtime finals', () => {
        expect(normalizeEvent({ ...event, strPostponed: 'yes' }, team).status).toBe('postponed');
        expect(normalizeEvent({ ...event, strStatus: 'CANC' }, team).status).toBe('canceled');
        expect(normalizeEvent({ ...event, strStatus: 'AOT' }, team).status).toBe('final');
    });
    it('keeps an unannounced time separate from the date', () => {
        const game = normalizeEvent({ ...event, strTimestamp: null }, team);
        expect(game.startTime).toBeNull();
        expect(formatStart(game)).toBe('2026-10-25 · time unannounced');
    });
    it('does not invent opponents for multi-participant events', () => {
        const game = normalizeEvent({ ...event, strHomeTeam: null, strAwayTeam: null }, team);
        expect(game.home).toBeNull();
        expect(game.away).toBeNull();
        expect(game.title).toBe(event.strEvent);
    });
    it('distinguishes successful empty responses from broken shapes', () => {
        expect(parseEvents({ events: null }, 'events', team)).toEqual([]);
        expect(() => parseEvents({}, 'events', team)).toThrow();
        expect(() => normalizeEvent({ ...event, intHomeScore: 'NaN' }, team)).toThrow();
        expect(() => normalizeEvent({ ...event, idHomeTeam: 'other' }, team)).toThrow();
        expect(() => normalizeEvent({ ...event, strTimestamp: 'bad' }, team)).toThrow();
        expect(() => normalizeEvent({ ...event, dateEvent: '2026-02-31' }, team)).toThrow();
        expect(() => normalizeEvent({ ...event, strTimestamp: '2026-02-31T17:00:00' }, team)).toThrow();
    });
    it('deduplicates a match when two favorites played each other', () => {
        const a = normalizeEvent(event, team);
        const b = { ...a, teamIds: ['134949'] };
        expect(visibleGames([a, b], 'recent', 'all', 'all', [])).toHaveLength(1);
        expect(visibleGames([a, b], 'recent', '134949', 'all', [])).toHaveLength(1);
    });
    it('expands the umbrella without duplicates and excludes the umbrella feed', () => {
        const expanded = expandFavorites(['purdue-all', 'purdue-football']);
        expect(expanded.filter((entry) => entry.id === 'purdue-football')).toHaveLength(1);
        expect(expanded).toHaveLength(20);
        expect(expandFavorites([])).toEqual([]);
    });
    it('paces requests and reads both upcoming and result envelope keys', async () => {
        let clock = 0;
        const waits: number[] = [];
        const provider = new SportsProvider(
            async (url) =>
                new Response(
                    JSON.stringify(String(url).includes('eventsnext') ? { events: [event] } : { results: [event] })
                ),
            () => clock,
            async (delay) => {
                waits.push(delay);
                clock += delay;
            }
        );
        expect(await provider.schedule(team)).toHaveLength(1);
        expect(waits).toEqual([6000]);
    });
    it('surfaces rate limiting without an empty successful feed', async () => {
        const provider = new SportsProvider(async () => new Response('{}', { status: 429 }));
        await expect(provider.schedule(team)).rejects.toThrow('rate limit');
    });
});

describe('feed cache', () => {
    it('shares pending fetches and retains last successful data with errors', async () => {
        let now = 0;
        let calls = 0;
        const cache = new FeedCache(
            async () => {
                if (++calls > 1) throw new Error('upstream unavailable');
                return [normalizeEvent(event, team)];
            },
            () => now,
            () => undefined
        );
        expect(cache.get(team).pending).toBe(true);
        cache.get(team);
        await cache.settle();
        expect(calls).toBe(1);
        expect(cache.get(team).games).toHaveLength(1);
        now = 16 * 60_000;
        cache.get(team);
        await cache.settle();
        const stale = cache.get(team);
        expect(stale.stale).toBe(true);
        expect(stale.error).not.toBeNull();
        expect(stale.games).toHaveLength(1);
        expect(calls).toBe(2);
    });
    it('does not call the provider for unsupported sports', async () => {
        const cache = new FeedCache(async () => {
            throw new Error('must not call');
        });
        const unsupported = teams.find((entry) => entry.id === 'purdue-baseball')!;
        expect(cache.get(unsupported)).toMatchObject({ games: [], error: null, pending: false });
    });
});
