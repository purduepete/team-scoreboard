import { ArrowUpRight, Info, Star, Tv } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Game } from '../shared/contracts';
import type { HTMLAttributes, ReactNode } from 'react';
import type { View } from './games';
import { formatTime } from './games';
import { Tooltip } from './Tooltip';

function Broadcast({ name }: { name: string }) {
    const text = useRef<HTMLSpanElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const tooltip = useRef<HTMLDivElement>(null);
    const [truncated, setTruncated] = useState(false);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const id = useId();
    const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const hide = () => {
        hideTimer.current = setTimeout(() => setOpen(false), 150);
    };
    useEffect(() => () => clearTimeout(hideTimer.current), []);
    useEffect(() => {
        const element = text.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setTruncated(element.scrollWidth > element.clientWidth));
        observer.observe(element);
        return () => observer.disconnect();
    }, [name]);
    useEffect(() => {
        if (!open) return;
        const dismiss = (event: PointerEvent) => {
            if (!trigger.current?.contains(event.target as Node) && !tooltip.current?.contains(event.target as Node))
                setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', dismiss);
        document.addEventListener('keydown', escape);
        return () => {
            document.removeEventListener('pointerdown', dismiss);
            document.removeEventListener('keydown', escape);
        };
    }, [open]);
    const show = () => {
        clearTimeout(hideTimer.current);
        const box = trigger.current?.getBoundingClientRect();
        if (box) setPosition({ top: box.top, left: Math.max(8, Math.min(box.left, window.innerWidth - 288)) });
        setOpen(true);
    };
    return (
        <span className="broadcast">
            <Tv size={12} aria-hidden="true" />
            <span ref={text} className="broadcast-name">
                {name}
            </span>
            {truncated && (
                <button
                    ref={trigger}
                    type="button"
                    className="channel-info"
                    aria-label="Full channel list"
                    aria-describedby={id}
                    aria-expanded={open}
                    onMouseEnter={show}
                    onMouseLeave={hide}
                    onFocus={show}
                    onBlur={() => setOpen(false)}
                    onClick={show}
                >
                    <Info size={13} aria-hidden="true" />
                </button>
            )}
            {truncated &&
                createPortal(
                    <div
                        ref={tooltip}
                        id={id}
                        role="tooltip"
                        className="channel-tooltip"
                        style={{ top: position.top, left: position.left }}
                        hidden={!open}
                        onMouseEnter={() => {
                            clearTimeout(hideTimer.current);
                            setOpen(true);
                        }}
                        onMouseLeave={hide}
                    >
                        {name}
                    </div>,
                    document.body
                )}
        </span>
    );
}

// Lucide has no American football, so this is a Lucide-style stroke glyph for football possession.
function Possession({ football }: { football: boolean }) {
    if (!football) return <span className="possession" role="img" aria-label="Has possession" />;
    return (
        <svg
            className="possession-ball"
            role="img"
            aria-label="Has possession"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M5 19A14 14 0 0 1 19 5a14 14 0 0 1-14 14Z" />
            <path d="m9.5 14.5 5-5M9.5 12.5l2 2M11 11l2 2M12.5 9.5l2 2" />
        </svg>
    );
}

function samePlay(previous: Game, current: Game) {
    return (
        current.id === previous.id &&
        current.sport === 'Football' &&
        current.status === 'live' &&
        current.statusLabel === previous.statusLabel &&
        current.homeScore === previous.homeScore &&
        current.awayScore === previous.awayScore &&
        current.possession === previous.possession
    );
}

