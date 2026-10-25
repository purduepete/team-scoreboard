import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { Game, SearchTeam, TeamCategory } from '../shared/contracts.js';
import { teams } from '../server/catalog.js';
import { createApp } from '../server/app.js';
import { FeedCache } from '../server/feeds.js';
import { SportsProvider, ProviderError } from '../server/provider.js';
import { TeamSearch } from '../server/team-search.js';

const directory = (count = 1) => ({
    sports: [
        {
            leagues: [
                {
                    teams: Array.from({ length: count }, (_, i) => ({
                        team: { id: String(i + 10), displayName: `Example University ${i}` },
                    })),
                },
            ],
        },
    ],
});
const college: SearchTeam = {
    id: 'added-college-football-10',
    category: 'college-football',
    providerId: 'football/college-football/10',
    name: 'Example University',
    sport: 'Football',
    league: 'College football',
    officialUrl: 'https://www.espn.com/college-football/team/_/id/10',
    coverage: 'schedule-results',
    coverageNote: 'ESPN full team schedule and results.',
};
const provider = (body: unknown, status = 200) =>
    new SportsProvider(
        vi.fn(async () => new Response(JSON.stringify(body), { status })) as typeof fetch,
        () => 1_000,
        async () => {}
    );

describe('college team directories', () => {
    it('uses a fixed path and validates numeric IDs and names', async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify(directory())));
        const sports = new SportsProvider(fetcher as typeof fetch);
        const result = await sports.teamDirectory('college-basketball');
        expect(fetcher).toHaveBeenCalledWith(
            'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=1000',
            expect.anything()
        );
        expect(result[0]).toMatchObject({
            category: 'college-basketball',
            league: "Men's college basketball",
            providerId: 'basketball/mens-college-basketball/10',
        });
        expect(result[0].purdue).toBeUndefined();
    });
    it.each([
        {},
        { sports: [] },
        directory(0),
        { sports: [{ leagues: [{ teams: [{ team: { id: '../10', displayName: 'Team' } }] }] }] },
        { sports: [{ leagues: [{ teams: [{ team: { id: '10', displayName: ' ' } }] }] }] },
    ])('rejects malformed or empty directories: %j', async (body) => {
        await expect(provider(body).teamDirectory('college-football')).rejects.toThrow();
    });
    it('fails explicitly at the directory limit, retaining all teams below it', async () => {
        expect(await provider(directory(762)).teamDirectory('college-football')).toHaveLength(762);
        expect(await provider(directory(362)).teamDirectory('college-basketball')).toHaveLength(362);
        await expect(provider(directory(1000)).teamDirectory('college-football')).rejects.toThrow('1000-team limit');
    });
    it('does not treat directory HTTP 400 as an empty schedule', async () => {
        await expect(provider({}, 400).teamDirectory('college-football')).rejects.toThrow('HTTP 400');
        await expect(provider({}, 500).teamDirectory('college-football')).rejects.toThrow('HTTP 500');
        await expect(provider({}, 429).teamDirectory('college-football')).rejects.toThrow('rate limit');
    });
    it('rejects duplicate IDs and unsupported directory categories', async () => {
        const body = directory(2);
        body.sports[0].leagues[0].teams[1].team.id = '10';
        await expect(provider(body).teamDirectory('college-football')).rejects.toThrow('duplicate IDs');
        for (const category of ['nfl', 'nba', 'mlb', 'toString']) {
            await expect(provider(directory()).teamDirectory(category as TeamCategory)).rejects.toThrow('Unsupported');
        }
    });
    it('singleflights, caches for 24 hours and retains last good teams during failure backoff', async () => {
        let now = 1_000;
        const load = vi.fn().mockResolvedValue([college]);
        const report = vi.fn();
        const search = new TeamSearch(load, () => now, report);
        await Promise.all([search.directory('college-football'), search.directory('college-football')]);
        expect(load).toHaveBeenCalledTimes(1);
        now += 24 * 60 * 60_000 - 1;
        await search.directory('college-football');
        expect(load).toHaveBeenCalledTimes(1);
        now++;
        load.mockRejectedValue(new ProviderError('Directory unavailable'));
        expect(await search.directory('college-football')).toMatchObject({
            teams: [college],
            stale: true,
            error: 'Directory unavailable',
        });
        await search.directory('college-football');
        expect(load).toHaveBeenCalledTimes(2);
        expect(report).toHaveBeenCalledTimes(1);
        now += 120_000;
        load.mockResolvedValue([college]);
        expect(await search.directory('college-football')).toMatchObject({ stale: false, error: null });
        expect(load).toHaveBeenCalledTimes(3);
    });
    it('backs off initial failures and caps college search at 20 results', async () => {
        const load = vi.fn().mockRejectedValue(new Error('Offline'));
        const search = new TeamSearch(load, () => 1_000, vi.fn());
        expect(await search.search('college-football', 'ex')).toMatchObject({
            teams: [],
            stale: false,
            error: expect.any(String),
        });
        await search.search('college-football', 'ex');
        expect(load).toHaveBeenCalledTimes(1);
        expect(
            (
                await new TeamSearch(async () =>
                    Array.from({ length: 25 }, (_, i) => ({
                        ...college,
                        id: `team-${i}`,
                        name: `Example ${i}`,
                    }))
                ).search('college-football', 'example')
            ).teams
        ).toHaveLength(20);
    });
    it('preserves known Purdue team identities without using Purdue labels for other colleges', async () => {
        const known = teams.find((team) => team.providerId === 'football/college-football/2509')!;
        const purdue = {
            ...college,
            id: 'added-college-football-2509',
            providerId: known.providerId!,
            name: 'Purdue Boilermakers',
        };
        const search = new TeamSearch(async () => [purdue, college]);
        expect((await search.search('college-football', 'Purdue')).teams[0]).toMatchObject({
            id: known.id,
            providerId: known.providerId,
            purdue: true,
        });
        expect((await search.search('college-football', 'Example')).teams[0]).toEqual(college);
    });
});

