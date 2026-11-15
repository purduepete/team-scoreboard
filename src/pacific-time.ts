export const pacificTimeZone = 'America/Los_Angeles';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: pacificTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

export function pacificDate(date = new Date()): string {
    return dateFormatter.format(date);
}

export function formatDate(date: string, includeYear = true): string {
    const [year, month, day] = date.split('-');
    return `${month}/${day}${includeYear ? `/${year}` : ''}`;
}

export function formatPacificTime(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: pacificTimeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).format(date);
}

export function nextPacificMidnight(now: Date): number {
    const tomorrow = Date.parse(`${pacificDate(now)}T00:00:00Z`) + 86_400_000;
    const probe = tomorrow + 8 * 60 * 60_000;
    const hour = Number(
        new Intl.DateTimeFormat('en-US', {
            timeZone: pacificTimeZone,
            hour: '2-digit',
            hourCycle: 'h23',
        }).format(probe)
    );
    return probe - hour * 60 * 60_000;
}
