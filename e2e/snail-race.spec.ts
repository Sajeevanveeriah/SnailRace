import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

interface FirstFinisherProbe {
  confirmingAt: number | null;
  resultAt: number | null;
  finishedCount: number | null;
  transforms: Array<string | null> | null;
}

declare global {
  interface Window {
    __firstFinisherObserver?: MutationObserver;
    __firstFinisherProbe?: FirstFinisherProbe;
  }
}

const assertNoSeriousAxeFindings = async (page: Page) => {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(serious, serious.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual(
    [],
  );
};

const advanceToRace = async (page: Page) => {
  await page.getByRole('button', { name: /Show the racecard/i }).click();
  await expect(page.locator('.show-screen')).toHaveAttribute(
    'aria-label',
    'RACECARD screen',
  );
  await page.getByRole('button', { name: /Open the fun-chip market/i }).click();
  await expect(page.locator('.show-screen')).toHaveAttribute(
    'aria-label',
    'MARKET OPEN screen',
  );
  await page.getByRole('button', { name: /Lock and race/i }).click();
  await expect(page.locator('.show-screen')).toHaveCount(0);
};

const setSprintRace = async (page: Page) => {
  await page.getByRole('button', { name: /Controls/i }).click();
  const controls = page.getByRole('region', {
    name: 'Moderator controls',
    includeHidden: true,
  });
  await expect(controls).toBeVisible();
  await controls.getByLabel('Lap length').selectOption('7000');
  await controls.getByLabel('Laps').selectOption('1');
  await controls.getByRole('button', { name: /Hide/i }).click();
  await expect(controls).toHaveAttribute('aria-hidden', 'true');
};

const armFirstFinisherProbe = async (page: Page) => {
  await page.evaluate(() => {
    window.__firstFinisherObserver?.disconnect();

    const probe: FirstFinisherProbe = {
      confirmingAt: null,
      resultAt: null,
      finishedCount: null,
      transforms: null,
    };
    window.__firstFinisherProbe = probe;

    const capture = () => {
      const broadcast = document.querySelector<HTMLElement>('.race-broadcast');
      if (
        probe.confirmingAt === null &&
        broadcast?.dataset.racePhase === 'confirming'
      ) {
        probe.confirmingAt = performance.now();
        probe.finishedCount = document.querySelectorAll(
          '.tv-runner.finished',
        ).length;
        probe.transforms = Array.from(
          document.querySelectorAll('.tv-runner'),
          (runner) => runner.getAttribute('transform'),
        );
      }

      if (probe.confirmingAt !== null && probe.resultAt === null) {
        const result = Array.from(
          document.querySelectorAll<HTMLElement>('[role="dialog"]'),
        ).find(
          (dialog) =>
            /Race 1 winner/i.test(dialog.textContent ?? '') &&
            dialog.getClientRects().length > 0,
        );
        if (result) probe.resultAt = performance.now();
      }
    };

    const observer = new MutationObserver(capture);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: [
        'aria-hidden',
        'class',
        'data-race-phase',
        'open',
        'role',
      ],
      childList: true,
      subtree: true,
    });
    window.__firstFinisherObserver = observer;
    capture();
  });
};

const readFirstFinisherProbe = (page: Page) =>
  page.evaluate(() => window.__firstFinisherProbe ?? null);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
});

