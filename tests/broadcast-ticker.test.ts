import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onAirClock, splitText, tickerItems } from '../lib/broadcast-ticker';

const base = {
  clubName: 'Newcomb & District Cricket Club',
  eventName: 'Snail Racing Fundraiser',
  raceNo: 3,
  plannedRaces: 6,
  courseName: 'Boundary Oval',
  laps: 3,
  names: ['Speedy', 'Turbo', 'Flash'],
  nightCents: 0,
  standings: [],
};

test('the ticker always carries the race identity and the free-chip rule', () => {
  const items = tickerItems(base);
  assert.equal(items[0], 'SNAIL RACING FUNDRAISER · RACE 3 OF 6');
  assert.ok(items.includes('FUN CHIPS - NO MONETARY VALUE · every snail has the same chance'));
  assert.ok(items.includes('Donations are gifts to the club and never touch a race'));
  assert.equal(items.some((i) => /Raised tonight/.test(i)), false);
  assert.equal(items.some((i) => /tote|auction/i.test(i)), false);
});

test('facts appear only when the night has them, and never imply a chance', () => {
  const items = tickerItems({
    ...base,
    sponsor: ' Bay Bakery ',
    runnerSponsors: ['', 'Dave the Plumber', ''],
    nightCents: 123_450,
    goalCents: 200_000,
    standings: [
      { name: 'Flash', points: 8, races: 2, wins: 1, podiums: 2, best: 1 },
      { name: 'Turbo', points: 5, races: 2, wins: 1, podiums: 1, best: 1 },
    ],
    tote: { ticketCents: 200, poolCents: 3600, tickets: 18 },
    auction: { poolCents: 15_000, owners: 5 },
    phonePlayCode: 'KQ7M2X',
    weather: 'drizzle',
  });
  assert.ok(items.includes('Race 3 presented by Bay Bakery'));
  assert.ok(items.includes('Runner sponsors: Turbo with Dave the Plumber'));
  assert.ok(items.includes('Raised tonight for Newcomb & District Cricket Club: $1,234.50 of a $2,000 goal'));
  assert.ok(items.includes('Championship: Flash leads on 8 points, Turbo 5'));
  assert.ok(items.includes('Club cash tote: 18 tickets at $2.00, pool $36.00'));
  assert.ok(items.includes('Runner auction: 5 runners sold, pool $150.00'));
  assert.ok(items.includes('Play along on your phone with free chips - join code KQ7M2X'));
  assert.ok(items.includes('Conditions: drizzle, greasy track'));
  const prohibited = /\b(favourite|odds-on|tip|sure thing|bet|wager)\b/i;
  assert.equal(items.filter((i) => prohibited.test(i)).length, 0);
});

test('splits read like a timing graphic', () => {
  assert.equal(splitText('Flash', 'Turbo', 0.42), 'Flash leads Turbo by 0.4s');
  assert.equal(splitText('Flash', 'Turbo', 0.05), 'Flash and Turbo level');
  assert.equal(splitText('Flash', '', 1), 'Flash leads');
  assert.match(onAirClock(new Date(2026, 9, 5, 19, 7)), /^7:07 PM$/);
  assert.match(onAirClock(new Date(2026, 9, 5, 0, 30)), /^12:30 AM$/);
});
