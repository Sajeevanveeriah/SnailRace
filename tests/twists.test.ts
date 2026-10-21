import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTION_MAX,
  CAPTION_READ_MS,
  INTENSITY_RANGES,
  POST_PROGRESS,
  RACE_LENGTH_TOLERANCE,
  TWIST_GAP_MS,
  TWIST_HOLD_MS,
  TWIST_MIN_SPACING_MS,
  TWIST_MIN_WARNING_MS,
  composeTwistCaption,
  drawLockedRacePlan,
  intensityLabel,
  lockedProgressAt,
  ordinal,
  shortName,
  twistCapacity,
  twistCaptionBooks,
  twistFamily,
  twistRange,
  type IntensityId,
} from '../lib/race-engine';
import type { LockedRacePlan } from '../lib/types';

const LEVELS = Object.keys(INTENSITY_RANGES) as IntensityId[];
const field = (n: number, long = false) =>
  Array.from({ length: n }, (_, i) => (long && i % 3 === 0 ? `Speedy${i + 1} Gonzales the Third of Geelong West` : `Snail ${i + 1}`));
const LENGTHS = [7_000, 10_000, 12_000, 15_000, 20_000, 28_000, 30_000, 40_000, 45_000, 60_000, 90_000, 120_000];

/** The running order at race time `t`, leader first, retired runners left out. */
function orderAt(plan: LockedRacePlan, t: number): number[] {
  return plan.runners
    .filter((runner) => !plan.events.some((e) => e.consequence === 'retire' && e.targetLanes.includes(runner.lane) && e.effectAtMs <= t))
    .map((runner) => ({ lane: runner.lane, p: lockedProgressAt(plan, runner.lane, t) }))
    .sort((a, b) => b.p - a.p)
    .map((row) => row.lane);
}

/** A spread of plans: every level, every length from 7 s to 2 minutes, one to nine laps, eight to twelve runners. */
function* plans(perCell = 24): Generator<LockedRacePlan> {
  for (const durationMs of LENGTHS) {
    for (const intensity of LEVELS) {
      for (let i = 0; i < perCell; i++) {
        const seed = (durationMs * 31 + i * 7919 + LEVELS.indexOf(intensity) * 104_729) >>> 0;
        yield drawLockedRacePlan(seed, field(8 + (i % 5), i % 4 === 0), durationMs, true, intensity, 1 + (i % 9), i % 2 ? 'circuit' : 'lanes');
      }
    }
  }
}

test('the twist ranges are the ones Admin states, and short races get fewer', () => {
  assert.deepEqual(INTENSITY_RANGES, {
    calm: { min: 0, max: 1 },
    standard: { min: 2, max: 3 },
    big: { min: 3, max: 4 },
    chaos: { min: 4, max: 5 },
    mayhem: { min: 6, max: 8 },
  });
  assert.equal(intensityLabel('standard'), 'Standard (2 to 3 twists a race)');
  assert.equal(intensityLabel('calm'), 'Calm (0 to 1 gentle twists a race)');
  assert.equal(twistCapacity(7_000), 1);
  assert.equal(twistCapacity(15_000), 2);
  assert.equal(twistCapacity(30_000), 4);
  assert.equal(twistCapacity(60_000), 7);
  assert.ok(twistCapacity(90_000) >= 8);
  for (const level of LEVELS) {
    assert.deepEqual(twistRange(level, 120_000), INTENSITY_RANGES[level]);
    for (const durationMs of LENGTHS) {
      const range = twistRange(level, durationMs);
      assert.ok(range.min <= range.max && range.max <= twistCapacity(durationMs));
    }
  }
});

test('every race shows a twist count inside its level, for every length and lap count', () => {
  for (const plan of plans()) {
    const range = twistRange(plan.intensity, plan.durationMs);
    assert.ok(
      plan.events.length >= range.min && plan.events.length <= range.max,
      `${plan.intensity} ${plan.durationMs}ms seed ${plan.seed}: ${plan.events.length} twists, expected ${range.min} to ${range.max}`,
    );
  }
});

test('every twist is warned 2.5 s ahead, hits 3 s from the last, and one story is on air at a time', () => {
  for (const plan of plans()) {
    const events = [...plan.events].sort((a, b) => a.effectAtMs - b.effectAtMs);
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      assert.ok(event.effectAtMs - event.warningAtMs >= TWIST_MIN_WARNING_MS, `${event.id} warned only ${event.effectAtMs - event.warningAtMs}ms ahead`);
      assert.ok(event.warningAtMs >= 0);
      assert.deepEqual(plan.cues.filter((c) => c.eventId === event.id).map((c) => c.phase), ['warning', 'reveal', 'effect', 'commentary'], `${event.id} lost a beat`);
      assert.ok(event.commentaryAtMs < plan.stopAtMs, `${event.id} hits after the finish`);
      if (i === 0) continue;
      const previous = events[i - 1];
      assert.ok(event.effectAtMs - previous.effectAtMs >= TWIST_MIN_SPACING_MS);
      assert.ok(
        event.warningAtMs >= previous.effectAtMs + TWIST_HOLD_MS + TWIST_GAP_MS,
        `seed ${plan.seed}: ${event.id} goes on air while ${previous.id} is still up`,
      );
    }
  }
});

