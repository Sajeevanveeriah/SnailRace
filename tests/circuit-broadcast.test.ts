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
import { GATE_FAN_MS, SPREAD_MS, fieldSpread, finalGapText, gapSeconds, gateStagger, lapsDown, lapsDownText, placeTag, snailNumber, towerName } from '../components/race-broadcast/standings-format';
import { PALETTE } from '../lib/palette';
import {
  CameraRig,
  boxOf,
  finishShot,
  fitBox,
  holdSpan,
  packShot,
  smoothDamp,
  spanFor,
  toScreen,
  type Rect,
} from '../components/race-broadcast/circuit-camera';
import { circuitLayoutFor } from '../components/race-broadcast/circuit-layout';

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

test('kickers match the straight: BOOST only for good news, OUT for a retirement', () => {
  assert.equal(twistKicker({ phase: 'effect', consequence: 'advance', tone: 'good' }), 'BOOST');
  /* A wild twist (a dog, a cricket ball) reads TWIST on every track, even when its target gains. */
  assert.equal(twistKicker({ phase: 'effect', consequence: 'advance', tone: 'wild' }), 'TWIST');
  assert.equal(twistKicker({ phase: 'effect', consequence: 'retire', tone: 'bad' }), 'OUT');
  assert.equal(twistKicker({ phase: 'warning', consequence: 'delay', tone: 'bad' }), 'INCOMING');
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

test('a run-off shows its own snail numbers; a normal race counts on from the offset', () => {
  assert.equal(snailNumber(0, 20), 21);
  assert.equal(snailNumber(2, 20, [3, 17, 26]), 26);
  assert.equal(snailNumber(3, 20, [3, 17, 26]), 24);
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

test('the camera eases from the whole course to the pack in about 2 s, with no hard cut', () => {
  const rig = new CameraRig();
  const whole = { cx: 600, cy: 360, z: 1.2 };
  const pack = { cx: 640, cy: 560, z: 3.6 };
  let t = 0;
  rig.step(whole, 'gate', t, { vp, reduce: false });
  let previous = whole.z;
  let biggestStep = 0;
  for (t = 16; t <= 2100; t += 16) {
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

test('a compact tower row holds a long name in whole words, never ending on a joining word', () => {
  assert.equal(towerName('Speedy Gonzales the Third of Geelong West'), 'Speedy Gonzales');
  assert.equal(towerName('Slow Motion Steve'), 'Slow Motion Steve');
  assert.equal(towerName('Supercalifragilisticexpialidocious'), 'Supercalifragilis…');
  assert.ok(towerName('Lightning McSlime of the Bellarine').length <= 18);
});

test('a jump in the target moves the camera with no step in speed and no overshoot', () => {
  const state = { v: 0 };
  let x = 0;
  let lastV = 0;
  let biggestKick = 0;
  for (let t = 0; t < 3000; t += 16) {
    const target = t < 500 ? 0 : 100;
    const next = smoothDamp(x, target, state, 0.45, 0.016);
    const v = (next - x) / 0.016;
    biggestKick = Math.max(biggestKick, Math.abs(v - lastV));
    lastV = v;
    x = next;
    assert.ok(x <= 100 + 1e-9, `overshot to ${x}`);
  }
  assert.ok(Math.abs(x - 100) < 0.5, `settled at ${x}`);
  /* A first-order ease would jump straight to about 100 / 0.45 = 222 units/s on the first frame. */
  assert.ok(biggestKick < 40, `largest frame-to-frame speed change ${biggestKick.toFixed(1)} units/s`);
});

test('when a runner joins the shot the pan eases on without a jolt', () => {
  const rig = new CameraRig();
  let t = 0;
  let shot = rig.step({ cx: 600, cy: 400, z: 3 }, 'pack', t, { vp, reduce: false });
  let lastV = 0;
  let kick = 0;
  for (let i = 0; i < 200; i++) {
    t += 16;
    /* The shot's centre jumps 60 units when a chaser is let in at frame 50, and back out at frame 120. */
    const cx = 600 + (i >= 50 && i < 120 ? 60 : 0);
    const next = rig.step({ cx, cy: 400, z: 3 }, 'pack', t, { vp, reduce: false });
    const v = ((next.cx - shot.cx) * next.z) / 0.016;
    if (i > 0) kick = Math.max(kick, Math.abs(v - lastV));
    lastV = v;
    shot = next;
  }
  /* In screen pixels per second per frame: about 1 px/s/frame for every 100 px/s of travel is a glide; a snap is thousands. */
  assert.ok(kick < 150, `largest frame-to-frame pan speed change ${kick.toFixed(0)} px/s`);
});

test('a twist far from the leader is reached by a glide, and the camera glides back after it', () => {
  const rig = new CameraRig();
  const leader = { x: 600, y: 400 };
  const twist = [{ x: 200, y: 150 }, { x: 240, y: 150 }];
  let t = 0;
  let shot = rig.step({ cx: 600, cy: 400, z: 3 }, 'pack', t, { vp, reduce: false, keepIn: leader });
  let biggestStep = 0;
  for (let i = 0; i < 260; i++) {
    t += 16;
    const onAir = i >= 40 && i < 140;
    const next = rig.step({ cx: onAir ? 220 : 600, cy: onAir ? 150 : 400, z: 3 }, 'pack', t, { vp, reduce: false, keepIn: onAir ? twist : leader });
    biggestStep = Math.max(biggestStep, Math.hypot(next.cx - shot.cx, next.cy - shot.cy) * next.z);
    shot = next;
  }
  /* A 450-unit reframe at this zoom is about 1350 px: as a glide over 0.9 s no frame moves more than a few dozen px. */
  assert.ok(biggestStep < 60, `largest single-frame move ${biggestStep.toFixed(0)} px`);
});

test('the lead-pack shot holds the second and third with a margin, widening past its usual span when it must', () => {
  const leader = { x: 600, y: 560, angle: 0 };
  /* Second and third strung out well beyond a 560-unit shot. */
  const chasers = [
    { x: 380, y: 540 },
    { x: 250, y: 420 },
    { x: 120, y: 300 },
  ];
  const shot = packShot({ vp, leader, chasers, minSpan: 300, maxSpan: 560 });
  for (const p of [leader, chasers[0], chasers[1]]) assert.ok(inFrame(p, shot, 30), `placegetter at ${p.x},${p.y} not held with a margin`);
  /* The fourth is only an extra: it never widens the shot further. */
  assert.ok(vp.w / shot.z <= holdSpan(vp, [leader, chasers[0], chasers[1], { x: leader.x + 90, y: leader.y }]) + 1e-6);
  assert.ok(!inFrame(chasers[2], shot));
});

test('the camera keeps the third placegetter in frame as it falls back', () => {
  const rig = new CameraRig();
  let t = 0;
  let shot = rig.step({ cx: 600, cy: 400, z: 3 }, 'pack', t, { vp, reduce: false });
  for (let i = 0; i < 200; i++) {
    t += 16;
    const leader = { x: 600 + i * 2, y: 400 };
    const second = { x: 560 + i * 1.6, y: 410 };
    const third = { x: 520 + i * 1.1, y: 420 };
    const target = packShot({ vp, leader: { ...leader, angle: 0 }, chasers: [second, third], minSpan: 300, maxSpan: 560 });
    shot = rig.step(target, 'pack', t, { vp, reduce: false, keepIn: [third, second, leader] });
    if (i > 60) for (const p of [leader, second, third]) assert.ok(inFrame(p, shot, vp.h * 0.02), `frame ${i}: ${p.x},${p.y} out of shot`);
  }
});

test('place badges and gaps wait for the field to spread', () => {
  assert.equal(fieldSpread(0, 0, 76), false);
  assert.equal(fieldSpread(1000, 200, 76), false, 'never while the gate fan is still easing out');
  assert.equal(fieldSpread(GATE_FAN_MS + 100, 20, 76), false);
  assert.equal(fieldSpread(GATE_FAN_MS + 100, 90, 76), true);
  assert.equal(fieldSpread(SPREAD_MS, 0, 76), true);
  assert.equal(gapSeconds('+0.4s'), 0.4);
  assert.equal(gapSeconds('leader'), 0);
  assert.equal(gapSeconds('RET'), 0);
});

test('the gate fans the field back across the lanes and the fan eases out without anyone going backwards', () => {
  assert.equal(gateStagger(0, 0), 0);
  assert.ok(gateStagger(11, 0) > gateStagger(5, 0));
  assert.equal(gateStagger(11, GATE_FAN_MS), 0);
  for (let t = 0; t < GATE_FAN_MS; t += 100) assert.ok(gateStagger(11, t + 100) <= gateStagger(11, t));
});

test('lane 12 is a dark saturated colour, legible under white numerals and unlike the other eleven', () => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = (hex: string) => {
    const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const twelve = PALETTE[11];
  assert.ok(1.05 / (lum(twelve.shell) + 0.05) >= 4.5, 'white on the lane 12 shell reads at 4.5:1 or better');
  const [r, g, b] = rgb(twelve.shell);
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) > 0.4, 'saturated, not grey');
  for (const other of PALETTE.slice(0, 11)) {
    const d = Math.hypot(...rgb(other.shell).map((c, i) => c - rgb(twelve.shell)[i]));
    assert.ok(d > 0.25, `lane 12 too close to ${other.shell}`);
  }
});

test('every frame keeps the course full width, with the commentary as a small caption over it', () => {
  /* The Boundary Oval with its start label is about 1.38 wide for each unit high. */
  const oval = 1.38;
  assert.equal(circuitLayoutFor(1920, 1080, oval), 'top');
  assert.equal(circuitLayoutFor(1600, 816, oval), 'top');
  assert.equal(circuitLayoutFor(390, 640, oval), 'top');
  /* A 2000 x 780 browser window less its toolbars and the control bar: short and very wide. */
  assert.equal(circuitLayoutFor(2000, 631, oval), 'top');
  assert.equal(circuitLayoutFor(3440, 1350, oval), 'top');
  /* Nothing to measure yet: the default layout. */
  assert.equal(circuitLayoutFor(0, 0, oval), 'top');
});