describe('added-team feeds', () => {
    it('fills missing live schedule scores from event details and surfaces detail failures', async () => {
        const competition = (scores: boolean) => ({
            status: { type: { state: 'in', shortDetail: '9:21 - 2nd' } },
            situation: scores ? { possession: '10', isRedZone: true, downDistanceText: '1st & Goal' } : undefined,
            competitors: [
                {
                    homeAway: 'home',
                    team: { id: '10', displayName: college.name },
                    ...(scores ? { score: '23', records: [{ type: 'total', summary: '4-2' }] } : {}),
                },
                {
                    homeAway: 'away',
                    team: { id: '145', displayName: 'Ole Miss Rebels' },
                    ...(scores ? { score: '3', records: [{ type: 'total', summary: '5-1' }] } : {}),
                },
            ],
        });
        const fetcher = vi.fn(async (url: string | URL | Request) => {
            return new Response(
                JSON.stringify(
                    String(url).includes('/scoreboard/')
                        ? {
                              id: '401856732',
                              name: 'Ole Miss at Example',
                              date: '2026-10-24T23:30Z',
                              competitions: [competition(true)],
                          }
                        : {
                              events: [
                                  {
                                      id: '401856732',
                                      name: 'Ole Miss at Example',
                                      date: '2026-10-24T23:30Z',
                                      competitions: [competition(false)],
                                  },
                              ],
                          }
                )
            );
        });
        const sports = new SportsProvider(fetcher as typeof fetch, Date.now, async () => {});
        expect((await sports.schedule(college, true))[0]).toMatchObject({
            homeScore: 23,
            awayScore: 3,
            status: 'live',
            possession: 'home',
            redZone: true,
            situation: '1st & Goal',
            homeRecord: '4-2',
            awayRecord: '5-1',
            teamIds: expect.arrayContaining([college.id]),
        });
        expect(fetcher).toHaveBeenCalledWith(
            'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard/401856732',
            expect.anything()
        );
        fetcher
            .mockImplementationOnce(
                async () =>
                    new Response(
                        JSON.stringify({
                            events: [
                                { id: '401856732', name: 'Ole Miss at Example', competitions: [competition(false)] },
                            ],
                        })
                    )
            )
            .mockImplementationOnce(async () => new Response('{}', { status: 503 }));
        await expect(sports.schedule(college, true)).rejects.toThrow('HTTP 503');
    });
    it('loads the full schedule with a noncatalog opponent and explicit requested team ID', async () => {
        const events = Array.from({ length: 12 }, (_, i) => ({
            id: String(100 + i),
            name: 'Example University vs Unknown College',
            date: `2026-10-${String(i + 1).padStart(2, '0')}T17:00Z`,
            competitions: [
                {
                    status: { type: { state: i < 6 ? 'post' : 'pre' } },
                    competitors: [
                        { homeAway: 'home', team: { id: '10', displayName: college.name } },
                        { homeAway: 'away', team: { id: '999999', displayName: 'Unknown College' } },
                    ],
                },
            ],
        }));
        const sports = provider({ events });
        expect(await sports.schedule(college, true)).toHaveLength(12);
        expect((await sports.schedule(college, true))[0]).toMatchObject({
            away: 'Unknown College',
            teamIds: expect.arrayContaining([college.id]),
        });
        expect(await sports.schedule(college)).toHaveLength(8);
    });
    it('limits cache entries, evicts least recently read settled feeds and reports pending capacity', async () => {
        const report = vi.fn();
        const cache = new FeedCache(() => 1_000, report, 2);
        const load = vi.fn(async (): Promise<Game[]> => []);
        const source = (id: string) => ({ id, label: id, note: '', officialUrl: '', load });
        cache.get(source('a'));
        cache.get(source('b'));
        expect(cache.get(source('c'))).toMatchObject({ pending: false, error: expect.stringContaining('capacity') });
        await cache.settle();
        cache.get(source('a'));
        cache.get(source('c'));
        await cache.settle();
        cache.get(source('a'));
        expect(load).toHaveBeenCalledTimes(3);
        cache.get(source('b'));
        expect(load).toHaveBeenCalledTimes(4);
        await cache.settle();
        expect(report).toHaveBeenCalledTimes(1);
    });
    it('refreshes ordinary feeds after 15 minutes and hot feeds after 30 seconds', async () => {
        let now = 1_000;
        const cache = new FeedCache(() => now, vi.fn(), 128);
        const load = vi.fn(async (): Promise<Game[]> => []);
        const source = { id: 'normal', label: '', note: '', officialUrl: '', load };
        cache.get(source);
        await cache.settle();
        now += 15 * 60_000 - 1;
        cache.get(source);
        expect(load).toHaveBeenCalledTimes(1);
        now++;
        cache.get(source);
        await cache.settle();
        expect(load).toHaveBeenCalledTimes(2);
        const hotLoad = vi.fn(async () => [{ status: 'live' } as Game]);
        const hot = { ...source, id: 'hot', load: hotLoad };
        cache.get(hot);
        await cache.settle();
        now += 29_999;
        cache.get(hot);
        expect(hotLoad).toHaveBeenCalledTimes(1);
        now++;
        cache.get(hot);
        await cache.settle();
        expect(hotLoad).toHaveBeenCalledTimes(2);
    });
});

