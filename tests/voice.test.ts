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
