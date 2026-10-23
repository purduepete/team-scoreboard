import type { Team } from '../shared/contracts.js';

const limited =
    'Limited free feed: at most one upcoming event and one recent result. The provider documents possible home-game-only limits; schedules may be incomplete. No live scores.';
const pro = (id: string, name: string, sport: string, league: string): Team => ({
    id,
    name,
    sport,
    league,
    providerId: id,
    officialUrl: `https://www.thesportsdb.com/team/${id}`,
    coverage: 'schedule-results',
    coverageNote: limited,
});
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
    pro('134927', 'Indianapolis Colts', 'Football', 'NFL'),
    pro('134949', 'Seattle Seahawks', 'Football', 'NFL'),
    pro('134873', 'Indiana Pacers', 'Basketball', 'NBA'),
    pro('135279', 'San Francisco Giants', 'Baseball', 'MLB'),
    {
        id: 'purdue-all',
        name: 'Purdue Boilermakers · All Varsity',
        sport: 'All sports',
        league: 'NCAA',
        officialUrl: 'https://purduesports.com',
        coverage: 'unavailable',
        coverageNote: 'Includes every varsity program below. Only football has a verified free feed in this version.',
        purdue: true,
        umbrella: true,
    },
    ...programs.map(([slug, sport, page]): Team => ({
        id: `purdue-${slug}`,
        name: `Purdue · ${sport}`,
        sport,
        league: 'NCAA',
        officialUrl: `https://purduesports.com/sports/${page}/schedule`,
        coverage: slug === 'football' ? 'schedule-results' : 'unavailable',
        coverageNote:
            slug === 'football'
                ? limited
                : 'No verified free feed configured. Open the official schedule for current events and results.',
        ...(slug === 'football' ? { providerId: '136942' } : {}),
        purdue: true,
    })),
    ...(
        [
            ['134946', 'Arizona Cardinals', 'Football', 'NFL'],
            ['134942', 'Atlanta Falcons', 'Football', 'NFL'],
            ['134922', 'Baltimore Ravens', 'Football', 'NFL'],
            ['134918', 'Buffalo Bills', 'Football', 'NFL'],
            ['134943', 'Carolina Panthers', 'Football', 'NFL'],
            ['134938', 'Chicago Bears', 'Football', 'NFL'],
            ['134923', 'Cincinnati Bengals', 'Football', 'NFL'],
            ['134924', 'Cleveland Browns', 'Football', 'NFL'],
            ['134934', 'Dallas Cowboys', 'Football', 'NFL'],
            ['134930', 'Denver Broncos', 'Football', 'NFL'],
            ['134880', 'Atlanta Hawks', 'Basketball', 'NBA'],
            ['134860', 'Boston Celtics', 'Basketball', 'NBA'],
            ['134861', 'Brooklyn Nets', 'Basketball', 'NBA'],
            ['134881', 'Charlotte Hornets', 'Basketball', 'NBA'],
            ['134870', 'Chicago Bulls', 'Basketball', 'NBA'],
            ['134871', 'Cleveland Cavaliers', 'Basketball', 'NBA'],
            ['134875', 'Dallas Mavericks', 'Basketball', 'NBA'],
            ['134885', 'Denver Nuggets', 'Basketball', 'NBA'],
            ['134872', 'Detroit Pistons', 'Basketball', 'NBA'],
            ['134865', 'Golden State Warriors', 'Basketball', 'NBA'],
            ['135267', 'Arizona Diamondbacks', 'Baseball', 'MLB'],
            ['135261', 'Athletics', 'Baseball', 'MLB'],
            ['135268', 'Atlanta Braves', 'Baseball', 'MLB'],
            ['135251', 'Baltimore Orioles', 'Baseball', 'MLB'],
            ['135252', 'Boston Red Sox', 'Baseball', 'MLB'],
            ['135269', 'Chicago Cubs', 'Baseball', 'MLB'],
            ['135253', 'Chicago White Sox', 'Baseball', 'MLB'],
            ['135270', 'Cincinnati Reds', 'Baseball', 'MLB'],
            ['135254', 'Cleveland Guardians', 'Baseball', 'MLB'],
            ['135271', 'Colorado Rockies', 'Baseball', 'MLB'],
        ] as [string, string, string, string][]
    ).map(([id, name, sport, league]) => pro(id, name, sport, league)),
];

export const defaultFavorites = ['134927', '134949', '134873', '135279', 'purdue-all'];

export function expandFavorites(favorites: string[]): Team[] {
    return teams.filter(
        (team) => !team.umbrella && (favorites.includes(team.id) || (favorites.includes('purdue-all') && team.purdue))
    );
}
