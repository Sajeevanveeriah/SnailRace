/**
 * The card: the snails on sale and the run sheet that races them.
 *
 * A supporter buys a numbered snail and names it. The run sheet decides which
 * race each number runs in: the races take the numbers in order, each as many
 * as its runner count, so race 1 of eight is snails 1 to 8, race 2 is 9 to 16,
 * and so on. Nothing about the purchase, the name or the owner reaches the
 * race engine; the card only decides which names stand at the gate for a
 * given race number.
 *
 * The run sheet is explicit and stored: how many races, how many runners in
 * each (8 to 12), and any per-race settings that differ from the night's
 * (track design, length, laps, surprise level, camera, race type). Snails on
 * sale and places on the run sheet can disagree; the desk is told and offered
 * one-tap fixes (see `fitFixes`). A race that has run, or that a quaddie
 * ticket, tote sale or bid is tied to, keeps its snails.
 *
 * Every helper takes a card source: the card itself (the run sheet), or a
 * bare snail count for the automatic split a count would get on its own
 * (used by tests, the payment API and old records).
 */

import type { TrackDesignId } from './courses';
import type { CameraMode, SurpriseIntensity } from './types';

/** The most snails in one race when a bare count is split automatically. */
export const SNAILS_PER_RACE = 10;
export const RACES_ON_CARD = 10;
export const SNAILS_ON_CARD = SNAILS_PER_RACE * RACES_ON_CARD;
/** A race needs at least this many runners (the engine's live minimum). */
export const MIN_SNAILS_PER_RACE = 8;
/** The most runners the run sheet puts in one race. */
export const MAX_SNAILS_PER_RACE = 12;
/** Bounds on how many snails the desk can put on sale. */
export const MIN_SNAILS_ON_CARD = MIN_SNAILS_PER_RACE;
export const MAX_SNAILS_ON_CARD = 200;
/** A run sheet longer than this is a typo, not a night. */
export const MAX_RACES = 40;

export interface CardLayout {
  /** Numbered places on the card: snails that have a race. */
  snails: number;
  races: number;
  /** Runners per race, race 1 first. */
  sizes: number[];
  /** First snail number of each race, race 1 first. */
  starts: number[];
  /** Snail numbers in lane order, per race. */
  fields: number[][];
}

/** True when this many snails split automatically into races of eight to ten (11 to 15, 21 to 23 and 31 do not). */
export const snailCountFits = (n: number): boolean =>
  Number.isSafeInteger(n) && n >= MIN_SNAILS_ON_CARD && n <= MAX_SNAILS_ON_CARD &&
  Math.ceil(n / SNAILS_PER_RACE) <= Math.floor(n / MIN_SNAILS_PER_RACE);

/** Bounded, and stepped down to the nearest count that splits automatically into fields of eight to ten. */
export const clampSnailCount = (value: unknown): number => {
  let n = Math.round(Number(value));
  if (!Number.isFinite(n)) return SNAILS_ON_CARD;
  n = Math.min(MAX_SNAILS_ON_CARD, Math.max(MIN_SNAILS_ON_CARD, n));
  while (!snailCountFits(n)) n -= 1;
  return n;
};

/** Snails on sale, bounded. Any count is allowed; the run sheet says where they race. */
export const clampOnSale = (value: unknown): number => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return SNAILS_ON_CARD;
  return Math.min(MAX_SNAILS_ON_CARD, Math.max(MIN_SNAILS_ON_CARD, n));
};

/** A runner count the run sheet accepts. */
export const clampRunners = (value: unknown, fallback = SNAILS_PER_RACE): number => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_SNAILS_PER_RACE, Math.max(MIN_SNAILS_PER_RACE, n));
};

/**
 * How a bare snail count is split into races. 'even' gives equal fields
 * whenever the count allows. 'legacy' is the rule before 5.4 (the fewest
 * races of ten, the rest within one of each other). A card saved before the
 * run sheet existed is migrated to the races its rule gave, so a reload
 * never moves a snail into a different race from the one it was sold into.
 */
export type CardSplit = 'even' | 'legacy';

/** Split a bare count of snails into races of eight to ten: equal fields when the count allows, otherwise as even as it divides. */
function autoLayout(snailCount: number, split: CardSplit = 'even'): CardLayout {
  const snails = clampSnailCount(snailCount);
  /* Equal fields first, the biggest that divides evenly so the night has the
     fewest races. clampSnailCount only returns counts that fit, so the
     fallback (the fewest races of ten) still keeps every field at eight or more. */
  let races = Math.ceil(snails / SNAILS_PER_RACE);
  if (split !== 'legacy') {
    for (let size = SNAILS_PER_RACE; size >= MIN_SNAILS_PER_RACE; size -= 1) {
      if (snails % size === 0) { races = snails / size; break; }
    }
  }
  const base = Math.floor(snails / races);
  const extra = snails % races;
  return layoutOfSizes(Array.from({ length: races }, (_, i) => base + (i < extra ? 1 : 0)));
}

function layoutOfSizes(sizes: number[]): CardLayout {
  return layoutOfRows(sizes.map((runners) => ({ runners })));
}

