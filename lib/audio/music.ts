'use client';

import {
  busNode,
  fadeOut,
  isMusicEnabled,
  musicBusTarget,
  noise,
  now,
  playSample,
  primeAudio,
  sampleFor,
  setFxDelayTime,
  tone,
  type NoiseOpts,
  type ToneOpts,
  type Voice,
} from './engine';

/**
 * The soundtrack.
 *
 * Written here rather than licensed, for the reasons in `engine.ts`: a club
 * night projected in public should not depend on a venue's wifi or on anyone
 * having read a licence. A club that would rather use real recordings drops
 * them into `public/audio/` and the tracks below stand aside - see
 * `startTrack`.
 *
 * It is a step sequencer, not a set of loops. A bar is scheduled a bar ahead
 * on the audio clock, which is the only clock accurate enough for this:
 * `setInterval` drifts audibly within about thirty seconds, and a race can
 * run for forty-five.
 *
 * GAIN STAGING - nobody can listen to this in CI, so the levels are written
 * down here and the sum is budgeted rather than guessed. Every figure is the
 * peak of one voice before the music bus (0.72 by default) and the master
 * limiter. The target is the same loudness as the previous race track at
 * full build, whose busiest beat summed to roughly 1.0 of raw peak before
 * the bus: kick 0.5, bass 0.14, backbeat 0.21, hats 0.04, arp 0.08, top
 * line 0.06, tambourine 0.06.
 *
 *   Race, run home, on a downbeat where everything lands at once:
 *     kick 0.50 + click 0.12      the pulse; the one thing allowed to be loud
 *     bass 0.17 (two-osc unison)  under the kick; the lowpass keeps it there
 *     snare 0.18 body + 0.15 hiss on 2 and 4 only, never with the downbeat
 *     hats 0.045 (±15%)           small by design: a hat at 0.1 is a cymbal
 *     stabs 3 × 0.05 = 0.15       short, so they add attack not weight
 *     pad 3 × 0.035 = 0.10        long and filtered; felt more than heard
 *     lead 0.085 + double 0.04    the only voice that has to be *followed*
 *     shaker 0.03, tambourine 0.05
 *     ------------------------------------------------
 *     worst case ≈ 1.25 raw, and the voices do not all peak on the same
 *     sample; the send returns at 0.22 reverb + 0.16 delay of what is sent,
 *     which the limiter absorbs on the big beats.
 *
 *   Lobby, a chord change:
 *     electric piano 4 notes × (0.075 + 0.045 + 0.02) ≈ 0.56
 *     walking bass 0.16, brushed hats 0.035, brush on 2 and 4 0.05
 *     ------------------------------------------------
 *     ≈ 0.55 sustained, which sits level with the race groove rather than
 *     under it: the old drone peaked at 0.3 and read as the music being off.
 *
 * The race track is adaptive. `setIntensity` is fed the leader's progress
 * every frame, and the arrangement builds in four sections keyed off it
 * (`sectionFor`): intro, groove, drive and the run home. The room hears how
 * far into the race it is without looking at the track.
 */

export type TrackId = 'lobby' | 'race' | 'winner';

/** A bar's worth of scheduling, in beats. */
const BEATS_PER_BAR = 4;

/** Steps per bar: the sequencer resolves to sixteenths. */
const STEPS_PER_BAR = 16;

/** How far ahead of the playhead the next bar is queued. */
const SCHEDULE_AHEAD = 0.35;

/**
 * Where the off-beat sixteenth lands between its neighbours. 0.5 is dead
 * straight; 0.57 is the push that stops a programmed hat sounding like a
 * metronome.
 */
export const SWING = 0.57;

/**
 * The most voices one step may start. Every note is its own oscillator or
 * buffer source, and a laptop that is also painting the race has a budget.
 * The arrangement never reaches this by construction; the guard is there so
 * an edit cannot quietly push it over.
 */
export const MAX_VOICES_PER_STEP = 16;

export const RACE_BPM = 128;
export const LOBBY_BPM = 98;
export const WINNER_BPM = 124;

/** A4. Every pitch below is semitones from here. */
const A4 = 440;

const hz = (semitones: number, root = A4): number =>
  root * Math.pow(2, semitones / 12);

/** A chord as semitones from A, plus the bass root in the same units. */
interface Chord {
  name: string;
  /** The triad or seventh, voiced close around A3-A4. */
  tones: number[];
  /** Bass root, semitones from A2. */
  root: number;
}

