import { z } from 'zod';
import type { Game, Team } from '../shared/contracts.js';
import { catalogTeamId } from './catalog.js';
import type { LeagueSource } from './catalog.js';

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
    week: z.object({ number: z.number().int() }).optional(),
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

interface EventContext {
    sport: string;
    league: string;
    path: string;
    fallbackUrl: string;
}

function toGame(input: unknown, context: EventContext): { game: Game; espnTeamIds: string[] } {
    const event = eventSchema.parse(input);
    const competition = event.competitions[0];
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
    const espnTeamIds = competition.competitors.map((entry) => entry.team.id);
    const game: Game = {
        id: event.id,
        teamIds: [
            ...new Set(
                espnTeamIds.map((id) => catalogTeamId(context.path, id)).filter((id): id is string => id !== undefined)
            ),
        ],
        sport: context.sport,
        league: context.league,
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
        sourceUrl: source(event.links, context.fallbackUrl),
        ...(event.week ? { week: event.week.number } : {}),
    };
    return { game, espnTeamIds };
}

export function normalizeEvent(input: unknown, team: Team): Game {
    const { path, id } = parseProviderId(team.providerId ?? '');
    const { game, espnTeamIds } = toGame(input, {
        sport: team.sport,
        league: team.league,
        path,
        fallbackUrl: team.officialUrl,
    });
    if (!espnTeamIds.includes(id)) throw new Error('Provider returned an event for a different team.');
    return game.teamIds.includes(team.id) ? game : { ...game, teamIds: [team.id, ...game.teamIds] };
}

export function parseEvents(input: unknown, team: Team): Game[] {
    const response = z.object({ events: z.array(z.unknown()).nullable().optional() }).parse(input);
    return (response.events ?? []).map((value) => normalizeEvent(value, team));
}

const scoreboardSchema = z.object({
    events: z.array(z.unknown()).nullable().optional(),
    week: z.object({ number: z.number().int() }).optional(),
    season: z.object({ type: z.number().int() }).optional(),
});

// One odd event (for example an exhibition with placeholder teams) must not blank a whole league.
export function parseScoreboard(input: unknown, league: LeagueSource): Game[] {
    const events = scoreboardSchema.parse(input).events ?? [];
    const context = {
        sport: league.sport,
        league: league.league,
        path: league.path,
        fallbackUrl: league.scoreboardUrl,
    };
    const games: Game[] = [];
    for (const value of events) {
        try {
            games.push(toGame(value, context).game);
        } catch (error) {
            console.warn(`Skipped a ${league.league} event:`, error instanceof Error ? error.message : error);
        }
    }
    if (events.length && !games.length) throw new Error(`Every ${league.league} event failed to parse.`);
    return games;
}

