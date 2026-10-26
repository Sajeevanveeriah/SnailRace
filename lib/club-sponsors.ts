import { CLUB, clubAsset } from './club';

export interface ClubSponsor {
  name: string;
  src: string;
}

/**
 * The club's sponsors and their logos, from the club's profile
 * (`clubs/<id>/club.ts`). Shown as a rolling advert beside each race's
 * winner and on the fence boards along the straight.
 */
export const CLUB_SPONSORS: readonly ClubSponsor[] = CLUB.sponsors.map(({ name, file }) => ({ name, src: clubAsset(file) }));

/** A different starting sponsor each race, so every logo gets its turn at the top of the reel. */
export function sponsorsFromRace(raceNo: number): ClubSponsor[] {
  const n = CLUB_SPONSORS.length;
  if (!n) return [];
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
