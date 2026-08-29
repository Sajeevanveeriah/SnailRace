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

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('show flow isolates the hidden stage and remains accessible', async ({ page }) => {
  const welcome = page.getByRole('region', { name: 'WELCOME screen' });
  await expect(welcome).toBeVisible();
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
  await expect(page.locator('.tv-snail-sprite')).toHaveCount(6);
  await expect(page.locator('.tv-strap-line')).toContainText(/away|conditions|leads|from/i, { timeout: 10_000 });
  await expect(page.locator('.tv-strap-line')).not.toContainText(/\b(money|cash|ticket|wager|punter)\b/i);
  await assertNoSeriousAxeFindings(page);
  await page.screenshot({ path: testInfo.outputPath('race-projector.png'), fullPage: true });
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
  await advanceToRace(page);
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
