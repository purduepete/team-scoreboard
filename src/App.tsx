import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Activity,
    AlertCircle,
    ArrowLeft,
    ArrowUpRight,
    CalendarDays,
    Check,
    ChevronRight,
    ChevronsDownUp,
    ChevronsUpDown,
    Keyboard,
    Plus,
    RefreshCw,
    Star,
    Trophy,
    Tv,
    X,
} from 'lucide-react';
import type { Dashboard } from '../shared/contracts';
import { reconcile } from '../shared/reconcile';
import { CalendarMenu } from './CalendarMenu';
import { SelectField } from './SelectField';
import { useTheme } from './theme';
import type { Theme } from './theme';
import { formatTime, groupGames, isFavorite, resultDays, visibleGames } from './games';
import type { View } from './games';

const viewLabels: Record<View, string> = { live: 'Current', recent: 'Recent', upcoming: 'Upcoming' };

const shortcutHelp: [string[], string][] = [
    [['1'], 'Current'],
    [['2'], 'Recent'],
    [['3'], 'Upcoming'],
    [['X'], 'Expand all sections'],
    [['C'], 'Collapse all sections'],
    [['R'], 'Refresh live scores'],
    [['?'], 'Show or hide this help'],
    [['Esc'], 'Close this help'],
];

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

