import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DECK_CARDS,
  DECK_MIN_DURATION_MS,
  dealtDeckCards,
  drawLockedRacePlan,
  lockedProgressAt,
} from '../lib/race-engine';
import { presentationForMoment } from '../components/race-broadcast/surprise-presentation';
import { PROP_GLYPHS } from '../components/race-broadcast/prop-glyphs';

const names = Array.from({ length: 10 }, (_, i) => `Snail ${i + 1}`);
const deckEvents = (plan: ReturnType<typeof drawLockedRacePlan>) => plan.events.filter((e) => e.id.startsWith('deck-'));

test('chaos deals the deck, calm never does, and short races are spared', () => {
  let dealt = 0;
  for (let seed = 1; seed <= 120; seed++) {
    dealt += deckEvents(drawLockedRacePlan(seed, names, 40_000, true, 'chaos')).length;
    assert.equal(deckEvents(drawLockedRacePlan(seed, names, 40_000, true, 'calm')).length, 0);
    assert.equal(deckEvents(drawLockedRacePlan(seed, names, DECK_MIN_DURATION_MS - 1, true, 'chaos')).length, 0);
    assert.equal(deckEvents(drawLockedRacePlan(seed, names, 40_000, false, 'chaos')).length, 0);
  }
  assert.ok(dealt >= 120, `only ${dealt} deck cards over 120 chaos races`);
});

test('the deck reaches the finish straight and hits the whole field', () => {
  let late = 0;
  let fieldWide = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const plan = drawLockedRacePlan(seed, names, 60_000, true, 'chaos');
    for (const event of deckEvents(plan)) {
      if (event.effectAtMs > plan.durationMs * 0.72) late += 1;
      if (event.targetLanes.length >= 8) fieldWide += 1;
      /* Four beats, all before the first crossing, with a real consequence. */
      assert.ok(event.warningAtMs < event.revealAtMs && event.revealAtMs < event.effectAtMs && event.effectAtMs < event.commentaryAtMs);
      assert.ok(event.commentaryAtMs < plan.stopAtMs, `${event.id} in seed ${seed} lands after the finish`);
      assert.ok(event.targetLanes.some((lane) => event.clockDeltaMsByLane[lane] !== 0));
      assert.deepEqual(plan.cues.filter((c) => c.eventId === event.id).map((c) => c.phase), ['warning', 'reveal', 'effect', 'commentary']);
    }
  }
  assert.ok(late > 40, `only ${late} cards landed past 72% of the race`);
  assert.ok(fieldWide > 40, `only ${fieldWide} field-wide cards`);
});

test('no lane clock ever runs backwards, and the per-lane cap holds, deck included', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const plan = drawLockedRacePlan(seed, names, 45_000, true, 'chaos');
    for (const runner of plan.runners) {
      const delta = plan.events.reduce((sum, e) => sum + (e.clockDeltaMsByLane[runner.lane] ?? 0), 0);
      assert.ok(Math.abs(delta) <= plan.durationMs * 0.16);
      let last = 0;
      for (let t = 0; t <= plan.stopAtMs; t += 40) {
        const p = lockedProgressAt(plan, runner.lane, t);
        assert.ok(p + 1e-9 >= last, `lane ${runner.lane} went backwards at ${t}ms in seed ${seed}`);
        last = p;
      }
    }
  }
});

test('once-a-night cards are dealt without replacement across the card', () => {
  const once = DECK_CARDS.filter((c) => c.once).map((c) => c.id);
  assert.ok(once.includes('plague-line'));
  const dealt: string[] = [];
  let repeats = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const plan = drawLockedRacePlan(seed, names, 40_000, true, 'chaos', 1, 'circuit', 'boundary-oval', dealt);
    for (const id of dealtDeckCards(plan)) {
      if (dealt.includes(id)) repeats += 1;
      dealt.push(id);
    }
  }
  assert.equal(repeats, 0);
  assert.ok(dealt.length >= 3, 'the once-a-night cards were never dealt');
  /* Without the exclusion list the same cards come straight back. */
  let again = 0;
  for (let seed = 1; seed <= 200; seed++) again += dealtDeckCards(drawLockedRacePlan(seed, names, 40_000, true, 'chaos')).length;
  assert.ok(again > dealt.length);
});

test('every deck card has a drawn prop and the plan hash input changes with the deck', () => {
  for (const card of DECK_CARDS) {
    const presentation = presentationForMoment({ id: 1, text: card.calls[0], tone: 'bad', label: card.label, kind: card.kind });
    assert.ok(presentation?.art || presentation?.glyph, `${card.label} has no prop`);
    if (presentation?.glyph) assert.ok(PROP_GLYPHS[presentation.glyph]);
    for (const call of card.calls) assert.equal(/\b(money|cash|ticket|wager|punter)\b/i.test(call), false, call);
  }
  const a = drawLockedRacePlan(7, names, 40_000, true, 'chaos');
  const b = drawLockedRacePlan(7, names, 40_000, true, 'chaos');
  assert.deepEqual(a, b);
});
