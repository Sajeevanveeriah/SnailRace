import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * A minimal WebAudio double. It records every scheduled gain event so the
 * tests can assert what the music bus was told to do, which is what the room
 * hears, and counts the sources each bar starts so the voice budget is a
 * tested number rather than a comment. Only the surface the engine and the
 * music module touch is modelled.
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
class FakeSource extends FakeNode {
  startedAt = -1;
  type = 'sine';
  frequency = new FakeParam(); detune = new FakeParam();
  buffer: unknown = null; loop = false;
  start(at = 0) { this.startedAt = at; }
  stop() { /* nothing to release */ }
}
class FakeFilter extends FakeNode { type = 'lowpass'; frequency = new FakeParam(); Q = new FakeParam(); }
class FakePanner extends FakeNode { pan = new FakeParam(0); }
class FakeDelay extends FakeNode { delayTime = new FakeParam(0); }
class FakeConvolver extends FakeNode { buffer: FakeBuffer | null = null; }
class FakeBuffer {
  channels: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(ch: number) { return this.channels[ch]; }
}
class FakeContext {
  currentTime = 10;
  state = 'running';
  destination = new FakeNode();
  sampleRate = 48_000;
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  convolvers: FakeConvolver[] = [];
  delays: FakeDelay[] = [];
  panners = 0;
  createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
  createDynamicsCompressor() { return new FakeCompressor(); }
  createOscillator() { const s = new FakeSource(); this.sources.push(s); return s; }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s; }
  createBiquadFilter() { return new FakeFilter(); }
  createStereoPanner() { this.panners += 1; return new FakePanner(); }
  createDelay() { const d = new FakeDelay(); this.delays.push(d); return d; }
  createConvolver() { const c = new FakeConvolver(); this.convolvers.push(c); return c; }
  createBuffer(channels: number, length: number, rate: number) { return new FakeBuffer(channels, length, rate); }
  resume() { return Promise.resolve(); }
}

/*
 * One double for the whole file. The engine builds its graph once per module
 * and node caches the module across `import()` calls, so every test sees the
 * same context - which is also how the browser sees it.
 */
const context = new FakeContext();
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    AudioContext: function () { return context; },
    /* The sequencer must never be timed by this; the tests fire bars by hand. */
    setTimeout: () => 1,
    clearTimeout: () => undefined,
  },
});

async function withFakeAudio(run: (context: FakeContext) => Promise<void>) {
  await run(context);
}

const dB = (ratio: number) => 20 * Math.log10(ratio);

test('the caller ducks the music to the 40 percent floor: in over 150 ms, held, out over 600 ms', async () => {
  await withFakeAudio(async (context) => {
    const engine = await import('../lib/audio/engine');
    const music = await import('../lib/audio/music');
    assert.ok(engine.primeAudio());
    engine.setLevels({ music: 0.72 });
    const bus = engine.busNode('music') as unknown as FakeGain;
    const level = 0.72;
    assert.equal(engine.musicBusTarget(), level);
    assert.ok(engine.musicLimited(), 'the music is limited ahead of its duck stage, so a duck is heard');

    const voice = { attack: music.VOICE_DUCK_ATTACK, release: music.VOICE_DUCK_RELEASE };
    assert.ok(Math.abs(music.VOICE_DUCK - 0.4) < 0.01, `voice duck is ${dB(music.VOICE_DUCK).toFixed(1)} dB`);
    assert.equal(music.DUCK_FLOOR, 0.4);
    assert.equal(music.VOICE_DUCK_ATTACK, 0.15);
    assert.equal(music.VOICE_DUCK_RELEASE, 0.6);

    context.currentTime = 10;
    music.duck(3, music.VOICE_DUCK, 'voice', voice);
    const after = bus.gain.events.slice(bus.gain.events.findLastIndex((e) => e.op === 'cancel') + 1);
    assert.deepEqual(after.map((e) => e.op), ['set', 'linear', 'set', 'linear']);
    assert.ok(Math.abs(after[1].value! - level * music.VOICE_DUCK) < 1e-9, 'down to the voice depth');
    assert.ok(Math.abs(after[1].at - 10.15) < 1e-9, 'in over 150 ms');
    assert.ok(Math.abs(after[2].value! - level * music.VOICE_DUCK) < 1e-9 && after[2].at === 13, 'held for the whole line');
    assert.ok(Math.abs(after[3].value! - level) < 1e-9 && Math.abs(after[3].at - 13.6) < 1e-9, 'back over 600 ms');

    /* A short shallow effect duck lands under the line: the line's duck holds its depth and length. */
    bus.gain.value = 0.3;
    context.currentTime = 11;
    music.duck(1, 0.6);
    const second = bus.gain.events.slice(bus.gain.events.findLastIndex((e) => e.op === 'cancel') + 1);
    assert.ok(Math.abs(second[1].value! - level * music.VOICE_DUCK) < 1e-9, 'the deeper duck in progress keeps its depth');
    assert.equal(second.at(-1)!.value, level, 'and the music still comes all the way back');
    assert.ok(Math.abs(second.at(-1)!.at - 13.6) < 1e-9, 'when the line is done');
    assert.equal(music.activeDucks().length, 2);

    /* A longer shallow duck outlives the line: deep, then shallow, then back. */
    context.currentTime = 12;
    music.duck(4, 0.6, 'effect');
    const third = bus.gain.events.slice(bus.gain.events.findLastIndex((e) => e.op === 'cancel') + 1);
    const levels = third.filter((e) => e.op === 'linear').map((e) => Number((e.value! / level).toFixed(3)));
    assert.deepEqual(levels, [Number(music.VOICE_DUCK.toFixed(3)), 0.6, 1]);

    /* Nobody can duck the music away altogether. */
    context.currentTime = 30;
    music.duck(1, 0.01);
    const floor = bus.gain.events.filter((e) => e.op === 'linear').at(-2)!;
    assert.ok(Math.abs(floor.value! - level * music.DUCK_FLOOR) < 1e-9);
    assert.ok(dB(music.DUCK_FLOOR) > -8.5 && dB(music.DUCK_FLOOR) < -7.5);

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
    engine.setLevels({ music: 0.72 });
  });
});

