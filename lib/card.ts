/**
 * The card: one hundred snails, ten races of ten.
 *
 * A supporter buys a numbered snail and names it. The number fixes the race:
 * snails 1 to 10 run in race 1, 11 to 20 in race 2, and so on. Nothing about
 * the purchase, the name or the owner reaches the race engine; the card only
 * decides which ten names stand at the gate for a given race number.
 */

export const SNAILS_PER_RACE = 10;
export const RACES_ON_CARD = 10;
export const SNAILS_ON_CARD = SNAILS_PER_RACE * RACES_ON_CARD;

/** The advertised price of one snail, in cents. */
export const DEFAULT_SNAIL_CENTS = 400;

export interface CardState {
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
}

export const DEFAULT_CARD: CardState = {
  names: new Array<string>(SNAILS_ON_CARD).fill(''),
  owners: new Array<string>(SNAILS_ON_CARD).fill(''),
  claims: {},
  snailCents: DEFAULT_SNAIL_CENTS,
  paymentLinkUrl: '',
};

export const validSnailNo = (n: unknown): n is number =>
  Number.isSafeInteger(n) && Number(n) >= 1 && Number(n) <= SNAILS_ON_CARD;

/** Which race a snail number runs in: 1 to 10 in race 1, 11 to 20 in race 2. */
export const raceForSnail = (snailNo: number): number => Math.ceil(snailNo / SNAILS_PER_RACE);

/** Lane index, 0-based, within its race. */
export const laneForSnail = (snailNo: number): number => (snailNo - 1) % SNAILS_PER_RACE;

/** The snail numbers, in lane order, for a race number. */
export const snailsForRace = (raceNo: number): number[] =>
  Array.from({ length: SNAILS_PER_RACE }, (_, lane) => (raceNo - 1) * SNAILS_PER_RACE + lane + 1);

const MAX_NAME = 24;
const MAX_OWNER = 24;

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** The name a snail races under: what its owner called it, or its number. */
export const snailDisplayName = (card: CardState, snailNo: number): string =>
  card.names[snailNo - 1]?.trim() || `Snail ${snailNo}`;

/** Ten names in lane order for a race on the card. Never empty, never shorter. */
export function cardRaceNames(card: CardState, raceNo: number): string[] {
  return snailsForRace(raceNo).map((n) => snailDisplayName(card, n));
}

export const cardRaceOwners = (card: CardState, raceNo: number): string[] =>
  snailsForRace(raceNo).map((n) => card.owners[n - 1]?.trim() ?? '');

export const isSold = (card: CardState, snailNo: number): boolean =>
  Boolean(card.names[snailNo - 1]?.trim() || card.owners[snailNo - 1]?.trim());

export const soldCount = (card: CardState): number =>
  Array.from({ length: SNAILS_ON_CARD }, (_, i) => i + 1).filter((n) => isSold(card, n)).length;

/** The lowest unsold number, or null once the card is full. */
export function nextFreeSnail(card: CardState): number | null {
  for (let n = 1; n <= SNAILS_ON_CARD; n++) if (!isSold(card, n)) return n;
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
  if (Array.isArray(v.names)) {
    for (let i = 0; i < SNAILS_ON_CARD; i++) base.names[i] = clean(v.names[i], MAX_NAME);
  }
  if (Array.isArray(v.owners)) {
    for (let i = 0; i < SNAILS_ON_CARD; i++) base.owners[i] = clean(v.owners[i], MAX_OWNER);
  }
  if (v.claims && typeof v.claims === 'object') {
    for (const [key, id] of Object.entries(v.claims)) {
      const n = Number(key);
      if (validSnailNo(n) && typeof id === 'string' && id) base.claims[n] = id.slice(0, 80);
    }
  }
  if (Number.isSafeInteger(v.snailCents) && Number(v.snailCents) >= 100 && Number(v.snailCents) <= 100_000) {
    base.snailCents = Number(v.snailCents);
  }
  if (typeof v.paymentLinkUrl === 'string' && /^https:\/\/[^\s]{6,300}$/.test(v.paymentLinkUrl.trim())) {
    base.paymentLinkUrl = v.paymentLinkUrl.trim();
  }
  return base;
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
    if (!validSnailNo(p.snailNo)) continue;
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
export function parseRosterPaste(text: string): { rows: { snailNo: number; name: string; owner: string }[]; skipped: number } {
  const rows: { snailNo: number; name: string; owner: string }[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s*[,;\t]\s*/);
    const n = Number(parts[0]?.replace(/[^\d]/g, ''));
    if (!validSnailNo(n)) {
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
  for (let n = 1; n <= SNAILS_ON_CARD; n++) {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    lines.push([n, raceForSnail(n), laneForSnail(n) + 1, q(card.names[n - 1] ?? ''), q(card.owners[n - 1] ?? '')].join(','));
  }
  return lines.join('\n');
}
