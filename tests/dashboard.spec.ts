import { test, expect } from '@playwright/test';
import { teams, defaultFavorites, expandFavorites } from '../server/catalog';
import type { Dashboard, Game } from '../shared/contracts';

const game: Game = {
    id: 'fixture-1',
    teamIds: ['134927'],
    sport: 'Football',
    league: 'NFL',
    title: 'Fixture Colts vs Seahawks',
    home: 'Indianapolis Colts',
    away: 'Seattle Seahawks',
    homeScore: null,
    awayScore: null,
    startTime: '2026-10-25T17:00:00Z',
    date: '2026-10-25',
    status: 'upcoming',
    statusLabel: 'Scheduled',
    sourceUrl: 'https://www.thesportsdb.com',
};

test.beforeEach(async ({ page }) => {
    let favorites = [...defaultFavorites];
    await page.route('**/api/**', async (route) => {
        const request = route.request();
        if (request.url().endsWith('/api/dashboard')) {
            const body: Dashboard = {
                favorites,
                teams,
                liveAvailable: false,
                notice: 'Fixture data. Free feeds have at most one upcoming game and one result; no live scores.',
                feeds: expandFavorites(favorites).map((entry) => ({
                    teamId: entry.id,
                    games: entry.id === '134927' ? [game] : [],
                    updatedAt: entry.providerId ? '2026-10-22T23:00:00Z' : null,
                    stale: entry.id === '134927',
                    error: entry.id === '134927' ? 'Fixture upstream failure' : null,
                    pending: false,
                })),
            };
            await route.fulfill({ json: body });
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

test('favorite edits survive reload, free live limitation and source errors are visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Game day, at a glance' })).toBeVisible();
    await expect(page.getByText('Fixture upstream failure')).toBeVisible();
    await expect(page.getByText('Stale data', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: "Purdue · Women's Volleyball", exact: true })).toBeVisible();
    await expect(page.getByText('Official link only', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Live', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Live scores aren’t included' })).toBeVisible();
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

test('server failures are visible with retry, without fake records', async ({ page }) => {
    await page.unroute('**/api/**');
    await page.route('**/api/**', (route) => route.fulfill({ status: 503, json: { error: 'Database unavailable' } }));
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('database connection');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.locator('.game')).toHaveCount(0);
});
