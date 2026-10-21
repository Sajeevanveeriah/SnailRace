import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ART_FOOT,
  ART_TOP,
  CARD_BAND,
  CROWD_BASE,
  CROWD_MAX_FIGURE,
  DISTANCE_POSTS,
  FULL_VIEW_EXTRA,
  POST_LINES,
  RUN_OUT,
  TRACK_BOTTOM,
  TRACK_LEN,
  TRACK_TOP,
  VIEW_H,
  crowdTop,
  featuredLane,
  fenceSlots,
  isFieldTwist,
  laneGeometry,
  propLanes,
  requiredViewH,
  runInStep,
  splashKicker,
  type RunInRunner,
} from '../components/sidescroller-geometry';

test('every snail stands inside its own lane for fields of 8 to 12, so no shell covers a neighbour', () => {
  for (const extra of [0, FULL_VIEW_EXTRA]) {
    for (let field = 8; field <= 12; field++) {
      for (let lane = 0; lane < field; lane++) {
        const geo = laneGeometry(lane, field, extra);
        const top = geo.y - ART_TOP * geo.scale;
        const bottom = geo.y + ART_FOOT * geo.scale;
        assert.ok(top >= geo.top, `lane ${lane} of ${field}: shell pokes into the lane above`);
        assert.ok(bottom <= geo.top + geo.pitch, `lane ${lane} of ${field}: foot reaches the lane below`);
        if (lane > 0) {
          const above = laneGeometry(lane - 1, field, extra);
          assert.ok(above.y + ART_FOOT * above.scale <= top, `lanes ${lane - 1} and ${lane} of ${field} overlap`);
        }
      }
      const last = laneGeometry(field - 1, field, extra);
      assert.ok(Math.abs(last.top + last.pitch - (TRACK_BOTTOM + extra)) < 1e-6);
    }
  }
  /* Twelve runners still get a usable snail. */
  assert.ok(laneGeometry(0, 12).scale > 0.25);
});

test('every shot keeps a band above the track for the twist card, in the follow shot and in full field view', () => {
  for (const extra of [0, FULL_VIEW_EXTRA]) {
    const h = requiredViewH(extra);
    const frameTop = VIEW_H + extra - h;
    assert.ok((TRACK_TOP - frameTop) / h >= CARD_BAND - 1e-9, `only ${((TRACK_TOP - frameTop) / h).toFixed(3)} of the frame above the track`);
    assert.ok(h >= TRACK_BOTTOM + extra - TRACK_TOP, 'every lane is in the frame');
  }
});

test('the crowd never reaches the bottom lane, even at the top of its bob', () => {
  assert.ok(crowdTop() >= TRACK_BOTTOM, `crowd reaches ${crowdTop()} over a track ending at ${TRACK_BOTTOM}`);
  /* And some of it is in shot: the frame ends at VIEW_H. */
  assert.ok(CROWD_BASE - CROWD_MAX_FIGURE < VIEW_H);
});

test('no distance post, start line or winning post cuts through a fence board', () => {
  const slots = fenceSlots(-1500, TRACK_LEN + 1500);
  assert.ok(slots.length >= 12);
  /* A post's own number board is 112 wide, so leave half of that clear either side. */
  const clearance = 56;
  for (const slot of slots) {
    for (const x of POST_LINES) {
      assert.ok(x <= slot.x - clearance || x >= slot.x + slot.w + clearance, `post at ${x} hits the board at ${slot.x}`);
    }
  }
  assert.equal(DISTANCE_POSTS.length, 9);
  assert.equal(POST_LINES[POST_LINES.length - 1], TRACK_LEN);
  assert.ok(TRACK_TOP < TRACK_BOTTOM);
});

const event = (targetLanes: number[], deltas: Record<number, number>, commentaryText = '') => ({
  targetLanes,
  clockDeltaMsByLane: deltas,
  commentaryText,
});

test('a prop lands on each runner the twist hits, and only those', () => {
  /* The bat: the victim is held, the batter is not hit. */
  assert.deepEqual(propLanes(event([2, 5], { 2: -900, 5: 300 })), [2]);
  /* A boost: the runner it sends on. */
  assert.deepEqual(propLanes(event([7], { 7: 1200 })), [7]);
  /* A field hold: everyone. */
  assert.deepEqual(propLanes(event([0, 1, 2, 3], { 0: -1, 1: -2, 2: -3, 3: -4 })), [0, 1, 2, 3]);
  assert.equal(isFieldTwist(event([0, 1, 2], {})), true);
  assert.equal(isFieldTwist(event([0, 1], {})), false);
});

test('the runner a caption names is the one highlighted', () => {
  const names = Array.from({ length: 12 }, (_, i) => `Snail ${i + 1}`);
  const lanes = names.map((_, i) => i);
  const plague = Object.fromEntries(lanes.map((lane) => [lane, -5000 - lane * 100]));
  plague[6] = -1200;
  /* "Snail 1" must not claim "Snail 10". */
  assert.equal(featuredLane(event(lanes, plague, 'Snail 10 is the first to shake it off!'), names), 9);
  /* No name in the caption: the least held recovers first. */
  assert.equal(featuredLane(event(lanes, plague, 'Who recovers first?'), names), 6);
  /* An explicit featured lane from the engine wins. */
  assert.equal(featuredLane({ ...event(lanes, plague, 'Snail 10 first'), featuredLane: 3 }, names), 3);
  /* A two-runner twist with no name in the caption has no featured runner. */
  assert.equal(featuredLane(event([1, 2], { 1: -100, 2: 100 }, 'What a swing!'), names), null);
});

test('the card says INCOMING, then TWIST, BOOST or OUT', () => {
  assert.equal(splashKicker('warning', 'good'), 'INCOMING');
  assert.equal(splashKicker('effect', 'good', 'advance'), 'BOOST');
  assert.equal(splashKicker('effect', 'bad', 'delay'), 'TWIST');
  assert.equal(splashKicker('effect', 'wild', 'retire'), 'OUT');
});

test('after the winner, the field runs in at its own pace without ever contradicting the result', () => {
  let runners: RunInRunner[] = [
    { lane: 0, place: 1, p: 1, rate: 0.00004 },
    /* Third, but ahead of second on the line and faster: it must wait. */
    { lane: 1, place: 3, p: 0.97, rate: 0.00005 },
    { lane: 2, place: 2, p: 0.95, rate: 0.00004 },
    { lane: 3, place: 4, p: 0.9, rate: 0.00003 },
    { lane: 4, place: 5, p: 0.5, rate: 0.00003, retired: true },
  ];
  const crossedAt = new Map<number, number>();
  for (let step = 0; step < 400; step++) {
    const before = new Map(runners.map((r) => [r.lane, r.p]));
    runners = runInStep(runners, 50);
    for (const r of runners) {
      assert.ok(r.p >= (before.get(r.lane) ?? 0), 'nobody runs backwards');
      assert.ok(r.p <= 1 + RUN_OUT + 1e-9, 'nobody runs out of the shot');
      if (r.p >= 1 && !crossedAt.has(r.lane)) crossedAt.set(r.lane, step);
    }
  }
  const order = [...crossedAt.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([lane]) => lane);
  assert.deepEqual(order.slice(0, 4), [0, 2, 1, 3]);
  assert.equal(runners.find((r) => r.lane === 4)?.p, 0.5, 'a retired runner stays where it stopped');
});
