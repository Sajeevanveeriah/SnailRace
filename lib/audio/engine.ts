'use client';

/**
 * The audio engine.
 *
 * WHY THERE ARE NO MP3s IN THIS REPO - read this before adding any.
 *
 * A club projector laptop is exactly the machine that will fail to load three
 * audio files from a flaky venue connection five minutes before the first
 * race, so every sound the app ships with is synthesised by WebAudio at the
 * moment it plays. That also settles the licensing question: music nobody
 * recorded needs no licence, which matters when the night is being projected
 * in public and possibly streamed.
 *
 * A club that wants real recordings can still have them. Drop files into
 * `public/audio/` using the names in `SAMPLE_SLOTS` and the engine prefers
 * them over the synthesised version, falling back the instant one is missing
 * or unplayable. See the README for where to find freely licensed tracks.
 *
 * Signal path, one bus per job so the moderator can ride music under
 * commentary without touching the effects:
 *
 *   sources ─┬─> musicBus ─┐
 *            ├─> sfxBus   ─┼─> masterBus ─> limiter ─> speakers
 *            └─> crowdBus ─┘
 *
 * Music voices can also tap a shared effects send - one convolver (a 1.6 s
 * generated room) and one tempo-synced feedback delay, built once and
 * returning into the music bus - so the soundtrack has air without each note
 * paying for its own reverb. See `fxSend` and `ToneOpts.send`.
 *
 * The limiter is not optional. Six synth voices, a crowd bed and a fanfare
 * can and do sum past 0 dBFS, and a projector's built-in speaker turns that
 * into a crackle that sounds like broken equipment rather than a loud room.
 */

export type Bus = 'music' | 'sfx' | 'crowd';

export interface AudioLevels {
  master: number;
  music: number;
  sfx: number;
  crowd: number;
}

/*
 * Loud by default.
 *
 * These started conservative and the result was a stage nobody could hear
 * over a function room. The limiter below the master is what makes this safe:
 * it is doing the job that timid gain staging was doing badly.
 */
export const DEFAULT_LEVELS: AudioLevels = {
  master: 1,
  music: 0.72,
  sfx: 1,
  /*
   * The room, at full. The crowd bus carries the ambience bed as well as the
   * reactions, and at 0.7 under a 0.62 soundtrack the hall was the quietest
   * thing in a mix that is supposed to be set in one - which is how a stage
   * with a continuous crowd bed gets reported as having no crowd at all.
   */
  crowd: 1,
};

/**
 * Files the engine will use in place of a synthesised cue if they exist.
 *
 * Anything here is optional. The key is the slot the app asks for; the value
 * is the basename looked for under `public/audio/`, with the extensions in
 * `EXTENSIONS` tried in order.
 */
export const SAMPLE_SLOTS = {
  'music-lobby': 'lobby',
  'music-race': 'race',
  'music-winner': 'winner',
  'sfx-fanfare': 'fanfare',
  'sfx-horn': 'horn',
  'crowd-bed': 'crowd',
  'crowd-cheer': 'cheer',
  'crowd-gasp': 'gasp',
} as const;

export type SampleSlot = keyof typeof SAMPLE_SLOTS;

const EXTENSIONS = ['mp3', 'ogg', 'wav'] as const;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let limiter: DynamicsCompressorNode | null = null;
const buses = new Map<Bus, GainNode>();

/*
 * The shared effects return. Everything a voice sends here comes back into
 * the music bus wet, so a duck or a slider move takes the tail with it.
 */
let fxSend: GainNode | null = null;
let fxDelay: DelayNode | null = null;
let fxReverbWet: GainNode | null = null;
let fxDelayWet: GainNode | null = null;

/** How much of the send comes back as room, and as echo. */
export const FX_REVERB_WET = 0.22;
export const FX_DELAY_WET = 0.16;
export const FX_IMPULSE_SECONDS = 1.6;

let enabled = true;
let musicEnabled = true;
let levels: AudioLevels = { ...DEFAULT_LEVELS };

/** Decoded drop-in files, by slot. `null` means "checked, not present". */
const samples = new Map<SampleSlot, AudioBuffer | null>();
let samplesProbed = false;

