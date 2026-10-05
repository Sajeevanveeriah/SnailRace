import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * A minimal WebAudio double. It records every scheduled gain event so the
 * tests can assert what the music bus was told to do, which is what the room
 * hears. Only the surface the engine and the music module touch is modelled.
 */
class FakeParam {
  value: number;
  events: Array<{ op: string; value?: number; at: number }> = [];
  constructor(value = 1) { this.value = value; }
  setValueAtTime(value: number, at: number) { this.value = value; this.events.push({ op: 'set', value, at }); return this; }
  linearRampToValueAtTime(value: number, at: number) { this.events.push({ op: 'linear', value, at }); return this; }
  exponentialRampToValueAtTime(value: number, at: number) { this.events.push({ op: 'exp', value, at }); return this; }
  setTargetAtTime(value: number, at: number) { this.events.push({ op: 'target', value, at }); return this; }
  cancelScheduledValues(at: number) { this.events.push({ op: 'cancel', at }); return this; }
}
class FakeNode {
  connect() { return this; }
}
class FakeGain extends FakeNode { gain = new FakeParam(1); }
class FakeCompressor extends FakeNode {
  threshold = new FakeParam(); knee = new FakeParam(); ratio = new FakeParam();
  attack = new FakeParam(); release = new FakeParam();
}
class FakeContext {
  currentTime = 10;
  state = 'running';
  destination = new FakeNode();
  sampleRate = 48_000;
  gains: FakeGain[] = [];
  createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
  createDynamicsCompressor() { return new FakeCompressor(); }
  resume() { return Promise.resolve(); }
}

test('overlapping ducks always recover the music to its nominal level', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const context = new FakeContext();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { AudioContext: function () { return context; } },
  });
  try {
    const engine = await import('../lib/audio/engine');
    const music = await import('../lib/audio/music');
    assert.ok(engine.primeAudio());
    engine.setLevels({ music: 0.72 });
    /* Buses are created in the order music, sfx, crowd after the master. */
    const bus = context.gains[1];
    assert.equal(engine.musicBusTarget(), 0.72);

    music.duck(6, 0.2);
    const first = bus.gain.events.filter((e) => e.op === 'linear');
    assert.equal(first.at(-1)?.value, 0.72, 'first duck restores the nominal level');

    /* Simulate the bus mid-recovery when the next duck lands. */
    bus.gain.value = 0.3;
    context.currentTime = 12;
    music.duck(1.2, 0.5);
    const second = bus.gain.events.filter((e) => e.op === 'linear').slice(-2);
    assert.equal(second[0].value, 0.36, 'the dip is measured from the nominal level');
    assert.equal(second[1].value, 0.72, 'a second duck still restores the nominal level');

    /* Music switched off: nothing to duck, and nothing to restore to. */
    engine.setMusicEnabled(false);
    const before = bus.gain.events.length;
    music.duck(1, 0.5);
    assert.equal(bus.gain.events.length, before, 'a silent bus is left alone');
    engine.setMusicEnabled(true);

    /* A slider move cancels any pending duck ramp instead of being undone by it. */
    music.duck(6, 0.2);
    engine.setLevels({ music: 0.4 });
    const tail = bus.gain.events.slice(-3).map((e) => e.op);
    assert.deepEqual(tail, ['cancel', 'set', 'target']);
    assert.equal(bus.gain.events.at(-1)?.value, 0.4);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