test('the bed is lifted about 6 dB and the output is limited short of clipping', async () => {
  await withFakeAudio(async () => {
    const engine = await import('../lib/audio/engine');
    assert.ok(Math.abs(dB(engine.MUSIC_BED_GAIN) - 6) < 0.5, `the bed is lifted ${dB(engine.MUSIC_BED_GAIN).toFixed(1)} dB`);
    assert.ok(engine.LIMITER.ratio >= 20, 'a limiter, not a gentle compressor');
    assert.ok(engine.LIMITER.threshold <= -3);
    assert.ok(engine.LIMITER.attack <= 0.005);
    assert.ok(dB(engine.OUTPUT_CEILING) <= -0.9 && dB(engine.OUTPUT_CEILING) >= -2, 'about a decibel of headroom after the limiter');
  });
});

test('the winner sting is a short synthesised celebration', async () => {
  await withFakeAudio(async (context) => {
    const engine = await import('../lib/audio/engine');
    const music = await import('../lib/audio/music');
    assert.ok(engine.primeAudio());
    context.sources.length = 0;
    music.winnerSting();
    const started = context.sources.filter((s) => s.startedAt >= 0);
    assert.ok(started.length >= 8, `only ${started.length} voices`);
    const latest = Math.max(...started.map((s) => s.startedAt - context.currentTime));
    assert.ok(latest < 0.6, 'every note starts inside the first 0.6 s');
  });
});

test('the effects return is built once and comes back into the music bus', async () => {
  await withFakeAudio(async (context) => {
    const engine = await import('../lib/audio/engine');
    assert.ok(engine.primeAudio());
    assert.ok(engine.fxAvailable());
    assert.equal(context.convolvers.length, 1, 'one convolver for the whole soundtrack');
    assert.equal(context.delays.length, 1, 'one delay for the whole soundtrack');
    const impulse = context.convolvers[0].buffer;
    assert.ok(impulse);
    assert.equal(impulse.numberOfChannels, 2, 'a stereo room');
    assert.equal(impulse.length, Math.floor(48_000 * engine.FX_IMPULSE_SECONDS));
    const tail = impulse.getChannelData(0);
    assert.ok(Math.abs(tail[0]) > Math.abs(tail[tail.length - 1]) || tail[0] === 0, 'the room decays');
    const wet = engine.fxLevels();
    assert.ok(wet.reverb >= 0.18 && wet.reverb <= 0.25, `reverb return ${wet.reverb} is a touch of room, not a cathedral`);
    assert.ok(wet.delay > 0 && wet.delay <= 0.25);
  });
});

test('the race track is a 128 BPM four-chord theme that builds in four sections', async () => {
  await withFakeAudio(async (context) => {
    const engine = await import('../lib/audio/engine');
    const music = await import('../lib/audio/music');
    assert.ok(engine.primeAudio());

    assert.equal(music.RACE_BPM, 128);
    assert.deepEqual(music.RACE_CHORDS.map((c) => c.name), ['Am', 'F', 'C', 'G'], 'i VI III VII in A minor');
    assert.deepEqual(music.LOBBY_CHORDS.map((c) => c.name), ['Am7', 'Fmaj7', 'Dm7', 'G7']);
    assert.ok(music.LOBBY_BPM >= 96 && music.LOBBY_BPM <= 100);
    assert.ok(music.SWING >= 0.55 && music.SWING <= 0.6, 'off-beat sixteenths are pushed late');

    assert.equal(music.sectionFor(0), 'intro');
    assert.equal(music.sectionFor(0.3), 'groove');
    assert.equal(music.sectionFor(0.6), 'drive');
    assert.equal(music.sectionFor(0.9), 'run-home');

    /* Each section adds voices and none of them blows the per-step budget. */
    const countBar = (intensity: number): number => {
      music.stopTrack(0);
      context.sources.length = 0;
      music.startTrack('race', { intensity });
      const started = context.sources.filter((s) => s.startedAt >= 0).length;
      music.stopTrack(0);
      return started;
    };
    const intro = countBar(0);
    const groove = countBar(0.3);
    const drive = countBar(0.6);
    const home = countBar(0.95);
    assert.ok(intro > 0 && groove > intro && drive > groove && home > drive, `sections build: ${[intro, groove, drive, home]}`);

    /* The delay follows the track's tempo: a dotted eighth at 128. */
    music.startTrack('race', { intensity: 0 });
    const delayEvents = context.delays[0].delayTime.events;
    assert.ok(Math.abs((delayEvents.at(-1)?.value ?? 0) - (60 / 128) * 0.75) < 1e-9);
    music.stopTrack(0);
    assert.ok(context.panners > 0, 'voices are spread across the stereo field');
  });
});

