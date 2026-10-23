import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Game, Team } from '../shared/contracts.js';
import { reconcile } from '../shared/reconcile.js';
import { createApp } from '../server/app.js';
import { buildCalendar, escapeText, eventTitle, foldLine } from '../server/calendar.js';
import { defaultFavorites, teams } from '../server/catalog.js';
import { FeedCache } from '../server/feeds.js';
import { describeSituation, parseEvents, SportsProvider } from '../server/provider.js';
import { visibleGames } from '../src/games.js';

const colts = teams.find((team) => team.id === '134927')!;
const seahawks = teams.find((team) => team.name.includes('Seahawks'))!;
const base: Game = {
    id: '401',
    teamIds: [colts.id],
    sport: 'Football',
    league: 'NFL',
    title: 'Seattle Seahawks at Indianapolis Colts',
    home: 'Indianapolis Colts',
    away: 'Seattle Seahawks',
    homeScore: 21,
    awayScore: 17,
    startTime: '2026-10-25T17:00:00.000Z',
    date: '2026-10-25',
    status: 'live',
    statusLabel: 'Q3 4:12',
    sourceUrl: 'https://www.espn.com/nfl/game/_/gameId/401',
};

describe('reconcile', () => {
    const schedule: Game = { ...base, origin: 'schedule', broadcast: 'CBS', homeRecord: '5-2' };
    const scoreboard: Game = {
        ...base,
        origin: 'scoreboard',
        homeScore: 24,
        teamIds: [seahawks.id],
        situation: '2nd & 7 at IND 35',
    };
    it('prefers the scoreboard copy in either order and keeps details only the schedule copy has', () => {
        for (const games of [
            [schedule, scoreboard],
            [scoreboard, schedule],
        ]) {
            const game = reconcile(games).get('401')!;
            expect([game.awayScore, game.homeScore]).toEqual([17, 24]);
            expect(game.broadcast).toBe('CBS');
            expect(game.homeRecord).toBe('5-2');
            expect(game.situation).toBe('2nd & 7 at IND 35');
            expect(game.teamIds.sort()).toEqual([colts.id, seahawks.id].sort());
        }
    });
    it('lets the later copy win a tie and never copies an old situation onto a newer copy', () => {
        const later: Game = {
            ...scoreboard,
            homeScore: 31,
            status: 'final',
            statusLabel: 'Final',
            situation: undefined,
        };
        const game = reconcile([scoreboard, later]).get('401')!;
        expect(game.homeScore).toBe(31);
        expect(game.situation).toBeUndefined();
    });
    it('gives a Purdue schedule copy the Big Ten scoreboard score in its own section', () => {
        const purdue: Game = { ...base, league: 'NCAA', origin: 'schedule', homeScore: 0, awayScore: 0 };
        const bigTen: Game = { ...base, league: 'Big Ten', origin: 'scoreboard', homeScore: 14, awayScore: 7 };
        const now = new Date('2026-10-25T18:00:00Z');
        const games = visibleGames([purdue, bigTen], 'live', 'all', [], now);
        expect(games).toHaveLength(2);
        for (const game of games) expect([game.awayScore, game.homeScore]).toEqual([7, 14]);
    });
});

describe('situation', () => {
    it('reads football down, distance, red zone and possession', () => {
        expect(
            describeSituation(
                'Football',
                { downDistanceText: '3rd & 2 at SEA 8', isRedZone: true, possession: '11' },
                '11',
                '26'
            )
        ).toEqual({ situation: '3rd & 2 at SEA 8 · Red zone', possession: 'home' });
    });
    it('reads baseball outs, runners and the count, and needs outs', () => {
        expect(
            describeSituation('Baseball', { outs: 2, onFirst: true, onThird: true, balls: 3, strikes: 1 }, '1', '2')
        ).toEqual({ situation: '2 outs · 1st, 3rd · 3-1' });
        expect(describeSituation('Baseball', { outs: 1 }, '1', '2')).toEqual({ situation: '1 out · Bases empty' });
        expect(describeSituation('Baseball', { onFirst: true }, '1', '2')).toEqual({});
        expect(describeSituation('Basketball', { possession: '1' }, '1', '2')).toEqual({});
    });
});

describe('team schedule parsing', () => {
    const event = {
        id: '401872659',
        name: 'Baltimore Ravens at Indianapolis Colts',
        date: '2026-09-13T17:00Z',
        competitions: [
            {
                status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
                competitors: [
                    { homeAway: 'away', team: { id: '33', displayName: 'Baltimore Ravens' } },
                    { homeAway: 'home', team: { id: '11', displayName: 'Indianapolis Colts' } },
                ],
            },
        ],
    };
    it('skips one bad event and marks schedule copies', () => {
        const games = parseEvents({ events: [event, { id: 'bad' }] }, colts);
        expect(games).toHaveLength(1);
        expect(games[0].origin).toBe('schedule');
        expect(() => parseEvents({ events: [{ id: 'bad' }] }, colts)).toThrow('failed to parse');
    });
});