function layoutOfRows(rows: readonly RunSheetRace[]): CardLayout {
  const sizes: number[] = [];
  const starts: number[] = [];
  const fields: number[][] = [];
  let next = 1;
  for (const row of rows) {
    if (row.field?.length) {
      fields.push(row.field.slice());
      sizes.push(row.field.length);
      starts.push(row.field[0]);
      continue;
    }
    const field = Array.from({ length: row.runners }, (_, lane) => next + lane);
    fields.push(field);
    sizes.push(row.runners);
    starts.push(next);
    next += row.runners;
  }
  return { snails: next - 1, races: rows.length, sizes, starts, fields };
}

/* ── The run sheet ─────────────────────────────────────────────────────── */

/** The race types the desk can pick. A league race carries no label on screen. */
export const RACE_TYPES = ['League', 'Heat', 'Final', 'Champion of champions'] as const;
export type RaceTypeName = (typeof RACE_TYPES)[number];
export const DEFAULT_RACE_TYPE: RaceTypeName = 'League';

/** "Race 3" for a league race, "Heat 3" or "Final 3" otherwise, "Champion of champions" alone. */
export function raceTitle(raceType: string | undefined, raceNo: number): string {
  const type = (raceType ?? '').trim();
  if (!type || type === 'League') return `Race ${raceNo}`;
  if (type === 'Champion of champions') return type;
  return `${type} ${raceNo}`;
}

/** The label a race type shows beside "Race 3", or nothing for a league race. */
export const raceTypeLabel = (raceType: string | undefined): string => {
  const type = (raceType ?? '').trim();
  return !type || type === 'League' ? '' : type;
};

export interface RunSheetRace {
  /** Runners in this race, 8 to 12. A run-off's count is its field's length. */
  runners: number;
  /** True when the runner count was set for this race by hand; the night default then leaves it alone. */
  custom?: boolean;
  /** A run-off races these snail numbers, in lane order, instead of the next numbers on the card. */
  field?: number[];
  /* Per-race overrides. Missing means the night setting. */
  design?: TrackDesignId;
  /** Lap length on a circuit, the whole race on the straight, in ms. */
  lengthMs?: number;
  laps?: number;
  intensity?: SurpriseIntensity;
  camera?: CameraMode;
  raceType?: RaceTypeName;
}

/** The parts of a card the layout helpers read. */
export type CardSource = number | (Pick<CardState, 'snailCount'> & { races?: readonly RunSheetRace[]; split?: CardSplit });

const sheetLayouts = new WeakMap<object, CardLayout>();

/**
 * The races a card source runs: the stored run sheet, or the automatic split
 * of a bare count. A card from before the run sheet (no `races`) splits the
 * way it always did.
 */
export function cardLayout(source: CardSource = SNAILS_ON_CARD, split?: CardSplit): CardLayout {
  if (typeof source === 'number') return autoLayout(source, split);
  if (!source.races?.length) return autoLayout(source.snailCount, split ?? source.split);
  const rows = source.races;
  let layout = sheetLayouts.get(rows);
  if (!layout) {
    layout = layoutOfRows(rows);
    sheetLayouts.set(rows, layout);
  }
  return layout;
}

/** How a layout reads on a poster: "10 races of 10", "10 races: 4 of 9, 6 of 8". */
export function describeLayout(layout: CardLayout): string {
  const counts = new Map<number, number>();
  for (const size of layout.sizes) counts.set(size, (counts.get(size) ?? 0) + 1);
  const races = `${layout.races} ${layout.races === 1 ? 'race' : 'races'}`;
  if (counts.size === 1) return `${races} of ${layout.sizes[0]}`;
  const parts = [...counts.entries()].sort((a, b) => b[0] - a[0]).map(([size, n]) => `${n} of ${size}`);
  return `${races}: ${parts.join(', ')}`;
}

/** The advertised price of one snail, in cents. */
export const DEFAULT_SNAIL_CENTS = 400;

export interface CardState {
  /** Snails on sale tonight: numbers 1 to this can be bought. */
  snailCount: number;
  /** Which automatic split the run sheet was first built from. A record; the run sheet decides. */
  split?: CardSplit;
  /** The night's default runners per race, 8 to 12. */
  snailsPerRace: number;
  /** The run sheet: one row per race, race 1 first. */
  races: RunSheetRace[];
  /** Snail name per number, index 0 is snail 1. Empty until bought or typed. */
  names: string[];
  /** Owner shown on the board per number. Empty for an unsold snail. */
  owners: string[];
  /**
   * Stripe Checkout session that filled a slot, per number. A slot the
   * operator typed by hand carries no id. Stops one payment filling a slot
   * twice and lets a later poll correct a name that was edited in Stripe.
   */
  claims: Record<number, string>;
  /** Price of one snail in cents. Presentation and the Stripe link only. */
  snailCents: number;
  /**
   * The reusable Stripe Payment Link the QR encodes. On a server deployment
   * the stage mints this itself; on a static deployment the operator pastes
   * the link created in the Stripe dashboard.
   */
  paymentLinkUrl: string;
  /**
   * True when the server minted `paymentLinkUrl` for the current price. A
   * minted link is replaced when the price changes; a pasted one is never
   * touched by the stage.
   */
  paymentLinkMinted: boolean;
  /** Paid numbers that were already taken, for the desk to resolve. Transient. */
  conflictNotice?: string;
}

const defaultRaces = (): RunSheetRace[] => Array.from({ length: RACES_ON_CARD }, () => ({ runners: SNAILS_PER_RACE }));

