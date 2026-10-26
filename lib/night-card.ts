import { freshCard, type CardState, type RunSheetRace } from './card';
import { CLUB } from './club';
import type { RaceSponsor } from './types';

export type { RaceSponsor } from './types';

/**
 * The club's sold card, from its profile (`clubs/<id>/club.ts`, `night`):
 * every snail number with the name its buyer gave it and the buyer as the
 * owner, the sponsored races and the run sheet. A fresh night starts from
 * it, and Admin, Setup offers a button to load it again. Everything here can
 * be changed on the desk or in Admin; this is only the starting point.
 *
 * A club with no `night` has no preset: a fresh night is the generic card.
 */
const NIGHT = CLUB.night ?? null;

/** True when this club's profile carries a sold card. */
export const HAS_NIGHT_CARD = NIGHT !== null;
export const NIGHT_SNAILS = NIGHT?.snails ?? 0;
export const NIGHT_RUNNERS = NIGHT?.runnersPerRace ?? 0;
export const NIGHT_RACES = NIGHT ? Math.ceil(NIGHT.snails / NIGHT.runnersPerRace) : 0;
export const NIGHT_LOAD_LABEL = NIGHT?.loadLabel ?? '';

const ROSTER = NIGHT?.roster ?? [];

export const NIGHT_RACE_SPONSORS: readonly RaceSponsor[] = NIGHT?.raceSponsors ?? [];

const PREVIOUS_SPONSORS: readonly string[] = NIGHT?.previousSponsorKeys ?? [];

/* The logo choice is part of the key, so a list whose logo was changed in Admin counts as edited. */
const sponsorKey = (list: readonly RaceSponsor[]): string =>
  list.map((s) => `${s.name}|${s.title ?? ''}|${s.race}${s.logo ? `|${s.logo}` : ''}`).join(';');

/** True when a saved sponsor list is one an earlier build loaded, untouched. */
export const isPreviousNightSponsors = (list: readonly RaceSponsor[]): boolean =>
  list.length > 0 && PREVIOUS_SPONSORS.includes(sponsorKey(list));

/** Names and owners per snail number, index 0 is snail 1, blank where unsold. */
export function nightRoster(count = NIGHT_SNAILS): { names: string[]; owners: string[] } {
  const names = new Array<string>(count).fill('');
  const owners = new Array<string>(count).fill('');
  for (const [n, name, owner] of ROSTER) {
    if (n > count) continue;
    names[n - 1] = name;
    owners[n - 1] = owner;
  }
  return { names, owners };
}

/**
 * The night's run sheet: every race its own track, length, laps and
 * surprise level, shuffled so no two races in a row feel the same, and the
 * last race the Final. Fixed rather than drawn on each load, so a reload
 * mid-night never reshuffles the races still to come. On a circuit
 * `lengthMs` is one lap.
 */
export const NIGHT_RACE_PLAN: readonly Omit<RunSheetRace, 'runners'>[] = NIGHT?.racePlan ?? [];

const planRaces = (): RunSheetRace[] =>
  Array.from({ length: NIGHT_RACES }, (_, i) => ({ ...(NIGHT_RACE_PLAN[i] ?? {}), runners: NIGHT_RUNNERS }));

const SETTING_KEYS = ['design', 'lengthMs', 'laps', 'intensity', 'camera', 'raceType'] as const;

/**
 * The club's card with no race settings of its own (as NDCC 5.6 loaded it) gets
 * the night's run sheet. Null when the card is not that card, or any race
 * already has a setting chosen in Admin. The caller checks no race has run.
 */
export function withNightRacePlan(card: CardState): CardState | null {
  if (!NIGHT || card.snailCount !== NIGHT_SNAILS || card.races.length !== NIGHT_RACES) return null;
  if (card.races.some((r) => r.runners !== NIGHT_RUNNERS || r.field?.length || SETTING_KEYS.some((k) => r[k] !== undefined))) return null;
  return { ...card, races: planRaces() };
}

