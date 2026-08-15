'use client';

import {
  busNode,
  fadeOut,
  isMusicEnabled,
  noise,
  now,
  playSample,
  primeAudio,
  sampleFor,
  tone,
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
 * The race track is adaptive. `setIntensity` is fed the leader's progress
 * every frame, and the arrangement thickens as the field comes home: the bass
 * runs the whole way, the backbeat arrives at a quarter, the arpeggio at a
 * half, and the top octave and the tambourine only in the run home. The room
 * hears how far into the race it is without looking at the track.
 */

export type TrackId = 'lobby' | 'race' | 'winner';

/** A bar's worth of scheduling, in beats. */
const BEATS_PER_BAR = 4;

/** How far ahead of the playhead the next bar is queued. */
const SCHEDULE_AHEAD = 0.35;

/*
 * A minor pentatonic, which is the cheapest way to make a generated line
 * sound deliberate: there is no interval in it that can clash with another.
 * Semitones from the root.
 */
const PENTATONIC = [0, 3, 5, 7, 10];

const A_MINOR = 220;

const hz = (semitones: number, root = A_MINOR): number =>
  root * Math.pow(2, semitones / 12);

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
let ambience: Voice | null = null;
let ambienceTimer = 0;

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

  track = {
    id,
    bpm: id === 'lobby' ? 96 : id === 'race' ? 132 : 120,
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
  if (!track || track.voice) return;
  if (!isMusicEnabled()) {
    stopTrack(0.3);
    return;
  }

  const secondsPerBeat = 60 / track.bpm;
  const barLength = secondsPerBeat * BEATS_PER_BAR;

  /* A backgrounded tab wakes with a stale playhead. Catch up rather than
     dumping every missed bar into the speakers at once. */
  if (track.nextBarAt < now() - barLength) track.nextBarAt = now() + 0.05;

  const start = track.nextBarAt;
  if (track.id === 'lobby') lobbyBar(track, start, secondsPerBeat);
  else if (track.id === 'race') raceBar(track, start, secondsPerBeat);
  else winnerBar(track, start, secondsPerBeat);

  track.bar += 1;
  track.nextBarAt = start + barLength;

  const wait = Math.max(20, (track.nextBarAt - now() - SCHEDULE_AHEAD) * 1000);
  track.timer = window.setTimeout(tick, wait);
}

/* ── The tracks ────────────────────────────────────────────────────────── */

/**
 * Lobby: a slow, warm two-chord vamp for the betting.
 *
 * Deliberately sparse and low. It plays while the moderator is talking and
 * while people are reading a QR code off a wall, so it has to sit under a
 * speaking voice without anyone reaching for the volume.
 */
function lobbyBar(t: TrackState, at: number, beat: number): void {
  const rootFor = t.bar % 4 < 2 ? 0 : -4; // i, then VI
  const root = hz(rootFor, A_MINOR / 2);

  tone({ freq: root, at: at - now(), dur: beat * 3.6, type: 'sine', peak: 0.16, bus: 'music', attack: 0.25 });
  tone({ freq: root * 1.5, at: at - now() + beat * 0.5, dur: beat * 2.6, type: 'sine', peak: 0.07, bus: 'music', attack: 0.3 });

  /* One soft mallet note a bar, wandering the scale. Enough to feel alive. */
  const step = PENTATONIC[(t.bar * 2 + 1) % PENTATONIC.length];
  tone({
    freq: hz(step + 12, A_MINOR), at: at - now() + beat * 2,
    dur: beat * 1.4, type: 'triangle', peak: 0.05, bus: 'music', attack: 0.05,
  });

  if (t.bar % 2 === 0) {
    noise({ at: at - now(), dur: 0.3, peak: 0.02, bus: 'music', type: 'highpass', freq: 6000, attack: 0.02 });
  }
}

/**
 * Race: a driving four-on-the-floor that gains layers as the field comes home.
 *
 * The thresholds are the point. Everything below is arrangement, not volume -
 * turning a track up to signal urgency just makes a loud room louder, while
 * adding a tambourine at the ninety percent mark is heard as "this is nearly
 * over" even by someone who is not listening.
 */
function raceBar(t: TrackState, at: number, beat: number): void {
  const i = t.intensity;
  const off = at - now();

  for (let b = 0; b < BEATS_PER_BAR; b++) {
    const beatAt = off + b * beat;

    /* Kick: the pulse, present from the gate. */
    tone({ freq: 110, at: beatAt, dur: 0.16, type: 'sine', peak: 0.3, bus: 'music', slideTo: 42, attack: 0.02 });

    /* Bass: root on 1 and 3, fifth on the off-beats once it gets going. */
    const bassStep = b % 2 === 0 ? 0 : i > 0.25 ? 7 : 0;
    tone({
      freq: hz(bassStep, A_MINOR / 2), at: beatAt, dur: beat * 0.85,
      type: 'sawtooth', peak: 0.075, bus: 'music', attack: 0.04,
    });

    /* Backbeat from a quarter of the way. */
    if (i > 0.25 && b % 2 === 1) {
      noise({ at: beatAt, dur: 0.19, peak: 0.11, bus: 'music', type: 'highpass', freq: 1400, attack: 0.01 });
    }

    /* Hats double up at halfway, then again in the run home. */
    if (i > 0.15) {
      const subdivisions = i > 0.5 ? 4 : 2;
      for (let s = 0; s < subdivisions; s++) {
        noise({
          at: beatAt + (s * beat) / subdivisions, dur: 0.05,
          peak: s % 2 ? 0.022 : 0.04, bus: 'music',
          type: 'highpass', freq: 8000, attack: 0.02,
        });
      }
    }
  }

  /* Arpeggio from halfway: eight notes climbing the pentatonic. */
  if (i > 0.45) {
    for (let s = 0; s < 8; s++) {
      const step = PENTATONIC[(t.bar * 3 + s) % PENTATONIC.length] + (s >= 5 ? 12 : 0);
      tone({
        freq: hz(step, A_MINOR), at: off + (s * beat) / 2, dur: beat * 0.42,
        type: 'square', peak: 0.032 + i * 0.022, bus: 'music', attack: 0.08,
      });
    }
  }

  /* The run home: an octave above, and a tambourine on every eighth. */
  if (i > 0.78) {
    for (let s = 0; s < 8; s++) {
      const step = PENTATONIC[(t.bar * 3 + s) % PENTATONIC.length];
      tone({
        freq: hz(step + 24, A_MINOR), at: off + (s * beat) / 2, dur: beat * 0.3,
        type: 'triangle', peak: 0.03, bus: 'music', attack: 0.06,
      });
      noise({ at: off + (s * beat) / 2, dur: 0.06, peak: 0.03, bus: 'music', type: 'highpass', freq: 10000, attack: 0.05 });
    }
  }
}

/** Winner: a short major fanfare over a held chord, then it gets out of the way. */
function winnerBar(t: TrackState, at: number, beat: number): void {
  const off = at - now();
  if (t.bar > 3) {
    stopTrack(1.4);
    return;
  }

  if (t.bar === 0) {
    [0, 4, 7, 12].forEach((s, k) =>
      tone({ freq: hz(s, 261.63), at: off + k * 0.11, dur: 1.5, type: 'triangle', peak: 0.16, bus: 'music', attack: 0.03 }),
    );
    tone({ freq: 130.81, at: off, dur: beat * 4, type: 'sine', peak: 0.2, bus: 'music', attack: 0.02 });
  }

  if (t.bar === 1 || t.bar === 2) {
    const chord = t.bar === 1 ? [5, 9, 12] : [7, 11, 14];
    chord.forEach((s, k) =>
      tone({ freq: hz(s, 261.63), at: off + k * 0.08, dur: beat * 3, type: 'triangle', peak: 0.1, bus: 'music', attack: 0.06 }),
    );
  }

  if (t.bar === 3) {
    [12, 16, 19, 24].forEach((s, k) =>
      tone({ freq: hz(s, 261.63), at: off + k * 0.09, dur: 2.2, type: 'triangle', peak: 0.14, bus: 'music', attack: 0.03 }),
    );
  }

  for (let b = 0; b < BEATS_PER_BAR; b++) {
    noise({ at: off + b * beat, dur: 0.12, peak: 0.06, bus: 'music', type: 'highpass', freq: 2000, attack: 0.01 });
  }
}

/* ── Crowd ─────────────────────────────────────────────────────────────── */

/**
 * The room itself: a low bed of filtered noise that never stops while the
 * stage is up, with the reactions in `sfx` riding on top of it.
 *
 * Without this the gaps between cues are digital silence, which is the one
 * thing that makes a synthesised soundtrack sound synthesised.
 */
export function startAmbience(): void {
  primeAudio();
  if (ambience || ambienceTimer) return;

  const supplied = playSample('crowd-bed', { bus: 'crowd', loop: true, gain: 0.5, fadeIn: 1.2 });
  if (supplied) {
    ambience = supplied;
    return;
  }

  const murmur = () => {
    if (!isMusicEnabled()) return;
    /* Overlapping four-second swells: no seam, and no loop to hear. */
    noise({ dur: 4.2, peak: 0.03, bus: 'crowd', type: 'bandpass', freq: 520, q: 0.7, attack: 0.4 });
    noise({ dur: 3.4, peak: 0.016, bus: 'crowd', type: 'bandpass', freq: 1400, q: 0.5, attack: 0.5 });
  };

  murmur();
  ambienceTimer = window.setInterval(murmur, 3000);
}

export function stopAmbience(): void {
  window.clearInterval(ambienceTimer);
  ambienceTimer = 0;
  fadeOut(ambience, 1);
  ambience = null;
}

/** Duck the music under a big moment, then bring it back. */
export function duck(seconds = 1.2, amount = 0.45): void {
  const bus = busNode('music');
  if (!bus) return;
  const t = now();
  bus.gain.cancelScheduledValues(t);
  const level = bus.gain.value;
  bus.gain.setValueAtTime(level, t);
  bus.gain.linearRampToValueAtTime(level * amount, t + 0.12);
  bus.gain.linearRampToValueAtTime(level, t + seconds);
}
