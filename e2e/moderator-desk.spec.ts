import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const openDesk = async (page: Page) => {
  const opening = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open moderator window', exact: true }).click();
  const desk = await opening;
  await expect(desk.getByRole('heading', { name: 'Moderator desk' })).toBeVisible();
  await expect(page.locator('[data-moderator-connected]')).toHaveAttribute('data-moderator-connected', 'true');
  return desk;
};
const raceCard = async (desk: Page) => {
  await desk.getByRole('button', { name: 'Show the racecard', exact: true }).click();
  await desk.getByRole('button', { name: 'Open the fun-chip market', exact: true }).click();
  await desk.getByRole('button', { name: 'Lock and race', exact: true }).click();
};
const sprint = async (desk: Page) => {
  await desk.getByRole('button', { name: 'Settings', exact: true }).click();
  await desk.getByLabel('Lap length').selectOption('7000');
  await desk.getByLabel('Laps').selectOption('1');
  await desk.getByRole('button', { name: /Hide/ }).click();
};
const readNight = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('ndcc-snailrace-v3') ?? '{}'));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
});

test('moderator is a separate document with shared settings and accessible controls', async ({ page }) => {
  const desk = await openDesk(page);
  await desk.setViewportSize({ width: 1280, height: 820 });
  await expect(page.getByRole('toolbar', { name: 'Show controls' })).toHaveCount(0);
  await expect(desk.locator('.race-broadcast')).toHaveCount(0);
  await expect(desk.locator('script[src]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Moderator controls' })).toHaveCount(0);
  await desk.getByRole('checkbox', { name: 'Commentary', exact: true }).uncheck();
  await expect.poll(async () => (await readNight(page)).caller).toBe(false);
  await sprint(desk);
  await expect.poll(async () => (await readNight(page)).raceDurationMs).toBe(7000);
  await raceCard(desk);
  await expect(page.locator('.show-screen')).toHaveCount(0);
  await expect.poll(async () => (await readNight(page)).bettingOpen).toBe(false);
  await desk.getByRole('radio', { name: 'Full course', exact: true }).check();
  await expect(page.locator('.race-broadcast')).toHaveAttribute('data-camera', 'course');
  const axe = await new AxeBuilder({ page: desk }).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  await desk.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => desk.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(desk.getByRole('button', { name: 'Start race', exact: true })).toBeInViewport();
});

