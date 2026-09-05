import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Broadcaster, clampCameraX, runnerSafeFrame, lapProgress, resultGapText, type BroadcastInput } from '../lib/broadcast';

const visibleAnchors = (input: BroadcastInput, times: number[]) => {
  const director = new Broadcaster();
  for (const tMs of times) {
    const framing = director.update({ ...input, tMs });
    for (const world of input.worldByPosition) {
      const x = 800 + (world - framing.camX) * framing.zoom;
      assert.ok(x >= framing.safeLeft, `${framing.shot} put ${x} left of ${framing.safeLeft}`);
      assert.ok(x <= framing.safeRight, `${framing.shot} put ${x} right of ${framing.safeRight}`);
    }
  }
};

test('every director shot keeps a twenty-runner field in the unobscured frame', () => {
  const worldByPosition = Array.from({ length: 20 }, (_, index) => 3600 - index * 115);
  const base: BroadcastInput = {
    tMs: 0,
    worldByPosition,
    finishWorld: 4000,
    leadP: 0.9,
    finalStraight: false,
    photoFinish: false,
    safeLeft: 100,
    safeRight: 1100,
  };
  visibleAnchors(base, [0, 10_001, 18_001, 26_001]);
  visibleAnchors({ ...base, finalStraight: true }, [30_000]);
});

test('safe frames reserve graphics space on ultra-wide and portrait screens', () => {
  const ultra = runnerSafeFrame(-228.5, 2057);
  const portrait = runnerSafeFrame(593, 414);
  assert.ok(ultra.left > -228.5 && ultra.right < 1828.5);
  assert.ok(portrait.left > 593 && portrait.right < 1007);
  assert.ok(portrait.right - portrait.left >= 100);

  const field = Array.from({ length: 20 }, (_, index) => 4000 - index * 120);
  visibleAnchors(
    {
      tMs: 30_000,
      worldByPosition: field,
      finishWorld: 4000,
      leadP: 1,
      finalStraight: true,
      photoFinish: true,
      safeLeft: portrait.left,
      safeRight: portrait.right,
    },
    [30_000],
  );
});

test('pan easing is clamped before it can strand a runner', () => {
  const safe = { left: 100, right: 1100 };
  const worlds = [900, 1900, 2900, 3900];
  const zoom = 0.3;
  const camera = clampCameraX(-500, zoom, worlds, safe);
  const anchors = worlds.map((world) => 800 + (world - camera) * zoom);
  assert.ok(Math.min(...anchors) >= safe.left);
  assert.ok(Math.max(...anchors) <= safe.right);
});

test('course marker follows each lap and stays at the final finish', () => {
  assert.equal(lapProgress(0, 3), 0);
  assert.equal(lapProgress(0.25, 3), 0.75);
  assert.equal(lapProgress(0.5, 3), 0.5);
  assert.equal(lapProgress(1, 3), 1);
  assert.equal(lapProgress(-1, 3), 0);
  assert.equal(lapProgress(2, 3), 1);
});

test('final timing distinguishes finishers, classified runners and retirees', () => {
  const runner = { lane: 0, name: 'Speedy', place: 1 };
  assert.equal(resultGapText({ ...runner, finishMs: 12340 }), '12.3s');
  assert.equal(resultGapText({ ...runner, finishMs: null, status: 'classified' }), 'CLASSIFIED');
  assert.equal(resultGapText({ ...runner, finishMs: null, status: 'retired' }), 'RET');
});
