import { z } from 'zod';
import type { SearchTeam, TeamCategory } from '../shared/contracts.js';
import { teams } from './catalog.js';
import { ProviderError } from './provider.js';

export const categorySchema = z.enum(['college-football', 'college-basketball']);
export const searchQuerySchema = z
    .object({
        sport: categorySchema,
        q: z.string().trim().min(2).max(80),
    })
    .strict();
export const addedTeamQuerySchema = z
    .object({
        sport: categorySchema,
        id: z.string().regex(/^[1-9]\d{0,9}$/),
    })
    .strict();

export interface DirectoryResult {
    teams: SearchTeam[];
    stale: boolean;
    error: string | null;
}

interface DirectoryEntry {
    teams: SearchTeam[];
    loaded: boolean;
    nextAttempt: number;
    pending: Promise<void> | null;
    failures: number;
    error: string | null;
}

export class TeamSearch {
    private readonly directories = new Map<TeamCategory, DirectoryEntry>();

    constructor(
        private readonly load: (category: TeamCategory) => Promise<SearchTeam[]>,
        private readonly clock: () => number = Date.now,
        private readonly report: (error: unknown) => void = (error) =>
            console.error('Team directory refresh failed:', error)
    ) {}

    async directory(category: TeamCategory): Promise<DirectoryResult> {
        let entry = this.directories.get(category);
        if (!entry) {
            entry = { teams: [], loaded: false, nextAttempt: 0, pending: null, failures: 0, error: null };
            this.directories.set(category, entry);
        }
        const current = entry;
        if (!current.pending && this.clock() >= current.nextAttempt) {
            current.pending = Promise.resolve()
                .then(() => this.load(category))
                .then((result) => {
                    current.teams = result.map((team) => {
                        const known = teams.find((entry) => entry.providerId === team.providerId);
                        return known ? { ...team, id: known.id, ...(known.purdue ? { purdue: true } : {}) } : team;
                    });
                    current.loaded = true;
                    current.error = null;
                    current.failures = 0;
                    current.nextAttempt = this.clock() + 24 * 60 * 60_000;
                })
                .catch((error: unknown) => {
                    this.report(error);
                    current.failures++;
                    current.error =
                        error instanceof ProviderError
                            ? error.message
                            : `Could not refresh the ${category} team directory. Please retry later.`;
                    current.nextAttempt =
                        this.clock() +
                        Math.max(
                            error instanceof ProviderError ? error.retryAfterMs : 0,
                            Math.min(15 * 60_000, 60_000 * 2 ** current.failures)
                        );
                })
                .finally(() => {
                    current.pending = null;
                });
        }
        if (current.pending) await current.pending;
        return { teams: [...current.teams], stale: current.loaded && current.error !== null, error: current.error };
    }

    async search(category: TeamCategory, query: string): Promise<DirectoryResult> {
        const result = await this.directory(category);
        return {
            ...result,
            teams: result.teams
                .filter((team) => team.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
                .sort((a, b) => a.name.localeCompare(b.name))
                .slice(0, 20),
        };
    }
}
