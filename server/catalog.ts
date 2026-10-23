import type { Team } from '../shared/contracts.js';

const espnNote = 'ESPN schedule with live scores: live games, the last 3 results and the next 5 games.';
const paths: Record<string, string> = { NFL: 'football/nfl', NBA: 'basketball/nba', MLB: 'baseball/mlb' };
const pro = (id: string, espnId: string, name: string, sport: string, league: string): Team => ({
    id,
    name,
    sport,
    league,
    providerId: `${paths[league]}/${espnId}`,
    officialUrl: `https://www.espn.com/${league.toLowerCase()}/team/_/id/${espnId}`,
    coverage: 'schedule-results',
    coverageNote: espnNote,
});
// ESPN feeds for Purdue programs; the rest link to the official schedule.
const purdueFeeds: Record<string, string> = {
    baseball: 'baseball/college-baseball/189',
    football: 'football/college-football/2509',
    'mens-basketball': 'basketball/mens-college-basketball/2509',
    'womens-basketball': 'basketball/womens-college-basketball/2509',
    soccer: 'soccer/usa.ncaa.w.1/20519',
    softball: 'baseball/college-softball/601',
    volleyball: 'volleyball/womens-college-volleyball/2509',
};
const programs: [string, string, string][] = [
    ['baseball', 'Baseball', 'baseball'],
    ['mens-cross-country', "Men's Cross Country", 'cross-country'],
    ['womens-cross-country', "Women's Cross Country", 'cross-country'],
    ['football', 'Football', 'football'],
    ['mens-basketball', "Men's Basketball", 'mens-basketball'],
    ['womens-basketball', "Women's Basketball", 'womens-basketball'],
    ['mens-golf', "Men's Golf", 'mens-golf'],
    ['womens-golf', "Women's Golf", 'womens-golf'],
    ['mens-swimming-diving', "Men's Swimming and Diving", 'mens-swimming-diving'],
    ['womens-swimming-diving', "Women's Swimming and Diving", 'womens-swimming-diving'],
    ['mens-tennis', "Men's Tennis", 'mens-tennis'],
    ['womens-tennis', "Women's Tennis", 'womens-tennis'],
    ['soccer', "Women's Soccer", 'soccer'],
    ['softball', 'Softball', 'softball'],
    ['mens-indoor-track', "Men's Indoor Track and Field", 'track-field'],
    ['womens-indoor-track', "Women's Indoor Track and Field", 'track-field'],
    ['mens-outdoor-track', "Men's Outdoor Track and Field", 'track-field'],
    ['womens-outdoor-track', "Women's Outdoor Track and Field", 'track-field'],
    ['volleyball', "Women's Volleyball", 'volleyball'],
    ['wrestling', 'Wrestling', 'wrestling'],
];

export const teams: Team[] = [
    pro('134927', '11', 'Indianapolis Colts', 'Football', 'NFL'),
    pro('134949', '26', 'Seattle Seahawks', 'Football', 'NFL'),
    pro('134873', '11', 'Indiana Pacers', 'Basketball', 'NBA'),
    pro('135279', '26', 'San Francisco Giants', 'Baseball', 'MLB'),
    {
        id: 'purdue-all',
        name: 'Purdue Boilermakers · All Varsity',
        sport: 'All sports',
        league: 'NCAA',
        officialUrl: 'https://purduesports.com',
        coverage: 'unavailable',
        coverageNote:
            'Includes every varsity program below. ESPN covers football, basketball, volleyball, soccer, baseball and softball.',
        purdue: true,
        umbrella: true,
    },
    ...programs.map(([slug, sport, page]): Team => ({
        id: `purdue-${slug}`,
        name: `Purdue · ${sport}`,
        sport,
        league: 'NCAA',
        officialUrl: `https://purduesports.com/sports/${page}/schedule`,
        coverage: purdueFeeds[slug] ? 'schedule-results' : 'unavailable',
        coverageNote: purdueFeeds[slug]
            ? `${espnNote} Off-season sports show no games.`
            : 'ESPN has no feed for this sport. Open the official schedule for current events and results.',
        ...(purdueFeeds[slug] ? { providerId: purdueFeeds[slug] } : {}),
        purdue: true,
    })),
    ...(
        [
            ['134946', '22', 'Arizona Cardinals', 'Football', 'NFL'],
            ['134942', '1', 'Atlanta Falcons', 'Football', 'NFL'],
            ['134922', '33', 'Baltimore Ravens', 'Football', 'NFL'],
            ['134918', '2', 'Buffalo Bills', 'Football', 'NFL'],
            ['134943', '29', 'Carolina Panthers', 'Football', 'NFL'],
            ['134938', '3', 'Chicago Bears', 'Football', 'NFL'],
            ['134923', '4', 'Cincinnati Bengals', 'Football', 'NFL'],
            ['134924', '5', 'Cleveland Browns', 'Football', 'NFL'],
            ['134934', '6', 'Dallas Cowboys', 'Football', 'NFL'],
            ['134930', '7', 'Denver Broncos', 'Football', 'NFL'],
            ['134880', '1', 'Atlanta Hawks', 'Basketball', 'NBA'],
            ['134860', '2', 'Boston Celtics', 'Basketball', 'NBA'],
            ['134861', '17', 'Brooklyn Nets', 'Basketball', 'NBA'],
            ['134881', '30', 'Charlotte Hornets', 'Basketball', 'NBA'],
            ['134870', '4', 'Chicago Bulls', 'Basketball', 'NBA'],
            ['134871', '5', 'Cleveland Cavaliers', 'Basketball', 'NBA'],
            ['134875', '6', 'Dallas Mavericks', 'Basketball', 'NBA'],
            ['134885', '7', 'Denver Nuggets', 'Basketball', 'NBA'],
            ['134872', '8', 'Detroit Pistons', 'Basketball', 'NBA'],
            ['134865', '9', 'Golden State Warriors', 'Basketball', 'NBA'],
            ['135267', '29', 'Arizona Diamondbacks', 'Baseball', 'MLB'],
            ['135261', '11', 'Athletics', 'Baseball', 'MLB'],
            ['135268', '15', 'Atlanta Braves', 'Baseball', 'MLB'],
            ['135251', '1', 'Baltimore Orioles', 'Baseball', 'MLB'],
            ['135252', '2', 'Boston Red Sox', 'Baseball', 'MLB'],
            ['135269', '16', 'Chicago Cubs', 'Baseball', 'MLB'],
            ['135253', '4', 'Chicago White Sox', 'Baseball', 'MLB'],
            ['135270', '17', 'Cincinnati Reds', 'Baseball', 'MLB'],
            ['135254', '5', 'Cleveland Guardians', 'Baseball', 'MLB'],
            ['135271', '27', 'Colorado Rockies', 'Baseball', 'MLB'],
        ] as [string, string, string, string, string][]
    ).map(([id, espnId, name, sport, league]) => pro(id, espnId, name, sport, league)),
];

export const defaultFavorites = ['134927', '134949', '134873', '135279', 'purdue-all'];

export function expandFavorites(favorites: string[]): Team[] {
    return teams.filter(
        (team) => !team.umbrella && (favorites.includes(team.id) || (favorites.includes('purdue-all') && team.purdue))
    );
}
