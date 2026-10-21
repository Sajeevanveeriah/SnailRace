import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import test from 'node:test';
import {
  BACK_MARKER_LINES,
  BELL_LAP_LINES,
  CLEAR_LINES,
  COMMENTARY,
  LAP_LINES,
  LEAD_CHANGE_LINES,
  MARGIN_LINES,
  REACTION_LINES,
  RUN_HOME_LINES,
  SECTOR_LINES,
  SWARM_SPECS,
  TIGHT_LINES,
  callLine,
  eventBudget,
  mulberry32,
} from '../lib/race-engine';
import {
  CUE_ENERGY,
  RECORDED_CUES,
  RECORDED_TAKES,
  TAKES_PER_CUE,
  clipFile,
  recordedCueFor,
  takesFor,
} from '../lib/audio/voice-cues';
import { pickTake } from '../lib/audio/voice';

const context = {
  leadP: 0.54,
  lead: 'Turbo',
  chase: 'Rocket',
  third: 'Flash',
  tail: 'Bolt',
  gapLengths: 1.8,
  toGoLengths: 10.4,
};

test('a fixed race stream produces the same commentary sequence', () => {
  const first = mulberry32(0x4e444343);
  const second = mulberry32(0x4e444343);
  const a = Array.from({ length: 12 }, () => callLine(context, first));
  const b = Array.from({ length: 12 }, () => callLine(context, second));
  assert.deepEqual(a, b);
  assert.ok(new Set(a).size > 1);
});

test('the commentary book contains no real-money or ticket language', () => {
  const lines = [
    ...COMMENTARY.early,
    ...COMMENTARY.mid,
    ...COMMENTARY.late,
    ...MARGIN_LINES,
    ...TIGHT_LINES,
    ...CLEAR_LINES,
    ...BACK_MARKER_LINES,
    ...RUN_HOME_LINES,
    ...REACTION_LINES.good,
    ...REACTION_LINES.bad,
    ...REACTION_LINES.wild,
  ];
  const prohibited = /\b(money|cash|ticket|backer|punter|wager)\b/i;
  assert.equal(lines.filter((line) => prohibited.test(line)).length, 0);
});

test('the set-piece templates no longer shout in capitals', () => {
  const lines = [
    ...LAP_LINES,
    ...BELL_LAP_LINES,
    ...LEAD_CHANGE_LINES,
    ...Object.values(SECTOR_LINES),
    ...REACTION_LINES.good,
    ...REACTION_LINES.bad,
    ...REACTION_LINES.wild,
  ];
  const shouting = /\b[A-Z]{3,}\b/;
  assert.deepEqual(lines.filter((line) => shouting.test(line)), []);
});

test('standard pacing leaves room for each authored surprise to land', () => {
  assert.equal(eventBudget(60_000, 6), 8);
  assert.equal(eventBudget(45_000, 6), 6);
  assert.equal(eventBudget(30_000, 6), 4);
  assert.ok(eventBudget(60_000, 6, 1.75) <= 14);
});

test('the surprise book carries original cricket-ground set pieces', () => {
  const labels = new Set(SWARM_SPECS.map((spec) => spec.label));
  assert.ok(labels.has('ROGUE CRICKET BALL'));
  assert.ok(labels.has('PITCH ROLLER CROSSING'));
  assert.ok(labels.has('SPRINKLERS ON'));
  assert.ok(labels.has('DOG ON THE TRACK'));
});

test('the race-call script has at least three distinct takes per cue and never names a snail', () => {
  const cues = Object.keys(RECORDED_CUES) as Array<keyof typeof RECORDED_CUES>;
  for (const cue of ['start', 'quarter', 'half', 'threeQuarter', 'final', 'photo', 'winner', 'warning'] as const) {
    assert.ok(cues.includes(cue), cue);
  }
  for (const cue of cues) {
    const takes = RECORDED_CUES[cue];
    assert.ok(takes.length >= TAKES_PER_CUE, cue);
    assert.equal(new Set(takes).size, takes.length, `${cue} takes must differ`);
    for (const line of takes) {
      assert.ok(line.length <= 300, `${cue}: Chatterbox takes at most 300 characters`);
      assert.doesNotMatch(line, /\b\d+\b/, `${cue}: the caption carries the number, not the clip`);
      assert.doesNotMatch(line, /\bsnail\s*\d/i, cue);
    }
    assert.ok(CUE_ENERGY[cue] >= 0.5 && CUE_ENERGY[cue] <= 1.2, cue);
  }
  assert.ok(CUE_ENERGY.winner > CUE_ENERGY.start, 'energy rises towards the finish');
  assert.ok(CUE_ENERGY.final > CUE_ENERGY.early);
});

test('every take the table claims is on disk, and the first take always is', () => {
  for (const cue of Object.keys(RECORDED_CUES) as Array<keyof typeof RECORDED_CUES>) {
    /* Truthful: every written take is recorded, and nothing is claimed that is not written. */
    assert.equal(RECORDED_TAKES[cue], RECORDED_CUES[cue].length, `${cue} has takes written but not recorded`);
    for (let take = 1; take <= takesFor(cue); take++) {
      const file = `public/audio/commentary/${clipFile(cue, take)}`;
      assert.ok(existsSync(file) && statSync(file).size > 1000, file);
    }
  }
  assert.equal(clipFile('start', 1), 'start.mp3');
  assert.equal(clipFile('start', 2), 'start-2.mp3');
});

test('a cue with several takes never plays the same take twice running', () => {
  assert.ok(takesFor('start') >= 2, 'start has more than one recorded take');
  let previous = pickTake('start');
  for (let i = 0; i < 40; i++) {
    const next = pickTake('start');
    assert.notEqual(next, previous);
    assert.ok(next >= 1 && next <= takesFor('start'));
    previous = next;
  }
  /* A single-take cue always plays take 1. */
  const single = (Object.keys(RECORDED_CUES) as Array<keyof typeof RECORDED_CUES>).find((cue) => takesFor(cue) === 1);
  if (single) assert.equal(pickTake(single), 1);
});

test('the set-piece captions map to their own cues when no cue is passed', () => {
  assert.equal(recordedCueFor('A quarter gone, Flash leads Turbo.'), 'quarter');
  assert.equal(recordedCueFor('Three-quarter mark, Flash in front, Turbo winding up.'), 'threeQuarter');
  assert.equal(recordedCueFor('New leader! Turbo snatches it from Flash!'), 'lead');
  assert.equal(recordedCueFor('There is the bell! Last lap, Flash leads!'), 'bell');
  assert.equal(recordedCueFor('Perfect conditions over the course tonight.'), undefined);
});