test('cards at the post land close to the line, before the finish, with their full warning', () => {
  let post = 0;
  for (const plan of plans(30)) {
    for (const event of plan.events.filter((e) => /AT THE (POST|LINE)/.test(e.label))) {
      post += 1;
      const leaderP = Math.max(...orderAt(plan, event.effectAtMs).map((lane) => lockedProgressAt(plan, lane, event.effectAtMs)));
      assert.ok(leaderP >= POST_PROGRESS.from - 0.03 && leaderP <= POST_PROGRESS.max + 0.01, `${event.id} landed with the leader ${leaderP.toFixed(3)} home`);
      assert.ok(event.commentaryAtMs < plan.stopAtMs);
      assert.ok(plan.cues.some((c) => c.eventId === event.id && c.phase === 'effect'), 'the hit card is never lost');
    }
  }
  assert.ok(post > 60, `only ${post} cards at the post`);
});

test('targets vary: the leader is hit no more than chance, families never repeat, boosts are the rare ones', () => {
  let leaderHits = 0;
  let chance = 0;
  let crowdRaces = 0;
  let races = 0;
  let singles = 0;
  let singleBoosts = 0;
  let leaderThenBoost = 0;
  let leaderHitsFollowed = 0;
  for (const plan of plans()) {
    races += 1;
    const events = [...plan.events].sort((a, b) => a.effectAtMs - b.effectAtMs);
    const families = events.map((e) => twistFamily(e.label));
    assert.equal(new Set(families).size, families.length, `seed ${plan.seed} repeats a twist: ${families.join(', ')}`);
    assert.ok(families.filter((f) => f === 'crowd').length <= 1);
    if (families.includes('crowd')) crowdRaces += 1;
    events.forEach((event, i) => {
      if (event.consequence === 'retire') return;
      const order = orderAt(plan, event.effectAtMs);
      const delayed = event.targetLanes.filter((lane) => (event.clockDeltaMsByLane[lane] ?? 0) < 0);
      const leaderHit = delayed.includes(order[0]);
      if (leaderHit) leaderHits += 1;
      chance += delayed.length / order.length;
      if (event.targetLanes.length === 1) {
        singles += 1;
        if ((event.clockDeltaMsByLane[event.targetLanes[0]] ?? 0) > 0) singleBoosts += 1;
      }
      const next = events[i + 1];
      if (leaderHit && next && next.consequence !== 'retire') {
        leaderHitsFollowed += 1;
        if (next.targetLanes.length === 1 && next.targetLanes[0] !== order[0] && (next.clockDeltaMsByLane[next.targetLanes[0]] ?? 0) > 0) leaderThenBoost += 1;
      }
    });
  }
  assert.ok(leaderHits <= chance * 1.15, `the leader was held ${leaderHits} times against ${chance.toFixed(0)} by chance`);
  assert.ok(crowdRaces < races * 0.25, `a crowd lift in ${crowdRaces} of ${races} races`);
  assert.ok(singleBoosts < singles * 0.4, `${singleBoosts} of ${singles} single-runner twists were boosts`);
  assert.ok(leaderThenBoost < leaderHitsFollowed * 0.3, `a chaser was lifted straight after the leader was held ${leaderThenBoost} of ${leaderHitsFollowed} times`);
});

test('no Crowd Lift carries club jargon', () => {
  for (const book of twistCaptionBooks()) {
    assert.doesNotMatch(book.label, /NDCC/);
    for (const call of book.calls) assert.doesNotMatch(call, /NDCC/);
  }
  for (const plan of plans(4)) {
    for (const event of plan.events) {
      assert.doesNotMatch(`${event.label} ${event.warningText} ${event.revealText} ${event.commentaryText}`, /NDCC/);
    }
  }
});

test('a twist caption quotes a place only when the board shows it from the hit until it is read', () => {
  let checked = 0;
  for (const plan of plans(12)) {
    for (const event of plan.events) {
      /* Every place the board gives each runner from the hit until the room has read the caption. */
      const seen = new Map<number, Set<number>>();
      for (let t = event.effectAtMs; t <= event.effectAtMs + CAPTION_READ_MS; t += 50) {
        orderAt(plan, t).forEach((lane, i) => (seen.get(lane) ?? seen.set(lane, new Set()).get(lane)!).add(i));
      }
      const atHit = orderAt(plan, event.effectAtMs);
      const fieldSize = atHit.length;
      assert.doesNotMatch(event.commentaryText, /\{pos\}|, ,|,!|, [!:]/, event.commentaryText);
      for (const lane of plan.runners.map((r) => r.lane)) {
        for (const name of [plan.names[lane], shortName(plan.names[lane]), shortName(plan.names[lane], 12)]) {
          const at = event.commentaryText.indexOf(`${name}, `);
          if (at < 0) continue;
          const rest = event.commentaryText.slice(at + name.length + 2);
          const places = new Set([atHit.indexOf(lane), ...(seen.get(lane) ?? [])]);
          const shown = [...places].map((r) => ordinal(r + 1)).join('/');
          if (rest.startsWith('the leader')) {
            assert.ok(places.has(0) && atHit[0] === lane, `"${event.commentaryText}" but ${name} is ${shown}`);
            checked += 1;
          } else if (rest.startsWith('in last')) {
            assert.ok([...places].some((r) => r >= fieldSize - 1), `"${event.commentaryText}" but ${name} is ${shown}`);
            checked += 1;
          } else {
            const place = /^in (\d+)(st|nd|rd|th)/.exec(rest);
            if (place) {
              assert.ok(places.has(Number(place[1]) - 1) && atHit.indexOf(lane) === Number(place[1]) - 1, `"${event.commentaryText}" but ${name} is ${shown}`);
              checked += 1;
            }
          }
          break;
        }
      }
    }
  }
  assert.ok(checked > 250, `only ${checked} placed captions checked`);
});

