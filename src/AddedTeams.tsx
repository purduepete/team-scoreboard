import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Plus, X } from 'lucide-react';
import type { Feed, Game, SearchTeam, TeamCategory } from '../shared/contracts';
import { GameCard } from './GameCard';
import { categories, localDate, pinKey, pinLimit, pinsKey, readPins, todayGames } from './added-teams';
import type { TeamPin } from './added-teams';
import { reconcile, withLiveFields } from '../shared/reconcile';

interface TeamResult {
    team: SearchTeam;
    feed: Feed;
}
interface Entry {
    result?: TeamResult;
    error?: string;
}
interface SearchResult {
    teams: SearchTeam[];
    stale: boolean;
    error: string | null;
}

async function get<T>(url: string, signal: AbortSignal): Promise<T> {
    const response = await fetch(url, { signal });
    let body;
    try {
        body = await response.json();
    } catch (error) {
        console.warn(`Team request returned invalid JSON (${response.status}): ${url}`, error);
        throw new Error(`Team data is temporarily unavailable (${response.status}). Retrying shortly.`);
    }
    if (!response.ok) throw new Error(body.error ?? `Team request failed (${response.status}).`);
    return body as T;
}

function initialPins() {
    const date = localDate();
    try {
        return { date, pins: readPins(localStorage.getItem(pinsKey), date), error: '' };
    } catch (error) {
        console.warn('Added teams could not be restored.', error);
        return { date, pins: [] as TeamPin[], error: 'Custom teams could not be restored from this browser.' };
    }
}

