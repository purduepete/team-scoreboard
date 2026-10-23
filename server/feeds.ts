import type { Feed, Game, Team } from '../shared/contracts.js';
import { ProviderError } from './provider.js';

interface CacheEntry {
    feed: Feed;
    nextAttempt: number;
    pending: Promise<void> | null;
    failures: number;
}

export class FeedCache {
    private readonly entries = new Map<string, CacheEntry>();

    constructor(
        private readonly load: (team: Team) => Promise<Game[]>,
        private readonly clock: () => number = Date.now,
        private readonly report: (error: unknown) => void = (error) =>
            console.error('Sports feed refresh failed:', error)
    ) {}

    get(team: Team): Feed {
        if (!team.providerId) {
            return { teamId: team.id, games: [], updatedAt: null, stale: false, error: null, pending: false };
        }
        let entry = this.entries.get(team.id);
        if (!entry) {
            entry = {
                feed: { teamId: team.id, games: [], updatedAt: null, stale: false, error: null, pending: true },
                nextAttempt: 0,
                pending: null,
                failures: 0,
            };
            this.entries.set(team.id, entry);
        }
        const current = entry;
        if (this.clock() >= current.nextAttempt && !current.pending) {
            current.feed = { ...current.feed, pending: true, stale: current.feed.updatedAt !== null };
            current.pending = this.load(team)
                .then((games) => {
                    current.feed = {
                        teamId: team.id,
                        games,
                        updatedAt: new Date(this.clock()).toISOString(),
                        stale: false,
                        error: null,
                        pending: false,
                    };
                    current.failures = 0;
                    current.nextAttempt = this.clock() + 15 * 60_000;
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
        }
        return { ...current.feed, games: [...current.feed.games] };
    }

    async settle(): Promise<void> {
        await Promise.all([...this.entries.values()].map((entry) => entry.pending));
    }
}
