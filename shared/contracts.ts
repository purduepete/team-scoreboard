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
    status: 'upcoming' | 'live' | 'final' | 'postponed' | 'canceled' | 'unknown';
    statusLabel: string;
    sourceUrl: string;
    week?: number;
    broadcast?: string;
    homeRecord?: string;
    awayRecord?: string;
    // Live only: football down and distance or baseball outs, bases and count.
    situation?: string;
    possession?: 'home' | 'away';
    // 'schedule' marks a team-schedule copy; league scoreboard copies (and older cached ones) leave it unset.
    origin?: 'scoreboard' | 'schedule';
}

export interface Feed {
    id: string;
    label: string;
    note: string;
    officialUrl: string;
    available: boolean;
    purdue?: boolean;
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
    liveAvailable: boolean;
    notice: string;
}
