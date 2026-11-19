import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Game } from '../shared/contracts.js';
import { teams, expandFavorites, leagues } from '../server/catalog.js';
import {
    isHot,
    footballScored,
    nationalName,
    normalizeEvent,
    parseEvents,
    parseScoreboard,
    scoreboardDays,
    selectWindow,
    SportsProvider,
} from '../server/provider.js';
import { FeedCache } from '../server/feeds.js';
import type { FeedSource } from '../server/feeds.js';
import { compactGames, formatStart, formatTime, groupGames, matchesGameStatus, visibleGames } from '../src/games.js';

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
    it('keeps individual baseball innings, extra innings, and unplayed halves separate', () => {
        const mlb = leagues.find((league) => league.league === 'MLB')!;
        const [game] = parseScoreboard(
            {
                events: [
                    {
                        ...event,
                        competitions: [
                            {
                                ...event.competitions[0],
                                venue: { fullName: 'Dodger Stadium' },
                                competitors: [
                                    {
                                        homeAway: 'home',
                                        team: {
                                            id: '19',
                                            abbreviation: 'LAD',
                                            color: '005A9C',
                                            logo: 'https://a.espncdn.com/i/teamlogos/mlb/500/lad.png',
                                        },
                                        score: '3',
                                        linescores: [{ value: 0 }, { period: 10, value: 3 }],
                                    },
                                    {
                                        homeAway: 'away',
                                        team: {
                                            id: '26',
                                            abbreviation: 'SF',
                                            color: 'invalid',
                                            logo: 'https://example.com/logo.png',
                                        },
                                        score: '2',
                                        linescores: [
                                            { value: 0 },
                                            { period: 3, displayValue: '2' },
                                            { period: 10, displayValue: 'X', value: 0 },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            mlb
        );
        expect(game).toMatchObject({
            awayAbbreviation: 'SF',
            homeColor: '#005a9c',
            homeLogo: 'https://a.espncdn.com/i/teamlogos/mlb/500/lad.png',
            venue: 'Dodger Stadium',
        });
        expect(game.awayLogo).toBeUndefined();
        expect(game.awayColor).toBeUndefined();
        expect(game.lineScore?.map(({ period }) => period)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(game.lineScore?.slice(0, 3)).toEqual([
            { period: 1, away: 0, home: 0 },
            { period: 2, away: null, home: null },
            { period: 3, away: 2, home: null },
        ]);
        expect(game.lineScore?.at(-1)).toEqual({ period: 10, away: 'X', home: 3 });
    });
    it('reads a final with home/away by role, zero scores, UTC instant and the ESPN summary link', () => {
        const game = normalizeEvent(event, team);
        expect(game).toMatchObject({
            home: 'Indianapolis Colts',
            away: 'Baltimore Ravens',
            homeTeamId: '134927',
            awayTeamId: '134922',
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
        expect(formatStart(game)).toBe('09/13/2026 · time unannounced');
        expect(formatStart({ startTime: null, date: null })).toBe('Date and time unannounced');
    });
    it('shows start times on a 24-hour clock', () => {
        const evening = { startTime: '2026-10-25T02:30:00Z', date: null };
        expect(formatTime(evening)).toBe('19:30');
        expect(formatStart(evening)).toBe('10/24/2026 19:30');
        expect(formatTime({ ...evening, startTime: '2026-10-24T07:05:00Z' })).toBe('00:05');
        expect(formatTime({ ...evening, startTime: '2026-01-24T07:05:00Z' })).toBe('23:05');
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

describe('football scoring before kickoff', () => {
    const play = (id: string, type: string, homeScore: number, awayScore: number, scoringPlay = false) => ({
        id,
        type: { text: type },
        homeScore,
        awayScore,
        scoringPlay,
    });
    const kickoff = play('1', 'Kickoff', 0, 0);
    const touchdown = play('2', 'Rushing Touchdown', 6, 0, true);
    const extraPoint = play('3', 'Extra Point Good', 7, 0, true);
    const game = { ...normalizeEvent(event, team), status: 'live' as const, homeScore: 7, awayScore: 0 };
    const summary = (...plays: ReturnType<typeof play>[]) => ({ drives: { previous: [{ plays }] } });

    it('identifies the scoring side after a touchdown and extra point', () => {
        expect(footballScored(summary(kickoff, touchdown, extraPoint), game)).toBe('home');
    });
    it('clears the label when kickoff and a later play both occur between polls', () => {
        const nextKickoff = play('4', 'Kickoff', 7, 0);
        const rush = play('5', 'Rush', 7, 0);
        expect(footballScored(summary(kickoff, touchdown, extraPoint, nextKickoff, rush), game)).toBeUndefined();
    });
    it('identifies a kickoff return touchdown for the receiving team', () => {
        const returnTouchdown = play('4', 'Kickoff Return Touchdown', 7, 6, true);
        expect(
            footballScored(summary(kickoff, touchdown, extraPoint, returnTouchdown), { ...game, awayScore: 6 })
        ).toBe('away');
    });
    it('rejects play history that has not caught up with the scoreboard', () => {
        expect(() => footballScored(summary(kickoff, touchdown), game)).toThrow('not caught up');
    });
    it('clears a score that was reversed', () => {
        const reversal = play('4', 'Replay Review', 0, 0);
        expect(
            footballScored(summary(kickoff, touchdown, extraPoint, reversal), { ...game, homeScore: 0 })
        ).toBeUndefined();
    });
});

describe('window and filters', () => {
    const make = (id: string, day: number, gameStatus: Game['status']): Game => ({
        ...normalizeEvent(event, team),
        id,
        status: gameStatus,
        startTime: new Date(Date.UTC(2026, 9, day, 17)).toISOString(),
    });
    it('uses Pacific dates for Today, Upcoming and day headings', () => {
        const now = new Date('2026-01-02T07:15:00Z');
        const today = { ...make('today', 1, 'upcoming'), startTime: '2026-01-02T07:30:00Z' };
        const tomorrow = { ...make('tomorrow', 2, 'upcoming'), startTime: '2026-01-02T08:30:00Z' };
        const games = [today, tomorrow];
        expect(visibleGames(games, 'live', 'all', [], now).map((game) => game.id)).toEqual(['today']);
        expect(visibleGames(games, 'upcoming', 'all', [], now).map((game) => game.id)).toEqual(['tomorrow']);
        const [section] = groupGames(games, 'upcoming', [], now);
        expect(section.days.map((day) => day.label)).toEqual(['Today · 01/01/2026', 'Tomorrow · 01/02/2026']);
    });
    it('sorts compact favorites across leagues and nonfavorites by league without duplicate events', () => {
        const makeGame = (id: string, league: string, day: number, favorite = false): Game => ({
            ...make(id, day, 'upcoming'),
            league,
            teamIds: favorite ? ['favorite'] : [id],
        });
        const games = [
            makeGame('nba-late', 'NBA', 20),
            makeGame('favorite-late', 'NFL', 22, true),
            makeGame('nfl-late', 'NFL', 21),
            makeGame('favorite-early', 'NBA', 17, true),
            makeGame('nba-early', 'NBA', 18),
            makeGame('nfl-early', 'NFL', 19),
            makeGame('mlb', 'MLB', 18),
            makeGame('big-ten', 'Big Ten', 18),
            makeGame('shared', 'Big Ten', 16),
            makeGame('shared', 'NCAA', 16),
            { ...makeGame('undated', 'NFL', 16), startTime: null },
        ];
        expect(compactGames(games, ['favorite']).map((game) => game.id)).toEqual([
            'favorite-early',
            'favorite-late',
            'shared',
            'nfl-early',
            'nfl-late',
            'undated',
            'big-ten',
            'mlb',
            'nba-early',
            'nba-late',
        ]);
        expect(compactGames(games, ['favorite']).find((game) => game.id === 'shared')?.league).toBe('NCAA');
        expect(games[0].id).toBe('nba-late');
    });
    it('orders compact Recent newest day first and earliest game first within a day', () => {
        const at = (id: string, day: number, hour: number, favorite = false): Game => ({
            ...make(id, day, 'final'),
            league: 'NBA',
            teamIds: favorite ? ['favorite'] : [id],
            startTime: new Date(2026, 9, day, hour).toISOString(),
        });
        const games = [
            at('old', 20, 19),
            at('new-late', 21, 19),
            at('new-early', 21, 15),
            at('fav-old', 20, 18, true),
            at('fav-new', 21, 16, true),
            { ...at('undated', 21, 12), startTime: null, date: null },
        ];
        expect(compactGames(games, ['favorite'], true).map((game) => game.id)).toEqual([
            'fav-new',
            'fav-old',
            'new-early',
            'new-late',
            'old',
            'undated',
        ]);
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
        const on = new Date(2026, 9, 15, 12);
        expect(visibleGames(all, 'live', 'all', [], on).map((game) => game.id)).toEqual(['live']);
        expect(visibleGames(all, 'upcoming', 'all', [], on).map((game) => game.id)).toEqual(['up']);
        expect(visibleGames(all, 'recent', 'all', [], on)).toHaveLength(1);
        expect(visibleGames(all, 'recent', '134949', [], on)).toHaveLength(1);
        expect(visibleGames(all, 'recent', 'favorites', ['134949'], on)).toHaveLength(1);
        expect(visibleGames(all, 'recent', 'favorites', ['nba-11'], on)).toHaveLength(0);
        expect(visibleGames(all, 'recent', 'league:NFL', [], on)).toHaveLength(1);
        expect(visibleGames(all, 'recent', 'league:NBA', [], on)).toHaveLength(0);
    });
    it.each(['live', 'upcoming', 'recent'] as const)('matches a union of Show filters in %s', (view) => {
        const now = new Date(2026, 9, 15, 12);
        const day = view === 'recent' ? 14 : view === 'upcoming' ? 16 : 15;
        const status = view === 'recent' ? 'final' : view === 'live' ? 'live' : 'upcoming';
        const nfl = { ...make('nfl', day, status), league: 'NFL', teamIds: ['colts'] };
        const nba = { ...make('nba', day, status), league: 'NBA', teamIds: ['pacers'] };
        const mlb = { ...make('mlb', day, status), league: 'MLB', teamIds: ['cubs'] };
        const games = [nfl, nba, mlb, { ...nfl }];
        const ids = (filters: string[], favorites: string[] = []) =>
            visibleGames(games, view, filters, favorites, now).map((game) => game.id);
        expect(ids(['colts', 'league:NBA'])).toEqual(['nfl', 'nba']);
        expect(ids(['league:NFL', 'colts'])).toEqual(['nfl']);
        expect(ids(['favorites', 'league:NBA'], ['cubs'])).toEqual(['nba', 'mlb']);
        expect(ids(['league:NFL', 'league:NBA'])).toEqual(['nfl', 'nba']);
        expect(ids(['all'])).toEqual(['nfl', 'nba', 'mlb']);
    });
    it('keeps 14 days of results by default and the next 7 days of upcoming games', () => {
        const on = new Date(2026, 9, 22, 12);
        const games = [
            make('fin-14', 8, 'final'),
            make('fin-15', 7, 'final'),
            make('up-7', 29, 'upcoming'),
            make('up-8', 30, 'upcoming'),
            { ...make('tba', 23, 'upcoming'), startTime: null, date: null },
        ];
        expect(visibleGames(games, 'recent', 'all', [], on).map((game) => game.id)).toEqual(['fin-14']);
        expect(visibleGames(games, 'recent', 'all', [], on, 3)).toHaveLength(0);
        expect(
            visibleGames(games, 'upcoming', 'all', [], on)
                .map((game) => game.id)
                .sort()
        ).toEqual(['tba', 'up-7']);
    });
    it.each([1, 3, 5])('shows only the next %i local days and undated games in Upcoming', (days) => {
        const now = new Date(2026, 9, 31, 12);
        const at = (offset: number, gameStatus: Game['status'] = 'upcoming'): Game => ({
            ...make(`day-${offset}-${gameStatus}`, 31, gameStatus),
            startTime: new Date(2026, 9, 31 + offset, 12).toISOString(),
        });
        const games = [
            at(0),
            at(1),
            at(3),
            at(5),
            at(6),
            at(1, 'live'),
            at(1, 'final'),
            { ...at(1), id: 'undated', startTime: null, date: null },
            { ...at(1), id: 'date-only', startTime: null, date: '2026-11-01' },
        ];
        expect(visibleGames(games, 'upcoming', 'all', [], now, days).map((game) => game.id)).toEqual([
            ...[1, 3, 5].filter((offset) => offset <= days).map((offset) => `day-${offset}-upcoming`),
            'undated',
            'date-only',
        ]);
    });
    it('keeps past postponed and canceled games out of Upcoming and lists them in Recent', () => {
        const on = new Date(2026, 9, 22, 12);
        const games = [
            make('ppd', 17, 'postponed'),
            make('cxl', 20, 'canceled'),
            make('stale', 21, 'upcoming'),
            make('today', 22, 'upcoming'),
            make('ppd-next', 24, 'postponed'),
        ];
        expect(
            visibleGames(games, 'upcoming', 'all', [], on)
                .map((game) => game.id)
                .sort()
        ).toEqual(['ppd-next']);
        expect(
            visibleGames(games, 'recent', 'all', [], on)
                .map((game) => game.id)
                .sort()
        ).toEqual(['cxl', 'ppd', 'stale']);
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
            at('early', 23, 13, ['nba-1'], 'upcoming'),
            at('fav', 23, 20, ['134927'], 'upcoming'),
            at('tomorrow', 23, 19, ['nba-2'], 'upcoming'),
            at('mlb', 23, 16, ['mlb-1'], 'upcoming', 'MLB'),
            at('boiler', 24, 12, ['purdue-football'], 'upcoming', 'NCAA'),
            at('boiler', 24, 12, ['purdue-football'], 'upcoming', 'Big Ten'),
            at('nfl', 25, 10, ['nfl-1'], 'upcoming', 'NFL'),
            { ...at('tba', 24, 19, ['nba-3'], 'upcoming'), startTime: null, date: null },
        ];
        const shown = visibleGames(upcoming, 'upcoming', 'all', [], now);
        expect(shown.filter((game) => game.id === 'boiler').map((game) => game.league)).toEqual(['NCAA', 'Big Ten']);
        expect(visibleGames(upcoming, 'upcoming', 'league:Big Ten', [], now)).toHaveLength(1);
        const sections = groupGames(shown, 'upcoming', ['134927'], now);
        expect(sections.map((section) => section.label)).toEqual(['Purdue', 'NFL', 'Big Ten', 'MLB', 'NBA']);
        const nba = sections.find((section) => section.key === 'NBA')!;
        expect(nba.count).toBe(4);
        expect(nba.days.map((group) => group.label.split(' · ')[0])).toEqual(['Tomorrow', 'Date to be announced']);
        expect(nba.days[0].games.map((game) => game.id)).toEqual(['fav', 'early', 'tomorrow']);

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
        expect(liveSection.days[0].games.map((game) => game.id)).toEqual(['later-fav', 'now', 'later', 'done']);
        expect(live.filter((game) => matchesGameStatus(game, 'all')).map((game) => game.id)).toEqual(
            live.map((game) => game.id)
        );
        expect(live.filter((game) => matchesGameStatus(game, 'live')).map((game) => game.id)).toEqual(['now']);
        expect(live.filter((game) => matchesGameStatus(game, 'final')).map((game) => game.id)).toEqual(['done']);

        const results = groupGames(
            [at('old', 20, 19, ['nba-1'], 'final'), at('new', 21, 19, ['nba-1'], 'final')],
            'recent',
            [],
            now
        );
        expect(results[0].days.map((group) => group.games[0].id)).toEqual(['new', 'old']);
        expect(results[0].days[0].label).toMatch(/^Yesterday · /);
    });
    it.each(['live', 'upcoming', 'recent'] as const)(
        'orders %s and compact cards by favorite, status, then oldest start time',
        (view) => {
            const now = new Date(2026, 9, 22, 9);
            const entries = [false, true].flatMap((favorite) =>
                (['upcoming', 'final', 'live'] as const).flatMap((status) =>
                    [20, 10].map((hour): Game => ({
                        ...make(`${favorite ? 'fav' : 'other'}-${status}-${hour}`, 22, status),
                        league: 'NBA',
                        teamIds: [favorite ? '134927' : 'nba-1'],
                        startTime: new Date(2026, 9, 22, hour).toISOString(),
                    }))
                )
            );
            const [section] = groupGames(entries, view, ['134927'], now);
            const expected = [
                'fav-live-10',
                'fav-live-20',
                'fav-upcoming-10',
                'fav-upcoming-20',
                'fav-final-10',
                'fav-final-20',
                'other-live-10',
                'other-live-20',
                'other-upcoming-10',
                'other-upcoming-20',
                'other-final-10',
                'other-final-20',
            ];
            expect(section.days[0].games.map((game) => game.id)).toEqual(expected);
            expect(compactGames(entries, ['134927']).map((game) => game.id)).toEqual(expected);
        }
    );
    it('puts unknown times last within status and keeps exceptional statuses after completed games', () => {
        const games = [
            { ...make('unknown-time', 22, 'upcoming'), startTime: null },
            make('scheduled', 22, 'upcoming'),
            make('completed', 21, 'final'),
            make('postponed', 20, 'postponed'),
            make('canceled', 19, 'canceled'),
            make('unknown', 18, 'unknown'),
        ];
        expect(compactGames(games, []).map((game) => game.id)).toEqual([
            'scheduled',
            'unknown-time',
            'completed',
            'unknown',
            'canceled',
            'postponed',
        ]);
    });
    it('puts live NFL red-zone games with a position before those without one', () => {
        const at = (id: string, hour: number, extra: Partial<Game> = {}): Game => ({
            ...make(id, 22, 'live'),
            league: 'NFL',
            teamIds: ['other'],
            startTime: new Date(2026, 9, 22, hour).toISOString(),
            ...extra,
        });
        const games = [
            at('normal', 10),
            at('red-zone', 12, { redZone: true, situation: '2nd & 4 at GB 12' }),
            at('red-zone-no-position', 9, { redZone: true, situation: '1st & Goal' }),
            at('red-zone-empty-position', 8, { redZone: true, situation: '1st & Goal at   ' }),
            at('favorite', 11, { teamIds: ['favorite'] }),
            at('old-red-zone', 9, { status: 'final', redZone: true }),
            at('other-sport', 8, { league: 'NFL', sport: 'Basketball', redZone: true, status: 'upcoming' }),
        ];
        const expected = [
            'favorite',
            'red-zone',
            'red-zone-empty-position',
            'red-zone-no-position',
            'normal',
            'other-sport',
            'old-red-zone',
        ];
        expect(compactGames(games, ['favorite']).map((game) => game.id)).toEqual(expected);
        const section = groupGames(games, 'live', ['favorite'], new Date(2026, 9, 22))[0];
        expect(section.days[0].games.map((game) => game.id)).toEqual(expected);
    });
    it('orders live games with the same start by time remaining after favorite and red-zone priority', () => {
        const live = (id: string, statusLabel: string, extra: Partial<Game> = {}): Game => ({
            ...make(id, 22, 'live'),
            league: 'NFL',
            sport: 'Football',
            teamIds: ['other'],
            statusLabel,
            ...extra,
        });
        const games = [
            live('a-early-period', 'Q3 1:00'),
            live('b-long-clock', '10:00 - 4th'),
            live('c-short-clock', 'Q4 2:30'),
            live('d-overtime', 'OT 7:00'),
            live('e-halftime', 'Halftime'),
            live('f-unknown', 'In progress'),
            live('favorite', 'Q1 14:00', { teamIds: ['favorite'] }),
            live('red-zone', 'Q1 13:00', { redZone: true, situation: '1st & Goal at IND 5' }),
        ];
        const expected = [
            'favorite',
            'red-zone',
            'c-short-clock',
            'd-overtime',
            'b-long-clock',
            'a-early-period',
            'e-halftime',
            'f-unknown',
        ];
        expect(compactGames(games, ['favorite']).map((game) => game.id)).toEqual(expected);
        const [section] = groupGames(games, 'live', ['favorite'], new Date(2026, 9, 22));
        expect(section.days[0].games.map((game) => game.id)).toEqual(expected);
        const earlier = live('earlier', 'Q1 14:00', { startTime: new Date(Date.UTC(2026, 9, 22, 16)).toISOString() });
        expect(compactGames([games[3], earlier], []).map((game) => game.id)).toEqual(['earlier', 'd-overtime']);
        const nba = live('nba', 'Q3 1:00', { league: 'NBA', sport: 'Basketball' });
        const college = live('college', '2nd Half 12:00', { league: 'Big Ten', sport: "Men's Basketball" });
        const lateFootball = live('football', 'Q4 14:00');
        expect(compactGames([nba, lateFootball, college], ['other']).map((game) => game.id)).toEqual([
            'college',
            'nba',
            'football',
        ]);
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
    it('uses the volleyball match scoreboard for sets won and points during play', async () => {
        const volleyball = teams.find((item) => item.id === 'purdue-volleyball')!;
        const match = (set: number, statusName: string, scores?: [number, number]) => ({
            ...event,
            name: 'Purdue at Indiana',
            competitions: [
                {
                    status: {
                        period: set,
                        type: { ...status(statusName, 'in', '2nd').type, detail: '2nd Set' },
                    },
                    competitors: ['2509', '84'].map((id, index) => ({
                        homeAway: index === 0 ? 'away' : 'home',
                        team: { id },
                        ...(scores && {
                            score: index === 0 ? '1' : '0',
                            linescores: [
                                { period: 1, value: index === 0 ? 25 : 20 },
                                { period: 2, value: scores[index] },
                            ],
                        }),
                    })),
                },
            ],
        });
        const schedule = match(2, 'STATUS_IN_PROGRESS');
        expect(normalizeEvent(schedule, volleyball)).toMatchObject({ awayScore: null, homeScore: null });
        let report = match(2, 'STATUS_IN_PROGRESS', [12, 0]);
        const urls: string[] = [];
        const espn = provider(
            (url) => new Response(JSON.stringify(url.includes('/scoreboard/') ? report : { events: [schedule] })),
            urls
        );
        expect((await espn.schedule(volleyball))[0]).toMatchObject({
            origin: 'scoreboard',
            statusLabel: '2nd Set',
            awayScore: 1,
            homeScore: 0,
            situation: 'Set points: 12–0',
            lineScore: [
                { period: 1, away: 25, home: 20 },
                { period: 2, away: 12, home: 0 },
            ],
        });
        expect(urls[1]).toMatch(new RegExp(`/womens-college-volleyball/scoreboard/${event.id}$`));
        report = match(3, 'STATUS_IN_PROGRESS', [12, 13]);
        expect((await espn.schedule(volleyball))[0].situation).toBeUndefined();
        report = match(2, 'STATUS_END_PERIOD', [12, 25]);
        expect((await espn.schedule(volleyball))[0].situation).toBeUndefined();
    });
    it('refreshes play history until the kickoff, then avoids fetching it on unchanged scores', async () => {
        const urls: string[] = [];
        const live = withStatus(status('STATUS_IN_PROGRESS', 'in', 'Q1 7:41'), ['0', '7']);
        let kicked = false;
        const espn = provider((url) => {
            if (url.includes('/summary?')) {
                const plays = [
                    { id: '1', type: { text: 'Touchdown' }, homeScore: 7, awayScore: 0, scoringPlay: true },
                    ...(kicked
                        ? [{ id: '2', type: { text: 'Kickoff' }, homeScore: 7, awayScore: 0, scoringPlay: false }]
                        : []),
                ];
                return new Response(JSON.stringify({ drives: { previous: [{ plays }] } }));
            }
            return new Response(JSON.stringify(url.includes('/scoreboard/') ? live : { events: [live] }));
        }, urls);
        expect((await espn.schedule(team, true))[0].scored).toBe('home');
        kicked = true;
        expect((await espn.schedule(team, true))[0].scored).toBeUndefined();
        expect((await espn.schedule(team, true))[0].scored).toBeUndefined();
        expect(urls.filter((url) => url.includes('/summary?'))).toHaveLength(2);
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
    it('identifies Purdue on the right side of a Big Ten game', () => {
        const [football] = leagues.filter((source) => source.league === 'Big Ten');
        const fixture = scoreboardEvent('2', 'in', ['14', '21']);
        fixture.competitions[0].competitors = [
            competitor('away', '2509', 'Purdue Boilermakers', '14'),
            competitor('home', '130', 'Michigan Wolverines', '21'),
        ];
        const [game] = parseScoreboard({ events: [fixture] }, football);
        expect(game.awayTeamId).toBe('purdue-football');
        expect(game.homeTeamId).toBeUndefined();
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
    it('filters Big Ten scoreboards with the ESPN conference group', async () => {
        const [football, basketball] = leagues.filter((source) => source.league === 'Big Ten');
        const footballRun = harness((url) =>
            url.endsWith('?groups=5') ? { events: [], week: { number: 8 }, season: { type: 2 } } : { events: [] }
        );
        await footballRun.espn.league(football, 3);
        expect(footballRun.urls.map((url) => url.split('sports/')[1])).toEqual([
            'football/college-football/scoreboard?groups=5',
            'football/college-football/scoreboard?groups=5&week=7&seasontype=2',
            'football/college-football/scoreboard?groups=5&week=9&seasontype=2',
        ]);
        const basketballRun = harness(() => ({ events: [] }));
        await basketballRun.espn.league(basketball, 1);
        expect(basketballRun.urls[0]).toMatch(/mens-college-basketball\/scoreboard\?groups=7&dates=20261021$/);
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
        // The settled past day (20261021) keeps its scores; everything else is fetched again.
        expect(run.urls.slice(third).map((url) => url.slice(-8))).not.toContain('20261021');
        expect(run.urls.length - third).toBe(first - 1);
    });
    it('saves settled past days to disk and reloads them after a restart', async () => {
        const directory = mkdtempSync(join(process.cwd(), '.scoreboard-test-'));
        const file = join(directory, 'cache.json');
        const body = (url: string) =>
            url.includes('dates=20261021')
                ? { events: [scoreboardEvent('300', 'post', ['1', '2'], '2026-10-21T15:00Z')] }
                : { events: [] };
        let clock = Date.parse('2026-10-22T16:00Z');
        const urls: string[] = [];
        const make = () =>
            new SportsProvider(
                async (url) => {
                    urls.push(String(url));
                    return new Response(JSON.stringify(body(String(url))));
                },
                () => clock,
                async (delay) => {
                    clock += delay;
                },
                file
            );
        try {
            await make().league(nba, 1);
            await vi.waitFor(() => expect(existsSync(file)).toBe(true), { timeout: 5000 });
            const saved = JSON.parse(readFileSync(file, 'utf8'));
            expect(saved.version).toBe(2);
            expect(Object.keys(saved.pages)).toEqual([`${nba.id}?dates=20261021`]);
            urls.length = 0;
            const games = await make().league(nba, 1);
            expect(urls.map((url) => url.slice(-8))).not.toContain('20261021');
            expect(games.map((game) => game.id)).toContain('300');
            writeFileSync(file, JSON.stringify({ ...saved, version: 1 }));
            urls.length = 0;
            await make().league(nba, 1);
            expect(urls.map((url) => url.slice(-8))).toContain('20261021');
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
    it('reads records and the TV channel from both ESPN shapes', () => {
        const [game] = parseScoreboard(
            {
                events: [
                    {
                        ...scoreboardEvent('400', 'pre', null),
                        competitions: [
                            {
                                ...scoreboardEvent('400', 'pre', null).competitions[0],
                                broadcasts: [{ market: 'national', names: ['ESPN', 'ABC', 'ESPN'] }],
                                competitors: [
                                    {
                                        ...competitor('away', '17', 'New England Patriots'),
                                        records: [
                                            { name: 'overall', type: 'total', summary: '5-2' },
                                            { name: 'Home', type: 'home', summary: '3-0' },
                                        ],
                                    },
                                    {
                                        ...competitor('home', '3', 'Chicago Bears'),
                                        records: [{ type: 'total', summary: 'n/a' }],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            nfl
        );
        expect(game).toMatchObject({ broadcast: 'ESPN, ABC', awayRecord: '5-2', national: 'ESPN, ABC' });
        expect(game.homeRecord).toBeUndefined();

        const scheduled = {
            ...event,
            competitions: [
                {
                    ...event.competitions[0],
                    broadcasts: [{ media: { shortName: 'Fox' } }],
                    competitors: event.competitions[0].competitors.map((entry, index) => ({
                        ...entry,
                        record: index ? [{ type: 'total', displayValue: '3-4' }] : null,
                    })),
                },
            ],
        };
        expect(normalizeEvent(scheduled, team)).toMatchObject({ broadcast: 'Fox', homeRecord: '3-4' });
        expect(normalizeEvent(scheduled, team).national).toBeUndefined();
    });
    it('marks national networks but not NBA TV, League Pass, NBCSN or local markets', () => {
        expect(nationalName([{ market: 'national', names: ['ESPN', 'ABC'] }])).toBe('ESPN, ABC');
        expect(nationalName([{ market: 'national', names: ['NBA TV'] }])).toBeUndefined();
        expect(nationalName([{ market: 'national', names: ['ESPN', 'NBA TV'] }])).toBe('ESPN');
        expect(nationalName([{ market: 'national', names: ['NBCSN'] }])).toBeUndefined();
        expect(nationalName([{ market: 'national', names: ['NBCSN', 'NBC'] }])).toBe('NBC');
        expect(
            nationalName([
                { market: 'away', names: ['NBA League Pass', 'Peacock'] },
                { market: 'home', names: ['KFAA-TV'] },
            ])
        ).toBeUndefined();
        expect(nationalName([{ names: ['ESPN'] }, { media: { shortName: 'NBC' } }])).toBeUndefined();
        expect(nationalName([{ market: 'National', names: ['League Pass', 'Peacock'] }])).toBe('Peacock');
    });
    it("fills the favorite's current record on games still to play", () => {
        const upcoming = withStatus(status('STATUS_SCHEDULED', 'pre', 'Sun, Sep 13'));
        const [game] = parseEvents({ events: [upcoming], team: { recordSummary: '6-1' } }, team);
        expect(game).toMatchObject({ status: 'upcoming', homeRecord: '6-1' });
        expect(game.awayRecord).toBeUndefined();
        const [final] = parseEvents({ events: [event], team: { recordSummary: '6-1' } }, team);
        expect(final.homeRecord).toBeUndefined();
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
        expect(cache.load(source())).toBeNull();
    });
    it('returns the load it starts, and null when the feed is loading or not due', async () => {
        let now = 0;
        let calls = 0;
        const feed: FeedSource = {
            ...source(async () => {
                calls += 1;
                return [];
            }),
            interval: () => 30_000,
        };
        const cache = new FeedCache(() => now);
        const started = cache.load(feed);
        expect(started).toBeInstanceOf(Promise);
        expect(cache.load(feed)).toBeNull();
        await started;
        expect(cache.load(feed)).toBeNull();
        now = 30_000;
        expect(cache.load(feed)).toBeInstanceOf(Promise);
        await cache.settle();
        expect(calls).toBe(2);
    });
});
