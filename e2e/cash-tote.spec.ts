import { expect, test, type Page } from '@playwright/test';

/**
 * The permit-gated cash tote: off by default, live only after the operator's
 * attestation, tallied per runner, settled from the recorded result and
 * printed. The free fun-chip board must be unchanged by all of it.
 */

const openControls = async (page: Page) => {
  await page.getByRole('button', { name: /Controls/i }).click();
  const controls = page.getByRole('region', { name: 'Moderator controls', includeHidden: true });
  await expect(controls).toBeVisible();
  return controls;
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
});

test('the tote is absent by default and the market shows free chips only', async ({ page }) => {
  await page.getByRole('button', { name: /Show the racecard/i }).click();
  await page.getByRole('button', { name: /Open the fun-chip market/i }).click();
  const market = page.getByRole('region', { name: 'MARKET OPEN screen' });
  await expect(market).toBeVisible();
  await expect(market).not.toContainText(/cash tote|ticket|auction/i);
  await expect(market).toContainText('8.00 for 1');
});

test('an attested tote tallies tickets, settles from the result and prints', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const controls = await openControls(page);
  const tote = controls.getByRole('region', { name: 'Cash tote' });
  const enable = tote.getByRole('button', { name: /Enable cash tote/i });
  await expect(enable).toBeDisabled();
  await tote.getByLabel(/Permit or authority reference/i).fill('VGCCC minor gaming permit 12345');
  await expect(enable).toBeDisabled();
  await tote.getByRole('checkbox').first().check();
  await enable.click();
  await expect(tote).toContainText(/LIVE under/);

  /* Tally: 3 on runner 1, 1 on runner 2, 5 on runner 3 = 9 tickets at $2. */
  const tally = tote.getByLabel('Race 1 tote tickets');
  await tally.getByRole('button', { name: 'Add one ticket to Speedy' }).click();
  await tally.getByRole('button', { name: 'Add one ticket to Speedy' }).click();
  await tally.getByRole('button', { name: 'Add one ticket to Speedy' }).click();
  await tally.getByRole('button', { name: 'Add one ticket to Turbo' }).click();
  await tally.getByRole('button', { name: 'Add five tickets to Lightning' }).click();
  await expect(tally).toContainText('9 sold · pool $18.00 · $9.00 to winners');

  /* The fun-chip price is untouched by any of that. */
  await controls.getByLabel('Lap length').selectOption('7000');
  await controls.getByLabel('Laps').selectOption('1');
  await controls.getByRole('button', { name: /Hide/i }).click();

  await page.getByRole('button', { name: /Show the racecard/i }).click();
  await page.getByRole('button', { name: /Open the fun-chip market/i }).click();
  const market = page.getByRole('region', { name: 'MARKET OPEN screen' });
  await expect(market).toContainText('8.00 for 1');
  const board = market.getByLabel('Cash tote');
  await expect(board).toContainText('9 sold · pool $18.00');
  /* 3 tickets on Speedy share $9 if Speedy wins: $3.00 each. 5 on Lightning: $1.80. */
  await expect(board).toContainText(/Speedy\s*3\s*pays \$3\.00/);
  await expect(board).toContainText(/Lightning\s*5\s*pays \$1\.80/);
  await expect(board).toContainText(/Turbo\s*1\s*pays \$9\.00/);
  await page.screenshot({ path: testInfo.outputPath('tote-market.png') });

  await page.getByRole('button', { name: /Lock and race/i }).click();
  await page.getByRole('button', { name: /Start race/i }).click();
  const winner = page.getByRole('dialog').filter({ hasText: /Race 1 winner/i });
  await expect(winner).toBeVisible({ timeout: 30_000 });
  await expect(winner).toContainText('CLUB CASH TOTE');
  await expect(winner).toContainText(/Pays \$\d+\.\d0 per \$2\.00 ticket|No winning tickets/);
  await page.screenshot({ path: testInfo.outputPath('tote-result.png') });

  const stored = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('ndcc-snailrace-v3') ?? '{}') as {
      history: { raceNo: number; tote?: { poolCents: number; retainedCents: number; dividendCents: number; winningTickets: number; breakageCents: number; winnerLane: number } ; results: { lane: number; place: number }[] }[];
      audit: { kind: string }[];
      bets: unknown[];
    };
    return { entry: saved.history[0], kinds: saved.audit.map((a) => a.kind) };
  });
  const t = stored.entry.tote!;
  expect(t.poolCents).toBe(1800);
  expect(t.retainedCents).toBe(900);
  expect(t.retainedCents + t.dividendCents * t.winningTickets + t.breakageCents).toBe(1800);
  expect(t.winnerLane).toBe(stored.entry.results.find((r) => r.place === 1)!.lane);
  expect(stored.kinds).toContain('tote_enabled');
  expect(stored.kinds).toContain('tote_settled');
  expect(stored.kinds).toContain('race_finished');

  /* The printed report carries the payout sheet. */
  await page.keyboard.press('Escape');
  await expect(page.locator('.print-only')).toContainText('Cash tote payout sheet');
  await expect(page.locator('.print-only')).toContainText('VGCCC minor gaming permit 12345');
});

test('a backup that says enabled without an attestation loads with the tote off', async ({ page }) => {
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('ndcc-snailrace-v3') ?? '{}');
    saved.cashTote = { enabled: true, ticketCents: 200, retainedPercent: 50 };
    localStorage.setItem('ndcc-snailrace-v3', JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  const controls = await openControls(page);
  const tote = controls.getByRole('region', { name: 'Cash tote' });
  await expect(tote.getByRole('button', { name: /Enable cash tote/i })).toBeVisible();
  await expect(tote).not.toContainText(/LIVE under/);
});
