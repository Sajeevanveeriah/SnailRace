import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseForRace, RACE_COURSES } from '../lib/courses';
import { EVENT_SPECS, SWARM_SPECS } from '../lib/race-engine';
import { presentationForMoment } from '../components/race-broadcast/surprise-presentation';

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
    assert.ok(presentation.art || presentation.symbol, `${spec.label} has no visible prop or symbol`);
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