describe('season cache', () => {
    it('throws on a cold-start failure, then serves the last good copy after a later failure', async () => {
        let clock = Date.UTC(2026, 9, 1);
        let fail = true;
        let calls = 0;
        const body = {
            events: [
                {
                    id: '1',
                    name: 'Ravens at Colts',
                    date: '2026-10-20T17:00Z',
                    competitions: [
                        {
                            status: { type: { state: 'pre' } },
                            competitors: [
                                { homeAway: 'away', team: { id: '33' } },
                                { homeAway: 'home', team: { id: '11' } },
                            ],
                        },
                    ],
                },
            ],
        };
        const espn = new SportsProvider(
            async () => {
                calls += 1;
                return fail ? new Response('{}', { status: 500 }) : new Response(JSON.stringify(body));
            },
            () => clock,
            async (ms) => {
                clock += ms;
            }
        );
        await expect(espn.season(colts)).rejects.toThrow('HTTP 500');
        await expect(espn.season(colts)).rejects.toThrow();
        expect(calls).toBe(1);
        clock += 15 * 60_000;
        fail = false;
        expect(await espn.season(colts)).toHaveLength(1);
        clock += 6 * 60 * 60_000;
        fail = true;
        expect(await espn.season(colts)).toHaveLength(1);
    });
});

describe('ICS output', () => {
    const now = Date.UTC(2026, 9, 22, 12);
    it('escapes text and folds long lines at 75 octets without splitting characters', () => {
        expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
        const folded = foldLine(`SUMMARY:${'é'.repeat(80)}`);
        for (const line of folded.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
        expect(
            folded
                .split('\r\n')
                .map((line, index) => (index ? line.slice(1) : line))
                .join('')
        ).toBe(`SUMMARY:${'é'.repeat(80)}`);
    });
    it('writes timed, all-day, final and canceled events with stable UIDs', () => {
        const text = buildCalendar(
            [
                { ...base, status: 'upcoming', homeScore: null, awayScore: null, broadcast: 'FOX' },
                { ...base, id: '402', startTime: null, date: '2026-11-01', status: 'upcoming' },
                { ...base, id: '403', status: 'final' },
                { ...base, id: '404', status: 'canceled' },
                { ...base, id: '405', startTime: null, date: null },
            ],
            now
        );
        expect(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
        expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
        expect(text).not.toMatch(/[^\r]\n/);
        expect(text).toContain('UID:401@team-scoreboard.jimlertech.com');
        expect(text).toContain('DTSTART:20261025T170000Z\r\nDTEND:20261025T203000Z');
        expect(text).toContain('LOCATION:TV: FOX');
        expect(text).toContain('DTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102');
        expect(text).toContain('SUMMARY:Seattle Seahawks 17\\, Indianapolis Colts 21 (Final)');
        expect(text).toContain('STATUS:CANCELLED');
        expect(text).not.toContain('UID:405@');
        expect(eventTitle({ ...base, status: 'postponed' })).toBe('Postponed: Seattle Seahawks at Indianapolis Colts');
    });
});

describe('calendar route', () => {
    const token = 'x'.repeat(43);
    let server: Server;
    let origin: string;
    let failSeason = false;
    const shared: Game = { ...base, status: 'upcoming', origin: 'schedule', teamIds: [colts.id, seahawks.id] };
    const sports = {
        async league() {
            return [];
        },
        async schedule() {
            return [];
        },
        async season(team: Team) {
            if (failSeason) throw new Error('ESPN down');
            return team.id === colts.id || team.id === seahawks.id ? [shared] : [];
        },
        refreshLive() {},
        refreshAll() {},
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
                store: {
                    list: async () => [...defaultFavorites, seahawks.id],
                    add: async () => undefined,
                    remove: async () => undefined,
                    ready: async () => undefined,
                },
                feeds: new FeedCache(),
                sports,
                allowedOrigins: [origin],
                calendar: { token, origin: 'https://team-scoreboard.jimlertech.com' },
            })
        );
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it('serves one event per game to the right token only', async () => {
        const response = await fetch(`${origin}/calendar/${token}.ics`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
        const text = await response.text();
        expect(text.match(/UID:401@/g)).toHaveLength(1);
        for (const path of [`/calendar/${'y'.repeat(43)}.ics`, `/calendar/${token}`, '/calendar', '/calendar/a/b'])
            expect((await fetch(`${origin}${path}`)).status).toBe(404);
    });
    it('returns 503 with Retry-After when a watched schedule has never loaded', async () => {
        failSeason = true;
        const response = await fetch(`${origin}/calendar/${token}.ics`);
        failSeason = false;
        expect(response.status).toBe(503);
        expect(response.headers.get('retry-after')).toBe('900');
    });
    it('gives the signed-in page the public link', async () => {
        const body = (await (await fetch(`${origin}/api/calendar`)).json()) as { url: string };
        expect(body.url).toBe(`https://team-scoreboard.jimlertech.com/calendar/${token}.ics`);
    });
});
