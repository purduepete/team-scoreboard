import type { Game } from './contracts.js';

const rank = (game: Game) => (game.origin === 'schedule' ? 0 : 1);

// Fields that describe the game right now. They come only from the winning copy, so a stale copy can't
// leave an old situation on a finished game.
const liveFields = ['status', 'statusLabel', 'homeScore', 'awayScore', 'situation', 'possession', 'redZone'] as const;

function merge(winner: Game, loser: Game): Game {
    const merged: Game = { ...loser };
    for (const [key, value] of Object.entries(winner) as [keyof Game, Game[keyof Game]][]) {
        if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
    }
    for (const key of liveFields) {
        if (winner[key] === undefined) delete merged[key];
    }
    merged.teamIds = [...new Set([...winner.teamIds, ...loser.teamIds])];
    return merged;
}

// One snapshot per ESPN event. League scoreboard copies beat team-schedule copies; on a tie the later
// entry wins, so callers pass older sources first.
export function reconcile(games: Game[]): Map<string, Game> {
    const result = new Map<string, Game>();
    for (const game of games) {
        const previous = result.get(game.id);
        if (!previous) result.set(game.id, game);
        else if (rank(game) >= rank(previous)) result.set(game.id, merge(game, previous));
        else result.set(game.id, merge(previous, game));
    }
    return result;
}

// Copies the reconciled live fields onto a per-section copy, keeping that copy's league and team ids.
export function withLiveFields(game: Game, best: Game | undefined): Game {
    if (!best || best === game) return game;
    const next: Game = { ...game };
    for (const key of liveFields) {
        if (best[key] === undefined) delete next[key];
        else (next as unknown as Record<string, unknown>)[key] = best[key];
    }
    return next;
}