export const DEFAULT_CARD: CardState = {
  snailCount: SNAILS_ON_CARD,
  split: 'even',
  snailsPerRace: SNAILS_PER_RACE,
  races: defaultRaces(),
  names: new Array<string>(SNAILS_ON_CARD).fill(''),
  owners: new Array<string>(SNAILS_ON_CARD).fill(''),
  claims: {},
  snailCents: DEFAULT_SNAIL_CENTS,
  paymentLinkUrl: '',
  paymentLinkMinted: false,
};

/** A fresh card, safe to mutate. */
export const freshCard = (): CardState => ({
  ...DEFAULT_CARD,
  races: defaultRaces(),
  names: DEFAULT_CARD.names.slice(),
  owners: DEFAULT_CARD.owners.slice(),
  claims: {},
});

export const validSnailNo = (n: unknown, source: CardSource = SNAILS_ON_CARD): n is number =>
  Number.isSafeInteger(n) && Number(n) >= 1 &&
  Number(n) <= (typeof source === 'number' ? clampSnailCount(source) : clampOnSale(source.snailCount));

/**
 * Which race a snail number runs in. On the default card 1 to 10 run in race
 * 1, 11 to 20 in race 2. A run-off does not own its snails: they belong to
 * the race their number was sold into. 0 when the number has no race.
 */
export const raceForSnail = (snailNo: number, source: CardSource = SNAILS_ON_CARD): number => {
  const { fields } = cardLayout(source);
  const rows = typeof source === 'number' ? undefined : source.races;
  for (let i = 0; i < fields.length; i++) {
    if (rows?.[i]?.field?.length) continue;
    const field = fields[i];
    if (field.length && snailNo >= field[0] && snailNo <= field[field.length - 1]) return i + 1;
  }
  return 0;
};

/** The snail numbers, in lane order, for a race number. */
export const snailsForRace = (raceNo: number, source: CardSource = SNAILS_ON_CARD): number[] => {
  const layout = cardLayout(source);
  if (!layout.races) return [];
  const i = Math.max(1, Math.floor(raceNo)) - 1;
  if (i < layout.races) return layout.fields[i].slice();
  /* A race past the end of the card takes the next numbers, sized like the last numbered race. */
  const rows = typeof source === 'number' ? undefined : source.races;
  let size = SNAILS_PER_RACE;
  for (let j = layout.races - 1; j >= 0; j--) {
    if (!rows?.[j]?.field?.length) { size = layout.sizes[j]; break; }
  }
  const first = layout.snails + 1 + (i - layout.races) * size;
  return Array.from({ length: size }, (_, lane) => first + lane);
};

/** Snail numbers before this race's first, so lane i is snail offset + i + 1. Exact for a numbered race only. */
export const snailOffsetForRace = (raceNo: number, source: CardSource = SNAILS_ON_CARD): number =>
  (snailsForRace(raceNo, source)[0] ?? 1) - 1;

/** Lane index, 0-based, within its race. -1 when the number has no race. */
export const laneForSnail = (snailNo: number, source: CardSource = SNAILS_ON_CARD): number => {
  const race = raceForSnail(snailNo, source);
  return race ? snailsForRace(race, source).indexOf(snailNo) : -1;
};

/** True when this race races tonight's chosen snails rather than the next numbers. */
export const isRunOff = (card: Pick<CardState, 'races'>, raceNo: number): boolean =>
  Boolean(card.races?.[raceNo - 1]?.field?.length);

/** Long enough for "Speedy Gonzales the Third of Geelong West" in full. */
export const MAX_NAME = 48;
export const MAX_OWNER = 32;

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** The name a snail races under: what its owner called it, or its number. */
export const snailDisplayName = (card: CardState, snailNo: number): string =>
  card.names[snailNo - 1]?.trim() || `Snail ${snailNo}`;

/** Names in lane order for a race on the card. Never empty, never shorter. */
export function cardRaceNames(card: CardState, raceNo: number): string[] {
  return snailsForRace(raceNo, card).map((n) => snailDisplayName(card, n));
}

export const cardRaceOwners = (card: CardState, raceNo: number): string[] =>
  snailsForRace(raceNo, card).map((n) => card.owners[n - 1]?.trim() ?? '');

export const isSold = (card: CardState, snailNo: number): boolean =>
  Boolean(card.names[snailNo - 1]?.trim() || card.owners[snailNo - 1]?.trim());

export const soldCount = (card: CardState): number =>
  Array.from({ length: card.snailCount }, (_, i) => i + 1).filter((n) => isSold(card, n)).length;

/** The highest numbered snail with an owner or a name, 0 when none. */
export const highestSold = (card: CardState): number => {
  for (let n = card.snailCount; n >= 1; n--) if (isSold(card, n)) return n;
  return 0;
};

/**
 * Why the card's snail numbers are tied to tonight's races: a race has run,
 * a race is at the gate, or a ticket, sale, bid or cash backing names a lane.
 * Used when a card saved before the run sheet is migrated: a tied card keeps
 * the split its records were taken under.
 */
