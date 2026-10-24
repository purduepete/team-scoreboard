import type { Game } from '../shared/contracts.js';
import { reconcile } from '../shared/reconcile.js';
import { expandFavorites } from './catalog.js';

export function alertTeamIds(favorites: string[]): string[] {
    return expandFavorites(favorites).map((team) => team.id);
}

export interface Alert {
    title: string;
    message: string;
    url: string;
}

const matchup = (game: Game) => (game.home && game.away ? `${game.away} at ${game.home}` : game.title);

export function startAlert(game: Game): Alert {
    return {
        title: `${matchup(game)} started`,
        message: [game.league, game.sport, game.broadcast ? `on ${game.broadcast}` : ''].filter(Boolean).join(' · '),
        url: game.sourceUrl,
    };
}

export function finalAlert(game: Game): Alert {
    const score =
        game.home && game.away && game.homeScore !== null && game.awayScore !== null
            ? `${game.away} ${game.awayScore}, ${game.home} ${game.homeScore}`
            : matchup(game);
    return {
        title: `Final: ${score}`,
        message: `${game.statusLabel} · ${game.league} · ${game.sport}`,
        url: game.sourceUrl,
    };
}

// Sends one alert when a watched game goes live and one when it goes final. The first sighting of a game
// only records its status, so a restart never replays alerts for games already under way or finished.
export class GameAlerts {
    private readonly seen = new Map<string, Game['status']>();
    private readonly sent = new Set<string>();

    constructor(private readonly send: (alert: Alert) => Promise<void>) {}

    observe(games: Game[], watchedIds: string[]): void {
        // Purdue's Big Ten games arrive from two feeds; the scoreboard copy wins.
        const unique = reconcile(games);
        for (const game of unique.values()) {
            if (!game.teamIds.some((id) => watchedIds.includes(id))) continue;
            const previous = this.seen.get(game.id);
            this.seen.set(game.id, game.status);
            if (previous === undefined || previous === game.status) continue;
            if (game.status === 'live' && previous !== 'final') this.notify(`${game.id}:start`, startAlert(game));
            if (game.status === 'final' && previous === 'live') this.notify(`${game.id}:final`, finalAlert(game));
        }
        if (this.seen.size > 5000) this.seen.clear();
        if (this.sent.size > 5000) this.sent.clear();
    }

    private notify(key: string, alert: Alert): void {
        if (this.sent.has(key)) return;
        this.sent.add(key);
        this.send(alert).catch((error: unknown) =>
            console.error('Game alert failed:', error instanceof Error ? error.message : 'Unknown error')
        );
    }
}

export function pushoverSender(
    userKey: string,
    appToken: string,
    fetcher: typeof fetch = fetch
): (alert: Alert) => Promise<void> {
    return async (alert) => {
        const response = await fetcher('https://api.pushover.net/1/messages.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                token: appToken,
                user: userKey,
                title: alert.title.slice(0, 250),
                message: alert.message.slice(0, 1000) || ' ',
                url: alert.url,
                url_title: 'Open on ESPN',
            }),
            signal: AbortSignal.timeout(10_000),
            redirect: 'error',
        });
        if (!response.ok) throw new Error(`Pushover returned HTTP ${response.status}.`);
    };
}
