'use client';

import {
  busNode,
  fadeOut,
  isEnabled,
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
  crowdLevel = Math.min(1, Math.max(0, value));
  if (!track) return;
  track.intensity = crowdLevel;
}

/**
 * How wound up the room is, 0 to 1.
 *
 * The bed used to sit at one level for the whole night, and a crowd that
 * sounds identical at the gate and at the line is a crowd nobody notices -
 * which is why the room's verdict was that there were no crowd sounds at all.
 * Driven from the same number that thickens the music, so as the leader comes
 * home the hall gets louder, busier and higher without anything having to be
 * cued by hand.
 */
let crowdLevel = 0;

/** Set directly for the moments the race clock does not describe. */
export function setCrowdLevel(value: number): void {
  crowdLevel = Math.min(1, Math.max(0, value));
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
  if (active.id === 'lobby') lobbyBar(active, start, secondsPerBeat);
  else if (active.id === 'race') raceBar(active, start, secondsPerBeat);
  else winnerBar(active, start, secondsPerBeat);

  /* A bar may deliberately stop or replace the current track. Do not touch
     the shared slot after that transition - winnerBar ends its own fanfare. */
  if (track !== active) return;

  active.bar += 1;
  active.nextBarAt = start + barLength;

  const wait = Math.max(20, (active.nextBarAt - now() - SCHEDULE_AHEAD) * 1000);
  active.timer = window.setTimeout(tick, wait);
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

  tone({ freq: root, at: at - now(), dur: beat * 3.6, type: 'sine', peak: 0.304, bus: 'music', attack: 0.25 });
  tone({ freq: root * 1.5, at: at - now() + beat * 0.5, dur: beat * 2.6, type: 'sine', peak: 0.133, bus: 'music', attack: 0.3 });

  /* One soft mallet note a bar, wandering the scale. Enough to feel alive. */
  const step = PENTATONIC[(t.bar * 2 + 1) % PENTATONIC.length];
  tone({
    freq: hz(step + 12, A_MINOR), at: at - now() + beat * 2,
    dur: beat * 1.4, type: 'triangle', peak: 0.095, bus: 'music', attack: 0.05,
  });

  if (t.bar % 2 === 0) {
    noise({ at: at - now(), dur: 0.3, peak: 0.038, bus: 'music', type: 'highpass', freq: 6000, attack: 0.02 });
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
    tone({ freq: 110, at: beatAt, dur: 0.16, type: 'sine', peak: 0.5, bus: 'music', slideTo: 42, attack: 0.02 });

    /* Bass: root on 1 and 3, fifth on the off-beats once it gets going. */
    const bassStep = b % 2 === 0 ? 0 : i > 0.25 ? 7 : 0;
    tone({
      freq: hz(bassStep, A_MINOR / 2), at: beatAt, dur: beat * 0.85,
      type: 'sawtooth', peak: 0.1425, bus: 'music', attack: 0.04,
    });

    /* Backbeat from a quarter of the way. */
    if (i > 0.25 && b % 2 === 1) {
      noise({ at: beatAt, dur: 0.19, peak: 0.209, bus: 'music', type: 'highpass', freq: 1400, attack: 0.01 });
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
        type: 'square', peak: 0.0608 + i * 0.022, bus: 'music', attack: 0.08,
      });
    }
  }

  /* The run home: an octave above, and a tambourine on every eighth. */
  if (i > 0.78) {
    for (let s = 0; s < 8; s++) {
      const step = PENTATONIC[(t.bar * 3 + s) % PENTATONIC.length];
      tone({
        freq: hz(step + 24, A_MINOR), at: off + (s * beat) / 2, dur: beat * 0.3,
        type: 'triangle', peak: 0.057, bus: 'music', attack: 0.06,
      });
      noise({ at: off + (s * beat) / 2, dur: 0.06, peak: 0.057, bus: 'music', type: 'highpass', freq: 10000, attack: 0.05 });
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
      tone({ freq: hz(s, 261.63), at: off + k * 0.11, dur: 1.5, type: 'triangle', peak: 0.304, bus: 'music', attack: 0.03 }),
    );
    tone({ freq: 130.81, at: off, dur: beat * 4, type: 'sine', peak: 0.38, bus: 'music', attack: 0.02 });
  }

  if (t.bar === 1 || t.bar === 2) {
    const chord = t.bar === 1 ? [5, 9, 12] : [7, 11, 14];
    chord.forEach((s, k) =>
      tone({ freq: hz(s, 261.63), at: off + k * 0.08, dur: beat * 3, type: 'triangle', peak: 0.19, bus: 'music', attack: 0.06 }),
    );
  }

  if (t.bar === 3) {
    [12, 16, 19, 24].forEach((s, k) =>
      tone({ freq: hz(s, 261.63), at: off + k * 0.09, dur: 2.2, type: 'triangle', peak: 0.266, bus: 'music', attack: 0.03 }),
    );
  }

  for (let b = 0; b < BEATS_PER_BAR; b++) {
    noise({ at: off + b * beat, dur: 0.12, peak: 0.114, bus: 'music', type: 'highpass', freq: 2000, attack: 0.01 });
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

  /*
   * A room is not one noise, it is many people at slightly different pitches
   * doing slightly different things. Two filtered swells read as wind; adding
   * a low body, a chest band, scattered single voices and the occasional
   * clap or whistle is what makes it read as people in a hall.
   */
  const murmur = () => {
    /*
     * Gated on sound, not on music. The crowd is not part of the soundtrack -
     * it is the venue - and switching the music off used to take the room with
     * it, which is the most likely reason a night reported "no crowd sounds".
     */
    if (!isEnabled()) return;

    /*
     * Everything below scales with how wound up the room is. At the gate it
     * is a hall of people talking; at the line it is a hall of people
     * shouting, roughly two and a half times as loud with three times the
     * claps and voices in it.
     */
    const k = 1 + crowdLevel * 1.5;

    /* Overlapping swells at three heights: no seam, and no loop to hear. */
    noise({ dur: 4.6, peak: 0.115 * k, bus: 'crowd', type: 'bandpass', freq: 240, q: 0.6, attack: 0.45 });
    noise({ dur: 4.2, peak: 0.132 * k, bus: 'crowd', type: 'bandpass', freq: 520, q: 0.7, attack: 0.4 });
    noise({ dur: 3.4, peak: 0.07 * k, bus: 'crowd', type: 'bandpass', freq: 1400, q: 0.5, attack: 0.5 });

    /*
     * Individual voices. Narrow bands wandering the speech range at
     * unrepeatable offsets, which is what stops the bed sounding like a
     * machine holding one note.
     */
    for (let i = 0; i < 3 + Math.round(crowdLevel * 6); i++) {
      noise({
        at: Math.random() * 2.8,
        dur: 0.5 + Math.random() * 0.9,
        peak: (0.026 + Math.random() * 0.03) * k,
        bus: 'crowd',
        type: 'bandpass',
        freq: 380 + Math.random() * 900,
        q: 5 + Math.random() * 6,
        attack: 0.3,
      });
    }

    /* Claps and whistles: a handful when the room is idle, a scatter of them
       when it is on its feet. */
    for (let i = 0; i < 1 + Math.round(crowdLevel * 7); i++) {
      if (Math.random() > 0.55 + crowdLevel * 0.4) continue;
      noise({
        at: Math.random() * 2.8, dur: 0.05, peak: 0.09 * k,
        bus: 'crowd', type: 'highpass', freq: 2600, attack: 0.02,
      });
    }
    if (Math.random() < 0.12 + crowdLevel * 0.4) {
      tone({
        freq: 1900 + Math.random() * 500, at: Math.random() * 2.5, dur: 0.32,
        type: 'sine', peak: 0.05 * k, bus: 'crowd', slideTo: 2500, attack: 0.25,
      });
    }
  };

  murmur();
  ambienceTimer = window.setInterval(murmur, 2200);
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