function useSituation(game: Game) {
    const [lastReport, setLastReport] = useState<{ game: Game; at: number } | null>(null);
    useEffect(() => {
        if (game.sport === 'Football' && game.status === 'live' && game.situation) {
            setLastReport({ game, at: Date.now() });
        } else {
            setLastReport((previous) => (previous && samePlay(previous.game, game) ? previous : null));
        }
    }, [game]);
    useEffect(() => {
        if (!lastReport || game.situation) return;
        const timer = setTimeout(() => setLastReport(null), Math.max(0, lastReport.at + 60_000 - Date.now()));
        return () => clearTimeout(timer);
    }, [lastReport, game.situation]);
    const retained =
        !game.situation &&
        lastReport !== null &&
        samePlay(lastReport.game, game) &&
        Date.now() < lastReport.at + 60_000;
    return { text: game.situation || (retained ? lastReport.game.situation : undefined), retained };
}

export function GameCard({
    game,
    favorite = false,
    view,
    flashes = {},
    actions,
    reorder,
    reorderActions,
}: {
    game: Game;
    favorite?: boolean;
    view: View;
    flashes?: Record<string, number>;
    actions?: ReactNode;
    reorder?: HTMLAttributes<HTMLElement>;
    reorderActions?: ReactNode;
}) {
    const football = game.sport === 'Football';
    const situation = useSituation(game);
    return (
        <article className={`game${favorite ? ' favorite' : ''}`} {...reorder}>
            {game.league === 'NBA' && game.national && (
                <Tooltip content={`National broadcast: ${game.national}`}>
                    <span
                        className="national-badge"
                        role="img"
                        tabIndex={0}
                        aria-label={`National broadcast: ${game.national}`}
                    />
                </Tooltip>
            )}
            <div className="game-meta">
                <span>
                    {favorite && (
                        <span className="favorite-marker">
                            <Star size={16} aria-label="Favorite" className="star" />
                        </span>
                    )}
                    {game.league} · {game.sport}
                    {game.week ? ` · Week ${game.week}` : ''}
                </span>
                <span
                    className={
                        game.status === 'live'
                            ? 'live-label'
                            : game.status === 'final' && view === 'live'
                              ? 'final-label'
                              : undefined
                    }
                >
                    {game.statusLabel}
                </span>
            </div>
            {game.home && game.away ? (
                <div className="score-lines">
                    <div>
                        <span>
                            {football && game.possession === 'away' && <Possession football={football} />}
                            {game.away}
                            {!football && game.possession === 'away' && <Possession football={football} />}
                            {game.awayRecord && <span className="record"> ({game.awayRecord})</span>}
                        </span>
                        <strong
                            key={`away-${flashes[`${game.id}:away`] ?? 0}`}
                            className={flashes[`${game.id}:away`] ? 'score-changed' : undefined}
                        >
                            {game.awayScore ?? '—'}
                        </strong>
                    </div>
                    <div>
                        <span>
                            {football && game.possession === 'home' && <Possession football={football} />}
                            {game.home}
                            {!football && game.possession === 'home' && <Possession football={football} />}
                            {game.homeRecord && <span className="record"> ({game.homeRecord})</span>}
                        </span>
                        <strong
                            key={`home-${flashes[`${game.id}:home`] ?? 0}`}
                            className={flashes[`${game.id}:home`] ? 'score-changed' : undefined}
                        >
                            {game.homeScore ?? '—'}
                        </strong>
                    </div>
                    {game.status === 'live' && (situation.text || game.redZone) && (
                        <p className="situation">
                            {game.redZone && <span className="red-zone">Red zone</span>}
                            {situation.text}
                            {situation.retained && <span className="muted"> (last reported)</span>}
                        </p>
                    )}
                </div>
            ) : (
                <h4>{game.title}</h4>
            )}
            <div className="game-footer">
                <span className="when">
                    {actions && <span className="custom-card-actions">{actions}</span>}
                    <time dateTime={game.startTime ?? game.date ?? undefined}>{formatTime(game)}</time>
                    {game.broadcast && <Broadcast name={game.broadcast} />}
                </span>
                <a href={game.sourceUrl} target="_blank" rel="noreferrer">
                    Source <ArrowUpRight size={14} />
                </a>
                {reorderActions && <span className="custom-order-actions">{reorderActions}</span>}
            </div>
        </article>
    );
}
