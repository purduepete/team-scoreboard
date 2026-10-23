import type { Game } from '../shared/contracts.js';

const uidDomain = 'team-scoreboard.jimlertech.com';
const durationMinutes: Record<string, number> = { Football: 210, Basketball: 150, Baseball: 180 };

// RFC 5545 TEXT escaping: backslash, semicolon, comma and line breaks.
export function escapeText(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Lines longer than 75 octets continue on the next line after a space, never splitting a UTF-8 character.
export function foldLine(line: string): string {
    const parts: string[] = [];
    let current = '';
    let size = 0;
    for (const char of line) {
        const bytes = Buffer.byteLength(char, 'utf8');
        const limit = parts.length ? 74 : 75;
        if (size + bytes > limit) {
            parts.push(current);
            current = '';
            size = 0;
        }
        current += char;
        size += bytes;
    }
    parts.push(current);
    return parts.join('\r\n ');
}

const stamp = (time: number) =>
    new Date(time)
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
const day = (date: string) => date.replaceAll('-', '');
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export function eventTitle(game: Game): string {
    const matchup = game.home && game.away ? `${game.away} at ${game.home}` : game.title;
    if (game.status === 'postponed') return `Postponed: ${matchup}`;
    if (game.status === 'canceled') return `Canceled: ${matchup}`;
    if (game.status === 'final' && game.home && game.away && game.homeScore !== null && game.awayScore !== null)
        return `${game.away} ${game.awayScore}, ${game.home} ${game.homeScore} (Final)`;
    return matchup;
}

function description(game: Game): string {
    const records = [
        game.away && game.awayRecord ? `${game.away} ${game.awayRecord}` : '',
        game.home && game.homeRecord ? `${game.home} ${game.homeRecord}` : '',
    ].filter(Boolean);
    return [
        `${game.league} ${game.sport}`,
        records.length ? `Records: ${records.join(', ')}` : '',
        game.broadcast ? `TV: ${game.broadcast}` : '',
        game.sourceUrl,
    ]
        .filter(Boolean)
        .join('\n');
}

function event(game: Game, now: number): string[] | null {
    let timing: string[];
    if (game.startTime) {
        const start = Date.parse(game.startTime);
        const minutes = durationMinutes[game.sport] ?? 180;
        timing = [`DTSTART:${stamp(start)}`, `DTEND:${stamp(start + minutes * 60_000)}`];
    } else if (game.date) {
        timing = [`DTSTART;VALUE=DATE:${day(game.date)}`, `DTEND;VALUE=DATE:${day(nextDay(game.date))}`];
    } else return null;
    return [
        'BEGIN:VEVENT',
        `UID:${game.id}@${uidDomain}`,
        `DTSTAMP:${stamp(now)}`,
        ...timing,
        `SUMMARY:${escapeText(eventTitle(game))}`,
        ...(game.broadcast ? [`LOCATION:${escapeText(`TV: ${game.broadcast}`)}`] : []),
        `DESCRIPTION:${escapeText(description(game))}`,
        `URL:${game.sourceUrl}`,
        ...(game.status === 'canceled' ? ['STATUS:CANCELLED'] : []),
        'END:VEVENT',
    ];
}

export function buildCalendar(games: Game[], now: number): string {
    const sorted = [...games].sort((a, b) => (a.startTime ?? a.date ?? '').localeCompare(b.startTime ?? b.date ?? ''));
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//JimlerTech//Team Scoreboard//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Team Scoreboard',
        'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
        'X-PUBLISHED-TTL:PT1H',
        ...sorted.flatMap((game) => event(game, now) ?? []),
        'END:VCALENDAR',
    ];
    return lines.map(foldLine).join('\r\n') + '\r\n';
}
