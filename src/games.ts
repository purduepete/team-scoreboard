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
export type GameStatusFilter = 'all' | 'live' | 'final';

export function matchesGameStatus(game: Pick<Game, 'status'>, filter: GameStatusFilter): boolean {
    return filter === 'all' || game.status === filter;
}

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
export const recentDayOptions = [1, 3, 5] as const;
export type RecentDays = (typeof recentDayOptions)[number];

// Live shows every game on today's local date; Upcoming and Recent split the rest by status.
// Recent keeps finals from the last windowDays local days (14 by default; the page passes the saved
// 1, 3 or 5) plus past postponed or canceled games in that window; Upcoming keeps
// the next windowDays local days (7 by default) and undated games.
export function visibleGames(
    games: Game[],
    view: View,
    filter: string | string[],
    favoriteIds: string[],
    now = new Date(),
    windowDays = view === 'upcoming' ? upcomingDays : resultDays
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
        return game.status !== 'final' && game.status !== 'live' && (days === null || (days > 0 && days <= windowDays));
    });
}

export function isFavorite(game: Game, favoriteIds: string[]): boolean {
    return game.teamIds.some((id) => favoriteIds.includes(id));
}

const sections = [
    { key: 'NCAA', label: 'Purdue' },
    { key: 'NFL', label: 'NFL' },
    { key: 'Big Ten', label: 'Big Ten' },
    { key: 'MLB', label: 'MLB' },
    { key: 'NBA', label: 'NBA' },
];

const statusRank = (game: Game) =>
    game.status === 'live' ? 0 : game.status === 'upcoming' ? 1 : game.status === 'final' ? 2 : 3;

export function footballSituation(text?: string) {
    const match = text?.match(/^(.*?)\s+at\s+(\S(?:.*\S)?)\s*$/i);
    return { detail: match ? match[1] : text, position: match?.[2] };
}

const nflRedZoneRank = (game: Game) => {
    if (game.league !== 'NFL' || game.status !== 'live' || !game.redZone) return 0;
    return footballSituation(game.situation).position ? 2 : 1;
};

function gameTimeRemaining(game: Game): number | null {
    if (game.status !== 'live') return null;
    const football = game.sport === 'Football';
    const basketball = /basketball/i.test(game.sport);
    if (!football && !basketball) return null;
    const halves = basketball && /men's basketball/i.test(game.sport) && game.league !== 'NBA';
    const periods = halves ? 2 : 4;
    const periodSeconds = football ? 15 * 60 : halves ? 20 * 60 : game.league === 'NBA' ? 12 * 60 : 10 * 60;
    const label = game.statusLabel;
    if (/^halftime$/i.test(label.trim())) return (periods / 2) * periodSeconds;
    const periodMatch = label.match(/\b(?:[QH](\d+)|(\d+)[QH]|(\d+)(?:st|nd|rd|th)(?:\s+(?:quarter|qtr|half))?)\b/i);
    const overtimeMatch = label.match(/\b(?:(\d+)\s*OT|OT\s*(\d*)|overtime)\b/i);
    const period = periodMatch
        ? Number(periodMatch[1] || periodMatch[2] || periodMatch[3])
        : overtimeMatch
          ? periods + Number(overtimeMatch[1] || overtimeMatch[2] || 1)
          : 0;
    const clock = label.match(/\b(\d{1,2}):([0-5]\d)(?:\.\d+)?\b/);
    const seconds = clock ? Number(clock[1]) * 60 + Number(clock[2]) : /^end(?: of)?\b/i.test(label) ? 0 : null;
    if (!period || seconds === null || (period <= periods && seconds > periodSeconds)) return null;
    const duration = period > periods ? (football ? 15 : 5) * 60 : periodSeconds;
    if (seconds > duration) return null;
    return Math.max(0, periods - period) * periodSeconds + seconds;
}

export function compareGames(a: Game, b: Game, favoriteIds: string[]): number {
    const time = (game: Game) => (game.startTime ? Date.parse(game.startTime) : Number.MAX_SAFE_INTEGER);
    const startA = time(a);
    const startB = time(b);
    const remainingA = gameTimeRemaining(a) ?? Number.MAX_SAFE_INTEGER;
    const remainingB = gameTimeRemaining(b) ?? Number.MAX_SAFE_INTEGER;
    return (
        Number(isFavorite(b, favoriteIds)) - Number(isFavorite(a, favoriteIds)) ||
        statusRank(a) - statusRank(b) ||
        nflRedZoneRank(b) - nflRedZoneRank(a) ||
        startA - startB ||
        (startA !== Number.MAX_SAFE_INTEGER ? remainingA - remainingB : 0) ||
        a.id.localeCompare(b.id)
    );
}

// Recent matches the grouped view: newest day first, earliest game first within a day, undated last.
export function compactGames(games: Game[], favoriteIds: string[], newestDayFirst = false): Game[] {
    const dayRank = (game: Game) => {
        const day = localDay(game);
        return day ? -day.getTime() : Number.MAX_SAFE_INTEGER;
    };
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
    const leagueRank = (game: Game) => {
        const index = sections.findIndex((section) => section.key === game.league);
        return index < 0 ? sections.length : index;
    };
    return unique.sort((a, b) => {
        const aFavorite = isFavorite(a, favoriteIds);
        const favorite = Number(isFavorite(b, favoriteIds)) - Number(aFavorite);
        if (favorite) return favorite;
        if (!aFavorite) {
            const league = leagueRank(a) - leagueRank(b) || a.league.localeCompare(b.league);
            if (league) return league;
        }
        if (newestDayFirst) {
            const day = dayRank(a) - dayRank(b);
            if (day) return day;
        }
        return compareGames(a, b, favoriteIds);
    });
}

function dayLabel(day: Date, today: Date): string {
    const full = day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const offset = Math.round((day.getTime() - today.getTime()) / 86_400_000);
    const relative = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday' : '';
    return relative ? `${relative} · ${full}` : full;
}

// Sections retain their league/day grouping; cards share compact mode's ordering.
export function groupGames(games: Game[], view: View, favoriteIds: string[], now = new Date()): LeagueSection[] {
    const today = startOfDay(now);
    const newestFirst = view === 'recent';
    const order = (a: Game, b: Game) => compareGames(a, b, favoriteIds);
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
