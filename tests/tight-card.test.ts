import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GameCard } from '../src/GameCard';
import { GameDetails } from '../src/GameDetails';
import type { Game } from '../shared/contracts';
import type { ReactNode } from 'react';

vi.mock('../src/Tooltip', () => ({ Tooltip: ({ children }: { children: ReactNode }) => children }));

const game: Game = {
    id: '1',
    teamIds: [],
    sport: 'Football',
    league: 'NFL',
    title: 'Colts at Seahawks',
    away: 'Colts',
    home: 'Seahawks',
    awayScore: 17,
    homeScore: 14,
    startTime: '2026-11-15T20:00:00Z',
    date: '2026-11-15',
    status: 'live',
    statusLabel: 'Q3 08:42',
    sourceUrl: 'https://example.com',
    broadcast: 'ESPN',
    possession: 'away',
    situation: '2nd & 6 at SEA 12',
    redZone: true,
};

describe('tight game cards', () => {
    it.each([false, true])('keeps records only in expanded details (tight: %s)', (tight) => {
        const fixture = { ...game, awayRecord: '9-10-1', homeRecord: '8-2' };
        const html = renderToStaticMarkup(
            createElement(GameCard, { game: fixture, view: 'live', tight, scoreboardTheme: 'midnight' })
        );
        expect(html).not.toContain('9-10-1');
        expect(html).not.toContain('8-2');
        const details = renderToStaticMarkup(createElement(GameDetails, { game: fixture, theme: 'midnight' }));
        expect(details).toContain('9-10-1');
        expect(details).toContain('8-2');
    });

    it.each([false, true])('adds logos and a closed details control to enhanced cards (tight: %s)', (tight) => {
        const fixture = {
            ...game,
            awayLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ind.png',
            awayColor: '#002c5f',
            homeColor: '#002244',
        };
        const props = { game: fixture, view: 'live' as const };
        const html = renderToStaticMarkup(createElement(GameCard, { ...props, tight, scoreboardTheme: 'midnight' }));
        expect(html).toContain('/500-dark/ind.png');
        expect(html).toContain('--game-away-color:#002c5f;--game-home-color:#002244');
        expect(html).toContain('aria-label="Details for Colts at Seahawks" aria-expanded="false"');
        expect(html).toContain('class="sr-only game-details-control"');
        expect(html).not.toContain('lucide-chevron-down');
        expect(html).not.toContain(`href="${fixture.sourceUrl}"`);
        const legacyHtml = renderToStaticMarkup(createElement(GameCard, { ...props, tight }));
        expect(legacyHtml).not.toContain('game-details-control');
        expect(legacyHtml).toContain(`href="${fixture.sourceUrl}"`);
    });

    it('shows a completed baseball game inning by inning without logistics', () => {
        const html = renderToStaticMarkup(
            createElement(GameDetails, {
                theme: 'midnight',
                game: {
                    ...game,
                    league: 'MLB',
                    sport: 'Baseball',
                    status: 'final',
                    venue: 'Oracle Park',
                    lineScore: Array.from({ length: 10 }, (_, index) => ({ period: index + 1, away: 0, home: 0 })),
                },
            })
        );
        expect(html).toContain('Score by inning');
        expect(html).toContain('<th scope="col">9</th><th scope="col">10</th>');
        expect(html).not.toContain('<dl>');
        expect(html).toContain(`href="${game.sourceUrl}" target="_blank" rel="noreferrer">View game on ESPN`);
    });

    it('omits the empty scoring message for upcoming games while retaining it after play starts', () => {
        const render = (status: Game['status']) =>
            renderToStaticMarkup(createElement(GameDetails, { theme: 'midnight', game: { ...game, status } }));
        const upcoming = render('upcoming');
        expect(upcoming).not.toContain('Scoring breakdown');
        for (const status of ['live', 'final'] as const) {
            expect(render(status)).toContain('Scoring breakdown unavailable.');
        }
    });

    it('shows live volleyball points in both formats and separates sets won in the details', () => {
        const volleyball: Game = {
            ...game,
            sport: "Women's Volleyball",
            league: 'Purdue',
            away: 'Purdue',
            home: 'Indiana',
            awayScore: 1,
            homeScore: 0,
            statusLabel: '2nd Set',
            situation: 'Set points: 12–0',
            lineScore: [
                { period: 1, away: 25, home: 20 },
                { period: 2, away: 12, home: 0 },
            ],
        };
        for (const tight of [true, false]) {
            const html = renderToStaticMarkup(
                createElement(GameCard, { game: volleyball, view: 'live', tight, scoreboardTheme: 'midnight' })
            );
            expect(html).toContain('2nd Set');
            expect(html).toContain('Set points: 12–0');
        }
        const details = renderToStaticMarkup(createElement(GameDetails, { game: volleyball, theme: 'midnight' }));
        expect(details).toContain('Score by set');
        expect(details).toContain('<th scope="col">Sets won</th>');
        expect(details).toContain('<td>25</td><td>12</td><td>1</td>');
        expect(details).toContain('<td>20</td><td>0</td><td>0</td>');
    });

    it('shows the live matchup and available game info above the ESPN action', () => {
        const html = renderToStaticMarkup(
            createElement(GameDetails, {
                theme: 'midnight',
                game: { ...game, awayRecord: '4-2', venue: 'Lumen Field' },
            })
        );
        expect(html).toContain('data-status="live">Q3 08:42');
        expect(html).toContain('<strong>Colts</strong><span>4-2</span>');
        expect(html).toContain('<strong>Seahawks</strong>');
        expect(html).toContain('17 <span>:</span> 14');
        expect(html).toContain('<dd>Lumen Field</dd>');
        expect(html).toContain('<dd>2nd &amp; 6 at SEA 12</dd>');
    });

    it('uses short numeric dates for scheduled games with or without a start time', () => {
        const render = (overrides: Partial<Game>) =>
            renderToStaticMarkup(
                createElement(GameCard, {
                    game: { ...game, status: 'upcoming', ...overrides },
                    view: 'upcoming',
                    showDate: true,
                    tight: true,
                })
            );
        expect(render({ startTime: '2026-11-16T02:30:00Z' })).toContain('11/15 18:30');
        expect(render({ startTime: null })).toContain('11/15 · Time unannounced');
    });

    it.each([true, false])('shows Scored for the scoring football team when tight is %s', (tight) => {
        const fixture = { ...game, awayTeamId: 'colts', scored: 'away' as const };
        const render = (overrides: Partial<Game> = {}) =>
            renderToStaticMarkup(
                createElement(GameCard, {
                    game: { ...fixture, ...overrides },
                    view: 'live',
                    tight,
                    favoriteTeamIds: ['colts'],
                })
            );
        const html = render();
        expect(html).toMatch(/scored-label">Scored<\/span><span class="favorite-result favorite-winning"/);
        expect(render({ scored: undefined })).not.toContain('scored-label');
        expect(render({ status: 'final' })).not.toContain('scored-label');
        expect(render({ sport: 'Basketball' })).not.toContain('scored-label');
    });

    it.each(['away', 'home'] as const)(
        'places Compact Scored beneath the %s team and possession before its name',
        (side) => {
            const fixture = { ...game, scored: side, possession: side };
            const render = (overrides: Partial<Game> = {}) =>
                renderToStaticMarkup(
                    createElement(GameCard, {
                        game: { ...fixture, ...overrides },
                        view: 'live',
                        scoreboardTheme: 'midnight',
                    })
                );
            const html = render();
            const name = side === 'away' ? game.away : game.home;
            const score = side === 'away' ? game.awayScore : game.homeScore;
            expect(html).toContain(
                `<span class="compact-team-name-group"><span class="possession-dot" aria-hidden="true"></span><span class="compact-team-name">${name}</span>`
            );
            expect(html).toContain(
                `<strong><span class="score-value">${score}</span></strong><span class="scored-label">Scored</span>`
            );
            expect(html.match(/scored-label/g)).toHaveLength(1);
            expect(render({ scored: undefined })).not.toContain('scored-label');
            expect(render({ status: 'final' })).not.toContain('possession-dot');
            expect(render({ status: 'final' })).not.toContain('scored-label');
            expect(render({ sport: 'Basketball' })).not.toContain('scored-label');
            const tight = renderToStaticMarkup(
                createElement(GameCard, { game: fixture, view: 'live', tight: true, scoreboardTheme: 'midnight' })
            );
            expect(tight).toContain('<span class="score-value"><span class="scored-label">Scored</span>');
        }
    );

    it('marks nationally televised NBA games', () => {
        const render = (overrides: Partial<Game>) =>
            renderToStaticMarkup(
                createElement(GameCard, { game: { ...game, ...overrides }, view: 'live', tight: true })
            );
        expect(render({ league: 'NBA', sport: 'Basketball', national: 'ESPN' })).toContain(
            'class="national-badge" role="img" tabindex="0" aria-label="National broadcast: ESPN"'
        );
        expect(render({ league: 'NBA', sport: 'Basketball' })).not.toContain('national-badge');
        expect(render({ league: 'NFL', national: 'ESPN' })).not.toContain('national-badge');
    });

    it('shows the outcome dot in Tight and retains the card star in other formats', () => {
        const props = { game, view: 'live' as const, favorite: true, favoriteTeamIds: ['colts'] };
        const fixture = { ...props, game: { ...game, awayTeamId: 'colts' } };
        const tight = renderToStaticMarkup(createElement(GameCard, { ...fixture, tight: true }));
        const standard = renderToStaticMarkup(createElement(GameCard, fixture));
        expect(tight).toContain('<span class="favorite-result favorite-winning" aria-hidden="true"></span>');
        expect(tight).not.toContain('aria-label="Favorite"');
        expect(standard).toContain('aria-label="Favorite"');
    });

    it('shows possession, period, down and red-zone position without network text', () => {
        const html = renderToStaticMarkup(createElement(GameCard, { game, view: 'live', tight: true }));
        expect(html).toContain('3Q 8:42');
        expect(html).toContain('2nd &amp; 6');
        expect(html).toContain('Red zone, SEA 12');
        expect(html).toContain('Has possession');
        expect(html).not.toContain('ESPN');
        expect(html).not.toContain('LIVE');
        expect(html.match(/class="tight-team"/g)).toHaveLength(2);
        expect(html.match(/class="tight-meta"/g)).toHaveLength(1);
    });

    it.each([false, true])('puts a possession dot after the live team name (tight: %s)', (tight) => {
        for (const [possession, name] of [
            ['away', 'Colts'],
            ['home', 'Seahawks'],
        ] as const) {
            const html = renderToStaticMarkup(
                createElement(GameCard, { game: { ...game, possession }, view: 'live', tight })
            );
            expect(html.match(/team-has-possession/g)).toHaveLength(1);
            expect(html).toContain(
                `${name}</span><span class="possession-dot" aria-hidden="true"></span><span class="sr-only"> Has possession</span>`
            );
            expect(html).not.toContain('possession-ball');
        }
    });

    it('does not show a possession dot once the game is final', () => {
        const html = renderToStaticMarkup(
            createElement(GameCard, { game: { ...game, status: 'final' }, view: 'live', tight: true })
        );
        expect(html).not.toContain('Has possession');
    });

    it('does not invent a position when the feed omits it', () => {
        const html = renderToStaticMarkup(
            createElement(GameCard, {
                game: { ...game, statusLabel: '1st Half 04:32', situation: '1st & Goal' },
                view: 'live',
                tight: true,
            })
        );
        expect(html).toContain('1H 4:32');
        expect(html).toContain('field position unavailable');
        expect(html).not.toContain('SEA 12');
    });

    it.each([true, false])('highlights only the field position when tight is %s', (tight) => {
        const render = (overrides: Partial<Game>) =>
            renderToStaticMarkup(createElement(GameCard, { game: { ...game, ...overrides }, view: 'live', tight }));
        const redZone = render({});
        expect(redZone).toContain('class="field-position red-zone" aria-label="Red zone, SEA 12">SEA 12</span>');
        expect(redZone).not.toContain('>Red zone</span>');
        const missing = render({ situation: '1st & Goal' });
        expect(missing).toContain('aria-label="Red zone, field position unavailable">RZ</span>');
        expect(missing).toContain('1st &amp; Goal');
        const normal = render({ redZone: false });
        expect(normal).not.toContain('class="red-zone"');
        expect(normal).toContain('class="field-position">SEA 12</span>');
    });

    it.each([true, false])('hides the red-zone label while Scored is visible when tight is %s', (tight) => {
        const render = (overrides: Partial<Game>) =>
            renderToStaticMarkup(
                createElement(GameCard, {
                    game: { ...game, situation: undefined, ...overrides },
                    view: 'live',
                    tight,
                })
            );
        const scored = render({ scored: 'away' });
        expect(scored).toContain('scored-label');
        expect(scored).not.toContain('field position unavailable');
        expect(scored).not.toContain('class="situation"');
        expect(render({ scored: 'away', situation: '1st & Goal' })).toContain('1st &amp; Goal');
        expect(render({ scored: 'away', situation: '1st & Goal' })).not.toContain('field position unavailable');
        expect(render({ scored: 'away', situation: '2nd & 6 at SEA 12' })).toContain('Red zone, SEA 12');
        expect(render({})).toContain('field position unavailable');
    });

    it('uses halves for college basketball and preserves baseball innings', () => {
        const basketball = renderToStaticMarkup(
            createElement(GameCard, {
                game: { ...game, sport: "Men's Basketball", league: 'Big Ten', statusLabel: '1st 08:32' },
                view: 'live',
                tight: true,
            })
        );
        const baseball = renderToStaticMarkup(
            createElement(GameCard, {
                game: { ...game, sport: 'Baseball', league: 'MLB', statusLabel: '1st' },
                view: 'live',
                tight: true,
            })
        );
        expect(basketball).toContain('1H 8:32');
        expect(baseball).toContain('1st');
        expect(baseball).not.toContain('1Q');
    });

    it('shows the date of a final without a known start time', () => {
        const html = renderToStaticMarkup(
            createElement(GameCard, {
                game: { ...game, status: 'final', statusLabel: 'Final', startTime: null },
                view: 'recent',
                showDate: true,
                tight: true,
            })
        );
        expect(html).toContain('Final · 11/15');
    });

    it('uses the same Today final badge as the other formats', () => {
        const final = { ...game, status: 'final' as const, statusLabel: 'Final' };
        const today = renderToStaticMarkup(createElement(GameCard, { game: final, view: 'live', tight: true }));
        const recent = renderToStaticMarkup(createElement(GameCard, { game: final, view: 'recent', tight: true }));
        expect(today).toContain('<span class="final-label">Final</span>');
        expect(recent).not.toContain('final-label');
    });

    it.each([true, false])('marks each favorite team outcome when tight is %s', (tight) => {
        const fixture = { ...game, awayTeamId: 'colts', homeTeamId: 'seahawks' };
        const render = (overrides: Partial<Game>, favoriteTeamIds = ['colts', 'seahawks']) =>
            renderToStaticMarkup(
                createElement(GameCard, { game: { ...fixture, ...overrides }, view: 'live', tight, favoriteTeamIds })
            );
        const live = render({});
        expect(live).toContain('favorite-result favorite-winning');
        expect(live).toContain('favorite-result favorite-losing');
        expect(live).toContain('Colts winning');
        expect(live).toContain('Seahawks losing');
        const final = render({ status: 'final' });
        expect(final).toContain('Colts won');
        expect(final).toContain('Seahawks lost');
        expect(render({}, ['seahawks'])).not.toContain('Colts winning');
        expect(render({ awayScore: 14 })).not.toContain('favorite-result');
        expect(render({ homeScore: null })).not.toContain('favorite-result');
        expect(render({ status: 'upcoming' })).not.toContain('favorite-result');
        expect(render({ homeTeamId: undefined, awayTeamId: undefined })).not.toContain('favorite-result');
    });
});
