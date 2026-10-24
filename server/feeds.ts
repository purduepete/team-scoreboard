import type { Feed, Game } from '../shared/contracts.js';
import { isHot, liveRefreshMs, ProviderError } from './provider.js';

export interface FeedSource {
    id: string;
    label: string;
    note: string;
    officialUrl: string;
    purdue?: boolean;
    load?: () => Promise<Game[]>;
    // Milliseconds until the next refresh after a successful load.
    interval?: (games: Game[], now: number) => number;
}

interface CacheEntry {
    feed: Omit<Feed, 'label' | 'note' | 'officialUrl' | 'available' | 'purdue'>;
    nextAttempt: number;
    pending: Promise<void> | null;
    failures: number;
}

export const hotInterval = (games: Game[], now: number) => (isHot(games, now) ? liveRefreshMs : 15 * 60_000);

export class FeedCache {
    private readonly entries = new Map<string, CacheEntry>();

    constructor(
        private readonly clock: () => number = Date.now,
        private readonly report: (error: unknown) => void = (error) =>
            console.error('Sports feed refresh failed:', error)
    ) {}

    get(source: FeedSource): Feed {
        const details = {
            id: source.id,
            label: source.label,
            note: source.note,
            officialUrl: source.officialUrl,
            available: Boolean(source.load),
            ...(source.purdue ? { purdue: true } : {}),
        };
        if (!source.load) return { ...details, games: [], updatedAt: null, stale: false, error: null, pending: false };
        this.load(source);
        const current = this.entries.get(source.id)!;
        return { ...details, ...current.feed, games: [...current.feed.games] };
    }

    // Starts a refetch when the feed is due and returns it; null when nothing new started (not due,
    // already loading, or no feed).
    load(source: FeedSource): Promise<void> | null {
        const load = source.load;
        if (!load) return null;
        let entry = this.entries.get(source.id);
        if (!entry) {
            entry = {
                feed: { id: source.id, games: [], updatedAt: null, stale: false, error: null, pending: true },
                nextAttempt: 0,
                pending: null,
                failures: 0,
            };
            this.entries.set(source.id, entry);
        }
        const current = entry;
        if (this.clock() < current.nextAttempt || current.pending) return null;
        current.feed = { ...current.feed, pending: true, stale: current.feed.updatedAt !== null };
        const pending = load()
            .then((games) => {
                const now = this.clock();
                current.feed = {
                    id: source.id,
                    games,
                    updatedAt: new Date(now).toISOString(),
                    stale: false,
                    error: null,
                    pending: false,
                };
                current.failures = 0;
                current.nextAttempt = now + (source.interval ?? hotInterval)(games, now);
            })
            .catch((error: unknown) => {
                this.report(error);
                current.failures++;
                current.nextAttempt =
                    this.clock() +
                    Math.max(
                        error instanceof ProviderError ? error.retryAfterMs : 0,
                        Math.min(15 * 60_000, 60_000 * 2 ** current.failures)
                    );
                current.feed = {
                    ...current.feed,
                    pending: false,
                    stale: current.feed.updatedAt !== null,
                    error:
                        error instanceof ProviderError
                            ? error.message
                            : 'Could not refresh this feed. Previously fetched results may be out of date.',
                };
            })
            .finally(() => {
                current.pending = null;
            });
        current.pending = pending;
        return pending;
    }

    // Makes matching feeds due now (all by default); entries already loading keep their pending request.
    invalidate(match: (id: string, games: Game[]) => boolean = () => true): void {
        for (const [id, entry] of this.entries) if (match(id, entry.feed.games)) entry.nextAttempt = 0;
    }

    async settle(): Promise<void> {
        await Promise.all([...this.entries.values()].map((entry) => entry.pending));
    }
}
