import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentState, freshState, restore } from '../lib/event-store';
import type { EventState } from '../lib/types';

/**
 * The v3 -> v4 migration. A night saved by the shipped v3 build must load
 * into v4 with its races, bets, chips and audit intact, and every new field
 * filled with a deterministic default - the same default every time, so two
 * loads of the same backup are the same night.
 */

/** A night as the v3 build wrote it: no v4 keys at all. */
function v3Night(): Record<string, unknown> {
  const s = freshState() as Partial<EventState> & Record<string, unknown>;
  delete s.timezone;
  delete s.eventMode;
  delete s.plannedRaces;
  delete s.rehearsal;
  delete s.showPhase;
  delete s.intensity;
  delete s.racePack;
  delete s.packPlayed;
  delete s.packCurrent;
  delete s.phonePlay;
  s.version = 3 as unknown as EventState['version'];
  s.eventId = 'ev-v3-night';
  s.history = [
    {
      raceNo: 1,
      raceType: 'Heat',
      fieldSize: 6,
      results: [{ place: 1, lane: 2, name: 'Turbo', finishMs: 44_000 }],
      seedHex: '8F2A31C0',
      photoFinish: false,
      durationMs: 45_000,
      potCents: 12_500,
      at: 1_700_000_000_000,
    },
  ];
  s.bets = [
    { id: 'b1', raceNo: 1, lane: 2, snailName: 'Turbo', punter: 'dave', chips: 40, odds: 3, settled: true, won: true, returned: 120 },
  ];
  s.chipBank = { dave: 180 };
  s.audit = [{ id: 'au1', at: 1_700_000_000_500, kind: 'race_finished', raceNo: 1, detail: 'v3 entry' }];
  return s;
}

test('a v3 night restores as v4 with deterministic defaults', () => {
  assert.equal(restore(JSON.stringify(v3Night())), true);
  const s = currentState();
  assert.equal(s.version, 4);
  assert.equal(s.eventId, 'ev-v3-night');
  assert.equal(s.timezone, 'Australia/Melbourne');
  assert.equal(s.eventMode, 'live');
  assert.equal(s.plannedRaces, 6);
  assert.equal(s.rehearsal, false);
  assert.equal(s.showPhase, 'lobby');
  assert.equal(s.intensity, 'standard');
  assert.equal(s.racePack, null);
  assert.deepEqual(s.packPlayed, []);
  assert.equal(s.packCurrent, null);
  assert.equal(s.phonePlay, null);
});

test('v3 data survives the migration untouched', () => {
  restore(JSON.stringify(v3Night()));
  const s = currentState();
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].seedHex, '8F2A31C0');
  assert.equal(s.bets[0].returned, 120);
  assert.equal(s.chipBank.dave, 180);
  assert.equal(s.audit[0].detail, 'v3 entry');
  /* v3 audit entries predate the hash chain; they must not gain fake hashes. */
  assert.equal(s.audit[0].entryHash, undefined);
});

test('surprises-off in v3 maps to the calm preset', () => {
  const night = v3Night();
  night.surprises = false;
  restore(JSON.stringify(night));
  assert.equal(currentState().intensity, 'calm');
});

test('unknown phase and intensity strings normalise instead of crashing', () => {
  const night = v3Night();
  night.showPhase = 'directors-cut';
  night.intensity = 'eleven';
  night.plannedRaces = 99;
  restore(JSON.stringify(night));
  const s = currentState();
  assert.equal(s.showPhase, 'lobby');
  assert.equal(s.intensity, 'standard');
  assert.equal(s.plannedRaces, 12);
});

test('migration is deterministic: the same backup loads to the same night', () => {
  const raw = JSON.stringify(v3Night());
  restore(raw);
  const first = JSON.stringify({ ...currentState(), startedAt: 0 });
  restore(raw);
  const second = JSON.stringify({ ...currentState(), startedAt: 0 });
  assert.equal(first, second);
});

test('garbage refuses to restore', () => {
  assert.equal(restore('not json at all {{{'), false);
});