/**
 * The race: i - VI - III - VII in A minor, one chord a bar. The progression
 * every race-night and sports-bumper theme leans on, because it climbs back
 * to the tonic through the relative major rather than resolving, so four bars
 * of it feel like they are still going somewhere.
 */
export const RACE_CHORDS: readonly Chord[] = [
  { name: 'Am', tones: [0, 3, 7], root: 0 },
  { name: 'F', tones: [-4, 0, 3], root: -4 },
  { name: 'C', tones: [3, 7, 10], root: 3 },
  { name: 'G', tones: [-2, 2, 5], root: -2 },
];

/**
 * The lobby: a two-bar loop, two beats a chord. Sevenths throughout, which is
 * what makes a triangle-wave piano read as a Rhodes rather than an organ.
 */
export const LOBBY_CHORDS: readonly Chord[] = [
  { name: 'Am7', tones: [0, 3, 7, 10], root: 0 },
  { name: 'Fmaj7', tones: [-4, 0, 3, 7], root: -4 },
  { name: 'Dm7', tones: [-7, -4, 0, 3], root: -7 },
  { name: 'G7', tones: [-2, 2, 5, 8], root: -2 },
];

/**
 * The lobby's walking bass: two quarter notes a chord, the second an approach
 * into the next root. Semitones from A2, in the order the chords play.
 */
const LOBBY_WALK: readonly number[] = [0, 3, -4, -5, -7, -4, -2, -1];

/**
 * The lead, as an eight-bar phrase rather than a pattern. Each note is
 * [step within the bar, semitones from A4, length in steps]. Bars 1-4 state
 * the hook over Am F C G, bars 5-8 answer it an inversion higher and land
 * back on E so the loop pulls into the Am.
 */
type LeadNote = readonly [step: number, semitone: number, len: number];
const LEAD_PHRASE: readonly (readonly LeadNote[])[] = [
  /* Am */ [[0, 7, 2], [2, 7, 1], [4, 10, 2], [6, 12, 4], [12, 7, 2], [14, 5, 2]],
  /* F  */ [[0, 3, 4], [4, 0, 2], [6, 3, 2], [8, 5, 4], [12, 7, 4]],
  /* C  */ [[0, 10, 2], [2, 7, 2], [4, 10, 4], [8, 7, 2], [10, 5, 2], [12, 3, 4]],
  /* G  */ [[0, 5, 4], [4, 2, 2], [6, 5, 2], [8, 10, 6], [14, 7, 2]],
  /* Am */ [[0, 12, 4], [4, 10, 2], [6, 7, 2], [8, 12, 2], [10, 15, 2], [12, 14, 4]],
  /* F  */ [[0, 12, 6], [6, 8, 2], [8, 12, 2], [10, 15, 2], [12, 12, 4]],
  /* C  */ [[0, 10, 4], [4, 7, 4], [8, 10, 2], [10, 12, 2], [12, 14, 4]],
  /* G  */ [[0, 14, 4], [4, 17, 4], [8, 14, 2], [10, 10, 2], [12, 7, 4]],
];

/** The race bass, in eighths: root, with the octave and fifth as pushes. */
const RACE_BASS: readonly number[] = [0, 0, 12, 0, 0, 0, 7, 12];

/** Off-beat chord stabs, as steps within the bar. */
const STAB_STEPS: readonly number[] = [2, 6, 10, 13];

export type RaceSection = 'intro' | 'groove' | 'drive' | 'run-home';

/**
 * The four sections, from the leader's progress. Thresholds are arrangement,
 * not volume: turning a track up to signal urgency just makes a loud room
 * louder, while a snare arriving at the halfway mark is heard as "this is
 * getting serious" even by someone who is not listening.
 */
export function sectionFor(intensity: number): RaceSection {
  if (intensity < 0.2) return 'intro';
  if (intensity < 0.45) return 'groove';
  if (intensity < 0.78) return 'drive';
  return 'run-home';
}

interface TrackState {
  id: TrackId;
  bpm: number;
  bar: number;
  /** Audio-clock time the next bar starts. */
  nextBarAt: number;
  timer: number;
  /** 0 to 1. Drives how much of the arrangement is playing. */
  intensity: number;
  /** Set when a drop-in file is covering this track instead. */
  voice: Voice | null;
}

let track: TrackState | null = null;

