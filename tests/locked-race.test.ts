import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  drawLockedRacePlan,
  drawRace,
  instantiateLockedRace,
  LANE_CLOCK_CAP,
  lockedProgressAt,
  LOCKED_RACE_FIELD_SIZE,
  MAX_LOCKED_RACE_FIELD_SIZE,
  MIN_LOCKED_RACE_FIELD_SIZE,
  RETIREMENT_CHANCE_DENOMINATOR,
  RETIREMENT_EARLIEST,
  RETIREMENT_LEVELS,
  RETIREMENT_SPECS,
  runInProgress,
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
  assert.deepEqual(RETIREMENT_LEVELS, ['chaos', 'mayhem']);

  let retirementCount = 0;
  const families = new Set<string>();
  for (let seed = 1; seed <= 5_000; seed++) {
    const plan = drawLockedRacePlan(seed, names, 30_000, true, RETIREMENT_LEVELS[seed % 2]);
    const retired = plan.results.filter((result) => result.status === 'retired');
    assert.ok(retired.length <= 1);
    retirementCount += retired.length;
    if (retired[0]?.retirementCode) families.add(retired[0].retirementCode);
  }

  const expected = 5_000 / RETIREMENT_CHANCE_DENOMINATOR;
  assert.ok(retirementCount > expected * 0.6 && retirementCount < expected * 1.4, `${retirementCount} retirements in 5000 races`);
  assert.deepEqual(families, new Set(RETIREMENT_SPECS.map((spec) => spec.code)));
});

/* Defect class: a paid snail knocked out of a Standard race six seconds in
   (audit 3.1). Only Chaos and Mayhem retire a runner, never in the first
   half, and never the runner leading at the hit. */
