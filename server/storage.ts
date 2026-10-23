import type { Pool } from 'pg';

export interface FavoritesStore {
    list(): Promise<string[]>;
    add(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    ready(): Promise<void>;
}

export class PostgresFavorites implements FavoritesStore {
    constructor(private readonly pool: Pool) {}

    async list(): Promise<string[]> {
        const result = await this.pool.query<{ team_id: string }>(
            'SELECT team_id FROM public.favorites ORDER BY added_at, team_id'
        );
        return result.rows.map((row) => row.team_id);
    }

    async add(id: string): Promise<void> {
        await this.pool.query('INSERT INTO public.favorites(team_id) VALUES ($1) ON CONFLICT (team_id) DO NOTHING', [
            id,
        ]);
    }

    async remove(id: string): Promise<void> {
        await this.pool.query('DELETE FROM public.favorites WHERE team_id = $1', [id]);
    }

    async ready(): Promise<void> {
        const result = await this.pool.query<{ version: number }>(
            "SELECT version FROM public.solutiondeploy_schema WHERE app_id = 'team-scoreboard'"
        );
        if (result.rows[0]?.version !== 1) throw new Error('Team Scoreboard schema version is not 1.');
        await this.pool.query('SELECT team_id FROM public.favorites LIMIT 1');
    }
}
