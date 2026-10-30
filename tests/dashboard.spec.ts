import { test, expect } from '@playwright/test';
import { teams, defaultFavorites, expandFavorites } from '../server/catalog';
import type { Dashboard, Feed, Game, SearchTeam } from '../shared/contracts';

const game: Game = {
    id: 'fixture-1',
    teamIds: ['134927', 'nfl-26'],
    sport: 'Football',
    league: 'NFL',
    title: 'Fixture Seahawks at Colts',
    home: 'Indianapolis Colts',
    away: 'Seattle Seahawks',
    homeScore: null,
    awayScore: null,
    startTime: '2026-10-25T20:00:00Z',
    date: '2026-10-25',
    week: 8,
    status: 'upcoming',
    statusLabel: 'Scheduled',
    sourceUrl: 'https://www.espn.com/nfl/game/_/gameId/1',
};
// Earlier the same day, so it sorts first unless favorites lead.
const otherGame: Game = {
    ...game,
    id: 'fixture-2',
    teamIds: ['nfl-1', 'nfl-2'],
    title: 'Fixture Falcons at Bills',
    home: 'Buffalo Bills',
    away: 'Atlanta Falcons',
    startTime: '2026-10-25T17:00:00Z',
    sourceUrl: 'https://www.espn.com/nfl/game/_/gameId/2',
};
const liveGame: Game = {
    ...game,
    id: 'fixture-live',
    title: 'Fixture Bulls at Pacers',
    teamIds: ['134873', 'nba-4'],
    sport: 'Basketball',
    league: 'NBA',
    home: 'Indiana Pacers',
    away: 'Chicago Bulls',
    homeScore: 54,
    awayScore: 50,
    homeRecord: '2-0',
    awayRecord: '1-1',
    broadcast: 'ESPN',
    week: undefined,
    status: 'live',
    statusLabel: 'Q3 4:12',
};

const leagueFeed = (league: string, days: string, games: Game[], error: string | null = null): Feed => ({
    id: `league-${league.toLowerCase()}-${days}d`,
    label: `${league} scoreboard`,
    note: `Every ${league} game.`,
    officialUrl: `https://www.espn.com/${league.toLowerCase()}/scoreboard`,
    available: true,
    games,
    updatedAt: '2026-10-22T23:00:00Z',
    stale: Boolean(error),
    error,
    pending: false,
});

let requestedDays: string[] = [];
let refreshBodies: unknown[] = [];
let fullLoads: string[] = [];
let liveHome = 54;
let liveExtra: Partial<Game> = {};
let extraGames: Game[] = [];
let calendarUrl: string | null = null;
const searchedTeam: SearchTeam = {
    id: 'adhoc-college-football-333',
    name: 'Alabama Crimson Tide',
    sport: 'Football',
    league: 'College football',
    category: 'college-football',
    providerId: 'football/college-football/333',
    officialUrl: 'https://www.espn.com/college-football/team/_/id/333',
    coverage: 'schedule-results',
    coverageNote: 'Fixture team.',
};
const secondSearchedTeam: SearchTeam = {
    ...searchedTeam,
    id: 'adhoc-college-football-8',
    name: 'Arkansas Razorbacks',
    providerId: 'football/college-football/8',
};
let addedGames: Game[] = [];
let addedPending = false;
let addedError: string | null = null;
let searchFailure = false;
let addedRequests = 0;

const expandSections = async (page: import('@playwright/test').Page) => {
    const collapsed = page.locator('.section-title button[aria-expanded="false"]:visible');
    while ((await collapsed.count()) > 0) await collapsed.first().click();
};

test.beforeEach(async ({ page }) => {
    let favorites = [...defaultFavorites];
    requestedDays = [];
    refreshBodies = [];
    fullLoads = [];
    liveHome = 54;
    liveExtra = {};
    extraGames = [];
    calendarUrl = null;
    addedGames = [];
    addedPending = false;
    addedError = null;
    searchFailure = false;
    addedRequests = 0;
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === '/api/team-search') {
            await route.fulfill(
                searchFailure
                    ? { status: 503, json: { error: 'Fixture directory unavailable.' } }
                    : {
                          json: { teams: [searchedTeam], stale: false, error: null },
                      }
            );
        } else if (url.pathname === '/api/added-teams') {
            addedRequests++;
            await route.fulfill({
                json: {
                    team: url.searchParams.get('id') === '8' ? secondSearchedTeam : searchedTeam,
                    feed: { ...leagueFeed('College football', '', addedGames, addedError), pending: addedPending },
                },
            });
        } else if (url.pathname === '/api/calendar') {
            await route.fulfill(calendarUrl ? { json: { url: calendarUrl } } : { status: 404, json: {} });
        } else if (url.pathname === '/api/dashboard') {
            const days = url.searchParams.get('days') ?? '';
            requestedDays.push(days);
            if (url.searchParams.get('refresh') === 'all') fullLoads.push(days);
            const body: Dashboard = {
                favorites,
                teams,
                liveAvailable: true,
                notice: 'Fixture data from ESPN-shaped feeds.',
                feeds: [
                    leagueFeed(
                        'NFL',
                        days,
                        [otherGame, game, ...extraGames.filter((entry) => entry.league === 'NFL')],
                        'Fixture upstream failure'
                    ),
                    leagueFeed('NBA', days, [
                        { ...liveGame, homeScore: liveHome, ...liveExtra },
                        ...extraGames.filter((entry) => entry.league === 'NBA'),
                    ]),
                    leagueFeed('MLB', days, []),
                    ...expandFavorites(favorites)
                        .filter((entry) => entry.purdue)
                        .map((entry): Feed => ({
                            id: entry.id,
                            label: entry.name,
                            note: entry.coverageNote,
                            officialUrl: entry.officialUrl,
                            available: Boolean(entry.providerId),
                            purdue: true,
                            games: extraGames.filter(
                                (game) => game.league === 'NCAA' && game.teamIds.includes(entry.id)
                            ),
                            updatedAt: entry.providerId ? '2026-10-22T23:00:00Z' : null,
                            stale: false,
                            error: null,
                            pending: false,
                        })),
                ],
            };
            await route.fulfill({ json: body });
        } else if (url.pathname === '/api/refresh') {
            refreshBodies.push(request.postDataJSON());
            await route.fulfill({ status: 204 });
        } else {
            if (request.method() === 'POST') favorites = [...new Set([...favorites, request.postDataJSON().teamId])];
            if (request.method() === 'DELETE')
                favorites = favorites.filter((id) => id !== request.url().split('/').pop());
            await route.fulfill({ status: 204 });
        }
    });
});
test('initial loading spinner waits 250ms and follows themes and reduced motion', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 30, 12) });
    await page.clock.pauseAt(new Date(2026, 9, 30, 12, 0, 1));
    let release!: () => void;
    const response = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route('**/api/dashboard*', async (route) => {
        await response;
        await route.fallback();
    });
    await page.goto('/');
    await expect(page.locator('.page-loading')).toBeVisible();
    const spinner = page.getByRole('status').filter({ hasText: 'Loading saved favorites' });
    await page.clock.runFor(249);
    await expect(spinner).toHaveCount(0);
    await page.clock.runFor(1);
    await expect(spinner).toBeVisible();
    await expect(spinner).toHaveText('Loading saved favorites');
    await expect(spinner.locator('.sr-only')).toHaveCSS('width', '1px');
    for (const theme of ['light', 'midnight']) {
        await page.evaluate((theme) => {
            document.documentElement.classList.toggle('theme-midnight', theme === 'midnight');
        }, theme);
        const styles = await spinner.locator('.loading-spinner').evaluate((element) => {
            const style = getComputedStyle(element);
            return {
                width: style.width,
                height: style.height,
                track: style.borderRightColor,
                arc: style.borderTopColor,
                animation: style.animationDuration,
            };
        });
        expect(styles).toEqual({
            width: '40px',
            height: '40px',
            track: theme === 'light' ? 'rgb(203, 213, 225)' : 'rgb(51, 65, 85)',
            arc: theme === 'light' ? 'rgb(47, 71, 123)' : 'rgb(107, 140, 174)',
            animation: '1s',
        });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(spinner).toHaveCSS('animation-name', 'none');
    await expect(spinner.locator('.loading-spinner')).toHaveCSS('animation-name', 'none');
    release();
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(spinner).toHaveCount(0);
    await expect(page.locator('.score-results')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.score-results')).toHaveCSS('opacity', '1');
});

