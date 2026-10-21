import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { RECORDED_CUES, recordedCueFor } from '../lib/audio/voice-cues';
import { CLIP_FADE_MS, SAME_CUE_GAP_MS, SAME_TAKE_WINDOW_MS, selectVoice, setVoiceEnabled, say, silence } from '../lib/audio/voice';

class MockAudio {
  static clips: MockAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  volume = 1;
  paused = true;
  duration = Number.NaN;
  currentTime = 0;
  constructor(public src: string) { MockAudio.clips.push(this); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}

test('every recorded cue ships an audio file and unsupported text stays silent', () => {
  for (const id of Object.keys(RECORDED_CUES)) assert.ok(existsSync(`public/audio/commentary/${id}.mp3`) && statSync(`public/audio/commentary/${id}.mp3`).size > 1000, id);
  assert.equal(recordedCueFor('LETTUCE BREAK'), 'lettuce');
  assert.equal(recordedCueFor('PLAGUE CLOUD'), 'plague');
  assert.equal(recordedCueFor('Turbo wins!'), 'winner');
  assert.equal(recordedCueFor('A completely unrelated sentence.'), undefined);
});

test('run-of-play lines never trigger the start or ready clips mid-race', () => {
  /* These are real lines from the commentary book that used to misfire. */
  assert.notEqual(recordedCueFor('Flash in front. Turbo is a length away and paying attention.'), 'start');
  assert.notEqual(recordedCueFor('Bolt has already decided this is a good spot for a lie down.'), 'ready');
  assert.notEqual(recordedCueFor('Comet is bogged in a soft patch and the field collapses around it.'), 'lap');
  assert.equal(recordedCueFor('And they are away!'), 'start');
  assert.equal(recordedCueFor('The field is ready. Let us get this race started.'), 'ready');
  assert.equal(recordedCueFor('Onto lap 2 - Flash by a whisker from Turbo.'), 'lap');
  assert.equal(recordedCueFor('THE BELL! Last lap, and Flash leads!'), 'bell');
});

test('the generic run-of-play pools map to truthful generic clips', () => {
  assert.equal(recordedCueFor('You could throw a blanket over Flash and Turbo!'), 'close');
  assert.equal(recordedCueFor('Flash has broken the elastic! Three lengths clear!'), 'clear');
  assert.equal(recordedCueFor('Two lengths to run and it is Flash by a nose!'), 'final');
  assert.equal(recordedCueFor('HALFWAY - Flash by a nose from Turbo.'), 'mid');
  assert.equal(recordedCueFor('Flash has made the tidy start. Turbo is keeping it honest.'), 'early');
  assert.equal(recordedCueFor('LEAD CHANGE! Turbo snatches it from Flash!'), 'lead');
  assert.equal(recordedCueFor('Turbo goes past Flash and into 2nd!'), 'overtake');
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run with a fake Audio, a fake window and a clock the test moves by hand. */
async function withVoice(run: (clock: { now: number }) => Promise<void>) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  const realNow = Date.now;
  const clock = { now: 1_000_000 };
  Date.now = () => clock.now;
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: MockAudio });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: { getItem: () => null, setItem: () => {} },
    speechSynthesis: { cancel() {}, getVoices: () => [] },
  } });
  try {
    MockAudio.clips.length = 0;
    selectVoice('recorded');
    setVoiceEnabled(true);
    await run(clock);
  } finally {
    setVoiceEnabled(false);
    silence();
    Date.now = realNow;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (originalAudio) Object.defineProperty(globalThis, 'Audio', originalAudio); else Reflect.deleteProperty(globalThis, 'Audio');
  }
}