export const snailCountLock = (
  event: {
    history: { void?: boolean }[];
    quaddieEntries?: { void?: boolean }[];
    toteSales?: { void?: boolean }[];
    auctionBids?: { void?: boolean }[];
    cashLedger?: { void?: boolean }[];
  },
  raceLocked: boolean,
): string =>
  raceLocked
    ? 'Locked while a race is at the gate.'
    : event.history.some((h) => !h.void)
      ? 'Locked once the first race has run. Reset the night to change it.'
      : (event.quaddieEntries ?? []).some((e) => !e.void)
        ? 'Locked once a quaddie ticket is sold: its picks are tied to tonight\'s races.'
        : [...(event.toteSales ?? []), ...(event.auctionBids ?? []), ...(event.cashLedger ?? [])].some((e) => !e.void)
          ? 'Locked once cash, a tote ticket or an auction bid is taken: it is tied to a lane in tonight\'s races.'
          : '';

/* ── Run sheet locks ───────────────────────────────────────────────────── */

/** The records that can tie a race to its snails. */
export interface RunSheetTies {
  history: { raceNo: number; void?: boolean }[];
  quaddieLegs?: number[];
  quaddieEntries?: { void?: boolean }[];
  toteSales?: { raceNo: number; void?: boolean }[];
  auctionBids?: { raceNo: number; void?: boolean }[];
  cashLedger?: { raceNo: number; lane: number; void?: boolean }[];
  /** The race armed or running now, if any. */
  armedRaceNo?: number | null;
}

export interface RaceLock {
  raceNo: number;
  run: boolean;
  armed: boolean;
  /** What ties this race's snails, in words, or empty. */
  tie: string;
  /** Why the runner count cannot change, or empty when it can. */
  countLock: string;
  /** Why the race's settings cannot change, or empty when they can. */
  settingsLock: string;
}

function tieOf(raceNo: number, ties: RunSheetTies): string {
  const what: string[] = [];
  if ((ties.quaddieEntries ?? []).some((e) => !e.void) && (ties.quaddieLegs ?? []).includes(raceNo)) what.push('quaddie tickets');
  if ((ties.toteSales ?? []).some((s) => !s.void && s.raceNo === raceNo)) what.push('tote sales');
  if ((ties.auctionBids ?? []).some((b) => !b.void && b.raceNo === raceNo)) what.push('auction bids');
  if ((ties.cashLedger ?? []).some((d) => !d.void && d.raceNo === raceNo && d.lane >= 0)) what.push('cash backing');
  if (!what.length) return '';
  return what.length === 1 ? what[0] : `${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}`;
}

/** What can still change on each race of the run sheet, and why not. */
export function runSheetLocks(card: Pick<CardState, 'races'>, ties: RunSheetTies): RaceLock[] {
  const ran = new Set(ties.history.filter((h) => !h.void).map((h) => h.raceNo));
  const rows = card.races;
  const base = rows.map((row, i) => {
    const raceNo = i + 1;
    return { raceNo, run: ran.has(raceNo), armed: ties.armedRaceNo === raceNo, tie: tieOf(raceNo, ties), runOff: Boolean(row.field?.length) };
  });
  return base.map((r) => {
    const settingsLock = r.run ? 'Already run.' : r.armed ? 'At the gate now.' : '';
    let countLock = settingsLock;
    if (!countLock && r.runOff) countLock = 'A run-off races the snails chosen for it.';
    if (!countLock) {
      /* Changing this race's size moves the numbers of every numbered race after it. */
      const later = base.find((o) => o.raceNo >= r.raceNo && !o.runOff && (o.tie || o.run || o.armed));
      if (later?.raceNo === r.raceNo) countLock = `Race ${r.raceNo} has ${r.tie}: its snails are fixed.`;
      else if (later) {
        countLock = later.tie
          ? `Race ${later.raceNo} has ${later.tie}, so the races before it keep their sizes: a change here would move its snail numbers.`
          : `Race ${later.raceNo} has run or is at the gate, so the races before it keep their sizes.`;
      }
    }
    return { raceNo: r.raceNo, run: r.run, armed: r.armed, tie: r.tie, countLock, settingsLock };
  });
}

/** The ties a whole night holds, read from the event state. */
export function tiesOf(event: {
  history: { raceNo: number; void?: boolean }[];
  quaddie?: { legs: number[] };
  quaddieEntries?: { void?: boolean }[];
  toteSales?: { raceNo: number; void?: boolean }[];
  auctionBids?: { raceNo: number; void?: boolean }[];
  cashLedger?: { raceNo: number; lane: number; void?: boolean }[];
  heldRaceStart?: { raceNo: number } | null;
}, armedRaceNo?: number | null): RunSheetTies {
  return {
    history: event.history,
    quaddieLegs: event.quaddie?.legs,
    quaddieEntries: event.quaddieEntries,
    toteSales: event.toteSales,
    auctionBids: event.auctionBids,
    cashLedger: event.cashLedger,
    armedRaceNo: armedRaceNo ?? event.heldRaceStart?.raceNo ?? null,
  };
}

/* ── Run sheet edits ───────────────────────────────────────────────────── */

type Edit = CardState | { error: string };

const withRaces = (card: CardState, races: RunSheetRace[]): CardState => ({ ...card, races });

/** Put a different number of runners in one race. */
export function setRaceRunners(card: CardState, raceNo: number, runners: number, locks: RaceLock[]): Edit {
  const lock = locks[raceNo - 1];
  if (!card.races[raceNo - 1]) return { error: `There is no race ${raceNo}.` };
  if (lock?.countLock) return { error: lock.countLock };
  const n = clampRunners(runners, card.races[raceNo - 1].runners);
  const races = card.races.map((row, i) => (i === raceNo - 1 ? { ...row, runners: n, custom: n !== card.snailsPerRace } : row));
  return withRaces(card, races);
}