test('show flow isolates the hidden stage and remains accessible', async ({
  page,
}) => {
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
  await expect
    .poll(() => crest.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.locator('.stage-shell')).toHaveAttribute('inert', '');
  await expect(page.locator('.stage-shell')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await assertNoSeriousAxeFindings(page);

  await page.getByRole('button', { name: /Show the racecard/i }).click();
  await expect(
    page.getByRole('region', { name: 'RACECARD screen' }),
  ).toBeVisible();
  await assertNoSeriousAxeFindings(page);

  await page.getByRole('button', { name: /Open the fun-chip market/i }).click();
  const market = page.getByRole('region', { name: 'MARKET OPEN screen' });
  await expect(market).toBeVisible();
  await expect(market).toContainText('FUN CHIPS - NO MONETARY VALUE');
  await assertNoSeriousAxeFindings(page);
});

test('race uses production art and commentary avoids monetary language', async ({
  page,
}, testInfo) => {
  await advanceToRace(page);
  await expect(page.locator('.stage-shell')).not.toHaveAttribute('inert', '');
  await page.getByRole('button', { name: /Start race/i }).click();

  await expect(page.locator('.tv-art-background')).toBeVisible();
  await expect(page.locator('.tv-snail-sprite')).toHaveCount(8);
  await expect(page.locator('.race-broadcast')).toHaveAttribute(
    'data-course',
    'boundary-oval',
  );
  await expect(
    page.getByRole('img', {
      name: /Boundary Oval: 8 snails racing in marked lanes/i,
    }),
  ).toBeVisible();
  const hud = page.locator('.race-hud');
  await expect(hud).toHaveAttribute('aria-label', 'Race 1 status');
  await expect(hud.locator('.tv-clock')).toHaveAttribute('role', 'timer');
  await expect(hud.locator('.tv-clock')).toBeVisible();
  const commentary = page.locator('.tv-strap-line');
  await expect(commentary).toHaveAttribute('role', 'status');
  await expect(commentary).toHaveAttribute('aria-live', 'polite');
  await expect(commentary).toHaveAttribute('aria-atomic', 'true');
  await expect(commentary).toContainText(/away|conditions|leads|from/i, {
    timeout: 10_000,
  });
  await expect(commentary).not.toContainText(
    /\b(money|cash|ticket|wager|punter)\b/i,
  );
  await assertNoSeriousAxeFindings(page);
  await page.screenshot({
    path: testInfo.outputPath('race-projector.png'),
    fullPage: true,
  });
});

test('a twenty-runner field stays inside the unobscured ultra-wide telecast', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'projector',
    'Ultra-wide projector regression',
  );
  await page.setViewportSize({ width: 2048, height: 593 });
  await page.getByRole('button', { name: /Controls/i }).click();
  const controls = page.getByRole('region', {
    name: 'Moderator controls',
    includeHidden: true,
  });
  const fieldSize = controls.getByLabel('Number of racers');
  await expect(fieldSize).toBeEnabled();
  await fieldSize.selectOption('20');
  await expect(controls.getByLabel('Lane 20 name')).toBeVisible();
  await controls.getByRole('button', { name: /Hide/i }).click();

  await advanceToRace(page);
  await page.getByRole('button', { name: /Start race/i }).click();
  await expect(page.locator('.tv.racing')).toBeVisible({ timeout: 6_000 });
  await expect(page.locator('.tv-snail-sprite')).toHaveCount(20);
  await expect(
    page.getByRole('complementary', { name: 'Running order for 20 runners' }),
  ).toBeVisible();

  await expect
    .poll(async () => {
      const standings = await page.locator('.race-standings').boundingBox();
      const broadcast = await page.locator('.race-broadcast').boundingBox();
      const sprites = await page.locator('.tv-snail-sprite').all();
      if (!standings || !broadcast || !sprites.length) return false;
      const boxes = await Promise.all(
        sprites.map((sprite) => sprite.boundingBox()),
      );
      return boxes.every(
        (box) =>
          box !== null &&
          box.x >= broadcast.x - 1 &&
          box.x + box.width <= standings.x + 1,
      );
    })
    .toBe(true);

  await page.screenshot({
    path: testInfo.outputPath('twenty-runner-ultrawide.png'),
    fullPage: true,
  });
});

test('surprises announce warning, reveal and effect with a visible prop or symbol', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await setSprintRace(page);
  await page.getByRole('button', { name: /Controls/i }).click();
  const controls = page.getByRole('region', {
    name: 'Moderator controls',
    includeHidden: true,
  });
  await controls.getByLabel('Surprise director').selectOption('chaos');
  await controls.getByRole('button', { name: /Hide/i }).click();
  await advanceToRace(page);
  await page.getByRole('button', { name: /Start race/i }).click();

  const signal = page.locator('.course-event-ticker');
  await expect(signal).toBeVisible({ timeout: 15_000 });
  await expect(signal.locator('strong')).not.toHaveText(
    /Something is developing/i,
  );
  await expect(
    page.locator('.course-prop-image, .course-prop-symbol'),
  ).toBeVisible();
  const scene = await page.locator('.course-scene').boundingBox();
  const ticker = await signal.boundingBox();
  expect(scene).not.toBeNull();
  expect(ticker).not.toBeNull();
  expect(ticker!.y).toBeGreaterThanOrEqual(scene!.y + scene!.height);
  expect(ticker!.height).toBeLessThanOrEqual(35);
  await expect(page.locator('.race-surprise[role="status"]')).toHaveAttribute(
    'aria-live',
    'assertive',
  );
});

