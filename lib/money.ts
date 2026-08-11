const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
});

const AUD0 = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Full precision, always two decimals. Use in ledgers, receipts and reports. */
export const money = (cents: number): string => AUD.format((cents || 0) / 100);

/** Drops the cents when the amount is whole. Use on the stage where space is tight. */
export const moneyShort = (cents: number): string =>
  (cents || 0) % 100 === 0 ? AUD0.format((cents || 0) / 100) : AUD.format((cents || 0) / 100);

/** Parse a user-typed dollar amount into integer cents. Returns null when unusable. */
export function parseAmountToCents(input: string | number): number | null {
  const raw = typeof input === 'number' ? input : Number(String(input).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw * 100);
}

export const MIN_DONATION_CENTS = 100; // $1.00 - below this the Stripe fee eats the gift
export const MAX_DONATION_CENTS = 200_000; // $2,000.00 per transaction

export const CHIP_START = 100;
