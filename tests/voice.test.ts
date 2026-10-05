import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { RECORDED_CUES, recordedCueFor } from '../lib/audio/voice-cues';
import { selectVoice, setVoiceEnabled, say, silence } from '../lib/audio/voice';

class MockAudio {
  static clips: MockAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  volume = 1;
  paused = true;
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

test('one caller owns audio; cancelled callbacks cannot unlock a newer line', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: MockAudio });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: { getItem: () => null, setItem: () => {} },
    speechSynthesis: { cancel() {}, getVoices: () => [] },
  } });
  try {
    selectVoice('recorded'); setVoiceEnabled(true);
    assert.equal(say('Start', 'big', 'start'), true);
    const first = MockAudio.clips.at(-1)!;
    assert.equal(say('Ordinary chatter', 'call', 'mid'), false);
    assert.equal(say('Event', 'big', 'lettuce'), false);
    assert.equal(MockAudio.clips.length, 1);
    assert.equal(say('Winner', 'finish', 'winner'), true);
    assert.equal(first.paused, true);
    first.onended?.();
    assert.equal(say('Stale ordinary chatter', 'call', 'mid'), false);
    assert.equal(MockAudio.clips.length, 2);
    const winner = MockAudio.clips.at(-1)!;
    setVoiceEnabled(false);
    assert.equal(winner.paused, true);
    winner.onended?.();
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(MockAudio.clips.length, 2);
    assert.equal(say('Muted', 'finish', 'winner'), false);
    setVoiceEnabled(true);
    assert.equal(say('Fresh start', 'big', 'start'), true);
    assert.equal(say('Duplicate queued start', 'big', 'start'), false);
    MockAudio.clips.at(-1)!.onended?.();
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(say('Next event after a dropped duplicate', 'big', 'lettuce'), true);
    setVoiceEnabled(false);
  } finally {
    silence();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (originalAudio) Object.defineProperty(globalThis, 'Audio', originalAudio); else Reflect.deleteProperty(globalThis, 'Audio');
  }
});