test('a retirement only happens under Chaos or Mayhem, after halfway, and never to the leader', () => {
  const leaderAt = (plan: ReturnType<typeof drawLockedRacePlan>, at: number): number =>
    plan.runners
      .map((runner) => ({ lane: runner.lane, p: lockedProgressAt(plan, runner.lane, at - 1) }))
      .sort((a, b) => b.p - a.p)[0].lane;
  for (const level of ['calm', 'standard', 'big'] as const) {
    for (let seed = 1; seed <= 1_500; seed++) {
      const plan = drawLockedRacePlan(seed, names, [12_000, 30_000, 60_000][seed % 3], true, level, 1 + (seed % 3));
      assert.ok(plan.events.every((event) => event.consequence !== 'retire'), `${level} seed ${seed} retired a runner`);
      assert.ok(plan.results.every((result) => result.status !== 'retired'));
    }
  }
  let seen = 0;
  for (const level of RETIREMENT_LEVELS) {
    for (let seed = 1; seed <= 2_500; seed++) {
      const durationMs = [12_000, 30_000, 60_000][seed % 3];
      const plan = drawLockedRacePlan(seed, names, durationMs, true, level, 1 + (seed % 3), seed % 2 ? 'circuit' : 'lanes');
      for (const event of plan.events) {
        if (event.consequence !== 'retire') continue;
        seen += 1;
        assert.ok(event.effectAtMs >= plan.stopAtMs * RETIREMENT_EARLIEST, `${level} seed ${seed}: retired at ${event.effectAtMs} of ${plan.stopAtMs}`);
        assert.equal(event.targetLanes.length, 1);
        assert.notEqual(event.targetLanes[0], leaderAt(plan, event.effectAtMs), `${level} seed ${seed}: retired the leader`);
      }
      /* Same seed, same plan: the retirement is part of the committed draw. */
      assert.deepEqual(drawLockedRacePlan(seed, names, durationMs, true, level, 1 + (seed % 3), seed % 2 ? 'circuit' : 'lanes').events, plan.events);
    }
  }
  assert.ok(seen > 60, `only ${seen} retirements seen`);
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

test('twists change the classification, remain bounded and respect surprise settings', () => {
  let resultChanges = 0;
  let leaderChanges = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const plan = drawLockedRacePlan(seed, names, 30_000, true, 'chaos');
    const without = { ...plan, events: [] };
    const at = plan.stopAtMs;
    if (lockedProgressAt(without, plan.winnerLane, at) < Math.max(...names.map((_, lane) => lockedProgressAt(without, lane, at)))) resultChanges++;
    /* A twist makes visible racing: the lead changes hands in most races. */
    let leader = -1;
    let changes = 0;
    for (let t = plan.durationMs * 0.15; t < plan.stopAtMs; t += 100) {
      const now = plan.runners.reduce((best, r) => (lockedProgressAt(plan, r.lane, t) > lockedProgressAt(plan, best, t) ? r.lane : best), plan.runners[0].lane);
      if (leader !== -1 && now !== leader) changes++;
      leader = now;
    }
    if (changes > 0) leaderChanges++;
    for (const runner of plan.runners) {
      const delta = plan.events.reduce((sum, event) => sum + (event.clockDeltaMsByLane[runner.lane] ?? 0), 0);
      assert.ok(Math.abs(delta) <= plan.durationMs * LANE_CLOCK_CAP);
    }
  }
  assert.ok(resultChanges >= 10, `The twists must affect the result, not only the picture (${resultChanges} of 200)`);
  assert.ok(leaderChanges > 150, `the lead changed hands in only ${leaderChanges} of 200 races`);
  assert.equal(drawLockedRacePlan(42, names, 60_000, false).events.length, 0);
  const calm = drawLockedRacePlan(42, names, 60_000, true, 'calm');
  assert.ok(calm.events.length <= 1);
  /* No fixed leader-then-chaser pairing is dealt any more. */
  assert.equal(drawLockedRacePlan(42, names, 60_000, true).events.filter((e) => e.id.startsWith('comeback-')).length, 0);
});

test('the lively motion profile runs at pace from the gates and never changes who crosses or when', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const plan = drawLockedRacePlan(seed, names, 60_000, true, 'chaos');
    assert.equal(plan.motion, 'lively');
    for (const runner of plan.runners) {
      const retired = plan.events.some((e) => e.consequence === 'retire' && e.targetLanes.includes(runner.lane));
      /* Off the gates at pace: a tenth of the race covers close to a tenth of the track. */
      if (!plan.events.some((e) => e.targetLanes.includes(runner.lane) && e.effectAtMs < plan.durationMs * 0.1)) {
        const early = lockedProgressAt(plan, runner.lane, plan.durationMs * 0.1);
        assert.ok(early > 0.065 && early < 0.14, `lane ${runner.lane} in seed ${seed} covered ${early} by a tenth of the race`);
      }
      let last = -1;
      for (let t = 0; t <= plan.stopAtMs; t += 25) {
        const p = lockedProgressAt(plan, runner.lane, t);
        assert.ok(p + 1e-9 >= last, `lane ${runner.lane} went backwards at ${t}ms in seed ${seed}`);
        last = p;
      }
      /* Nobody is on the line before the winner's stop frame. */
      if (!retired && runner.lane !== plan.winnerLane) assert.ok(lockedProgressAt(plan, runner.lane, plan.stopAtMs) < 1);
    }
    assert.equal(lockedProgressAt(plan, plan.winnerLane, plan.stopAtMs), 1);
    /* The animation agrees with the plan's own classification. */
    const race = instantiateLockedRace(plan);
    let placed = 0;
    for (let raceT = 0; raceT <= plan.stopAtMs; raceT += 40) {
      const { crossed } = stepRace(race.snails, raceT, 40, placed);
      if (crossed.length) placed = crossed[crossed.length - 1].place;
    }
    stepRace(race.snails, plan.stopAtMs, 1, placed);
    const winner = race.snails.find((s) => s.lane === plan.winnerLane)!;
    assert.ok(winner.done && winner.place === 1);
    for (const result of plan.results) {
      assert.equal(Number(race.snails[result.lane].p.toFixed(6)), result.progressAtStop);
    }
  }
  /* An archived plan without the profile still animates on the old curve. */
  const legacy = { ...drawLockedRacePlan(9, names, 30_000, true, 'chaos'), motion: undefined };
  assert.ok(lockedProgressAt(legacy, legacy.winnerLane, 3000) < 0.03);
});

test('in the finish hold the field runs in behind the winner and never past the official order', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const plan = drawLockedRacePlan(seed, Array.from({ length: 8 + (seed % 5) }, (_, i) => `Runner ${i + 1}`), [12_000, 30_000, 60_000][seed % 3], true, 'mayhem', 1 + (seed % 3));
    const order = plan.results.slice().sort((a, b) => a.place - b.place);
    let last = runInProgress(plan, plan.stopAtMs);
    for (const result of plan.results) assert.equal(Number(last.get(result.lane)!.toFixed(6)), result.progressAtStop);
    let moved = false;
    for (let t = plan.stopAtMs; t <= plan.stopAtMs + 2500; t += 50) {
      const now = runInProgress(plan, t);
      for (const result of order) {
        const p = now.get(result.lane)!;
        assert.ok(p + 1e-12 >= last.get(result.lane)!, `lane ${result.lane} went backwards in the hold`);
        if (result.status === 'retired') assert.equal(p, last.get(result.lane));
        if (result.lane === plan.winnerLane) assert.equal(p, 1);
        else assert.ok(p < 1, 'only the winner is drawn across the line');
        if (p > last.get(result.lane)! + 1e-9) moved = true;
      }
      const running = order.filter((r) => r.status !== 'retired').map((r) => now.get(r.lane)!);
      for (let i = 1; i < running.length; i++) assert.ok(running[i] <= running[i - 1], `seed ${seed}: the run-in reordered the result`);
      last = now;
    }
    assert.ok(moved, `seed ${seed}: the field froze`);
  }
});
