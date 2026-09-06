import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  drawLockedRacePlan,
  drawRace,
  instantiateLockedRace,
  lockedProgressAt,
  LOCKED_RACE_FIELD_SIZE,
  MAX_LOCKED_RACE_FIELD_SIZE,
  MIN_LOCKED_RACE_FIELD_SIZE,
  RETIREMENT_CHANCE_DENOMINATOR,
  RETIREMENT_SPECS,
  stepRace,
} from '../lib/race-engine';

const names = Array.from({ length: LOCKED_RACE_FIELD_SIZE }, (_, lane) => `Runner ${lane + 1}`);

test('locked races support every field from eight to twenty runners', () => {
  const field = (size: number) => Array.from({ length: size }, (_, lane) => `Runner ${lane + 1}`);
  assert.throws(
    () => drawLockedRacePlan(1, field(MIN_LOCKED_RACE_FIELD_SIZE - 1), 12_000),
    /8 to 20/,
  );
  assert.throws(
    () => drawLockedRacePlan(1, field(MAX_LOCKED_RACE_FIELD_SIZE + 1), 12_000),
    /8 to 20/,
  );
  for (const size of [8, 12, 20]) {
    const plan = drawLockedRacePlan(1, field(size), 12_000);
    assert.equal(plan.runners.length, size);
    assert.equal(plan.results.length, size);
    assert.equal(instantiateLockedRace(plan).snails.length, size);
  }
});

/* Defect class: a replay redrawing any consequence, cue or classification
   from ambient randomness instead of the committed seed. */
