import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseForRace, RACE_COURSES } from '../lib/courses';
import { EVENT_SPECS, RETIREMENT_SPECS, SWARM_SPECS } from '../lib/race-engine';
import { presentationForMoment } from '../components/race-broadcast/surprise-presentation';
import { PROP_GLYPHS } from '../components/race-broadcast/prop-glyphs';

test('the race card rotates through four distinct courses without adjacent repeats', () => {
  const card = Array.from({ length: 12 }, (_, index) => courseForRace(index + 1).id);
  assert.deepEqual(card.slice(0, 4), RACE_COURSES.map((course) => course.id));
  assert.equal(new Set(RACE_COURSES.map((course) => course.mapPath)).size, RACE_COURSES.length);
  for (let index = 1; index < card.length; index++) {
    assert.notEqual(card[index], card[index - 1]);
  }
});

test('every authored surprise has an explicit broadcast symbol or production prop', () => {
  for (const spec of [...EVENT_SPECS, ...SWARM_SPECS]) {
    const presentation = presentationForMoment({
      id: 1,
      text: spec.calls[0],
      tone: spec.tone === 'wild' ? 'hot' : spec.tone,
      phase: 'warning',
      label: spec.label,
      kind: spec.kind,
    });
    assert.ok(presentation, `${spec.label} has no broadcast presentation`);
    assert.ok(presentation.art || presentation.glyph, `${spec.label} falls back to a text symbol`);
    if (presentation.glyph) assert.ok(PROP_GLYPHS[presentation.glyph], `${spec.label} names a glyph that is not drawn`);
  }
  for (const spec of RETIREMENT_SPECS) {
    const presentation = presentationForMoment({ id: 1, text: spec.reveal, tone: 'bad', label: spec.label });
    assert.ok(presentation?.art || presentation?.glyph, `${spec.label} retirement has no prop`);
  }

  assert.equal(
    presentationForMoment({ id: 1, text: 'Incoming', tone: 'bad', label: 'LETTUCE BREAK' })?.art,
    'lettuce-crate',
  );
  assert.equal(
    presentationForMoment({ id: 1, text: 'Incoming', tone: 'bad', label: 'THE PLAGUE' })?.art,
    'plague-cloud',
  );
});

test('the second surprise book is dealt alongside the first and stays original', () => {
  const labels = new Set([...EVENT_SPECS, ...SWARM_SPECS].map((spec) => spec.label));
  for (const expected of [
    'SIGHTSCREEN SHORTCUT', 'TEA INTERVAL', 'SELFIE STOP', 'DRS REVIEW', 'MYSTERY SPINNER',
    'RAIN SQUALL', 'MEXICAN WAVE', 'SEAGULL RAID', 'ICE CREAM VAN', 'PITCH INVADER',
  ]) {
    assert.ok(labels.has(expected), `${expected} missing from the event book`);
  }
  assert.ok(EVENT_SPECS.length >= 34);
  assert.ok(SWARM_SPECS.length >= 13);
  assert.ok(RETIREMENT_SPECS.length >= 8);
  /* No real-money or product language anywhere in the books. */
  const prohibited = /\b(money|cash|ticket|backer|punter|wager|fundeo|peedy)\b/i;
  for (const spec of [...EVENT_SPECS, ...SWARM_SPECS]) {
    for (const call of spec.calls) assert.equal(prohibited.test(call), false, call);
  }
  for (const spec of RETIREMENT_SPECS) {
    assert.match(spec.commentary, /safe/i, `${spec.label} must say the runner is safe`);
    assert.match(spec.commentary, /race is over/i);
  }
});
