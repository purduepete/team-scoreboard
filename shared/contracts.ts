export interface Team {
    id: string;
    name: string;
    sport: string;
    league: string;
    providerId?: string;
    officialUrl: string;
    coverage: 'schedule-results' | 'unavailable';
    coverageNote: string;
    purdue?: boolean;
    umbrella?: boolean;
}

export interface Game {
    id: string;
    teamIds: string[];
    sport: string;
    league: string;
    title: string;
    home: string | null;
    away: string | null;
    homeScore: number | null;
    awayScore: number | null;
    startTime: string | null;
    date: string | null;
    status: 'upcoming' | 'final' | 'postponed' | 'canceled' | 'unknown';
    statusLabel: string;
    sourceUrl: string;
}

export interface Feed {
    teamId: string;
    games: Game[];
    updatedAt: string | null;
    stale: boolean;
    error: string | null;
    pending?: boolean;
}

export interface Dashboard {
    favorites: string[];
    teams: Team[];
    feeds: Feed[];
    liveAvailable: false;
    notice: string;
}