/** Change the night's runners per race: every race still free to change takes it, unless set by hand. */
export function setSnailsPerRace(card: CardState, runners: number, locks: RaceLock[]): CardState {
  const n = clampRunners(runners, card.snailsPerRace);
  const races = card.races.map((row, i) =>
    row.field?.length || row.custom || locks[i]?.countLock ? row : { ...row, runners: n },
  );
  return { ...card, snailsPerRace: n, races };
}

/** Add a numbered race at the end of the card. Adding never moves a snail already in a race. */
export function addRace(card: CardState, runners: number = card.snailsPerRace, patch: Partial<RunSheetRace> = {}): CardState {
  if (card.races.length >= MAX_RACES) return card;
  const n = clampRunners(runners, card.snailsPerRace);
  return withRaces(card, [...card.races, { ...patch, runners: n, custom: n !== card.snailsPerRace || undefined }]);
}

/** Add a run-off of these snails at the end of the card. */
export function addRunOff(card: CardState, field: number[], raceType: RaceTypeName = 'Champion of champions'): CardState {
  if (card.races.length >= MAX_RACES || field.length < MIN_SNAILS_PER_RACE) return card;
  const runOff = field.slice(0, MAX_SNAILS_PER_RACE);
  return withRaces(card, [...card.races, { runners: runOff.length, field: runOff, raceType }]);
}

/** Remove the last race, when nothing has run in it or is tied to it. */
export function removeLastRace(card: CardState, locks: RaceLock[]): Edit {
  const last = locks[card.races.length - 1];
  if (!last) return { error: 'There is no race to remove.' };
  if (card.races.length <= 1) return { error: 'A night needs at least one race.' };
  if (last.run || last.armed) return { error: `Race ${last.raceNo} ${last.run ? 'has already run' : 'is at the gate'}.` };
  if (last.tie) return { error: `Race ${last.raceNo} has ${last.tie}, so it stays on the card.` };
  return withRaces(card, card.races.slice(0, -1));
}

/** Set "races tonight": add races at the end, or remove the last ones while nothing ties them. */
export function setRaceCount(card: CardState, count: number, locks: RaceLock[]): Edit {
  const target = Math.min(MAX_RACES, Math.max(1, Math.round(Number(count)) || 1));
  let next = card;
  while (next.races.length < target) next = addRace(next);
  while (next.races.length > target) {
    const removed = removeLastRace(next, locks);
    if ('error' in removed) return removed;
    next = removed;
  }
  return next;
}

/** Change one race's own settings. Undefined fields go back to the night setting. */
export function setRaceSettings(card: CardState, raceNo: number, patch: Partial<Omit<RunSheetRace, 'runners' | 'field' | 'custom'>>, locks: RaceLock[]): Edit {
  const lock = locks[raceNo - 1];
  if (!card.races[raceNo - 1]) return { error: `There is no race ${raceNo}.` };
  if (lock?.settingsLock) return { error: lock.settingsLock };
  const races = card.races.map((row, i) => {
    if (i !== raceNo - 1) return row;
    const next: RunSheetRace = { ...row, ...patch };
    for (const key of Object.keys(patch) as (keyof RunSheetRace)[]) if (next[key] === undefined) delete next[key];
    return next;
  });
  return withRaces(card, races);
}

/**
 * Put a different number of snails on sale. Names and owners already on the
 * card keep their numbers, and no snail changes race: the run sheet is left
 * as it is, and `cardFit` says when the two disagree. The card cannot shrink
 * below a snail that is sold.
 */
export function resizeCard(card: CardState, snailCount: number): Edit {
  const asked = Math.round(Number(snailCount));
  if (!Number.isFinite(asked) || asked < MIN_SNAILS_ON_CARD || asked > MAX_SNAILS_ON_CARD) {
    return { error: `Pick ${MIN_SNAILS_ON_CARD} to ${MAX_SNAILS_ON_CARD} snails.` };
  }
  const next = clampOnSale(asked);
  const sold = highestSold(card);
  if (next < sold) return { error: `Snail ${sold} is already sold, so the card cannot go below ${sold}.` };
  const pad = (list: string[]) => Array.from({ length: next }, (_, i) => list[i] ?? '');
  const claims = Object.fromEntries(Object.entries(card.claims).filter(([n]) => Number(n) <= next));
  return { ...card, snailCount: next, names: pad(card.names), owners: pad(card.owners), claims };
}

/* ── Snails on sale against places ─────────────────────────────────────── */

export interface CardFit {
  onSale: number;
  places: number;
  /** Snails on sale minus places: above 0, snails with no race; below 0, places with no snail. */
  diff: number;
  /** One plain sentence, empty when they agree. */
  message: string;
}

export function cardFit(card: CardState): CardFit {
  const places = cardLayout(card).snails;
  const onSale = card.snailCount;
  const diff = onSale - places;
  const message =
    diff > 0
      ? `${onSale} sold, ${places} places: ${diff} ${diff === 1 ? 'snail has' : 'snails have'} no race.`
      : diff < 0
        ? `${onSale} sold, ${places} places: ${-diff} ${diff === -1 ? 'place has' : 'places have'} no snail.`
        : '';
  return { onSale, places, diff, message };
}