test('every twist caption fits one strap, even for the longest name on the card', () => {
  const long = 'Speedy Gonzales the Third of Geelong West';
  for (const book of twistCaptionBooks()) {
    for (let i = 0; i < book.calls.length; i++) {
      for (const pos of ['the leader', 'in 12th', 'in last']) {
        const line = composeTwistCaption(book.calls, book.label, { a: long, b: long, pos }, () => i / book.calls.length);
        assert.ok(line.length <= CAPTION_MAX, `${line.length}: ${line}`);
        assert.doesNotMatch(line, /\{|\}/, line);
        const typical = composeTwistCaption(book.calls, book.label, { a: 'Snail 54', b: 'Snail 12', pos }, () => i / book.calls.length);
        assert.ok(typical.length <= 72, `${typical.length}: ${typical}`);
      }
    }
  }
  for (const plan of plans(6)) {
    for (const cue of plan.cues) assert.ok(cue.text.length <= CAPTION_MAX, `${cue.text.length}: ${cue.text}`);
  }
});

test('the race finishes within 3% of its set length', () => {
  let worst = 0;
  for (const plan of plans(16)) {
    const error = Math.abs(plan.stopAtMs / plan.durationMs - 1);
    worst = Math.max(worst, error);
    assert.ok(error <= RACE_LENGTH_TOLERANCE, `${plan.intensity} ${plan.durationMs}ms ran ${plan.stopAtMs}ms`);
  }
  assert.ok(worst <= RACE_LENGTH_TOLERANCE);
});

test('every lane has the same chance of winning, eight and twelve runners alike', () => {
  for (const [size, races, tolerance] of [[8, 4_000, 0.15], [12, 3_600, 0.2]] as const) {
    const wins = new Array<number>(size).fill(0);
    for (let seed = 1; seed <= races; seed++) {
      const plan = drawLockedRacePlan(seed * 2_654_435_761 >>> 0, field(size), LENGTHS[seed % LENGTHS.length], true, LEVELS[seed % LEVELS.length], 1 + (seed % 4));
      wins[plan.winnerLane] += 1;
    }
    const expected = races / size;
    for (const w of wins) {
      assert.ok(Math.abs(w - expected) <= expected * tolerance, `${size} runners: win counts ${wins.join(', ')}`);
    }
  }
});

test('fields of eight to twelve plan, classify and caption cleanly', () => {
  for (const size of [8, 9, 10, 11, 12]) {
    for (let seed = 1; seed <= 40; seed++) {
      const plan = drawLockedRacePlan(seed, field(size, true), 45_000, true, 'mayhem', 3, 'circuit', 'floodlight-eight');
      assert.equal(plan.results.length, size);
      assert.deepEqual(plan.results.map((r) => r.place), Array.from({ length: size }, (_, i) => i + 1));
      for (const event of plan.events) {
        assert.ok(event.targetLanes.every((lane) => lane >= 0 && lane < size));
        assert.ok(event.commentaryText.length > 0 && event.revealText.length > 0);
      }
    }
  }
});

test('the Admin labels and paragraph say exactly what the planner does', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('components/ControlDrawer.tsx', 'utf8').replace(/\s+/g, ' ');
  for (const level of LEVELS) assert.ok(source.includes(`>${intensityLabel(level)}<`), `Admin does not offer "${intensityLabel(level)}"`);
  /* "7 to 14 seconds fit one, 15 to 21 two, 22 to 29 three, 30 seconds four, 40 seconds five and a minute seven." */
  assert.ok(source.includes('7 to 14 seconds fit one, 15 to 21 two, 22 to 29 three, 30 seconds four, 40 seconds five and a minute seven'));
  for (let s = 7; s <= 14; s++) assert.equal(twistCapacity(s * 1000), 1, `${s}s`);
  for (let s = 15; s <= 21; s++) assert.equal(twistCapacity(s * 1000), 2, `${s}s`);
  for (let s = 22; s <= 29; s++) assert.equal(twistCapacity(s * 1000), 3, `${s}s`);
  assert.equal(twistCapacity(30_000), 4);
  assert.equal(twistCapacity(40_000), 5);
  assert.equal(twistCapacity(60_000), 7);
});
