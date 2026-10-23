import { describe, expect, it } from 'vitest';
import type { Game } from '../shared/contracts.js';
import { teams, expandFavorites } from '../server/catalog.js';
import { normalizeEvent, parseEvents, selectWindow, SportsProvider } from '../server/provider.js';
import { FeedCache } from '../server/feeds.js';
import { formatStart, visibleGames } from '../src/games.js';

const team = teams[0];
const status = (name: string, state: string, shortDetail = 'Final') => ({ type: { name, state, shortDetail } });
const event = {
    id: '401872659',
    name: 'Baltimore Ravens at Indianapolis Colts',
    date: '2026-09-13T17:00Z',
    links: [
        { rel: ['summary', 'sportscenter', 'app', 'event'], href: 'sportscenter://x-callback-url/showGame' },
        { rel: ['summary', 'desktop', 'event'], href: 'https://www.espn.com/nfl/game/_/gameId/401872659' },
    ],
    competitions: [
        {
            timeValid: true,
            status: status('STATUS_FINAL', 'post'),
            competitors: [
                {
                    homeAway: 'away',
                    team: { id: '33', displayName: 'Baltimore Ravens' },
                    score: { value: 41, displayValue: '41' },
                },
                {
                    homeAway: 'home',
                    team: { id: '11', displayName: 'Indianapolis Colts' },
                    score: { value: 0, displayValue: '0' },
                },
            ],
        },
    ],
};
const withStatus = (value: ReturnType<typeof status>, scores?: [unknown, unknown]) => ({
    ...event,
    competitions: [
        {
            ...event.competitions[0],
            status: value,
            competitors: event.competitions[0].competitors.map((entry, index) =>
                scores ? { ...entry, score: scores[index] } : entry
            ),
        },
    ],
});

describe('ESPN normalization', () => {
    it('reads a final with home/away by role, zero scores, UTC instant and the ESPN summary link', () => {
        const game = normalizeEvent(event, team);
        expect(game).toMatchObject({
            home: 'Indianapolis Colts',
            away: 'Baltimore Ravens',
            homeScore: 0,
            awayScore: 41,
            startTime: '2026-09-13T17:00:00.000Z',
            date: '2026-09-13',
            status: 'final',
            statusLabel: 'Final',
            sourceUrl: 'https://www.espn.com/nfl/game/_/gameId/401872659',
        });
    });
    it('treats a scheduled game as upcoming without scores', () => {
        const game = normalizeEvent(withStatus(status('STATUS_SCHEDULED', 'pre'), [null, undefined]), team);
        expect(game.status).toBe('upcoming');
        expect(game.homeScore).toBeNull();
        expect(game.statusLabel).toBe('Scheduled');
    });
    it('shows a live game with its clock and string or missing scores', () => {
        const game = normalizeEvent(withStatus(status('STATUS_IN_PROGRESS', 'in', 'Q3 4:12'), ['14', undefined]), team);
        expect(game.status).toBe('live');
        expect(game.statusLabel).toBe('Q3 4:12');
        expect(game.awayScore).toBe(14);
        expect(game.homeScore).toBeNull();
    });
    it('checks postponed and canceled before the generic state', () => {
        expect(normalizeEvent(withStatus(status('STATUS_POSTPONED', 'post')), team).status).toBe('postponed');
        expect(normalizeEvent(withStatus(status('STATUS_CANCELED', 'post')), team).status).toBe('canceled');
    });
    it('keeps an unannounced time separate from the date', () => {
        const game = normalizeEvent({ ...event, competitions: [{ ...event.competitions[0], timeValid: false }] }, team);
        expect(game.startTime).toBeNull();
        expect(formatStart(game)).toBe('2026-09-13 · time unannounced');
    });
    it('rejects broken shapes and events for other teams', () => {
        expect(parseEvents({ events: [] }, team)).toEqual([]);
        expect(parseEvents({}, team)).toEqual([]);
        expect(() => parseEvents({ events: 'x' }, team)).toThrow();
        expect(() => normalizeEvent({ ...event, date: 'bad' }, team)).toThrow();
        expect(() => normalizeEvent(withStatus(status('STATUS_FINAL', 'post'), ['NaN', '1']), team)).toThrow();
        const other = {
            ...event,
            competitions: [
                {
                    ...event.competitions[0],
                    competitors: event.competitions[0].competitors.map((entry) => ({
                        ...entry,
                        team: { ...entry.team, id: '99' },
                    })),
                },
            ],
        };
        expect(() => normalizeEvent(other, team)).toThrow('different team');
    });
    it('falls back to the team page when ESPN gives no web link', () => {
        expect(normalizeEvent({ ...event, links: [] }, team).sourceUrl).toBe(team.officialUrl);
    });
});