export const currentTrack = (): TrackId | null => track?.id ?? null;

/**
 * Start a track, or do nothing if it is already the one playing.
 *
 * Restarting on every call would retrigger the lobby groove from bar one
 * each time a donation lands and re-rendered the stage.
 */
export function startTrack(id: TrackId, opts: { intensity?: number } = {}): void {
  if (track?.id === id) {
    if (opts.intensity !== undefined) setIntensity(opts.intensity);
    return;
  }
  primeAudio();
  stopTrack(id === 'winner' ? 0.15 : 0.5);
  if (!isMusicEnabled()) return;

  /* A supplied recording wins. The sequencer stays out of its way entirely. */
  const slot = id === 'lobby' ? 'music-lobby' : id === 'race' ? 'music-race' : 'music-winner';
  if (sampleFor(slot)) {
    track = {
      id, bpm: 0, bar: 0, nextBarAt: 0, timer: 0,
      intensity: opts.intensity ?? 0,
      voice: playSample(slot, { bus: 'music', loop: id !== 'winner', fadeIn: 0.4 }),
    };
    return;
  }

  const bpm = id === 'lobby' ? LOBBY_BPM : id === 'race' ? RACE_BPM : WINNER_BPM;
  /* The echo follows the track: a dotted eighth at its tempo. */
  setFxDelayTime((60 / bpm) * 0.75);

  track = {
    id,
    bpm,
    bar: 0,
    nextBarAt: now() + 0.08,
    timer: 0,
    intensity: opts.intensity ?? 0,
    voice: null,
  };
  tick();
}

export function stopTrack(fade = 0.6): void {
  if (!track) return;
  window.clearTimeout(track.timer);
  fadeOut(track.voice, fade);
  track = null;
}

/** Feed the race's progress in, 0 at the gate and 1 at the line. */
export function setIntensity(value: number): void {
  if (!track) return;
  track.intensity = Math.min(1, Math.max(0, value));
}

/**
 * Queue the next bar and schedule the next wake-up.
 *
 * Driven by `setTimeout` but never *timed* by it: every note inside the bar
 * is placed against the audio clock, so a late timer produces a late queue
 * rather than a late note.
 */
function tick(): void {
  const active = track;
  if (!active || active.voice) return;
  if (!isMusicEnabled()) {
    stopTrack(0.3);
    return;
  }

  const secondsPerBeat = 60 / active.bpm;
  const barLength = secondsPerBeat * BEATS_PER_BAR;

  /* A backgrounded tab wakes with a stale playhead. Catch up rather than
     dumping every missed bar into the speakers at once. */
  if (active.nextBarAt < now() - barLength) active.nextBarAt = now() + 0.05;

  const start = active.nextBarAt;
  const bar = new Bar(active, start, secondsPerBeat);
  if (active.id === 'lobby') lobbyBar(bar);
  else if (active.id === 'race') raceBar(bar);
  else winnerBar(bar);
  bar.flush();

  /* A bar may deliberately stop or replace the current track. Do not touch
     the shared slot after that transition - winnerBar ends its own fanfare. */
  if (track !== active) return;

  active.bar += 1;
  active.nextBarAt = start + barLength;

  const wait = Math.max(20, (active.nextBarAt - now() - SCHEDULE_AHEAD) * 1000);
  active.timer = window.setTimeout(tick, wait);
}

/* ── The sequencer ─────────────────────────────────────────────────────── */

/** ±15%, so a programmed part does not sound programmed. */
const velocity = (): number => 1 + (Math.random() * 0.3 - 0.15);

/**
 * One bar's worth of notes, collected by step and then fired.
 *
 * Collecting first is what makes the voice budget enforceable: a step that
 * somehow asks for more than `MAX_VOICES_PER_STEP` drops its quietest extras
 * rather than the browser dropping frames.
 */
class Bar {
  readonly beat: number;
  readonly step: number;
  private readonly offset: number;
  private readonly queue: Array<Array<() => void>> = Array.from({ length: STEPS_PER_BAR }, () => []);

  constructor(readonly t: TrackState, at: number, beat: number) {
    this.beat = beat;
    this.step = beat / (STEPS_PER_BAR / BEATS_PER_BAR);
    this.offset = at - now();
  }