test('the complete consequential race plan is deterministic', () => {
  for (const seed of [1, 42, 0x51a11, 0xc0ffee, 0xffffffff]) {
    const first = drawLockedRacePlan(seed, names, 18_000, true, 'chaos', 3, 'circuit');
    const replay = drawLockedRacePlan(seed, names, 18_000, true, 'chaos', 3, 'circuit');
    assert.deepEqual(replay, first);
    assert.equal(first.results.length, 8);
    assert.deepEqual(first.results.map((result) => result.place), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(first.results[0].lane, first.winnerLane);
    assert.equal(first.results[0].finishMs, first.stopAtMs);
    assert.equal(first.results[0].status, 'finished');
    assert.equal(first.results.filter((result) => result.status === 'finished').length, 1);
  }
});

/* Defect class: a surprise being cosmetic theatre, or its audience beats
   being improvised in a different order on replay. */
test('every locked surprise has an ordered four-beat cue and a persistent consequence', () => {
  const plan = drawLockedRacePlan(0xc0ffee, names, 30_000, true, 'chaos');
  assert.ok(plan.events.length > 0);

  for (const event of plan.events) {
    assert.ok(event.warningAtMs < event.revealAtMs);
    assert.ok(event.revealAtMs < event.effectAtMs);
    assert.ok(event.effectAtMs < event.commentaryAtMs);
    assert.deepEqual(
      plan.cues.filter((cue) => cue.eventId === event.id).map((cue) => cue.phase),
      ['warning', 'reveal', 'effect', 'commentary'],
    );

    if (event.consequence === 'retire') continue;
    assert.ok(
      event.targetLanes.some((lane) => event.clockDeltaMsByLane[lane] !== 0),
      `${event.id} has no mechanical consequence`,
    );

    const lane = event.targetLanes.find((candidate) => event.clockDeltaMsByLane[candidate] !== 0)!;
    const without = structuredClone(plan);
    const matching = without.events.find((candidate) => candidate.id === event.id)!;
    matching.clockDeltaMsByLane[lane] = 0;
    assert.notEqual(
      lockedProgressAt(plan, lane, event.effectEndMs + 1),
      lockedProgressAt(without, lane, event.effectEndMs + 1),
    );
  }
});

test('short locked races still keep complete four-beat events before the finish', () => {
  for (let seed = 1; seed <= 5_000; seed++) {
    const plan = drawLockedRacePlan(seed, names, 1_000, true, 'standard');
    for (const event of plan.events) {
      assert.ok(event.commentaryAtMs < plan.stopAtMs);
      assert.deepEqual(
        plan.cues.filter((cue) => cue.eventId === event.id).map((cue) => cue.phase),
        ['warning', 'reveal', 'effect', 'commentary'],
      );
    }
  }
});

/* Defect class: the animation waiting for the rest of the field after the
   winner has crossed. The controller stops scheduling immediately after this
   step, so all other coordinates must already be a complete classification. */
test('the first active crossing is unique and freezes the trailing field', () => {
  for (const seed of [7, 1001, 0x51a11, 0xc0ffee]) {
    const plan = drawLockedRacePlan(seed, names, 12_000, true, 'standard');
    const race = instantiateLockedRace(plan);

    stepRace(race.snails, plan.stopAtMs - 1, 16, 0);
    const crossing = stepRace(race.snails, plan.stopAtMs, 1, 0);
    assert.deepEqual(crossing.crossed.map((snail) => snail.lane), [plan.winnerLane]);
    assert.equal(race.snails.filter((snail) => snail.p === 1).length, 1);

    const frozen = race.snails.map((snail) => snail.p);
    for (const result of plan.results) {
      const snail = race.snails[result.lane];
      assert.equal(Number(snail.p.toFixed(6)), result.progressAtStop);
      if (result.status === 'classified') {
        assert.equal(snail.done, false);
        assert.ok(snail.p < 1);
        assert.equal(result.finishMs, null);
      } else if (result.status === 'retired') {
        assert.equal(snail.retired, true);
        assert.equal(result.finishMs, null);
      }
    }

    /* No later step is made by useRace; retaining this snapshot proves the
       result contains all eight frozen positions at the winning instant. */
    assert.deepEqual(race.snails.map((snail) => snail.p), frozen);
  }
});

test('fractional easing cannot cross before the published integer stop frame', () => {
  const plan = drawLockedRacePlan(5_650, names, 60_000, true, 'chaos');
  const race = instantiateLockedRace(plan);

  const early = stepRace(race.snails, plan.stopAtMs - 0.5, 16, 0);
  assert.equal(early.crossed.length, 0);
  assert.ok(race.snails.every((snail) => snail.p < 1));
  assert.ok(lockedProgressAt(plan, plan.winnerLane, plan.stopAtMs - 0.5) < 1);

  const crossing = stepRace(race.snails, plan.stopAtMs, 0.5, 0);
  assert.deepEqual(crossing.crossed.map((snail) => snail.lane), [plan.winnerLane]);
  for (const result of plan.results) {
    assert.equal(Number(race.snails[result.lane].p.toFixed(6)), result.progressAtStop);
  }
});

test('retirements are rare, single-runner and explicitly family-safe', () => {
  for (const spec of RETIREMENT_SPECS) {
    assert.match(spec.commentary, /safe|safely/i);
    assert.match(spec.commentary, /race is over/i);
  }

  let retirementCount = 0;
  const families = new Set<string>();
  for (let seed = 1; seed <= 5_000; seed++) {
    const plan = drawLockedRacePlan(seed, names, 12_000, true, 'standard');
    const retired = plan.results.filter((result) => result.status === 'retired');
    assert.ok(retired.length <= 1);
    retirementCount += retired.length;
    if (retired[0]?.retirementCode) families.add(retired[0].retirementCode);
  }

  const expected = 5_000 / RETIREMENT_CHANCE_DENOMINATOR;
  assert.ok(retirementCount > expected * 0.6 && retirementCount < expected * 1.4);
  assert.deepEqual(families, new Set(RETIREMENT_SPECS.map((spec) => spec.code)));
});

test('legacy all-finisher stepping remains unchanged', () => {
  const race = drawRace(0xabcdef, names, 10_000, true);
  let placed = 0;
  for (let raceT = 0; raceT <= race.tMax; raceT += 40) {
    const { crossed } = stepRace(race.snails, raceT, 40, placed);
    if (crossed.length) placed = crossed[crossed.length - 1].place;
  }
  assert.deepEqual(
    race.snails.slice().sort((a, b) => a.place - b.place).map((snail) => snail.lane),
    race.order,
  );
  assert.ok(race.snails.every((snail) => snail.done && !snail.retired));
});

test('comeback surprises challenge the actual leader and produce visible overtaking', () => {
  for (const duration of [7000, 30_000, 60_000]) {
    for (let seed = 1; seed <= 200; seed++) {
      const plan = drawLockedRacePlan(seed, names, duration, true);
      const setbacks = plan.events.filter((event) => event.id.endsWith('-leader'));
      assert.ok(setbacks.length >= 1);
      let leadChanged = false;
      for (const event of setbacks) {
        const lane = event.targetLanes[0];
        const active = plan.runners.filter((runner) => !plan.events.some((e) =>
          e.consequence === 'retire' && e.targetLanes.includes(runner.lane) && e.effectAtMs <= event.effectAtMs));
        assert.equal(lockedProgressAt(plan, lane, event.effectAtMs),
          Math.max(...active.map((runner) => lockedProgressAt(plan, runner.lane, event.effectAtMs))));
        const after = names.map((_, i) => lockedProgressAt(plan, i, event.effectEndMs));
        leadChanged ||= after[lane] < Math.max(...after);
        assert.ok(event.effectEndMs < plan.stopAtMs);
        for (let t = event.effectAtMs; t < event.effectEndMs; t += 50) {
          assert.ok(lockedProgressAt(plan, lane, t + 50) >= lockedProgressAt(plan, lane, t));
        }
      }
      assert.ok(leadChanged, `Seed ${seed} at ${duration}ms had no comeback`);
    }
  }
});

test('comeback effects change the classification, remain bounded and respect surprise settings', () => {
  let resultChanges = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const plan = drawLockedRacePlan(seed, names, 30_000, true, 'chaos');
    const without = { ...plan, events: plan.events.filter((event) => !event.id.startsWith('comeback-')) };
    const at = plan.stopAtMs;
    if (lockedProgressAt(without, plan.winnerLane, at) < Math.max(...names.map((_, lane) => lockedProgressAt(without, lane, at)))) resultChanges++;
    for (const runner of plan.runners) {
      const delta = plan.events.reduce((sum, event) => sum + (event.clockDeltaMsByLane[runner.lane] ?? 0), 0);
      assert.ok(Math.abs(delta) <= plan.durationMs * 0.16);
    }
  }
  assert.ok(resultChanges > 100, 'The comeback must affect the result, not only the picture');
  assert.equal(drawLockedRacePlan(42, names, 60_000, false).events.length, 0);
  assert.equal(drawLockedRacePlan(42, names, 60_000, true, 'calm').events.filter((e) => e.id.endsWith('-leader')).length, 1);
  assert.equal(drawLockedRacePlan(42, names, 60_000, true).events.filter((e) => e.id.endsWith('-leader')).length, 2);
});