export type AudioState = 'idle' | 'blocked' | 'running' | 'off';

/**
 * What the speakers are actually doing.
 *
 * Worth surfacing rather than assuming. A browser can refuse to start the
 * context, or suspend a running one when the machine changes output device or
 * the tab is backgrounded, and the failure is completely silent - which on the
 * night looks like an app with no sound rather than a browser asking for a
 * click.
 */
export function audioState(): AudioState {
  if (!enabled) return 'off';
  if (!ctx) return 'idle';
  return ctx.state === 'running' ? 'running' : 'blocked';
}

/**
 * Nudge a suspended context back to life. Safe to call on every gesture, and
 * that is exactly how it is used: a context can be suspended long after the
 * first click that created it.
 */
export function resumeAudio(): void {
  if (ctx && ctx.state !== 'running') void ctx.resume();
}

export const audioReady = (): boolean => ctx !== null;
export const isEnabled = (): boolean => enabled;
export const isMusicEnabled = (): boolean => enabled && musicEnabled;
export const getLevels = (): AudioLevels => ({ ...levels });

/**
 * The level the music bus is meant to sit at right now. Ducking ramps back
 * to this rather than to whatever the bus happened to read when the duck
 * began, so overlapping ducks cannot ratchet the music down a step at a
 * time until the race ends in near silence.
 */
export const musicBusTarget = (): number => (enabled && musicEnabled ? levels.music : 0);

/** The graph's clock. Callers schedule against this, never against Date. */
export const now = (): number => (ctx ? ctx.currentTime : 0);

export function setEnabled(on: boolean) {
  enabled = on;
  applyLevels();
}

export function setMusicEnabled(on: boolean) {
  musicEnabled = on;
  applyLevels();
}

export function setLevels(next: Partial<AudioLevels>) {
  levels = { ...levels, ...next };
  applyLevels();
}

function applyLevels() {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  /*
   * Ramp rather than set. A step change on a running oscillator is a click,
   * and the moderator drags these sliders while the race is on.
   */
  master.gain.setTargetAtTime(enabled ? levels.master : 0, t, 0.02);
  const music = buses.get('music');
  if (music) {
    /* A slider move during a duck must win over the duck's pending ramp,
       otherwise the ramp restores the old level a second later. */
    music.gain.cancelScheduledValues(t);
    music.gain.setValueAtTime(Math.max(0.0001, music.gain.value), t);
    music.gain.setTargetAtTime(musicBusTarget(), t, 0.05);
  }
  buses.get('sfx')?.gain.setTargetAtTime(levels.sfx, t, 0.02);
  buses.get('crowd')?.gain.setTargetAtTime(levels.crowd, t, 0.05);
}

/**
 * Build the graph. Browsers refuse to start a context before a user gesture,
 * so every entry point that can follow a click or a key calls this first.
 */
export function primeAudio(): AudioContext | null {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }
  if (typeof window === 'undefined') return null;

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
    return null;
  }

  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 6;
  limiter.ratio.value = 16;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.16;
  limiter.connect(ctx.destination);

  master = ctx.createGain();
  master.connect(limiter);

  for (const name of ['music', 'sfx', 'crowd'] as Bus[]) {
    const g = ctx.createGain();
    g.connect(master);
    buses.set(name, g);
  }

  buildFx(ctx, buses.get('music')!);

  applyLevels();
  void probeSamples();
  return ctx;
}

/**
 * The effects return: a convolver fed a generated impulse, and a feedback
 * delay with a darkened loop so repeats sit behind the dry note.
 *
 * Built once per context, never per note. Convolution is the single most
 * expensive thing in WebAudio, and a projector laptop running a race already
 * has a canvas to paint. A browser that lacks any of these nodes just gets a
 * dry mix - the send becomes a dead end rather than an exception.
 */