  /** Seconds from now for a step, swung if it is an off-beat sixteenth. */
  at(step: number, swing = true): number {
    const push = swing && step % 2 === 1 ? (SWING - 0.5) * 2 * this.step : 0;
    return this.offset + step * this.step + push;
  }

  tone(step: number, o: Omit<ToneOpts, 'at' | 'bus'> & { swing?: boolean }): void {
    const { swing, ...rest } = o;
    this.push(step, () => tone({ ...rest, at: this.at(step, swing), bus: 'music' }));
  }

  noise(step: number, o: Omit<NoiseOpts, 'at' | 'bus'> & { swing?: boolean }): void {
    const { swing, ...rest } = o;
    this.push(step, () => noise({ ...rest, at: this.at(step, swing), bus: 'music' }));
  }

  private push(step: number, play: () => void): void {
    const slot = this.queue[Math.max(0, Math.min(STEPS_PER_BAR - 1, Math.floor(step)))];
    if (slot.length < MAX_VOICES_PER_STEP) slot.push(play);
  }

  flush(): void {
    for (const slot of this.queue) for (const play of slot) play();
  }
}

/* ── Drum kit ───────────────────────────────────────────────────────────── */

/** A pitch-swept sine for the body and a burst of bright noise for the beater. */
function kick(bar: Bar, step: number, level = 1): void {
  bar.tone(step, { freq: 150, slideTo: 44, dur: 0.24, type: 'sine', peak: 0.5 * level, attack: 0.01, swing: false });
  bar.noise(step, { type: 'highpass', freq: 2600, dur: 0.02, peak: 0.12 * level, attack: 0.1, swing: false });
}

/** A tuned body at 180 Hz under bandpassed noise, with a touch of room. */
function snare(bar: Bar, step: number, level = 1): void {
  bar.tone(step, { freq: 180, slideTo: 120, dur: 0.13, type: 'sine', peak: 0.18 * level, attack: 0.01, send: 0.3, swing: false });
  bar.noise(step, { type: 'bandpass', freq: 2200, q: 0.7, dur: 0.17, peak: 0.15 * level, attack: 0.02, send: 0.35, swing: false });
}

/** Closed hat, swung on the off-beats, alternating a little left and right. */
function hat(bar: Bar, step: number, level = 1, open = false): void {
  bar.noise(step, {
    type: 'highpass', freq: 7800, dur: open ? 0.2 : 0.045,
    peak: 0.045 * level * velocity(), attack: 0.05,
    pan: step % 4 === 0 ? -0.18 : 0.18,
  });
}

/* ── The tracks ────────────────────────────────────────────────────────── */

/**
 * Race: a race-night theme that gains a layer per section.
 *
 *   intro     kick, bass, a low pad
 *   groove    + swung hats, + off-beat chord stabs
 *   drive     + snare on 2 and 4, + the lead
 *   run home  + shaker and tambourine, lead an octave up, a fill every
 *             fourth bar
 *
 * Chord changes once a bar; the lead phrase is eight bars, so it rides two
 * passes of the progression before it repeats.
 */
