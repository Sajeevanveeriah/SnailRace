import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTDOWN_MS,
  RUN_IN_MS,
  advanceLabel,
  cardComplete,
  heldRaceLine,
  interruptedRace,
  nextRaceNumber,
  nextShowPhase,
  raceHasRun,
  showPhaseSpec,
} from '../lib/show';

/* Defect class: a run sheet shrunk below the races already run stranded the
   show on a race that had already happened, with Start doing nothing and
   Next never reaching the finale (round 2 finding 1.3). */
test('the next race number is always past every race that stands', () => {
  assert.equal(nextRaceNumber(0, []), 1);
  assert.equal(nextRaceNumber(3, [{ raceNo: 3 }, { raceNo: 2 }, { raceNo: 1 }]), 4);
  /* A backup or a desynchronised counter: the history wins. */
  assert.equal(nextRaceNumber(0, [{ raceNo: 2 }, { raceNo: 1 }]), 3);
  /* A void does not count as run: the same number re-runs. */
  assert.equal(nextRaceNumber(1, [{ raceNo: 2, void: true }, { raceNo: 1 }]), 2);
  assert.equal(raceHasRun(1, [{ raceNo: 1 }]), true);
  assert.equal(raceHasRun(1, [{ raceNo: 1, void: true }]), false);
});

test('a racecard or gate left up after the card is complete goes to the finale', () => {
  const complete = { racesRun: 1, plannedRaces: 1, nextRaceNo: 2 };
  assert.equal(cardComplete(complete), true);
  assert.equal(nextShowPhase('racecard', complete), 'finale');
  assert.equal(nextShowPhase('results', complete), 'finale');
  assert.equal(advanceLabel('racecard', complete), 'To the thank you screen');
  assert.equal(advanceLabel('results', complete), 'Next');
  /* The run sheet shrunk below the races run: nextRaceNo alone says complete. */
  assert.equal(cardComplete({ racesRun: 1, plannedRaces: 1, nextRaceNo: 2 }), true);
  assert.equal(cardComplete({ racesRun: 0, plannedRaces: 1, nextRaceNo: 2 }), true);
  const open = { racesRun: 1, plannedRaces: 3, nextRaceNo: 2 };
  assert.equal(cardComplete(open), false);
  assert.equal(nextShowPhase('racecard', open), 'race');
  assert.equal(nextShowPhase('results', open), 'racecard');
  assert.equal(nextShowPhase('results', { ...open, quaddieLive: true }), 'championship');
  assert.equal(nextShowPhase('championship', open), 'racecard');
  assert.equal(advanceLabel('racecard', open), 'To the gate');
  /* The finale is the end: the button reads as done, not as an action. */
  assert.equal(nextShowPhase('finale', complete), 'finale');
  assert.equal(advanceLabel('finale', complete), 'Night complete');
  assert.equal(showPhaseSpec('finale').advance, 'Night complete');
});

/* Defect class: a projector reload mid-race abandoned the race and showed
   Phone Play jargon to the room (round 2 finding 1.1). */
test('a held race found at load is judged from the wall clock', () => {
  const plan = { stopAtMs: 30_000 };
  const lockedAt = 1_800_000_000_000;
  /* Locked, never started: the Phone Play lock is still pending. */
  assert.deepEqual(interruptedRace({ lockedAt, startedAt: lockedAt, plan }, lockedAt + 60_000), { kind: 'armed' });
  const startedAt = lockedAt + 20;
  /* Reloaded 12 s into the race: it restarts from the gate. */
  assert.deepEqual(interruptedRace({ lockedAt, startedAt, plan }, startedAt + COUNTDOWN_MS + 12_000), {
    kind: 'interrupted',
    raceTimeMs: 12_000,
  });
  /* Reloaded during the countdown: the clock has not started. */
  assert.deepEqual(interruptedRace({ lockedAt, startedAt, plan }, startedAt + 1000), { kind: 'interrupted', raceTimeMs: 0 });
  /* Reloaded just short of the result standing: still a restart. */
  assert.equal(interruptedRace({ lockedAt, startedAt, plan }, startedAt + COUNTDOWN_MS + 30_000 + RUN_IN_MS - 1).kind, 'interrupted');
  /* The result stood before the page came back: it is recorded, not re-run. */
  assert.equal(interruptedRace({ lockedAt, startedAt, plan }, startedAt + COUNTDOWN_MS + 30_000 + RUN_IN_MS).kind, 'finished');
});

test('the gate speaks plainly unless a Phone Play room is attached', () => {
  assert.equal(heldRaceLine(1, 'interrupted', false), 'Race 1 was interrupted. Start it again.');
  assert.equal(heldRaceLine(4, 'armed', false), 'Race 4 is ready. Start it.');
  assert.match(heldRaceLine(1, 'interrupted', true), /Phone Play/);
  assert.doesNotMatch(heldRaceLine(1, 'interrupted', false), /Phone Play|lock/);
});
