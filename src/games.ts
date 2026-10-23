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

export function visibleGames(
    games: Game[],
    view: string,
    teamId: string,
    sport: string,
    expandedIds: string[]
): Game[] {
    const deduplicated = new Map<string, Game>();
    for (const game of games) {
        const existing = deduplicated.get(game.id);
        deduplicated.set(
            game.id,
            existing ? { ...game, teamIds: [...new Set([...existing.teamIds, ...game.teamIds])] } : game
        );
    }
    return [...deduplicated.values()]
        .filter((game) => {
            const teamMatches =
                teamId === 'all' ||
                (teamId === 'purdue-all'
                    ? game.teamIds.some((id) => expandedIds.includes(id))
                    : game.teamIds.includes(teamId));
            return (
                teamMatches &&
                (sport === 'all' || sport === game.sport) &&
                (view === 'recent' ? game.status === 'final' : game.status !== 'final')
            );
        })
        .sort((a, b) => {
            const aTime = a.startTime ?? a.date ?? '9999';
            const bTime = b.startTime ?? b.date ?? '9999';
            return view === 'recent' ? bTime.localeCompare(aTime) : aTime.localeCompare(bTime);
        });
}
