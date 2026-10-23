import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardLayout, snailsForRace } from '../lib/card';
import { NDCC_RACE_SPONSORS, isPreviousNdccSponsors, withNdccSponsors, ndccCard, ndccRoster, normaliseRaceSponsors, resolveRaceSponsor, upgradeNdccCard, withNdccRoster } from '../lib/ndcc-night';
import { CLUB_SPONSORS, raceSponsorArt } from '../lib/club-sponsors';
import { isClubTeam, sponsorArt, sponsorBadgeWidth } from '../components/SponsorLogo';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { freshCard } from '../lib/card';
import { METRES_PER_SECOND, POST_SPACING, START_X, raceMetres, straightTrack } from '../components/sidescroller-geometry';
import { raceSettings } from '../lib/run-sheet';
import { freshState } from '../lib/event-store';

test('the night card is the 88 snails sold on the website, eleven races of eight', () => {
  const card = ndccCard();
  assert.equal(card.snailCount, 88);
  assert.equal(card.names.filter(Boolean).length, 88, 'every number is sold');
  assert.equal(card.names[0], 'Flat Stanley');
  assert.equal(card.owners[0], 'Troy Whitworth');
  assert.equal(card.names[87], 'Snailvester Stallone');
  assert.equal(card.names[75], 'NDCC Juniors');
  assert.equal(card.names[79], 'NDCC Seniors');
  assert.equal(card.owners[75], 'Sajeevan Veeriah');
  const layout = cardLayout(card);
  assert.equal(layout.races, 11);
  assert.deepEqual(layout.sizes, Array(11).fill(8));
  assert.deepEqual(snailsForRace(1, card), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(snailsForRace(5, card), [33, 34, 35, 36, 37, 38, 39, 40]);
  assert.deepEqual(snailsForRace(11, card), [81, 82, 83, 84, 85, 86, 87, 88]);
  assert.equal(card.snailCents, 1000);
  /* No contact details came across. */
  assert.ok(!JSON.stringify(ndccRoster()).match(/@|\d{8,}/));
});

test('the sponsored races carry their sponsors, with the women reading NDCC Womens team and Elyod on race 11', () => {
  assert.deepEqual(NDCC_RACE_SPONSORS.map((s) => s.race), [1, 5, 6, 7, 9, 11]);
  assert.equal(resolveRaceSponsor(NDCC_RACE_SPONSORS, [], 9).name, 'Laura Hudson');
  assert.equal(resolveRaceSponsor(NDCC_RACE_SPONSORS, [], 1).name, 'Grey Dinos');
  assert.equal(resolveRaceSponsor(NDCC_RACE_SPONSORS, [], 5).name, 'NDCC Womens team');
  assert.equal(resolveRaceSponsor(NDCC_RACE_SPONSORS, [], 5).title, 'The Dino-Mite Drag Race Stakes');
  assert.equal(resolveRaceSponsor(NDCC_RACE_SPONSORS, [], 11).name, 'Elyod Roof Tiling');
  assert.equal(resolveRaceSponsor(NDCC_RACE_SPONSORS, [], 11).title, "The Shiv's Bouffant Stakes");
  assert.equal(resolveRaceSponsor(NDCC_RACE_SPONSORS, [], 2).name, '');
  /* A race without its own sponsor still takes the cycled list. */
  assert.equal(resolveRaceSponsor(NDCC_RACE_SPONSORS, ['A', 'B'], 2).name, 'B');
  assert.deepEqual(normaliseRaceSponsors([{ race: 3, name: '  X  ' }, { race: 3, name: 'Y' }, { race: 0, name: 'Z' }, 'junk']), [{ race: 3, name: 'X' }]);
  assert.deepEqual(normaliseRaceSponsors([{ race: 4, name: 'Y', logo: ' Moolap Tyres ' }]), [{ race: 4, name: 'Y', logo: 'Moolap Tyres' }]);
});

test('every race sponsor shows the club crest, with a club sponsor’s logo beside it only where there is one', () => {
  assert.ok(isClubTeam('Grey Dinos'));
  assert.ok(isClubTeam('NDCC Womens team'));
  assert.ok(!isClubTeam('John Elliott'));
  assert.equal(raceSponsorArt('Elyod Roof Tiling')?.name, 'Elyod Roof Tiling');
  assert.equal(raceSponsorArt('ELYOD ROOF TILING')?.name, 'Elyod Roof Tiling');
  assert.equal(raceSponsorArt('John Elliott'), null, 'no artwork is made up for a name');
  assert.equal(raceSponsorArt('Troy Whitworth', 'Phoenix Truck Bodies')?.name, 'Phoenix Truck Bodies');
  assert.equal(raceSponsorArt('Elyod Roof Tiling', 'none'), null);
  for (const s of CLUB_SPONSORS) assert.ok(existsSync(join('public', s.src.replace(/^.*?\/sponsors\//, 'sponsors/'))), s.src);
});

test('a night saved with the old eight races of eleven takes the eleven races of eight and keeps typed names', () => {
  const old = { ...ndccCard(), snailsPerRace: 11, races: Array.from({ length: 8 }, (_, i) => ({ runners: 11, ...(i === 2 ? { laps: 3 } : {}) })) };
  old.names = old.names.slice();
  old.names[75] = '';
  old.names[79] = '';
  old.names[3] = 'Typed On The Desk';
  const up = upgradeNdccCard(old);
  assert.ok(up);
  assert.equal(up.races.length, 11);
  assert.ok(up.races.every((r) => r.runners === 8));
  assert.equal(up.races[2].laps, 3, 'a race keeps its own settings');
  assert.equal(up.names[3], 'Typed On The Desk');
  assert.equal(up.names[75], 'NDCC Juniors');
  assert.equal(up.names[79], 'NDCC Seniors');
  assert.equal(upgradeNdccCard(ndccCard()), null, 'the current card is left alone');
  assert.equal(upgradeNdccCard(freshCard()), null);
  assert.ok(isPreviousNdccSponsors([
    { race: 1, name: 'Grey Dinos', title: 'The Grey Dinos Hcap Stakes' },
    { race: 5, name: 'NDCC Womens', title: 'The Dino-Mite Drag Race Stakes' },
    { race: 6, name: 'John Elliott', title: 'The 2-Cent-Jack Stakes' },
    { race: 7, name: 'Troy Whitworth', title: 'The Phoenix Gold Cup Stakes' },
  ]));
  assert.ok(!isPreviousNdccSponsors(NDCC_RACE_SPONSORS));
  /* The list 5.6 shipped (before race 9 was sold) is replaced too. */
  assert.ok(isPreviousNdccSponsors(NDCC_RACE_SPONSORS.filter((s) => s.race !== 9)));
  assert.deepEqual(withNdccSponsors(NDCC_RACE_SPONSORS.filter((s) => s.race !== 9)).map((s) => s.race), [1, 5, 6, 7, 9, 11]);
  /* A logo changed in Admin is an edit: it is kept while race 9 is added. */
  const crestOnly = NDCC_RACE_SPONSORS.filter((s) => s.race !== 9).map((s) => (s.race === 11 ? { ...s, logo: 'none' } : s));
  assert.ok(!isPreviousNdccSponsors(crestOnly));
  const kept = withNdccSponsors(crestOnly);
  assert.equal(kept.find((s) => s.race === 11)?.logo, 'none');
  assert.ok(kept.some((s) => s.race === 9));
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

test('a saved sponsor list gains the sold races it leaves out, and an old untouched list is replaced', () => {
  const edited = withNdccSponsors([{ race: 5, name: 'NDCC Women', title: 'Typed' }]);
  assert.deepEqual(edited.map((s) => s.race), [1, 5, 6, 7, 9, 11]);
  assert.equal(edited.find((s) => s.race === 5)?.name, 'NDCC Women', 'a race typed by hand keeps what was typed');
  assert.equal(edited.find((s) => s.race === 11)?.name, 'Elyod Roof Tiling');
  /* A race entry with no sponsor name yet is not a sponsor: the cycled list still applies. */
  assert.equal(resolveRaceSponsor([{ race: 2, name: ' ', title: 'T' }], ['A', 'B'], 2).name, 'B');
});

test('a logo chosen in Admin always shows, even for a club team; otherwise a club team is the crest alone', () => {
  assert.equal(sponsorArt('Grey Dinos'), null);
  assert.equal(sponsorArt('Grey Dinos', 'Moolap Tyres')?.name, 'Moolap Tyres');
  assert.equal(sponsorArt('Elyod Roof Tiling')?.name, 'Elyod Roof Tiling');
  assert.equal(sponsorArt('Elyod Roof Tiling', 'none'), null);
  /* The track's badge keeps the crest and puts a sponsor's logo beside it. */
  assert.equal(sponsorBadgeWidth('Grey Dinos'), 100);
  assert.equal(sponsorBadgeWidth('Elyod Roof Tiling'), 216);
});
