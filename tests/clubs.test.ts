import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ClubProfile } from '../clubs/types';
import { RACE_COURSES } from '../lib/courses';

/* Every club folder must build: its profile is complete and every file it names is in its assets. */
const ids = readdirSync('clubs').filter((d) => statSync(join('clubs', d)).isDirectory() && existsSync(join('clubs', d, 'club.ts')));
const HEX = /^#[0-9a-f]{6}$/i;
const designs = new Set<string>(['straight', ...RACE_COURSES.map((c) => c.id)]);

test('the clubs folder holds NDCC and the template', () => {
  assert.ok(ids.includes('ndcc'));
  assert.ok(ids.includes('template'));
});

for (const id of ids) {
  test(`club profile "${id}" is complete and its files are present`, async () => {
    const club = ((await import(`../clubs/${id}/club`)) as { default: ClubProfile }).default;
    assert.equal(club.id, id, 'the id matches the folder');
    assert.ok(club.name.trim() && club.shortName.trim() && club.place.trim());
    assert.ok(HEX.test(club.colours.primary) && HEX.test(club.colours.accent), 'colours are #rrggbb');
    for (const c of [club.colours.secondary, club.colours.highlight]) if (c) assert.ok(HEX.test(c));
    const asset = (file: string) => assert.ok(existsSync(join('clubs', id, 'assets', file)), `clubs/${id}/assets/${file}`);
    for (const image of [club.crest, club.poster, club.shareImage]) {
      if (!image) continue;
      asset(image.file);
      assert.ok(image.width > 0 && image.height > 0);
    }
    for (const s of club.sponsors) asset(s.file);
    for (const p of club.clubTeamPatterns ?? []) assert.doesNotThrow(() => new RegExp(p, 'i'));
    assert.ok(!club.event.date || /^\d{4}-\d{2}-\d{2}$/.test(club.event.date));
    assert.ok(/^\d{2}:\d{2}$/.test(club.event.startTime));
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en-AU', { timeZone: club.event.timezone }));
    const night = club.night;
    if (!night) return;
    const races = Math.ceil(night.snails / night.runnersPerRace);
    assert.equal(night.racePlan.length, races, 'one run-sheet row per race');
    for (const row of night.racePlan) if (row.design) assert.ok(designs.has(row.design), row.design);
    const numbers = new Set<number>();
    for (const [n] of night.roster) {
      assert.ok(n >= 1 && n <= night.snails && !numbers.has(n), `snail ${n}`);
      numbers.add(n);
    }
    assert.ok(!JSON.stringify(night.roster).match(/@|\d{8,}/), 'no email addresses or phone numbers in the roster');
    const names = new Set(club.sponsors.map((s) => s.name));
    for (const s of night.raceSponsors) {
      assert.ok(s.race >= 1 && s.race <= races);
      if (s.logo && s.logo !== 'none') assert.ok(names.has(s.logo), `race ${s.race} logo ${s.logo} is a listed sponsor`);
    }
  });
}
