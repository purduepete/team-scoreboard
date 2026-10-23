import { describe, expect, it } from 'vitest';
import type { Game } from '../shared/contracts.js';
import { teams, expandFavorites, leagues } from '../server/catalog.js';
import {
    isHot,
    normalizeEvent,
    parseEvents,
    parseScoreboard,
    scoreboardDays,
    selectWindow,
    SportsProvider,
} from '../server/provider.js';
import { FeedCache } from '../server/feeds.js';
import type { FeedSource } from '../server/feeds.js';
import { formatStart, groupGames, visibleGames } from '../src/games.js';

const team = teams.find((item) => item.id === '134927')!;
const [nfl, nba] = leagues;
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
        expect(visibleGames(all, 'live', 'all', []).map((game) => game.id)).toEqual(['live']);
        expect(visibleGames(all, 'upcoming', 'all', []).map((game) => game.id)).toEqual(['up']);
        expect(visibleGames(all, 'recent', 'all', [])).toHaveLength(1);
        expect(visibleGames(all, 'recent', '134949', [])).toHaveLength(1);
        expect(visibleGames(all, 'recent', 'favorites', ['134949'])).toHaveLength(1);
        expect(visibleGames(all, 'recent', 'favorites', ['nba-11'])).toHaveLength(0);
        expect(visibleGames(all, 'recent', 'league:NFL', [])).toHaveLength(1);
        expect(visibleGames(all, 'recent', 'league:NBA', [])).toHaveLength(0);
    });
    it('groups into Purdue then pro league sections, and orders Live today by status', () => {
        const at = (
            id: string,
            day: number,
            hour: number,
            teamIds: string[],
            gameStatus: Game['status'],
            league: Game['league'] = 'NBA'
        ): Game => ({
            ...make(id, day, gameStatus),
            league,
            teamIds,
            startTime: new Date(2026, 9, day, hour).toISOString(),
        });
        const now = new Date(2026, 9, 22, 9);
        const upcoming = [
            at('early', 22, 13, ['nba-1'], 'upcoming'),
            at('fav', 22, 20, ['134927'], 'upcoming'),
            at('tomorrow', 23, 19, ['nba-2'], 'upcoming'),
            at('mlb', 23, 16, ['mlb-1'], 'upcoming', 'MLB'),
            at('boiler', 24, 12, ['purdue-football'], 'upcoming', 'NCAA'),
            at('nfl', 25, 10, ['nfl-1'], 'upcoming', 'NFL'),
            { ...at('tba', 24, 19, ['nba-3'], 'upcoming'), startTime: null, date: null },
        ];
        const sections = groupGames(upcoming, 'upcoming', ['134927'], now);
        expect(sections.map((section) => section.label)).toEqual(['Purdue', 'NFL', 'NBA', 'MLB']);
        const nba = sections[2];
        expect(nba.count).toBe(4);
        expect(nba.days.map((group) => group.label.split(' · ')[0])).toEqual([
            'Today',
            'Tomorrow',
            'Date to be announced',
        ]);
        expect(nba.days[0].games.map((game) => game.id)).toEqual(['fav', 'early']);

        const today = [
            at('done', 22, 10, ['nba-1'], 'final'),
            at('later', 22, 19, ['nba-2'], 'upcoming'),
            at('later-fav', 22, 21, ['134927'], 'upcoming'),
            at('now', 22, 11, ['nba-3'], 'live'),
            at('yesterday', 21, 19, ['nba-4'], 'final'),
        ];
        const live = visibleGames(today, 'live', 'all', [], now);
        expect(live.map((game) => game.id).sort()).toEqual(['done', 'later', 'later-fav', 'now']);
        const [liveSection] = groupGames(live, 'live', ['134927'], now);
        expect(liveSection.days[0].games.map((game) => game.id)).toEqual(['now', 'done', 'later-fav', 'later']);

        const results = groupGames(
            [at('old', 20, 19, ['nba-1'], 'final'), at('new', 21, 19, ['nba-1'], 'final')],
            'recent',
            [],
            now
        );
        expect(results[0].days.map((group) => group.games[0].id)).toEqual(['new', 'old']);
        expect(results[0].days[0].label).toMatch(/^Yesterday · /);
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

describe('league scoreboards', () => {
    const competitor = (homeAway: string, id: string, name: string, score?: string) => ({
        homeAway,
        team: { id, displayName: name },
        ...(score === undefined ? {} : { score }),
    });
    const scoreboardEvent = (
        id: string,
        state: string,
        scores: [string, string] | null,
        date = '2026-10-22T00:15Z'
    ) => ({
        id,
        name: 'New England Patriots at Chicago Bears',
        date,
        week: { number: 7 },
        links: [{ rel: ['summary', 'desktop', 'event'], href: `https://www.espn.com/nfl/game/_/gameId/${id}` }],
        competitions: [
            {
                timeValid: true,
                status: status(state === 'in' ? 'STATUS_IN_PROGRESS' : 'STATUS_FINAL', state, '1:21 - 4th'),
                competitors: [
                    competitor('away', '17', 'New England Patriots', scores?.[0]),
                    competitor('home', '3', 'Chicago Bears', scores?.[1]),
                ],
            },
        ],
    });
    it('reads live string scores, both catalog teams and the NFL week', () => {
        const [game] = parseScoreboard({ events: [scoreboardEvent('1', 'in', ['24', '27'])] }, nfl);
        expect(game).toMatchObject({ status: 'live', awayScore: 24, homeScore: 27, week: 7, league: 'NFL' });
        expect(game.teamIds).toContain('134938');
        expect(game.teamIds).toHaveLength(2);
    });
    it('skips one broken event without blanking the league', () => {
        const games = parseScoreboard({ events: [scoreboardEvent('1', 'post', ['1', '2']), { id: 'bad' }] }, nfl);
        expect(games).toHaveLength(1);
        expect(() => parseScoreboard({ events: [{ id: 'bad' }] }, nfl)).toThrow('Every NFL event');
    });
    it('treats live and about-to-start games as hot', () => {
        const now = Date.parse('2026-10-22T00:00Z');
        const live = parseScoreboard({ events: [scoreboardEvent('1', 'in', ['0', '0'])] }, nfl);
        expect(isHot(live, now)).toBe(true);
        const later = [{ ...live[0], status: 'upcoming' as const, startTime: '2026-10-22T03:00:00.000Z' }];
        expect(isHot(later, now)).toBe(false);
        expect(isHot([{ ...later[0], startTime: '2026-10-22T00:20:00.000Z' }], now)).toBe(true);
    });
    it('builds Eastern scoreboard days around today', () => {
        const days = scoreboardDays(Date.parse('2026-10-22T02:00Z'), 2, 1);
        expect(days).toEqual(['20261019', '20261020', '20261021', '20261022']);
    });

    const harness = (body: (url: string) => unknown) => {
        const urls: string[] = [];
        let clock = Date.parse('2026-10-22T16:00Z');
        const espn = new SportsProvider(
            async (url) => {
                urls.push(String(url));
                return new Response(JSON.stringify(body(String(url))));
            },
            () => clock,
            async (delay) => {
                clock += delay;
            }
        );
        return { espn, urls, advance: (ms: number) => (clock += ms) };
    };
    it('pages NFL by week and daily leagues by day for the chosen window', async () => {
        const nflRun = harness((url) =>
            url.endsWith('/scoreboard')
                ? { events: [scoreboardEvent('100', 'post', ['1', '2'])], week: { number: 7 }, season: { type: 2 } }
                : { events: [] }
        );
        expect(await nflRun.espn.league(nfl, 3)).toHaveLength(1);
        expect(nflRun.urls.map((url) => url.split('scoreboard')[1])).toEqual([
            '',
            '?week=6&seasontype=2',
            '?week=8&seasontype=2',
        ]);
        await nflRun.espn.league(nfl, 14);
        expect(nflRun.urls.slice(3).map((url) => url.split('scoreboard')[1])).toEqual(['?week=5&seasontype=2']);

        const nbaRun = harness(() => ({ events: [] }));
        await nbaRun.espn.league(nba, 99);
        expect(nbaRun.urls).toHaveLength(14 + 7 + 1);
        expect(nbaRun.urls[0]).toMatch(/dates=20261008$/);
    });
    it('refetches live pages after 5 minutes or on demand and keeps finished past days cached', async () => {
        const run = harness((url) => {
            if (url.includes('dates=20261022'))
                return { events: [scoreboardEvent('200', 'in', ['3', '0'], '2026-10-22T15:00Z')] };
            return { events: [scoreboardEvent(url.slice(-8), 'post', ['1', '2'], '2026-10-20T15:00Z')] };
        });
        await run.espn.league(nba, 1);
        const first = run.urls.length;
        await run.espn.league(nba, 1);
        expect(run.urls).toHaveLength(first);
        run.advance(5 * 60_000);
        await run.espn.league(nba, 1);
        expect(run.urls.slice(first).map((url) => url.slice(-8))).toEqual(['20261022']);
        const second = run.urls.length;
        run.espn.refreshLive();
        await run.espn.league(nba, 1);
        expect(run.urls.slice(second).map((url) => url.slice(-8))).toEqual(['20261022']);
        const third = run.urls.length;
        run.espn.refreshAll();
        await run.espn.league(nba, 1);
        expect(run.urls.length - third).toBe(first);
    });
});

describe('feed cache', () => {
    const source = (load?: () => Promise<Game[]>): FeedSource => ({
        id: 'league-nfl-3d',
        label: 'NFL scoreboard',
        note: 'Every game.',
        officialUrl: 'https://www.espn.com/nfl/scoreboard',
        ...(load ? { load } : {}),
    });
    it('shares pending fetches and retains last successful data with errors', async () => {
        let now = 0;
        let calls = 0;
        const feed = source(async () => {
            if (++calls > 1) throw new Error('upstream unavailable');
            return [normalizeEvent(event, team)];
        });
        const cache = new FeedCache(
            () => now,
            () => undefined
        );
        expect(cache.get(feed).pending).toBe(true);
        cache.get(feed);
        await cache.settle();
        expect(calls).toBe(1);
        expect(cache.get(feed)).toMatchObject({ label: 'NFL scoreboard', available: true });
        expect(cache.get(feed).games).toHaveLength(1);
        now = 16 * 60_000;
        cache.get(feed);
        await cache.settle();
        const stale = cache.get(feed);
        expect(stale.stale).toBe(true);
        expect(stale.error).not.toBeNull();
        expect(stale.games).toHaveLength(1);
        expect(calls).toBe(2);
    });
    it('reloads every feed after invalidate', async () => {
        let calls = 0;
        const feed = source(async () => {
            calls += 1;
            return [];
        });
        const cache = new FeedCache(() => 0);
        cache.get(feed);
        await cache.settle();
        cache.get(feed);
        await cache.settle();
        expect(calls).toBe(1);
        cache.invalidate((id) => id !== feed.id);
        cache.get(feed);
        await cache.settle();
        expect(calls).toBe(1);
        cache.invalidate();
        cache.get(feed);
        await cache.settle();
        expect(calls).toBe(2);
    });
    it('returns a link-only feed for sports without a loader', () => {
        const cache = new FeedCache();
        expect(cache.get(source())).toMatchObject({ games: [], error: null, pending: false, available: false });
    });
});
