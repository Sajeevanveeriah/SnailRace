import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardLayout, snailsForRace } from '../lib/card';
import { NDCC_RACE_SPONSORS, ndccCard, ndccRoster, normaliseRaceSponsors, resolveRaceSponsor, withNdccRoster } from '../lib/ndcc-night';
import { freshCard } from '../lib/card';
import { METRES_PER_SECOND, POST_SPACING, START_X, raceMetres, straightTrack } from '../components/sidescroller-geometry';
import { raceSettings } from '../lib/run-sheet';
import { freshState } from '../lib/event-store';

test('the night card is the 86 snails sold on the website, eight races of eleven', () => {
  const card = ndccCard();
  assert.equal(card.snailCount, 88);
  assert.equal(card.names.filter(Boolean).length, 86);
  assert.equal(card.names[0], 'Flat Stanley');
  assert.equal(card.owners[0], 'Troy Whitworth');
  assert.equal(card.names[87], 'Snailvester Stallone');
  assert.equal(card.names[75], '', 'number 76 was not sold');
  assert.equal(card.names[79], '', 'number 80 was not sold');
  const layout = cardLayout(card);
  assert.equal(layout.races, 8);
  assert.deepEqual(layout.sizes, Array(8).fill(11));
  assert.deepEqual(snailsForRace(5, card), [45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55]);
  assert.equal(card.snailCents, 1000);
  /* No contact details came across. */
  assert.ok(!JSON.stringify(ndccRoster()).match(/@|\d{8,}/));
});

test('the sponsored races carry their sponsors, and Ruby Moreland’s race reads NDCC Womens', () => {
  assert.deepEqual(NDCC_RACE_SPONSORS.map((s) => s.race), [1, 5, 6, 7]);
  assert.equal(resolveRaceSponsor(NDCC_RACE_SPONSORS, [], 5).name, 'NDCC Womens');
  assert.equal(resolveRaceSponsor(NDCC_RACE_SPONSORS, [], 5).title, 'The Dino-Mite Drag Race Stakes');
  assert.equal(resolveRaceSponsor(NDCC_RACE_SPONSORS, [], 2).name, '');
  /* A race without its own sponsor still takes the cycled list. */
  assert.equal(resolveRaceSponsor(NDCC_RACE_SPONSORS, ['A', 'B'], 2).name, 'B');
  assert.deepEqual(normaliseRaceSponsors([{ race: 3, name: '  X  ' }, { race: 3, name: 'Y' }, { race: 0, name: 'Z' }, 'junk']), [{ race: 3, name: 'X' }]);
});

test('loading the orders onto a card with names typed keeps those names', () => {
  const card = freshCard();
  card.names[0] = 'Mucus Bolt';
  const filled = withNdccRoster(card);
  assert.equal(filled.names[0], 'Mucus Bolt');
  assert.equal(filled.names[1], 'Snailey Cyrus');
});

test('a longer race is a longer straight at the same pace, and the snail speed stretches it again', () => {
  assert.equal(raceMetres(30_000, 1), 10);
  assert.equal(raceMetres(60_000, 1), 20);
  assert.equal(raceMetres(120_000, 2), 80);
  assert.equal(raceMetres(1_000, 1), 4, 'never shorter than four metres');
  const short = straightTrack(10);
  const long = straightTrack(40);
  assert.equal(long.trackLen - START_X, 4 * (short.trackLen - START_X));
  assert.equal(short.distancePosts.length, 9);
  assert.equal(long.distancePosts[0].metres, 39);
  /* The world distance covered per second is the same whatever the length. */
  const perSecond = (metres: number, ms: number) => ((straightTrack(metres).trackLen - START_X) / ms) * 1000;
  assert.ok(Math.abs(perSecond(10, 30_000) - perSecond(20, 60_000)) < 1e-9);
  assert.ok(Math.abs(perSecond(10, 30_000) - POST_SPACING * METRES_PER_SECOND) < 1e-9);
});

test('on a circuit the snail speed puts more laps in the same race time', () => {
  const event = { ...freshState(), trackDesigns: ['boundary-oval'] as ['boundary-oval'], trackShape: 'circuit' as const, raceDurationMs: 60_000, laps: 2 };
  const standard = raceSettings(event, 1);
  const fast = raceSettings({ ...event, snailSpeed: 2 }, 1);
  assert.equal(standard.laps, 2);
  assert.equal(fast.laps, 4);
  assert.equal(fast.durationMs, standard.durationMs);
  assert.equal(fast.lapMs * 2, standard.lapMs);
});

test('loading the orders leaves the snails of a held race alone', () => {
  const card = { ...ndccCard(), names: [] as string[], owners: [] as string[] };
  const filled = withNdccRoster(card, false, new Set([1, 2, 3]));
  assert.equal(filled.names[0] ?? '', '');
  assert.equal(filled.names[2] ?? '', '');
  assert.ok(filled.names[3]);
});