test('loading fades progress smoothly without fading navigation or replaying results', async ({ page }) => {
    let release!: () => void;
    const response = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route('**/api/dashboard*', async (route) => {
        await response;
        await route.fallback();
    });
    await page.goto('/');
    const spinner = page.getByRole('status').filter({ hasText: 'Loading saved favorites' });
    await expect(spinner).toBeVisible();
    const measureFade = async (selector: string) =>
        page.locator(selector).evaluate((element) => {
            const animation = element
                .getAnimations()
                .find((entry) => entry instanceof CSSAnimation && entry.animationName === 'loading-enter')!;
            animation.pause();
            const samples = [0, 300, 600].map((time) => {
                animation.currentTime = time;
                return Number(getComputedStyle(element).opacity);
            });
            animation.currentTime = 100;
            return {
                samples,
                duration: animation.effect!.getTiming().duration,
                easing: getComputedStyle(element).animationTimingFunction,
            };
        });
    const spinnerFade = await measureFade('.loading-entrance');
    expect(spinnerFade.duration).toBe(600);
    expect(spinnerFade.easing).toBe('ease-out');
    expect(spinnerFade.samples[0]).toBe(0);
    expect(spinnerFade.samples[1]).toBeGreaterThan(0);
    expect(spinnerFade.samples[1]).toBeLessThan(1);
    expect(spinnerFade.samples[2]).toBe(1);
    release();
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(spinner).toHaveCount(0);
    const resultsFade = await measureFade('.score-results');
    expect(resultsFade).toEqual(spinnerFade);
    const toolbar = await page.locator('.toolbar').elementHandle();
    const results = await page.locator('.score-results').elementHandle();
    await expect(page.locator('.toolbar')).toHaveCSS('opacity', '1');
    expect(
        await page.locator('.toolbar').evaluate((element) => {
            for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
                if (getComputedStyle(ancestor).animationName.includes('loading-enter')) return true;
            }
            return false;
        })
    ).toBe(false);
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await page.getByRole('button', { name: 'Recent', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    expect(await toolbar!.evaluate((element) => element === document.querySelector('.toolbar'))).toBe(true);
    expect(await results!.evaluate((element) => element === document.querySelector('.score-results'))).toBe(true);
    expect(await results!.evaluate((element) => element.getAnimations()[0].currentTime)).toBe(100);
    await page.evaluate(() => {
        location.hash = '#status';
    });
    await expect(page.getByRole('heading', { name: 'Source status' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to scores', exact: true }).click();
    await expect(page.locator('.score-results')).toBeVisible();
    await expect(page.locator('.score-results')).not.toHaveAttribute('data-initial-enter');
});

test('cached results dim during startup refetch without spinning the header', async ({ page }) => {
    let release!: () => void;
    const response = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route('**/api/dashboard*', async (route) => {
        if (new URL(route.request().url()).searchParams.get('refresh') === 'all') await response;
        await route.fallback();
    });
    await page.goto('/');
    const results = page.locator('.score-results');
    await expect(results).toBeVisible();
    await expect(results).toHaveAttribute('aria-busy', 'true');
    await expect(results).toHaveCSS('opacity', '0.65');
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Refreshing', exact: true })).toHaveCount(0);
    await expect(page.locator('.loading-entrance')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(results).toHaveCSS('animation-name', 'none');
    await expect(results).toHaveCSS('transition-duration', '0s');
    release();
    await expect(results).toHaveAttribute('aria-busy', 'false');
    await expect(results).toHaveCSS('opacity', '1');
    await expect(page.getByRole('alert')).toHaveCount(0);
});

test('failed startup refetch clears dimming and preserves cached scores', async ({ page }) => {
    let release!: () => void;
    const response = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route('**/api/dashboard*', async (route) => {
        if (new URL(route.request().url()).searchParams.get('refresh') === 'all') {
            await response;
            await route.fulfill({ status: 503, json: {} });
        } else {
            await route.fallback();
        }
    });
    await page.goto('/');
    const results = page.locator('.score-results');
    await expect(results).toHaveAttribute('aria-busy', 'true');
    release();
    await expect(results).toHaveAttribute('aria-busy', 'false');
    await expect(results).toHaveCSS('opacity', '1');
    await expect(page.getByRole('region', { name: 'NBA', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
});

test('startup completion does not stop a manual refresh indicator', async ({ page }) => {
    let finishStartup!: () => void;
    let finishManual!: () => void;
    const startup = new Promise<void>((resolve) => {
        finishStartup = resolve;
    });
    const manual = new Promise<void>((resolve) => {
        finishManual = resolve;
    });
    await page.route('**/api/dashboard*', async (route) => {
        if (new URL(route.request().url()).searchParams.get('refresh') === 'all') await startup;
        await route.fallback();
    });
    await page.route('**/api/refresh', async (route) => {
        await manual;
        await route.fallback();
    });
    await page.goto('/');
    await expect(page.locator('.score-results')).toHaveAttribute('aria-busy', 'true');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    const busy = page.getByRole('button', { name: 'Refreshing', exact: true });
    await expect(busy).toBeDisabled();
    finishStartup();
    await expect(page.locator('.score-results')).toHaveAttribute('aria-busy', 'false');
    await expect(busy).toBeDisabled();
    finishManual();
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
});

test('fast initial loads never display a spinner', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 30, 12) });
    await page.clock.pauseAt(new Date(2026, 9, 30, 12, 0, 1));
    await page.goto('/');
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(page.locator('.loading-spinner')).toHaveCount(0);
    await page.clock.runFor(300);
    await expect(page.locator('.loading-spinner')).toHaveCount(0);
});

test('failed initial loads remove the spinner and retain the error and retry', async ({ page }) => {
    await page.route('**/api/dashboard*', (route) => route.fulfill({ status: 503, json: {} }));
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('The server could not access saved favorites');
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(page.locator('.page-loading')).toHaveCount(0);
    await page.unroute('**/api/dashboard*');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.locator('.score-results')).toBeVisible();
    await expect(page.locator('.score-results')).toHaveCSS('animation-name', 'loading-enter');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.loading-entrance')).toHaveCount(0);
});

test('long card metadata keeps favorites and status on one row', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 9, 25, 12));
    liveExtra = { sport: "Women's Volleyball", week: 10, status: 'final', statusLabel: 'Final' };
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'NBA', exact: true })).toBeVisible();
    await expandSections(page);
    for (const width of [390, 768, 1024, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        for (const compact of [false, true]) {
            if (compact) await page.getByRole('button', { name: 'Compact mode', exact: true }).click();
            const card = page.locator('.game:visible').filter({ hasText: 'Indiana Pacers' }).first();
            await expect(card.locator('.game-description-text')).toHaveText("NBA · Women's Volleyball · Week 10");
            await expect(card.getByLabel('Favorite', { exact: true })).toBeVisible();
            const layout = await card.locator('.game-meta').evaluate((meta) => {
                const description = meta.querySelector('.game-description')!.getBoundingClientRect();
                const status = meta.lastElementChild!.getBoundingClientRect();
                return {
                    sameRow: Math.abs(description.top + description.height / 2 - status.top - status.height / 2) < 1,
                    separate: description.right <= status.left,
                    inside: status.right <= meta.getBoundingClientRect().right + 1,
                };
            });
            expect(layout).toEqual({ sameRow: true, separate: true, inside: true });
            if (compact) await page.getByRole('button', { name: 'Exit compact mode', exact: true }).click();
        }
    }
});

test('scores stay close to the header on tablet and desktop without attribution', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 9, 25, 12));
    await page.goto('/');
    await expect(page.locator('footer .refresh-time')).toBeVisible();
    for (const theme of ['light', 'midnight']) {
        await page.evaluate((theme) => {
            localStorage.setItem('team-scoreboard-theme', theme);
        }, theme);
        await page.reload();
        await expect(page.locator('.toolbar')).toBeVisible();
        for (const width of [768, 1024, 1280, 1440, 1920]) {
            await page.setViewportSize({ width, height: 900 });
            for (const compact of [false, true]) {
                if (compact) await page.getByRole('button', { name: 'Compact mode', exact: true }).click();
                const layout = await page
                    .locator('.scores-page > .panel')
                    .first()
                    .evaluate((panel) => ({
                        gap:
                            panel.getBoundingClientRect().top -
                            document.querySelector('header')!.getBoundingClientRect().bottom,
                        overflow: document.documentElement.scrollWidth > innerWidth,
                    }));
                expect(layout).toEqual({ gap: 12, overflow: false });
                await expect(page.getByText('Coverage and game times may change.', { exact: false })).toHaveCount(0);
                await expect(page.locator('footer .refresh-time')).toBeVisible();
                if (compact) await page.getByRole('button', { name: 'Exit compact mode', exact: true }).click();
            }
        }
    }
});

