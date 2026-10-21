import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DECK_CARDS, EVENT_SPECS, RETIREMENT_SPECS, SWARM_SPECS, drawLockedRacePlan } from '../lib/race-engine';
import { presentationForMoment } from '../components/race-broadcast/surprise-presentation';
import { PROP_GLYPHS, type PropGlyphId } from '../components/race-broadcast/prop-glyphs';

const glyphFor = (label: string, text = 'Incoming', kind?: string) =>
  presentationForMoment({ id: 1, text, tone: 'bad', label, kind })?.glyph;

/* Generic signs are not props: each of these used to be a bare warning triangle. */
const GENERIC: readonly (PropGlyphId | undefined)[] = ['warning', undefined];

test('every surprise, deck card and retirement in the engine has its own illustrated prop', () => {
  const labels = new Set<string>([
    ...EVENT_SPECS.map((spec) => spec.label),
    ...SWARM_SPECS.map((spec) => spec.label),
    ...DECK_CARDS.map((card) => card.label),
    ...RETIREMENT_SPECS.map((spec) => spec.label),
  ]);
  /* What a locked plan actually puts on air, including the comeback beats. */
  const names = Array.from({ length: 12 }, (_, i) => `Snail ${i + 1}`);
  for (const intensity of ['standard', 'big', 'chaos', 'mayhem'] as const) {
    for (let seed = 1; seed <= 60; seed++) {
      for (const event of drawLockedRacePlan(seed, names, 60_000, true, intensity).events) labels.add(event.label);
    }
  }
  assert.ok(labels.size > 60, `only ${labels.size} labels found`);
  for (const label of labels) {
    const glyph = glyphFor(label);
    assert.ok(!GENERIC.includes(glyph), `${label} has no illustrated prop (${glyph ?? 'none'})`);
    assert.ok(PROP_GLYPHS[glyph as PropGlyphId], `${label} names a glyph that is not drawn`);
  }
});

test('the props that used to be line drawings or generic icons are their own pictures', () => {
  assert.equal(glyphFor('GRAVEL PATCH'), 'gravel');
  assert.equal(glyphFor('ROAD WORKS'), 'cones');
  assert.equal(glyphFor('EARTH TREMOR'), 'tremor');
  assert.equal(glyphFor('HAILSTORM'), 'hail');
  assert.equal(glyphFor('CROWD LIFT'), 'crowd-wave');
  assert.equal(glyphFor('NDCC CROWD LIFT'), 'crowd-wave');
  assert.equal(glyphFor('PITCH ROLLER DETOUR'), 'pitch-roller');
  assert.equal(glyphFor('ROLLER OBSTRUCTION'), 'pitch-roller');
  assert.equal(glyphFor('SPRINKLER SURPRISE'), 'sprinkler');
  assert.equal(glyphFor('SIGHTSCREEN GLARE'), 'sightscreen');
  assert.equal(glyphFor('POSSUM ON THE LOOSE'), 'possum');
  assert.equal(glyphFor('RUNAWAY DRONE'), 'drone');
  assert.equal(glyphFor('THE BIG FREEZE'), 'freeze');
  assert.equal(glyphFor('HEADWIND'), 'headwind');
  assert.equal(glyphFor('SECOND WIND'), 'bolt');
});

test('a snail name in the caption never changes the prop the label names', () => {
  assert.equal(glyphFor('LETTUCE AMBUSH', 'The leader, Rainbow Dash, has stopped for lettuce!'), 'lettuce');
  assert.equal(glyphFor('GRAVEL PATCH', 'Dewdrop is into the gravel'), 'gravel');
  /* Archived moments without a label still fall back to their wording. */
  assert.equal(presentationForMoment({ id: 1, text: 'The sprinklers are on!', tone: 'bad' })?.glyph, 'sprinkler');
});

test('every glyph is a filled drawing in the shared ink outline', () => {
  for (const [id, node] of Object.entries(PROP_GLYPHS)) {
    const markup = renderToStaticMarkup(createElement('svg', null, node));
    assert.match(markup, /fill="(?!none)[^"]+"/, `${id} has no filled shape`);
    assert.match(markup, /#24171b/, `${id} is not outlined in the shared ink`);
  }
});
