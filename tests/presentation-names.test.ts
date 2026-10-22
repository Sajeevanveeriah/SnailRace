import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardInnerWidthU, fitField, fitName, isDefaultName, lineEm, nameSteps, nameWords, numberLine, textEm, winnerOwnerLine, wrappedLines } from '../lib/presentation/names';
import { cardColumn, gridPlacement } from '../lib/presentation/field-grid';

const AUDIT_NAMES = [
  'Speedy Gonzales the Third of Geelong West',
  "Nan's Favourite",
  'Sir Slimes-a-Lot of Newcomb',
  'Gary',
  'The Honourable Member for Slime Hill East',
  'Turbo',
  'Escargot Faster',
  'Slime Lord',
  'Mucus Bolt',
  'Usain Slow',
  'Snaily McSnailface',
  'Lightning McSlime',
];
const AUDIT_OWNERS = ['Priya', 'Lisa', 'Ben', 'Mel & Dave', 'The Thompson Family', 'Under 12s', 'Jono', 'Aunty Sue', 'Raj', 'Coach', 'Priya', 'Lisa'];

test('glyph widths match what the projector set: a line that fit measures under 8 em, one that wrapped over', () => {
  assert.ok(textEm('Slime Hill East') < 8, String(textEm('Slime Hill East')));
  assert.ok(textEm('Member for Slime') > 8, String(textEm('Member for Slime')));
  assert.ok(Math.abs(lineEm(12.8, 1.6) - 8) < 0.01);
});

test('greedy wrap counts lines by whole words', () => {
  assert.equal(wrappedLines('Gary', 5), 1);
  assert.equal(wrappedLines('Slime Lord', 6), 1);
  assert.equal(wrappedLines('Slime Lord', 4), 2);
  assert.equal(wrappedLines('The Honourable Member for Slime Hill East', 8.4), 3);
  assert.equal(wrappedLines('The Honourable Member for Slime Hill East', 7), 5);
  assert.equal(wrappedLines('', 10), 1);
});

test('a name takes the largest size that fits two lines, else the smallest size and more lines', () => {
  const four = cardInnerWidthU(4);
  assert.equal(fitName('Gary', four, nameSteps(4)).step.className, '');
  assert.equal(fitName('Sir Slimes-a-Lot of Newcomb', four, nameSteps(4)).lines, 2);
  const long = fitName('Speedy Gonzales the Third of Geelong West', four, nameSteps(4));
  assert.equal(long.step.className, 'ss-long');
  assert.equal(long.lines, 2);
  /* Six across, a 41-character name cannot fit two lines above the 1.6u floor: it takes the floor and the lines it needs. */
  const narrow = fitName('The Honourable Member for Slime Hill East', cardInnerWidthU(6), nameSteps(6));
  assert.equal(narrow.step.size, 1.6);
  assert.equal(narrow.lines, 3);
  assert.equal(narrow.breakWord, false);
  assert.equal(fitName('Speedy Gonzales the Third of Geelong West', cardInnerWidthU(6), nameSteps(6)).lines, 4);
});

test('a single word wider than the card is the only thing allowed to break mid-word', () => {
  const fit = fitName('Snailasaurusrexxxxxxxxxxxx', cardInnerWidthU(6), nameSteps(6));
  assert.equal(fit.breakWord, true);
  assert.equal(fit.step.size, 1.6);
  const field = fitField(['Snailasaurusrexxxxxxxxxxxx', 'Gary'], ['', ''], 6, cardInnerWidthU(6));
  assert.match(field.nameClass[0], /ss-break/);
  assert.equal(field.nameClass[1], '');
});