function raceBar(bar: Bar): void {
  const section = sectionFor(bar.t.intensity);
  const chord = RACE_CHORDS[bar.t.bar % RACE_CHORDS.length];
  const groove = section !== 'intro';
  const drive = section === 'drive' || section === 'run-home';
  const home = section === 'run-home';
  const fillBar = home && bar.t.bar % 4 === 3;

  /* Kick: four to the floor, from the gate. */
  for (let b = 0; b < BEATS_PER_BAR; b++) kick(bar, b * 4);

  /* Bass: eighths, two sawtooths a few cents apart under a closing lowpass. */
  RACE_BASS.forEach((offset, eighth) => {
    bar.tone(eighth * 2, {
      freq: hz(chord.root + offset, A4 / 4), dur: bar.beat * 0.45,
      type: 'sawtooth', peak: 0.17, attack: 0.02, unison: 14,
      lowpass: offset ? 1600 : 1200, lowpassTo: 260, q: 2.5,
    });
  });

  /* Pad: the chord, long and dark, wider than the rest of the mix. */
  chord.tones.forEach((semi, k) => {
    bar.tone(0, {
      freq: hz(semi, A4 / 2), dur: bar.beat * 3.9, type: 'sawtooth',
      peak: groove ? 0.035 : 0.025, attack: 0.3, unison: 10,
      lowpass: 900, lowpassTo: 500, send: 0.6, pan: (k - 1) * 0.4,
    });
  });

  if (groove) {
    /* Hats: eighths in the groove, sixteenths once it drives. */
    const every = drive ? 1 : 2;
    for (let s = 0; s < STEPS_PER_BAR; s += every) {
      hat(bar, s, s % 4 === 0 ? 1.2 : s % 2 ? 0.7 : 1, drive && s === 14);
    }

    /* Stabs: the chord, short and bright, on the off-beats. */
    STAB_STEPS.forEach((s, k) => {
      chord.tones.forEach((semi, n) => {
        bar.tone(s, {
          freq: hz(semi, A4 / 2), dur: 0.2, type: 'sawtooth', peak: 0.05,
          attack: 0.03, lowpass: 2800, lowpassTo: 500, q: 1.5, send: 0.4,
          pan: (k % 2 ? 0.3 : -0.3) + (n - 1) * 0.1,
        });
      });
    });
  }

  if (drive) {
    /* Backbeat. A fill of sixteenths on the last beat every fourth bar of the run home. */
    snare(bar, 4);
    if (fillBar) {
      [8, 10, 12, 13, 14, 15].forEach((s, k) => snare(bar, s, 0.55 + k * 0.08));
    } else {
      snare(bar, 12);
    }

    /* The lead: a written phrase, an octave up in the run home with the
       lower octave left in underneath for body. */
    const phrase = LEAD_PHRASE[bar.t.bar % LEAD_PHRASE.length];
    for (const [s, semi, len] of phrase) {
      const vel = velocity();
      const dur = bar.step * len * 0.9;
      bar.tone(s, {
        freq: hz(semi + (home ? 12 : 0)), dur, type: 'sawtooth',
        peak: (home ? 0.07 : 0.085) * vel, attack: 0.04, unison: 12,
        lowpass: 3200, lowpassTo: 1400, q: 1.2, send: 0.35, pan: -0.15,
      });
      if (home) {
        bar.tone(s, {
          freq: hz(semi), dur, type: 'triangle', peak: 0.04 * vel,
          attack: 0.04, send: 0.3, pan: 0.15,
        });
      }
    }
  }

  if (home) {
    /* Shaker on every sixteenth, tambourine on the off-beat eighths. */
    for (let s = 0; s < STEPS_PER_BAR; s++) {
      bar.noise(s, {
        type: 'bandpass', freq: 6000, q: 1.2, dur: 0.05,
        peak: (s % 2 ? 0.022 : 0.03) * velocity(), attack: 0.3, pan: 0.35,
      });
    }
    for (let s = 2; s < STEPS_PER_BAR; s += 4) {
      bar.noise(s, { type: 'highpass', freq: 9000, dur: 0.09, peak: 0.05 * velocity(), attack: 0.05, pan: -0.3, send: 0.3 });
    }
  }
}

/**
 * Lobby: a warm, moving groove for the betting.
 *
 * It plays while the moderator is talking and while people are reading a QR
 * code off a wall, so there is no lead line to follow - just an electric
 * piano on the chords, a walking bass, and brushes. Level with the race
 * track rather than under it: the old drone was so quiet it read as off.
 */
function lobbyBar(bar: Bar): void {
  const first = (bar.t.bar % 2) * 2;

  for (let half = 0; half < 2; half++) {
    const chord = LOBBY_CHORDS[first + half];
    const chordStep = half * 8;

    /* Electric piano: each note is three partials - a sine, a triangle a few
       cents sharp, and a quiet octave - under a slow amplitude wobble. Rolled
       in over a few milliseconds so it reads as a hand, not a sequencer. */
    chord.tones.forEach((semi, k) => {
      const f = hz(semi, A4 / 2);
      const dur = bar.beat * 1.9;
      const pan = (k - 1.5) * 0.25;
      const roll = chordStep + k * 0.08;
      bar.tone(roll, { freq: f, dur, type: 'sine', peak: 0.075, attack: 0.02, send: 0.45, pan, tremolo: { rate: 4.2, depth: 0.25 } });
      bar.tone(roll, { freq: f, dur, type: 'triangle', peak: 0.045, attack: 0.02, detune: 6, lowpass: 1800, send: 0.45, pan, tremolo: { rate: 4.2, depth: 0.25 } });
      bar.tone(roll, { freq: f * 2, dur: dur * 0.6, type: 'sine', peak: 0.02, attack: 0.01, send: 0.3, pan });
    });

    /* Walking bass: quarter notes, the second an approach to the next root. */
    for (let q = 0; q < 2; q++) {
      const semi = LOBBY_WALK[(first + half) * 2 + q];
      bar.tone(chordStep + q * 4, {
        freq: hz(semi, A4 / 4), dur: bar.beat * 0.8, type: 'triangle',
        peak: 0.16, attack: 0.03, lowpass: 700, lowpassTo: 300, swing: false,
      });
    }
  }

  /* Brushed hats on the swung eighths; a brush swish on 2 and 4. */
  for (let s = 0; s < STEPS_PER_BAR; s += 2) {
    bar.noise(s, { type: 'highpass', freq: 8500, dur: 0.06, peak: (s % 4 ? 0.025 : 0.035) * velocity(), attack: 0.3, pan: 0.2 });
  }
  for (const s of [4, 12]) {
    bar.noise(s, { type: 'bandpass', freq: 3200, q: 0.6, dur: 0.22, peak: 0.05, attack: 0.4, send: 0.3, pan: -0.15 });
  }
}

