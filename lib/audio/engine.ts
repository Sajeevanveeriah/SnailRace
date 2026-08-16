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
  buses.get('music')?.gain.setTargetAtTime(musicEnabled ? levels.music : 0, t, 0.05);
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

  applyLevels();
  void probeSamples();
  return ctx;
}

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
}

/** One synth voice. The unit every synthesised cue is built from. */
export function tone(o: ToneOpts): void {
  if (!enabled || !ctx) return;
  const out = buses.get(o.bus ?? 'sfx');
  if (!out) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const t0 = ctx.currentTime + (o.at ?? 0);
  const dur = o.dur ?? 0.2;
  const peak = Math.max(0.0002, o.peak ?? 0.1);
  const attack = Math.max(0.004, (o.attack ?? 0.06) * dur);

  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), t0 + dur);
  if (o.detune) osc.detune.setValueAtTime(o.detune, t0);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(gain).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
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

  src.connect(filter).connect(gain).connect(out);
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