function buildFx(context: AudioContext, musicBus: GainNode): void {
  try {
    const send = context.createGain();
    send.gain.value = 1;

    const convolver = context.createConvolver();
    convolver.buffer = impulseResponse(context, FX_IMPULSE_SECONDS);
    const reverbWet = context.createGain();
    reverbWet.gain.value = FX_REVERB_WET;
    send.connect(convolver);
    convolver.connect(reverbWet);
    reverbWet.connect(musicBus);

    const delay = context.createDelay(2);
    delay.delayTime.value = 0.35;
    const feedback = context.createGain();
    feedback.gain.value = 0.34;
    const darken = context.createBiquadFilter();
    darken.type = 'lowpass';
    darken.frequency.value = 2800;
    const delayWet = context.createGain();
    delayWet.gain.value = FX_DELAY_WET;
    send.connect(delay);
    delay.connect(darken);
    darken.connect(feedback);
    feedback.connect(delay);
    darken.connect(delayWet);
    delayWet.connect(musicBus);

    fxSend = send;
    fxDelay = delay;
    fxReverbWet = reverbWet;
    fxDelayWet = delayWet;
  } catch {
    fxSend = null;
    fxDelay = null;
    fxReverbWet = null;
    fxDelayWet = null;
  }
}

/**
 * A room, synthesised: stereo noise under an exponential decay. Uncorrelated
 * left and right is what makes it read as space rather than as a slapback.
 */
function impulseResponse(context: AudioContext, seconds: number): AudioBuffer {
  const frames = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buf = context.createBuffer(2, frames, context.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < frames; i++) {
      const env = Math.exp((-6.5 * i) / frames);
      data[i] = (Math.random() * 2 - 1) * env;
    }
  }
  return buf;
}

/** Sync the echo to the track. A dotted eighth is the usual choice. */
export function setFxDelayTime(seconds: number): void {
  if (!ctx || !fxDelay) return;
  fxDelay.delayTime.setTargetAtTime(Math.min(1.9, Math.max(0.01, seconds)), ctx.currentTime, 0.05);
}

/** True when the shared reverb and delay were built. */
export const fxAvailable = (): boolean => fxSend !== null;

/** The wet returns, for the sound-check panel and the tests. */
export const fxLevels = (): { reverb: number; delay: number } => ({
  reverb: fxReverbWet?.gain.value ?? 0,
  delay: fxDelayWet?.gain.value ?? 0,
});

export function busNode(bus: Bus): GainNode | null {
  return buses.get(bus) ?? null;
}

/* ── Drop-in files ─────────────────────────────────────────────────────── */

/**
 * Load whatever drop-in files the build found, once, in the background.
 *
 * `manifest.json` is written by `scripts/audio-manifest.mjs` at build time and
 * lists what is actually in `public/audio/`. Reading it first means the engine
 * only ever fetches files that exist: probing for each slot instead costs two
 * dozen 404s in the console on every load, and a console full of red reads as
 * a broken build to whoever opens dev tools on the night.
 *
 * A missing or unreadable manifest is a normal state - it means no drop-in
 * audio - and leaves every cue synthesised.
 */
async function probeSamples(): Promise<void> {
  if (samplesProbed || !ctx) return;
  samplesProbed = true;

  const slots = Object.keys(SAMPLE_SLOTS) as SampleSlot[];
  let present: string[] = [];
  try {
    const res = await fetch(`${base()}audio/manifest.json`, { cache: 'force-cache' });
    if (res.ok) {
      const body = (await res.json()) as { files?: unknown };
      if (Array.isArray(body.files)) present = body.files.filter((f): f is string => typeof f === 'string');
    }
  } catch {
    /* No manifest. Everything stays synthesised. */
  }

  if (!present.length) {
    for (const slot of slots) samples.set(slot, null);
    return;
  }

  await Promise.all(
    slots.map(async (slot) => {
      const name = SAMPLE_SLOTS[slot];
      const file = EXTENSIONS.map((ext) => `${name}.${ext}`).find((f) => present.includes(f));
      if (!file) {
        samples.set(slot, null);
        return;
      }
      try {
        const res = await fetch(`${base()}audio/${file}`, { cache: 'force-cache' });
        const bytes = res.ok ? await res.arrayBuffer() : null;
        samples.set(slot, bytes?.byteLength && ctx ? await ctx.decodeAudioData(bytes) : null);
      } catch {
        /* Listed but unplayable - a corrupt file, or a codec this browser
           lacks. The synthesised cue covers it rather than the night losing
           a sound. */
        samples.set(slot, null);
      }
    }),
  );
}

