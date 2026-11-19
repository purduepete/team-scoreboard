import { Activity, ArrowUpRight, CircleDot, Info, Star, Tv } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Game } from '../shared/contracts';
import type { CSSProperties, HTMLAttributes, MouseEvent, ReactNode } from 'react';
import type { View } from './games';
import { footballSituation, formatStart, formatTime } from './games';
import { formatDate, pacificDate } from './pacific-time';
import { Tooltip } from './Tooltip';
import { GameDetails, TeamLogo } from './GameDetails';
import type { ResolvedTheme } from './theme';
import './scoreboard-card.css';

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

function SportIcon({ sport }: { sport: string }) {
    if (/football/i.test(sport)) {
        return (
            <svg
                className="tight-sport"
                role="img"
                aria-label={sport}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="M5 19C3 13 8 6 19 5c2 6-3 13-14 14Z" />
                <path d="m9 15 6-6M9.5 12.5l2 2M11.5 10.5l2 2" />
            </svg>
        );
    }
    if (/basketball/i.test(sport)) {
        return (
            <svg
                className="tight-sport"
                role="img"
                aria-label={sport}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
            >
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3v18M5.5 5.5c4 3.2 4 9.8 0 13M18.5 5.5c-4 3.2-4 9.8 0 13" />
            </svg>
        );
    }
    const Icon = /baseball|softball|soccer|volleyball|tennis/i.test(sport) ? CircleDot : Activity;
    return <Icon className="tight-sport" role="img" aria-label={sport} />;
}

function tightStatus(game: Game, showDate: boolean) {
    if (game.status === 'upcoming') {
        if (!game.startTime)
            return game.date ? `${formatDate(game.date, false)} · Time unannounced` : 'Time unannounced';
        const date = showDate ? `${formatDate(pacificDate(new Date(game.startTime)), false)} ` : '';
        return `${date}${formatTime(game)}`;
    }
    let status = game.statusLabel;
    if (game.status === 'live') {
        status = status.replace(
            /\b([QH])(\d)\b/gi,
            (_, kind: string, number: string) => `${number}${kind.toUpperCase()}`
        );
        status = status.replace(
            /\b(\d)(?:st|nd|rd|th)\s+(quarter|qtr|half)\b/gi,
            (_, number: string, period: string) => `${number}${/^h/i.test(period) ? 'H' : 'Q'}`
        );
        if (/football|basketball/i.test(game.sport)) {
            const half = /men's basketball/i.test(game.sport) && game.league !== 'NBA';
            status = status.replace(
                /^(\d)(?:st|nd|rd|th)(?=\s|$)/i,
                (_, number: string) => `${number}${half ? 'H' : 'Q'}`
            );
        }
        status = status.replace(/\b0(\d:\d{2})\b/g, '$1');
        if (/^(live|in progress)$/i.test(status)) status = '';
    }
    if (game.status === 'final' && showDate && (game.startTime || game.date)) {
        const date = game.startTime
            ? formatDate(pacificDate(new Date(game.startTime)), false)
            : game.date && formatDate(game.date, false);
        return `${status} · ${date}`;
    }
    return status;
}

