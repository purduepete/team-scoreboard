import type { Game, TeamCategory } from '../shared/contracts';

export interface TeamPin {
    category: TeamCategory;
    id: string;
}

export const pinLimit = 20;
export const pinsKey = 'team-scoreboard-added-teams-v1';
export const categories: { value: TeamCategory; label: string }[] = [
    { value: 'college-football', label: 'College football' },
    { value: 'college-basketball', label: 'College basketball' },
];

export const pinKey = (pin: TeamPin) => `${pin.category}:${pin.id}`;

export function localDate(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function todayGames(games: Game[], now = new Date()): Game[] {
    const today = localDate(now);
    return games.filter((game) =>
        game.startTime ? localDate(new Date(game.startTime)) === today : game.date === today
    );
}

export function readPins(raw: string | null, date: string): TeamPin[] {
    if (!raw) return [];
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== 'object' || stored === null || !('date' in stored) || !('teams' in stored))
        throw new Error('Saved added teams are invalid. Remove the saved browser setting and try again.');
    if (stored.date !== date) return [];
    if (!Array.isArray(stored.teams) || stored.teams.length > pinLimit)
        throw new Error('Saved added teams exceed the 20-team limit or are invalid.');
    const pins: TeamPin[] = [];
    for (const entry of stored.teams) {
        if (
            typeof entry !== 'object' ||
            entry === null ||
            !categories.some((category) => category.value === entry.category) ||
            typeof entry.id !== 'string' ||
            !/^\d{1,10}$/.test(entry.id)
        )
            throw new Error('A saved added team is invalid.');
        const pin = { category: entry.category as TeamCategory, id: entry.id };
        if (!pins.some((existing) => pinKey(existing) === pinKey(pin))) pins.push(pin);
    }
    return pins;
}

export function readCardOrder(raw: string | null, date: string): string[] {
    if (!raw) return [];
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== 'object' || stored === null || !('date' in stored))
        throw new Error('Saved custom card order is invalid. Remove the saved browser setting and try again.');
    if (stored.date !== date || !('order' in stored) || stored.order === undefined) return [];
    if (
        !Array.isArray(stored.order) ||
        stored.order.length > pinLimit * 10 ||
        stored.order.some((key) => typeof key !== 'string' || key.length > 200)
    )
        throw new Error('Saved custom card order is invalid.');
    return [...new Set(stored.order)];
}