describe('search and added-team API', () => {
    it('validates inputs, resolves server metadata, returns pending immediately and exposes schedule failures', async () => {
        let now = 1_000;
        let finish: (games: Game[]) => void = () => {};
        const schedule = vi.fn(
            () =>
                new Promise<Game[]>((resolve) => {
                    finish = resolve;
                })
        );
        const teamDirectory = vi.fn(async () => [college]);
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('No test address');
        const origin = `http://127.0.0.1:${address.port}`;
        const app = createApp({
            store: { list: vi.fn(), add: vi.fn(), remove: vi.fn(), ready: vi.fn() },
            feeds: new FeedCache(),
            sports: { league: vi.fn(), schedule, season: vi.fn(), teamDirectory, refreshAll() {}, refreshLive() {} },
            allowedOrigins: [origin],
            clock: () => now,
        });
        server.on('request', app);
        const get = (path: string) => fetch(origin + path);
        try {
            for (const query of [
                'sport=soccer&q=team',
                'sport=college-basketball&q=a',
                `sport=college-football&q=${'a'.repeat(81)}`,
                'sport=college-football&q=example&url=bad',
                'sport=college-football&sport=college-basketball&q=example',
                'sport=nfl&q=colts',
                'sport=nba&q=pacers',
                'sport=mlb&q=cubs',
            ])
                expect((await get(`/api/team-search?${query}`)).status).toBe(400);
            expect(teamDirectory).not.toHaveBeenCalled();
            expect(
                (await (await get('/api/team-search?sport=college-football&q=%20Example%20')).json()).teams
            ).toHaveLength(1);
            for (const query of [
                'sport=college-football&id=../10',
                'sport=college-football&id=0',
                'sport=college-football&id=10&name=spoof',
                'sport=college-football&id=12345678901',
                'sport=nfl&id=11',
                'sport=nba&id=11',
                'sport=mlb&id=11',
            ])
                expect((await get(`/api/added-teams?${query}`)).status).toBe(400);
            expect((await get('/api/added-teams?sport=college-football&id=99')).status).toBe(404);
            const pending = await (await get('/api/added-teams?sport=college-football&id=10')).json();
            expect(pending).toMatchObject({ team: college, feed: { pending: true, error: null } });
            expect(schedule).toHaveBeenCalledWith(college, true);
            finish([]);
            const ready = await (await get('/api/added-teams?sport=college-football&id=10')).json();
            expect(ready.feed).toMatchObject({ pending: false, error: null, games: [] });
            expect(schedule).toHaveBeenCalledTimes(1);
            expect(teamDirectory).toHaveBeenCalledTimes(1);
            schedule.mockImplementation(() => Promise.reject(new ProviderError('Schedule unavailable')));
            now += 15 * 60_000;
            expect((await get('/api/added-teams?sport=college-football&id=10')).status).toBe(200);
            const failed = await get('/api/added-teams?sport=college-football&id=10');
            expect(failed.status).toBe(200);
            expect((await failed.json()).feed).toMatchObject({
                pending: false,
                stale: true,
                error: 'Schedule unavailable',
            });
            teamDirectory.mockRejectedValue(new ProviderError('Directory offline'));
            const unavailable = await get('/api/team-search?sport=college-basketball&q=example');
            expect(unavailable.status).toBe(503);
            expect(await unavailable.json()).toMatchObject({ teams: [], stale: false, error: 'Directory offline' });
            expect((await get('/api/added-teams?sport=college-basketball&id=10')).status).toBe(503);
            now += 24 * 60 * 60_000;
            const stale = await get('/api/team-search?sport=college-football&q=example');
            expect(stale.status).toBe(200);
            expect(await stale.json()).toMatchObject({ teams: [college], stale: true, error: 'Directory offline' });
        } finally {
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    });
});