test('first finisher freezes the field and opens one result within one second', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await setSprintRace(page);
  await advanceToRace(page);
  await armFirstFinisherProbe(page);
  await page.getByRole('button', { name: /Start race/i }).click();
  await expect(page.locator('.tv.racing')).toBeVisible({ timeout: 6_000 });

  await expect
    .poll(
      async () => (await readFirstFinisherProbe(page))?.confirmingAt ?? null,
      { timeout: 15_000 },
    )
    .not.toBeNull();
  const lineSnapshot = await readFirstFinisherProbe(page);
  expect(lineSnapshot?.finishedCount).toBe(1);
  expect(lineSnapshot?.transforms).toHaveLength(8);

  const field = page.locator('.tv-runner');
  await expect(field).toHaveCount(8);
  await page.waitForTimeout(200);
  expect(
    await field.evaluateAll((runners) =>
      runners.map((runner) => runner.getAttribute('transform')),
    ),
  ).toEqual(lineSnapshot?.transforms);

  await expect
    .poll(async () => (await readFirstFinisherProbe(page))?.resultAt ?? null, {
      timeout: 2_000,
    })
    .not.toBeNull();
  const resultSnapshot = await readFirstFinisherProbe(page);
  expect(resultSnapshot?.resultAt).not.toBeNull();
  expect(resultSnapshot?.confirmingAt).not.toBeNull();
  expect(
    resultSnapshot!.resultAt! - resultSnapshot!.confirmingAt!,
  ).toBeLessThanOrEqual(1_000);

  const winner = page.getByRole('dialog').filter({ hasText: /Race 1 winner/i });
  await expect(winner).toBeVisible();
  await expect(winner).toHaveCount(1);
  await expect(
    page.locator('.race-broadcast [aria-label="Race 1 status"]'),
  ).toHaveCount(1);
  await expect(page.locator('.tv-lap')).toHaveText('LAP 1/1');

  const recordedOnce = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem('ndcc-snailrace-v3');
      if (!raw) return { results: 0, finishEvents: 0 };
      const saved = JSON.parse(raw) as {
        history: { raceNo: number; void?: boolean }[];
        audit: { kind: string; raceNo: number }[];
      };
      return {
        results: saved.history.filter(
          (entry) => entry.raceNo === 1 && !entry.void,
        ).length,
        finishEvents: saved.audit.filter(
          (entry) => entry.kind === 'race_finished' && entry.raceNo === 1,
        ).length,
      };
    });
  await expect.poll(recordedOnce).toEqual({ results: 1, finishEvents: 1 });
  await page.waitForTimeout(200);
  expect(await recordedOnce()).toEqual({ results: 1, finishEvents: 1 });

  /* The generated winner fanfare tears itself down after four bars. Keep the
     page alive long enough to cover that asynchronous lifecycle boundary. */
  await page.waitForTimeout(8_500);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('200 percent zoom does not create horizontal page overflow', async ({
  page,
}) => {
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 2,
      ),
    )
    .toBe(true);
  await page.keyboard.press('Space');
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 2,
      ),
    )
    .toBe(true);
});

test('reduced motion disables decorative race and surprise animation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setSprintRace(page);
  await advanceToRace(page);
  await page.getByRole('button', { name: /Start race/i }).click();
  await expect(page.locator('.tv.racing')).toBeVisible({ timeout: 6_000 });
  await expect(page.locator('.race-broadcast')).toHaveAttribute(
    'data-reduced-motion',
    'true',
  );
  const sprite = page.locator('.tv-snail-sprite').first();
  await expect(sprite).toBeVisible();
  await expect(sprite).toHaveCSS('animation-name', 'none');
});

test('phone route has a useful, non-overflowing fallback without a live room', async ({
  page,
}) => {
  await page.goto('/play/');
  await expect(
    page.getByRole('heading', { name: /Join the races|Phone Play/i }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 2,
      ),
    )
    .toBe(true);
  await assertNoSeriousAxeFindings(page);
});

