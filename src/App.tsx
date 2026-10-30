import { Children, useCallback, useEffect, useRef, useState } from 'react';
import {
    Activity,
    AlertCircle,
    ArrowUpRight,
    CalendarDays,
    Check,
    ChevronRight,
    ChevronsDownUp,
    ChevronsUpDown,
    Clock3,
    Keyboard,
    LoaderCircle,
    LayoutGrid,
    Radio,
    Plus,
    RefreshCw,
    Search,
    SlidersHorizontal,
    Trophy,
    X,
} from 'lucide-react';
import type { Dashboard } from '../shared/contracts';
import { reconcile } from '../shared/reconcile';
import { GameCard } from './GameCard';
import { AddedTeams } from './AddedTeams';
import { CalendarMenu } from './CalendarMenu';
import { SelectField } from './SelectField';
import { Tooltip } from './Tooltip';
import { ThemeMenu } from './ThemeMenu';
import { LoadingSpinner } from './LoadingSpinner';
import { useTheme } from './theme';
import { compactGames, groupGames, isFavorite, resultDays, visibleGames } from './games';
import type { View } from './games';

const viewLabels: Record<View, string> = { live: 'Current', upcoming: 'Upcoming', recent: 'Recent' };
const viewOrder: View[] = ['live', 'upcoming', 'recent'];
const filterKeys: Record<string, string> = {
    a: 'all',
    p: 'league:NCAA',
    f: 'league:NFL',
    k: 'league:NBA',
    b: 'league:MLB',
};

