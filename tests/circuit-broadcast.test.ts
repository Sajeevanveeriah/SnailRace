import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LockedRaceEvent, RaceResult } from '../lib/types';
import {
  featuredLane,
  featuredLanes,
  stagedAt,
  storyWindows,
  twistKicker,
} from '../components/race-broadcast/twist-staging';
import { finalGapText, lapsDown, lapsDownText, placeTag } from '../components/race-broadcast/standings-format';
import {
  CameraRig,
  boxOf,
  finishShot,
  fitBox,
  packShot,
  spanFor,
  toScreen,
  type Rect,
} from '../components/race-broadcast/circuit-camera';

const event = (id: string, warningAtMs: number, effectAtMs: number, extra: Partial<LockedRaceEvent> = {}): LockedRaceEvent => ({
  id,
  kind: 'roller',
  label: `Twist ${id}`,
  tone: 'bad',
  sound: 'weird',
  targetLanes: [2],
  consequence: 'delay',
  warningAtMs,
  revealAtMs: warningAtMs + 500,
  effectAtMs,
  commentaryAtMs: effectAtMs + 200,
  effectEndMs: effectAtMs + 1500,
  clockDeltaMsByLane: { 2: -800 },
  warningText: 'warning',
  revealText: 'reveal',
  commentaryText: 'hit',
  ...extra,
});

test('every twist shows an INCOMING card and then its hit card, one story at a time', () => {
  const events = [event('a', 2000, 4600), event('b', 8000, 10600), event('post', 13000, 15600, { label: 'Magpie at the post' })];
  const windows = storyWindows(events);
  for (const e of events) {
    const warning = stagedAt(windows, e.warningAtMs + 100);
    assert.equal(warning?.eventId, e.id);
    assert.equal(warning?.phase, 'warning');
    assert.equal(twistKicker(warning!), 'INCOMING');
    const hit = stagedAt(windows, e.effectAtMs + 100);
    assert.equal(hit?.eventId, e.id);
    assert.equal(hit?.phase, 'effect');
    assert.equal(twistKicker(hit!), 'TWIST');
  }
  /* Clear between stories. */
  assert.equal(stagedAt(windows, 7900), null);
  for (let i = 1; i < windows.length; i++) assert.ok(windows[i].onAirMs >= windows[i - 1].offAirMs);
});

test('at the tightest spacing the engine allows every twist still gets its warning, and the hit before it a readable beat', () => {
  /* Warnings 2.5 s before each hit, hits 3 s apart. */
  const events = [event('a', 2000, 4500), event('b', 5000, 7500), event('c', 8000, 10500)];
  const windows = storyWindows(events);
  for (const e of events) {
    const warnings: number[] = [];
    const hits: number[] = [];
    for (let t = 0; t < 14000; t += 50) {
      const on = stagedAt(windows, t);
      if (on?.eventId !== e.id) continue;
      (on.phase === 'warning' ? warnings : hits).push(t);
    }
    assert.ok(warnings.length * 50 >= 1000, `${e.id} warning on air ${warnings.length * 50} ms`);
    assert.ok(hits.length * 50 >= 1200, `${e.id} hit on air ${hits.length * 50} ms`);
    assert.ok(Math.max(...warnings) < Math.min(...hits));
  }
});

test('a hit is never shown late, even when the plan crowds two stories', () => {
  const windows = storyWindows([event('a', 1000, 3600), event('b', 3000, 4200)]);
  assert.equal(stagedAt(windows, 4300)?.eventId, 'b');
  assert.equal(stagedAt(windows, 4300)?.phase, 'effect');
});

test('kickers read BOOST and OUT from the consequence', () => {
  assert.equal(twistKicker({ phase: 'effect', consequence: 'advance', tone: 'wild' }), 'BOOST');
  assert.equal(twistKicker({ phase: 'effect', consequence: 'retire', tone: 'bad' }), 'OUT');
});

test('the prop lands on the snail that wears the card: the lifted chaser on a boost, the held one on a twist', () => {
  const pair = { targetLanes: [0, 8], deltaByLane: { 0: -600, 8: 900 } };
  assert.deepEqual(featuredLanes({ ...pair, consequence: 'advance' }), [8]);
  assert.equal(featuredLane({ ...pair, consequence: 'delay' }, 3), 0);
  assert.equal(featuredLane({ targetLanes: [], deltaByLane: {}, consequence: 'delay' }, 3), 3);
});

const result = (lane: number, place: number, extra: Partial<RaceResult> = {}): RaceResult => ({
  lane,
  name: `Snail ${lane + 1}`,
  place,
  finishMs: null,
  ...extra,
});

test('final standings give every place a gap and never say classified', () => {
  const winner = result(4, 1, { finishMs: 30000, status: 'finished' });
  assert.equal(finalGapText(winner, winner, 1), '30.0s');
  assert.equal(finalGapText(result(1, 2, { finishMs: 31200, status: 'finished' }), winner, 1), '+1.2s');
  assert.equal(finalGapText(result(2, 3, { status: 'classified', progressAtStop: 0.95 }), winner, 1), '+1.5s');
  assert.equal(finalGapText(result(3, 9, { status: 'classified', progressAtStop: 0.7 }), winner, 4), '+1 LAP');
  assert.equal(finalGapText(result(5, 10, { status: 'retired' }), winner, 4), 'RET');
  for (const text of [finalGapText(result(2, 3, { status: 'classified', progressAtStop: 0.99 }), winner, 1)]) assert.doesNotMatch(text, /CLASSIFIED/);
});

