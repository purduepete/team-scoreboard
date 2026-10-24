import { describe, expect, it } from 'vitest';
import type { Game } from '../shared/contracts.js';
import { GameAlerts, alertTeamIds, pushoverSender } from '../server/alerts.js';
import type { Alert } from '../server/alerts.js';
import { expandFavorites } from '../server/catalog.js';

const game = (status: Game['status'], overrides: Partial<Game> = {}): Game => ({
    id: '401',
    teamIds: ['134927', '134915'],
    sport: 'Football',
    league: 'NFL',
    title: 'Baltimore Ravens at Indianapolis Colts',
    status,
    statusLabel: status === 'final' ? 'Final' : '1st 12:00',
    date: '2026-09-13',
    startTime: '2026-09-13T17:00:00.000Z',
    home: 'Indianapolis Colts',
    away: 'Baltimore Ravens',
    homeScore: status === 'upcoming' ? null : 24,
    awayScore: status === 'upcoming' ? null : 17,
    sourceUrl: 'https://www.espn.com/nfl/game/_/gameId/401',
    broadcast: 'CBS',
    ...overrides,
});

describe('game alerts', () => {
    const setup = () => {
        const sent: Alert[] = [];
        const alerts = new GameAlerts(async (alert) => {
            sent.push(alert);
        });
        return { sent, alerts };
    };
    it('alerts once at kickoff and once at the final, never on the first sighting', () => {
        const { sent, alerts } = setup();
        alerts.observe([game('live')], ['134927']);
        expect(sent).toHaveLength(0);

        const fresh = setup();
        fresh.alerts.observe([game('upcoming')], ['134927']);
        fresh.alerts.observe([game('live'), game('live')], ['134927']);
        fresh.alerts.observe([game('live')], ['134927']);
        fresh.alerts.observe([game('final')], ['134927']);
        fresh.alerts.observe([game('final')], ['134927']);
        expect(fresh.sent.map((alert) => alert.title)).toEqual([
            'Baltimore Ravens at Indianapolis Colts started',
            'Final: Baltimore Ravens 17, Indianapolis Colts 24',
        ]);
        expect(fresh.sent[0].message).toBe('NFL · Football · on CBS');
    });
    it('ignores games without a watched team', () => {
        const { sent, alerts } = setup();
        alerts.observe([game('upcoming')], ['999']);
        alerts.observe([game('live')], ['999']);
        expect(sent).toHaveLength(0);
    });
    it('includes every favorite, expanding Purdue All Varsity without duplicates', () => {
        const favorites = ['134927', 'purdue-all', 'purdue-volleyball'];
        const ids = alertTeamIds(favorites);
        expect(ids).toEqual(expandFavorites(favorites).map((team) => team.id));
        expect(ids).toContain('purdue-volleyball');
        expect(ids.filter((id) => id === 'purdue-volleyball')).toHaveLength(1);
        expect(ids).not.toContain('purdue-all');
        expect(alertTeamIds([])).toEqual([]);
    });
    it.each([['purdue-all'], ['purdue-volleyball']])('alerts for favorite volleyball via %s', (favorite) => {
        const { sent, alerts } = setup();
        const watched = alertTeamIds([favorite]);
        const volleyball = (status: Game['status']) =>
            game(status, {
                teamIds: ['purdue-volleyball'],
                sport: "Women's Volleyball",
                league: 'NCAA',
                home: 'Purdue Boilermakers',
                away: 'Minnesota Golden Gophers',
            });
        alerts.observe([volleyball('upcoming')], watched);
        alerts.observe([volleyball('live')], watched);
        alerts.observe([volleyball('final')], watched);
        alerts.observe([volleyball('final')], watched);
        expect(sent).toHaveLength(2);
        expect(sent[0].title).toBe('Minnesota Golden Gophers at Purdue Boilermakers started');
        expect(sent[1].title).toMatch(/^Final:/);
    });
    it('posts to Pushover with the ESPN link', async () => {
        let request: RequestInit | undefined;
        const send = pushoverSender('user', 'token', async (_url, init) => {
            request = init;
            return new Response('{}');
        });
        await send({ title: 'T', message: 'M', url: 'https://www.espn.com/x' });
        const body = new URLSearchParams(String(request?.body));
        expect(Object.fromEntries(body)).toMatchObject({
            token: 'token',
            user: 'user',
            title: 'T',
            url: 'https://www.espn.com/x',
        });
    });
});