test('camera changes preserve painted lanes without restarting the race', async ({
  page,
}, testInfo) => {
  await advanceToRace(page);
  await page.getByRole('button', { name: /Start race/i }).click();
  await expect(page.locator('.tv.racing')).toBeVisible({ timeout: 6000 });
  const clock = page.locator('.tv-clock');
  await expect(clock).not.toHaveText('0:00.0');
  await page
    .getByRole('button', { name: 'Full course view', exact: true })
    .click();
  await expect(page.locator('.race-broadcast')).toHaveAttribute(
    'data-camera',
    'course',
  );
  await expect(page.locator('.course-world')).toBeVisible();
  await expect(page.locator('.course-runner-number')).toHaveCount(8);
  await expect(page.locator('.course-lane')).toHaveCount(8);
  await expect(page.locator('.race-broadcast')).toHaveAttribute(
    'data-race-phase',
    'running',
  );
  await page.screenshot({ path: testInfo.outputPath('full-course.png') });
  await page.getByRole('button', { name: 'Follow field', exact: true }).click();
  await expect(page.locator('.race-broadcast')).toHaveAttribute(
    'data-camera',
    'trackside',
  );
  await expect(page.locator('.course-world')).toBeVisible();
  await expect(page.locator('.tv-snail-sprite')).toHaveCount(8);
  await expect(clock).not.toHaveText('0:00.0');
});

test('natural commentary preview loads a bundled audio clip', async ({
  page,
}) => {
  await page.getByRole('button', { name: /Controls/i }).click();
  const controls = page.getByRole('region', {
    name: 'Moderator controls',
    includeHidden: true,
  });
  await controls.getByLabel('Commentary voice').selectOption('recorded');
  const response = page.waitForResponse((response) =>
    response.url().endsWith('/audio/commentary/ready.mp3'),
  );
  await controls
    .getByRole('button', { name: 'Preview commentator', exact: true })
    .click();
  expect((await response).ok()).toBe(true);
  await expect(controls.getByLabel('Spoken race caller')).toBeEnabled();
});

for (const [raceNumber, courseId] of [
  'boundary-oval',
  'pavilion-chicane',
  'floodlight-eight',
  'practice-nets',
].entries()) {
  test(`${courseId} paints runner feet on their visible lanes`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile' && courseId !== 'floodlight-eight',
      'All circuits use one geometry renderer; retain the crossover as the phone visual case.',
    );
    await setSprintRace(page);
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem('ndcc-snailrace-v3')),
      )
      .not.toBeNull();
    await page.evaluate((number) => {
      const key = 'ndcc-snailrace-v3';
      const saved = JSON.parse(localStorage.getItem(key)!);
      saved.raceNumber = number;
      localStorage.setItem(key, JSON.stringify(saved));
    }, raceNumber);
    await page.reload();
    await advanceToRace(page);
    await page.getByRole('button', { name: /Start race/i }).click();
    await expect(page.locator('.tv.racing')).toBeVisible({ timeout: 6000 });
    await page
      .getByRole('button', { name: 'Full course view', exact: true })
      .click();
    await expect(page.locator('.race-broadcast')).toHaveAttribute(
      'data-course',
      courseId,
    );
    await expect
      .poll(async () =>
        Number(
          await page
            .locator('.tv-runner')
            .first()
            .getAttribute('data-progress'),
        ),
      )
      .toBeGreaterThan(0.12);
    await expect(page.locator('.course-world')).toBeVisible();
    const errors = await page.locator('.tv-runner').evaluateAll((runners) =>
      runners.map((runner) => {
        const lane = document.querySelector<SVGPathElement>(
          `.course-lane[data-lane="${runner.getAttribute('data-lane')}"]`,
        )!;
        const matrix = (runner as SVGGElement).transform.baseVal.consolidate()!
          .matrix;
        // Compare the runner foot against the actual SVG paint, independently of renderer calculations.
        const length = lane.getTotalLength();
        let nearest = Infinity;
        for (let i = 0; i <= 3000; i++) {
          const point = lane.getPointAtLength((length * i) / 3000);
          nearest = Math.min(
            nearest,
            Math.hypot(point.x - matrix.e, point.y - matrix.f),
          );
        }
        return nearest;
      }),
    );
    expect(Math.max(...errors)).toBeLessThan(1.5);
    await page.screenshot({ path: testInfo.outputPath(`${courseId}.png`) });
  });
}

test('initial page hydration has no React errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.reload();
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  expect(errors).toEqual([]);
});