export interface FitFix {
  id: 'spread' | 'add' | 'per-race' | 'off-sale' | 'on-sale' | 'trim';
  label: string;
  card: CardState;
}

/** Sizes for `count` snails over `races` races within one of each other, larger races first; null if a race would fall outside 8 to 12. */
function evenSizes(count: number, races: number): number[] | null {
  if (races < 1) return null;
  const base = Math.floor(count / races);
  const extra = count % races;
  const sizes = Array.from({ length: races }, (_, i) => base + (i < extra ? 1 : 0));
  return sizes.every((s) => s >= MIN_SNAILS_PER_RACE && s <= MAX_SNAILS_PER_RACE) ? sizes : null;
}

/** "4 races of 9, 6 of 8", larger fields first. */
export function sizesPhrase(sizes: number[]): string {
  const counts = new Map<number, number>();
  for (const size of sizes) counts.set(size, (counts.get(size) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([size, n], i) => `${n}${i === 0 ? (n === 1 ? ' race' : ' races') : ''} of ${size}`)
    .join(', ');
}

const range = (a: number, b: number) => (a === b ? `snail ${a}` : `snails ${a} to ${b}`);

/**
 * One-tap fixes when the snails on sale and the places disagree. Only races
 * still free to change are touched. Unsold snails never block a fix: taking
 * an unsold snail off sale or leaving it without a race is always allowed.
 */
export function fitFixes(card: CardState, locks: RaceLock[]): FitFix[] {
  const fit = cardFit(card);
  if (!fit.diff) return [];
  const fixes: FitFix[] = [];
  /* The races still free to change form a tail of the numbered races. */
  const free = card.races.map((row, i) => i).filter((i) => !card.races[i].field?.length && !locks[i]?.countLock);
  const fixedPlaces = card.races.reduce((sum, row, i) => (row.field?.length || free.includes(i) ? sum : sum + row.runners), 0);
  const sized = (row: RunSheetRace, n: number): RunSheetRace => {
    const next: RunSheetRace = { ...row, runners: n };
    if (n !== card.snailsPerRace) next.custom = true;
    else delete next.custom;
    return next;
  };
  /* Replace the free races with these sizes: spare free races drop off, extra sizes become new races at the end. */
  const applySizes = (sizes: number[]): CardState => {
    const races: RunSheetRace[] = [];
    let k = 0;
    card.races.forEach((row, i) => {
      if (!free.includes(i)) races.push(row);
      else if (k < sizes.length) races.push(sized(row, sizes[k++]));
    });
    for (; k < sizes.length; k++) races.push(sized({ runners: sizes[k] }, sizes[k]));
    return { ...card, races };
  };
  const remaining = fit.onSale - fixedPlaces;

  if (fit.diff > 0) {
    /* Spread the extras over the races still free, keeping the number of races. */
    const spread = evenSizes(remaining, free.length);
    if (spread && free.length) {
      const next = applySizes(spread);
      fixes.push({ id: 'spread', label: `Spread the extras: ${sizesPhrase(spread)}${free.length < card.races.length ? ' still to run' : ''}`, card: next });
    }
    /* Add a race for the snails with no race, putting more on sale if it needs eight. */
    const runners = clampRunners(Math.max(fit.diff, MIN_SNAILS_PER_RACE), card.snailsPerRace);
    if (fit.diff <= MAX_SNAILS_PER_RACE && card.races.length < MAX_RACES) {
      let added = addRace(card, runners);
      const first = fit.places + 1;
      const last = fit.places + runners;
      const more = last - fit.onSale;
      const bigger = more > 0 ? resizeCard(added, last) : added;
      if (!('error' in bigger)) added = bigger;
      fixes.push({
        id: 'add',
        label: `Add race ${card.races.length + 1}: ${range(first, last)}${more > 0 ? ` (${more} more on sale)` : ''}`,
        card: added,
      });
    }
    /* Even fields of one size that use every snail exactly. */
    const sizesTried = [card.snailsPerRace, ...[12, 11, 10, 9, 8].filter((s) => s !== card.snailsPerRace)];
    for (const s of sizesTried) {
      if (remaining <= 0 || remaining % s !== 0) continue;
      const count = remaining / s;
      if (count === free.length && spread) continue;
      if (card.races.length - free.length + count > MAX_RACES) continue;
      const sizes = Array.from({ length: count }, () => s);
      const next = { ...applySizes(sizes), snailsPerRace: s };
      fixes.push({ id: 'per-race', label: `Set snails per race to ${s}: ${count} ${count === 1 ? 'race' : 'races'} of ${s}${free.length < card.races.length ? ' still to run' : ''}`, card: next });
      break;
    }
    /* Take the snails with no race off sale, when none of them is sold. */
    const firstSpare = fit.places + 1;
    const spareSold = Array.from({ length: fit.diff }, (_, k) => firstSpare + k).some((n) => isSold(card, n));
    if (!spareSold && fit.places >= MIN_SNAILS_ON_CARD) {
      const smaller = resizeCard(card, fit.places);
      if (!('error' in smaller)) fixes.push({ id: 'off-sale', label: `Take ${range(firstSpare, fit.onSale)} off sale`, card: smaller });
    }
  } else {
    /* More places than snails: sell the rest, or trim the races still to run. */
    const bigger = resizeCard(card, fit.places);
    if (!('error' in bigger)) fixes.push({ id: 'on-sale', label: `Put ${range(fit.onSale + 1, fit.places)} on sale (${fit.places} in all)`, card: bigger });
    for (let count = free.length; count >= 1; count--) {
      const sizes = evenSizes(remaining, count);
      if (!sizes) continue;
      fixes.push({ id: 'trim', label: `Fit the races to ${fit.onSale} snails: ${sizesPhrase(sizes)}${free.length < card.races.length ? ' still to run' : ''}`, card: applySizes(sizes) });
      break;
    }
  }
  return fixes;
}

/** The lowest unsold number, or null once the card is full. */
export function nextFreeSnail(card: CardState): number | null {
  for (let n = 1; n <= card.snailCount; n++) if (!isSold(card, n)) return n;
  return null;
}

/**
 * The race the desk adds after the card: the next numbers after the last
 * place, as many as are left on sale (at least eight, at most twelve). Any
 * numbers it needs beyond the snails on sale go on sale with it.
 */
export function nextSnailsRace(card: CardState): { card: CardState; first: number; last: number; added: number } {
  const places = cardLayout(card).snails;
  const left = card.snailCount - places;
  const runners = left > 0 ? clampRunners(left, card.snailsPerRace) : card.snailsPerRace;
  let next = addRace(card, runners);
  const last = places + runners;
  const added = Math.max(0, last - card.snailCount);
  if (added > 0) {
    const bigger = resizeCard(next, last);
    if (!('error' in bigger)) next = bigger;
  }
  return { card: next, first: places + 1, last, added };
}

/* ── Stored cards ──────────────────────────────────────────────────────── */

const DESIGN_IDS = new Set(['straight', 'boundary-oval', 'pavilion-chicane', 'floodlight-eight', 'practice-nets']);
const INTENSITIES = new Set(['calm', 'standard', 'big', 'chaos', 'mayhem']);

function normaliseRow(value: unknown, fallbackRunners: number, snailCount: number): RunSheetRace | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<RunSheetRace>;
  const row: RunSheetRace = { runners: clampRunners(v.runners, fallbackRunners) };
  if (Array.isArray(v.field)) {
    const field = [...new Set(v.field.filter((n): n is number => Number.isSafeInteger(n) && n >= 1 && n <= Math.max(snailCount, MAX_SNAILS_ON_CARD)))].slice(0, MAX_SNAILS_PER_RACE);
    if (field.length >= MIN_SNAILS_PER_RACE) {
      row.field = field;
      row.runners = field.length;
    }
  }
  if (v.custom === true) row.custom = true;
  if (typeof v.design === 'string' && DESIGN_IDS.has(v.design)) row.design = v.design as TrackDesignId;
  if (Number.isSafeInteger(v.lengthMs) && Number(v.lengthMs) >= 3_000 && Number(v.lengthMs) <= 600_000) row.lengthMs = Number(v.lengthMs);
  if (Number.isSafeInteger(v.laps) && Number(v.laps) >= 1 && Number(v.laps) <= 9) row.laps = Number(v.laps);
  if (typeof v.intensity === 'string' && INTENSITIES.has(v.intensity)) row.intensity = v.intensity as SurpriseIntensity;
  if (v.camera === 'telecast' || v.camera === 'full') row.camera = v.camera;
  if (typeof v.raceType === 'string' && (RACE_TYPES as readonly string[]).includes(v.raceType)) row.raceType = v.raceType as RaceTypeName;
  return row;
}

