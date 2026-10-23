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

test.beforeEach(async ({ page }) => {
    let favorites = [...defaultFavorites];
    requestedDays = [];
    refreshBodies = [];
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === '/api/dashboard') {
            const days = url.searchParams.get('days') ?? '';
            requestedDays.push(days);
            const body: Dashboard = {
                favorites,
                teams,
                liveAvailable: true,
                notice: 'Fixture data from ESPN-shaped feeds.',
                feeds: [
                    leagueFeed('NFL', days, [otherGame, game], 'Fixture upstream failure'),
                    leagueFeed('NBA', days, [liveGame]),
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('header')).toHaveCSS('position', 'sticky');
    await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveCount(0);
    const icon = await page.request.get('/apple-touch-icon.png');
    expect(icon.status()).toBe(200);
    expect((await icon.body()).readUInt32BE(16)).toBe(180);
    expect((await icon.body()).readUInt32BE(20)).toBe(180);
    await page.screenshot({ path: 'test-results/scoreboard-light-mobile.png', fullPage: true });
});

test('favorite edits survive reload, live scores and source errors are visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Game day, at a glance' })).toBeVisible();
    await expect(page.getByText('Fixture upstream failure')).toBeVisible();
    await expect(page.getByText('Stale data', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: "Purdue · Women's Volleyball", exact: true })).toBeVisible();
    await expect(page.getByText('Official link only', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Live', exact: true }).click();
    await expect(page.getByText('Q3 4:12')).toBeVisible();
    await expect(page.locator('.game')).toHaveCount(1);
    await page.getByRole('button', { name: 'Edit favorites' }).click();
    await page.getByLabel('Find a team or sport').fill('Arizona Cardinals');
    await page.getByRole('button', { name: 'Add Arizona Cardinals' }).click();
    await expect(page.getByRole('button', { name: 'Remove Arizona Cardinals' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Your favorite teams').getByText('Arizona Cardinals')).toBeVisible();
    await page.getByRole('button', { name: 'Edit favorites' }).click();
    await page.getByLabel('Find a team or sport').fill('Arizona Cardinals');
    await page.getByRole('button', { name: 'Remove Arizona Cardinals' }).click();
    await expect(page.getByRole('button', { name: 'Add Arizona Cardinals' })).toBeVisible();
    await page.getByRole('button', { name: 'Close favorites editor' }).click();
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await page.screenshot({ path: 'test-results/scoreboard-midnight-desktop.png', fullPage: false });
});

test('favorites lead each day, refresh posts the window and the window is remembered', async ({ page }) => {
    await page.goto('/');
    const cards = page.locator('.game');
    await expect(cards.first()).toContainText('Indianapolis Colts');
    await expect(cards.first()).toHaveClass(/favorite/);
    await expect(cards.first()).toContainText('NFL · Football · Week 8');
    await expect(cards.nth(1)).not.toHaveClass(/favorite/);
    await expect(page.locator('.group-heading').first()).toContainText('2 games');
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await page.getByRole('option', { name: 'Favorites', exact: true }).click();
    await expect(cards).toHaveCount(1);
    await page.getByRole('button', { name: 'Group by', exact: true }).click();
    await page.getByRole('option', { name: 'Week', exact: true }).click();
    await expect(page.locator('.group-heading').first()).toContainText(/week|Week of/);
    await page.getByRole('button', { name: 'Results', exact: true }).click();
    await page.getByRole('option', { name: 'Last 7 days', exact: true }).click();
    await expect.poll(() => requestedDays.at(-1)).toBe('7');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => refreshBodies).toEqual([{ days: 7 }]);
    await page.reload();
    await expect.poll(() => requestedDays.at(-1)).toBe('7');
    await expect(page.getByRole('button', { name: 'Results', exact: true })).toContainText('Last 7 days');
});

test('server failures are visible with retry, without fake records', async ({ page }) => {
    await page.unroute('**/api/**');
    await page.route('**/api/**', (route) => route.fulfill({ status: 503, json: { error: 'Database unavailable' } }));
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('database connection');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.locator('.game')).toHaveCount(0);
});
