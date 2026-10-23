import { z } from 'zod';
import type { Game, Team } from '../shared/contracts.js';

const text = z.string().nullable().optional();
const eventSchema = z.object({
    idEvent: z.string().regex(/^\d+$/),
    strEvent: z.string().min(1),
    strHomeTeam: text,
    strAwayTeam: text,
    idHomeTeam: text,
    idAwayTeam: text,
    intHomeScore: text,
    intAwayScore: text,
    strTimestamp: text,
    dateEvent: text,
    strTime: text,
    strStatus: text,
    strPostponed: text,
});

function score(value: string | null | undefined): number | null {
    if (value == null || value === '') return null;
    if (!/^\d+$/.test(value)) throw new Error('Provider returned an invalid score.');
    const result = Number(value);
    if (!Number.isSafeInteger(result)) throw new Error('Provider returned an invalid score.');
    return result;
}

export function normalizeEvent(input: unknown, team: Team): Game {
    const event = eventSchema.parse(input);
    if (event.idHomeTeam !== team.providerId && event.idAwayTeam !== team.providerId) {
        throw new Error('Provider returned an event for a different team.');
    }
    const rawStatus = (event.strStatus ?? '').toUpperCase();
    const status: Game['status'] =
        event.strPostponed?.toLowerCase() === 'yes' || ['PST', 'POSTPONED'].includes(rawStatus)
            ? 'postponed'
            : ['CANC', 'CANCELLED', 'CANCELED'].includes(rawStatus)
              ? 'canceled'
              : ['FT', 'AET', 'AOT', 'AP', 'FINAL', 'MATCH FINISHED'].includes(rawStatus)
                ? 'final'
                : ['NS', 'NOT STARTED', 'TBD'].includes(rawStatus)
                  ? 'upcoming'
                  : 'unknown';
    const timestamp =
        event.strTimestamp || (event.dateEvent && event.strTime ? `${event.dateEvent}T${event.strTime}` : null);
    // The provider's timestamp field is UTC, even when it omits a timezone suffix.
    const utcTimestamp = timestamp ? (/[zZ]$|[+-]\d\d:\d\d$/.test(timestamp) ? timestamp : `${timestamp}Z`) : null;
    if (utcTimestamp && !z.iso.datetime({ offset: true }).safeParse(utcTimestamp).success) {
        throw new Error('Provider returned an invalid start time.');
    }
    const instant = utcTimestamp ? new Date(utcTimestamp) : null;
    const date = event.dateEvent ?? null;
    if (date && !z.iso.date().safeParse(date).success) throw new Error('Provider returned an invalid date.');
    return {
        id: event.idEvent,
        teamIds: [team.id],
        sport: team.sport,
        league: team.league,
        title: event.strEvent,
        home: event.strHomeTeam || null,
        away: event.strAwayTeam || null,
        homeScore: score(event.intHomeScore),
        awayScore: score(event.intAwayScore),
        startTime: instant?.toISOString() ?? null,
        date,
        status,
        statusLabel:
            status === 'unknown'
                ? 'Status unavailable (live feed not included)'
                : status === 'upcoming'
                  ? 'Scheduled · time subject to change'
                  : status.charAt(0).toUpperCase() + status.slice(1),
        sourceUrl: `https://www.thesportsdb.com/event/${event.idEvent}`,
    };
}

export function parseEvents(input: unknown, key: 'events' | 'results', team: Team): Game[] {
    const schema = z.object({ [key]: z.array(z.unknown()).nullable() });
    const response = schema.parse(input);
    const values = response[key];
    if (!Array.isArray(values)) return [];
    return values.map((value) => normalizeEvent(value, team));
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

    private request(endpoint: 'eventsnext.php' | 'eventslast.php', id: string): Promise<unknown> {
        if (!/^\d+$/.test(id)) return Promise.reject(new Error('Invalid provider team identifier.'));
        const operation = this.tail.then(async () => {
            const delay = Math.max(this.nextRequestAt, this.blockedUntil) - this.clock();
            if (delay > 0) await this.wait(delay);
            this.nextRequestAt = this.clock() + 6_000;
            const response = await this.fetcher(`https://www.thesportsdb.com/api/v1/json/123/${endpoint}?id=${id}`, {
                signal: AbortSignal.timeout(12_000),
                redirect: 'error',
            });
            if (response.status === 429) {
                const retry = Number(response.headers.get('retry-after'));
                const backoff = Number.isFinite(retry) && retry > 0 ? Math.min(retry * 1000, 900_000) : 120_000;
                this.blockedUntil = this.clock() + backoff;
                throw new ProviderError('Sports provider rate limit reached. Refresh will retry later.', backoff);
            }
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
        const next = parseEvents(await this.request('eventsnext.php', team.providerId), 'events', team);
        const recent = parseEvents(await this.request('eventslast.php', team.providerId), 'results', team);
        return [...new Map([...next, ...recent].map((event) => [event.id, event])).values()];
    }
}
