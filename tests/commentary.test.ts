import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BACK_MARKER_LINES,
  CLEAR_LINES,
  COMMENTARY,
  MARGIN_LINES,
  REACTION_LINES,
  RUN_HOME_LINES,
  SWARM_SPECS,
  TIGHT_LINES,
  callLine,
  eventBudget,
  mulberry32,
} from '../lib/race-engine';

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