/*
 * The static export can be served from a sub-path on GitHub Pages, so the
 * sample URLs are built from the same base the rest of the assets use rather
 * than being assumed to sit at the site root.
 */
const base = (): string => {
  const p = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return p ? `${p.replace(/\/$/, '')}/` : '/';
};

export const sampleFor = (slot: SampleSlot): AudioBuffer | null => samples.get(slot) ?? null;

/** True once every slot has been resolved to a file or to nothing. */
export const samplesSettled = (): boolean =>
  samples.size === Object.keys(SAMPLE_SLOTS).length;

/** Which drop-in files were found. Drives the console's sound-check panel. */
export function sampleReport(): { slot: SampleSlot; file: string; loaded: boolean }[] {
  return (Object.keys(SAMPLE_SLOTS) as SampleSlot[]).map((slot) => ({
    slot,
    file: `${SAMPLE_SLOTS[slot]}.[${EXTENSIONS.join('|')}]`,
    loaded: Boolean(samples.get(slot)),
  }));
}

/* ── Primitives ────────────────────────────────────────────────────────── */

export interface ToneOpts {
  freq: number;
  /** Seconds from now. */
  at?: number;
  dur?: number;
  type?: OscillatorType;
  peak?: number;
  bus?: Bus;
  /** Glide to this frequency across the note. */
  slideTo?: number;
  /** Fraction of the note spent rising to peak. */
  attack?: number;
  detune?: number;
  /**
   * Spread in cents between two oscillators a hair apart. The classic way to
   * make a bare sawtooth sound like a synth rather than a test tone.
   */
  unison?: number;
  /** A lowpass on the voice, in Hz. */
  lowpass?: number;
  /** Sweep the lowpass to this across the note: open-to-closed is a pluck. */
  lowpassTo?: number;
  q?: number;
  /** -1 left to 1 right. */
  pan?: number;
  /** 0 to 1 of the voice sent to the shared reverb and delay. */
  send?: number;
  /** Slow amplitude wobble, for electric-piano shimmer. */
  tremolo?: { rate: number; depth: number };
}

/** One synth voice. The unit every synthesised cue is built from. */
export function tone(o: ToneOpts): void {
  if (!enabled || !ctx) return;
  const out = buses.get(o.bus ?? 'sfx');
  if (!out) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const t0 = ctx.currentTime + (o.at ?? 0);
  const dur = o.dur ?? 0.2;
  /* Two oscillators sum to twice the level; pull the pair back. */
  const peak = Math.max(0.0002, (o.peak ?? 0.1) * (o.unison ? 0.6 : 1));
  const attack = Math.max(0.004, (o.attack ?? 0.06) * dur);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  const spreads = o.unison ? [-o.unison / 2, o.unison / 2] : [0];
  for (const spread of spreads) {
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), t0 + dur);
    const cents = (o.detune ?? 0) + spread;
    if (cents) osc.detune.setValueAtTime(cents, t0);
    osc.connect(gain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  let head: AudioNode = gain;

  if (o.lowpass) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(o.lowpass, t0);
    if (o.lowpassTo) filter.frequency.exponentialRampToValueAtTime(Math.max(30, o.lowpassTo), t0 + dur);
    filter.Q.value = o.q ?? 1;
    head.connect(filter);
    head = filter;
  }

  if (o.tremolo) {
    /* Carrier gain sits at 1 - depth and the LFO adds up to +depth, so the
       wobble never pushes past unity or below silence. */
    const trem = ctx.createGain();
    trem.gain.setValueAtTime(1 - o.tremolo.depth, t0);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(o.tremolo.rate, t0);
    const lfoAmount = ctx.createGain();
    lfoAmount.gain.setValueAtTime(o.tremolo.depth, t0);
    lfo.connect(lfoAmount);
    lfoAmount.connect(trem.gain);
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.05);
    head.connect(trem);
    head = trem;
  }

  route(ctx, head, out, o.pan, o.send);
}