/**
 * Accept a stored card from any older or hand-edited backup. A card from
 * before the run sheet becomes the run sheet its split gave: `split` (or, for
 * a card saved before 5.4, `legacySplit` when its records tie it) decides.
 */
export function normaliseCard(value: unknown, legacySplit = false): CardState {
  const base = freshCard();
  if (!value || typeof value !== 'object') return base;
  const v = value as Partial<CardState>;
  const count = v.snailCount === undefined ? SNAILS_ON_CARD : clampOnSale(v.snailCount);
  base.snailCount = count;
  base.split = v.split === 'legacy' || (v.split === undefined && legacySplit) ? 'legacy' : 'even';
  const storedRows = Array.isArray(v.races)
    ? v.races.map((row) => normaliseRow(row, clampRunners(v.snailsPerRace, SNAILS_PER_RACE), count)).filter((row): row is RunSheetRace => row !== null).slice(0, MAX_RACES)
    : [];
  if (storedRows.length) {
    base.races = storedRows;
    base.snailsPerRace = clampRunners(v.snailsPerRace, storedRows.find((r) => !r.field)?.runners ?? SNAILS_PER_RACE);
  } else {
    /* Migrate: the races this count was split into before the run sheet. */
    const sizes = autoLayout(count, base.split).sizes;
    const common = [...sizes].sort((a, b) => sizes.filter((s) => s === b).length - sizes.filter((s) => s === a).length || b - a)[0] ?? SNAILS_PER_RACE;
    base.snailsPerRace = common;
    base.races = sizes.map((runners) => (runners === common ? { runners } : { runners, custom: true }));
  }
  base.names = new Array<string>(count).fill('');
  base.owners = new Array<string>(count).fill('');
  if (Array.isArray(v.names)) {
    for (let i = 0; i < count; i++) base.names[i] = clean(v.names[i], MAX_NAME);
  }
  if (Array.isArray(v.owners)) {
    for (let i = 0; i < count; i++) base.owners[i] = clean(v.owners[i], MAX_OWNER);
  }
  if (v.claims && typeof v.claims === 'object') {
    for (const [key, id] of Object.entries(v.claims)) {
      const n = Number(key);
      if (validSnailNo(n, base) && typeof id === 'string' && id) base.claims[n] = id.slice(0, 80);
    }
  }
  if (Number.isSafeInteger(v.snailCents) && Number(v.snailCents) >= 100 && Number(v.snailCents) <= 100_000) {
    base.snailCents = Number(v.snailCents);
  }
  if (typeof v.paymentLinkUrl === 'string' && /^https:\/\/[^\s]{6,300}$/.test(v.paymentLinkUrl.trim())) {
    base.paymentLinkUrl = v.paymentLinkUrl.trim();
    base.paymentLinkMinted = v.paymentLinkMinted === true;
  }
  if (typeof v.conflictNotice === 'string' && v.conflictNotice) base.conflictNotice = v.conflictNotice.slice(0, 600);
  return base;
}

