import { freshCard, type CardState } from './card';
import type { RaceSponsor } from './types';

export type { RaceSponsor } from './types';

/**
 * The NDCC snail racing night of 24 October 2026, as sold on ndcc.com.au.
 *
 * Taken from the club's orders export of 23 October 2026
 * (20261023-NDCC-All-Orders-event-Snail-Racing-Rev01.csv): every snail
 * number with the name its buyer gave it and the buyer's name as the owner,
 * and the four races that were sponsored. Contact details are not copied.
 * Numbers 76 and 80 were not sold and run as "Snail 76" and "Snail 80".
 *
 * The card is eight races of eleven (snails 1 to 11 in race 1, 12 to 22 in
 * race 2, and so on), so the sponsored race numbers the website sold (1, 5,
 * 6 and 7 of eight) are the races that carry those sponsors on the night.
 * Everything here can be changed on the desk or in Admin; this is only the
 * starting point a fresh night (or Admin, Setup, "Load the NDCC orders")
 * takes.
 */

export const NDCC_NIGHT_SNAILS = 88;
export const NDCC_NIGHT_RACES = 8;
export const NDCC_NIGHT_RUNNERS = 11;
/** Snails sold for $10 each on the website. */
export const NDCC_NIGHT_SNAIL_CENTS = 1000;
/** The date of the orders export the roster was taken from. */
export const NDCC_ROSTER_DATE = '2026-10-23';

/** [number, snail name, owner]. */
const ROSTER: ReadonlyArray<readonly [number, string, string]> = [
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
  [77, 'SnailerSwift', 'Matthew Grills'],
  [78, 'Cal Brownlie', 'Nathan Keevil'],
  [79, 'Harv', 'Nathan Keevil'],
  [81, 'ZacSnailey', 'Matthew Grills'],
  [82, 'Ricky Bobby', 'Aaron Cox'],
  [83, 'Frank', "Tyler O'Neill"],
  [84, 'Lightning McShell', 'Aaron Cox'],
  [85, 'Voltwyn', 'Sajeevan Veeriah'],
  [86, 'Veeriah', 'Sajeevan Veeriah'],
  [87, 'Unlucky for some', 'Devlin'],
  [88, 'Snailvester Stallone', 'Jackson Brown'],
];

/**
 * The sponsored races. Race 5 was bought by Ruby Moreland for the NDCC
 * women; the club asked for it to read "NDCC Womens".
 */
export const NDCC_RACE_SPONSORS: readonly RaceSponsor[] = [
  { race: 1, name: 'Grey Dinos', title: 'The Grey Dinos Hcap Stakes' },
  { race: 5, name: 'NDCC Womens', title: 'The Dino-Mite Drag Race Stakes' },
  { race: 6, name: 'John Elliott', title: 'The 2-Cent-Jack Stakes' },
  { race: 7, name: 'Troy Whitworth', title: 'The Phoenix Gold Cup Stakes' },
];

/** Names and owners per snail number, index 0 is snail 1, blank where unsold. */
export function ndccRoster(count = NDCC_NIGHT_SNAILS): { names: string[]; owners: string[] } {
  const names = new Array<string>(count).fill('');
  const owners = new Array<string>(count).fill('');
  for (const [n, name, owner] of ROSTER) {
    if (n > count) continue;
    names[n - 1] = name;
    owners[n - 1] = owner;
  }
  return { names, owners };
}

/** The night's card: eight races of eleven with the roster filled in. */
export function ndccCard(): CardState {
  const card = freshCard();
  const { names, owners } = ndccRoster();
  return {
    ...card,
    snailCount: NDCC_NIGHT_SNAILS,
    snailsPerRace: NDCC_NIGHT_RUNNERS,
    races: Array.from({ length: NDCC_NIGHT_RACES }, () => ({ runners: NDCC_NIGHT_RUNNERS })),
    names,
    owners,
    snailCents: NDCC_NIGHT_SNAIL_CENTS,
  };
}

/** A fresh copy of the night's race sponsors, safe to edit. */
export const ndccRaceSponsors = (): RaceSponsor[] => NDCC_RACE_SPONSORS.map((s) => ({ ...s }));

/**
 * Fill an existing card with the roster. Numbers that already have a name
 * typed on the desk keep it unless `overwrite`; numbers past the card's
 * count are left for the run sheet to grow into.
 */
export function withNdccRoster(card: CardState, overwrite = false, keep: ReadonlySet<number> = new Set()): CardState {
  const { names, owners } = ndccRoster(card.snailCount);
  const next = { ...card, names: card.names.slice(), owners: card.owners.slice() };
  for (let i = 0; i < card.snailCount; i++) {
    if (!names[i] || keep.has(i + 1)) continue;
    if (overwrite || !next.names[i]?.trim()) {
      next.names[i] = names[i];
      next.owners[i] = owners[i];
    }
  }
  return next;
}

/** Clean a race sponsor list from storage: one per race, trimmed, bounded. */
export function normaliseRaceSponsors(value: unknown): RaceSponsor[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const out: RaceSponsor[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Partial<RaceSponsor>;
    const race = Number(v.race);
    const name = typeof v.name === 'string' ? v.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    if (!Number.isSafeInteger(race) || race < 1 || race > 40 || !name || seen.has(race)) continue;
    seen.add(race);
    const title = typeof v.title === 'string' ? v.title.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    out.push(title ? { race, name, title } : { race, name });
  }
  return out.sort((a, b) => a.race - b.race);
}

/** The sponsor of one race, from the per-race list. */
export const raceSponsorFor = (list: readonly RaceSponsor[] | undefined, raceNo: number): RaceSponsor | null =>
  list?.find((s) => s.race === raceNo) ?? null;

/**
 * Who sponsors a race: its own sponsor when one was sold for it, otherwise
 * the next name from the night's cycled list (with no race name).
 */
export function resolveRaceSponsor(
  raceSponsors: readonly RaceSponsor[] | undefined,
  cycled: readonly string[],
  raceNo: number,
): { name: string; title: string } {
  const own = raceSponsorFor(raceSponsors, raceNo);
  if (own) return { name: own.name, title: own.title ?? '' };
  const live = cycled.map((s) => s.trim()).filter(Boolean);
  if (!live.length || raceNo < 1) return { name: '', title: '' };
  return { name: live[(raceNo - 1) % live.length], title: '' };
}