/**
 * Winner: a short, bright major fanfare over a held root, then it gets out
 * of the way. Three bars at a quicker clip than before, with the room on it.
 */
function winnerBar(bar: Bar): void {
  const t = bar.t;
  if (t.bar > 2) {
    stopTrack(1.2);
    return;
  }

  const C4 = 261.63;
  const fanfare = (tones: number[], peak: number, dur: number, spread: number): void => {
    tones.forEach((s, k) => {
      bar.tone(k * spread, { freq: hz(s, C4), dur, type: 'sawtooth', peak, attack: 0.03, unison: 10, lowpass: 4200, lowpassTo: 1800, send: 0.45, pan: (k - 1.5) * 0.3, swing: false });
      bar.tone(k * spread, { freq: hz(s + 12, C4), dur: dur * 0.7, type: 'triangle', peak: peak * 0.4, attack: 0.03, send: 0.5, swing: false });
    });
  };

  if (t.bar === 0) {
    fanfare([0, 4, 7, 12], 0.22, 1.4, 1.4);
    bar.tone(0, { freq: C4 / 2, dur: bar.beat * 4, type: 'sine', peak: 0.34, attack: 0.02, swing: false });
    bar.noise(0, { type: 'highpass', freq: 5000, dur: 0.9, peak: 0.1, attack: 0.02, send: 0.5, swing: false });
  }
  if (t.bar === 1) fanfare([5, 9, 12, 17], 0.18, bar.beat * 3, 1);
  if (t.bar === 2) {
    fanfare([12, 16, 19, 24], 0.22, 2.2, 1.2);
    bar.tone(0, { freq: C4 / 2, dur: bar.beat * 4, type: 'sine', peak: 0.3, attack: 0.02, swing: false });
  }

  for (let b = 0; b < BEATS_PER_BAR; b++) {
    kick(bar, b * 4, 0.8);
    if (b % 2 === 1) snare(bar, b * 4, 0.7);
  }
}

/*
 * There is no generated crowd bed any more. The continuous filtered-noise
 * "room" that used to run under the whole night read, on a hall PA, as a wet
 * slithering hiss rather than as people, and it was the single loudest
 * complaint after the last race night. Silence between cues is now silence,
 * or the music, or the caller: whichever the desk has chosen.
 */

/* ── Ducking ───────────────────────────────────────────────────────────── */

/** How fast the music gets out of the way of an effect. */
export const DUCK_RAMP_DOWN = 0.08;
/** How fast it comes back after an effect. */
export const DUCK_RELEASE = 0.4;

/**
 * Under the caller: about 10 dB down, in over 150 ms and back over 600 ms.
 * Enough that every word is clear over a lifted bed, short enough that the
 * music is plainly still there underneath.
 */
export const VOICE_DUCK_DB = -10;
export const VOICE_DUCK = Math.pow(10, VOICE_DUCK_DB / 20);
export const VOICE_DUCK_ATTACK = 0.15;
export const VOICE_DUCK_RELEASE = 0.6;

/**
 * The deepest any duck can go, about 10.5 dB. Below that the track vanishes
 * under the commentary and comes back as a surprise.
 */
export const DUCK_FLOOR = 0.3;

interface Duck {
  until: number;
  amount: number;
  release: number;
  /** A named duck is replaced by its owner's next call rather than stacked. */
  owner?: string;
}

