import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const assertNoSeriousAxeFindings = async (page: Page) => {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(serious, serious.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
};

const advanceToRace = async (page: Page) => {
  await page.getByRole('button', { name: /Show the racecard/i }).click();
  await expect(page.locator('.show-screen')).toHaveAttribute('aria-label', 'RACECARD screen');
  await page.getByRole('button', { name: /Open the fun-chip market/i }).click();
  await expect(page.locator('.show-screen')).toHaveAttribute('aria-label', 'MARKET OPEN screen');
  await page.getByRole('button', { name: /Lock and race/i }).click();
  await expect(page.locator('.show-screen')).toHaveCount(0);
};

const setSprintRace = async (page: Page) => {
  await page.getByRole('button', { name: /Controls/i }).click();
  const controls = page.getByRole('region', { name: 'Moderator controls' });
  await expect(controls).toBeVisible();
  await controls.getByLabel('Lap length').selectOption('7000');
  await controls.getByLabel('Laps').selectOption('1');
  await controls.getByRole('button', { name: /Hide/i }).click();
  await expect(controls).toHaveAttribute('aria-hidden', 'true');
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
});

test('show flow isolates the hidden stage and remains accessible', async ({ page }) => {
  const welcome = page.getByRole('region', { name: 'WELCOME screen' });
  await expect(welcome).toBeVisible();
  const brand = welcome.locator('.club-brand').first();
  const crest = brand.locator('.club-brand-logo');
  await expect(brand).toContainText(/Newcomb.*District/i);
  await expect(crest).toBeVisible();
  await expect(crest).toHaveAttribute('alt', '');
  await expect(crest).toHaveAttribute(
    'src',
    /\/brand\/20260403-NDCC-Logo-Bg-Removed-Rev00\.png$/,
  );
  await expect.poll(() => crest.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.stage-shell')).toHaveAttribute('inert', '');
  await expect(page.locator('.stage-shell')).toHaveAttribute('aria-hidden', 'true');
  await assertNoSeriousAxeFindings(page);

  await page.getByRole('button', { name: /Show the racecard/i }).click();
  await expect(page.getByRole('region', { name: 'RACECARD screen' })).toBeVisible();
  await assertNoSeriousAxeFindings(page);

  await page.getByRole('button', { name: /Open the fun-chip market/i }).click();
  const market = page.getByRole('region', { name: 'MARKET OPEN screen' });
  await expect(market).toBeVisible();
  await expect(market).toContainText('FUN CHIPS - NO MONETARY VALUE');
  await assertNoSeriousAxeFindings(page);
});

test('race uses production art and commentary avoids monetary language', async ({ page }, testInfo) => {
  await advanceToRace(page);
  await expect(page.locator('.stage-shell')).not.toHaveAttribute('inert', '');
  await page.getByRole('button', { name: /Start race/i }).click();

  await expect(page.locator('.tv-art-background')).toBeVisible();
  await expect(page.locator('.tv-snail-sprite')).toHaveCount(8);
  const hud = page.locator('.race-hud');
  await expect(hud).toHaveAttribute('aria-label', 'Race 1 status');
  await expect(hud.locator('.tv-clock')).toHaveAttribute('role', 'timer');
  const commentary = page.locator('.tv-strap-line');
  await expect(commentary).toHaveAttribute('role', 'status');
  await expect(commentary).toHaveAttribute('aria-live', 'polite');
  await expect(commentary).toHaveAttribute('aria-atomic', 'true');
  await expect(commentary).toContainText(/away|conditions|leads|from/i, { timeout: 10_000 });
  await expect(commentary).not.toContainText(/\b(money|cash|ticket|wager|punter)\b/i);
  await assertNoSeriousAxeFindings(page);
  await page.screenshot({ path: testInfo.outputPath('race-projector.png'), fullPage: true });
});

test('first finisher freezes the field and opens one result within one second', async ({ page }) => {
  await setSprintRace(page);
  await advanceToRace(page);
  await page.getByRole('button', { name: /Start race/i }).click();
  await expect(page.locator('.tv.racing')).toBeVisible({ timeout: 6_000 });

  const confirming = page.locator('.race-broadcast[data-race-phase="confirming"]');
  await expect(confirming).toBeVisible({ timeout: 10_000 });
  const confirmingAt = Date.now();
  const field = page.locator('.tv-runner');
  await expect(field).toHaveCount(8);
  expect(await page.locator('.tv-runner.finished').count()).toBeLessThan(8);
  const frozen = await field.evaluateAll((runners) =>
    runners.map((runner) => runner.getAttribute('transform')),
  );
  await page.waitForTimeout(200);
  expect(
    await field.evaluateAll((runners) =>
      runners.map((runner) => runner.getAttribute('transform')),
    ),
  ).toEqual(frozen);

  const winner = page.getByRole('dialog').filter({ hasText: /Race 1 winner/i });
  await expect(winner).toBeVisible({ timeout: 1_000 });
  expect(Date.now() - confirmingAt).toBeLessThanOrEqual(1_000);
  await expect(winner).toHaveCount(1);

  const recordedOnce = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem('ndcc-snailrace-v3');
      if (!raw) return { results: 0, finishEvents: 0 };
      const saved = JSON.parse(raw) as {
        history: { raceNo: number; void?: boolean }[];
        audit: { kind: string; raceNo: number }[];
      };
      return {
        results: saved.history.filter((entry) => entry.raceNo === 1 && !entry.void).length,
        finishEvents: saved.audit.filter(
          (entry) => entry.kind === 'race_finished' && entry.raceNo === 1,
        ).length,
      };
    });
  await expect.poll(recordedOnce).toEqual({ results: 1, finishEvents: 1 });
  await page.waitForTimeout(200);
  expect(await recordedOnce()).toEqual({ results: 1, finishEvents: 1 });
});

test('200 percent zoom does not create horizontal page overflow', async ({ page }) => {
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
});

test('reduced motion disables decorative race and surprise animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setSprintRace(page);
  await advanceToRace(page);
  await page.getByRole('button', { name: /Start race/i }).click();
  await expect(page.locator('.tv.racing')).toBeVisible({ timeout: 6_000 });
  await expect(page.locator('.race-broadcast')).toHaveAttribute('data-reduced-motion', 'true');
  const sprite = page.locator('.tv-snail-sprite').first();
  await expect(sprite).toBeVisible();
  await expect(sprite).toHaveCSS('animation-name', 'none');
});

test('phone route has a useful, non-overflowing fallback without a live room', async ({ page }) => {
  await page.goto('/play/');
  await expect(page.getByRole('heading', { name: /Join the races|Phone Play/i })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
  await assertNoSeriousAxeFindings(page);
});