/**
 * Release slots whose payment was fully refunded.
 *
 * Only a slot still claimed by that same session is cleared: a number the
 * desk has since reassigned by hand, or another payment has since claimed,
 * is left alone. Returns the numbers released so the desk can be told.
 */
export function releaseRefunded(card: CardState, refundedSessionIds: string[]): { card: CardState; released: number[] } {
  const released: number[] = [];
  if (!refundedSessionIds.length) return { card, released };
  const ids = new Set(refundedSessionIds);
  const next: CardState = { ...card, names: card.names.slice(), owners: card.owners.slice(), claims: { ...card.claims } };
  for (const [key, id] of Object.entries(card.claims)) {
    if (!ids.has(id)) continue;
    const n = Number(key);
    next.names[n - 1] = '';
    next.owners[n - 1] = '';
    delete next.claims[n];
    released.push(n);
  }
  return { card: released.length ? next : card, released };
}

export interface SnailPurchase {
  snailNo: number;
  snailName: string;
  owner: string;
  /** Stripe session id. */
  id: string;
}

/**
 * Fill the card from paid purchases.
 *
 * A purchase claims its number if the slot is unsold or already claimed by
 * the same session (so a corrected name in Stripe flows through). A slot the
 * operator typed by hand is never overwritten by a payment: the volunteer at
 * the table saw the person, the webhook did not. A paid number that is already
 * taken by someone else is reported so the desk can resolve it.
 */
export function applyPurchases(
  card: CardState,
  purchases: SnailPurchase[],
): { card: CardState; changed: boolean; conflicts: SnailPurchase[] } {
  const next: CardState = {
    ...card,
    names: card.names.slice(),
    owners: card.owners.slice(),
    claims: { ...card.claims },
  };
  let changed = false;
  const conflicts: SnailPurchase[] = [];
  for (const p of purchases) {
    /* A number past the end of tonight's card was paid for all the same. */
    if (!validSnailNo(p.snailNo, card)) {
      if (validSnailNo(p.snailNo, MAX_SNAILS_ON_CARD)) conflicts.push(p);
      continue;
    }
    const i = p.snailNo - 1;
    const claimed = next.claims[p.snailNo];
    if (claimed && claimed !== p.id) {
      conflicts.push(p);
      continue;
    }
    if (!claimed && isSold(next, p.snailNo)) {
      conflicts.push(p);
      continue;
    }
    const name = clean(p.snailName, MAX_NAME);
    const owner = clean(p.owner, MAX_OWNER);
    if (next.names[i] !== name || next.owners[i] !== owner || claimed !== p.id) {
      next.names[i] = name;
      next.owners[i] = owner;
      next.claims[p.snailNo] = p.id;
      changed = true;
    }
  }
  return { card: changed ? next : card, changed, conflicts };
}

/**
 * Parse a pasted list. One snail per line, number first, then the snail
 * name, then the owner, separated by commas, tabs or semicolons:
 *
 *   29, Escargot Faster, Priya
 *   30; Nan's Favourite; Lisa
 *
 * A Stripe CSV export pasted whole works when its columns are in that order.
 * Lines without a valid number are skipped and counted.
 */
export function parseRosterPaste(text: string, source: CardSource = SNAILS_ON_CARD): { rows: { snailNo: number; name: string; owner: string }[]; skipped: number } {
  const rows: { snailNo: number; name: string; owner: string }[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s*[,;\t]\s*/);
    const n = Number(parts[0]?.replace(/[^\d]/g, ''));
    if (!validSnailNo(n, source)) {
      skipped += 1;
      continue;
    }
    rows.push({ snailNo: n, name: clean(parts[1] ?? '', MAX_NAME), owner: clean(parts[2] ?? '', MAX_OWNER) });
  }
  return { rows, skipped };
}

/** The roster as CSV, for a printed sheet or a spreadsheet. A snail with no race has empty race and lane cells. */
export function rosterCsv(card: CardState): string {
  const lines = ['snail,race,lane,name,owner'];
  for (let n = 1; n <= card.snailCount; n++) {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const race = raceForSnail(n, card);
    lines.push([n, race || '', race ? laneForSnail(n, card) + 1 : '', q(card.names[n - 1] ?? ''), q(card.owners[n - 1] ?? '')].join(','));
  }
  return lines.join('\n');
}
