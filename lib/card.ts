/**
 * The card: by default one hundred snails, ten races of ten.
 *
 * A supporter buys a numbered snail and names it. The number fixes the race:
 * snails 1 to 10 run in race 1, 11 to 20 in race 2, and so on. Nothing about
 * the purchase, the name or the owner reaches the race engine; the card only
 * decides which names stand at the gate for a given race number.
 *
 * The desk can set how many snails are on sale. The card is then split into
 * as few races as keep every field at ten or under, as evenly as it divides:
 * 64 snails is seven races, one of ten and six of nine.
 */

/** The most snails in one race when the card is split. */
export const SNAILS_PER_RACE = 10;
export const RACES_ON_CARD = 10;
export const SNAILS_ON_CARD = SNAILS_PER_RACE * RACES_ON_CARD;
/** A race needs at least this many runners (the engine's live minimum). */
export const MIN_SNAILS_PER_RACE = 8;
/** Bounds on how many snails the desk can put on sale. */
export const MIN_SNAILS_ON_CARD = MIN_SNAILS_PER_RACE;
export const MAX_SNAILS_ON_CARD = 200;

export interface CardLayout {
  snails: number;
  races: number;
  /** Runners per race, race 1 first. */
  sizes: number[];
  /** First snail number of each race, race 1 first. */
  starts: number[];
}

/** True when this many snails split into races of eight to ten (11 to 15, 21 to 23 and 31 do not). */
export const snailCountFits = (n: number): boolean =>
  Number.isSafeInteger(n) && n >= MIN_SNAILS_ON_CARD && n <= MAX_SNAILS_ON_CARD &&
  Math.ceil(n / SNAILS_PER_RACE) <= Math.floor(n / MIN_SNAILS_PER_RACE);

/** Bounded, and stepped down to the nearest count that splits into fields of eight to ten. */
export const clampSnailCount = (value: unknown): number => {
  let n = Math.round(Number(value));
  if (!Number.isFinite(n)) return SNAILS_ON_CARD;
  n = Math.min(MAX_SNAILS_ON_CARD, Math.max(MIN_SNAILS_ON_CARD, n));
  while (!snailCountFits(n)) n -= 1;
  return n;
};

/** Split a card of this many snails into races of eight to ten, as evenly as possible. */
export function cardLayout(snailCount: number = SNAILS_ON_CARD): CardLayout {
  const snails = clampSnailCount(snailCount);
  /* clampSnailCount only returns counts that fit, so the fewest races of ten also keep every field at eight or more. */
  const races = Math.ceil(snails / SNAILS_PER_RACE);
  const base = Math.floor(snails / races);
  const extra = snails % races;
  const sizes = Array.from({ length: races }, (_, i) => base + (i < extra ? 1 : 0));
  const starts: number[] = [];
  let next = 1;
  for (const size of sizes) {
    starts.push(next);
    next += size;
  }
  return { snails, races, sizes, starts };
}

const layouts = new Map<number, CardLayout>();
const layoutFor = (snailCount: number): CardLayout => {
  let layout = layouts.get(snailCount);
  if (!layout) {
    layout = cardLayout(snailCount);
    layouts.set(snailCount, layout);
  }
  return layout;
};

/** How a layout reads on a poster: "10 races of 10", "7 races: 1 of 10, 6 of 9". */
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
  /** Snails on sale tonight; the races are split from this. */
  snailCount: number;
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

export const DEFAULT_CARD: CardState = {
  snailCount: SNAILS_ON_CARD,
  names: new Array<string>(SNAILS_ON_CARD).fill(''),
  owners: new Array<string>(SNAILS_ON_CARD).fill(''),
  claims: {},
  snailCents: DEFAULT_SNAIL_CENTS,
  paymentLinkUrl: '',
  paymentLinkMinted: false,
};

export const validSnailNo = (n: unknown, snailCount: number = SNAILS_ON_CARD): n is number =>
  Number.isSafeInteger(n) && Number(n) >= 1 && Number(n) <= clampSnailCount(snailCount);

/** Which race a snail number runs in: 1 to 10 in race 1, 11 to 20 in race 2 on the default card. */
export const raceForSnail = (snailNo: number, snailCount: number = SNAILS_ON_CARD): number => {
  const { starts } = layoutFor(snailCount);
  let race = 1;
  while (race < starts.length && starts[race] <= snailNo) race += 1;
  return race;
};

/** Snail numbers before this race's first, so lane i is snail offset + i + 1. */
export const snailOffsetForRace = (raceNo: number, snailCount: number = SNAILS_ON_CARD): number =>
  snailsForRace(raceNo, snailCount)[0] - 1;

/** Lane index, 0-based, within its race. */
export const laneForSnail = (snailNo: number, snailCount: number = SNAILS_ON_CARD): number =>
  snailNo - layoutFor(snailCount).starts[raceForSnail(snailNo, snailCount) - 1];