test('every card in a grid gets the same name and owner box, sized for the longest', () => {
  /* Two lines of the base size, plus descender room, whatever the names. */
  const four = fitField(AUDIT_NAMES.slice(0, 8), AUDIT_OWNERS.slice(0, 8), 4, cardInnerWidthU(4));
  assert.equal(four.nameBoxU, 4.99);
  assert.equal(four.ownerBoxU, 2.08);
  assert.deepEqual(four.nameClass, ['ss-long', '', '', '', 'ss-xlong', '', '', '']);
  const plain = fitField(['Snail 1', 'Snail 2'], ['', ''], 4, cardInnerWidthU(4));
  assert.deepEqual([plain.nameBoxU, plain.ownerBoxU], [4.99, 2.08]);
  /* Twelve across two rows: the box grows for the four-line name and every card shares it. */
  const six = fitField(AUDIT_NAMES, AUDIT_OWNERS, 6, cardInnerWidthU(6));
  assert.equal(six.nameBoxU, 7.26);
  assert.equal(six.ownerBoxU, 3.81);
  assert.equal(six.nameClass.length, 12);
  assert.equal(six.nameClass[3], '');
  assert.equal(six.nameClass.filter((c) => c.includes('ss-xlong')).length, 3);
});

test('card widths: body padding and gaps shared across the columns, or a fixed card', () => {
  assert.ok(Math.abs(cardInnerWidthU(4) - 21.3) < 0.1);
  assert.ok(Math.abs(cardInnerWidthU(6) - 13.35) < 0.1);
  assert.equal(cardInnerWidthU(2, { cardPadU: 2, fixedU: 24 }), 22);
});

test('the default name is "Snail n" for that number only', () => {
  assert.equal(isDefaultName('Snail 2', 2), true);
  assert.equal(isDefaultName(' Snail 2 ', 2), true);
  assert.equal(isDefaultName('Snail 2', 12), false);
  assert.equal(isDefaultName('Gary', 2), false);
});

test('an unnamed snail is named once: "Snail 2", not "Snail 2 / No. 2"', () => {
  assert.equal(numberLine('Snail 2', 2, '', 'owned by '), '');
  assert.equal(numberLine('Snail 2', 2, 'Lisa', 'owned by '), 'owned by Lisa');
  assert.equal(numberLine('Gary', 4, 'Mel & Dave', 'owned by '), 'Snail 4 · owned by Mel & Dave');
  assert.equal(numberLine('Gary', 4, '  '), 'Snail 4');
  assert.equal(winnerOwnerLine('Snail 5', 5, ''), '');
  assert.equal(winnerOwnerLine('Snail 5', 5, 'Ben'), 'Ben');
  assert.equal(winnerOwnerLine('Kev', 23, 'Ben'), 'No. 23 · Ben');
});

test('hyphenated words are one unbreakable piece; plain words and dashes alone are not', () => {
  assert.deepEqual(nameWords('Sir Slimes-a-Lot of Newcomb'), [
    { text: 'Sir', nobreak: false },
    { text: 'Slimes-a-Lot', nobreak: true },
    { text: 'of', nobreak: false },
    { text: 'Newcomb', nobreak: false },
  ]);
  assert.deepEqual(nameWords('Ms Pac-Snail 2').map((w) => w.nobreak), [false, true, false]);
  assert.deepEqual(nameWords('  Gary  '), [{ text: 'Gary', nobreak: false }]);
  assert.deepEqual(nameWords('Kev - the snail').map((w) => w.nobreak), [false, false, false, false]);
});

test('a short last row starts a track in so it sits centred', () => {
  const nine = gridPlacement(9, 5);
  assert.deepEqual(nine, { tracks: 10, lastRowStart: 2, lastRowFirst: 5 });
  assert.equal(cardColumn(5, nine), '2 / span 2');
  assert.equal(cardColumn(4, nine), undefined);
  const eleven = gridPlacement(11, 6);
  assert.deepEqual(eleven, { tracks: 12, lastRowStart: 2, lastRowFirst: 6 });
  const seven = gridPlacement(7, 4);
  assert.equal(seven.lastRowStart, 2);
  assert.equal(seven.lastRowFirst, 4);
  /* Full rows, or a single row, need no offset. */
  assert.equal(gridPlacement(8, 4).lastRowStart, null);
  assert.equal(gridPlacement(3, 4).lastRowStart, null);
  assert.equal(gridPlacement(12, 6).lastRowStart, null);
  assert.equal(gridPlacement(0, 4).lastRowStart, null);
});
