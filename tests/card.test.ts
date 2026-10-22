import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CARD,
  SNAILS_ON_CARD,
  applyPurchases,
  cardLayout,
  cardRaceNames,
  describeLayout,
  resizeCard,
  MAX_SNAILS_ON_CARD,
  addRace,
  addRunOff,
  cardFit,
  fitFixes,
  freshCard,
  isRunOff,
  nextSnailsRace,
  raceTitle,
  removeLastRace,
  runSheetLocks,
  setRaceCount,
  setRaceRunners,
  setRaceSettings,
  setSnailsPerRace,
  laneForSnail,
  nextFreeSnail,
  normaliseCard,
  parseRosterPaste,
  cutAtWord,
  MAX_NAME,
  describeRaces,
  describeSnailsPerRace,
  lockReasons,
  racesFloor,
  racesFloorReason,
  splitCsvLine,
  raceForSnail,
  releaseRefunded,
  rosterCsv,
  snailCountFits,
  snailCountLock,
  snailsForRace,
  soldCount,
} from '../lib/card';

const fresh = () => normaliseCard(DEFAULT_CARD);

test('snail numbers map to races and lanes the way the poster says', () => {
  assert.equal(raceForSnail(1), 1);
  assert.equal(raceForSnail(10), 1);
  assert.equal(raceForSnail(11), 2);
  assert.equal(raceForSnail(100), 10);
  assert.equal(laneForSnail(1), 0);
  assert.equal(laneForSnail(10), 9);
  assert.equal(laneForSnail(23), 2);
  assert.deepEqual(snailsForRace(3), [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
  assert.equal(SNAILS_ON_CARD, 100);
});

test('an unsold snail still races, under its number', () => {
  const card = fresh();
  card.names[20] = 'Shelly Winters';
  const names = cardRaceNames(card, 3);
  assert.equal(names.length, 10);
  assert.equal(names[0], 'Shelly Winters');
  assert.equal(names[1], 'Snail 22');
  assert.equal(names[9], 'Snail 30');
});

test('paid purchases fill empty slots and never overwrite a hand-typed one', () => {
  const card = fresh();
  card.names[28] = 'Typed At The Table';
  const first = applyPurchases(card, [
    { snailNo: 29, snailName: 'Escargot Faster', owner: 'Priya', id: 'cs_1' },
    { snailNo: 30, snailName: "Nan's Favourite", owner: 'Lisa', id: 'cs_2' },
  ]);
  assert.equal(first.changed, true);
  assert.equal(first.card.names[29], "Nan's Favourite");
  assert.equal(first.card.owners[29], 'Lisa');
  assert.equal(first.card.claims[30], 'cs_2');
  /* 29 was typed by the desk: the payment is reported, not applied. */
  assert.equal(first.card.names[28], 'Typed At The Table');
  assert.deepEqual(first.conflicts.map((c) => c.snailNo), [29]);

  /* The same session again changes nothing; a corrected name flows through. */
  const again = applyPurchases(first.card, [{ snailNo: 30, snailName: "Nan's Favourite", owner: 'Lisa', id: 'cs_2' }]);
  assert.equal(again.changed, false);
  const fixed = applyPurchases(first.card, [{ snailNo: 30, snailName: 'Nans Favourite', owner: 'Lisa', id: 'cs_2' }]);
  assert.equal(fixed.card.names[29], 'Nans Favourite');
  /* A different payment cannot take a claimed number. */
  const clash = applyPurchases(first.card, [{ snailNo: 30, snailName: 'Someone Else', owner: 'Bob', id: 'cs_9' }]);
  assert.equal(clash.changed, false);
  assert.equal(clash.conflicts.length, 1);
});

test('the roster paste accepts commas, semicolons and tabs and skips junk', () => {
  const { rows, skipped } = parseRosterPaste(
    '29, Escargot Faster, Priya\n30; Nan\'s Favourite; Lisa\n#31\tThe Undertaker\tBen\nhello world\n\n101, Too Far, X',
  );
  assert.deepEqual(rows, [
    { snailNo: 29, name: 'Escargot Faster', owner: 'Priya', line: 1 },
    { snailNo: 30, name: "Nan's Favourite", owner: 'Lisa', line: 2 },
    { snailNo: 31, name: 'The Undertaker', owner: 'Ben', line: 3 },
  ]);
  assert.equal(skipped, 2);
});

test('the roster paste reads quoted CSV fields, names the skipped lines and warns about repeated numbers', () => {
  const stripe = [
    'Snail number,Snail name,Your name',
    '4, "Quoted, Name", "Mel, Dave"',
    '5,"Nan said ""go"" snail","O\'Brien"',
    '6, Duplicate Six, First Owner',
    '6, Duplicate Six, Second Owner',
    '250, Too Far, X',
    'hello world',
  ].join('\n');
  const parsed = parseRosterPaste(stripe);
  assert.deepEqual(parsed.rows.map((r) => [r.snailNo, r.name, r.owner]), [
    [4, 'Quoted, Name', 'Mel, Dave'],
    [5, 'Nan said "go" snail', "O'Brien"],
    [6, 'Duplicate Six', 'Second Owner'],
  ]);
  assert.equal(parsed.skipped, 3);
  assert.deepEqual(parsed.skippedLines.map((x) => [x.line, x.reason]), [
    [1, 'no snail number at the start of the line'],
    [6, 'snail 250 is not on sale (100 on sale)'],
    [7, 'no snail number at the start of the line'],
  ]);
  assert.deepEqual(parsed.duplicates, [6]);
  assert.deepEqual(parsed.shortened, []);
  assert.deepEqual(splitCsvLine('a;"b;c"\t d '), ['a', 'b;c', 'd']);
});

test('a name past forty-eight characters is cut at a word, and the paste says so', () => {
  const long = 'Speedy Gonzales the Third of Geelong West and Surrounds';
  assert.equal(cutAtWord(long, MAX_NAME), 'Speedy Gonzales the Third of Geelong West and');
  assert.equal(cutAtWord('Short name', MAX_NAME), 'Short name');
  /* A single long word has no boundary worth keeping. */
  assert.equal(cutAtWord('x'.repeat(60), MAX_NAME).length, MAX_NAME);
  /* Exactly forty-eight characters survive whole. */
  assert.equal(cutAtWord('a'.repeat(40) + ' bcdefgh', MAX_NAME), 'a'.repeat(40) + ' bcdefgh');
  const parsed = parseRosterPaste(`2, ${long}, Lisa`);
  assert.equal(parsed.rows[0].name, 'Speedy Gonzales the Third of Geelong West and');
  assert.deepEqual(parsed.shortened, [2]);
  assert.equal(normaliseCard({ snailCount: 10, names: [long] }).names[0], 'Speedy Gonzales the Third of Geelong West and');
});

test('sold count, next free number and the CSV export', () => {
  const card = fresh();
  assert.equal(soldCount(card), 0);
  assert.equal(nextFreeSnail(card), 1);
  card.names[0] = 'One';
  card.owners[1] = 'Owner Two';
  assert.equal(soldCount(card), 2);
  assert.equal(nextFreeSnail(card), 3);
  const csv = rosterCsv(card).split('\n');
  assert.equal(csv[0], 'snail,race,lane,name,owner');
  assert.equal(csv[1], '1,1,1,"One",""');
  assert.equal(csv.length, 101);
});

test('a stored card from any backup normalises to exactly one hundred slots', () => {
  const card = normaliseCard({ names: ['A', 'B'], owners: null, claims: { 1: 'cs_a', 999: 'cs_b', x: 1 }, snailCents: 5, paymentLinkUrl: 'javascript:alert(1)' });
  assert.equal(card.names.length, 100);
  assert.equal(card.owners.length, 100);
  assert.deepEqual(card.claims, { 1: 'cs_a' });
  assert.equal(card.snailCents, 400);
  assert.equal(card.paymentLinkUrl, '');
  assert.equal(normaliseCard({ paymentLinkUrl: 'https://buy.stripe.com/test_abc' }).paymentLinkUrl, 'https://buy.stripe.com/test_abc');
});

test('a full refund releases the slot it bought, and only that slot', () => {
  const card = fresh();
  const bought = applyPurchases(card, [
    { snailNo: 29, snailName: 'Escargot Faster', owner: 'Priya', id: 'cs_1' },
    { snailNo: 30, snailName: 'Nans Favourite', owner: 'Lisa', id: 'cs_2' },
  ]).card;
  const { card: after, released } = releaseRefunded(bought, ['cs_1', 'cs_unknown']);
  assert.deepEqual(released, [29]);
  assert.equal(after.names[28], '');
  assert.equal(after.owners[28], '');
  assert.equal(after.claims[29], undefined);
  assert.equal(after.names[29], 'Nans Favourite');
  /* The desk reassigned the number by hand since: the refund does not touch it. */
  const retyped = { ...after, names: after.names.slice(), claims: { ...after.claims } };
  retyped.names[29] = 'Typed Later';
  delete retyped.claims[30];
  assert.equal(releaseRefunded(retyped, ['cs_2']).released.length, 0);
  /* A refunded number can be bought again. */
  assert.equal(applyPurchases(after, [{ snailNo: 29, snailName: 'Second Go', owner: 'Sam', id: 'cs_3' }]).card.names[28], 'Second Go');
  /* The minted flag only survives alongside a valid link. */
  assert.equal(normaliseCard({ paymentLinkUrl: 'https://buy.stripe.com/x', paymentLinkMinted: true }).paymentLinkMinted, true);
  assert.equal(normaliseCard({ paymentLinkMinted: true }).paymentLinkMinted, false);
});

test('a card of 64 snails splits into eight equal races of eight', () => {
  const layout = cardLayout(64);
  assert.equal(layout.races, 8);
  assert.deepEqual(layout.sizes, [8, 8, 8, 8, 8, 8, 8, 8]);
  assert.equal(describeLayout(layout), '8 races of 8');
  assert.deepEqual(snailsForRace(1, 64), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(snailsForRace(2, 64), [9, 10, 11, 12, 13, 14, 15, 16]);
  assert.equal(raceForSnail(64, 64), 8);
  assert.equal(laneForSnail(17, 64), 0);
  assert.equal(raceForSnail(20, 64), 3);
  /* Equal fields whenever a size from eight to ten divides the count, the largest size first. */
  assert.equal(describeLayout(cardLayout(90)), '9 races of 10');
  assert.equal(describeLayout(cardLayout(72)), '8 races of 9');
  assert.equal(describeLayout(cardLayout(96)), '12 races of 8');
  /* A count no field size divides falls back to the fewest races within one of each other. */
  assert.equal(describeLayout(cardLayout(73)), '8 races: 1 of 10, 7 of 9');
  assert.equal(describeLayout(cardLayout(87)), '9 races: 6 of 10, 3 of 9');
  /* Every number runs exactly once, every field is a legal size. */
  for (let n = 8; n <= 200; n += 1) {
    if (!snailCountFits(n)) continue;
    const l = cardLayout(n);
    assert.equal(l.sizes.reduce((a, b) => a + b, 0), n);
    assert.ok(l.sizes.every((size) => size >= 8 && size <= 10), `${n}: ${l.sizes.join(',')}`);
    assert.ok(Math.max(...l.sizes) - Math.min(...l.sizes) <= 1, `${n}: ${l.sizes.join(',')}`);
    if ([8, 9, 10].some((size) => n % size === 0)) assert.equal(new Set(l.sizes).size, 1, `${n} should split into equal fields`);
    const seen = Array.from({ length: l.races }, (_, i) => snailsForRace(i + 1, n)).flat();
    assert.deepEqual(seen, Array.from({ length: n }, (_, i) => i + 1));
  }
  assert.equal(describeLayout(cardLayout(100)), '10 races of 10');
});

test('the card cannot shrink below a sold snail, keeps names on resize, and never moves a race', () => {
  const card = fresh();
  card.names[69] = 'Seventy';
  const blocked = resizeCard(card, 64);
  assert.ok('error' in blocked);
  card.names[69] = '';
  card.names[9] = 'Ten';
  const smaller = resizeCard(card, 64);
  assert.ok(!('error' in smaller));
  if ('error' in smaller) return;
  assert.equal(smaller.snailCount, 64);
  assert.equal(smaller.names.length, 64);
  assert.equal(smaller.names[9], 'Ten');
  /* Snails on sale change; the run sheet does not. The desk is told they disagree. */
  assert.equal(cardRaceNames(smaller, 2).length, 10);
  assert.equal(cardFit(smaller).message, '64 sold, 100 places: 36 places have no snail.');
  const restored = normaliseCard(JSON.parse(JSON.stringify(smaller)));
  assert.equal(restored.snailCount, 64);
  assert.equal(restored.races.length, 10);
});

test('a sold quaddie ticket locks the number of snails', () => {
  assert.equal(snailCountLock({ history: [], quaddieEntries: [] }, false), '');
  assert.equal(snailCountLock({ history: [], quaddieEntries: [{ void: true }] }, false), '');
  assert.match(snailCountLock({ history: [], quaddieEntries: [{}] }, false), /quaddie/);
});

test('counts that cannot split automatically are stepped down; snails on sale take any count', () => {
  const misfits = Array.from({ length: 193 }, (_, i) => i + 8).filter((n) => !snailCountFits(n));
  assert.deepEqual(misfits, [11, 12, 13, 14, 15, 21, 22, 23, 31]);
  assert.equal(cardLayout(23).snails, 20);
  const card = resizeCard(fresh(), 23);
  assert.ok(!('error' in card) && card.snailCount === 23);
  assert.ok('error' in resizeCard(fresh(), 7));
  assert.ok('error' in resizeCard(fresh(), 201));
});

test('a tote ticket or auction bid locks the number of snails', () => {
  assert.match(snailCountLock({ history: [], toteSales: [{}] }, false), /tote/);
  assert.match(snailCountLock({ history: [], auctionBids: [{}] }, false), /auction/);
  assert.match(snailCountLock({ history: [], cashLedger: [{}] }, false), /cash/);
  assert.equal(snailCountLock({ history: [], toteSales: [{ void: true }], auctionBids: [] }, false), '');
});

/* ── The run sheet ─────────────────────────────────────────────────────── */

const noTies = { history: [] as { raceNo: number; void?: boolean }[] };

test('a fresh card is a run sheet of ten races of ten', () => {
  const card = freshCard();
  assert.equal(card.races.length, 10);
  assert.equal(card.snailsPerRace, 10);
  assert.equal(describeLayout(cardLayout(card)), '10 races of 10');
  assert.equal(cardFit(card).message, '');
  assert.deepEqual(fitFixes(card, runSheetLocks(card, noTies)), []);
});

test('84 sold over ten races of eight: the desk is told, and spreading the extras gives 4 of 9 and 6 of 8', () => {
  let card = resizeCard(freshCard(), 84);
  assert.ok(!('error' in card));
  if ('error' in card) return;
  card = setSnailsPerRace(card, 8, runSheetLocks(card, noTies));
  assert.equal(describeLayout(cardLayout(card)), '10 races of 8');
  assert.equal(cardFit(card).message, '84 sold, 80 places: 4 snails have no race.');
  assert.equal(raceForSnail(81, card), 0);
  assert.equal(laneForSnail(81, card), -1);
  const fixes = fitFixes(card, runSheetLocks(card, noTies));
  const spread = fixes.find((f) => f.id === 'spread');
  assert.ok(spread);
  assert.equal(spread.label, 'Spread the extras: 4 races of 9, 6 of 8');
  assert.equal(describeLayout(cardLayout(spread.card)), '10 races: 4 of 9, 6 of 8');
  assert.equal(cardFit(spread.card).diff, 0);
  assert.deepEqual(snailsForRace(1, spread.card), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(snailsForRace(5, spread.card), [37, 38, 39, 40, 41, 42, 43, 44]);
  assert.equal(raceForSnail(84, spread.card), 10);
  /* Adding a race needs eight runners: four more snails go on sale with it. */
  const add = fixes.find((f) => f.id === 'add');
  assert.ok(add);
  assert.equal(add.label, 'Add race 11: snails 81 to 88 (4 more on sale)');
  assert.equal(add.card.snailCount, 88);
  assert.equal(cardFit(add.card).diff, 0);
  /* 84 is seven races of twelve exactly. */
  const perRace = fixes.find((f) => f.id === 'per-race');
  assert.ok(perRace);
  assert.equal(perRace.label, 'Set snails per race to 12: 7 races of 12');
  assert.equal(describeLayout(cardLayout(perRace.card)), '7 races of 12');
  assert.equal(perRace.card.snailsPerRace, 12);
  /* The extras are unsold, so they can simply come off sale. */
  const offSale = fixes.find((f) => f.id === 'off-sale');
  assert.ok(offSale);
  assert.equal(offSale.label, 'Take snails 81 to 84 off sale');
  assert.equal(offSale.card.snailCount, 80);
  /* A sold extra stays on sale: that fix is not offered, the others still are. */
  const sold = { ...card, names: card.names.slice() };
  sold.names[82] = 'Eighty Three';
  const soldFixes = fitFixes(sold, runSheetLocks(sold, noTies)).map((f) => f.id);
  assert.deepEqual(soldFixes, ['spread', 'add', 'per-race']);
});

test('fix labels read from the card they give: three races of ten before any race, one race left to take the extras', () => {
  let card = freshCard();
  const three = setRaceCount(card, 3, runSheetLocks(card, noTies));
  assert.ok(!('error' in three));
  if ('error' in three) return;
  card = three;
  const perRace = fitFixes(card, runSheetLocks(card, noTies)).find((f) => f.id === 'per-race');
  assert.ok(perRace);
  assert.equal(perRace.label, 'Set snails per race to 10: 10 races of 10');
  /* 84 sold, 8 per race, races 1 to 9 tied: only race 10 can take the four extras. */
  let tied = resizeCard(freshCard(), 84);
  assert.ok(!('error' in tied));
  if ('error' in tied) return;
  tied = setSnailsPerRace(tied, 8, runSheetLocks(tied, noTies));
  const locks = runSheetLocks(tied, { history: [], quaddieLegs: [3, 5, 7, 9], quaddieEntries: [{}] });
  const spread = fitFixes(tied, locks).find((f) => f.id === 'spread');
  assert.ok(spread);
  assert.equal(spread.label, 'Put the 4 extras in race 10 (12 runners)');
  assert.equal(spread.card.races[9].runners, 12);
  /* Twelve in the one free race is the spread fix already, so no second fix says the same thing. */
  assert.equal(fitFixes(tied, locks).find((f) => f.id === 'per-race'), undefined);
});

test('more places than snails: put the rest on sale or fit the races', () => {
  const card = resizeCard(freshCard(), 90);
  assert.ok(!('error' in card));
  if ('error' in card) return;
  assert.equal(cardFit(card).message, '90 sold, 100 places: 10 places have no snail.');
  const fixes = fitFixes(card, runSheetLocks(card, noTies));
  assert.deepEqual(fixes.map((f) => f.id), ['on-sale', 'trim']);
  assert.equal(fixes[1].label, 'Fit the races to 90 snails: 10 races of 9');
});

test('each race takes its own runner count, eight to twelve, and the numbers follow in order', () => {
  const card = freshCard();
  const locks = runSheetLocks(card, noTies);
  const edited = setRaceRunners(card, 2, 12, locks);
  assert.ok(!('error' in edited));
  if ('error' in edited) return;
  assert.deepEqual(snailsForRace(2, edited), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
  assert.deepEqual(snailsForRace(3, edited).slice(0, 2), [23, 24]);
  assert.equal(edited.races[1].custom, true);
  /* Out of range clamps. */
  const tiny = setRaceRunners(card, 1, 3, locks);
  assert.ok(!('error' in tiny) && tiny.races[0].runners === 8);
  /* The night default applies to a hand-set race too, and clears the hand setting. */
  const nine = setSnailsPerRace(edited, 9, runSheetLocks(edited, noTies));
  assert.equal(nine.races[0].runners, 9);
  assert.equal(nine.races[1].runners, 9);
  assert.equal(nine.races[1].custom, undefined);
  assert.equal(describeSnailsPerRace(edited, 9, runSheetLocks(edited, noTies)), 'Snails per race set to 9 for every race.');
  /* A race that has run, or that a ticket ties, keeps its size and is named. */
  const tied = runSheetLocks(edited, { history: [{ raceNo: 1 }], toteSales: [{ raceNo: 3 }] });
  const partly = setSnailsPerRace(edited, 9, tied);
  assert.deepEqual(partly.races.map((r) => r.runners), [10, 12, 10, 9, 9, 9, 9, 9, 9, 9]);
  assert.equal(describeSnailsPerRace(edited, 9, tied), 'Snails per race set to 9 for races 4 to 10. Races 1 to 3 keep their sizes.');
  /* Putting a hand-set race back to the night default clears the badge. */
  const back = setRaceRunners(edited, 2, edited.snailsPerRace, locks);
  assert.ok(!('error' in back) && back.races[1].custom === false);
});

test('the reasons under the run sheet read one line per cause', () => {
  const card = freshCard();
  const locks = runSheetLocks(card, { history: [], toteSales: [{ raceNo: 1 }], quaddieLegs: [3, 5, 7, 9], quaddieEntries: [{}] });
  assert.deepEqual(lockReasons(card, locks), ['Races 1 to 9 keep their sizes: race 1 has tote sales; races 3, 5, 7 and 9 have quaddie tickets.']);
  /* A race that has run is marked in its own row, so it is named only when it holds earlier races. */
  const ran = runSheetLocks(card, { history: [{ raceNo: 2 }] });
  assert.deepEqual(lockReasons(card, ran), ['Race 1 keeps its size: race 2 has run.']);
  const armed = runSheetLocks(card, { history: [{ raceNo: 1 }], armedRaceNo: 3 });
  assert.deepEqual(lockReasons(card, armed), ['Race 2 keeps its size: race 3 is at the gate.']);
  assert.deepEqual(lockReasons(card, runSheetLocks(card, noTies)), []);
  const runOff = addRunOff(card, [1, 11, 21, 31, 41, 51, 61, 71]);
  assert.deepEqual(lockReasons(runOff, runSheetLocks(runOff, noTies)), ['Race 11 is a run-off and races the snails chosen for it.']);
  assert.equal(describeRaces([1, 3, 4, 5, 6, 7, 8, 9]), 'races 1 and 3 to 9');
  assert.equal(describeRaces([2, 3]), 'races 2 and 3');
  assert.equal(describeRaces([4], true), 'Race 4');
});

test('races already run are locked; a tied race locks the sizes before it, not its settings', () => {
  const card = freshCard();
  const ties = {
    history: [{ raceNo: 1 }, { raceNo: 2 }],
    toteSales: [{ raceNo: 5 }],
    quaddieLegs: [3, 5, 7, 9],
    quaddieEntries: [] as { void?: boolean }[],
    armedRaceNo: 3,
  };
  const locks = runSheetLocks(card, ties);
  assert.match(locks[0].countLock, /Already run/);
  assert.match(locks[0].settingsLock, /Already run/);
  assert.match(locks[2].settingsLock, /gate/);
  assert.match(locks[3].countLock, /Race 5 has tote sales, so the races before it keep their sizes/);
  assert.equal(locks[3].settingsLock, '');
  assert.match(locks[4].countLock, /Race 5 has tote sales: its snails are fixed/);
  assert.equal(locks[5].countLock, '');
  const blocked = setRaceRunners(card, 4, 12, locks);
  assert.ok('error' in blocked);
  const ok = setRaceSettings(card, 4, { design: 'boundary-oval', lengthMs: 7000, laps: 2, intensity: 'big', camera: 'full' }, locks);
  assert.ok(!('error' in ok) && ok.races[3].design === 'boundary-oval' && ok.races[3].laps === 2);
  /* Clearing an override goes back to the night setting. */
  if ('error' in ok) return;
  const cleared = setRaceSettings(ok, 4, { design: undefined }, locks);
  assert.ok(!('error' in cleared) && !('design' in cleared.races[3]));
  /* A quaddie ticket ties every leg. */
  const q = runSheetLocks(card, { history: [], quaddieLegs: [3, 5, 7, 9], quaddieEntries: [{}] });
  assert.match(q[8].countLock, /quaddie tickets/);
  assert.equal(q[9].countLock, '');
});

test('races tonight: add at the end, remove only an unrun, untied last race', () => {
  const card = freshCard();
  const more = setRaceCount(card, 12, runSheetLocks(card, noTies));
  assert.ok(!('error' in more) && more.races.length === 12);
  const fewer = setRaceCount(card, 8, runSheetLocks(card, noTies));
  assert.ok(!('error' in fewer) && fewer.races.length === 8);
  /* The night never shrinks below the races already run: the sheet would end on a race in the history. */
  const threeRun = runSheetLocks(card, { history: [{ raceNo: 1 }, { raceNo: 2 }, { raceNo: 3 }, { raceNo: 4, void: true }] });
  assert.equal(racesFloor(threeRun), 3);
  assert.equal(racesFloorReason(threeRun), '3 races have run.');
  const refused = setRaceCount(card, 1, threeRun);
  assert.ok('error' in refused && refused.error === '3 races have run. The night cannot have fewer than 3 races.');
  const zero = setRaceCount(card, 0, threeRun);
  assert.ok('error' in zero);
  const three = setRaceCount(card, 3, threeRun);
  assert.ok(!('error' in three) && three.races.length === 3);
  /* Once the last race has run it cannot be removed. */
  if ('error' in three) return;
  const lastRun = removeLastRace(three, runSheetLocks(three, { history: [{ raceNo: 1 }, { raceNo: 2 }, { raceNo: 3 }] }));
  assert.ok('error' in lastRun && /Race 3 has already run/.test(lastRun.error));
  const oneRun = runSheetLocks(card, { history: [{ raceNo: 1 }] });
  assert.equal(racesFloorReason(oneRun), '1 race has run.');
  assert.equal(racesFloorReason(runSheetLocks(card, { history: [{ raceNo: 1 }], armedRaceNo: 2 })), 'Race 2 is at the gate.');
  assert.equal(racesFloorReason(runSheetLocks(card, { history: [{ raceNo: 3 }] })), 'Race 3 has run.');
  const tied = removeLastRace(card, runSheetLocks(card, { history: [], auctionBids: [{ raceNo: 10 }] }));
  assert.ok('error' in tied && /auction bids/.test(tied.error));
  const added = addRace(card, 11);
  assert.deepEqual(snailsForRace(11, added), [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111]);
});

test('the race after the card: the next snails, or a run-off of chosen snails', () => {
  const card = freshCard();
  const next = nextSnailsRace(card);
  assert.ok(next);
  assert.equal(next.first, 101);
  assert.equal(next.last, 110);
  assert.equal(next.added, 10);
  assert.equal(next.card.snailCount, 110);
  assert.equal(next.card.races.length, 11);
  const runOff = addRunOff(card, [6, 18, 27, 40, 47, 60, 70, 77]);
  assert.equal(isRunOff(runOff, 11), true);
  assert.deepEqual(snailsForRace(11, runOff), [6, 18, 27, 40, 47, 60, 70, 77]);
  /* The run-off does not move any snail out of its own race. */
  assert.equal(raceForSnail(18, runOff), 2);
  assert.equal(cardFit(runOff).diff, 0);
  assert.equal(describeLayout(cardLayout(runOff)), '11 races: 10 of 10, 1 of 8');
  assert.equal(raceTitle(runOff.races[10].raceType, 11), 'Champion of champions');
  assert.equal(raceTitle('League', 3), 'Race 3');
  assert.equal(raceTitle('Final', 3), 'Final 3');
  /* Too few runners for a run-off changes nothing. */
  assert.equal(addRunOff(card, [1, 2, 3]).races.length, 10);
});

test('a card saved before the run sheet migrates to the races its split gave', () => {
  const even = normaliseCard({ snailCount: 64, names: [], owners: [] });
  assert.equal(describeLayout(cardLayout(even)), '8 races of 8');
  assert.equal(even.snailsPerRace, 8);
  const legacy = normaliseCard({ snailCount: 64, names: [], owners: [] }, true);
  assert.equal(legacy.split, 'legacy');
  assert.equal(describeLayout(cardLayout(legacy)), '7 races: 1 of 10, 6 of 9');
  assert.equal(raceForSnail(10, legacy), 1);
  /* A stored run sheet survives a round trip with its overrides. */
  const sheet = setRaceSettings(freshCard(), 3, { design: 'straight', lengthMs: 7000, raceType: 'Final' }, runSheetLocks(freshCard(), noTies));
  assert.ok(!('error' in sheet));
  if ('error' in sheet) return;
  const back = normaliseCard(JSON.parse(JSON.stringify(sheet)));
  assert.deepEqual(back.races[2], { runners: 10, design: 'straight', lengthMs: 7000, raceType: 'Final' });
  /* Junk rows and fields are dropped or clamped. */
  const junk = normaliseCard({ snailCount: 84, races: [{ runners: 40, design: 'moon', laps: 99 }, null, { runners: 8, field: [1, 2] }] });
  assert.deepEqual(junk.races, [{ runners: 12 }, { runners: 8 }]);
});

test('a long snail name survives in full up to forty-eight characters', () => {
  const long = 'Sir Slimes-a-Lot of Newcomb and District';
  assert.equal(long.length, 40);
  const card = normaliseCard({ snailCount: 10, names: [long, `${long} the Second`, 'Speedy Gonzales the Third of Geelong West'] });
  assert.equal(card.names[0], long);
  assert.equal(card.names[1], `${long} the`);
  assert.equal(card.names[2], 'Speedy Gonzales the Third of Geelong West');
  const paste = parseRosterPaste(`1, ${long}, Priya`);
  assert.equal(paste.rows[0].name, long);
});

test('no race is added after the card past the most snails a card can sell', () => {
  let card = freshCard();
  const full = resizeCard(card, MAX_SNAILS_ON_CARD);
  assert.ok(!('error' in full));
  card = full;
  for (let i = 0; i < 9; i++) card = addRace(card, 10);
  /* 190 places: one more race of ten fits exactly. */
  const last = nextSnailsRace(card);
  assert.ok(last);
  assert.equal(last.last, MAX_SNAILS_ON_CARD);
  assert.ok(last.card.snailCount <= MAX_SNAILS_ON_CARD);
  /* 200 places: nothing fits. */
  assert.equal(nextSnailsRace(last.card), null);
  /* 196 places: four numbers left is no field. */
  let nearly = full;
  for (let i = 0; i < 8; i++) nearly = addRace(nearly, 12);
  assert.equal(nextSnailsRace(nearly), null);
});