test('race survives closing, reopening and reloading the desk with one settlement', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let desk = await openDesk(page);
  await sprint(desk);
  await raceCard(desk);
  await desk.getByRole('button', { name: 'Start race', exact: true }).click();
  await expect(page.locator('.race-broadcast')).toHaveAttribute('data-race-phase', 'running', { timeout: 15_000 });
  const held = (await readNight(page)).heldRaceStart.planHash;
  await desk.close();
  await expect(page.locator('[data-moderator-connected]')).toHaveAttribute('data-moderator-connected', 'false');
  desk = await openDesk(page);
  await expect(desk.getByRole('button', { name: 'Race in progress' })).toBeDisabled();
  await expect(desk.getByRole('checkbox', { name: 'Holding screen' })).toBeDisabled();
  await desk.reload();
  await expect(desk.getByRole('heading', { name: 'Moderator desk' })).toBeVisible();
  await expect.poll(async () => (await readNight(page)).history.filter((h: { void?: boolean }) => !h.void).length, { timeout: 25_000 }).toBe(1);
  const night = await readNight(page);
  expect(night.history[0].planHash).toBe(held);
  expect(night.heldRaceStart).toBeNull();
  await expect(desk.getByRole('button', { name: 'Show the championship' })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Close winner/ })).toHaveCount(0);
  await desk.getByRole('button', { name: 'Show the championship' }).click();
  await expect(page.getByRole('region', { name: 'CHAMPIONSHIP screen' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('fullscreen fills the game window and stays independent of the moderator', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Mobile Chrome does not provide desktop multi-display fullscreen.');
  const desk = await openDesk(page);
  await page.getByRole('button', { name: 'Fullscreen F', exact: true }).click();
  await expect(page.locator('[data-projector-fullscreen]')).toHaveAttribute('data-projector-fullscreen', 'true');
  await expect(desk.getByRole('status').filter({ hasText: 'Projector connected' })).toContainText('Fullscreen');
  expect(await desk.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await page.mouse.move(500, 500);
  await expect(page.locator('.projector-tools')).toHaveCSS('opacity', '0');
  await raceCard(desk);
  const size = await page.locator('.race-broadcast').boundingBox();
  expect(size?.width).toBe(page.viewportSize()?.width);
  expect(size?.height).toBe(page.viewportSize()?.height);
  await page.evaluate(() => document.exitFullscreen());
  await expect(desk.getByRole('status').filter({ hasText: 'Projector connected' })).toContainText('Windowed');
});

test('holding screen and settings stop accidental show advances', async ({ page }) => {
  const desk = await openDesk(page);
  await desk.getByRole('checkbox', { name: 'Holding screen', exact: true }).check();
  await expect(page.getByRole('heading', { name: 'Back shortly' })).toBeVisible();
  await desk.locator('body').press('PageDown');
  await expect(page.getByRole('region', { name: 'WELCOME screen' })).toBeVisible();
  await desk.getByRole('checkbox', { name: 'Holding screen', exact: true }).uncheck();
  await expect(page.getByRole('heading', { name: 'Back shortly' })).toHaveCount(0);
  await desk.getByRole('button', { name: 'Settings', exact: true }).click();
  await desk.getByLabel('Event name', { exact: true }).fill('NDCC Finals Night');
  await desk.locator('body').press('PageDown');
  expect((await readNight(page)).showPhase).toBe('lobby');
  await desk.getByRole('button', { name: /Hide/ }).click();
  await desk.locator('body').press('PageDown');
  await expect(page.getByRole('region', { name: 'RACECARD screen' })).toBeVisible();
  await desk.keyboard.down('PageDown');
  await desk.keyboard.down('PageDown');
  await desk.keyboard.up('PageDown');
  expect((await readNight(page)).showPhase).toBe('market');
  await desk.getByRole('button', { name: 'Return controls to projector' }).click();
  await expect(page.getByRole('toolbar', { name: 'Show controls' })).toBeVisible();
});

test('blocked popups and rejected fullscreen retain usable controls', async ({ page }) => {
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole('button', { name: 'Open moderator window' }).click();
  await expect(page.getByRole('status')).toContainText('moderator window was blocked');
  await expect(page.getByRole('toolbar', { name: 'Show controls' })).toBeVisible();
  await page.evaluate(() => { document.documentElement.requestFullscreen = () => Promise.reject(new Error('NotAllowedError')); });
  await page.getByRole('button', { name: 'Fullscreen F', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('browser needs that click');
  await expect(page.locator('[data-projector-fullscreen]')).toHaveAttribute('data-projector-fullscreen', 'false');
});

test('navigating the desk away restores controls without crashing the show', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const desk = await openDesk(page);
  await desk.goto('data:text/html,<h1>Another page</h1>');
  await expect(page.locator('[data-moderator-connected]')).toHaveAttribute('data-moderator-connected', 'false');
  await expect(page.getByRole('toolbar', { name: 'Show controls' })).toBeVisible();
  await page.getByRole('button', { name: /^Show the racecard/ }).click();
  await expect(page.getByRole('region', { name: 'RACECARD screen' })).toBeVisible();
  expect(errors).toEqual([]);
});


test('recorded media plays only on the projector and settles from the desk', async ({ page }) => {
  const media = readFileSync('e2e/fixtures/recorded-race.webm');
  const sha = createHash('sha256').update(media).digest('hex');
  const race = {
    raceId: 'fixture', title: 'Recorded test race', runners: ['Speedy', 'Turbo', 'Lightning'],
    durationMs: 6000, mediaFileName: 'recorded-race.webm', mediaSha256: sha,
    mediaBytes: media.length, mediaType: 'video/webm', resultOrder: [1, 0, 2],
    source: 'Generated colour frame for browser verification', licence: 'Project test fixture', createdAt: 1_700_000_000_000,
  };
  await page.evaluate((race) => {
    localStorage.setItem('ndcc-snailrace-v3', JSON.stringify({ eventMode: 'recorded', showPhase: 'race', racePack: { schema: 1, packId: 'test-pack', title: 'Test card', createdAt: 1_700_000_000_000, races: [race] }, packLockedAt: 1_700_000_000_000, packCommit: 'a'.repeat(64) }));
  }, race);
  await page.reload();
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  const desk = await openDesk(page);
  await desk.getByRole('button', { name: 'Draw the next race' }).click();
  await expect(desk.getByRole('button', { name: 'Play race', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Play race', exact: true })).toHaveCount(0);
  await desk.getByRole('button', { name: 'Settings', exact: true }).click();
  const choosing = desk.waitForEvent('filechooser');
  await desk.getByRole('button', { name: 'Attach and verify media', exact: true }).click();
  await (await choosing).setFiles({ name: 'recorded-race.webm', mimeType: 'video/webm', buffer: media });
  await expect(desk.getByText('1 media file(s) verified.', { exact: true })).toBeVisible();
  await desk.getByRole('button', { name: /Hide/ }).click();
  await desk.getByRole('button', { name: 'Play race', exact: true }).click();
  await expect(page.locator('video.pack-video')).toBeVisible();
  await expect(desk.locator('video')).toHaveCount(0);
  await expect.poll(() => page.locator('video.pack-video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0);
  await expect(desk.getByRole('button', { name: 'Skip to result' })).toBeVisible();
  await expect.poll(async () => (await readNight(page)).history?.length ?? 0, { timeout: 15_000 }).toBe(1);
  expect((await readNight(page)).history[0].results[0].name).toBe('Turbo');
});