const shortcutHelp: [string[], string][] = [
    [['1'], 'Current'],
    [['2'], 'Upcoming'],
    [['3'], 'Recent'],
    [['A'], 'Show all teams'],
    [['P'], 'Show Purdue'],
    [['F'], 'Show NFL'],
    [['K'], 'Show NBA'],
    [['B'], 'Show MLB'],
    [['X'], 'Expand or collapse all sections'],
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
    const resultsEntered = useRef(false);
    const enterResults = useCallback((element: HTMLDivElement | null) => {
        if (element && !resultsEntered.current) {
            element.dataset.initialEnter = 'true';
            resultsEntered.current = true;
        }
    }, []);
    const [saving, setSaving] = useState(false);
    const [view, setView] = useState<View>('live');
    const [activeOnly, setActiveOnly] = useState(() => {
        try {
            return localStorage.getItem('team-scoreboard-active-only') === 'true';
        } catch (error) {
            console.warn('Active games preference could not be restored.', error);
            return false;
        }
    });
    useEffect(() => {
        try {
            localStorage.setItem('team-scoreboard-active-only', String(activeOnly));
        } catch (error) {
            console.warn('Active games preference could not be saved.', error);
        }
    }, [activeOnly]);
    const effectiveView = activeOnly ? 'live' : view;
    const [compact, setCompact] = useState(() => {
        try {
            return localStorage.getItem('team-scoreboard-compact') === 'true';
        } catch (error) {
            console.warn('Compact mode could not be restored.', error);
            return false;
        }
    });
    useEffect(() => {
        try {
            localStorage.setItem('team-scoreboard-compact', String(compact));
        } catch (error) {
            console.warn('Compact mode could not be saved.', error);
        }
    }, [compact]);
    const [team, setTeam] = useState<string[]>(['all']);
    const allTeams = team.includes('all');
    const filterKey = JSON.stringify([...team].sort());
    const [customCount, setCustomCount] = useState(0);
    // League sections start collapsed on every page load.
    // Open/closed state for the current Show filter: a base (all open or all closed) plus the sections
    // flipped from it. Changing the filter resets it, so All teams starts collapsed and others open.
    const [toggled, setToggled] = useState<{ filter: string; open: boolean; keys: string[] }>({
        filter: '["all"]',
        open: false,
        keys: [],
    });
    const [refreshing, setRefreshing] = useState(false);
    const [startupRefreshing, setStartupRefreshing] = useState(false);
    const [help, setHelp] = useState(false);
    const [editing, setEditing] = useState(false);
    const [findingTeam, setFindingTeam] = useState(false);
    const [toolsOpen, setToolsOpen] = useState(false);
    const tools = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!toolsOpen) return;
        const dismiss = (event: PointerEvent) => {
            const target = event.target as Element;
            if (!tools.current?.contains(target) && !target.closest('[role="menu"], [role="dialog"]')) {
                setToolsOpen(false);
            }
        };
        document.addEventListener('pointerdown', dismiss);
        return () => document.removeEventListener('pointerdown', dismiss);
    }, [toolsOpen]);
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
                window.dispatchEvent(new Event('scoreboard-refresh-added'));
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
        setStartupRefreshing(true);
        void refresh(true, true).finally(() => {
            if (mounted.current) setStartupRefreshing(false);
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
            setTeam(['all']);
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
        effectiveView,
        team,
        favoriteIds
    ).filter((game) => !activeOnly || game.status === 'live');
    // Selections limited to favorites, individual teams or Purdue skip favorite highlighting.
    const noHighlight = team.every(
        (filter) =>
            filter === 'favorites' || filter === 'league:NCAA' || !(filter === 'all' || filter.startsWith('league:'))
    );
    const highlightIds = noHighlight ? [] : favoriteIds;
    const sections = groupGames(games, effectiveView, favoriteIds);
    const current = toggled.filter === filterKey ? toggled : { filter: filterKey, open: !allTeams, keys: [] };
    const isOpen = (key: string) => current.open !== current.keys.includes(key);
    const toggleSection = (key: string) =>
        setToggled({
            ...current,
            keys: current.keys.includes(key) ? current.keys.filter((item) => item !== key) : [...current.keys, key],
        });
    // Moves the pill first and opens sections 2 frames later, so the slide is already running on the
    // compositor when the expensive section render lands.
    const [slideTarget, setSlideTarget] = useState<boolean | null>(null);
    const setAllSections = (open: boolean) => {
        setSlideTarget(open);
        requestAnimationFrame(() =>
            requestAnimationFrame(() => {
                setToggled({ filter: filterKey, open, keys: [] });
                setSlideTarget(null);
            })
        );
    };
    const showCustom = effectiveView === 'live' && allTeams;
    const sectionKeys = [
        ...sections.map((section) => section.key),
        ...(showCustom && customCount > 0 ? ['custom'] : []),
    ];
    const allOpen = slideTarget ?? sectionKeys.every(isOpen);
    const allClosed = slideTarget === null ? sectionKeys.every((key) => !isOpen(key)) : !slideTarget;
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
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        const views: Record<string, View> = {
            Digit1: 'live',
            Numpad1: 'live',
            Digit2: 'upcoming',
            Numpad2: 'upcoming',
            Digit3: 'recent',
            Numpad3: 'recent',
        };
        const key = event.key.toLowerCase();
        if (key === '?') {
            setHelp(true);
        } else if (key === 'r') {
            if (!refreshing) void forceRefresh('live');
        } else if (statusPage) {
            return;
        } else if (compact) {
            return;
        } else if (views[event.code]) {
            setView(views[event.code]);
        } else if (filterKeys[key]) {
            setTeam([filterKeys[key]]);
        } else if (key === 'x') {
            setAllSections(!allOpen);
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
                        <Tooltip content="Refresh live scores (R)">
                            <button
                                type="button"
                                className={`icon-button${refreshing ? ' is-busy' : ''}`}
                                onClick={() => void forceRefresh('live')}
                                disabled={refreshing}
                                aria-label={refreshing ? 'Refreshing' : 'Refresh'}
                                aria-keyshortcuts="R"
                            >
                                {refreshing ? (
                                    <LoaderCircle size={18} aria-hidden="true" />
                                ) : (
                                    <RefreshCw size={18} aria-hidden="true" />
                                )}
                            </button>
                        </Tooltip>
                        <Tooltip content="Active games only">
                            <button
                                type="button"
                                className="icon-button"
                                aria-label="Active games only"
                                aria-pressed={activeOnly}
                                onClick={() => setActiveOnly((value) => !value)}
                            >
                                <Radio size={18} aria-hidden="true" />
                            </button>
                        </Tooltip>
                        <Tooltip content={compact ? 'Exit compact mode' : 'Compact mode'}>
                            <button
                                type="button"
                                className="icon-button"
                                aria-label={compact ? 'Exit compact mode' : 'Compact mode'}
                                aria-pressed={compact}
                                onClick={() => {
                                    setCompact((value) => !value);
                                    setEditing(false);
                                    setFindingTeam(false);
                                    setToolsOpen(false);
                                    if (statusPage) location.hash = '';
                                }}
                            >
                                <LayoutGrid size={18} aria-hidden="true" />
                            </button>
                        </Tooltip>
                        <ThemeMenu theme={theme} setTheme={setTheme} />
                    </div>
                </div>
            </header>
            <main className={statusPage ? undefined : 'scores-page'}>
                {statusPage ? (
                    <section className="page-heading">
                        <h1>Source status</h1>
                        <a href="#" className="button-link">
                            Back to scores
                        </a>
                    </section>
                ) : null}
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
                {loading && (
                    <div className="page-loading">
                        <LoadingSpinner label="Loading saved favorites" />
                    </div>
                )}
                {data && (
                    <>
                        {!statusPage && !compact && editing && (
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
                                <div className="toolbar" hidden={compact}>
                                    <div
                                        className="tabs"
                                        role="group"
                                        aria-label="Schedule view"
                                        data-active={viewOrder.indexOf(effectiveView)}
                                    >
                                        {viewOrder.map((item, index) => (
                                            <Tooltip key={item} content={`${viewLabels[item]} (${index + 1})`}>
                                                <button
                                                    type="button"
                                                    aria-pressed={effectiveView === item}
                                                    disabled={activeOnly}
                                                    aria-keyshortcuts={String(index + 1)}
                                                    className={effectiveView === item ? 'selected' : ''}
                                                    onClick={() => setView(item)}
                                                >
                                                    {viewLabels[item]}
                                                </button>
                                            </Tooltip>
                                        ))}
                                    </div>
                                    <div className="toolbar-actions">
                                        <div
                                            className="score-tools"
                                            ref={tools}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Escape' && toolsOpen) {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    setToolsOpen(false);
                                                    tools.current
                                                        ?.querySelector<HTMLButtonElement>('.tools-trigger')
                                                        ?.focus();
                                                }
                                            }}
                                        >
                                            <button
                                                type="button"
                                                className="tools-trigger"
                                                aria-expanded={toolsOpen}
                                                aria-controls="score-tools-actions"
                                                onClick={() => setToolsOpen((value) => !value)}
                                            >
                                                <SlidersHorizontal size={16} aria-hidden="true" />
                                                Tools
                                            </button>
                                            <div
                                                id="score-tools-actions"
                                                className="heading-actions"
                                                data-open={toolsOpen}
                                            >
                                                <button
                                                    type="button"
                                                    className="icon-button"
                                                    aria-label="Find team"
                                                    aria-haspopup="dialog"
                                                    aria-expanded={findingTeam}
                                                    onClick={() => {
                                                        setView('live');
                                                        setTeam(['all']);
                                                        setFindingTeam(true);
                                                    }}
                                                >
                                                    <Search size={16} aria-hidden="true" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setEditing((value) => !value)}
                                                    aria-expanded={editing}
                                                >
                                                    <Plus size={16} aria-hidden="true" /> Edit favorites
                                                </button>
                                                <Tooltip content="Source status">
                                                    <a
                                                        href="#status"
                                                        className="icon-button tools-status"
                                                        aria-label="Source status"
                                                        onClick={() => setToolsOpen(false)}
                                                    >
                                                        <Activity size={16} aria-hidden="true" />
                                                    </a>
                                                </Tooltip>
                                                {calendarUrl && (
                                                    <CalendarMenu
                                                        url={calendarUrl}
                                                        onCopyError={() =>
                                                            setError('Could not copy the calendar link.')
                                                        }
                                                    />
                                                )}
                                            </div>
                                        </div>
                                        <SelectField
                                            label="Show"
                                            multiple
                                            allValue="all"
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
                                        {sectionKeys.length > 0 && (
                                            <div
                                                className="section-controls"
                                                role="group"
                                                aria-label="Section controls"
                                                data-active={allOpen ? '0' : allClosed ? '1' : 'none'}
                                            >
                                                <Tooltip content="Expand all (X)">
                                                    <button
                                                        type="button"
                                                        disabled={allOpen}
                                                        aria-pressed={allOpen}
                                                        aria-keyshortcuts="X"
                                                        aria-label="Expand all"
                                                        onClick={() => setAllSections(true)}
                                                    >
                                                        <ChevronsUpDown size={16} aria-hidden="true" />
                                                    </button>
                                                </Tooltip>
                                                <Tooltip content="Collapse all (X)">
                                                    <button
                                                        type="button"
                                                        disabled={allClosed}
                                                        aria-pressed={allClosed}
                                                        aria-keyshortcuts="X"
                                                        aria-label="Collapse all"
                                                        onClick={() => setAllSections(false)}
                                                    >
                                                        <ChevronsDownUp size={16} aria-hidden="true" />
                                                    </button>
                                                </Tooltip>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="score-results" ref={enterResults} aria-busy={startupRefreshing}>
                                    {!compact &&
                                        sections.map((section) => {
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
                                                                    {group.games.map((game) => (
                                                                        <GameCard
                                                                            key={game.id}
                                                                            game={game}
                                                                            favorite={isFavorite(game, highlightIds)}
                                                                            view={effectiveView}
                                                                            flashes={flashes}
                                                                        />
                                                                    ))}
                                                                </div>
                                                            </section>
                                                        ))}
                                                    </div>
                                                </section>
                                            );
                                        })}
                                    {!compact && activeOnly && !games.length && (!showCustom || !customCount) && (
                                        <p role="status">No active games match the selected teams.</p>
                                    )}
                                    {!compact &&
                                        !activeOnly &&
                                        !games.length &&
                                        (view === 'live' ? (
                                            <div className="empty-state">
                                                <Trophy size={28} />
                                                <h2>No games today</h2>
                                                <p>
                                                    Today's games, live scores and finals appear here. Check Upcoming
                                                    for the next games.
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="empty-state">
                                                <CalendarDays size={28} />
                                                <h2>
                                                    No {view === 'recent' ? 'final results' : 'upcoming games'} returned
                                                </h2>
                                                <p>
                                                    Some feeds may still be refreshing, and off-season sports have no
                                                    games. Check source status from Tools.
                                                </p>
                                            </div>
                                        ))}
                                    <AddedTeams
                                        favoriteIds={favoriteIds}
                                        onCountChange={setCustomCount}
                                        renderCompact={
                                            compact
                                                ? (customGames, customStatus, customFlashes) => (
                                                      <>
                                                          <div
                                                              className="games compact-games"
                                                              aria-label="Compact games"
                                                          >
                                                              {compactGames(
                                                                  [...games, ...(showCustom ? customGames : [])],
                                                                  favoriteIds
                                                              ).map((game) => (
                                                                  <GameCard
                                                                      key={game.id}
                                                                      game={game}
                                                                      favorite={isFavorite(game, highlightIds)}
                                                                      view={effectiveView}
                                                                      flashes={{ ...customFlashes, ...flashes }}
                                                                  />
                                                              ))}
                                                              {showCustom && customStatus}
                                                          </div>
                                                          {!games.length &&
                                                              (!showCustom ||
                                                                  (!customGames.length &&
                                                                      (activeOnly
                                                                          ? !Children.count(customStatus)
                                                                          : !customCount))) && (
                                                                  <p role="status">
                                                                      {activeOnly
                                                                          ? 'No active games match the selected teams.'
                                                                          : 'No games match the current selection.'}
                                                                  </p>
                                                              )}
                                                      </>
                                                  )
                                                : undefined
                                        }
                                        active={showCustom}
                                        activeOnly={activeOnly}
                                        dashboardFeeds={feeds}
                                        open={findingTeam}
                                        onClose={() => setFindingTeam(false)}
                                        expanded={isOpen('custom')}
                                        onToggle={() => toggleSection('custom')}
                                        onAdd={() => {
                                            if (!isOpen('custom')) toggleSection('custom');
                                        }}
                                    />
                                </div>
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
                    {updated && (
                        <div className="refresh-time">
                            <Clock3 size={13} aria-hidden="true" />
                            <span>Last refresh</span>
                            <time dateTime={updated}>
                                {new Date(updated).toLocaleTimeString(undefined, {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hourCycle: 'h23',
                                })}
                            </time>
                        </div>
                    )}
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
                            <Tooltip content="Close (Esc)">
                                <button
                                    ref={helpClose}
                                    type="button"
                                    className="icon-button"
                                    onClick={() => setHelp(false)}
                                    aria-label="Close"
                                >
                                    <X size={16} aria-hidden="true" />
                                </button>
                            </Tooltip>
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
