import type { Team } from '../shared/contracts.js';

const espnNote = 'ESPN schedule with live scores: live games, the last 3 results and the next 5 games.';

type ProLeague = 'NFL' | 'NBA' | 'MLB';

export interface LeagueSource {
    id: string;
    league: ProLeague | 'Big Ten';
    label: string;
    sport: string;
    path: string;
    byWeek: boolean;
    scoreboardUrl: string;
    // ESPN conference filter (groups=<n>) for college scoreboards.
    group?: string;
}

const proLeague = (league: ProLeague, sport: string, path: string, byWeek: boolean): LeagueSource => ({
    id: `league-${league.toLowerCase()}`,
    league,
    label: `${league} scoreboard`,
    sport,
    path,
    byWeek,
    scoreboardUrl: `https://www.espn.com/${league.toLowerCase()}/scoreboard`,
});

const proLeagues = [
    proLeague('NFL', 'Football', 'football/nfl', true),
    proLeague('NBA', 'Basketball', 'basketball/nba', false),
    proLeague('MLB', 'Baseball', 'baseball/mlb', false),
];

export const leagues: LeagueSource[] = [
    ...proLeagues,
    {
        id: 'league-b1g-football',
        league: 'Big Ten',
        label: 'Big Ten football scoreboard',
        sport: 'Football',
        path: 'football/college-football',
        byWeek: true,
        scoreboardUrl: 'https://www.espn.com/college-football/scoreboard/_/group/5',
        group: '5',
    },
    {
        id: 'league-b1g-mens-basketball',
        league: 'Big Ten',
        label: "Big Ten men's basketball scoreboard",
        sport: "Men's Basketball",
        path: 'basketball/mens-college-basketball',
        byWeek: false,
        scoreboardUrl: 'https://www.espn.com/mens-college-basketball/scoreboard/_/group/7',
        group: '7',
    },
];

// Teams saved before the full-league catalog keep their original ids so stored favorites still match.
const legacyIds: Record<string, string> = {
    'NFL:11': '134927',
    'NFL:26': '134949',
    'NFL:22': '134946',
    'NFL:1': '134942',
    'NFL:33': '134922',
    'NFL:2': '134918',
    'NFL:29': '134943',
    'NFL:3': '134938',
    'NFL:4': '134923',
    'NFL:5': '134924',
    'NFL:6': '134934',
    'NFL:7': '134930',
    'NBA:11': '134873',
    'NBA:1': '134880',
    'NBA:2': '134860',
    'NBA:17': '134861',
    'NBA:30': '134881',
    'NBA:4': '134870',
    'NBA:5': '134871',
    'NBA:6': '134875',
    'NBA:7': '134885',
    'NBA:8': '134872',
    'NBA:9': '134865',
    'MLB:26': '135279',
    'MLB:29': '135267',
    'MLB:11': '135261',
    'MLB:15': '135268',
    'MLB:1': '135251',
    'MLB:2': '135252',
    'MLB:16': '135269',
    'MLB:4': '135253',
    'MLB:17': '135270',
    'MLB:5': '135254',
    'MLB:27': '135271',
};

const proTeams: Record<ProLeague, string> = {
    NFL: '22 Arizona Cardinals;1 Atlanta Falcons;33 Baltimore Ravens;2 Buffalo Bills;29 Carolina Panthers;3 Chicago Bears;4 Cincinnati Bengals;5 Cleveland Browns;6 Dallas Cowboys;7 Denver Broncos;8 Detroit Lions;9 Green Bay Packers;34 Houston Texans;11 Indianapolis Colts;30 Jacksonville Jaguars;12 Kansas City Chiefs;13 Las Vegas Raiders;24 Los Angeles Chargers;14 Los Angeles Rams;15 Miami Dolphins;16 Minnesota Vikings;17 New England Patriots;18 New Orleans Saints;19 New York Giants;20 New York Jets;21 Philadelphia Eagles;23 Pittsburgh Steelers;25 San Francisco 49ers;26 Seattle Seahawks;27 Tampa Bay Buccaneers;10 Tennessee Titans;28 Washington Commanders',
    NBA: '1 Atlanta Hawks;2 Boston Celtics;17 Brooklyn Nets;30 Charlotte Hornets;4 Chicago Bulls;5 Cleveland Cavaliers;6 Dallas Mavericks;7 Denver Nuggets;8 Detroit Pistons;9 Golden State Warriors;10 Houston Rockets;11 Indiana Pacers;12 LA Clippers;13 Los Angeles Lakers;29 Memphis Grizzlies;14 Miami Heat;15 Milwaukee Bucks;16 Minnesota Timberwolves;3 New Orleans Pelicans;18 New York Knicks;25 Oklahoma City Thunder;19 Orlando Magic;20 Philadelphia 76ers;21 Phoenix Suns;22 Portland Trail Blazers;23 Sacramento Kings;24 San Antonio Spurs;28 Toronto Raptors;26 Utah Jazz;27 Washington Wizards',
    MLB: '29 Arizona Diamondbacks;11 Athletics;15 Atlanta Braves;1 Baltimore Orioles;2 Boston Red Sox;16 Chicago Cubs;4 Chicago White Sox;17 Cincinnati Reds;5 Cleveland Guardians;27 Colorado Rockies;6 Detroit Tigers;18 Houston Astros;7 Kansas City Royals;3 Los Angeles Angels;19 Los Angeles Dodgers;28 Miami Marlins;8 Milwaukee Brewers;9 Minnesota Twins;21 New York Mets;10 New York Yankees;22 Philadelphia Phillies;23 Pittsburgh Pirates;25 San Diego Padres;26 San Francisco Giants;12 Seattle Mariners;24 St. Louis Cardinals;30 Tampa Bay Rays;13 Texas Rangers;14 Toronto Blue Jays;20 Washington Nationals',
};

const pro = proLeagues.flatMap((source) =>
    proTeams[source.league as ProLeague].split(';').map((entry): Team => {
        const [espnId, ...words] = entry.split(' ');
        return {
            id: legacyIds[`${source.league}:${espnId}`] ?? `${source.league.toLowerCase()}-${espnId}`,
            name: words.join(' '),
            sport: source.sport,
            league: source.league,
            providerId: `${source.path}/${espnId}`,
            officialUrl: `https://www.espn.com/${source.league.toLowerCase()}/team/_/id/${espnId}`,
            coverage: 'schedule-results',
            coverageNote: `Included in the ${source.league} league scoreboard.`,
        };
    })
);
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
    ...pro,
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
];

// Maps an ESPN team id within a league path to the catalog id.
export function catalogTeamId(path: string, espnId: string): string | undefined {
    return teams.find((team) => team.providerId === `${path}/${espnId}`)?.id;
}

export const defaultFavorites = ['134927', '134949', '134873', '135279', 'purdue-all'];

export function expandFavorites(favorites: string[]): Team[] {
    return teams.filter(
        (team) => !team.umbrella && (favorites.includes(team.id) || (favorites.includes('purdue-all') && team.purdue))
    );
}