// A feed is hot while a game is live or about to start, so its scores refresh every 5 minutes.
export function isHot(games: Game[], now: number): boolean {
    return games.some((game) => {
        if (game.status === 'live') return true;
        if (game.status !== 'upcoming' || !game.startTime) return false;
        const start = new Date(game.startTime).getTime();
        return start <= now + 30 * 60_000 && start >= now - 6 * 60 * 60_000;
    });
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

// ESPN scoreboard days follow US Eastern dates.
export function scoreboardDays(now: number, back = 3, ahead = 7): string[] {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
    const base = Date.parse(`${today}T12:00:00Z`);
    return Array.from({ length: back + ahead + 1 }, (_, index) =>
        new Date(base + (index - back) * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '')
    );
}

export class ProviderError extends Error {
    constructor(
        message: string,
        readonly retryAfterMs: number = 120_000
    ) {
        super(message);
    }
}

interface ScoreboardEntry {
    games: Game[];
    fetchedAt: number;
    usedAt: number;
    generation: number;
    week?: number;
    seasonType?: number;
}

export const liveRefreshMs = 5 * 60_000;
export const maxDaysBack = 14;

export class SportsProvider {
    private tail: Promise<void> = Promise.resolve();
    private nextRequestAt = 0;
    private blockedUntil = 0;
    private readonly scoreboards = new Map<string, ScoreboardEntry>();
    private generation = 0;
    private liveMark = 0;
    private allMark = 0;

    constructor(
        private readonly fetcher: typeof fetch = fetch,
        private readonly clock: () => number = Date.now,
        private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    ) {}

    private request(resource: string): Promise<unknown> {
        const operation = this.tail.then(async () => {
            const delay = Math.max(this.nextRequestAt, this.blockedUntil) - this.clock();
            if (delay > 0) await this.wait(delay);
            this.nextRequestAt = this.clock() + 500;
            const response = await this.fetcher(`https://site.api.espn.com/apis/site/v2/sports/${resource}`, {
                signal: AbortSignal.timeout(12_000),
                redirect: 'error',
            });
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
        let games = parseEvents(await this.request(`${path}/teams/${id}/schedule`), team);
        if (!games.length) games = parseEvents(await this.request(`${path}/teams/${id}/schedule?seasontype=2`), team);
        return selectWindow([...new Map(games.map((game) => [game.id, game])).values()], this.clock());
    }

    // Refresh button: makes only pages with a game in progress or about to start due.
    refreshLive(): void {
        this.liveMark = ++this.generation;
    }

    // Page load: makes every page due, including finished past days.
    refreshAll(): void {
        this.allMark = ++this.generation;
    }

    // Refetches only pages that are due. Live or about-to-start pages refresh every 5 minutes, the
    // current page every 10 minutes and future pages every 30 minutes. A past page whose games are
    // all final keeps its scores for a day.
    private async page(league: LeagueSource, query: string, current: boolean, past: boolean): Promise<ScoreboardEntry> {
        const key = `${league.id}?${query}`;
        const now = this.clock();
        const cached = this.scoreboards.get(key);
        if (cached) {
            cached.usedAt = now;
            const hot = isHot(cached.games, now);
            const settled =
                past && cached.games.every((game) => ['final', 'postponed', 'canceled'].includes(game.status));
            const age = hot ? liveRefreshMs : settled ? 24 * 60 * 60_000 : current ? 10 * 60_000 : 30 * 60_000;
            const forced = cached.generation < this.allMark || (hot && cached.generation < this.liveMark);
            if (!forced && now - cached.fetchedAt < age) return cached;
        }
        const generation = this.generation;
        const params = [league.group ? `groups=${league.group}` : '', query].filter(Boolean).join('&');
        const body = await this.request(`${league.path}/scoreboard${params ? `?${params}` : ''}`);
        const meta = scoreboardSchema.parse(body);
        const entry = {
            games: parseScoreboard(body, league),
            fetchedAt: this.clock(),
            usedAt: this.clock(),
            generation,
            week: meta.week?.number,
            seasonType: meta.season?.type,
        };
        this.scoreboards.set(key, entry);
        return entry;
    }

    async league(league: LeagueSource, daysBack = 3): Promise<Game[]> {
        const back = Math.min(Math.max(Math.trunc(daysBack), 1), maxDaysBack);
        const pages: ScoreboardEntry[] = [];
        if (league.byWeek) {
            const current = await this.page(league, '', true, false);
            pages.push(current);
            if (current.week && current.seasonType) {
                const weeksBack = Math.ceil(back / 7);
                for (let week = current.week - weeksBack; week <= current.week + 1; week++) {
                    if (week < 1 || week === current.week) continue;
                    const query = `week=${week}&seasontype=${current.seasonType}`;
                    pages.push(await this.page(league, query, false, week < current.week));
                }
            }
        } else {
            const days = scoreboardDays(this.clock(), back, 7);
            const today = days[back];
            for (const day of days) {
                pages.push(await this.page(league, `dates=${day}`, day === today, day < today));
            }
        }
        // Drop pages nobody has asked for in a day, so a smaller window setting frees memory later.
        const now = this.clock();
        for (const [key, entry] of this.scoreboards) {
            if (now - entry.usedAt > 24 * 60 * 60_000) this.scoreboards.delete(key);
        }
        return [...new Map(pages.flatMap((entry) => entry.games).map((game) => [game.id, game])).values()];
    }
}
