import type { Game } from '../shared/contracts';

export function formatStart(game: Pick<Game, 'startTime' | 'date'>): string {
    if (!game.startTime) return game.date ? `${game.date} · time unannounced` : 'Date and time unannounced';
    return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    }).format(new Date(game.startTime));
}

export function formatTime(game: Pick<Game, 'startTime' | 'date'>): string {
    if (!game.startTime) return 'Time unannounced';
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(
        new Date(game.startTime)
    );
}

export type View = 'live' | 'upcoming' | 'recent';
export type Grouping = 'day' | 'week';

export interface GameGroup {
    key: string;
    label: string;
    games: Game[];
}

// filter is 'all', 'favorites', 'league:<NFL|NBA|MLB|NCAA>' or a single team id.
export function visibleGames(games: Game[], view: View, filter: string, favoriteIds: string[]): Game[] {
    const deduplicated = new Map<string, Game>();
    for (const game of games) {
        const existing = deduplicated.get(game.id);
        deduplicated.set(
            game.id,
            existing ? { ...game, teamIds: [...new Set([...existing.teamIds, ...game.teamIds])] } : game
        );
    }
    return [...deduplicated.values()].filter((game) => {
        const matches =
            filter === 'all' ||
            (filter === 'favorites'
                ? isFavorite(game, favoriteIds)
                : filter.startsWith('league:')
                  ? game.league === filter.slice(7)
                  : game.teamIds.includes(filter));
        return (
            matches &&
            (view === 'recent'
                ? game.status === 'final'
                : view === 'live'
                  ? game.status === 'live'
                  : game.status !== 'final' && game.status !== 'live')
        );
    });
}

export function isFavorite(game: Game, favoriteIds: string[]): boolean {
    return game.teamIds.some((id) => favoriteIds.includes(id));
}

function localDay(game: Game): Date | null {
    if (game.startTime) {
        const start = new Date(game.startTime);
        return new Date(start.getFullYear(), start.getMonth(), start.getDate());
    }
    if (!game.date) return null;
    const [year, month, day] = game.date.split('-').map(Number);
    return new Date(year, month - 1, day);
}

const dayMs = 86_400_000;
const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / dayMs);
const shortDate = (value: Date) => value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function dayLabel(day: Date, today: Date): string {
    const full = day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const offset = daysBetween(today, day);
    const relative = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday' : '';
    return relative ? `${relative} · ${full}` : full;
}

// Weeks run Monday to Sunday.
function weekStart(day: Date): Date {
    const start = new Date(day);
    start.setDate(day.getDate() - ((day.getDay() + 6) % 7));
    return start;
}

function weekLabel(start: Date, today: Date): string {
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const range =
        start.getMonth() === end.getMonth()
            ? `${shortDate(start)} to ${end.getDate()}`
            : `${shortDate(start)} to ${shortDate(end)}`;
    const offset = Math.round(daysBetween(weekStart(today), start) / 7);
    const relative = offset === 0 ? 'This week' : offset === 1 ? 'Next week' : offset === -1 ? 'Last week' : '';
    return relative ? `${relative} · ${range}` : `Week of ${range}`;
}

// Groups by local day or week. Favorites lead each group, then games run in time order
// (newest first for results).
export function groupGames(
    games: Game[],
    view: View,
    grouping: Grouping,
    favoriteIds: string[],
    now = new Date()
): GameGroup[] {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const newestFirst = view === 'recent';
    const groups = new Map<string, GameGroup & { order: number }>();
    for (const game of games) {
        const day = localDay(game);
        const anchor = day && grouping === 'week' ? weekStart(day) : day;
        const key = anchor ? anchor.toISOString() : 'unscheduled';
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                label: !anchor
                    ? 'Date to be announced'
                    : grouping === 'week'
                      ? weekLabel(anchor, today)
                      : dayLabel(anchor, today),
                order: anchor ? anchor.getTime() : Number.MAX_SAFE_INTEGER,
                games: [],
            });
        }
        groups.get(key)!.games.push(game);
    }
    const time = (game: Game) => game.startTime ?? game.date ?? '9999';
    return [...groups.values()]
        .sort((a, b) =>
            a.key === 'unscheduled' || b.key === 'unscheduled'
                ? a.order - b.order
                : newestFirst
                  ? b.order - a.order
                  : a.order - b.order
        )
        .map(({ key, label, games: members }) => ({
            key,
            label,
            games: members.sort((a, b) => {
                const favorite = Number(isFavorite(b, favoriteIds)) - Number(isFavorite(a, favoriteIds));
                if (favorite) return favorite;
                return newestFirst ? time(b).localeCompare(time(a)) : time(a).localeCompare(time(b));
            }),
        }));
}