/**
 * The last leg every voice shares: optional pan, the dry path to its bus, and
 * an optional tap into the shared effects. Returns the node now feeding the
 * bus so a caller can keep chaining if it ever needs to.
 */
function route(context: AudioContext, head: AudioNode, out: GainNode, pan?: number, send?: number): AudioNode {
  if (pan && typeof context.createStereoPanner === 'function') {
    const panner = context.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    head.connect(panner);
    head = panner;
  }
  head.connect(out);
  if (send && fxSend && out === buses.get('music')) {
    const tap = context.createGain();
    tap.gain.value = Math.max(0, Math.min(1, send));
    head.connect(tap);
    tap.connect(fxSend);
  }
  return head;
}

/**
 * A burst of filtered noise.
 *
 * Everything percussive and everything human comes from this: a bandpass at
 * 900Hz with a slow envelope is a crowd, the same noise through a highpass
 * with a 40ms envelope is a hi-hat.
 */
export interface NoiseOpts {
  at?: number;
  dur?: number;
  peak?: number;
  bus?: Bus;
  type?: BiquadFilterType;
  freq?: number;
  q?: number;
  /** Sweep the filter across the burst, for a swell or a fall. */
  sweepTo?: number;
  attack?: number;
  /** -1 left to 1 right. */
  pan?: number;
  /** 0 to 1 of the burst sent to the shared reverb and delay. */
  send?: number;
}

export function noise(o: NoiseOpts = {}): void {
  if (!enabled || !ctx) return;
  const out = buses.get(o.bus ?? 'sfx');
  if (!out) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const dur = o.dur ?? 0.3;
  const t0 = ctx.currentTime + (o.at ?? 0);
  const peak = Math.max(0.0002, o.peak ?? 0.1);
  const attack = Math.max(0.005, (o.attack ?? 0.25) * dur);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = o.type ?? 'bandpass';
  filter.frequency.setValueAtTime(o.freq ?? 1000, t0);
  if (o.sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(30, o.sweepTo), t0 + dur);
  filter.Q.value = o.q ?? 1;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(filter).connect(gain);
  route(ctx, gain, out, o.pan, o.send);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

/* One second of white noise, generated once and looped by every noise voice. */
let noiseBuf: AudioBuffer | null = null;
function noiseBuffer(context: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  const frames = context.sampleRate;
  const buf = context.createBuffer(1, frames, context.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  noiseBuf = buf;
  return buf;
}

/** A playing drop-in file, kept with its own gain so it can be faded. */
export interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

/** Play a drop-in file. Returns null when the slot has no file behind it. */
export function playSample(
  slot: SampleSlot,
  o: { bus?: Bus; gain?: number; loop?: boolean; at?: number; fadeIn?: number } = {},
): Voice | null {
  if (!enabled || !ctx) return null;
  const buffer = samples.get(slot);
  const out = buses.get(o.bus ?? 'sfx');
  if (!buffer || !out) return null;
  if (ctx.state === 'suspended') void ctx.resume();

  const t0 = ctx.currentTime + (o.at ?? 0);
  const target = o.gain ?? 1;

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = o.loop ?? false;

  const gain = ctx.createGain();
  if (o.fadeIn) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(target, t0 + o.fadeIn);
  } else {
    gain.gain.setValueAtTime(target, t0);
  }

  src.connect(gain).connect(out);
  src.start(t0);
  return { src, gain };
}

/**
 * Retire a looping voice.
 *
 * The gain is ramped down first and the source stopped only once it is
 * inaudible: stopping a loop outright cuts mid-waveform, which is a click on
 * a PA and a thump on a laptop speaker.
 */
export function fadeOut(voice: Voice | null, seconds = 0.6): void {
  if (!voice || !ctx) return;
  const t = ctx.currentTime;
  try {
    voice.gain.gain.cancelScheduledValues(t);
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), t);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    voice.src.stop(t + seconds + 0.05);
  } catch {
    /* Already stopped. */
  }
}
