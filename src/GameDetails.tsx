import { Clock, ExternalLink, Info, MapPin, Tv } from 'lucide-react';
import { useState } from 'react';
import type { Game } from '../shared/contracts';
import { formatStart } from './games';
import type { ResolvedTheme } from './theme';

export function TeamLogo({ name, src, theme }: { name: string; src?: string; theme: ResolvedTheme }) {
    const [failed, setFailed] = useState<string[]>([]);
    const darkSrc = theme === 'midnight' ? src?.replace('/500/', '/500-dark/') : undefined;
    const url = [darkSrc, src].find((item) => item && !failed.includes(item));
    return (
        <span className="game-team-logo" aria-hidden="true">
            {url ? (
                <img
                    src={url}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() => setFailed((urls) => [...urls, url])}
                />
            ) : (
                name
                    .trim()
                    .split(/\s+/)
                    .slice(0, 3)
                    .map((word) => word[0])
                    .join('')
            )}
        </span>
    );
}

export function GameDetails({ game, theme }: { game: Game; theme: ResolvedTheme }) {
    const innings = /baseball|softball/i.test(game.sport);
    const sets = /volleyball/i.test(game.sport);
    const halves = game.league !== 'NBA' && /men's basketball/i.test(game.sport);
    const regulation = halves ? 2 : 4;
    const timed = /basketball|football/i.test(game.sport);
    const unit = innings ? 'inning' : sets ? 'set' : 'period';
    const label = `Score by ${unit}`;
    const periodLabel = (period: number) =>
        !timed || innings
            ? String(period)
            : period > regulation
              ? `OT${period - regulation === 1 ? '' : period - regulation}`
              : `${halves ? 'H' : 'Q'}${period}`;
    const showLogistics = game.status !== 'final';
    const showMatchup = game.away && game.home;
    return (
        <>
            <header className="game-details-hero">
                <div className="game-details-kicker">
                    <span>
                        {game.league} · {game.sport}
                    </span>
                    <span className="game-details-status" data-status={game.status}>
                        {game.statusLabel}
                    </span>
                </div>
                {showMatchup ? (
                    <div className="game-details-matchup">
                        {(['away', 'home'] as const).map((side) => {
                            const name = game[side] ?? (side === 'away' ? 'Away' : 'Home');
                            return (
                                <div key={side} className={`game-details-team game-details-${side}`}>
                                    <TeamLogo name={name} src={game[`${side}Logo`]} theme={theme} />
                                    <strong>{name}</strong>
                                    {game[`${side}Record`] && <span>{game[`${side}Record`]}</span>}
                                </div>
                            );
                        })}
                        <div className="game-details-score" aria-label="Score, away then home">
                            {game.awayScore ?? '–'} <span>:</span> {game.homeScore ?? '–'}
                        </div>
                    </div>
                ) : (
                    <div className="game-details-title">{game.title}</div>
                )}
            </header>
            {game.lineScore?.length ? (
                <>
                    <h4>By {unit}</h4>
                    <div className="game-table-scroll" role="region" aria-label={label} tabIndex={0}>
                        <table aria-label={label} className={innings ? 'inning-scores' : undefined}>
                            <thead>
                                <tr>
                                    <th scope="col">Team</th>
                                    {game.lineScore.map(({ period }) => (
                                        <th key={period} scope="col">
                                            {periodLabel(period)}
                                        </th>
                                    ))}
                                    <th scope="col">{sets ? 'Sets won' : 'Total'}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(['away', 'home'] as const).map((side) => (
                                    <tr key={side}>
                                        <th scope="row">
                                            {game[`${side}Abbreviation`] ??
                                                game[side] ??
                                                (side === 'away' ? 'Away' : 'Home')}
                                        </th>
                                        {game.lineScore?.map((row) => (
                                            <td key={row.period}>{row[side] ?? '–'}</td>
                                        ))}
                                        <td>{game[`${side}Score`] ?? '–'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            ) : (
                <p>
                    {game.status === 'upcoming'
                        ? 'Scoring breakdown appears once the game starts.'
                        : 'Scoring breakdown unavailable.'}
                </p>
            )}
            {showLogistics && (
                <dl>
                    <div>
                        <dt>
                            <Clock aria-hidden="true" />
                            Start
                        </dt>
                        <dd>{formatStart(game)}</dd>
                    </div>
                    {game.venue && (
                        <div>
                            <dt>
                                <MapPin aria-hidden="true" />
                                Venue
                            </dt>
                            <dd>{game.venue}</dd>
                        </div>
                    )}
                    {game.broadcast && (
                        <div>
                            <dt>
                                <Tv aria-hidden="true" />
                                Broadcast
                            </dt>
                            <dd>{game.broadcast}</dd>
                        </div>
                    )}
                    {game.status === 'live' && game.situation && (
                        <div>
                            <dt>
                                <Info aria-hidden="true" />
                                Situation
                            </dt>
                            <dd>{game.situation}</dd>
                        </div>
                    )}
                </dl>
            )}
            <div className="game-details-actions">
                <a className="game-details-espn" href={game.sourceUrl} target="_blank" rel="noreferrer">
                    View game on ESPN
                    <ExternalLink size={14} aria-hidden="true" />
                </a>
            </div>
        </>
    );
}