test('one caller owns audio; cancelled callbacks cannot unlock a newer line', async () => {
  await withVoice(async (clock) => {
    assert.equal(say('Start', 'big', 'start'), true);
    const first = MockAudio.clips.at(-1)!;
    assert.equal(say('Ordinary chatter', 'call', 'mid'), false);
    assert.equal(say('Event', 'big', 'lettuce'), false);
    assert.equal(MockAudio.clips.length, 1);
    /* The winner fades the line on air rather than cutting it mid-word, then speaks. */
    assert.equal(say('Winner', 'finish', 'winner'), true);
    assert.equal(first.paused, false, 'not cut off mid-word');
    assert.equal(say('Stale ordinary chatter', 'call', 'mid'), false);
    await wait(CLIP_FADE_MS + 80);
    assert.equal(first.paused, true);
    assert.ok(first.volume < 0.05, 'faded out first');
    first.onended?.();
    assert.equal(MockAudio.clips.length, 2);
    const winner = MockAudio.clips.at(-1)!;
    assert.match(winner.src, /winner/);
    setVoiceEnabled(false);
    await wait(CLIP_FADE_MS + 80);
    assert.equal(winner.paused, true);
    winner.onended?.();
    await wait(400);
    assert.equal(MockAudio.clips.length, 2);
    assert.equal(say('Muted', 'finish', 'winner'), false);
    setVoiceEnabled(true);
    clock.now += 30_000;
    assert.equal(say('Fresh start', 'big', 'start'), true);
    assert.equal(say('Duplicate queued start', 'big', 'start'), false);
    MockAudio.clips.at(-1)!.onended?.();
    await wait(400);
    assert.equal(say('Next event after a dropped duplicate', 'big', 'lettuce'), true);
  });
});

test('the winner waits for a run-home call that is nearly done instead of fading it', async () => {
  await withVoice(async () => {
    assert.equal(say('Here they come down the straight!', 'big', 'final'), true);
    const final = MockAudio.clips.at(-1)!;
    final.duration = 3;
    final.currentTime = 2.2;
    assert.equal(say('Turbo wins!', 'finish', 'winner'), true);
    assert.equal(MockAudio.clips.length, 1, 'the winner waits');
    assert.equal(final.paused, false);
    final.onended?.();
    assert.equal(MockAudio.clips.length, 2, 'and follows the moment the call is done');
    assert.match(MockAudio.clips.at(-1)!.src, /winner/);
  });
});

test('a cue may be heard again in a different take after 8 s, the identical take only after 25 s', async () => {
  await withVoice(async (clock) => {
    const playedTakes: string[] = [];
    const play = (cue: 'mid' | 'delay', opts?: { twist?: boolean }) => {
      const before = MockAudio.clips.length;
      const ok = say('A line', 'big', cue, opts);
      if (ok && MockAudio.clips.length > before) {
        const clip = MockAudio.clips.at(-1)!;
        playedTakes.push(clip.src.split('/').at(-1)!);
        clip.onended?.();
      }
      return ok;
    };
    assert.equal(play('mid'), true);
    clock.now += SAME_CUE_GAP_MS - 1000;
    assert.equal(play('mid'), false, 'the same cue rests for 8 s');
    clock.now += 1500;
    assert.equal(play('mid'), true, 'then a different take may play');
    assert.notEqual(playedTakes[0], playedTakes[1]);
    /* Keep calling every 8 s: no take repeats inside 25 s. */
    for (let i = 0; i < 12; i++) {
      clock.now += SAME_CUE_GAP_MS + 100;
      play('mid');
    }
    const times = new Map<string, number>();
    let t = 0;
    for (const take of playedTakes) {
      const last = times.get(take);
      if (last !== undefined) assert.ok(t - last >= 3, `${take} repeated too soon`);
      times.set(take, t);
      t += 1;
    }
    /* A twist always gets its line when a take is free, even straight after the same cue. */
    clock.now += 30_000;
    assert.equal(play('delay', { twist: true }), true);
    clock.now += 4000;
    assert.equal(play('delay', { twist: true }), true, 'a second twist, a different take, four seconds later');
    assert.notEqual(playedTakes.at(-1), playedTakes.at(-2));
    assert.ok(SAME_TAKE_WINDOW_MS === 25_000);
  });
});