export function App() {
    const { theme, setTheme } = useTheme();
    const [data, setData] = useState<Dashboard | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [view, setView] = useState<View>('live');
    const [team, setTeam] = useState('all');
    // League sections start collapsed on every page load.
    // Open/closed state for the current Show filter: a base (all open or all closed) plus the sections
    // flipped from it. Changing the filter resets it, so All teams starts collapsed and others open.
    const [toggled, setToggled] = useState<{ filter: string; open: boolean; keys: string[] }>({
        filter: 'all',
        open: false,
        keys: [],
    });
    const [refreshing, setRefreshing] = useState(false);
    const [help, setHelp] = useState(false);
    const [editing, setEditing] = useState(false);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(() => (location.hash === '#status' ? 'status' : 'scores'));
    const statusPage = page === 'status';
    const [calendarUrl, setCalendarUrl] = useState<string | null>(null);
    // Score cells that changed on the last poll, keyed `${id}:home|away`, with a stamp to restart the animation.
    const [flashes, setFlashes] = useState<Record<string, number>>({});
    const scores = useRef(new Map<string, { home: number | null; away: number | null }>());
    const version = useRef(0);
    const mounted = useRef(true);
    const refresh = useCallback(async (full = false, baseline = false) => {
        // A full refetch does not claim a new version, so the cached response that started first still renders.
        const current = full ? version.current : ++version.current;
        try {
            const next = full
                ? await request<Dashboard>(`/api/dashboard?days=${resultDays}&refresh=all`, undefined, 30_000)
                : await request<Dashboard>(`/api/dashboard?days=${resultDays}`);
            if (current === version.current && mounted.current) {
                const best = reconcile(next.feeds.flatMap((feed) => feed.games));
                const changed: Record<string, number> = {};
                const stamp = Date.now();
                for (const game of best.values()) {
                    const previous = scores.current.get(game.id);
                    // Startup loads only set the baseline; a change needs a number on both sides, so no score
                    // to 0-0 never flashes.
                    if (!baseline && previous) {
                        for (const side of ['home', 'away'] as const) {
                            const before = previous[side];
                            const after = side === 'home' ? game.homeScore : game.awayScore;
                            if (typeof before === 'number' && typeof after === 'number' && before !== after)
                                changed[`${game.id}:${side}`] = stamp;
                        }
                    }
                    scores.current.set(game.id, { home: game.homeScore, away: game.awayScore });
                }
                if (Object.keys(changed).length) {
                    setFlashes((existing) => ({ ...existing, ...changed }));
                    setTimeout(() => {
                        if (!mounted.current) return;
                        setFlashes((existing) =>
                            Object.fromEntries(Object.entries(existing).filter(([, value]) => value !== stamp))
                        );
                    }, 2500);
                }
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
        void refresh(false, true);
    }, [refresh]);
    useEffect(() => {
        request<{ url: string }>('/api/calendar')
            .then((body) => {
                if (mounted.current && /^https:\/\//.test(body.url)) setCalendarUrl(body.url);
            })
            .catch(() => undefined);
    }, []);
    useEffect(() => {
        const onHash = () => setPage(location.hash === '#status' ? 'status' : 'scores');
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);

    // "live" (Refresh button) refetches games in progress.
    const forceRefresh = useCallback(
        async (scope: 'live') => {
            setRefreshing(true);
            try {
                await request<void>(
                    '/api/refresh',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ days: resultDays, scope }),
                    },
                    30_000
                );
                await refresh();
            } catch (failure) {
                setError(failure instanceof Error ? failure.message : 'Could not refresh scores.');
            } finally {
                if (mounted.current) setRefreshing(false);
            }
        },
        [refresh]
    );
    // Cached scores render first; the full refetch (a GET) replaces them when it finishes.
    const loaded = useRef(false);
    useEffect(() => {
        if (loaded.current) return;
        loaded.current = true;
        setRefreshing(true);
        void refresh(true, true).finally(() => {
            if (mounted.current) setRefreshing(false);
        });
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
    // One team or Purdue alone: every card would match, so skip favorite highlighting and ordering.
    const noHighlight =
        team === 'favorites' || team === 'league:NCAA' || !(team === 'all' || team.startsWith('league:'));
    const highlightIds = noHighlight ? [] : favoriteIds;
    const sections = groupGames(games, view, highlightIds);
    const current = toggled.filter === team ? toggled : { filter: team, open: team !== 'all', keys: [] };
    const isOpen = (key: string) => current.open !== current.keys.includes(key);
    const toggleSection = (key: string) =>
        setToggled({
            ...current,
            keys: current.keys.includes(key) ? current.keys.filter((item) => item !== key) : [...current.keys, key],
        });
    const setAllSections = (open: boolean) => setToggled({ filter: team, open, keys: [] });
    const allOpen = sections.every((section) => isOpen(section.key));
    const allClosed = sections.every((section) => !isOpen(section.key));
    const shortcut = useRef<(event: globalThis.KeyboardEvent) => void>(() => undefined);
    shortcut.current = (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
        if (help) {
            if (event.key === 'Escape' || event.key === '?') {
                event.preventDefault();
                setHelp(false);
            } else if (event.key === 'Tab') {
                event.preventDefault();
            }
            return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (document.querySelector('[role="listbox"], [role="menu"]')) return;
        const views: Record<string, View> = {
            Digit1: 'live',
            Numpad1: 'live',
            Digit2: 'recent',
            Numpad2: 'recent',
            Digit3: 'upcoming',
            Numpad3: 'upcoming',
        };
        const key = event.key.toLowerCase();
        if (key === '?') {
            setHelp(true);
        } else if (key === 'r') {
            if (!refreshing) void forceRefresh('live');
        } else if (statusPage) {
            return;
        } else if (views[event.code]) {
            setView(views[event.code]);
        } else if (key === 'x') {
            setAllSections(true);
        } else if (key === 'c') {
            setAllSections(false);
        } else {
            return;
        }
        event.preventDefault();
    };
    useEffect(() => {
        const onKey = (event: globalThis.KeyboardEvent) => shortcut.current(event);
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
    const helpClose = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!help) return;
        const previous = document.activeElement as HTMLElement | null;
        helpClose.current?.focus();
        return () => previous?.focus();
    }, [help]);
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
                    <div className="header-actions">
                        {updated && (
                            <small className="updated" title="Last updated">
                                <span className="updated-label">Updated </span>
                                {new Date(updated).toLocaleTimeString(undefined, {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hourCycle: 'h23',
                                })}
                            </small>
                        )}
                        <button
                            type="button"
                            className="refresh-button"
                            onClick={() => void forceRefresh('live')}
                            disabled={refreshing}
                            aria-label="Refresh"
                            aria-keyshortcuts="R"
                            title="Refresh live scores (R)"
                        >
                            <RefreshCw size={16} aria-hidden="true" className={refreshing ? 'spin' : ''} />
                            <span className="refresh-label">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
                        </button>
                        <a
                            className="header-link"
                            href={statusPage ? '#' : '#status'}
                            aria-label={statusPage ? 'Back to scores' : 'Source status'}
                            title={statusPage ? 'Back to scores' : 'Source status'}
                            aria-current={statusPage ? 'page' : undefined}
                        >
                            <Activity size={18} aria-hidden="true" />
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
                </div>
            </header>
            <main>
                {statusPage ? (
                    <section className="page-heading">
                        <h1>Source status</h1>
                        <a className="button-link" href="#">
                            <ArrowLeft size={16} aria-hidden="true" /> Back to scores
                        </a>
                    </section>
                ) : (
                    <section className="page-heading">
                        <h1>Game day, at a glance</h1>
                        <div className="heading-actions">
                            {calendarUrl && (
                                <CalendarMenu
                                    url={calendarUrl}
                                    onCopyError={() => setError('Could not copy the calendar link.')}
                                />
                            )}
                            <button type="button" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>
                                <Plus size={16} aria-hidden="true" /> Edit favorites
                            </button>
                        </div>
                    </section>
                )}
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
                        {!statusPage && editing && (
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
                        {!statusPage && (
                            <section className="panel">
                                <div className="toolbar">
                                    <div className="tabs" role="group" aria-label="Schedule view">
                                        {(['live', 'recent', 'upcoming'] as View[]).map((item, index) => (
                                            <button
                                                type="button"
                                                key={item}
                                                aria-pressed={view === item}
                                                aria-keyshortcuts={String(index + 1)}
                                                title={`${viewLabels[item]} (${index + 1})`}
                                                className={view === item ? 'selected' : ''}
                                                onClick={() => setView(item)}
                                            >
                                                {viewLabels[item]}
                                            </button>
                                        ))}
                                    </div>
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
                                            { value: 'league:Big Ten', label: 'Big Ten' },
                                            ...favoriteTeams
                                                .filter((item) => !item.umbrella)
                                                .map((item) => ({ value: item.id, label: item.name })),
                                        ]}
                                    />
                                </div>
                                {sections.length > 0 && (
                                    <div className="section-controls">
                                        <button
                                            type="button"
                                            disabled={allOpen}
                                            aria-keyshortcuts="X"
                                            title="Expand all (X)"
                                            onClick={() => setAllSections(true)}
                                        >
                                            <ChevronsUpDown size={16} aria-hidden="true" />
                                            Expand all
                                        </button>
                                        <button
                                            type="button"
                                            disabled={allClosed}
                                            aria-keyshortcuts="C"
                                            title="Collapse all (C)"
                                            onClick={() => setAllSections(false)}
                                        >
                                            <ChevronsDownUp size={16} aria-hidden="true" />
                                            Collapse all
                                        </button>
                                    </div>
                                )}
                                {sections.map((section) => {
                                    const open = isOpen(section.key);
                                    return (
                                        <section
                                            className="league-section"
                                            key={section.key}
                                            aria-label={section.label}
                                        >
                                            <h2 className="section-title">
                                                <button
                                                    type="button"
                                                    aria-expanded={open}
                                                    aria-controls={`section-${section.key}`}
                                                    onClick={() => toggleSection(section.key)}
                                                >
                                                    <ChevronRight
                                                        size={20}
                                                        aria-hidden="true"
                                                        className={open ? 'chevron open' : 'chevron'}
                                                    />
                                                    <span>{section.label}</span>
                                                    <small>
                                                        {section.count} {section.count === 1 ? 'game' : 'games'}
                                                    </small>
                                                </button>
                                            </h2>
                                            <div id={`section-${section.key}`} hidden={!open}>
                                                {section.days.map((group) => (
                                                    <section
                                                        className="game-group"
                                                        key={group.key}
                                                        aria-label={` · ${group.label}`}
                                                    >
                                                        <h3 className="group-heading">
                                                            <CalendarDays size={16} aria-hidden="true" />
                                                            <span>{group.label}</span>
                                                            <small>
                                                                {group.games.length}{' '}
                                                                {group.games.length === 1 ? 'game' : 'games'}
                                                            </small>
                                                        </h3>
                                                        <div className="games">
                                                            {group.games.map((game) => {
                                                                const favorite = isFavorite(game, highlightIds);
                                                                return (
                                                                    <article
                                                                        className={`game${favorite ? ' favorite' : ''}`}
                                                                        key={game.id}
                                                                    >
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
                                                                                {game.week
                                                                                    ? ` · Week ${game.week}`
                                                                                    : ''}
                                                                            </span>
                                                                            <span
                                                                                className={
                                                                                    game.status === 'live'
                                                                                        ? 'live-label'
                                                                                        : ''
                                                                                }
                                                                            >
                                                                                {game.statusLabel}
                                                                            </span>
                                                                        </div>
                                                                        {game.home && game.away ? (
                                                                            <div className="score-lines">
                                                                                <div>
                                                                                    <span>
                                                                                        {game.away}
                                                                                        {game.possession === 'away' && (
                                                                                            <span
                                                                                                className="possession"
                                                                                                role="img"
                                                                                                aria-label="Has possession"
                                                                                            />
                                                                                        )}
                                                                                        {game.awayRecord && (
                                                                                            <span className="record">
                                                                                                {' '}
                                                                                                ({game.awayRecord})
                                                                                            </span>
                                                                                        )}{' '}
                                                                                        <small>AWAY</small>
                                                                                    </span>
                                                                                    <strong
                                                                                        key={`away-${flashes[`${game.id}:away`] ?? 0}`}
                                                                                        className={
                                                                                            flashes[`${game.id}:away`]
                                                                                                ? 'score-changed'
                                                                                                : undefined
                                                                                        }
                                                                                    >
                                                                                        {game.awayScore ?? '—'}
                                                                                    </strong>
                                                                                </div>
                                                                                <div>
                                                                                    <span>
                                                                                        {game.home}
                                                                                        {game.possession === 'home' && (
                                                                                            <span
                                                                                                className="possession"
                                                                                                role="img"
                                                                                                aria-label="Has possession"
                                                                                            />
                                                                                        )}
                                                                                        {game.homeRecord && (
                                                                                            <span className="record">
                                                                                                {' '}
                                                                                                ({game.homeRecord})
                                                                                            </span>
                                                                                        )}{' '}
                                                                                        <small>HOME</small>
                                                                                    </span>
                                                                                    <strong
                                                                                        key={`home-${flashes[`${game.id}:home`] ?? 0}`}
                                                                                        className={
                                                                                            flashes[`${game.id}:home`]
                                                                                                ? 'score-changed'
                                                                                                : undefined
                                                                                        }
                                                                                    >
                                                                                        {game.homeScore ?? '—'}
                                                                                    </strong>
                                                                                </div>
                                                                                {game.status === 'live' &&
                                                                                    game.situation && (
                                                                                        <p className="situation">
                                                                                            {game.situation}
                                                                                        </p>
                                                                                    )}
                                                                            </div>
                                                                        ) : (
                                                                            <h4>{game.title}</h4>
                                                                        )}
                                                                        <div className="game-footer">
                                                                            <span className="when">
                                                                                <time
                                                                                    dateTime={
                                                                                        game.startTime ??
                                                                                        game.date ??
                                                                                        undefined
                                                                                    }
                                                                                >
                                                                                    {formatTime(game)}
                                                                                </time>
                                                                                {game.broadcast && (
                                                                                    <span className="broadcast">
                                                                                        <Tv
                                                                                            size={12}
                                                                                            aria-hidden="true"
                                                                                        />
                                                                                        {game.broadcast}
                                                                                    </span>
                                                                                )}
                                                                            </span>
                                                                            <a
                                                                                href={game.sourceUrl}
                                                                                target="_blank"
                                                                                rel="noreferrer"
                                                                            >
                                                                                Source <ArrowUpRight size={14} />
                                                                            </a>
                                                                        </div>
                                                                    </article>
                                                                );
                                                            })}
                                                        </div>
                                                    </section>
                                                ))}
                                            </div>
                                        </section>
                                    );
                                })}
                                {!games.length &&
                                    (view === 'live' ? (
                                        <div className="empty-state">
                                            <Trophy size={28} />
                                            <h2>No games today</h2>
                                            <p>
                                                Today's games, live scores and finals appear here. Check Upcoming for
                                                the next games.
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="empty-state">
                                            <CalendarDays size={28} />
                                            <h2>
                                                No {view === 'recent' ? 'final results' : 'upcoming games'} returned
                                            </h2>
                                            <p>
                                                Some feeds may still be refreshing, and off-season sports have no games.
                                                Check source status from the header.
                                            </p>
                                        </div>
                                    ))}
                            </section>
                        )}
                        {statusPage && (
                            <section className="panel">
                                <h2>Coverage</h2>
                                <p className="muted">
                                    {data.notice} Purdue programs without an ESPN feed link to the official schedule.
                                    Times are local to {timeZone}.
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
                                                            hourCycle: 'h23',
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
                        )}
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
            {help && (
                <div className="help-backdrop" onClick={() => setHelp(false)}>
                    <div
                        className="help-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="help-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="help-heading">
                            <h2 id="help-title">
                                <Keyboard size={18} aria-hidden="true" /> Keyboard shortcuts
                            </h2>
                            <button
                                ref={helpClose}
                                type="button"
                                className="icon-button"
                                onClick={() => setHelp(false)}
                                aria-label="Close"
                                title="Close (Esc)"
                            >
                                <X size={16} aria-hidden="true" />
                            </button>
                        </div>
                        <dl className="help-list">
                            {shortcutHelp.map(([keys, action]) => (
                                <div key={action}>
                                    <dt>
                                        {keys.map((key) => (
                                            <kbd key={key}>{key}</kbd>
                                        ))}
                                    </dt>
                                    <dd>{action}</dd>
                                </div>
                            ))}
                        </dl>
                        <p className="help-note">
                            Number keys work on the number row or numpad. Shortcuts pause while you type in a field or a
                            dropdown is open.
                        </p>
                    </div>
                </div>
            )}
        </>
    );
}