export function AddedTeams({
    active,
    dashboardFeeds,
    open,
    onClose,
    expanded,
    onToggle,
    onAdd,
}: {
    active: boolean;
    dashboardFeeds: Feed[];
    open: boolean;
    onClose: () => void;
    expanded: boolean;
    onToggle: () => void;
    onAdd: () => void;
}) {
    const [saved, setSaved] = useState(initialPins);
    const [entries, setEntries] = useState<Record<string, Entry>>({});
    const [category, setCategory] = useState<TeamCategory>('college-football');
    const [query, setQuery] = useState('');
    const [search, setSearch] = useState<SearchResult | null>(null);
    const [searchError, setSearchError] = useState('');
    const [searching, setSearching] = useState(false);
    const [flashes, setFlashes] = useState<Record<string, number>>({});
    const scores = useRef(new Map<string, { home: number | null; away: number | null }>());
    const generation = useRef(0);
    const current = useRef(saved);
    current.current = saved;
    const fetchPins = useRef<() => void>(() => undefined);
    const controller = useRef<AbortController | null>(null);
    const busy = useRef(false);
    const searchInput = useRef<HTMLInputElement>(null);
    const dialog = useRef<HTMLDivElement>(null);
    const close = useRef(onClose);
    close.current = onClose;

    const expire = useCallback(() => {
        const date = localDate();
        if (current.current.date === date) return false;
        generation.current++;
        controller.current?.abort();
        busy.current = false;
        current.current = { date, pins: [], error: '' };
        setSaved(current.current);
        setEntries({});
        scores.current.clear();
        setFlashes({});
        return true;
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(pinsKey, JSON.stringify({ date: saved.date, teams: saved.pins }));
        } catch (error) {
            console.warn('Added teams could not be saved.', error);
            setSaved((previous) => ({ ...previous, error: 'Custom teams could not be saved in this browser.' }));
        }
    }, [saved.date, saved.pins]);

    useEffect(() => {
        const arm = () => {
            const now = new Date();
            return setTimeout(
                () => {
                    expire();
                    timer = arm();
                },
                new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime() + 50
            );
        };
        let timer = arm();
        const refresh = () => {
            if (!document.hidden && !expire()) fetchPins.current();
        };
        const poll = setInterval(refresh, 20_000);
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('focus', refresh);
        const manual = () => fetchPins.current();
        window.addEventListener('scoreboard-refresh-added', manual);
        return () => {
            clearTimeout(timer);
            clearInterval(poll);
            controller.current?.abort();
            document.removeEventListener('visibilitychange', refresh);
            window.removeEventListener('focus', refresh);
            window.removeEventListener('scoreboard-refresh-added', manual);
        };
    }, [expire]);

    fetchPins.current = () => {
        if (expire() || busy.current || !current.current.pins.length) return;
        const version = generation.current;
        const pins = [...current.current.pins];
        const abort = new AbortController();
        controller.current = abort;
        busy.current = true;
        let next = 0;
        const worker = async () => {
            while (next < pins.length && !abort.signal.aborted) {
                const pin = pins[next++];
                const key = pinKey(pin);
                try {
                    const result = await get<TeamResult>(
                        `/api/added-teams?sport=${pin.category}&id=${pin.id}`,
                        AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)])
                    );
                    if (version !== generation.current || expire()) return;
                    setEntries((previous) => ({ ...previous, [key]: { result } }));
                } catch (error) {
                    if (abort.signal.aborted || version !== generation.current) return;
                    setEntries((previous) => ({
                        ...previous,
                        [key]: {
                            ...previous[key],
                            error: error instanceof Error ? error.message : 'Could not load this team.',
                        },
                    }));
                }
            }
        };
        void Promise.all(Array.from({ length: Math.min(4, pins.length) }, worker)).finally(() => {
            if (version === generation.current) busy.current = false;
        });
    };

    useEffect(() => {
        generation.current++;
        controller.current?.abort();
        busy.current = false;
        const allowed = new Set(saved.pins.map(pinKey));
        setEntries((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => allowed.has(key))));
        fetchPins.current();
    }, [saved.pins, saved.date]);

    useEffect(() => {
        const added = Object.values(entries).flatMap((entry) => entry.result?.feed.games ?? []);
        const best = reconcile([...added, ...dashboardFeeds.flatMap((feed) => feed.games)]);
        const games = [...reconcile(added).values()].map((game) => withLiveFields(game, best.get(game.id)));
        const ids = new Set(games.map((game) => game.id));
        for (const id of scores.current.keys()) if (!ids.has(id)) scores.current.delete(id);
        const changes: Record<string, number> = {};
        const stamp = Date.now();
        for (const game of games) {
            const previous = scores.current.get(game.id);
            if (previous) {
                for (const side of ['home', 'away'] as const) {
                    const before = previous[side];
                    const after = side === 'home' ? game.homeScore : game.awayScore;
                    if (typeof before === 'number' && typeof after === 'number' && before !== after)
                        changes[`${game.id}:${side}`] = stamp;
                }
            }
            scores.current.set(game.id, { home: game.homeScore, away: game.awayScore });
        }
        setFlashes((previous) => ({ ...previous, ...changes }));
    }, [entries, dashboardFeeds]);

    useEffect(() => {
        if (!Object.keys(flashes).length) return;
        const timer = setTimeout(() => setFlashes({}), 2500);
        return () => clearTimeout(timer);
    }, [flashes]);

    useEffect(() => {
        setSearch(null);
        setSearchError('');
        const text = query.trim();
        if (!open || text.length < 2) {
            setSearching(false);
            return;
        }
        const abort = new AbortController();
        setSearching(true);
        const timer = setTimeout(() => {
            void get<SearchResult>(
                `/api/team-search?sport=${category}&q=${encodeURIComponent(text)}`,
                AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)])
            )
                .then((result) => {
                    if (!abort.signal.aborted) setSearch(result);
                })
                .catch((error: unknown) => {
                    if (!abort.signal.aborted)
                        setSearchError(error instanceof Error ? error.message : 'Team search failed.');
                })
                .finally(() => {
                    if (!abort.signal.aborted) setSearching(false);
                });
        }, 300);
        return () => {
            clearTimeout(timer);
            abort.abort();
        };
    }, [query, category, open]);

    useEffect(() => {
        if (!open || !active) return;
        const previousFocus = document.activeElement as HTMLElement | null;
        searchInput.current?.focus();
        const before = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const keydown = (event: KeyboardEvent) => {
            if (document.querySelector('[role="listbox"]')) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                close.current();
            }
            if (event.key !== 'Tab') return;
            const controls = [
                ...(dialog.current?.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), input, a[href], [tabindex="0"]'
                ) ?? []),
            ];
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        };
        document.addEventListener('keydown', keydown);
        return () => {
            document.body.style.overflow = before;
            document.removeEventListener('keydown', keydown);
            previousFocus?.focus();
        };
    }, [open, active]);

    const add = (team: SearchTeam) => {
        expire();
        const pin = { category: team.category, id: team.providerId!.split('/').at(-1)! };
        if (current.current.pins.length >= pinLimit) {
            setSaved((previous) => ({
                ...previous,
                error: 'You can add up to 20 teams today. Remove a team to add another.',
            }));
            return;
        }
        setSaved((previous) => {
            if (previous.pins.some((entry) => pinKey(entry) === pinKey(pin))) return previous;
            if (previous.pins.length >= pinLimit)
                return { ...previous, error: 'You can add up to 20 teams today. Remove a team to add another.' };
            return { ...previous, pins: [...previous.pins, pin], error: '' };
        });
        onAdd();
        setQuery('');
        setSearch(null);
        setSearchError('');
        onClose();
    };
    const selected = saved.pins.map((pin) => ({ pin, entry: entries[pinKey(pin)] }));
    const remove = (pin: TeamPin) =>
        setSaved((previous) => ({
            ...previous,
            pins: previous.pins.filter((item) => pinKey(item) !== pinKey(pin)),
            error: '',
        }));
    const removeButton = (pin: TeamPin, name: string) => (
        <button
            type="button"
            className="icon-button remove-team"
            aria-label={`Remove ${name}`}
            onClick={() => remove(pin)}
        >
            <X size={14} aria-hidden="true" />
        </button>
    );
    const best = reconcile([
        ...selected.flatMap(({ entry }) => entry?.result?.feed.games ?? []),
        ...dashboardFeeds.flatMap((feed) => feed.games),
    ]);
    const games = new Map<string, { game: Game; names: Set<string> }>();
    for (const { entry } of selected) {
        if (!entry?.result) continue;
        for (const game of todayGames(entry.result.feed.games).filter((game) =>
            game.teamIds.includes(entry.result!.team.id)
        )) {
            const key = `${game.sport}:${game.id}`;
            const existing = games.get(key);
            if (existing) existing.names.add(entry.result.team.name);
            else
                games.set(key, {
                    game: withLiveFields(game, best.get(game.id)),
                    names: new Set([entry.result.team.name]),
                });
        }
    }
    return (
        <section className="added-teams" aria-label="Custom" hidden={!active}>
            <h2 className="section-title">
                <button type="button" aria-expanded={expanded} aria-controls="section-custom" onClick={onToggle}>
                    <ChevronRight size={20} aria-hidden="true" className={expanded ? 'chevron open' : 'chevron'} />
                    <span>Custom</span>
                    <small>
                        {saved.pins.length} {saved.pins.length === 1 ? 'team' : 'teams'}
                    </small>
                </button>
            </h2>
            <div id="section-custom" hidden={!expanded}>
                {saved.error && <p role="alert">{saved.error}</p>}
                {open &&
                    active &&
                    createPortal(
                        <div className="help-backdrop" onClick={onClose}>
                            <div
                                ref={dialog}
                                id="team-finder"
                                className="team-finder help-dialog"
                                role="dialog"
                                aria-modal="true"
                                aria-labelledby="team-finder-title"
                                onClick={(event) => event.stopPropagation()}
                            >
                                <div className="help-heading">
                                    <h2 id="team-finder-title">Find team</h2>
                                    <button
                                        type="button"
                                        className="icon-button"
                                        aria-label="Close team search"
                                        onClick={onClose}
                                    >
                                        <X size={16} aria-hidden="true" />
                                    </button>
                                </div>
                                {saved.error && <p role="alert">{saved.error}</p>}
                                <div className="section-controls" role="group" aria-label="Sport">
                                    {categories.map(({ value, label }) => (
                                        <button
                                            key={value}
                                            type="button"
                                            aria-label={label}
                                            aria-pressed={category === value}
                                            onClick={() => setCategory(value)}
                                        >
                                            <svg
                                                width="18"
                                                height="18"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                aria-hidden="true"
                                            >
                                                {value === 'college-football' ? (
                                                    <>
                                                        <path d="M5 19A14 14 0 0 1 19 5a14 14 0 0 1-14 14Z" />
                                                        <path d="m9.5 14.5 5-5M9.5 12.5l2 2M11 11l2 2M12.5 9.5l2 2" />
                                                    </>
                                                ) : (
                                                    <>
                                                        <circle cx="12" cy="12" r="9" />
                                                        <path d="M3 12h18M12 3v18M5.6 5.6a9 9 0 0 1 0 12.8M18.4 5.6a9 9 0 0 0 0 12.8" />
                                                    </>
                                                )}
                                            </svg>
                                        </button>
                                    ))}
                                </div>
                                <label htmlFor="added-team-query">Search teams</label>
                                <input
                                    id="added-team-query"
                                    ref={searchInput}
                                    value={query}
                                    maxLength={80}
                                    placeholder="Type at least 2 characters"
                                    onChange={(event) => setQuery(event.target.value)}
                                />
                                {searching && <p role="status">Searching teams…</p>}
                                {searchError && <p role="alert">{searchError}</p>}
                                {search?.error && <p role="alert">{search.error}</p>}
                                {search?.stale && <p role="status">Showing the last saved team directory.</p>}
                                {search && !searching && !search.teams.length && <p role="status">No teams found.</p>}
                                <ul className="team-search-results">
                                    {search?.teams.map((team) => {
                                        const id = team.providerId!.split('/').at(-1)!;
                                        const added = saved.pins.some(
                                            (pin) => pin.category === team.category && pin.id === id
                                        );
                                        return (
                                            <li key={`${team.category}:${id}`}>
                                                <span>
                                                    {team.name}
                                                    <small>
                                                        {categories.find((item) => item.value === team.category)?.label}
                                                    </small>
                                                </span>
                                                <button
                                                    type="button"
                                                    aria-label={`Add ${team.name}`}
                                                    disabled={added}
                                                    onClick={() => add(team)}
                                                >
                                                    <Plus size={16} aria-hidden="true" />
                                                    {added ? 'Added' : 'Add'}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        </div>,
                        document.body
                    )}
                <div className="games custom-games">
                    {selected.map(({ pin, entry }) => {
                        const result = entry?.result;
                        const name =
                            result?.team.name ??
                            `${categories.find((item) => item.value === pin.category)?.label} team ${pin.id}`;
                        const hasGames =
                            result &&
                            todayGames(result.feed.games).some((game) => game.teamIds.includes(result.team.id));
                        if (hasGames && !entry?.error && !result.feed.error) return null;
                        return (
                            <article key={pinKey(pin)} className="game custom-status-card" aria-label={name}>
                                <div className="heading-actions">{!hasGames && removeButton(pin, name)}</div>
                                {entry?.error && <p role="alert">{entry.error}</p>}
                                {!result && !entry?.error && <p role="status">Loading team…</p>}
                                {result?.feed.error && <p role="alert">{result.feed.error}</p>}
                                {result?.feed.pending && !entry?.error && !result.feed.error && (
                                    <p role="status">Loading scores…</p>
                                )}
                                {result?.feed.stale && hasGames && (
                                    <p role="status">Showing previously fetched scores.</p>
                                )}
                                {result &&
                                    !result.feed.error &&
                                    !result.feed.pending &&
                                    !result.feed.stale &&
                                    !todayGames(result.feed.games).length && <p>No game today.</p>}
                            </article>
                        );
                    })}
                    {[...games.values()]
                        .sort((a, b) => (a.game.startTime ?? '').localeCompare(b.game.startTime ?? ''))
                        .map(({ game, names }) => (
                            <GameCard
                                key={`${game.sport}:${game.id}`}
                                game={game}
                                view="live"
                                flashes={flashes}
                                actions={selected
                                    .filter(({ entry }) => entry?.result && names.has(entry.result.team.name))
                                    .map(({ pin, entry }) => (
                                        <span key={pinKey(pin)}>{removeButton(pin, entry!.result!.team.name)}</span>
                                    ))}
                            />
                        ))}
                </div>
            </div>
        </section>
    );
}
