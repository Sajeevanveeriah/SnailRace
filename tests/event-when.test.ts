import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventWhen } from '../lib/event-when';
import { freshState } from '../lib/event-store';
import { tickerItems } from '../lib/broadcast-ticker';

test('the night reads the way the poster says it', () => {
  assert.equal(
    eventWhen({ eventDate: '2026-10-24', startTime: '19:00', venue: 'Club rooms' }),
    'Saturday 24 October · from 7 pm · Club rooms',
  );
  assert.equal(eventWhen({ eventDate: '2026-10-24', startTime: '18:30' }), 'Saturday 24 October · from 6:30 pm');
  assert.equal(eventWhen({ venue: ' Grinter Reserve ' }), 'Grinter Reserve');
  assert.equal(eventWhen({ eventDate: 'not a date', startTime: '7pm' }), '');
});

test('a fresh night carries the October 2026 event as advertised', () => {
  const s = freshState();
  assert.equal(s.eventName, 'Snail Racing');
  assert.equal(s.eventTagline, 'A night at the races');
  assert.equal(eventWhen(s), 'Saturday 24 October · from 7 pm · Club rooms');
  assert.equal(s.backingCents, 400);
  const items = tickerItems({
    clubName: s.clubName, eventName: s.eventName, raceNo: 1, plannedRaces: s.plannedRaces,
    courseName: 'Boundary Oval', laps: 3, names: [], nightCents: 0, standings: [],
    when: eventWhen(s), backingCents: s.backingCents,
  });
  assert.ok(items.includes('Saturday 24 October · from 7 pm · Club rooms'));
  assert.ok(items.includes('Back your snail for $4 - a gift to the club - and cheer it home'));
});