describe('window and filters', () => {
    const make = (id: string, day: number, gameStatus: Game['status']): Game => ({
        ...normalizeEvent(event, team),
        id,
        status: gameStatus,
        startTime: new Date(Date.UTC(2026, 9, day, 17)).toISOString(),
    });
    it('keeps live games, the last 3 finals and the next 5 upcoming games', () => {
        const now = Date.UTC(2026, 9, 15, 12);
        const games = [
            ...[1, 2, 3, 4, 5].map((day) => make(`f${day}`, day, 'final')),
            make('live', 15, 'live'),
            ...[16, 17, 18, 19, 20, 21].map((day) => make(`u${day}`, day, 'upcoming')),
            make('stale', 2, 'postponed'),
        ];
        expect(selectWindow(games, now).map((game) => game.id)).toEqual([
            'live',
            'f5',
            'f4',
            'f3',
            'u16',
            'u17',
            'u18',
            'u19',
            'u20',
        ]);
    });
    it('splits live, upcoming and recent tabs and deduplicates shared games', () => {
        const live = make('live', 15, 'live');
        const upcoming = make('up', 16, 'upcoming');
        const final = make('fin', 14, 'final');
        const all = [live, upcoming, final, { ...final, teamIds: ['134949'] }];
        expect(visibleGames(all, 'live', 'all', 'all', []).map((game) => game.id)).toEqual(['live']);
        expect(visibleGames(all, 'upcoming', 'all', 'all', []).map((game) => game.id)).toEqual(['up']);
        expect(visibleGames(all, 'recent', 'all', 'all', [])).toHaveLength(1);
        expect(visibleGames(all, 'recent', '134949', 'all', [])).toHaveLength(1);
    });
    it('expands the umbrella without duplicates and excludes the umbrella feed', () => {
        const expanded = expandFavorites(['purdue-all', 'purdue-football']);
        expect(expanded.filter((entry) => entry.id === 'purdue-football')).toHaveLength(1);
        expect(expanded).toHaveLength(20);
        expect(expandFavorites([])).toEqual([]);
    });
});

describe('provider requests', () => {
    const provider = (respond: (url: string) => Response, urls: string[] = [], waits: number[] = []) => {
        let clock = Date.UTC(2026, 8, 1);
        return new SportsProvider(
            async (url) => {
                urls.push(String(url));
                return respond(String(url));
            },
            () => clock,
            async (delay) => {
                waits.push(delay);
                clock += delay;
            }
        );
    };
    it('calls the ESPN team schedule and paces requests 500 ms apart', async () => {
        const urls: string[] = [];
        const waits: number[] = [];
        const espn = provider(() => new Response(JSON.stringify({ events: [event] })), urls, waits);
        expect(await espn.schedule(team)).toHaveLength(1);
        await espn.schedule(team);
        expect(urls[0]).toBe('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/11/schedule');
        expect(waits).toEqual([500]);
    });
    it('retries an empty default schedule once with the regular season', async () => {
        const urls: string[] = [];
        const espn = provider(
            (url) => new Response(JSON.stringify({ events: url.includes('seasontype=2') ? [event] : [] })),
            urls
        );
        expect(await espn.schedule(team)).toHaveLength(1);
        expect(urls).toHaveLength(2);
        expect(urls[1]).toMatch(/\?seasontype=2$/);
    });
    it('treats HTTP 400 as an off-season sport with no games', async () => {
        const espn = provider(() => new Response('{"code":400}', { status: 400 }));
        expect(await espn.schedule(team)).toEqual([]);
    });
    it('surfaces rate limiting and server errors instead of an empty feed', async () => {
        await expect(provider(() => new Response('{}', { status: 429 })).schedule(team)).rejects.toThrow('rate limit');
        await expect(provider(() => new Response('{}', { status: 500 })).schedule(team)).rejects.toThrow('HTTP 500');
    });
    it('gives every feed-backed catalog entry a valid ESPN path', () => {
        for (const entry of teams.filter((item) => item.providerId)) {
            expect(entry.providerId).toMatch(/^[a-z]+\/[a-z0-9.-]+\/\d+$/);
        }
        expect(teams.find((item) => item.id === 'purdue-softball')?.providerId).toBe('baseball/college-softball/601');
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
    it('does not call the provider for sports without a feed', async () => {
        const cache = new FeedCache(async () => {
            throw new Error('must not call');
        });
        const unsupported = teams.find((entry) => entry.id === 'purdue-wrestling')!;
        expect(cache.get(unsupported)).toMatchObject({ games: [], error: null, pending: false });
    });
});