test('themes, system tracking, keyboard dropdowns and mobile width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/theme-midnight/);
    await expect(page.locator('select, datalist')).toHaveCount(0);
    const theme = page.getByRole('button', { name: 'Appearance', exact: true });
    const pill = page.getByRole('radiogroup', { name: 'Theme' });
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    const search = page.getByRole('button', { name: 'Find team', exact: true });
    await expect(search).toHaveCSS('border-top-width', '1px');
    await expect(search).toHaveCSS('border-top-style', 'solid');
    await expect(theme).toHaveCSS('border-top-width', '0px');
    await theme.focus();
    await theme.press('Enter');
    await expect(pill.getByRole('radio')).toHaveText(['Light', 'Midnight', 'System']);
    await expect(pill.getByRole('radio', { name: 'Midnight' })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(pill.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveClass('light');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ffffff');
    await page.keyboard.press('Escape');
    await expect(pill).toHaveCount(0);
    await expect(theme).toBeFocused();
    await page.reload();
    await expect(page.locator('html')).toHaveClass('light');
    await theme.click();
    await pill.getByRole('radio', { name: 'System' }).click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/theme-midnight/);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveClass('light');
    const popover = await page.getByRole('dialog', { name: 'Appearance settings' }).boundingBox();
    expect(popover!.x).toBeGreaterThanOrEqual(0);
    expect(popover!.x + popover!.width).toBeLessThanOrEqual(390);
    await page.mouse.click(8, 300);
    await expect(pill).toHaveCount(0);
    const centers = await page.locator('header :is(.refresh-time, .icon-button)').evaluateAll((items) =>
        items.map((item) => {
            const box = item.getBoundingClientRect();
            return Math.round(box.top + box.height / 2);
        })
    );
    expect(new Set(centers).size).toBe(1);
    await expect(page.locator('header').getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
    await expect(page.locator('[title]')).toHaveCount(0);
    await expandSections(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('header')).toHaveCSS('position', 'sticky');
    await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveCount(0);
    const icon = await page.request.get('/apple-touch-icon.png');
    expect(icon.status()).toBe(200);
    expect((await icon.body()).readUInt32BE(16)).toBe(180);
    expect((await icon.body()).readUInt32BE(20)).toBe(180);
    await page.screenshot({ path: 'test-results/scoreboard-light-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('link', { name: 'Source status' }).click();
    await expect(page.getByRole('heading', { name: 'Source status', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to scores', exact: true })).toHaveCount(1);
    await expect(page.locator('main').getByRole('link', { name: 'Back to scores', exact: true })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Back to scores', exact: true })).toHaveCSS(
        'border-top-style',
        'solid'
    );
    await expect(page.getByRole('link', { name: 'Back to scores', exact: true })).toHaveCSS('border-top-width', '1px');
    await expect(page.locator('header').getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const theme of ['light', 'midnight']) {
    test(`phone layout fills the schedule row and collapses tools (${theme})`, async ({ page }) => {
        calendarUrl = 'https://example.com/calendar.ics';
        await page.addInitScript((value) => localStorage.setItem('team-scoreboard-theme', value), theme);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');
        await expect(page.getByText('Game day, at a glance')).toHaveCount(0);
        const schedule = page.getByRole('group', { name: 'Schedule view' });
        await expect(schedule).toBeVisible();
        const gap = await page
            .locator('.scores-page > .panel')
            .first()
            .evaluate(
                (panel) =>
                    panel.getBoundingClientRect().top - document.querySelector('header')!.getBoundingClientRect().bottom
            );
        expect(gap).toBe(12);
        const widths = await schedule.evaluate((element) => ({
            pill: element.getBoundingClientRect().width,
            row: element.parentElement!.getBoundingClientRect().width,
        }));
        expect(Math.abs(widths.pill - widths.row)).toBeLessThan(1);
        const buttons = await schedule
            .getByRole('button')
            .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
        expect(Math.max(...buttons) - Math.min(...buttons)).toBeLessThan(1);
        const tools = page.getByRole('button', { name: 'Tools', exact: true });
        const finder = page.getByRole('button', { name: 'Find team', exact: true });
        await expect(finder).toBeHidden();
        await expect(page.getByRole('button', { name: 'Edit favorites' })).toBeHidden();
        await tools.click();
        await expect(finder).toBeVisible();
        await expect(finder).toHaveCSS('border-top-width', '1px');
        for (const width of [375, 390, 430]) {
            await page.setViewportSize({ width, height: 844 });
            const panel = page.locator('#score-tools-actions');
            const layout = await panel.evaluate((element) => {
                const bounds = element.getBoundingClientRect();
                const buttons = Array.from(element.querySelectorAll('button, a')).map((button) =>
                    button.getBoundingClientRect()
                );
                return {
                    tops: buttons.map((button) => button.top),
                    fits: buttons.every((button) => button.left >= bounds.left && button.right <= bounds.right),
                    fills:
                        Math.abs(buttons[0].left - bounds.left - 9) < 1 &&
                        Math.abs(bounds.right - buttons[1].right - 9) < 1,
                    rows:
                        buttons[0].top === buttons[1].top &&
                        buttons[2].top === buttons[3].top &&
                        buttons[2].top > buttons[0].top,
                    viewportFits: bounds.left >= 0 && bounds.right <= innerWidth,
                    columnRatio: buttons[1].width / buttons[0].width,
                    matchingWidths:
                        Math.abs(buttons[0].width - buttons[2].width) < 1 &&
                        Math.abs(buttons[1].width - buttons[3].width) < 1,
                };
            });
            expect(new Set(layout.tops).size).toBe(2);
            expect(layout.rows).toBe(true);
            expect(layout.fits).toBe(true);
            expect(layout.fills).toBe(true);
            expect(layout.viewportFits).toBe(true);
            expect(layout.columnRatio).toBeCloseTo(2, 1);
            expect(layout.matchingWidths).toBe(true);
        }
        await expect(page.locator('#score-tools-actions').locator('button, a')).toHaveCount(4);
        await expect(page.locator('#score-tools-actions').locator('button, a').nth(2)).toHaveAttribute(
            'aria-label',
            'Source status'
        );
        await expect(page.locator('#score-tools-actions').locator('button, a').nth(3)).toHaveText('Calendar');
        const source = page.getByRole('link', { name: 'Source status', exact: true });
        await expect(source).toHaveText('');
        await expect(source.locator('svg')).toBeVisible();
        await page.setViewportSize({ width: 390, height: 844 });
        await finder.click();
        await expect(page.getByRole('dialog', { name: 'Find team', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(finder).toBeFocused();
        await page.getByRole('button', { name: 'Calendar', exact: true }).click();
        await expect(page.getByRole('menu', { name: 'Calendar' })).toBeVisible();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Edit favorites' }).click();
        await expect(page.getByRole('region', { name: 'Edit favorite teams' })).toBeVisible();
        await tools.focus();
        await page.keyboard.press('Escape');
        await expect(finder).toBeHidden();
        await expect(tools).toBeFocused();
        await page.getByRole('button', { name: 'Appearance', exact: true }).click();
        const pill = page.getByRole('radiogroup', { name: 'Theme' });
        await expect(pill).toHaveCSS('height', '36px');
        await expect(pill.getByRole('radio')).toHaveText(['Light', 'Midnight', 'System']);
        await expect(pill.getByRole('radio', { name: 'Midnight' }).locator('.lucide-moon')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `test-results/phone-layout-${theme}.png`, fullPage: true });
        await page.setViewportSize({ width: 1280, height: 900 });
        await expect(tools).toBeVisible();
        await expect(finder).toBeHidden();
        const toolBox = await tools.boundingBox();
        const filterBox = await page.getByRole('button', { name: 'Show', exact: true }).boundingBox();
        expect(filterBox!.x - (toolBox!.x + toolBox!.width)).toBe(8);
        await tools.click();
        await expect(finder).toBeVisible();
        await expect(page.getByRole('button', { name: 'Edit favorites' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toBeVisible();
    });
}

test('refresh uses a centered circular loader and respects reduced motion', async ({ page }) => {
    await page.goto('/');
    const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
    await expect(refresh).toBeEnabled();
    await expect(refresh.locator('.lucide-refresh-cw')).toBeVisible();
    let finishRefresh!: () => void;
    const pending = new Promise<void>((resolve) => {
        finishRefresh = resolve;
    });
    await page.route('**/api/refresh', async (route) => {
        await pending;
        await route.fallback();
    });
    try {
        await refresh.click();
        const busy = page.getByRole('button', { name: 'Refreshing', exact: true });
        await expect(busy).toBeDisabled();
        const loader = busy.locator('.lucide-loader-circle');
        await expect(loader).toBeVisible();
        const samples = await loader.evaluate((svg) => {
            const button = svg.closest('button')!.getBoundingClientRect();
            const animation = svg.getAnimations()[0];
            animation.pause();
            const centers = [0, 125, 250, 375, 500, 625, 750, 875].map((time) => {
                animation.currentTime = time;
                const box = svg.getBoundingClientRect();
                return {
                    x: box.x + box.width / 2 - (button.x + button.width / 2),
                    y: box.y + box.height / 2 - (button.y + button.height / 2),
                };
            });
            animation.play();
            return centers;
        });
        for (const center of samples) {
            expect(Math.abs(center.x)).toBeLessThan(0.01);
            expect(Math.abs(center.y)).toBeLessThan(0.01);
        }
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await expect(loader).toHaveCSS('animation-name', 'none');
        await expect(page.getByRole('button', { name: 'Compact mode', exact: true })).toBeVisible();
    } finally {
        finishRefresh();
    }
    await expect(refresh).toBeEnabled();
    await expect(refresh.locator('.lucide-refresh-cw')).toBeVisible();
});

test('header controls use accessible custom tooltips', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
    await expect(refresh).toHaveAttribute('aria-describedby', /\S+/);
    await refresh.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toHaveText('Refresh live scores (R)');
    const bounds = await tooltip.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    await refresh.focus();
    await expect(tooltip).toBeVisible();
});

test('custom tooltips stay closed on touch-capable devices', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    try {
        await page.goto('/');
        expect(await page.evaluate(() => window.matchMedia('(any-pointer: coarse)').matches)).toBe(true);
        const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
        const tooltip = page.locator('.custom-tooltip').filter({ hasText: 'Refresh live scores (R)' });
        await refresh.tap();
        await expect(tooltip).toBeHidden();
        await refresh.focus();
        await expect(tooltip).toBeHidden();
    } finally {
        await context.close();
    }
});

test('favorite edits survive reload, live scores and source errors are visible', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 9, 22, 12));
    await page.goto('/');
    await expect(page.getByRole('group', { name: 'Schedule view' })).toBeVisible();
    const tabs = page.getByRole('group', { name: 'Schedule view' }).getByRole('button');
    await expect(tabs).toHaveText(['Current', 'Upcoming', 'Recent']);
    await expect(page.getByRole('button', { name: 'Current', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const nba = page.locator('.section-title button', { hasText: 'NBA' });
    await expect(nba).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Q3 4:12')).toBeHidden();
    await nba.click();
    await expect(nba).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Q3 4:12')).toBeVisible();
    const liveCard = page.locator('.game', { hasText: 'Indiana Pacers' });
    await expect(liveCard.locator('.record')).toHaveText([' (1-1)', ' (2-0)']);
    await expect(liveCard.locator('.broadcast')).toHaveText('ESPN');
    await nba.click();
    await expect(page.getByText('Q3 4:12')).toBeHidden();
    await nba.click();
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await expect(page.getByText('Fixture upstream failure')).toHaveCount(0);
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('link', { name: 'Source status' }).click();
    await expect(page).toHaveURL(/#status$/);
    await expect(page.getByRole('heading', { name: 'Source status', exact: true })).toBeVisible();
    await expect(page.getByText('Fixture upstream failure')).toBeVisible();
    await expect(page.getByRole('heading', { name: "Purdue · Women's Volleyball", exact: true })).toBeVisible();
    await expect(page.getByText('Stale data', { exact: true })).toBeVisible();
    await expect(page.getByText('Official link only', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.game')).toHaveCount(0);
    await page.getByRole('link', { name: 'Back to scores' }).first().click();
    await page.getByRole('button', { name: 'Current', exact: true }).click();
    await expect(page.getByText('Q3 4:12')).toBeVisible();
    await expect(page.locator('.game')).toHaveCount(1);
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('button', { name: 'Edit favorites' }).click();
    await page.getByLabel('Find a team or sport').fill('Arizona Cardinals');
    await page.getByRole('button', { name: 'Add Arizona Cardinals' }).click();
    await expect(page.getByRole('button', { name: 'Remove Arizona Cardinals' })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('button', { name: 'Edit favorites' }).click();
    await page.getByLabel('Find a team or sport').fill('Arizona Cardinals');
    await page.getByRole('button', { name: 'Remove Arizona Cardinals' }).click();
    await expect(page.getByRole('button', { name: 'Add Arizona Cardinals' })).toBeVisible();
    await page.getByRole('button', { name: 'Close favorites editor' }).click();
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await page.screenshot({ path: 'test-results/scoreboard-midnight-desktop.png', fullPage: false });
});

for (const theme of ['light', 'midnight']) {
    test(`active-only respects teams and restores the schedule view (${theme})`, async ({ page }) => {
        await page.clock.setFixedTime(new Date(2026, 9, 25, 12));
        await page.setViewportSize({ width: 390, height: 844 });
        await page.addInitScript((theme) => localStorage.setItem('team-scoreboard-theme', theme), theme);
        await page.goto('/');
        await expect(page.locator('header .refresh-time')).toHaveCount(0);
        await expect(page.locator('footer .refresh-time')).toContainText('Last refresh');
        await expect(page.locator('footer .refresh-time svg')).toBeVisible();
        await page.setViewportSize({ width: 1280, height: 900 });
        const footerLayout = await page.locator('footer').evaluate((footer) => {
            const refresh = footer.querySelector('.refresh-time')!.getBoundingClientRect();
            return {
                right: Math.abs(refresh.right - footer.getBoundingClientRect().right) < 1,
            };
        });
        expect(footerLayout).toEqual({ right: true });
        await expect(page.locator('.data-note')).toHaveCount(0);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
        const show = page.getByRole('button', { name: 'Show', exact: true });
        await show.click();
        await page.getByRole('option', { name: 'NFL', exact: true }).click();
        await page.keyboard.press('Escape');
        const active = page.getByRole('button', { name: 'Active games only', exact: true });
        await active.click();
        await expect(active).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', { name: 'Current', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        await expect(page.getByRole('button', { name: 'Upcoming', exact: true })).toBeDisabled();
        await expect(page.getByRole('status').filter({ hasText: 'No active games' })).toBeVisible();
        await expect(page.locator('.game')).toHaveCount(0);
        await show.click();
        await page.getByRole('option', { name: 'NBA', exact: true }).click();
        await page.keyboard.press('Escape');
        await expect(show).toHaveText('2 selected');
        await expect(page.locator('.game:visible')).toHaveCount(1);
        await expect(page.locator('.game:visible')).toContainText('Indiana Pacers');
        await page.getByRole('button', { name: 'Compact mode', exact: true }).click();
        await expect(page.locator('.compact-games .game')).toHaveCount(1);
        await active.click();
        await expect(page.locator('.compact-games .game')).toHaveCount(2);
        await page.getByRole('button', { name: 'Exit compact mode', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Upcoming', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        await expect(show).toHaveText('2 selected');
        await active.click();
        await page.reload();
        await expect(active).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', { name: 'Upcoming', exact: true })).toBeDisabled();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });

    test(`compact mode keeps filters, sorts cards and restores controls (${theme})`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.clock.setFixedTime(new Date(2026, 9, 25, 12));
        await page.addInitScript((theme) => localStorage.setItem('team-scoreboard-theme', theme), theme);
        extraGames = [
            {
                ...otherGame,
                id: 'nba-other',
                league: 'NBA',
                title: 'Other NBA',
                home: 'Boston Celtics',
                away: 'New York Knicks',
                teamIds: ['nba-other'],
                startTime: '2026-10-25T16:00:00Z',
            },
            {
                ...otherGame,
                id: 'nfl-late',
                title: 'Later NFL',
                home: 'Dallas Cowboys',
                away: 'Detroit Lions',
                teamIds: ['nfl-other'],
                startTime: '2026-10-25T23:00:00Z',
            },
            {
                ...game,
                id: 'favorite-completed',
                home: 'Favorite completed',
                status: 'final',
                statusLabel: 'Final',
                startTime: '2026-10-25T15:00:00Z',
            },
            {
                ...otherGame,
                id: 'nfl-active',
                home: 'Active NFL',
                status: 'live',
                statusLabel: 'In progress',
                startTime: '2026-10-25T23:00:00Z',
            },
            {
                ...otherGame,
                id: 'nba-completed',
                league: 'NBA',
                home: 'Complete NBA',
                status: 'final',
                statusLabel: 'Final',
                startTime: '2026-10-25T15:00:00Z',
            },
        ];
        await page.goto('/');
        const show = page.getByRole('button', { name: 'Show', exact: true });
        await show.click();
        await page.getByRole('option', { name: 'NFL', exact: true }).click();
        await page.getByRole('option', { name: 'NBA', exact: true }).click();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
        const compact = page.getByRole('button', { name: 'Compact mode', exact: true });
        await compact.click();
        const cards = page.locator('.compact-games .game');
        await expect(cards).toHaveCount(8);
        for (const [index, home] of [
            'Indiana Pacers',
            'Indianapolis Colts',
            'Favorite completed',
            'Active NFL',
            'Buffalo Bills',
            'Dallas Cowboys',
            'Boston Celtics',
            'Complete NBA',
        ].entries()) {
            await expect(cards.nth(index)).toContainText(home);
        }
        await expect(page.locator('.toolbar')).toBeHidden();
        await expect(page.locator('.section-title, .group-heading')).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Source status' })).toBeHidden();
        await page.keyboard.press('a');
        await page.keyboard.press('3');
        await expect(cards).toHaveCount(8);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.getByRole('button', { name: 'Exit compact mode', exact: true }).click();
        await expect(show).toHaveText('2 selected');
        await expect(page.getByRole('button', { name: 'Current', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        await expect(page.locator('.section-title button[aria-expanded="true"]')).toHaveCount(0);
        await page.getByRole('button', { name: 'Tools', exact: true }).click();
        await page.getByRole('link', { name: 'Source status' }).click();
        await expect(page.getByRole('heading', { name: 'Source status', exact: true })).toBeVisible();
        await page.getByRole('link', { name: 'Back to scores' }).click();
        await compact.click();
        await page.reload();
        await expect(page.getByRole('button', { name: 'Exit compact mode', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        await expect(page.locator('.toolbar')).toBeHidden();
    });

    test(`Show supports multiple teams and leagues with exclusive All teams (${theme})`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.clock.setFixedTime(new Date(2026, 9, 25, 12));
        await page.addInitScript((theme) => localStorage.setItem('team-scoreboard-theme', theme), theme);
        await page.goto('/');
        const show = page.getByRole('button', { name: 'Show', exact: true });
        const list = page.getByRole('listbox', { name: 'Show', exact: true });
        const option = (name: string) => list.getByRole('option', { name, exact: true });
        await show.click();
        await expect(list).toHaveAttribute('aria-multiselectable', 'true');
        await expect(option('All teams')).toHaveAttribute('aria-selected', 'true');
        await option('Indianapolis Colts').click();
        await option('NBA').click();
        await expect(show).toHaveText('2 selected');
        await expect(option('All teams')).toHaveAttribute('aria-selected', 'false');
        await expect(list.locator('[aria-selected="true"]')).toHaveText(['NBA', 'Indianapolis Colts']);
        await expect(page.locator('.game:visible')).toHaveCount(2);
        await expect(page.locator('.game:visible').filter({ hasText: 'Atlanta Falcons' })).toHaveCount(0);
        await option('NFL').click();
        await expect(page.locator('.game:visible')).toHaveCount(3);
        await option('All teams').click();
        await expect(list).toHaveCount(0);
        await expect(show).toBeFocused();
        await expect(show).toHaveText('All teams');
        await show.click();
        await expect(list.locator('[aria-selected="true"]')).toHaveText(['All teams']);
        await expect(list.locator('[role="option"] svg')).toHaveCount(1);
        await show.press('Home');
        await show.press('Enter');
        await expect(list).toHaveCount(0);
        await expect(show).toBeFocused();
        await show.click();
        await option('NFL').click();
        await expect(page.locator('.game:visible')).toHaveCount(2);
        await option('NFL').click();
        await expect(list.locator('[aria-selected="true"]')).toHaveText(['All teams']);
        await page.keyboard.press('Escape');
        await expect(show).toBeFocused();
        await show.press('Enter');
        await show.press('ArrowDown');
        await show.press('Space');
        await expect(option('Favorites')).toHaveAttribute('aria-selected', 'true');
        await show.press('ArrowDown');
        await show.press('Enter');
        await expect(list.locator('[aria-selected="true"]')).toHaveText(['Favorites', 'NFL']);
        await show.press('Tab');
        await expect(list).toHaveCount(0);
        await show.click();
        await page.getByRole('button', { name: 'Current', exact: true }).click();
        await expect(list).toHaveCount(0);
        await show.click();
        await expect(list.locator('[aria-selected="true"]')).toHaveText(['Favorites', 'NFL']);
        await page.keyboard.press('Escape');
        await page.keyboard.press('a');
        await expect(show).toHaveText('All teams');
        await expect(page.locator('select, datalist')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}

test('favorites lead each day, Show sits on the tab row and refresh posts the fixed 14-day window', async ({
    page,
}) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await expandSections(page);
    const cards = page.locator('.game');
    await expect(cards.first()).toContainText('Indianapolis Colts');
    await expect(cards.first()).toHaveClass(/favorite/);
    await expect(cards.first()).toContainText('NFL · Football · Week 8');
    await expect(cards.nth(1)).not.toHaveClass(/favorite/);
    await expect(page.locator('.group-heading').first()).toContainText('2 games');
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await page.getByRole('option', { name: 'Favorites', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).not.toHaveClass(/favorite/);
    await expect(page.locator('.section-title button[aria-expanded="false"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await page.getByRole('option', { name: 'Favorites', exact: true }).click();
    await page.getByRole('option', { name: 'Indianapolis Colts', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toBeVisible();
    await expect(cards.first()).not.toHaveClass(/favorite/);
    await page.locator('.section-title button', { hasText: 'NFL' }).click();
    await expect(cards.first()).toBeHidden();
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await page.getByRole('option', { name: 'Indianapolis Colts', exact: true }).click();
    await page.getByRole('option', { name: 'NFL', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(cards.first()).toBeVisible();
    await expect(cards.first()).toHaveClass(/favorite/);
    await expect(page.getByRole('button', { name: 'Group by', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await page.getByRole('option', { name: 'All teams', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.section-title button[aria-expanded="true"]')).toHaveCount(0);
    const expandAll = page.getByRole('button', { name: 'Expand all', exact: true });
    const collapseAll = page.getByRole('button', { name: 'Collapse all', exact: true });
    await expect(collapseAll).toBeDisabled();
    await expandAll.click();
    await expect(page.locator('.section-title button[aria-expanded="false"]')).toHaveCount(0);
    await expect(expandAll).toBeDisabled();
    await collapseAll.click();
    await expect(page.locator('.section-title button[aria-expanded="true"]')).toHaveCount(0);
    const titles = await page.locator('.section-title span').allTextContents();
    expect(titles.indexOf('Purdue')).toBeLessThan(titles.indexOf('NFL'));
    await expect(page.getByRole('button', { name: 'Results', exact: true })).toHaveCount(0);
    const tabRow = await page.locator('.tabs').boundingBox();
    const show = await page.getByRole('button', { name: 'Show', exact: true }).boundingBox();
    const tools = await page.getByRole('button', { name: 'Tools', exact: true }).boundingBox();
    expect(show!.x - (tools!.x + tools!.width)).toBe(8);
    expect(Math.abs((show?.y ?? 0) - (tabRow?.y ?? 99))).toBeLessThan(4);
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => refreshBodies).toEqual([{ days: 14, scope: 'live' }]);
    expect(fullLoads).toEqual(['14']);
    expect(new Set(requestedDays)).toEqual(new Set(['14']));
});

test('team finder works while empty Custom is hidden, with dismissal and focus return', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    const trigger = page.getByRole('button', { name: 'Find team', exact: true });
    await expect(trigger).toHaveText('');
    const favorites = await page.getByRole('button', { name: 'Edit favorites', exact: true }).boundingBox();
    const finder = await trigger.boundingBox();
    expect(finder!.x + finder!.width).toBeLessThanOrEqual(favorites!.x);
    await trigger.click();
    const modal = page.getByRole('dialog', { name: 'Find team', exact: true });
    await expect(modal).toBeVisible();
    await expect(page.getByLabel('Search teams', { exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Close team search', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByLabel('Search teams', { exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.mouse.click(2, 2);
    await expect(modal).toHaveCount(0);
    const custom = page.locator('.added-teams');
    await expect(custom).toBeHidden();
    await page.keyboard.press('x');
    await expect(custom).toBeHidden();
    await page.keyboard.press('x');
    await expect(custom).toBeHidden();
});

test('added teams distinguish no game, pending and errors and expire at local midnight', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 25, 23, 59, 30) });
    await page.addInitScript(() =>
        localStorage.setItem(
            'team-scoreboard-added-teams-v1',
            JSON.stringify({
                date: '2026-10-25',
                teams: [{ category: 'college-football', id: '333' }],
            })
        )
    );
    await page.goto('/');
    const added = page.getByRole('region', { name: 'Custom', exact: true });
    await added.locator('.section-title button').click();
    await expect(added).toContainText('No game today.');
    const statusCard = added.locator('.custom-status-card');
    const statusBounds = await statusCard.boundingBox();
    await expect(statusCard.locator('.reorder-card')).toHaveCount(0);
    expect(statusBounds).not.toBeNull();
    addedPending = true;
    await page.clock.runFor(20_000);
    await expect(added.getByRole('status')).toContainText('Loading scores');
    await expect(added).not.toContainText('No game today.');
    addedPending = false;
    addedError = 'Fixture scores unavailable.';
    await page.clock.runFor(5000);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(added.getByRole('alert')).toContainText('Fixture scores unavailable.');
    await expect(added).not.toContainText('No game today.');
    await page.clock.runFor(6000);
    await expect(added).toBeHidden();
    await expect(added.locator('.custom-status-card')).toHaveCount(0);
    expect(
        await page.evaluate(() => JSON.parse(localStorage.getItem('team-scoreboard-added-teams-v1')!).teams)
    ).toEqual([]);
});

test('active-only filters Custom games in grouped and compact mode', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 25, 12) });
    addedGames = [
        {
            ...game,
            id: 'custom-scheduled',
            teamIds: [searchedTeam.id],
            home: 'Scheduled Custom',
            league: 'College football',
        },
        {
            ...game,
            id: 'custom-live',
            teamIds: [searchedTeam.id],
            home: 'Active Custom',
            league: 'College football',
            status: 'live',
            statusLabel: 'Live fixture',
        },
        {
            ...game,
            id: 'custom-final',
            teamIds: [searchedTeam.id],
            home: 'Finished Custom',
            league: 'College football',
            status: 'final',
        },
    ];
    await page.addInitScript(() => {
        localStorage.setItem('team-scoreboard-active-only', 'true');
        localStorage.setItem(
            'team-scoreboard-added-teams-v1',
            JSON.stringify({ date: '2026-10-25', teams: [{ category: 'college-football', id: '333' }] })
        );
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Expand all', exact: true }).click();
    await expect(page.locator('.added-teams .game')).toHaveCount(1);
    await expect(page.locator('.added-teams .game')).toContainText('Active Custom');
    await page.getByRole('button', { name: 'Compact mode', exact: true }).click();
    await expect(page.locator('.compact-games .game')).toHaveCount(2);
    await expect(page.locator('.compact-games')).not.toContainText('Scheduled Custom');
    await expect(page.locator('.compact-games')).not.toContainText('Finished Custom');
    await page.getByRole('button', { name: 'Active games only', exact: true }).click();
    await expect(page.locator('.compact-games .game')).toHaveCount(6);
});

test('compact mode merges Custom games once and keeps Custom failures visible', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 25, 12) });
    addedGames = [
        { ...game, teamIds: [searchedTeam.id], league: 'College football' },
        { ...game, id: 'custom-only', teamIds: [searchedTeam.id], home: searchedTeam.name, league: 'College football' },
    ];
    await page.addInitScript(() => {
        localStorage.setItem('team-scoreboard-compact', 'true');
        localStorage.setItem(
            'team-scoreboard-added-teams-v1',
            JSON.stringify({
                date: '2026-10-25',
                teams: [{ category: 'college-football', id: '333' }],
            })
        );
    });
    await page.goto('/');
    const grid = page.locator('.compact-games');
    await expect(grid.locator('.game')).toHaveCount(4);
    await expect(grid.locator('.game').filter({ hasText: 'Indianapolis Colts' })).toHaveCount(1);
    await expect(grid).toContainText(searchedTeam.name);
    await expect(page.locator('.section-title')).toHaveCount(0);
    await expect(grid.locator('.reorder-card, .remove-team')).toHaveCount(0);
    addedError = 'Fixture custom feed failed.';
    await page.clock.runFor(20_000);
    await expect(grid.getByRole('alert')).toHaveText('Fixture custom feed failed.');
    await expect(grid.locator('.score-lines')).toHaveCount(4);
    await page.getByRole('button', { name: 'Exit compact mode', exact: true }).click();
    await page.keyboard.press('f');
    await page.getByRole('button', { name: 'Compact mode', exact: true }).click();
    await expect(grid).not.toContainText(searchedTeam.name);
    await expect(grid.getByRole('alert')).toHaveCount(0);
    await expect(grid.locator('.game')).toHaveCount(2);
});

test('two added college teams sharing a game show one card and keep both removal controls', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 25, 9) });
    addedGames = [
        {
            ...game,
            id: 'shared-college-game',
            league: 'College football',
            teamIds: [searchedTeam.id, secondSearchedTeam.id],
            home: searchedTeam.name,
            away: secondSearchedTeam.name,
        },
    ];
    await page.addInitScript(() =>
        localStorage.setItem(
            'team-scoreboard-added-teams-v1',
            JSON.stringify({
                date: '2026-10-25',
                teams: [
                    { category: 'college-football', id: '333' },
                    { category: 'college-football', id: '8' },
                ],
            })
        )
    );
    await page.goto('/');
    const added = page.getByRole('region', { name: 'Custom', exact: true });
    await added.locator('.section-title button').click();
    await expect(added.locator('.game')).toHaveCount(1);
    await expect(added.getByRole('button', { name: 'Remove Alabama Crimson Tide', exact: true })).toBeVisible();
    await added.getByRole('button', { name: 'Remove Arkansas Razorbacks', exact: true }).click();
    await expect(added.locator('.game')).toHaveCount(1);
    await expect(
        added.locator('.game').getByRole('button', { name: 'Remove Alabama Crimson Tide', exact: true })
    ).toBeVisible();
});

test('Custom cards share the league grid, with removal left of the time and no extra labels', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 25, 9) });
    addedGames = [
        {
            ...game,
            id: 'custom-1',
            league: 'College football',
            teamIds: [searchedTeam.id],
            home: searchedTeam.name,
            status: 'live',
            situation: '1st & 10 at TEX 25',
        },
        {
            ...game,
            id: 'custom-2',
            league: 'College football',
            teamIds: [secondSearchedTeam.id],
            home: secondSearchedTeam.name,
        },
    ];
    await page.addInitScript(() =>
        localStorage.setItem(
            'team-scoreboard-added-teams-v1',
            JSON.stringify({
                date: '2026-10-25',
                teams: [
                    { category: 'college-football', id: '333' },
                    { category: 'college-football', id: '8' },
                ],
            })
        )
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    const custom = page.getByRole('region', { name: 'Custom', exact: true });
    await custom.locator('.section-title button').click();
    const cards = custom.locator('.custom-games > .game');
    await expect(cards).toHaveCount(2);
    const first = await cards.first().boundingBox();
    const second = await cards.nth(1).boundingBox();
    expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
    expect(second!.x).toBeGreaterThan(first!.x);
    const firstDivider = await cards.first().locator('.game-footer').boundingBox();
    const secondDivider = await cards.nth(1).locator('.game-footer').boundingBox();
    expect(Math.abs(firstDivider!.y - secondDivider!.y)).toBeLessThan(1);
    const remove = cards.first().getByRole('button', { name: 'Remove Alabama Crimson Tide', exact: true });
    const removeBox = await remove.boundingBox();
    await expect(remove).toHaveCSS('border-top-width', '0px');
    await expect(remove).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(remove.locator('svg')).toHaveAttribute('width', '14');
    expect(removeBox!.width).toBeGreaterThanOrEqual(36);
    const time = await cards.first().locator('time').boundingBox();
    expect(removeBox!.x + removeBox!.width).toBeLessThanOrEqual(time!.x);
    expect(Math.abs(removeBox!.y + removeBox!.height / 2 - time!.y - time!.height / 2)).toBeLessThan(2);
    await expect(custom).not.toContainText('Pinned for today');
    await expect(custom.locator('.muted')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('custom cards can be reordered with controls or drag and the order persists', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 25, 9) });
    addedGames = [
        {
            ...game,
            id: 'custom-late',
            teamIds: [searchedTeam.id],
            home: searchedTeam.name,
            startTime: '2026-10-25T22:00:00Z',
        },
        {
            ...game,
            id: 'custom-early',
            teamIds: [secondSearchedTeam.id],
            home: secondSearchedTeam.name,
            startTime: '2026-10-25T18:00:00Z',
        },
    ];
    await page.addInitScript(() => {
        const key = 'team-scoreboard-added-teams-v1';
        if (!localStorage.getItem(key))
            localStorage.setItem(
                key,
                JSON.stringify({
                    date: '2026-10-25',
                    teams: [
                        { category: 'college-football', id: '333' },
                        { category: 'college-football', id: '8' },
                    ],
                })
            );
    });
    await page.goto('/');
    const custom = page.getByRole('region', { name: 'Custom', exact: true });
    await custom.locator('.section-title button').click();
    const cards = custom.locator('.custom-games > .game');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText(secondSearchedTeam.name);
    await cards
        .nth(1)
        .getByRole('button', { name: `Move ${searchedTeam.name} earlier` })
        .click();
    await expect(cards.first()).toContainText(searchedTeam.name);
    const firstCard = cards.first();
    const cardBounds = await firstCard.boundingBox();
    const sourceBounds = await firstCard.locator('.game-footer > a').boundingBox();
    const reorderBounds = await firstCard.locator('.custom-order-actions').boundingBox();
    expect(reorderBounds!.x).toBeGreaterThan(sourceBounds!.x + sourceBounds!.width);
    expect(cardBounds!.x + cardBounds!.width - reorderBounds!.x - reorderBounds!.width).toBeLessThan(24);
    await expect
        .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('team-scoreboard-added-teams-v1')!).order))
        .toEqual(['game:Football:custom-late', 'game:Football:custom-early']);
    await page.reload();
    await custom.locator('.section-title button').click();
    await expect(cards.first()).toContainText(searchedTeam.name);
    await cards.nth(1).dragTo(cards.first(), { targetPosition: { x: 10, y: 1 } });
    await expect(cards.first()).toContainText(secondSearchedTeam.name);
    await expect
        .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('team-scoreboard-added-teams-v1')!).order))
        .toEqual(['game:Football:custom-early', 'game:Football:custom-late']);
});

test('long channel lists truncate without wrapping the card footer', async ({ page }) => {
    liveExtra = { broadcast: 'NBA League Pass, DAZN (YES), DAZN CLE, Another regional channel' };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('region', { name: 'NBA', exact: true }).locator('.section-title button').click();
    const card = page.getByRole('region', { name: 'NBA', exact: true }).locator('.game').first();
    await expect(card).toBeVisible();
    const channel = card.locator('.broadcast-name');
    await expect(channel).toHaveCSS('text-overflow', 'ellipsis');
    expect(await channel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    const info = card.getByRole('button', { name: 'Full channel list' });
    await info.hover();
    await expect(page.getByRole('tooltip')).toHaveText(liveExtra.broadcast!);
    await expect(page.getByRole('tooltip')).toHaveCSS('font-size', '12px');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toBeHidden();
    await info.focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tooltip')).toBeHidden();
    await info.click();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.locator('main').click({ position: { x: 2, y: 2 } });
    await expect(page.getByRole('tooltip')).toBeHidden();
    const time = await card.locator('time').boundingBox();
    const source = await card.getByRole('link', { name: 'Source' }).boundingBox();
    expect(Math.abs(time!.y - source!.y)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('Custom refresh keeps scores visible without an extra loading card', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 25, 9) });
    addedGames = [
        {
            ...game,
            id: 'custom-live-refresh',
            homeRecord: '4-2',
            awayRecord: '5-1',
            possession: 'home',
            redZone: true,
            situation: '1st & Goal',
            teamIds: [searchedTeam.id],
            home: searchedTeam.name,
            status: 'live',
            homeScore: 23,
            awayScore: 3,
        },
    ];
    await page.addInitScript(() =>
        localStorage.setItem(
            'team-scoreboard-added-teams-v1',
            JSON.stringify({
                date: '2026-10-25',
                teams: [{ category: 'college-football', id: '333' }],
            })
        )
    );
    addedPending = true;
    addedError = 'Fixture refresh failure';
    await page.goto('/');
    const custom = page.getByRole('region', { name: 'Custom', exact: true });
    await custom.locator('.section-title button').click();
    await expect(custom.getByRole('alert')).toContainText('Fixture refresh failure');
    addedError = null;
    await page.clock.runFor(20_000);
    await expect(custom.locator('.custom-status-card')).toHaveCount(0);
    await expect(custom.locator('.score-lines')).toContainText('23');
    await expect(custom.locator('.record')).toHaveText([' (5-1)', ' (4-2)']);
    await expect(custom.getByRole('img', { name: 'Has possession' })).toBeVisible();
    await expect(custom.locator('.red-zone')).toHaveText('Red zone');
    await expect(custom.locator('.situation')).toContainText('1st & Goal');
    await expect(custom.locator('.score-lines')).toContainText('3');
    await expect(custom.locator('.game')).toHaveCount(1);
    addedGames = [];
    addedError = 'Fixture refresh failure';
    await page.clock.runFor(20_000);
    await expect(custom.getByRole('alert')).toContainText('Fixture refresh failure');
    await expect(custom).not.toContainText('Showing previously fetched scores.');
});

test('team search errors are visible and a removed pending team cannot reappear', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 25, 9) });
    await page.goto('/');
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('button', { name: 'Find team', exact: true }).click();
    searchFailure = true;
    await page.getByLabel('Search teams', { exact: true }).fill('Alabama');
    await page.clock.runFor(350);
    await expect(page.getByRole('alert')).toContainText('Fixture directory unavailable.');
    await expect(page.getByText('No teams found.', { exact: true })).toHaveCount(0);
    searchFailure = false;
    await page.getByLabel('Search teams', { exact: true }).fill('Alabam');
    await page.clock.runFor(350);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route('**/api/added-teams?**', async (route) => {
        await gate;
        await route.fulfill({ json: { team: searchedTeam, feed: leagueFeed('College football', '', []) } });
    });
    await page.getByRole('button', { name: 'Add Alabama Crimson Tide', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Find team', exact: true })).toHaveCount(0);
    const added = page.getByRole('region', { name: 'Custom', exact: true });
    await expect(added).toContainText('Loading team');
    await added.getByRole('button', { name: /Remove/ }).click();
    release!();
    await expect(added.locator('.custom-status-card')).toHaveCount(0);
    await page.clock.runFor(20_000);
    await expect(added.locator('.custom-status-card')).toHaveCount(0);
});

test('an empty Custom response reports a readable error and recovers on the next poll', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 25, 9) });
    addedGames = [{ ...game, teamIds: [searchedTeam.id], home: searchedTeam.name }];
    await page.addInitScript(() =>
        localStorage.setItem(
            'team-scoreboard-added-teams-v1',
            JSON.stringify({
                date: '2026-10-25',
                teams: [{ category: 'college-football', id: '333' }],
            })
        )
    );
    let emptyResponse = true;
    await page.route('**/api/added-teams?**', async (route) => {
        if (emptyResponse) await route.fulfill({ status: 502, body: '' });
        else await route.fallback();
    });
    await page.goto('/');
    const custom = page.getByRole('region', { name: 'Custom', exact: true });
    await custom.locator('.section-title button').click();
    await expect(custom.getByRole('alert')).toHaveText('Team data is temporarily unavailable (502). Retrying shortly.');
    await expect(custom).not.toContainText('JSON');
    await expect(custom).not.toContainText('Loading scores');
    emptyResponse = false;
    await page.clock.runFor(20_000);
    await expect(custom.locator('.score-lines')).toContainText(searchedTeam.name);
    await expect(custom.getByRole('alert')).toHaveCount(0);
});

for (const theme of ['midnight', 'light']) {
    test(`ad hoc team search shows Custom only for All teams (${theme})`, async ({ page }) => {
        await page.clock.install({ time: new Date(2026, 9, 25, 9) });
        addedGames = [
            {
                ...game,
                id: 'added-game',
                league: 'College football',
                teamIds: [searchedTeam.id],
                home: 'Alabama Crimson Tide',
            },
        ];
        await page.addInitScript((value) => localStorage.setItem('team-scoreboard-theme', value), theme);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');
        await page.getByRole('button', { name: 'Tools', exact: true }).click();
        await page.getByRole('button', { name: 'Find team', exact: true }).click();
        await expect(page.getByLabel('Search teams', { exact: true })).toBeFocused();
        const sports = page.getByRole('group', { name: 'Sport', exact: true });
        const football = sports.getByRole('button', { name: 'College football', exact: true });
        const basketball = sports.getByRole('button', { name: 'College basketball', exact: true });
        await expect(football).toHaveAttribute('aria-pressed', 'true');
        await basketball.click();
        await expect(basketball).toHaveAttribute('aria-pressed', 'true');
        await expect(football).toHaveAttribute('aria-pressed', 'false');
        await expect(basketball.locator('svg')).toBeVisible();
        await expect(sports).toHaveCSS('border-radius', '0px');
        await football.click();
        await page.getByLabel('Search teams', { exact: true }).fill('Alabama');
        await page.clock.runFor(350);
        await page.getByRole('button', { name: 'Add Alabama Crimson Tide', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Find team', exact: true })).toHaveCount(0);
        await page.getByRole('button', { name: 'Find team', exact: true }).click();
        await expect(page.getByLabel('Search teams', { exact: true })).toHaveValue('');
        await expect(page.locator('.team-search-results li')).toHaveCount(0);
        await page.keyboard.press('Escape');
        const added = page.getByRole('region', { name: 'Custom', exact: true });
        await expect(added.locator('.section-title')).toContainText('Custom');
        expect(await added.evaluate((element) => element === element.parentElement?.lastElementChild)).toBe(true);
        await expect(added.locator('.game')).toHaveCount(1);
        await expect(added.locator('.game')).toContainText('Alabama Crimson Tide');
        await expect(
            added.locator('.game').getByRole('button', { name: 'Remove Alabama Crimson Tide', exact: true })
        ).toBeVisible();
        await page.keyboard.press('f');
        await expect(added).toBeHidden();
        await page.keyboard.press('a');
        await expect(added).toBeVisible();
        await added.locator('.section-title button').click();
        await expect(added.locator('.game')).toHaveCount(1);
        await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
        await expect(added).toBeHidden();
        await page.getByRole('button', { name: 'Current', exact: true }).click();
        await expect(added).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        await page.reload();
        await added.locator('.section-title button').click();
        await expect(added.locator('.game')).toHaveCount(1);
        expect(addedRequests).toBeGreaterThan(1);
        await page.getByRole('button', { name: 'Remove Alabama Crimson Tide', exact: true }).click();
        await expect(added.locator('.game')).toHaveCount(0);
        await expect(added).toBeHidden();
        await expect(page.getByRole('button', { name: 'Show', exact: true })).toHaveText('All teams');
        expect(refreshBodies).toEqual([]);
    });

    test(`all favorites keep the normal card background (${theme})`, async ({ page }) => {
        const purdue = teams.find((team) => team.purdue && !team.umbrella && team.providerId)!;
        extraGames = [
            {
                ...game,
                id: 'fixture-purdue',
                teamIds: [purdue.id],
                league: 'NCAA',
                home: 'Purdue Boilermakers',
            },
        ];
        await page.addInitScript((value) => localStorage.setItem('team-scoreboard-theme', value), theme);
        await page.goto('/');
        await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
        await expandSections(page);
        const card = page.locator('#section-NCAA .game');
        await expect(card).toHaveClass('game favorite');
        await expect(card.getByLabel('Favorite', { exact: true })).toBeVisible();
        await expect(card.locator('.favorite-marker')).toHaveText('');
        await expect(card.getByLabel('Favorite', { exact: true })).toHaveAttribute('width', '16');
        await expect(card).toHaveCSS('background-color', theme === 'midnight' ? 'rgb(2, 6, 23)' : 'rgb(255, 255, 255)');
        await expect(card).toHaveCSS('border-left-width', '4px');
        const accent = theme === 'midnight' ? 'rgb(107, 140, 174)' : 'rgb(47, 71, 123)';
        await expect(card).toHaveCSS('border-top-color', accent);
        await expect(card).toHaveCSS('border-right-color', accent);
        await expect(card).toHaveCSS('border-bottom-color', accent);
        await expect(card.getByLabel('Favorite', { exact: true })).toHaveCSS('fill', accent);
        await expect(page.locator('#section-NFL .game.favorite')).toHaveCSS(
            'background-color',
            theme === 'midnight' ? 'rgb(2, 6, 23)' : 'rgb(255, 255, 255)'
        );
    });

    test(`section action pill sits right of Show at desktop and mobile widths (${theme})`, async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem('team-scoreboard-theme', value), theme);
        await page.goto('/');
        const pill = page.getByRole('group', { name: 'Section controls', exact: true });
        const expand = pill.getByRole('button', { name: 'Expand all', exact: true });
        const collapse = pill.getByRole('button', { name: 'Collapse all', exact: true });
        await expect(expand).toHaveText('');
        await expect(collapse).toHaveText('');
        await expect(expand.locator('svg')).toHaveCount(1);
        await expect(collapse.locator('svg')).toHaveCount(1);
        await expect(expand).toHaveAttribute('aria-keyshortcuts', 'X');
        await expect(collapse).toHaveAttribute('aria-keyshortcuts', 'X');
        await expect(pill).toHaveCSS('border-radius', '0px');
        const tabs = page.getByRole('group', { name: 'Schedule view', exact: true });
        await expect(tabs).toHaveCSS('border-radius', '0px');
        const highlight = theme === 'midnight' ? 'rgb(107, 140, 174)' : 'rgb(47, 71, 123)';
        const sliderColor = (el: Element) => getComputedStyle(el, '::before').backgroundColor;
        await expect(tabs.getByRole('button', { name: 'Current', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        await expect.poll(() => tabs.evaluate(sliderColor)).toBe(highlight);
        await expect(collapse).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => pill.evaluate(sliderColor)).toBe(highlight);
        await expect(page.locator('.toolbar').getByRole('group', { name: 'Section controls' })).toBeVisible();
        for (const width of [1280, 390]) {
            await page.setViewportSize({ width, height: 844 });
            const show = await page.getByRole('button', { name: 'Show', exact: true }).boundingBox();
            const controls = await pill.boundingBox();
            expect(show).not.toBeNull();
            expect(controls).not.toBeNull();
            expect(controls!.x).toBeGreaterThanOrEqual(show!.x + show!.width);
            expect(Math.abs(controls!.y - show!.y)).toBeLessThan(2);
            expect(Math.abs(controls!.height - show!.height)).toBeLessThan(2);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        }
        await expect(collapse).toBeDisabled();
        await expand.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('.section-title button[aria-expanded="false"]')).toHaveCount(0);
        await expect(expand).toBeDisabled();
        await expect(expand).toHaveAttribute('aria-pressed', 'true');
        await collapse.click();
        await expect(page.locator('.section-title button[aria-expanded="true"]')).toHaveCount(0);
        await page.screenshot({ path: `test-results/section-pill-${theme}-mobile.png`, fullPage: true });
    });

    test(`Current favorites lead and only Current finals have a distinct status badge (${theme})`, async ({ page }) => {
        await page.clock.install({ time: new Date(2026, 9, 25, 9) });
        await page.addInitScript((value) => localStorage.setItem('team-scoreboard-theme', value), theme);
        const fixture = (id: string, status: Game['status'], hour: number, favorite = false): Game => ({
            ...game,
            id,
            teamIds: favorite ? ['134927'] : ['nfl-1', 'nfl-2'],
            home: id,
            startTime: new Date(2026, 9, 25, hour).toISOString(),
            status,
            statusLabel: status === 'final' ? 'Final' : status === 'live' ? 'In progress' : 'Scheduled',
        });
        const fixtures = [
            fixture('scheduled', 'upcoming', 20),
            fixture('final-late', 'final', 12),
            fixture('live-late', 'live', 16),
            fixture('favorite-scheduled', 'upcoming', 22, true),
            fixture('final-early', 'final', 10),
            fixture('live-early', 'live', 14),
            fixture('favorite-final', 'final', 11, true),
        ];
        await page.route('**/api/dashboard?**', (route) =>
            route.fulfill({
                json: {
                    favorites: ['134927'],
                    teams,
                    liveAvailable: true,
                    notice: '',
                    feeds: [leagueFeed('NFL', '14', fixtures)],
                } satisfies Dashboard,
            })
        );
        await page.goto('/');
        const cards = page.locator('.game');
        await expect(cards).toHaveCount(7);
        await expandSections(page);
        await expect(cards.first()).toBeVisible();
        const expected = [
            'favorite-final',
            'favorite-scheduled',
            'live-early',
            'live-late',
            'final-early',
            'final-late',
            'scheduled',
        ];
        for (const [index, id] of expected.entries()) await expect(cards.nth(index)).toContainText(id);
        await expect(page.locator('.game.ended')).toHaveCount(0);
        await expect(page.locator('.game .final-label')).toHaveCount(3);
        await expect(page.locator('.game .final-label').first()).toHaveCSS('font-weight', '700');
        await expect(page.locator('.game .final-label').first()).toHaveCSS(
            'background-color',
            theme === 'midnight' ? 'rgb(107, 140, 174)' : 'rgb(47, 71, 123)'
        );
        for (const card of await cards.all()) {
            const background = await card.evaluate((element) => getComputedStyle(element).backgroundImage);
            expect(background).toBe('none');
        }
        await expect(page.locator('.game .final-label').first()).toContainText('Final');
        await page.screenshot({ path: `test-results/current-finals-${theme}.png`, fullPage: true });
        await page.getByRole('button', { name: 'Recent', exact: true }).click();
        await expect(cards).toHaveCount(3);
        await expect(page.locator('.game .final-label')).toHaveCount(0);
        await expect(page.locator('.game-meta').getByText('Final', { exact: true })).toHaveCount(3);
        await expect(cards.first()).toHaveCSS('background-image', 'none');
        await page.getByRole('button', { name: 'Current', exact: true }).click();
        await expect(page.locator('.game .final-label')).toHaveCount(3);
        await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
        await expect(cards).toHaveCount(2);
        await expect(cards.first()).toContainText('favorite-scheduled');
        await expect(page.locator('.game .final-label')).toHaveCount(0);
    });
}

test('keyboard shortcuts switch tabs, expand, collapse and refresh', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 26, 9) });
    liveExtra = { status: 'final', statusLabel: 'Final' };
    extraGames = [{ ...game, id: 'fixture-final', status: 'final', statusLabel: 'Final' }];
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    const pressed = (name: string) => page.getByRole('button', { name, exact: true });
    await page.keyboard.press('2');
    await expect(pressed('Upcoming')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Numpad3');
    await expect(pressed('Recent')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Numpad1');
    await expect(pressed('Current')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('3');
    const closed = page.locator('.section-title button[aria-expanded="false"]');
    const open = page.locator('.section-title button[aria-expanded="true"]');
    await page.keyboard.press('x');
    await expect(closed).toHaveCount(0);
    await page.keyboard.press('c');
    await expect(closed).toHaveCount(0);
    await page.keyboard.press('x');
    await expect(open).toHaveCount(0);
    await page.keyboard.press('Control+x');
    await expect(open).toHaveCount(0);
    await page.keyboard.press('x');
    await page.locator('.section-title button').first().click();
    await expect(open).not.toHaveCount(0);
    await expect(closed).not.toHaveCount(0);
    await page.keyboard.press('x');
    await expect(closed).toHaveCount(0);
    await page.keyboard.press('x');
    await expect(open).toHaveCount(0);
    await page.keyboard.press('r');
    await expect.poll(() => refreshBodies).toEqual([{ days: 14, scope: 'live' }]);

    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('button', { name: 'Edit favorites' }).click();
    await page.getByLabel('Find a team or sport').fill('x2');
    await expect(page.getByLabel('Find a team or sport')).toHaveValue('x2');
    await expect(closed).toHaveCount(await page.locator('.section-title button').count());
    await expect(pressed('Recent')).toHaveAttribute('aria-pressed', 'true');
    await expect(pressed('Upcoming')).toHaveAttribute('aria-describedby', /\S+/);
    await expect(pressed('Upcoming')).not.toHaveAttribute('title');
    await expect(pressed('Recent')).toHaveAttribute('aria-describedby', /\S+/);
    await expect(pressed('Recent')).not.toHaveAttribute('title');
    const upcomingTooltip = await pressed('Upcoming').getAttribute('aria-describedby');
    const recentTooltip = await pressed('Recent').getAttribute('aria-describedby');
    await expect(page.locator(`[id="${upcomingTooltip}"]`)).toHaveText('Upcoming (2)');
    await expect(page.locator(`[id="${recentTooltip}"]`)).toHaveText('Recent (3)');
});

test('letter shortcuts set the Show filter', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    const show = page.getByRole('button', { name: 'Show', exact: true });
    for (const [key, label] of [
        ['p', 'Purdue'],
        ['k', 'NBA'],
        ['f', 'NFL'],
        ['b', 'MLB'],
        ['a', 'All teams'],
    ]) {
        await page.keyboard.press(key);
        await expect(show).toHaveText(label);
    }
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText('Show Purdue');
    await page.keyboard.press('k');
    await expect(show).toHaveText('All teams');
});

test('? opens the shortcut help and Escape or a backdrop click closes it', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await page.keyboard.press('?');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    await expect(dialog).toContainText('Expand or collapse all sections');
    await expect(dialog.locator('kbd', { hasText: /^C$/ })).toHaveCount(0);
    await page.keyboard.press('2');
    await expect(page.getByRole('button', { name: 'Current', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('?');
    await expect(dialog).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('?');
    await page.keyboard.press('?');
    await expect(dialog).toHaveCount(0);
});

test('calendar menu appears only when the feed is configured', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit favorites' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Calendar' })).toHaveCount(0);

    calendarUrl = `https://team-scoreboard.jimlertech.com/calendar/${'t'.repeat(43)}.ics`;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.reload();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    const trigger = page.getByRole('button', { name: 'Calendar' });
    await expect(page.getByRole('link', { name: 'Subscribe' })).toHaveCount(0);
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Calendar' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Download', 'Copy link', 'Subscribe']);
    await expect(menu.getByRole('menuitem', { name: 'Download' })).toHaveAttribute('href', calendarUrl);
    await expect(menu.getByRole('menuitem', { name: 'Subscribe' })).toHaveAttribute(
        'href',
        calendarUrl.replace('https:', 'webcal:')
    );
    await expect(menu.getByRole('menuitem', { name: 'Download' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Copy link' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Calendar link copied' })).toHaveCount(1);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(calendarUrl);

    await trigger.click();
    await page.keyboard.press('3');
    await expect(page.getByRole('button', { name: 'Recent' })).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await trigger.click();
    await expect(menu).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('square controls slide their selection and honor reduced motion', async ({ page }) => {
    await page.goto('/');
    const tabs = page.getByRole('group', { name: 'Schedule view' });
    const sections = page.getByRole('group', { name: 'Section controls' });
    await expect(sections).toBeVisible();
    expect(await sections.evaluate((element) => getComputedStyle(element, '::before').transitionDuration)).toBe(
        '0.12s, 0.08s'
    );
    for (const group of [tabs, sections]) {
        await expect(group).toHaveCSS('border-radius', '0px');
        for (const button of await group.getByRole('button').all()) {
            await expect(button).toHaveCSS('border-radius', '0px');
        }
    }
    await page.keyboard.press('2');
    await expect(tabs).toHaveAttribute('data-active', '1');
    await expect(tabs.getByRole('button', { name: 'Upcoming' })).toHaveAttribute('aria-pressed', 'true');
    const indicator = () =>
        tabs.evaluate((element) => {
            const style = getComputedStyle(element, '::before');
            const selected = element.querySelector('[aria-pressed="true"]')!.getBoundingClientRect();
            const bounds = element.getBoundingClientRect();
            const offset = new DOMMatrixReadOnly(style.transform).m41;
            return {
                leftError: Math.abs(bounds.left + 1 + 3 + offset - selected.left),
                widthError: Math.abs(parseFloat(style.width) - selected.width),
                duration: style.transitionDuration,
            };
        });
    await expect.poll(async () => (await indicator()).leftError).toBeLessThan(1);
    expect((await indicator()).widthError).toBeLessThan(1);
    expect((await indicator()).duration).toContain('0.25s');
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
    await page.keyboard.press('3');
    await expect(tabs).toHaveAttribute('data-active', '2');
    expect((await indicator()).duration).toBe('0s');
    await expect.poll(async () => (await indicator()).leftError).toBeLessThan(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.keyboard.press('1');
    await page.keyboard.press('x');
    await expect(sections).toHaveAttribute('data-active', '0');
    await page.keyboard.press('x');
    await expect(sections).toHaveAttribute('data-active', '1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('missing football down and distance expires without another poll', async ({ page }) => {
    const now = new Date('2026-10-24T21:00:00-07:00');
    await page.clock.install({ time: now });
    await page.clock.pauseAt(now);
    extraGames = [
        {
            ...game,
            id: 'retained-football',
            status: 'live',
            statusLabel: 'Q2 2:00',
            homeScore: 14,
            awayScore: 10,
            situation: '2nd & 4 at IND 12',
            possession: 'away',
        },
    ];
    await page.goto('/');
    await expandSections(page);
    const card = page.locator('.game', { hasText: 'Indianapolis Colts' }).filter({ hasText: 'Q2 2:00' });
    await expect(card.locator('.situation')).toHaveText('2nd & 4 at IND 12');
    extraGames = [{ ...extraGames[0], situation: undefined }];
    await page.keyboard.press('r');
    await expect(card.locator('.situation')).toHaveText('2nd & 4 at IND 12 (last reported)');
    await page.clock.runFor(59_000);
    await expect(card.locator('.situation')).toHaveText('2nd & 4 at IND 12 (last reported)');
    // Stop polling to prove the expiry timer removes the value by itself.
    await page.route('**/api/dashboard**', (route) => route.abort());
    await page.clock.runFor(1_000);
    await expect(card.locator('.situation')).toHaveCount(0);
});

for (const change of ['clock', 'score', 'possession', 'final'] as const) {
    test(`retained down and distance clears on ${change}`, async ({ page }) => {
        extraGames = [
            {
                ...game,
                id: 'retained-football',
                status: 'live',
                statusLabel: 'Q2 2:00',
                homeScore: 14,
                awayScore: 10,
                situation: '2nd & 4 at IND 12',
                possession: 'away',
            },
        ];
        await page.goto('/');
        await expandSections(page);
        const card = page.locator('.game').filter({ hasText: 'Indianapolis Colts' }).filter({ hasText: '2nd & 4' });
        await expect(card.locator('.situation')).toHaveText('2nd & 4 at IND 12');
        extraGames = [{ ...extraGames[0], situation: undefined }];
        await page.keyboard.press('r');
        await expect(card.locator('.situation')).toContainText('last reported');
        extraGames = [
            {
                ...extraGames[0],
                ...(change === 'clock'
                    ? { statusLabel: 'Halftime' }
                    : change === 'score'
                      ? { homeScore: 17 }
                      : change === 'possession'
                        ? { possession: 'home' as const }
                        : { status: 'final' as const, statusLabel: 'Final' }),
            },
        ];
        await page.keyboard.press('r');
        await expect(page.locator('.situation')).toHaveCount(0);
    });
}

test('a changed score flashes once and the live situation shows', async ({ page }) => {
    liveExtra = { situation: '2 outs · 1st, 3rd · 3-1', possession: 'home' };
    await page.goto('/');
    const card = page.locator('.game', { hasText: 'Indiana Pacers' }).first();
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await expandSections(page);
    await expect(card).toContainText('2 outs · 1st, 3rd · 3-1');
    await expect(card.getByRole('img', { name: 'Has possession' })).toHaveCount(1);
    await expect(page.locator('.score-changed')).toHaveCount(0);

    liveHome = 57;
    await page.keyboard.press('r');
    await expect(card.locator('.score-changed')).toHaveText('57');
    await expect(card.locator('.score-changed')).toHaveCount(1);
    await expect(page.locator('.score-changed')).toHaveCount(0, { timeout: 5000 });
});

test('football shows a ball for possession and a red zone pill; NBA marks national games', async ({ page }) => {
    liveExtra = { national: 'ESPN' };
    extraGames = [
        {
            ...game,
            id: 'fixture-football-live',
            title: 'Fixture Bears at Packers',
            teamIds: ['nfl-3', 'nfl-9'],
            home: 'Green Bay Packers',
            away: 'Chicago Bears',
            homeScore: 14,
            awayScore: 10,
            status: 'live',
            statusLabel: 'Q2 2:00',
            situation: '2nd & 4 at GB 12',
            possession: 'away',
            redZone: true,
        },
        {
            ...liveGame,
            id: 'fixture-nba-tv',
            title: 'Fixture Heat at Hornets',
            teamIds: ['nba-14', 'nba-30'],
            home: 'Charlotte Hornets',
            away: 'Miami Heat',
            broadcast: 'NBA TV',
            national: undefined,
        },
    ];
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await expandSections(page);
    const football = page.locator('.game', { hasText: 'Green Bay Packers' });
    await expect(football.locator('.red-zone')).toHaveText('Red zone');
    await expect(football.locator('.situation')).toContainText('2nd & 4 at GB 12');
    await expect(football.locator('svg.possession-ball')).toHaveCount(1);
    expect(
        await football.locator('svg.possession-ball').evaluate((icon) => icon.parentElement?.firstElementChild === icon)
    ).toBe(true);
    await expect(football.getByRole('img', { name: 'Has possession' })).toHaveCount(1);
    await expect(football.getByText('AWAY', { exact: true })).toHaveCount(0);
    await expect(football.getByText('HOME', { exact: true })).toHaveCount(0);
    await expect(football.locator('.national-badge')).toHaveCount(0);

    const national = page.locator('.game', { hasText: 'Indiana Pacers' });
    await expect(national.getByRole('img', { name: 'National broadcast: ESPN' })).toHaveCount(1);
    await expect(page.locator('.game').getByText(/^(HOME|AWAY)$/)).toHaveCount(0);
    const rows = national.locator('.score-lines > div');
    await expect(rows.nth(0)).toContainText('Chicago Bulls');
    await expect(rows.nth(1)).toContainText('Indiana Pacers');
    await expect(page.locator('.game', { hasText: 'Charlotte Hornets' }).locator('.national-badge')).toHaveCount(0);
    await football.screenshot({ path: 'test-results/football-red-zone.png' });
    await national.screenshot({ path: 'test-results/nba-national.png' });
});

test('server failures are visible with retry, without fake records', async ({ page }) => {
    await page.unroute('**/api/**');
    await page.route('**/api/**', (route) => route.fulfill({ status: 503, json: { error: 'Database unavailable' } }));
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('database connection');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.locator('.game')).toHaveCount(0);
});
