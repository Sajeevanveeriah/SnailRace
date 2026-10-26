import profile from '../clubs/active';
import type { ClubImage, ClubProfile } from '../clubs/types';

export type { ClubImage, ClubProfile } from '../clubs/types';

const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');

/**
 * The club this build is for. `clubs/active.ts` is written by
 * `scripts/club.mjs` before every dev, build, typecheck and test run (the
 * club named by CLUB, NDCC by default), and that club's assets are copied
 * to `public/club/`. Nothing else in the app names a club.
 */
export const CLUB: ClubProfile = profile;

/** The public URL of one of the club's asset files. */
export const clubAsset = (file: string): string => `${BASE_PATH}/club/${file.replace(/^\/+/, '')}`;

export const clubImage = (image: ClubImage): ClubImage & { src: string } => ({ ...image, src: clubAsset(image.file) });

/** The page title suffix: "NDCC Snail Racing". */
export const CLUB_TITLE = `${CLUB.shortName} ${CLUB.event.name}`.trim();

const teamPatterns = (CLUB.clubTeamPatterns ?? []).map((p) => new RegExp(p, 'i'));

/** A race sponsor that is one of the club's own teams, so wears the crest alone. */
export const isClubTeam = (name: string): boolean => teamPatterns.some((re) => re.test(name));
