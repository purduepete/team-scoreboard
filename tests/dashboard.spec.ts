import { test, expect } from '@playwright/test';
import { teams, defaultFavorites, expandFavorites } from '../server/catalog';
import type { Dashboard, Feed, Game } from '../shared/contracts';

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

const expandSections = async (page: import('@playwright/test').Page) => {
    const collapsed = page.locator('.section-title button[aria-expanded="false"]');
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
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === '/api/calendar') {
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
                            games: [],
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
test('themes, system tracking, keyboard dropdowns and mobile width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/theme-midnight/);
    await expect(page.locator('select, datalist')).toHaveCount(0);
    const theme = page.getByRole('button', { name: 'Theme', exact: true });
    await theme.focus();
    await theme.press('Enter');
    await theme.press('Home');
    await theme.press('ArrowDown');
    await theme.press('Enter');
    await expect(page.locator('html')).toHaveClass('light');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ffffff');
    await page.reload();
    await expect(page.locator('html')).toHaveClass('light');
    await theme.click();
    await page.getByRole('option', { name: 'System', exact: true }).click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/theme-midnight/);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveClass('light');
    await theme.click();
    await theme.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await theme.click();
    await theme.press('Tab');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await theme.click();
    await page.mouse.click(8, 180);
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(page.locator('header').getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
    await expandSections(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('header')).toHaveCSS('position', 'sticky');
    await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveCount(0);
    const icon = await page.request.get('/apple-touch-icon.png');
    expect(icon.status()).toBe(200);
    expect((await icon.body()).readUInt32BE(16)).toBe(180);
    expect((await icon.body()).readUInt32BE(20)).toBe(180);
    await page.screenshot({ path: 'test-results/scoreboard-light-mobile.png', fullPage: true });
    await page.getByRole('link', { name: 'Source status' }).click();
    await expect(page.getByRole('heading', { name: 'Source status', exact: true })).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('favorite edits survive reload, live scores and source errors are visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Game day, at a glance' })).toBeVisible();
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
    await page.getByRole('button', { name: 'Edit favorites' }).click();
    await page.getByLabel('Find a team or sport').fill('Arizona Cardinals');
    await page.getByRole('button', { name: 'Add Arizona Cardinals' }).click();
    await expect(page.getByRole('button', { name: 'Remove Arizona Cardinals' })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Edit favorites' }).click();
    await page.getByLabel('Find a team or sport').fill('Arizona Cardinals');
    await page.getByRole('button', { name: 'Remove Arizona Cardinals' }).click();
    await expect(page.getByRole('button', { name: 'Add Arizona Cardinals' })).toBeVisible();
    await page.getByRole('button', { name: 'Close favorites editor' }).click();
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await page.screenshot({ path: 'test-results/scoreboard-midnight-desktop.png', fullPage: false });
});

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
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).not.toHaveClass(/favorite/);
    await expect(page.locator('.section-title button[aria-expanded="false"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await page.getByRole('option', { name: 'Indianapolis Colts', exact: true }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toBeVisible();
    await expect(cards.first()).not.toHaveClass(/favorite/);
    await page.locator('.section-title button', { hasText: 'NFL' }).click();
    await expect(cards.first()).toBeHidden();
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await page.getByRole('option', { name: 'NFL', exact: true }).click();
    await expect(cards.first()).toBeVisible();
    await expect(cards.first()).toHaveClass(/favorite/);
    await expect(page.getByRole('button', { name: 'Group by', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await page.getByRole('option', { name: 'All teams', exact: true }).click();
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
    expect(Math.abs((show?.y ?? 0) - (tabRow?.y ?? 99))).toBeLessThan(4);
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => refreshBodies).toEqual([{ days: 14, scope: 'live' }]);
    expect(fullLoads).toEqual(['14']);
    expect(new Set(requestedDays)).toEqual(new Set(['14']));
});

for (const theme of ['midnight', 'light']) {
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
    await expect(open).toHaveCount(0);
    await page.keyboard.press('Control+c');
    await expect(open).toHaveCount(0);
    await page.keyboard.press('r');
    await expect.poll(() => refreshBodies).toEqual([{ days: 14, scope: 'live' }]);

    await page.getByRole('button', { name: 'Edit favorites' }).click();
    await page.getByLabel('Find a team or sport').fill('x2');
    await expect(page.getByLabel('Find a team or sport')).toHaveValue('x2');
    await expect(closed).toHaveCount(await page.locator('.section-title button').count());
    await expect(pressed('Recent')).toHaveAttribute('aria-pressed', 'true');
    await expect(pressed('Upcoming')).toHaveAttribute('title', 'Upcoming (2)');
    await expect(pressed('Recent')).toHaveAttribute('title', 'Recent (3)');
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
    await expect(dialog).toContainText('Collapse all sections');
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
    await expect(page.getByRole('button', { name: 'Edit favorites' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Calendar' })).toHaveCount(0);

    calendarUrl = `https://team-scoreboard.jimlertech.com/calendar/${'t'.repeat(43)}.ics`;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.reload();
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
    await expect(football.getByRole('img', { name: 'Has possession' })).toHaveCount(1);
    await expect(football.getByText('AWAY', { exact: true })).toHaveCount(0);
    await expect(football.getByText('HOME', { exact: true })).toHaveCount(0);
    await expect(football.locator('.national-badge')).toHaveCount(0);

    const national = page.locator('.game', { hasText: 'Indiana Pacers' });
    await expect(national.getByRole('img', { name: 'National broadcast: ESPN' })).toHaveCount(1);
    await expect(national.getByText('HOME', { exact: true })).toHaveCount(1);
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