test('lapped runners are counted in whole laps', () => {
  assert.equal(lapsDown(0.8, 0.6, 4), 0);
  assert.equal(lapsDown(0.8, 0.55, 4), 1);
  assert.equal(lapsDown(0.9, 0.3, 4), 2);
  assert.equal(lapsDown(0.9, 0.1, 1), 0);
  assert.equal(lapsDownText(1), '+1 LAP');
  assert.equal(lapsDownText(2), '+2 LAPS');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(placeTag), ['1ST', '2ND', '3RD', '4TH', '11TH', '12TH', '13TH', '21ST', '22ND']);
});

const vp: Rect = { x: 0, y: 140, w: 1300, h: 720 };
const inFrame = (p: { x: number; y: number }, shot: { cx: number; cy: number; z: number }, margin = 0) => {
  const s = toScreen(p, shot, vp);
  return s.x >= vp.x + margin && s.x <= vp.x + vp.w - margin && s.y >= vp.y + margin && s.y <= vp.y + vp.h - margin;
};

test('the lead-pack shot never pulls out past its widest span, and always holds the leader', () => {
  const leader = { x: 600, y: 560, angle: 0 };
  const chasers = [
    { x: 560, y: 560 },
    { x: 520, y: 550 },
    { x: 300, y: 200 },
  ];
  const shot = packShot({ vp, leader, chasers, minSpan: 300, maxSpan: 560 });
  assert.ok(vp.w / shot.z <= 560 + 1e-6);
  assert.ok(inFrame(leader, shot, 40));
  assert.ok(inFrame(chasers[0], shot));
  assert.ok(!inFrame(chasers[2], shot));
});

test('a twist on air is always in the shot, with the leader when they fit and on its own when not', () => {
  const leader = { x: 600, y: 560, angle: 0 };
  const near = packShot({ vp, leader, chasers: [], twist: [{ x: 520, y: 540 }, { x: 570, y: 540 }], minSpan: 300, maxSpan: 560 });
  assert.ok(inFrame(leader, near) && inFrame({ x: 520, y: 540 }, near));
  const far = packShot({ vp, leader, chasers: [], twist: [{ x: 150, y: 200 }, { x: 200, y: 200 }], minSpan: 300, maxSpan: 560 });
  assert.ok(inFrame({ x: 150, y: 200 }, far) && inFrame({ x: 200, y: 200 }, far));
});

test('the finish shot frames the whole line and the leader', () => {
  const line = [{ x: 600, y: 500 }, { x: 600, y: 650 }];
  const shot = finishShot(vp, line, [{ x: 380, y: 570 }], 300, 900);
  for (const p of [...line, { x: 380, y: 570 }]) assert.ok(inFrame(p, shot, 10));
});

test('fitBox holds the whole course', () => {
  const box = { x0: 100, y0: 100, x1: 1100, y1: 650 };
  const shot = fitBox(box, vp);
  for (const p of [{ x: 100, y: 100 }, { x: 1100, y: 650 }]) assert.ok(inFrame(p, shot, -1));
  assert.ok(Math.abs(spanFor(box, vp) * shot.z - vp.w) < 1e-6);
  assert.deepEqual(boxOf([{ x: 1, y: 2 }, { x: -1, y: 5 }]), { x0: -1, y0: 2, x1: 1, y1: 5 });
});

test('the camera eases from the whole course to the pack in about 1.3 s, with no hard cut', () => {
  const rig = new CameraRig();
  const whole = { cx: 600, cy: 360, z: 1.2 };
  const pack = { cx: 640, cy: 560, z: 3.6 };
  let t = 0;
  rig.step(whole, 'gate', t, { vp, reduce: false });
  let previous = whole.z;
  let biggestStep = 0;
  for (t = 16; t <= 1400; t += 16) {
    const shot = rig.step(pack, 'pack', t, { vp, reduce: false });
    biggestStep = Math.max(biggestStep, Math.abs(Math.log(shot.z / previous)));
    previous = shot.z;
  }
  assert.ok(biggestStep < 0.06, `largest frame-to-frame zoom step ${biggestStep}`);
  assert.ok(Math.abs(previous / pack.z - 1) < 0.08, `ended at ${previous}`);
});

test('the following zoom does not pump when the pack breathes in and out', () => {
  const rig = new CameraRig();
  let t = 0;
  rig.step({ cx: 600, cy: 500, z: 3 }, 'pack', t, { vp, reduce: false });
  const zooms: number[] = [];
  for (let i = 0; i < 300; i++) {
    t += 16;
    /* The pack's ideal shot flickers between tight and slightly wide every half second. */
    const tight = Math.floor(t / 500) % 2 === 0;
    zooms.push(rig.step({ cx: 600, cy: 500, z: tight ? 3.3 : 2.85 }, 'pack', t, { vp, reduce: false }).z);
  }
  const late = zooms.slice(100);
  const swing = Math.max(...late) / Math.min(...late);
  assert.ok(swing < 1.08, `zoom swings ${swing}`);
});

test('the leader is never left at the edge of the frame', () => {
  const rig = new CameraRig();
  let t = 0;
  let shot = rig.step({ cx: 600, cy: 400, z: 3 }, 'pack', t, { vp, reduce: false });
  /* A target that lags far behind a moving leader. */
  for (let i = 0; i < 120; i++) {
    t += 16;
    const leader = { x: 600 + i * 3, y: 400 };
    shot = rig.step({ cx: 600, cy: 400, z: 3 }, 'pack', t, { vp, reduce: false, keepIn: leader });
    const s = toScreen(leader, shot, vp);
    assert.ok(s.x >= vp.x + vp.w * 0.13 && s.x <= vp.x + vp.w * 0.87, `leader at ${s.x}`);
    assert.ok(inFrame(leader, shot, vp.h * 0.13));
  }
});