/** The night's card with the roster filled in; the generic card for a club with none. */
export function nightCard(): CardState {
  const card = freshCard();
  if (!NIGHT) return card;
  const { names, owners } = nightRoster();
  return {
    ...card,
    snailCount: NIGHT_SNAILS,
    snailsPerRace: NIGHT_RUNNERS,
    races: planRaces(),
    names,
    owners,
    snailCents: NIGHT.snailCents,
  };
}

/** A fresh copy of the night's race sponsors, safe to edit. */
export const nightRaceSponsors = (): RaceSponsor[] => NIGHT_RACE_SPONSORS.map((s) => ({ ...s }));

/**
 * Fill an existing card with the roster. Numbers that already have a name
 * typed on the desk keep it unless `overwrite`; numbers past the card's
 * count are left for the run sheet to grow into.
 */
export function withNightRoster(card: CardState, overwrite = false, keep: ReadonlySet<number> = new Set()): CardState {
  const { names, owners } = nightRoster(card.snailCount);
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

/**
 * A card saved by an earlier build in the shape the club sold before
 * (`previousRunnersPerRace`; NDCC's eight races of eleven), as the current
 * shape: the same numbers, every name and owner typed since kept, numbers
 * sold since filled in where blank, and each race's own settings kept by
 * race number. Null when the card is not that shape. Only for a card nothing
 * has run or sold against; the caller checks that.
 */
export function upgradePreviousNightCard(card: CardState): CardState | null {
  const before = NIGHT?.previousRunnersPerRace;
  if (!before || card.snailCount !== NIGHT_SNAILS || card.races.length !== Math.ceil(NIGHT_SNAILS / before)) return null;
  if (card.races.some((r) => r.runners !== before || r.field?.length)) return null;
  const plan = planRaces();
  const races = Array.from({ length: NIGHT_RACES }, (_, i) => {
    const { runners: _runners, custom: _custom, field: _field, ...settings } = card.races[i] ?? { runners: NIGHT_RUNNERS };
    /* A race with settings chosen in Admin keeps them; the rest take the night's run sheet. */
    return Object.keys(settings).length ? { ...settings, runners: NIGHT_RUNNERS } : plan[i];
  });
  return withNightRoster({ ...card, snailsPerRace: NIGHT_RUNNERS, races });
}

/**
 * A saved night's race sponsors brought up to the club's sold list: the list
 * an earlier build loaded is replaced outright; a list edited by hand keeps
 * every race it names and gains the sold sponsors of races it leaves out.
 */
export function withNightSponsors(saved: readonly RaceSponsor[]): RaceSponsor[] {
  if (isPreviousNightSponsors(saved)) return nightRaceSponsors();
  const named = new Set(saved.map((s) => s.race));
  return [...saved.map((s) => ({ ...s })), ...nightRaceSponsors().filter((s) => !named.has(s.race))].sort((a, b) => a.race - b.race);
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
    const logo = typeof v.logo === 'string' ? v.logo.trim().slice(0, 60) : '';
    out.push({ race, name, ...(title ? { title } : {}), ...(logo ? { logo } : {}) });
  }
  return out.sort((a, b) => a.race - b.race);
}

/** The sponsor of one race, from the per-race list. */
export const raceSponsorFor = (list: readonly RaceSponsor[] | undefined, raceNo: number): RaceSponsor | null =>
  list?.find((s) => s.race === raceNo) ?? null;

/**
 * Who sponsors a race: its own sponsor when one was sold for it, otherwise
 * the next name from the night's cycled list (with no race name). `logo`
 * names the club sponsor whose artwork goes with it, when one was chosen.
 */
export function resolveRaceSponsor(
  raceSponsors: readonly RaceSponsor[] | undefined,
  cycled: readonly string[],
  raceNo: number,
): { name: string; title: string; logo: string } {
  const own = raceSponsorFor(raceSponsors, raceNo);
  /* An entry being typed with no sponsor name yet is not a sponsor. */
  if (own?.name.trim()) return { name: own.name, title: own.title ?? '', logo: own.logo ?? '' };
  const live = cycled.map((s) => s.trim()).filter(Boolean);
  if (!live.length || raceNo < 1) return { name: '', title: '', logo: '' };
  return { name: live[(raceNo - 1) % live.length], title: '', logo: '' };
}
