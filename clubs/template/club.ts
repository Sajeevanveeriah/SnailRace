import type { ClubProfile } from '../types';

/**
 * A starting point for a new club. `npm run club -- new <id> "Club name" "SHORT"`
 * copies this folder to clubs/<id>. Then:
 *
 *   1. Put the club's crest in assets/ (PNG with a transparent background, or
 *      SVG) and set `crest` to its file name and pixel size.
 *   2. Optional: a lobby poster and a share image (900 x 1125 works well).
 *   3. Put each sponsor's logo in assets/sponsors/ and list it in `sponsors`.
 *   4. Set the colours, the event defaults and the place the commentator names.
 *   5. Optional: `night`, the card the club has already sold. See clubs/ndcc.
 *
 * Then `CLUB=<id> npm run dev` to see it, and `CLUB=<id> npm run build` to ship it.
 */
const club: ClubProfile = {
  id: 'template',
  name: 'Your Sports Club',
  shortName: 'YSC',
  place: 'the club',
  crest: { file: 'crest.svg', width: 400, height: 480 },
  colours: { primary: '#1f2a37', accent: '#d9dee5' },
  clubTeamPatterns: [],
  sponsors: [],
  event: {
    name: 'Snail Racing',
    tagline: 'A night at the races',
    date: '',
    startTime: '19:00',
    venue: 'Club rooms',
    timezone: 'Australia/Melbourne',
    goalCents: 100_000,
    description: 'Your Sports Club presents Snail Racing: a night at the races. Buy a snail, name it, cheer it home.',
  },
};

export default club;
