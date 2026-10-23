const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');

export interface ClubSponsor {
  name: string;
  src: string;
}

/**
 * The club's sponsors, with the logos the club publishes on ndcc.com.au
 * (fetched 19 October 2026). Shown as a rolling advert beside each race's
 * winner and on the fence boards along the straight.
 */
const SPONSOR_FILES: ReadonlyArray<[name: string, file: string]> = [
  ['APCO Newcomb', 'Apco-Newcomb'],
  ['Bennett Racing', 'Bennett-Racing'],
  ['Blackmans Brewery', 'Blackmans-Brewery'],
  ['Care Plus Professionals', 'Care-Plus-Professionals'],
  ['Champion Trophies', 'Champion-Trophies'],
  ['Conveyancing Professionals', 'Conveyancing-Professionals'],
  ['Elyod Roof Tiling', 'Elyod-Roof-Tiling'],
  ['General Public Corio', 'General-Public-Corio'],
  ['Leopold Sporties', 'Leopold-Sporties'],
  ['Mahoney Real Estate', 'Mahoney-Real-Estate'],
  ['MBR Cricket', 'MBR-Cricket'],
  ['Moolap Tyres', 'Moolap-Tyres'],
  ['Phoenix Truck Bodies', 'Phoenix-Truck-Bodies'],
  ['Priceline Pharmacy', 'Priceline-Pharmacy'],
  ['The Breakwater Hotel', 'The-Breakwater-Hotel'],
  ['Vagabond Travel', 'Vagabond-Travel'],
];

export const CLUB_SPONSORS: readonly ClubSponsor[] = SPONSOR_FILES.map(([name, file]) => ({
  name,
  src: `${BASE_PATH}/sponsors/20261019-Sponsor-${file}-Rev00.webp`,
}));

/** A different starting sponsor each race, so every logo gets its turn at the top of the reel. */
export function sponsorsFromRace(raceNo: number): ClubSponsor[] {
  const n = CLUB_SPONSORS.length;
  const start = (((Math.floor(raceNo) - 1) * 3) % n + n) % n;
  return [...CLUB_SPONSORS.slice(start), ...CLUB_SPONSORS.slice(0, start)];
}

const key = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** A club sponsor by name, ignoring case and punctuation. */
export const clubSponsorNamed = (name: string | undefined): ClubSponsor | null => {
  const k = key(name ?? '');
  return k ? (CLUB_SPONSORS.find((s) => key(s.name) === k) ?? null) : null;
};

/**
 * The logo that goes with a race sponsor: the club sponsor chosen for it,
 * else the club sponsor of the same name, else none (the name is shown).
 * "none" asks for the crest and the name only.
 */
export const raceSponsorArt = (name: string, logo?: string): ClubSponsor | null => {
  const pick = logo?.trim() ?? '';
  if (pick.toLowerCase() === 'none') return null;
  return pick ? clubSponsorNamed(pick) : clubSponsorNamed(name);
};