/** The snail numbers, in lane order, for a race number. */
export const snailsForRace = (raceNo: number, snailCount: number = SNAILS_ON_CARD): number[] => {
  const layout = layoutFor(snailCount);
  /* A race past the end of a shrunk card keeps the last race's shape. */
  const i = Math.min(Math.max(raceNo, 1), layout.races) - 1;
  const first = raceNo > layout.races ? layout.starts[i] + (raceNo - layout.races) * SNAILS_PER_RACE : layout.starts[i];
  return Array.from({ length: layout.sizes[i] }, (_, lane) => first + lane);
};

const MAX_NAME = 24;
const MAX_OWNER = 24;

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** The name a snail races under: what its owner called it, or its number. */
export const snailDisplayName = (card: CardState, snailNo: number): string =>
  card.names[snailNo - 1]?.trim() || `Snail ${snailNo}`;

/** Ten names in lane order for a race on the card. Never empty, never shorter. */
export function cardRaceNames(card: CardState, raceNo: number): string[] {
  return snailsForRace(raceNo, card.snailCount).map((n) => snailDisplayName(card, n));
}

export const cardRaceOwners = (card: CardState, raceNo: number): string[] =>
  snailsForRace(raceNo, card.snailCount).map((n) => card.owners[n - 1]?.trim() ?? '');

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
 * Why the desk cannot change the number of snails now: once a race has run,
 * its snail numbers are on the record, and an armed race has hashed its names.
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

/**
 * Put a different number of snails on sale. Names and owners already on the
 * card keep their numbers; the card cannot shrink below a snail that is sold.
 */
export function resizeCard(card: CardState, snailCount: number): CardState | { error: string } {
  const asked = Math.round(Number(snailCount));
  if (Number.isFinite(asked) && asked >= MIN_SNAILS_ON_CARD && asked <= MAX_SNAILS_ON_CARD && !snailCountFits(asked)) {
    let up = asked;
    while (!snailCountFits(up)) up += 1;
    return { error: `${asked} snails cannot split into races of eight to ten. Try ${clampSnailCount(asked)} or ${up}.` };
  }
  const next = clampSnailCount(snailCount);
  const sold = highestSold(card);
  if (next < sold) return { error: `Snail ${sold} is already sold, so the card cannot go below ${sold}.` };
  const pad = (list: string[]) => Array.from({ length: next }, (_, i) => list[i] ?? '');
  return { ...card, snailCount: next, names: pad(card.names), owners: pad(card.owners) };
}

/** The lowest unsold number, or null once the card is full. */
export function nextFreeSnail(card: CardState): number | null {
  for (let n = 1; n <= card.snailCount; n++) if (!isSold(card, n)) return n;
  return null;
}

/** Accept a stored card from any older or hand-edited backup. */
export function normaliseCard(value: unknown): CardState {
  const base: CardState = {
    ...DEFAULT_CARD,
    names: DEFAULT_CARD.names.slice(),
    owners: DEFAULT_CARD.owners.slice(),
    claims: {},
  };
  if (!value || typeof value !== 'object') return base;
  const v = value as Partial<CardState>;
  const count = v.snailCount === undefined ? SNAILS_ON_CARD : clampSnailCount(v.snailCount);
  base.snailCount = count;
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
      if (validSnailNo(n, count) && typeof id === 'string' && id) base.claims[n] = id.slice(0, 80);
    }
  }
  if (Number.isSafeInteger(v.snailCents) && Number(v.snailCents) >= 100 && Number(v.snailCents) <= 100_000) {
    base.snailCents = Number(v.snailCents);
  }
  if (typeof v.paymentLinkUrl === 'string' && /^https:\/\/[^\s]{6,300}$/.test(v.paymentLinkUrl.trim())) {
    base.paymentLinkUrl = v.paymentLinkUrl.trim();
    base.paymentLinkMinted = v.paymentLinkMinted === true;
  }
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
    if (!validSnailNo(p.snailNo, card.snailCount)) {
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
export function parseRosterPaste(text: string, snailCount: number = SNAILS_ON_CARD): { rows: { snailNo: number; name: string; owner: string }[]; skipped: number } {
  const rows: { snailNo: number; name: string; owner: string }[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s*[,;\t]\s*/);
    const n = Number(parts[0]?.replace(/[^\d]/g, ''));
    if (!validSnailNo(n, snailCount)) {
      skipped += 1;
      continue;
    }
    rows.push({ snailNo: n, name: clean(parts[1] ?? '', MAX_NAME), owner: clean(parts[2] ?? '', MAX_OWNER) });
  }
  return { rows, skipped };
}

/** The roster as CSV, for a printed sheet or a spreadsheet. */
export function rosterCsv(card: CardState): string {
  const lines = ['snail,race,lane,name,owner'];
  for (let n = 1; n <= card.snailCount; n++) {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    lines.push([n, raceForSnail(n, card.snailCount), laneForSnail(n, card.snailCount) + 1, q(card.names[n - 1] ?? ''), q(card.owners[n - 1] ?? '')].join(','));
  }
  return lines.join('\n');
}
