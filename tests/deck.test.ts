import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DECK_CARDS,
  DECK_MIN_DURATION_MS,
  LANE_CLOCK_CAP,
  dealtDeckCards,
  drawLockedRacePlan,
  lockedProgressAt,
} from '../lib/race-engine';
import { presentationForMoment } from '../components/race-broadcast/surprise-presentation';
import { PROP_GLYPHS } from '../components/race-broadcast/prop-glyphs';

const names = Array.from({ length: 10 }, (_, i) => `Snail ${i + 1}`);
const deckEvents = (plan: ReturnType<typeof drawLockedRacePlan>) => plan.events.filter((e) => e.id.startsWith('deck-'));
const postCards = new Set(DECK_CARDS.filter((card) => card.post).map((card) => `deck-${card.id}`));

test('chaos deals the deck, calm keeps to the gentle book, and surprises off deals nothing', () => {
  let dealt = 0;
  for (let seed = 1; seed <= 120; seed++) {
    dealt += deckEvents(drawLockedRacePlan(seed, names, 40_000, true, 'chaos')).length;
    const calm = drawLockedRacePlan(seed, names, 40_000, true, 'calm');
    assert.equal(deckEvents(calm).length, 0);
    assert.ok(calm.events.every((e) => e.id.startsWith('book-') || e.id === 'ret-0'), 'calm deals only single-runner moments');
    assert.equal(drawLockedRacePlan(seed, names, 40_000, false, 'chaos').events.length, 0);
    /* No card at the post in a race too short to warn for it. */
    assert.ok(deckEvents(drawLockedRacePlan(seed, names, DECK_MIN_DURATION_MS - 1, true, 'mayhem')).every((e) => !postCards.has(e.id)));
  }
  assert.ok(dealt >= 120, `only ${dealt} deck cards over 120 chaos races`);
});

test('the deck reaches the post and hits the whole field', () => {
  let post = 0;
  let fieldWide = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const plan = drawLockedRacePlan(seed, names, 60_000, true, 'chaos');
    for (const event of deckEvents(plan)) {
      if (postCards.has(event.id)) post += 1;
      if (event.targetLanes.length >= 8) fieldWide += 1;
      /* Four beats, all before the first crossing, with a real consequence. */
      assert.ok(event.warningAtMs < event.revealAtMs && event.revealAtMs < event.effectAtMs && event.effectAtMs < event.commentaryAtMs);
      assert.ok(event.commentaryAtMs < plan.stopAtMs, `${event.id} in seed ${seed} lands after the finish`);
      assert.ok(event.targetLanes.some((lane) => event.clockDeltaMsByLane[lane] !== 0));
      assert.deepEqual(plan.cues.filter((c) => c.eventId === event.id).map((c) => c.phase), ['warning', 'reveal', 'effect', 'commentary']);
    }
  }
  assert.ok(post > 40, `only ${post} cards at the post`);
  assert.ok(fieldWide > 40, `only ${fieldWide} field-wide cards`);
});

test('no lane clock ever runs backwards, and the per-lane cap holds, deck included', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const plan = drawLockedRacePlan(seed, names, 45_000, true, 'mayhem');
    for (const runner of plan.runners) {
      const delta = plan.events.reduce((sum, e) => sum + (e.clockDeltaMsByLane[runner.lane] ?? 0), 0);
      assert.ok(Math.abs(delta) <= plan.durationMs * LANE_CLOCK_CAP);
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
    const plan = drawLockedRacePlan(seed, names, 40_000, true, 'mayhem', 1, 'circuit', 'boundary-oval', dealt);
    for (const id of dealtDeckCards(plan)) {
      if (dealt.includes(id)) repeats += 1;
      dealt.push(id);
    }
  }
  assert.equal(repeats, 0);
  assert.ok(dealt.length >= 3, 'the once-a-night cards were never dealt');
  /* Without the exclusion list the same cards come straight back. */
  let again = 0;
  for (let seed = 1; seed <= 200; seed++) again += dealtDeckCards(drawLockedRacePlan(seed, names, 40_000, true, 'mayhem')).length;
  assert.ok(again > dealt.length);
});

