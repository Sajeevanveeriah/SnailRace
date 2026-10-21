import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTION_MAX,
  RETIREMENT_SPECS,
  RUN_HOME_BY_TRACK,
  STARTER_LINES,
  TOGETHER_SECONDS,
  WEATHER_LINES,
  callLine,
  composeTwistCaption,
  countdownLine,
  drawLockedRacePlan,
  eventLine,
  hasHomeStraight,
  lapLine,
  leadChangeLine,
  mulberry32,
  overtakeLine,
  runHomeCue,
  runHomeLine,
  shortName,
  sectorCall,
  togetherLine,
  trackWording,
  winnerLine,
  type TrackWording,
  type Weather,
} from '../lib/race-engine';
import { RECORDED_CUES, recordedCueFor } from '../lib/audio/voice-cues';

const LONG = 'Speedy Gonzales the Third of Geelong West';
const LONGER = 'Sir Slimes-a-Lot of Newcomb and District';
const WORDINGS: TrackWording[] = ['straight', 'oval', 'chicane', 'eight', 'switchback'];

/** Every call the caller can make, filled with the longest names on a card. */
function everyCaption(a: string, b: string): string[] {
  const lines: string[] = [];
  for (let i = 0; i < 12; i++) {
    const rnd = mulberry32(i + 1);
    for (const leadP of [0.05, 0.2, 0.5, 0.8, 0.9]) {
      for (const [gapLengths, gapSeconds] of [[0.1, 0.1], [1.2, 0.9], [5, 3]]) {
        lines.push(callLine({ leadP, lead: a, chase: b, third: a, tail: b, gapLengths, toGoLengths: 30, gapSeconds }, rnd));
      }
    }
    for (const place of [2, 3, 4]) lines.push(overtakeLine(a, b, place, rnd));
    lines.push(leadChangeLine(a, b, rnd));
    for (const lap of [2, 3, 9]) lines.push(lapLine(lap, 9, a, b, rnd));
    lines.push(lapLine(2, 2, a, b, rnd));
    for (const sector of [1, 2, 3]) {
      for (const [gapLengths, gapSeconds] of [[0.1, 0.1], [1.2, 0.9], [5, 3]]) {
        lines.push(sectorCall(sector, a, b, gapLengths, gapSeconds)!.text);
      }
    }
    for (const wording of WORDINGS) lines.push(runHomeLine(wording, a, b, rnd));
    lines.push(togetherLine(a, b, rnd));
    lines.push(winnerLine(a, true), winnerLine(a, false));
    for (const weather of Object.keys(WEATHER_LINES) as Weather[]) lines.push(countdownLine(weather, rnd));
  }
  return lines;
}

test('every caption template fits a one-line strap with the longest names', () => {
  for (const line of everyCaption(LONG, LONGER)) {
    assert.ok(line.length <= CAPTION_MAX, `${line.length}: ${line}`);
    assert.doesNotMatch(line, /\{|\}/, line);
  }
  for (const line of everyCaption('Snail 54', 'Snail 12')) assert.ok(line.length <= 72, `${line.length}: ${line}`);
  /* The legacy event line, and the planned twists, retirements and reveals, all fit too. */
  for (const spec of RETIREMENT_SPECS) {
    const plan = drawLockedRacePlan(1, Array.from({ length: 8 }, () => LONG), 30_000, true, 'standard');
    assert.ok(plan.cues.every((cue) => cue.text.length <= CAPTION_MAX), spec.code);
  }
  assert.ok(eventLine({ id: 'x', lane: 0, kind: 'boost', label: 'TURBO SLIME', call: '{a} hits the turbo slime and lunges!', tone: 'good', sound: 'up', at: 0.2, span: 0.1, mag: 0.05, fired: false }, LONG).length <= CAPTION_MAX);
});

test('every lap is called by number, and the last lap is the final lap', () => {
  assert.match(lapLine(2, 4, 'Turbo', 'Rocket', () => 0), /^Lap 2 of 4, /);
  assert.match(lapLine(3, 4, 'Turbo', 'Rocket', () => 0.5), /\b3 of 4\b/);
  for (let i = 0; i < 6; i++) assert.match(lapLine(4, 4, 'Turbo', 'Rocket', () => i / 6), /^Final lap/);
  assert.match(lapLine(2, 2, 'Turbo', 'Rocket', () => 0), /^Final lap/);
  assert.equal(recordedCueFor(lapLine(2, 4, 'Turbo', 'Rocket', () => 0)), 'lap');
  assert.equal(recordedCueFor(lapLine(4, 4, 'Turbo', 'Rocket', () => 0)), 'bell');
});