export function GameCard({
    game,
    favorite = false,
    favoriteTeamIds = [],
    className,
    view,
    flashes = {},
    actions,
    reorder,
    reorderActions,
    showDate = false,
    tight = false,
    scoreboardTheme,
}: {
    game: Game;
    favorite?: boolean;
    favoriteTeamIds?: string[];
    className?: string;
    view: View;
    flashes?: Record<string, number>;
    actions?: ReactNode;
    reorder?: HTMLAttributes<HTMLElement>;
    reorderActions?: ReactNode;
    showDate?: boolean;
    tight?: boolean;
    scoreboardTheme?: ResolvedTheme;
}) {
    const detailsId = useId();
    const [detailsOpen, setDetailsOpen] = useState(false);
    const cardClass = `${scoreboardTheme ? ' scoreboard-card' : ''}${favorite ? ' favorite' : ''}${className ? ` ${className}` : ''}`;
    const cardStyle: (CSSProperties & Partial<Record<`--game-${'away' | 'home'}-color`, string>>) | undefined =
        scoreboardTheme
            ? {
                  ...reorder?.style,
                  '--game-away-color': game.awayColor,
                  '--game-home-color': game.homeColor,
              }
            : reorder?.style;
    const logo = (name: string, side: 'away' | 'home') =>
        scoreboardTheme && <TeamLogo name={name} src={game[`${side}Logo`]} theme={scoreboardTheme} />;
    const toggleDetails = () => setDetailsOpen((open) => !open);
    const onCardClick = (event: MouseEvent<HTMLElement>) => {
        reorder?.onClick?.(event);
        const { target, currentTarget } = event;
        if (
            !event.defaultPrevented &&
            target instanceof Element &&
            currentTarget.contains(target) &&
            !target.closest('a, button, [tabindex], .game-details-panel')
        ) {
            toggleDetails();
        }
    };
    const detailsControl = scoreboardTheme && (
        <button
            type="button"
            className="sr-only game-details-control"
            aria-label={`Details for ${game.title}`}
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={toggleDetails}
        />
    );
    const detailsPanel = scoreboardTheme && (
        <div className="game-details-panel" id={detailsId} hidden={!detailsOpen}>
            {detailsOpen && <GameDetails game={game} theme={scoreboardTheme} />}
        </div>
    );
    const football = game.sport === 'Football';
    const teamName = (name: string, side: 'away' | 'home', className = '') => {
        const hasPossession = game.status === 'live' && game.possession === side;
        if (!hasPossession) return <span className={className || undefined}>{name}</span>;
        return (
            <span className="team-has-possession">
                <span className={className || undefined}>{name}</span>
                <span className="possession-dot" aria-hidden="true" />
                <span className="sr-only"> Has possession</span>
            </span>
        );
    };
    const situation = useSituation(game);
    const { detail, position } = football ? footballSituation(situation.text) : { detail: situation.text };
    const showRedZoneMarker = game.redZone && !position && !(football && game.status === 'live' && game.scored);
    const nationalBadge = game.league === 'NBA' && game.national && (
        <Tooltip content={`National broadcast: ${game.national}`}>
            <span
                className="national-badge"
                role="img"
                tabIndex={0}
                aria-label={`National broadcast: ${game.national}`}
            />
        </Tooltip>
    );
    const scoreDisplay = (team: string, side: 'home' | 'away') => {
        const id = side === 'home' ? game.homeTeamId : game.awayTeamId;
        const score = side === 'home' ? game.homeScore : game.awayScore;
        const opponentScore = side === 'home' ? game.awayScore : game.homeScore;
        const showResult =
            id &&
            favoriteTeamIds.includes(id) &&
            (game.status === 'live' || game.status === 'final') &&
            score !== null &&
            opponentScore !== null &&
            score !== opponentScore;
        const winning = showResult && score > opponentScore;
        const label = game.status === 'final' ? (winning ? 'won' : 'lost') : winning ? 'winning' : 'losing';
        return (
            <>
                <span className="score-value">
                    {football && game.status === 'live' && game.scored === side && (
                        <span className="scored-label">Scored</span>
                    )}
                    {showResult && (
                        <span
                            className={`favorite-result ${winning ? 'favorite-winning' : 'favorite-losing'}`}
                            aria-hidden="true"
                        />
                    )}
                    {score ?? '—'}
                </span>
                {showResult && <span className="sr-only">{` ${team} ${label}`}</span>}
            </>
        );
    };
    if (tight) {
        const status = tightStatus(game, showDate);
        const line = (team: string, side: 'home' | 'away') => (
            <div className="tight-team">
                <span className="tight-name">
                    {logo(team, side)}
                    {teamName(team, side, 'tight-name-text')}
                </span>
                <strong
                    key={`${side}-${flashes[`${game.id}:${side}`] ?? 0}`}
                    className={!football && flashes[`${game.id}:${side}`] ? 'score-changed' : undefined}
                >
                    {scoreDisplay(team, side)}
                </strong>
            </div>
        );
        return (
            <article
                className={`game tight-game${cardClass}`}
                {...reorder}
                style={cardStyle}
                onClick={scoreboardTheme ? onCardClick : reorder?.onClick}
            >
                {detailsControl}
                {nationalBadge}
                {game.home && game.away ? (
                    <>
                        {line(game.away, 'away')}
                        {line(game.home, 'home')}
                    </>
                ) : (
                    <div className="tight-team">
                        <span className="tight-name">{game.title}</span>
                    </div>
                )}
                <div className="tight-meta">
                    <SportIcon sport={game.sport} />
                    {status && (
                        <span>
                            ·{' '}
                            {game.status === 'final' && view === 'live' ? (
                                <span className="final-label">{status}</span>
                            ) : (
                                status
                            )}
                        </span>
                    )}
                    {game.status === 'live' && detail && (
                        <span>
                            · {detail}
                            {situation.retained ? ' (last reported)' : ''}
                        </span>
                    )}
                    {game.status === 'live' && position && (
                        <span className="tight-position">
                            ·{' '}
                            <span
                                className={`field-position${game.redZone ? ' red-zone' : ''}`}
                                aria-label={game.redZone ? `Red zone, ${position}` : undefined}
                            >
                                {position}
                            </span>
                        </span>
                    )}
                    {game.status === 'live' && showRedZoneMarker && (
                        <span className="red-zone tight-position" aria-label="Red zone, field position unavailable">
                            RZ
                        </span>
                    )}
                    {!scoreboardTheme && (
                        <a
                            href={game.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Source for ${game.title}`}
                        >
                            <ArrowUpRight size={14} aria-hidden="true" />
                        </a>
                    )}
                </div>
                {detailsPanel}
            </article>
        );
    }
    return (
        <article
            className={`game${cardClass}`}
            {...reorder}
            style={cardStyle}
            onClick={scoreboardTheme ? onCardClick : reorder?.onClick}
        >
            {detailsControl}
            {nationalBadge}
            <div className="game-meta">
                <span className="game-description">
                    {favorite && (
                        <span className="favorite-marker">
                            <Star size={16} aria-label="Favorite" className="star" />
                        </span>
                    )}
                    <span className="game-description-text">
                        {game.league} · {game.sport}
                        {game.week ? ` · Week ${game.week}` : ''}
                    </span>
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
                            {logo(game.away, 'away')}
                            {teamName(game.away, 'away', scoreboardTheme ? 'compact-team-name' : undefined)}
                            {game.awayRecord && <span className="record"> ({game.awayRecord})</span>}
                        </span>
                        <strong
                            key={`away-${flashes[`${game.id}:away`] ?? 0}`}
                            className={!football && flashes[`${game.id}:away`] ? 'score-changed' : undefined}
                        >
                            {scoreDisplay(game.away, 'away')}
                        </strong>
                    </div>
                    <div>
                        <span>
                            {logo(game.home, 'home')}
                            {teamName(game.home, 'home', scoreboardTheme ? 'compact-team-name' : undefined)}
                            {game.homeRecord && <span className="record"> ({game.homeRecord})</span>}
                        </span>
                        <strong
                            key={`home-${flashes[`${game.id}:home`] ?? 0}`}
                            className={!football && flashes[`${game.id}:home`] ? 'score-changed' : undefined}
                        >
                            {scoreDisplay(game.home, 'home')}
                        </strong>
                    </div>
                    {game.status === 'live' && (situation.text || position || showRedZoneMarker) && (
                        <p className="situation">
                            {detail}
                            {position && (
                                <>
                                    {' at '}
                                    <span
                                        className={`field-position${game.redZone ? ' red-zone' : ''}`}
                                        aria-label={game.redZone ? `Red zone, ${position}` : undefined}
                                    >
                                        {position}
                                    </span>
                                </>
                            )}
                            {showRedZoneMarker && (
                                <>
                                    {detail && ' '}
                                    <span className="red-zone" aria-label="Red zone, field position unavailable">
                                        RZ
                                    </span>
                                </>
                            )}
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
                    {scoreboardTheme && game.status === 'final' ? (
                        showDate &&
                        (game.startTime || game.date) && (
                            <time dateTime={game.startTime ?? game.date ?? undefined}>
                                {formatDate(game.startTime ? pacificDate(new Date(game.startTime)) : game.date!)}
                            </time>
                        )
                    ) : (
                        <>
                            <time dateTime={game.startTime ?? game.date ?? undefined}>
                                {showDate ? formatStart(game) : formatTime(game)}
                            </time>
                            {game.broadcast && <Broadcast name={game.broadcast} />}
                        </>
                    )}
                </span>
                {!scoreboardTheme && (
                    <a href={game.sourceUrl} target="_blank" rel="noreferrer">
                        Source <ArrowUpRight size={14} />
                    </a>
                )}
                {reorderActions && <span className="custom-order-actions">{reorderActions}</span>}
            </div>
            {detailsPanel}
        </article>
    );
}
