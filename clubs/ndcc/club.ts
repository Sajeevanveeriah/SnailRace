import type { ClubProfile } from '../types';

/**
 * Newcomb & District Cricket Club.
 *
 * The night card is the snail racing night of 24 October 2026, as sold on
 * ndcc.com.au: taken from the club website's order records as they stood at
 * 07:20 on 24 October 2026 (AEDT), every snail number with the name its
 * buyer gave it and the buyer's name as the owner, and the six races that
 * were sponsored. All 88 numbers are sold. Contact details are not copied.
 *
 * The card is eleven races of eight (snails 1 to 8 in race 1, 9 to 16 in
 * race 2, and so on), the card the website sold, so the sponsored race
 * numbers the website sold (1, 5, 6, 7, 9 and 11) are the races that carry
 * those sponsors on the night.
 *
 * Sponsor logos are the ones the club publishes on ndcc.com.au (fetched 19
 * October 2026).
 */
const ndcc: ClubProfile = {
  id: 'ndcc',
  name: 'Newcomb & District Cricket Club',
  shortName: 'NDCC',
  place: 'Newcomb',
  website: 'https://ndcc.com.au',
  crest: { file: 'brand/20260403-NDCC-Logo-Bg-Removed-Rev00.png', width: 1184, height: 896 },
  poster: { file: 'brand/20261003-NDCC-Snail-Racing-Poster-Rev00.webp', width: 900, height: 1125 },
  posterFocus: { zoom: 3, shiftY: -54.4 },
  shareImage: { file: 'brand/20261021-NDCC-Snail-Racing-Poster-Share-Rev00.webp', width: 900, height: 1125 },
  colours: { primary: '#b3141c', accent: '#e8b55e', secondary: '#1c4fa0', highlight: '#d8a018' },
  clubTeamPatterns: ['^\\s*ndcc\\b', '\\bdinos?\\b'],
  sponsors: [
    { name: 'APCO Newcomb', file: 'sponsors/20261019-Sponsor-Apco-Newcomb-Rev00.webp' },
    { name: 'Bennett Racing', file: 'sponsors/20261019-Sponsor-Bennett-Racing-Rev00.webp' },
    { name: 'Blackmans Brewery', file: 'sponsors/20261019-Sponsor-Blackmans-Brewery-Rev00.webp' },
    { name: 'Care Plus Professionals', file: 'sponsors/20261019-Sponsor-Care-Plus-Professionals-Rev00.webp' },
    { name: 'Champion Trophies', file: 'sponsors/20261019-Sponsor-Champion-Trophies-Rev00.webp' },
    { name: 'Conveyancing Professionals', file: 'sponsors/20261019-Sponsor-Conveyancing-Professionals-Rev00.webp' },
    { name: 'Elyod Roof Tiling', file: 'sponsors/20261019-Sponsor-Elyod-Roof-Tiling-Rev00.webp' },
    { name: 'General Public Corio', file: 'sponsors/20261019-Sponsor-General-Public-Corio-Rev00.webp' },
    { name: 'Leopold Sporties', file: 'sponsors/20261019-Sponsor-Leopold-Sporties-Rev00.webp' },
    { name: 'Mahoney Real Estate', file: 'sponsors/20261019-Sponsor-Mahoney-Real-Estate-Rev00.webp' },
    { name: 'MBR Cricket', file: 'sponsors/20261019-Sponsor-MBR-Cricket-Rev00.webp' },
    { name: 'Moolap Tyres', file: 'sponsors/20261019-Sponsor-Moolap-Tyres-Rev00.webp' },
    { name: 'Phoenix Truck Bodies', file: 'sponsors/20261019-Sponsor-Phoenix-Truck-Bodies-Rev00.webp' },
    { name: 'Priceline Pharmacy', file: 'sponsors/20261019-Sponsor-Priceline-Pharmacy-Rev00.webp' },
    { name: 'The Breakwater Hotel', file: 'sponsors/20261019-Sponsor-The-Breakwater-Hotel-Rev00.webp' },
    { name: 'Vagabond Travel', file: 'sponsors/20261019-Sponsor-Vagabond-Travel-Rev00.webp' },
  ],
  event: {
    name: 'Snail Racing',
    tagline: 'A night at the races',
    date: '2026-10-24',
    startTime: '19:00',
    venue: 'Club rooms',
    timezone: 'Australia/Melbourne',
    goalCents: 100_000,
    description:
      'Newcomb & District Cricket Club presents Snail Racing: a night at the races, Saturday 24 October 2026 from 7 pm at the club rooms. Buy a snail, name it, cheer it home. Slow race, big cheers.',
  },
  night: {
    loadLabel: 'Load the NDCC orders (24 Oct)',
    snails: 88,
    runnersPerRace: 8,
    /* Snails sold for $10 each on the website. */
    snailCents: 1000,
    roster: [
      [1, 'Flat Stanley', 'Troy Whitworth'],
      [2, 'Snailey Cyrus', 'John Elliott'],
      [3, 'In the job', 'Grey Dinos'],
      [4, 'Turbo', 'Sammy Diamond'],
      [5, 'Rightfully Mine', 'Josh Walker'],
      [6, 'Snailasaurus Rex', 'Ruby Moreland'],
      [7, 'Escar-Go', 'John Elliott'],
      [8, 'Having a Blast', 'Rick McHutchison'],
      [9, 'Sparkles', 'Gracie Whitworth'],
      [10, 'Mi-Shell', 'Sammy Diamond'],
      [11, 'Legs 11', 'Jayde'],
      [12, 'Sir Shells-a-lot', 'Ruby Moreland'],
      [13, 'Buster slimes', 'Caitlen Hall'],
      [14, 'King Murray', 'Grey Dinos'],
      [15, 'Longview', 'Rick McHutchison'],
      [16, 'Shelldon', 'John Elliott'],
      [17, 'Snile Horan', 'Jason'],
      [18, 'Reggie', 'Sammy Diamond'],
      [19, 'Timmy Tugger', 'Kelsey & Rhys'],
      [20, 'Basket Case', 'Rick McHutchison'],
      [21, 'Marvellous Morgs', 'Craig Hillgrove'],
      [22, 'Snailor swift', 'Caitlen Hall'],
      [23, 'Sir Slimes-a-lot', 'John Elliott'],
      [24, 'Silver Sovereign', 'Garth Ballantine'],
      [25, 'Wah', 'Rhys Bath'],
      [26, 'Tantalising Tiz', 'Craig Hillgrove'],
      [27, 'Grand Pierro', 'Troy Whitworth'],
      [28, 'Man Down', 'Grey Dinos'],
      [29, 'Welcome To Paradise', 'Rick McHutchison'],
      [30, 'Melt', 'Kelsey & Rhys'],
      [31, 'Tiny Chompa', 'Ruby Moreland'],
      [32, 'The pitch is your b****h', 'Hannah'],
      [33, 'Bubbles', 'Tyson'],
      [34, 'JustShortOfALength', 'Marcus Pearson'],
      [35, 'Sassafras Roots', 'Rick McHutchison'],
      [36, 'Hagrid', 'Marcus Pearson'],
      [37, 'The Sizzler', 'Garth Ballantine'],
      [38, 'Gary', 'Charlie Benson'],
      [39, 'Squirt', 'Laura Hudson'],
      [40, "Quaz'on", 'Craig Hillgrove'],
      [41, 'Clean your room', 'Marcus Pearson'],
      [42, 'Brainstew', 'Rick McHutchison'],
      [43, 'Slime shady', 'Caitlen Hall'],
      [44, "Cam's Cameo", 'Craig Hillgrove'],
      [45, 'Slimey', 'Elise'],
      [46, 'Jake the snake', 'Marcus Pearson'],
      [47, 'Shellraiser', 'Ruby Moreland'],
      [48, 'Camp Captain', 'Grey Dinos'],
      [49, 'American Idiot', 'Rick McHutchison'],
      [50, "Where's Blake", 'Craig Hillgrove'],
      [51, 'Humpty Dumpty', 'Marcus Pearson'],
      [52, 'Shut it Down', 'Grey Dinos'],
      [53, 'Extiction matters', 'John Elliott'],
      [54, "Harro's heroics", 'Craig Hillgrove'],
      [55, 'Rightfully Mine Twice', 'Josh Walker'],
      [56, 'Hot wheels', 'Cam Egan'],
      [57, 'Garçon', 'Jodie Clark'],
      [58, 'Bilow', 'Scott Kirby'],
      [59, 'Cut shot', 'Rhys Bath'],
      [60, 'The Moist Menace', 'Ruby Moreland'],
      [61, 'Ka Ying rising', 'Jason'],
      [62, 'Jesus of Suburbia', 'Rick McHutchison'],
      [63, '9 overs Robbo', 'Craig Hillgrove'],
      [64, 'The Randy Limpet', 'Charlie Benson'],
      [65, '21 Guns', 'Rick McHutchison'],
      [66, 'Slow-Ceratops', 'John Elliott'],
      [67, '67', 'Hannah'],
      [68, 'Fossil Fuel', 'John Elliott'],
      [69, 'Hobbsy', 'Kelly Hobbs'],
      [70, 'Tri-salad-tops', 'John Elliott'],
      [71, 'Grindosaurus', 'John Elliott'],
      [72, 'King Kirby', 'Scott Kirby'],
      [73, 'pommy', 'Huey Nield'],
      [74, 'english takeover', 'Huey Nield'],
      [75, 'Crows', 'Freddie Norridge'],
      [76, 'NDCC Juniors', 'Sajeevan Veeriah'],
      [77, 'SnailerSwift', 'Matthew Grills'],
      [78, 'Cal Brownlie', 'Nathan Keevil'],
      [79, 'Harv', 'Nathan Keevil'],
      [80, 'NDCC Seniors', 'Sajeevan Veeriah'],
      [81, 'ZacSnailey', 'Matthew Grills'],
      [82, 'Ricky Bobby', 'Aaron Cox'],
      [83, 'Frank', "Tyler O'Neill"],
      [84, 'Lightning McShell', 'Aaron Cox'],
      [85, 'Voltwyn', 'Sajeevan Veeriah'],
      [86, 'Veeriah', 'Sajeevan Veeriah'],
      [87, 'Unlucky for some', 'Devlin'],
      [88, 'Snailvester Stallone', 'Jackson Brown'],
    ],
    /*
     * Race 5 was bought by Ruby Moreland for the NDCC women and reads "NDCC
     * Womens team"; race 1 is the Grey Dinos. Both are club teams, so they
     * wear the club crest. Race 11 was bought by Elyod Roof Tiling, one of
     * the club's sponsors, and shows its logo beside the crest. Race 7, Troy
     * Whitworth's Phoenix Gold Cup, shows the Phoenix Truck Bodies logo (the
     * club asked for it). A sponsor with no logo of its own (John Elliott,
     * Laura Hudson) shows its name beside the crest.
     */
    raceSponsors: [
      { race: 1, name: 'Grey Dinos', title: 'The Grey Dinos Hcap Stakes' },
      { race: 5, name: 'NDCC Womens team', title: 'The Dino-Mite Drag Race Stakes' },
      { race: 6, name: 'John Elliott', title: 'The 2-Cent-Jack Stakes' },
      { race: 7, name: 'Troy Whitworth', title: 'The Phoenix Gold Cup Stakes', logo: 'Phoenix Truck Bodies' },
      { race: 9, name: 'Laura Hudson', title: 'The Drunken Stagger Stakes' },
      { race: 11, name: 'Elyod Roof Tiling', title: "The Shiv's Bouffant Stakes", logo: 'Elyod Roof Tiling' },
    ],
    /*
     * Every race its own track, length, laps and surprise level, shuffled so
     * no two races in a row feel the same, and the last race the Final. On a
     * circuit `lengthMs` is one lap.
     */
    racePlan: [
      { design: 'straight', lengthMs: 30_000, intensity: 'chaos' },
      { design: 'pavilion-chicane', lengthMs: 20_000, laps: 2, intensity: 'big' },
      { design: 'straight', lengthMs: 45_000, intensity: 'mayhem' },
      { design: 'floodlight-eight', lengthMs: 30_000, laps: 1, intensity: 'chaos' },
      { design: 'practice-nets', lengthMs: 20_000, laps: 3, intensity: 'big' },
      { design: 'straight', lengthMs: 20_000, intensity: 'standard' },
      { design: 'boundary-oval', lengthMs: 30_000, laps: 2, intensity: 'mayhem' },
      { design: 'pavilion-chicane', lengthMs: 45_000, laps: 1, intensity: 'chaos' },
      { design: 'straight', lengthMs: 60_000, intensity: 'big' },
      { design: 'floodlight-eight', lengthMs: 20_000, laps: 2, intensity: 'chaos' },
      { design: 'boundary-oval', lengthMs: 45_000, laps: 2, intensity: 'mayhem', raceType: 'Final' },
    ],
    /*
     * The sponsor lists earlier builds loaded: 5.5 (8 races of 11, four
     * sponsors), 5.6 (five sponsors, before race 9 was sold) and the six
     * sponsors before race 7 took the Phoenix logo.
     */
    previousSponsorKeys: [
      [
        'Grey Dinos|The Grey Dinos Hcap Stakes|1',
        'NDCC Womens|The Dino-Mite Drag Race Stakes|5',
        'John Elliott|The 2-Cent-Jack Stakes|6',
        'Troy Whitworth|The Phoenix Gold Cup Stakes|7',
      ].join(';'),
      [
        'Grey Dinos|The Grey Dinos Hcap Stakes|1',
        'NDCC Womens team|The Dino-Mite Drag Race Stakes|5',
        'John Elliott|The 2-Cent-Jack Stakes|6',
        'Troy Whitworth|The Phoenix Gold Cup Stakes|7',
        "Elyod Roof Tiling|The Shiv's Bouffant Stakes|11|Elyod Roof Tiling",
      ].join(';'),
      [
        'Grey Dinos|The Grey Dinos Hcap Stakes|1',
        'NDCC Womens team|The Dino-Mite Drag Race Stakes|5',
        'John Elliott|The 2-Cent-Jack Stakes|6',
        'Troy Whitworth|The Phoenix Gold Cup Stakes|7',
        'Laura Hudson|The Drunken Stagger Stakes|9',
        "Elyod Roof Tiling|The Shiv's Bouffant Stakes|11|Elyod Roof Tiling",
      ].join(';'),
    ],
    /* 5.5 sold eight races of eleven. */
    previousRunnersPerRace: 11,
  },
};

export default ndcc;
