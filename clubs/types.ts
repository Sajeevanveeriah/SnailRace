import type { RaceSponsor } from '../lib/types';
import type { RunSheetRace } from '../lib/card';

/**
 * Everything that makes the snail race one club's night rather than another's.
 *
 * Each club lives in its own folder, `clubs/<id>/`, holding a `club.ts` that
 * exports one of these and an `assets/` folder for its crest, poster and
 * sponsor logos. `npm run club -- use <id>` (or CLUB=<id> on any build)
 * selects the club: it writes `clubs/active.ts` and copies that club's
 * assets, and only that club's, into `public/club/`. So a build for one club
 * never ships another club's names, logos or roster.
 *
 * File paths in a profile are relative to the club's `assets/` folder.
 */
export interface ClubImage {
  file: string;
  /** Intrinsic size in pixels, so the page reserves the right box before the image loads. */
  width: number;
  height: number;
}

export interface ClubSponsorEntry {
  name: string;
  /** Logo file, relative to `assets/`. A sponsor without a logo can still sponsor a race by name in Admin. */
  file: string;
}

/**
 * A card the club has already sold: the snails, their names and owners, the
 * races sponsored and the run sheet. A fresh night starts from it, and Admin,
 * Setup offers a button to load it again. Leave it out and a fresh night
 * starts from the generic card of one hundred numbered snails.
 */
export interface ClubNight {
  /** What the Admin button says, e.g. "Load the NDCC orders (24 Oct)". */
  loadLabel: string;
  /** Snails on the card. */
  snails: number;
  /** Runners in each race; the card is `snails / runnersPerRace` races. */
  runnersPerRace: number;
  /** Price of one snail, in cents. */
  snailCents: number;
  /** [number, snail name, owner]. Numbers not listed run as "Snail N". */
  roster: ReadonlyArray<readonly [number, string, string]>;
  /** Races sold to a sponsor. `logo` names an entry in `sponsors` to show beside the crest. */
  raceSponsors: readonly RaceSponsor[];
  /** One row per race: track, length, laps and surprise level. Same length as the card. */
  racePlan: readonly Omit<RunSheetRace, 'runners'>[];
  /**
   * Sponsor lists an earlier build of this club's night loaded, as
   * `name|title|race[|logo]` joined by `;`. A saved night carrying exactly
   * one of these, untouched, takes the current list on its next load.
   */
  previousSponsorKeys?: readonly string[];
  /**
   * The card shape an earlier build sold, as runners per race. A saved
   * night still in that shape, with nothing run or sold, moves to the
   * current shape and keeps every name typed since.
   */
  previousRunnersPerRace?: number;
}

export interface ClubProfile {
  /** Folder name under `clubs/`, lower case letters, digits and hyphens. */
  id: string;
  /** Full name, as it goes on the poster, the winner card and receipts. */
  name: string;
  /** Short name or initials for tight spaces: the course plate, page titles. */
  shortName: string;
  /** The town or ground the commentator can name: "Only at Newcomb!". */
  place: string;
  /** The club's website, for the operator's reference. Optional. */
  website?: string;
  crest: ClubImage;
  /** Poster art shown in the lobby. Optional; the crest stands in without one. */
  poster?: ClubImage;
  /**
   * How the poster sits in the lobby's art box: `zoom` is its height as a
   * multiple of the box, `shiftY` its vertical offset in percent of its own
   * height (-50 centres it). Use it to crop a poster down to its artwork.
   */
  posterFocus?: { zoom: number; shiftY: number };
  /** Image used when the link is shared (Open Graph). Optional; the poster or crest stands in. */
  shareImage?: ClubImage;
  /** Club colours, as #rrggbb. `primary` fills bars and buttons, `accent` edges and highlights, `highlight` the price band (defaults to `accent`). */
  colours: { primary: string; accent: string; secondary?: string; highlight?: string };
  /**
   * Sponsor names that are the club's own teams (e.g. "NDCC", "Dinos"), as
   * regular expressions. A race sponsored by one wears the club crest.
   */
  clubTeamPatterns?: readonly string[];
  /** The club's sponsors, rolled beside each winner and on the fence boards. */
  sponsors: readonly ClubSponsorEntry[];
  /** What a fresh night is called and when it is. Every field can be changed in Admin. */
  event: {
    name: string;
    tagline: string;
    /** YYYY-MM-DD. */
    date: string;
    /** HH:MM, 24-hour. */
    startTime: string;
    venue: string;
    /** IANA time zone, e.g. Australia/Melbourne. */
    timezone: string;
    /** Fundraising goal shown on the goal ring, in cents. */
    goalCents: number;
    /** Page description for search and link previews. */
    description: string;
  };
  night?: ClubNight;
}
