import { describe, expect, it } from 'vitest';
import { localDate, pinKey, pinsKey, readCardOrder, readPins, todayGames } from '../src/added-teams';
import type { Game } from '../shared/contracts';

describe('daily browser team pins', () => {
    it('uses local calendar dates rather than UTC date prefixes', () => {
        const date = new Date(2026, 9, 24, 23, 59);
        expect(localDate(date)).toBe('2026-10-24');
        expect(localDate(new Date(2026, 9, 25))).toBe('2026-10-25');
        const game = { startTime: date.toISOString(), date: '2026-10-25' } as Game;
        expect(todayGames([game], date)).toEqual([game]);
        expect(todayGames([game], new Date(2026, 9, 25))).toEqual([]);
    });
    it('handles an unannounced time without treating live games yesterday as today', () => {
        const today = { startTime: null, date: '2026-10-24' } as Game;
        const yesterday = { startTime: null, date: '2026-10-23', status: 'live' } as Game;
        expect(todayGames([today, yesterday], new Date(2026, 9, 24))).toEqual([today]);
    });
    it('restores only today and removes duplicates by sport and ID', () => {
        const team = { category: 'college-football', id: '11' };
        const raw = JSON.stringify({ date: '2026-10-24', teams: [team, team] });
        expect(readPins(raw, '2026-10-24')).toEqual([team]);
        expect(readPins(raw, '2026-10-25')).toEqual([]);
        expect(pinKey({ category: 'college-football', id: '11' })).toBe('college-football:11');
        expect(pinsKey).toContain('v1');
    });
    it('restores saved card order and accepts existing pin settings without an order', () => {
        const oldSettings = JSON.stringify({ date: '2026-10-24', teams: [] });
        expect(readCardOrder(oldSettings, '2026-10-24')).toEqual([]);
        expect(
            readCardOrder(JSON.stringify({ date: '2026-10-24', teams: [], order: ['game:1', 'team:2'] }), '2026-10-24')
        ).toEqual(['game:1', 'team:2']);
        expect(readCardOrder(JSON.stringify({ date: '2026-10-23', order: ['game:1'] }), '2026-10-24')).toEqual([]);
    });
    it('rejects corrupt identities and oversized local storage', () => {
        for (const teams of [
            [{ category: 'hockey', id: '11' }],
            [{ category: 'nba', id: '11' }],
            [{ category: 'college-football', id: '../11' }],
            Array.from({ length: 21 }, (_, index) => ({ category: 'college-football', id: String(index) })),
        ]) {
            expect(() => readPins(JSON.stringify({ date: '2026-10-24', teams }), '2026-10-24')).toThrow();
        }
        expect(() => readPins('garbage', '2026-10-24')).toThrow();
    });
});