/** Every duck that has not yet run its course. */
let ducks: Duck[] = [];

/**
 * Duck the music under a big moment, then bring it back.
 *
 * The music goes down over `attack`, HOLDS at the deepest active amount for
 * as long as that duck lasts, then releases to the next deepest, and so on
 * back to the nominal level. Owner-aware: a short shallow duck (a lead change)
 * never cuts a long deep one (a commentary line) short, and a named owner's
 * next duck replaces its previous one. Every level is measured from the bus's
 * NOMINAL level, never from its current reading, so overlapping ducks cannot
 * ratchet the soundtrack down to nothing.
 */
export function duck(
  seconds = 1.2,
  amount = 0.45,
  owner?: string,
  shape: { attack?: number; release?: number } = {},
): void {
  const bus = busNode('music');
  if (!bus) return;
  const level = musicBusTarget();
  if (level <= 0) return;
  const t = now();

  ducks = ducks.filter((d) => d.until > t && (!owner || d.owner !== owner));
  ducks.push({
    until: t + Math.max(0.3, seconds),
    amount: Math.max(DUCK_FLOOR, Math.min(1, amount)),
    release: Math.max(0.05, shape.release ?? DUCK_RELEASE),
    owner,
  });

  const attack = Math.max(0.01, shape.attack ?? DUCK_RAMP_DOWN);
  const sorted = [...ducks].sort((a, b) => a.until - b.until);
  let depth = Math.min(...sorted.map((d) => d.amount));

  bus.gain.cancelScheduledValues(t);
  bus.gain.setValueAtTime(Math.min(level, Math.max(0.0001, bus.gain.value)), t);
  bus.gain.linearRampToValueAtTime(level * depth, t + attack);
  let cursor = t + attack;
  for (let i = 0; i < sorted.length; i++) {
    const rest = sorted.slice(i + 1);
    const next = rest.length ? Math.min(...rest.map((d) => d.amount)) : 1;
    /* This duck ending changes nothing while a deeper or equal one runs on. */
    if (next <= depth + 1e-9) continue;
    const holdUntil = Math.max(cursor, sorted[i].until);
    bus.gain.setValueAtTime(level * depth, holdUntil);
    cursor = holdUntil + sorted[i].release;
    bus.gain.linearRampToValueAtTime(level * next, cursor);
    depth = next;
  }
}

/** The ducks still in flight, for the tests. */
export const activeDucks = (): readonly Duck[] => ducks.filter((d) => d.until > now());

/* ── The winner sting ──────────────────────────────────────────────────── */

/**
 * A short celebration, played with the winner call: a bright brass-like
 * stab on the major chord, a run up the arpeggio, a low hit and a shimmer.
 * About a second and a half, on the effects bus so the caller's duck does
 * not swallow it. A club that supplies `fanfare.mp3` hears that instead.
 */
export function winnerSting(): void {
  primeAudio();
  if (playSample('sfx-fanfare', { gain: 0.8 })) return;
  const C5 = 523.25;
  /* The stab: the chord on detuned saws and a square an octave down, filtered bright to warm. */
  [0, 4, 7, 12].forEach((semi, k) => {
    tone({ freq: hz(semi, C5), dur: 0.55, type: 'sawtooth', peak: 0.11, attack: 0.02, unison: 12, lowpass: 5200, lowpassTo: 1600, q: 0.8, pan: (k - 1.5) * 0.3, bus: 'sfx' });
  });
  tone({ freq: C5 / 2, dur: 0.6, type: 'square', peak: 0.07, attack: 0.02, lowpass: 2400, lowpassTo: 900, bus: 'sfx' });
  /* The run up, then the top note held. */
  [0, 4, 7, 12, 16].forEach((semi, k) => {
    tone({ freq: hz(semi, C5), at: 0.18 + k * 0.075, dur: k === 4 ? 0.9 : 0.16, type: 'triangle', peak: k === 4 ? 0.16 : 0.12, attack: 0.04, bus: 'sfx' });
  });
  /* A low hit under the stab, and a cymbal-like shimmer on top. */
  tone({ freq: 110, slideTo: 55, dur: 0.45, type: 'sine', peak: 0.35, attack: 0.01, bus: 'sfx' });
  noise({ dur: 1.3, peak: 0.06, type: 'highpass', freq: 6500, attack: 0.03, bus: 'sfx' });
}