test('the run home never says straight on a circuit without one before the line', () => {
  assert.equal(trackWording('lanes', 'pavilion-chicane'), 'straight');
  assert.equal(trackWording('circuit', 'boundary-oval'), 'oval');
  assert.equal(trackWording('circuit', 'pavilion-chicane'), 'chicane');
  assert.equal(trackWording('circuit', 'floodlight-eight'), 'eight');
  assert.equal(trackWording('circuit', 'practice-nets'), 'switchback');
  for (const wording of WORDINGS) {
    const lines = RUN_HOME_BY_TRACK[wording];
    if (hasHomeStraight(wording)) {
      assert.ok(lines.every((line) => /straight/.test(line)));
      assert.equal(runHomeCue(wording), 'final');
    } else {
      assert.ok(lines.every((line) => !/straight/i.test(line)), wording);
      assert.equal(runHomeCue(wording), 'finalCircuit');
      /* And the clip agrees with the strap. */
      for (const take of RECORDED_CUES.finalCircuit) assert.doesNotMatch(take, /straight/i);
    }
  }
});

test('"together" is only said when the top two are inside 0.3 seconds', () => {
  const tight = /together|side by side|blanket|nothing in it|neither giving/i;
  for (let i = 0; i < 40; i++) {
    const rnd = mulberry32(i);
    const ctx = { leadP: 0.5, lead: 'Turbo', chase: 'Rocket', third: 'Flash', tail: 'Bolt', toGoLengths: 10 };
    assert.doesNotMatch(callLine({ ...ctx, gapLengths: 0.5, gapSeconds: 0.9 }, rnd), tight);
    assert.match(callLine({ ...ctx, gapLengths: 0.2, gapSeconds: TOGETHER_SECONDS - 0.05 }, rnd), /together|side by side|blanket|nothing in it|in it between/i);
    for (const sector of [1, 2, 3]) {
      assert.doesNotMatch(sectorCall(sector, 'Turbo', 'Rocket', 1.5, 1.1)!.text, tight);
      assert.match(sectorCall(sector, 'Turbo', 'Rocket', 0.2, 0.1)!.text, /together|side by side/);
    }
  }
});

test('sector calls choose a clip that says what the strap says', () => {
  /* Locked together: the bunching takes. Clear: the daylight takes. Between: a neutral take. */
  assert.equal(sectorCall(2, 'Turbo', 'Rocket', 0.2, 0.1)!.cue, 'half');
  assert.equal(sectorCall(2, 'Turbo', 'Rocket', 4, 3)!.cue, 'clear');
  assert.equal(sectorCall(2, 'Turbo', 'Rocket', 1.5, 1)!.cue, 'mid');
  assert.equal(sectorCall(1, 'Turbo', 'Rocket', 1.5, 1)!.cue, 'early');
  const late = sectorCall(3, 'Turbo', 'Rocket', 1.5, 1)!;
  assert.equal(late.cue, 'threeQuarter');
  assert.deepEqual(late.takes, [3]);
  /* "Coming to the turn" is never said on the side-on straight. */
  const straight = sectorCall(3, 'Turbo', 'Rocket', 0.2, 0.1, 'straight')!;
  assert.ok(straight.takes && !straight.takes.includes(1));
  assert.match(RECORDED_CUES.threeQuarter[0], /turn/);
});

test('the countdown line varies and never repeats itself race to race', () => {
  const rnd = mulberry32(7);
  const seen = new Set<string>();
  let previous: string | undefined;
  for (let race = 0; race < 40; race++) {
    const weather = (['clear', 'clear', 'drizzle', 'downpour'] as Weather[])[race % 4];
    const line = countdownLine(weather, rnd, previous);
    assert.notEqual(line, previous);
    assert.ok(STARTER_LINES.some((starter) => line.startsWith(starter)), line);
    seen.add(line);
    previous = line;
  }
  assert.ok(seen.size >= 12, `only ${seen.size} different countdown lines`);
  /* The same weather, with the same random draw, still moves on from the last line. */
  const stuck = () => 0;
  assert.notEqual(countdownLine('clear', stuck, countdownLine('clear', stuck)), countdownLine('clear', stuck));
});

test('a twist caption keeps the natural line with a shortened name before the terse form', () => {
  const mower = ['The mower is on the course and {a}, {pos}, leads the escape!'];
  const line = composeTwistCaption(mower, 'RIDE-ON MOWER', { a: 'Snaily McSnailface', pos: 'in 7th' }, () => 0);
  assert.match(line, /^The mower is on the course and Snaily/);
  assert.ok(!/: ride-on mower!$/.test(line), line);
  const long = composeTwistCaption(mower, 'RIDE-ON MOWER', { a: 'Speedy Gonzales the Third of Geelong West', pos: 'in 7th' }, () => 0);
  assert.match(long, /^The mower is on the course and Speedy/);
  assert.ok(long.length <= 90, long);
});

test('a shortened name never stops on a possessive, a joining word or a bare title', () => {
  assert.equal(shortName("Nan's Favourite 3", 12), "Nan's Favourite");
  assert.equal(shortName('Speedy Gonzales the Third of Geelong West'), 'Speedy Gonzales');
  assert.equal(shortName('Sir Slimes-a-Lot of Newcomb 2', 12), 'Sir Slimes-a-Lot');
  assert.equal(shortName('The Undertaker 2', 12), 'The Undertaker');
  assert.equal(shortName('Slow Motion Steve 2', 12), 'Slow Motion');
  assert.equal(shortName('Gary', 12), 'Gary');
});
