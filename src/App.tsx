import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUpRight, CalendarDays, Check, Plus, RefreshCw, Star, Trophy, X } from 'lucide-react';
import type { Dashboard } from '../shared/contracts';
import { SelectField } from './SelectField';
import { useTheme } from './theme';
import type { Theme } from './theme';
import { formatStart, formatTime, groupGames, isFavorite, visibleGames } from './games';
import type { Grouping, View } from './games';

async function request<T>(path: string, init?: RequestInit, timeoutMs = 15_000): Promise<T> {
    const response = await fetch(path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
        throw new Error(
            response.status === 503
                ? 'The server could not access saved favorites. Check the database connection and schema.'
                : `Request failed (${response.status}). Your changes may not have been saved.`
        );
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
}

const dayOptions = ['1', '3', '7', '14'];

// A per-device display preference kept in localStorage; unknown stored values fall back to the default.
function useStoredSetting<T extends string>(key: string, fallback: T, allowed: string[]) {
    const [value, setValue] = useState<T>(() => {
        try {
            const stored = localStorage.getItem(key);
            return stored && allowed.includes(stored) ? (stored as T) : fallback;
        } catch {
            return fallback;
        }
    });
    const update = (next: string) => {
        if (!allowed.includes(next)) return;
        setValue(next as T);
        try {
            localStorage.setItem(key, next);
        } catch {
            // Private browsing can block storage; the choice still applies for this visit.
        }
    };
    return [value, update] as const;
}

export function App() {
    const { theme, setTheme } = useTheme();
    const [data, setData] = useState<Dashboard | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [view, setView] = useState<View>('upcoming');
    const [team, setTeam] = useState('all');
    const [grouping, setGrouping] = useStoredSetting<Grouping>('team-scoreboard-grouping', 'day', ['day', 'week']);
    const [days, setDays] = useStoredSetting('team-scoreboard-days', '3', dayOptions);
    const [refreshing, setRefreshing] = useState(false);
    const [editing, setEditing] = useState(false);
    const [search, setSearch] = useState('');
    const version = useRef(0);
    const mounted = useRef(true);
    const daysRef = useRef(days);
    daysRef.current = days;
    const refresh = useCallback(async () => {
        const current = ++version.current;
        try {
            const next = await request<Dashboard>(`/api/dashboard?days=${daysRef.current}`);
            if (current === version.current && mounted.current) {
                setData(next);
                setError(null);
            }
        } catch (failure) {
            if (current === version.current && mounted.current) {
                setError(failure instanceof Error ? failure.message : 'Could not load Team Scoreboard.');
            }
        } finally {
            if (mounted.current) setLoading(false);
        }
    }, []);
    useEffect(() => {
        mounted.current = true;
        const timer = setInterval(() => {
            if (!document.hidden) void refresh();
        }, 20_000);
        const visible = () => {
            if (!document.hidden) void refresh();
        };
        document.addEventListener('visibilitychange', visible);
        return () => {
            mounted.current = false;
            clearInterval(timer);
            document.removeEventListener('visibilitychange', visible);
        };
    }, [refresh]);
    useEffect(() => {
        void refresh();
    }, [days, refresh]);

    const forceRefresh = async () => {
        setRefreshing(true);
        try {
            await request<void>(
                '/api/refresh',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ days: Number(days) }),
                },
                30_000
            );
            await refresh();
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not refresh scores.');
        } finally {
            if (mounted.current) setRefreshing(false);
        }
    };

    const changeFavorite = async (id: string, remove: boolean) => {
        setSaving(true);
        ++version.current;
        try {
            await request<void>(remove ? `/api/favorites/${encodeURIComponent(id)}` : '/api/favorites', {
                method: remove ? 'DELETE' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: remove ? '{}' : JSON.stringify({ teamId: id }),
            });
            setTeam('all');
            await refresh();
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not save favorite.');
        } finally {
            setSaving(false);
        }
    };
    const favoriteTeams = data?.teams.filter((item) => data.favorites.includes(item.id)) ?? [];
    const purdueIds = data?.teams.filter((item) => item.purdue && !item.umbrella).map((item) => item.id) ?? [];
    const favoriteIds = [...(data?.favorites ?? []), ...(data?.favorites.includes('purdue-all') ? purdueIds : [])];
    const feeds = data?.feeds ?? [];
    const games = visibleGames(
        feeds.flatMap((feed) => feed.games),
        view,
        team,
        favoriteIds
    );
    const groups = groupGames(games, view, grouping, favoriteIds);
    const updated = feeds
        .map((feed) => feed.updatedAt)
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return (
        <>
            <header>
                <div className="header-inner">
                    <a className="brand" href="/" aria-label="Team Scoreboard home">
                        <Trophy size={22} aria-hidden="true" />
                        <span>Team Scoreboard</span>
                    </a>
                    <SelectField
                        label="Theme"
                        value={theme}
                        onChange={(value) => setTheme(value as Theme)}
                        options={[
                            { value: 'midnight', label: 'Midnight' },
                            { value: 'light', label: 'Light' },
                            { value: 'system', label: 'System' },
                        ]}
                    />
                </div>
            </header>
            <main>
                <section className="page-heading">
                    <div>
                        <p className="eyebrow">YOUR TEAMS. ONE PAGE.</p>
                        <h1>Game day, at a glance</h1>
                        <p className="muted">Schedules and results · Times local to {timeZone}</p>
                    </div>
                    <button type="button" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>
                        <Plus size={16} aria-hidden="true" /> Edit favorites
                    </button>
                </section>
                {error && (
                    <div className="notice error" role="alert">
                        <AlertCircle size={18} aria-hidden="true" />
                        <div>
                            {error} {data && 'Previously loaded data is shown and may be out of date.'}
                        </div>
                        <button type="button" onClick={() => void refresh()}>
                            Retry
                        </button>
                    </div>
                )}
                {loading && <p role="status">Loading saved favorites…</p>}
                {data && (
                    <>
                        <div className="notice">
                            <CalendarDays size={18} aria-hidden="true" />
                            <p>{data.notice}</p>
                        </div>
                        <section className="favorites-strip" aria-label="Your favorite teams">
                            {favoriteTeams.map((item) => (
                                <span className="tag" key={item.id}>
                                    {item.name}
                                </span>
                            ))}
                            {!favoriteTeams.length && <p>No favorites yet. Add a team below.</p>}
                        </section>
                        {editing && (
                            <section className="panel" aria-label="Edit favorite teams">
                                <div className="section-heading">
                                    <div>
                                        <h2>Your favorites</h2>
                                        <p className="muted">
                                            Shared across your devices. Choose from the supported catalog.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setEditing(false)}
                                        aria-label="Close favorites editor"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                                <label htmlFor="team-search">Find a team or sport</label>
                                <input
                                    id="team-search"
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Try Purdue, Pacers, or NFL"
                                />
                                <div className="team-grid">
                                    {data.teams
                                        .filter((item) =>
                                            `${item.name} ${item.sport} ${item.league}`
                                                .toLowerCase()
                                                .includes(search.toLowerCase())
                                        )
                                        .map((item) => {
                                            const selected = data.favorites.includes(item.id);
                                            return (
                                                <button
                                                    className={`team-choice ${selected ? 'selected' : ''}`}
                                                    type="button"
                                                    key={item.id}
                                                    disabled={saving}
                                                    onClick={() => void changeFavorite(item.id, selected)}
                                                    aria-label={`${selected ? 'Remove' : 'Add'} ${item.name}`}
                                                >
                                                    <span>
                                                        <strong>{item.name}</strong>
                                                        <small>
                                                            {item.league} · {item.sport}
                                                        </small>
                                                    </span>
                                                    {selected ? <Check size={18} /> : <Plus size={18} />}
                                                </button>
                                            );
                                        })}
                                </div>
                                {saving && <p role="status">Saving favorites…</p>}
                            </section>
                        )}
                        <section className="panel">
                            <div className="toolbar">
                                <div className="tabs" role="group" aria-label="Schedule view">
                                    {(['upcoming', 'recent', 'live'] as View[]).map((item) => (
                                        <button
                                            type="button"
                                            key={item}
                                            aria-pressed={view === item}
                                            className={view === item ? 'selected' : ''}
                                            onClick={() => setView(item)}
                                        >
                                            {item === 'recent'
                                                ? 'Recent results'
                                                : item.charAt(0).toUpperCase() + item.slice(1)}
                                        </button>
                                    ))}
                                </div>
                                <div className="refresh">
                                    {updated && (
                                        <small className="muted">
                                            Updated{' '}
                                            {new Date(updated).toLocaleTimeString(undefined, {
                                                hour: 'numeric',
                                                minute: '2-digit',
                                            })}
                                        </small>
                                    )}
                                    <button type="button" onClick={() => void forceRefresh()} disabled={refreshing}>
                                        <RefreshCw size={16} aria-hidden="true" className={refreshing ? 'spin' : ''} />
                                        {refreshing ? 'Refreshing…' : 'Refresh'}
                                    </button>
                                </div>
                            </div>
                            <div className="filters">
                                <SelectField
                                    label="Show"
                                    value={team}
                                    onChange={setTeam}
                                    options={[
                                        { value: 'all', label: 'All teams' },
                                        { value: 'favorites', label: 'Favorites' },
                                        { value: 'league:NFL', label: 'NFL' },
                                        { value: 'league:NBA', label: 'NBA' },
                                        { value: 'league:MLB', label: 'MLB' },
                                        { value: 'league:NCAA', label: 'Purdue' },
                                        ...favoriteTeams
                                            .filter((item) => !item.umbrella)
                                            .map((item) => ({ value: item.id, label: item.name })),
                                    ]}
                                />
                                <SelectField
                                    label="Group by"
                                    value={grouping}
                                    onChange={setGrouping}
                                    options={[
                                        { value: 'day', label: 'Day' },
                                        { value: 'week', label: 'Week' },
                                    ]}
                                />
                                <SelectField
                                    label="Results"
                                    value={days}
                                    onChange={setDays}
                                    options={dayOptions.map((item) => ({
                                        value: item,
                                        label: item === '1' ? 'Last day' : `Last ${item} days`,
                                    }))}
                                />
                            </div>
                            {groups.map((group) => (
                                <section className="game-group" key={group.key} aria-label={group.label}>
                                    <h2 className="group-heading">
                                        <CalendarDays size={18} aria-hidden="true" />
                                        <span>{group.label}</span>
                                        <small>
                                            {group.games.length} {group.games.length === 1 ? 'game' : 'games'}
                                        </small>
                                    </h2>
                                    <div className="games">
                                        {group.games.map((game) => {
                                            const favorite = isFavorite(game, favoriteIds);
                                            return (
                                                <article className={`game${favorite ? ' favorite' : ''}`} key={game.id}>
                                                    <div className="game-meta">
                                                        <span>
                                                            {favorite && (
                                                                <Star
                                                                    size={12}
                                                                    aria-label="Favorite"
                                                                    className="star"
                                                                />
                                                            )}
                                                            {game.league} · {game.sport}
                                                            {game.week ? ` · Week ${game.week}` : ''}
                                                        </span>
                                                        <span className={game.status === 'live' ? 'live-label' : ''}>
                                                            {game.statusLabel}
                                                        </span>
                                                    </div>
                                                    {game.home && game.away ? (
                                                        <div className="score-lines">
                                                            <div>
                                                                <span>
                                                                    {game.away} <small>AWAY</small>
                                                                </span>
                                                                <strong>{game.awayScore ?? '—'}</strong>
                                                            </div>
                                                            <div>
                                                                <span>
                                                                    {game.home} <small>HOME</small>
                                                                </span>
                                                                <strong>{game.homeScore ?? '—'}</strong>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <h3>{game.title}</h3>
                                                    )}
                                                    <div className="game-footer">
                                                        <time dateTime={game.startTime ?? game.date ?? undefined}>
                                                            {grouping === 'day' ? formatTime(game) : formatStart(game)}
                                                        </time>
                                                        <a href={game.sourceUrl} target="_blank" rel="noreferrer">
                                                            Source <ArrowUpRight size={14} />
                                                        </a>
                                                    </div>
                                                </article>
                                            );
                                        })}
                                    </div>
                                </section>
                            ))}
                            {!games.length &&
                                (view === 'live' ? (
                                    <div className="empty-state">
                                        <Trophy size={28} />
                                        <h2>No games in progress</h2>
                                        <p>Live scores appear here while any game you can show is being played.</p>
                                    </div>
                                ) : (
                                    <div className="empty-state">
                                        <CalendarDays size={28} />
                                        <h2>No {view === 'recent' ? 'final results' : 'upcoming games'} returned</h2>
                                        <p>
                                            Some feeds may still be refreshing, and off-season sports have no games. See
                                            source status below.
                                        </p>
                                    </div>
                                ))}
                        </section>
                        <section className="panel">
                            <h2>Coverage and source status</h2>
                            <p className="muted">
                                Live scores refresh every 5 minutes. Finished days stay cached. Purdue programs without
                                an ESPN feed link to the official schedule.
                            </p>
                            <div className="coverage">
                                {feeds.map((feed) => (
                                    <article key={feed.id} className="coverage-row">
                                        <div>
                                            <h3>{feed.label}</h3>
                                            <p>{feed.note}</p>
                                            {feed.error && (
                                                <p className="error-text" role="status">
                                                    {feed.error}
                                                </p>
                                            )}
                                        </div>
                                        <div className="source-status">
                                            <span className="status">
                                                {!feed.available
                                                    ? 'Official link only'
                                                    : feed.pending
                                                      ? 'Refreshing…'
                                                      : feed.error
                                                        ? feed.stale
                                                            ? 'Stale data'
                                                            : 'Feed error'
                                                        : feed.updatedAt
                                                          ? 'Fetched'
                                                          : 'Not fetched'}
                                            </span>
                                            {feed.updatedAt && (
                                                <small>
                                                    Last successful fetch:{' '}
                                                    {new Date(feed.updatedAt).toLocaleString(undefined, {
                                                        timeZoneName: 'short',
                                                    })}
                                                </small>
                                            )}
                                            <a href={feed.officialUrl} target="_blank" rel="noreferrer">
                                                {feed.purdue ? 'Official schedule' : 'ESPN scoreboard'}{' '}
                                                <ArrowUpRight size={14} />
                                            </a>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </section>
                    </>
                )}
                <footer>
                    Data from{' '}
                    <a href="https://www.espn.com" target="_blank" rel="noreferrer">
                        ESPN
                    </a>
                    . Coverage and game times may change. No affiliation with the teams or leagues.
                </footer>
            </main>
        </>
    );
}
