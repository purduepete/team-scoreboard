import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GameCard } from '../src/GameCard';
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

    it.each(['away', 'home'] as const)('places football possession before the %s team name', (possession) => {
        const html = renderToStaticMarkup(
            createElement(GameCard, { game: { ...game, possession }, view: 'live', tight: true })
        );
        const rows = html.split('<div class="tight-team">').slice(1);
        const withBall = rows[possession === 'away' ? 0 : 1];
        const withoutBall = rows[possession === 'away' ? 1 : 0];
        expect(withBall).toMatch(/class="possession-ball".*?<\/svg><span class="tight-name-text">/);
        expect(withoutBall).not.toContain('Has possession');
    });

    it('keeps non-football possession after the team name', () => {
        const html = renderToStaticMarkup(
            createElement(GameCard, { game: { ...game, sport: 'Baseball' }, view: 'live', tight: true })
        );
        expect(html).toContain(
            '<span class="tight-name-text">Colts</span><span class="possession" role="img" aria-label="Has possession">'
        );
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