test('every deck card has a drawn prop and the plan hash input changes with the deck', () => {
  for (const card of DECK_CARDS) {
    const presentation = presentationForMoment({ id: 1, text: card.calls[0], tone: 'bad', label: card.label, kind: card.kind });
    assert.ok(presentation?.art || presentation?.glyph, `${card.label} has no prop`);
    if (presentation?.glyph) assert.ok(PROP_GLYPHS[presentation.glyph]);
    for (const call of card.calls) assert.equal(/\b(money|cash|ticket|wager|punter)\b/i.test(call), false, call);
    /* The warning goes up before the hit, when the order can still change: it never names a place. */
    assert.doesNotMatch(card.warning, /\bleader|\blast\b|\b\d+(st|nd|rd|th)\b/i, card.warning);
    for (const call of card.calls) assert.doesNotMatch(call, /\bthe leader\b|\bstraight\b/i, `${card.label}: positions come from the live order`);
  }
  const a = drawLockedRacePlan(7, names, 40_000, true, 'chaos');
  const b = drawLockedRacePlan(7, names, 40_000, true, 'chaos');
  assert.deepEqual(a, b);
});

test('the twists are in the deck, and the crowd favourites still come out', () => {
  for (const id of ['big-boot', 'snail-ale', 'watermelon', 'boom-gate', 'catapult', 'bunch-up', 'caterpillar', 'speed-camera', 'the-bat', 'contagion']) {
    assert.ok(DECK_CARDS.some((card) => card.id === id), `${id} is missing from the deck`);
  }
  let perRace = 0;
  let bats = 0;
  let plagues = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const plan = drawLockedRacePlan(seed, names, 120_000, true, 'mayhem');
    const deck = deckEvents(plan);
    perRace += deck.length;
    if (deck.some((e) => e.label === 'THE BAT')) bats += 1;
    if (plan.events.some((e) => /PLAGUE/.test(e.label))) plagues += 1;
  }
  assert.ok(perRace / 200 >= 2.5, `a two-minute mayhem race averaged only ${perRace / 200} deck cards`);
  assert.ok(bats >= 20, `the bat came out in only ${bats} of 200 races`);
  assert.ok(plagues >= 40, `a plague came out in only ${plagues} of 200 races`);
});

test('every announced surprise from the ordinary book is visible on the track', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const plan = drawLockedRacePlan(seed, names, 90_000, true, 'chaos');
    for (const event of plan.events) {
      if (event.consequence === 'retire') continue;
      const biggest = Math.max(...event.targetLanes.map((lane) => Math.abs(event.clockDeltaMsByLane[lane] ?? 0)));
      assert.ok(biggest >= plan.durationMs * 0.02, `${event.id} in seed ${seed} shifts a clock by only ${biggest}ms`);
    }
  }
});

test('mayhem deals more twists than chaos and still keeps every lane inside the cap', () => {
  let chaos = 0;
  let mayhem = 0;
  for (let seed = 1; seed <= 100; seed++) {
    chaos += drawLockedRacePlan(seed, names, 120_000, true, 'chaos').events.length;
    const plan = drawLockedRacePlan(seed, names, 120_000, true, 'mayhem');
    mayhem += plan.events.length;
    for (const runner of plan.runners) {
      const delta = plan.events.reduce((sum, e) => sum + (e.clockDeltaMsByLane[runner.lane] ?? 0), 0);
      assert.ok(Math.abs(delta) <= plan.durationMs * LANE_CLOCK_CAP);
      let last = 0;
      for (let t = 0; t <= plan.stopAtMs; t += 80) {
        const p = lockedProgressAt(plan, runner.lane, t);
        assert.ok(p + 1e-9 >= last, `lane ${runner.lane} went backwards at ${t}ms in seed ${seed}`);
        last = p;
      }
    }
  }
  assert.ok(mayhem > chaos * 1.2, `mayhem dealt ${mayhem} against chaos ${chaos}`);
});