test('no step of any bar starts more voices than the budget allows', async () => {
  await withFakeAudio(async (context) => {
    const engine = await import('../lib/audio/engine');
    const music = await import('../lib/audio/music');
    assert.ok(engine.primeAudio());

    const stepLength = (bpm: number) => 60 / bpm / 4;
    const check = (id: 'lobby' | 'race' | 'winner', intensity: number, bpm: number) => {
      context.sources.length = 0;
      music.startTrack(id, { intensity });
      /* Oscillators of one voice share a start time; bucket by step and count
         distinct starts, the way the sequencer counts voices. */
      const perStep = new Map<number, number>();
      for (const s of context.sources) {
        if (s.startedAt < 0) continue;
        const step = Math.floor((s.startedAt - context.currentTime - 0.08) / stepLength(bpm) + 1e-6);
        perStep.set(step, (perStep.get(step) ?? 0) + 1);
      }
      music.stopTrack(0);
      /* A unison voice is two oscillators and a tremolo voice carries an LFO;
         allow for both on top of the sixteen-voice budget. */
      const most = Math.max(...perStep.values());
      assert.ok(most <= music.MAX_VOICES_PER_STEP * 2, `${id} step started ${most} sources`);
      assert.ok(perStep.size > 0);
    };
    check('race', 1, music.RACE_BPM);
    check('lobby', 0, music.LOBBY_BPM);
    check('winner', 0, music.WINNER_BPM);
  });
});

test('a call ducks the effects bus with the music, and the winner stings ride over it', async () => {
  await withFakeAudio(async (context) => {
    const engine = await import('../lib/audio/engine');
    const music = await import('../lib/audio/music');
    assert.ok(engine.primeAudio());
    const sfx = engine.busNode('sfx') as unknown as FakeGain;
    context.currentTime = 50;
    const before = sfx.gain.events.length;
    music.duck(2.5, music.VOICE_DUCK, 'voice', { attack: music.VOICE_DUCK_ATTACK, release: music.VOICE_DUCK_RELEASE });
    const after = sfx.gain.events.slice(before);
    const linear = after.filter((e) => e.op === 'linear');
    assert.ok(Math.abs(linear[0].value! - engine.sfxBusTarget() * music.VOICE_DUCK) < 1e-9, 'a sting under a call is ducked with the music');
    assert.equal(linear.at(-1)!.value, engine.sfxBusTarget());
    assert.ok(Math.abs(linear.at(-1)!.at - 53.1) < 1e-9, 'and comes back when the line is done');
    /* An effect duck leaves the effects bus alone. */
    const mid = sfx.gain.events.length;
    music.duck(1, 0.6);
    assert.equal(sfx.gain.events.length, mid);
    /* The winner stings take the clear path, so the winner call cannot swallow them. */
    context.sources.length = 0;
    music.revealSting();
    const started = context.sources.filter((s) => s.startedAt >= 0);
    assert.ok(started.length >= 8, `only ${started.length} voices in the reveal sting`);
    assert.ok(Math.max(...started.map((s) => s.startedAt - context.currentTime)) < 0.6);
  });
});

test('the winner fanfare hands over to a quiet lobby bed, not to silence', async () => {
  await withFakeAudio(async (context) => {
    const engine = await import('../lib/audio/engine');
    const music = await import('../lib/audio/music');
    assert.ok(engine.primeAudio());
    music.stopTrack(0);
    music.startTrack('winner');
    assert.equal(music.currentTrack(), 'winner');
    /* The test window never fires the sequencer's timer: drive the bars by hand. */
    for (let bar = 0; bar < 3; bar++) {
      context.currentTime += 2;
      music.advanceBar();
    }
    assert.equal(music.currentTrack(), 'lobby', 'the bed follows the fanfare');
    assert.equal(music.currentLevel(), music.BED_LEVEL);
    assert.ok(music.BED_LEVEL >= 0.5 && music.BED_LEVEL < 1);
    /* The racecard brings the lobby back to full. */
    music.startTrack('lobby');
    assert.equal(music.currentLevel(), 1);
    music.stopTrack(0);
  });
});
