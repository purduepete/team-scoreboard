import { z } from 'zod';
import type { Game, Team } from '../shared/contracts.js';

const providerPattern = /^([a-z]+\/[a-z0-9.-]+)\/(\d+)$/;
const scoreSchema = z
    .union([z.string(), z.number(), z.object({ value: z.number().optional(), displayValue: z.string().optional() })])
    .nullable()
    .optional();
const statusSchema = z.object({
    type: z.object({
        name: z.string().optional(),
        state: z.string().optional(),
        shortDetail: z.string().optional(),
    }),
});
const eventSchema = z.object({
    id: z.string().regex(/^\d+$/),
    name: z.string().min(1),
    date: z.string().optional(),
    links: z.array(z.object({ rel: z.array(z.string()), href: z.string() })).optional(),
    status: statusSchema.optional(),
    competitions: z
        .array(
            z.object({
                timeValid: z.boolean().optional(),
                status: statusSchema.optional(),
                competitors: z.array(
                    z.object({
                        homeAway: z.string().optional(),
                        team: z.object({ id: z.string(), displayName: z.string().optional() }),
                        score: scoreSchema,
                    })
                ),
            })
        )
        .min(1),
});

export function parseProviderId(providerId: string): { path: string; id: string } {
    const match = providerPattern.exec(providerId);
    if (!match) throw new Error('Invalid provider team identifier.');
    return { path: match[1], id: match[2] };
}

function score(value: z.infer<typeof scoreSchema>): number | null {
    if (value == null) return null;
    const raw = typeof value === 'object' ? (value.value ?? value.displayValue) : value;
    if (raw == null || raw === '') return null;
    const result = Number(raw);
    if (!Number.isSafeInteger(result) || result < 0) throw new Error('Provider returned an invalid score.');
    return result;
}

function source(links: { rel: string[]; href: string }[] | undefined, fallback: string): string {
    const espn = (links ?? []).filter((link) => link.href.startsWith('https://www.espn.com/'));
    return (espn.find((link) => link.rel.includes('summary')) ?? espn[0])?.href ?? fallback;
}

export function normalizeEvent(input: unknown, team: Team): Game {
    const event = eventSchema.parse(input);
    const { id: providerTeamId } = parseProviderId(team.providerId ?? '');
    const competition = event.competitions[0];
    if (!competition.competitors.some((entry) => entry.team.id === providerTeamId)) {
        throw new Error('Provider returned an event for a different team.');
    }
    const home = competition.competitors.find((entry) => entry.homeAway === 'home');
    const away = competition.competitors.find((entry) => entry.homeAway === 'away');
    const type = (competition.status ?? event.status)?.type;
    const name = type?.name ?? '';
    const status: Game['status'] =
        name === 'STATUS_POSTPONED'
            ? 'postponed'
            : name === 'STATUS_CANCELED' || name === 'STATUS_CANCELLED'
              ? 'canceled'
              : type?.state === 'pre'
                ? 'upcoming'
                : type?.state === 'in'
                  ? 'live'
                  : type?.state === 'post'
                    ? 'final'
                    : 'unknown';
    const instant = event.date ? new Date(event.date) : null;
    if (instant && Number.isNaN(instant.getTime())) throw new Error('Provider returned an invalid start time.');
    const timeKnown = instant && competition.timeValid !== false;
    return {
        id: event.id,
        teamIds: [team.id],
        sport: team.sport,
        league: team.league,
        title: event.name,
        home: home?.team.displayName ?? null,
        away: away?.team.displayName ?? null,
        homeScore: status === 'upcoming' ? null : score(home?.score),
        awayScore: status === 'upcoming' ? null : score(away?.score),
        startTime: timeKnown ? instant.toISOString() : null,
        date: instant ? instant.toISOString().slice(0, 10) : null,
        status,
        statusLabel:
            status === 'live'
                ? type?.shortDetail || 'Live'
                : status === 'final'
                  ? type?.shortDetail || 'Final'
                  : status === 'upcoming'
                    ? 'Scheduled'
                    : status === 'unknown'
                      ? 'Status unavailable'
                      : status.charAt(0).toUpperCase() + status.slice(1),
        sourceUrl: source(event.links, team.officialUrl),
    };
}

export function parseEvents(input: unknown, team: Team): Game[] {
    const response = z.object({ events: z.array(z.unknown()).nullable().optional() }).parse(input);
    return (response.events ?? []).map((value) => normalizeEvent(value, team));
}

// Keep live games, the last 3 results and the next 5 games so daily sports don't bury weekly ones.
export function selectWindow(games: Game[], now: number): Game[] {
    const time = (game: Game) => game.startTime ?? game.date ?? '';
    const cutoff = new Date(now - 24 * 60 * 60_000).toISOString();
    const live = games.filter((game) => game.status === 'live');
    const finals = games
        .filter((game) => game.status === 'final')
        .sort((a, b) => time(b).localeCompare(time(a)))
        .slice(0, 3);
    const upcoming = games
        .filter((game) => !['live', 'final'].includes(game.status) && (!time(game) || time(game) >= cutoff))
        .sort((a, b) => time(a).localeCompare(time(b)))
        .slice(0, 5);
    return [...live, ...finals, ...upcoming];
}

export class ProviderError extends Error {
    constructor(
        message: string,
        readonly retryAfterMs: number = 120_000
    ) {
        super(message);
    }
}

export class SportsProvider {
    private tail: Promise<void> = Promise.resolve();
    private nextRequestAt = 0;
    private blockedUntil = 0;

    constructor(
        private readonly fetcher: typeof fetch = fetch,
        private readonly clock: () => number = Date.now,
        private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    ) {}

    private request(path: string, id: string, query = ''): Promise<unknown> {
        const operation = this.tail.then(async () => {
            const delay = Math.max(this.nextRequestAt, this.blockedUntil) - this.clock();
            if (delay > 0) await this.wait(delay);
            this.nextRequestAt = this.clock() + 500;
            const response = await this.fetcher(
                `https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${id}/schedule${query}`,
                { signal: AbortSignal.timeout(12_000), redirect: 'error' }
            );
            if (response.status === 429) {
                const retry = Number(response.headers.get('retry-after'));
                const backoff = Number.isFinite(retry) && retry > 0 ? Math.min(retry * 1000, 900_000) : 120_000;
                this.blockedUntil = this.clock() + backoff;
                throw new ProviderError('Sports provider rate limit reached. Refresh will retry later.', backoff);
            }
            // ESPN answers 400 for a sport with no current season; treat it as no games.
            if (response.status === 400) return { events: [] };
            if (!response.ok) throw new ProviderError(`Sports provider returned HTTP ${response.status}.`);
            return response.json() as Promise<unknown>;
        });
        this.tail = operation.then(
            () => undefined,
            () => undefined
        );
        return operation;
    }

    async schedule(team: Team): Promise<Game[]> {
        if (!team.providerId) throw new Error('This sport has no configured feed.');
        const { path, id } = parseProviderId(team.providerId);
        let games = parseEvents(await this.request(path, id), team);
        if (!games.length) games = parseEvents(await this.request(path, id, '?seasontype=2'), team);
        return selectWindow([...new Map(games.map((game) => [game.id, game])).values()], this.clock());
    }
}
