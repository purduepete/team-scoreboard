import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUpRight, CalendarDays, Check, Plus, RefreshCw, Trophy, X } from 'lucide-react';
import type { Dashboard } from '../shared/contracts';
import { SelectField } from './SelectField';
import { useTheme } from './theme';
import type { Theme } from './theme';
import { formatStart, visibleGames } from './games';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, { ...init, signal: AbortSignal.timeout(15_000) });
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

export function App() {
    const { theme, setTheme } = useTheme();
    const [data, setData] = useState<Dashboard | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [view, setView] = useState('upcoming');
    const [team, setTeam] = useState('all');
    const [sport, setSport] = useState('all');
    const [editing, setEditing] = useState(false);
    const [search, setSearch] = useState('');
    const version = useRef(0);
    const mounted = useRef(true);
    const refresh = useCallback(async () => {
        const current = ++version.current;
        try {
            const next = await request<Dashboard>('/api/dashboard');
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
        void refresh();
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
            setSport('all');
            await refresh();
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not save favorite.');
        } finally {
            setSaving(false);
        }
    };
    const favoriteTeams = data?.teams.filter((item) => data.favorites.includes(item.id)) ?? [];
    const purdueIds = data?.teams.filter((item) => item.purdue && !item.umbrella).map((item) => item.id) ?? [];
    const feeds = data?.feeds ?? [];
    const activeIds = new Set(feeds.map((feed) => feed.teamId));
    const coveredTeams = data?.teams.filter((item) => activeIds.has(item.id)) ?? [];
    const games = visibleGames(
        feeds.flatMap((feed) => feed.games),
        view,
        team,
        sport,
        purdueIds
    );
    const availableSports = [...new Set(coveredTeams.map((item) => item.sport))].sort();
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
                                    {['upcoming', 'recent', 'live'].map((item) => (
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
                                <button type="button" onClick={() => void refresh()}>
                                    <RefreshCw size={16} aria-hidden="true" /> Refresh
                                </button>
                            </div>
                            <div className="filters">
                                <SelectField
                                    label="Team"
                                    value={team}
                                    onChange={setTeam}
                                    options={[
                                        { value: 'all', label: 'All favorites' },
                                        ...favoriteTeams.map((item) => ({ value: item.id, label: item.name })),
                                    ]}
                                />
                                <SelectField
                                    label="Sport"
                                    value={sport}
                                    onChange={setSport}
                                    options={[
                                        { value: 'all', label: 'All sports' },
                                        ...availableSports.map((item) => ({ value: item, label: item })),
                                    ]}
                                />
                            </div>
                            {view === 'live' ? (
                                <div className="empty-state">
                                    <Trophy size={28} />
                                    <h2>Live scores aren’t included</h2>
                                    <p>
                                        This version uses free schedules and final results. Open a team’s official
                                        schedule below for other coverage.
                                    </p>
                                </div>
                            ) : (
                                <div className="games">
                                    {games.map((game) => (
                                        <article className="game" key={game.id}>
                                            <div className="game-meta">
                                                <span>
                                                    {game.league} · {game.sport}
                                                </span>
                                                <span>{game.statusLabel}</span>
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
                                                    {formatStart(game)}
                                                </time>
                                                <a href={game.sourceUrl} target="_blank" rel="noreferrer">
                                                    Source <ArrowUpRight size={14} />
                                                </a>
                                            </div>
                                        </article>
                                    ))}
                                    {!games.length && (
                                        <div className="empty-state">
                                            <CalendarDays size={28} />
                                            <h2>
                                                No {view === 'recent' ? 'final results' : 'schedule entries'} returned
                                            </h2>
                                            <p>
                                                Some feeds may still be refreshing. Free feed limits and unsupported
                                                sports can leave gaps. See source status below.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </section>
                        <section className="panel">
                            <h2>Coverage and source status</h2>
                            <p className="muted">
                                Purdue All Varsity includes programs without a configured feed. Official schedules
                                remain available.
                            </p>
                            <div className="coverage">
                                {coveredTeams.map((item) => {
                                    const feed = feeds.find((entry) => entry.teamId === item.id);
                                    return (
                                        <article key={item.id} className="coverage-row">
                                            <div>
                                                <h3>{item.name}</h3>
                                                <p>{item.coverageNote}</p>
                                                {feed?.error && (
                                                    <p className="error-text" role="status">
                                                        {feed.error}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="source-status">
                                                <span className="status">
                                                    {item.coverage === 'unavailable'
                                                        ? 'Official link only'
                                                        : feed?.pending
                                                          ? 'Refreshing…'
                                                          : feed?.error
                                                            ? feed.stale
                                                                ? 'Stale data'
                                                                : 'Feed error'
                                                            : feed?.updatedAt
                                                              ? 'Fetched'
                                                              : 'Not fetched'}
                                                </span>
                                                {feed?.updatedAt && (
                                                    <small>
                                                        Last successful fetch:{' '}
                                                        {new Date(feed.updatedAt).toLocaleString(undefined, {
                                                            timeZoneName: 'short',
                                                        })}
                                                    </small>
                                                )}
                                                <a href={item.officialUrl} target="_blank" rel="noreferrer">
                                                    {item.purdue ? 'Official schedule' : 'Team source'}{' '}
                                                    <ArrowUpRight size={14} />
                                                </a>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        </section>
                    </>
                )}
                <footer>
                    Data from{' '}
                    <a href="https://www.thesportsdb.com" target="_blank" rel="noreferrer">
                        TheSportsDB
                    </a>
                    . Coverage and game times may change. No affiliation with the teams or leagues.
                </footer>
            </main>
        </>
    );
}
