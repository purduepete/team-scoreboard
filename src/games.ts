import type { Game } from '../shared/contracts';
import { reconcile, withLiveFields } from '../shared/reconcile';

export function formatStart(game: Pick<Game, 'startTime' | 'date'>): string {
    if (!game.startTime) return game.date ? `${game.date} · time unannounced` : 'Date and time unannounced';
    return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'short',
    }).format(new Date(game.startTime));
}

export function formatTime(game: Pick<Game, 'startTime' | 'date'>): string {
    if (!game.startTime) return 'Time unannounced';
    return new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'short',
    }).format(new Date(game.startTime));
}

export type View = 'live' | 'upcoming' | 'recent';

export interface DayGroup {
    key: string;
    label: string;
    games: Game[];
}

export interface LeagueSection {
    key: string;
    label: string;
    days: DayGroup[];
    count: number;
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

const startOfDay = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate());
const isToday = (game: Game, now: Date) => localDay(game)?.getTime() === startOfDay(now).getTime();

// Filters are 'all', 'favorites', 'league:<NFL|NBA|MLB|Big Ten|NCAA>' or team ids, matched as a union.
export const upcomingDays = 7;
export const resultDays = 14;

// Live shows every game on today's local date; Upcoming and Recent split the rest by status.
// Recent keeps finals from the last 14 local days plus past postponed or canceled games; Upcoming keeps
// today through the next 7 days and undated games, never a past date.
export function visibleGames(
    games: Game[],
    view: View,
    filter: string | string[],
    favoriteIds: string[],
    now = new Date(),
    windowDays = resultDays
): Game[] {
    const filters = typeof filter === 'string' ? [filter] : filter;
    const today = startOfDay(now).getTime();
    const offset = (game: Game) => {
        const day = localDay(game);
        return day ? Math.round((day.getTime() - today) / 86_400_000) : null;
    };
    // Purdue's Big Ten games arrive from both the Purdue and Big Ten feeds. Every copy takes the score and
    // situation from the freshest copy, then each section keeps one.
    const best = reconcile(games);
    const deduplicated = new Map<string, Game>();
    for (const source of games) {
        const game = withLiveFields(source, best.get(source.id));
        const key = `${game.league}:${game.id}`;
        const existing = deduplicated.get(key);
        deduplicated.set(
            key,
            existing ? { ...game, teamIds: [...new Set([...existing.teamIds, ...game.teamIds])] } : game
        );
    }
    return [...deduplicated.values()].filter((game) => {
        const matches = filters.some(
            (filter) =>
                filter === 'all' ||
                (filter === 'favorites'
                    ? isFavorite(game, favoriteIds)
                    : filter.startsWith('league:')
                      ? game.league === filter.slice(7)
                      : game.teamIds.includes(filter))
        );
        if (!matches) return false;
        if (view === 'live') return game.status === 'live' || isToday(game, now);
        const days = offset(game);
        if (view === 'recent')
            return (
                days !== null &&
                days >= -windowDays &&
                (game.status === 'final' || (days < 0 && game.status !== 'live'))
            );
        return (
            game.status !== 'final' && game.status !== 'live' && (days === null || (days >= 0 && days <= upcomingDays))
        );
    });
}

export function isFavorite(game: Game, favoriteIds: string[]): boolean {
    return game.teamIds.some((id) => favoriteIds.includes(id));
}

const sections = [
    { key: 'NCAA', label: 'Purdue' },
    { key: 'Big Ten', label: 'Big Ten' },
    { key: 'NFL', label: 'NFL' },
    { key: 'NBA', label: 'NBA' },
    { key: 'MLB', label: 'MLB' },
];

export function compactGames(games: Game[], favoriteIds: string[]): Game[] {
    const leagues = new Map<string, string>();
    for (const game of games) {
        const previous = leagues.get(game.id);
        const previousIndex = sections.findIndex((section) => section.key === previous);
        const index = sections.findIndex((section) => section.key === game.league);
        if (!previous || (index >= 0 && (previousIndex < 0 || index < previousIndex))) {
            leagues.set(game.id, game.league);
        }
    }
    const unique = [...reconcile(games).values()].map((game) => ({ ...game, league: leagues.get(game.id)! }));
    const time = (game: Game) => (game.startTime ? Date.parse(game.startTime) : Number.MAX_SAFE_INTEGER);
    const league = (game: Game) => {
        const index = sections.findIndex((section) => section.key === game.league);
        return index < 0 ? sections.length : index;
    };
    return unique.sort((a, b) => {
        const aFavorite = isFavorite(a, favoriteIds);
        const bFavorite = isFavorite(b, favoriteIds);
        const favorite = Number(bFavorite) - Number(aFavorite);
        if (favorite) return favorite;
        if (!aFavorite) {
            const byLeague = league(a) - league(b) || a.league.localeCompare(b.league);
            if (byLeague) return byLeague;
        }
        return time(a) - time(b) || a.id.localeCompare(b.id);
    });
}

function dayLabel(day: Date, today: Date): string {
    const full = day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const offset = Math.round((day.getTime() - today.getTime()) / 86_400_000);
    const relative = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday' : '';
    return relative ? `${relative} · ${full}` : full;
}

// Live first, then today's results, then games still to start.
const statusRank = (game: Game) => (game.status === 'live' ? 0 : game.status === 'final' ? 1 : 2);

// Sections run Purdue, Big Ten, NFL, NBA, MLB, each split into local days. Within a day, favorites
// lead in every view, then Live orders by status (live, final, upcoming). Start times run oldest
// first except in Recent.
export function groupGames(games: Game[], view: View, favoriteIds: string[], now = new Date()): LeagueSection[] {
    const today = startOfDay(now);
    const newestFirst = view === 'recent';
    const time = (game: Game) => game.startTime ?? game.date ?? '9999';
    const order = (a: Game, b: Game) => {
        const favorite = Number(isFavorite(b, favoriteIds)) - Number(isFavorite(a, favoriteIds));
        if (favorite) return favorite;
        if (view === 'live') {
            const rank = statusRank(a) - statusRank(b);
            if (rank) return rank;
        }
        return newestFirst ? time(b).localeCompare(time(a)) : time(a).localeCompare(time(b));
    };
    return sections
        .map((section) => {
            const days = new Map<string, DayGroup & { order: number }>();
            for (const game of games.filter((item) => item.league === section.key)) {
                const day = localDay(game);
                const key = day ? day.toISOString() : 'unscheduled';
                if (!days.has(key)) {
                    days.set(key, {
                        key: `${section.key}-${key}`,
                        label: day ? dayLabel(day, today) : 'Date to be announced',
                        order: day ? day.getTime() : Number.MAX_SAFE_INTEGER,
                        games: [],
                    });
                }
                days.get(key)!.games.push(game);
            }
            const sorted = [...days.values()]
                .sort((a, b) =>
                    a.order === Number.MAX_SAFE_INTEGER || b.order === Number.MAX_SAFE_INTEGER || !newestFirst
                        ? a.order - b.order
                        : b.order - a.order
                )
                .map(({ key, label, games: members }) => ({ key, label, games: members.sort(order) }));
            return {
                key: section.key,
                label: section.label,
                days: sorted,
                count: sorted.reduce((total, day) => total + day.games.length, 0),
            };
        })
        .filter((section) => section.count > 0);
}
