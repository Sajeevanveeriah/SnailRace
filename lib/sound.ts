'use client';

import { noise, playSample, primeAudio, setEnabled, setMusicEnabled, tone } from './audio/engine';
import { duck, stopAmbience, stopTrack } from './audio/music';

/**
 * Every cue the night makes.
 *
 * Synthesised, for the reasons in `lib/audio/engine.ts`. Two rules hold the
 * set together:
 *
 *   - Direction carries meaning. Anything good rises in pitch and anything
 *     bad falls, so a punter at the bar with their back to the screen knows
 *     whether their snail just got a boost or fell asleep.
 *   - The crowd answers the track. Every race cue has a matching reaction on
 *     the crowd bus, because a race with no room in it sounds like a
 *     screensaver.
 */

export {
  primeAudio,
  setLevels,
  getLevels,
  sampleReport,
  samplesSettled,
  DEFAULT_LEVELS,
  type AudioLevels,
} from './audio/engine';

export {
  startTrack,
  stopTrack,
  setIntensity,
  startAmbience,
  stopAmbience,
  duck,
} from './audio/music';

export function setSoundEnabled(on: boolean) {
  setEnabled(on);
  if (!on) {
    stopTrack(0.25);
    stopAmbience();
  }
}

export function setMusicOn(on: boolean) {
  setMusicEnabled(on);
  if (!on) stopTrack(0.4);
}

/** Preview the whole set from the console, so a venue can be checked cold. */
export const soundCheck = () => {
  primeAudio();
  const order = [
    () => sfx.beep(), () => sfx.go(), () => sfx.coin(), () => sfx.chip(),
    () => sfx.boost(), () => sfx.stumble(), () => sfx.leadChange(), () => sfx.bell(),
    () => sfx.photo(), () => sfx.fanfare(),
  ];
  order.forEach((play, i) => window.setTimeout(play, i * 620));
};

/* ── Crowd reactions ───────────────────────────────────────────────────── */

/**
 * A human noise from filtered noise.
 *
 * A crowd is broadband and slow: a bandpass around the voice range with a
 * long attack reads as people, where the same burst with a fast attack reads
 * as a drum. `sweepTo` is what separates a cheer (rising) from a groan.
 */
const crowd = {
  cheer: (size = 1) => {
    if (playSample('crowd-cheer', { bus: 'crowd', gain: 0.5 * size })) return;
    noise({ dur: 1.5 * size, peak: 0.1 * size, bus: 'crowd', type: 'bandpass', freq: 700, sweepTo: 1500, q: 0.6, attack: 0.18 });
    noise({ dur: 1.2 * size, peak: 0.05 * size, bus: 'crowd', type: 'highpass', freq: 2200, attack: 0.22 });
  },
  gasp: (size = 1) => {
    if (playSample('crowd-gasp', { bus: 'crowd', gain: 0.5 * size })) return;
    noise({ dur: 0.85 * size, peak: 0.075 * size, bus: 'crowd', type: 'bandpass', freq: 1300, sweepTo: 480, q: 0.8, attack: 0.14 });
  },
  /* The one that runs long: for the run home and the finish. */
  roar: (size = 1) => {
    if (playSample('crowd-cheer', { bus: 'crowd', gain: 0.75 * size })) return;
    noise({ dur: 2.8 * size, peak: 0.13 * size, bus: 'crowd', type: 'bandpass', freq: 620, sweepTo: 1250, q: 0.5, attack: 0.3 });
    noise({ dur: 2.4 * size, peak: 0.06 * size, bus: 'crowd', type: 'highpass', freq: 2600, attack: 0.35 });
    /* Scattered claps: short bursts on an uneven grid so it is not a machine. */
    for (let i = 0; i < 14; i++) {
      noise({ at: 0.25 + i * 0.11 + Math.random() * 0.07, dur: 0.05, peak: 0.03 * size, bus: 'crowd', type: 'highpass', freq: 3400, attack: 0.02 });
    }
  },
};

export const sfx = {
  /* ── Countdown and start ──────────────────────────────────────────── */

  beep: () => tone({ freq: 660, dur: 0.16, type: 'square', peak: 0.1 }),

  /** The off. A horn, a kick and the room coming up all at once. */
  go: () => {
    if (!playSample('sfx-horn', { gain: 0.7 })) {
      tone({ freq: 440, dur: 0.55, type: 'sawtooth', peak: 0.15, slideTo: 660, attack: 0.02 });
      tone({ freq: 880, at: 0.04, dur: 0.5, type: 'square', peak: 0.1 });
      tone({ freq: 1320, at: 0.08, dur: 0.42, type: 'triangle', peak: 0.07 });
    }
    tone({ freq: 90, dur: 0.3, type: 'sine', peak: 0.3, slideTo: 40, attack: 0.01 });
    crowd.roar(0.8);
    duck(1.4, 0.6);
  },

  /** The gates going up, under the countdown. */
  gate: () => {
    noise({ dur: 0.3, peak: 0.09, type: 'bandpass', freq: 2400, sweepTo: 700, q: 1.4, attack: 0.01 });
    tone({ freq: 200, dur: 0.2, type: 'square', peak: 0.05, slideTo: 120, attack: 0.01 });
  },

  /** Snare roll under the "3, 2, 1", tightening as it goes. */
  drumroll: (seconds = 2.4) => {
    const hits = Math.round(seconds * 16);
    for (let i = 0; i < hits; i++) {
      const u = i / hits;
      noise({
        at: (i / hits) * seconds, dur: 0.05,
        peak: 0.02 + u * 0.055, type: 'highpass', freq: 1600, attack: 0.02,
      });
    }
  },

  /* ── Money ────────────────────────────────────────────────────────── */

  coin: () => {
    tone({ freq: 880, dur: 0.1, type: 'triangle', peak: 0.12 });
    tone({ freq: 1320, at: 0.07, dur: 0.16, type: 'triangle', peak: 0.1 });
  },

  chip: () => {
    tone({ freq: 520, dur: 0.08, type: 'sine', peak: 0.09 });
    tone({ freq: 780, at: 0.05, dur: 0.12, type: 'sine', peak: 0.07 });
  },

  milestone: () => {
    [659.25, 880, 1174.66].forEach((f, i) =>
      tone({ freq: f, at: i * 0.1, dur: 0.34, type: 'sine', peak: 0.14 }),
    );
    crowd.cheer(0.6);
  },

  /* ── In-race ──────────────────────────────────────────────────────── */

  /** A surprise that helped: rising whoop, and the room with it. */
  boost: () => {
    [523.25, 698.46, 1046.5].forEach((f, i) =>
      tone({ freq: f, at: i * 0.055, dur: 0.2, type: 'triangle', peak: 0.13 }),
    );
    tone({ freq: 400, dur: 0.3, type: 'sawtooth', peak: 0.05, slideTo: 1200, attack: 0.02 });
    crowd.cheer(0.7);
  },

  /** A surprise that hurt: the same shape, falling and duller. */
  stumble: () => {
    [392, 294, 208].forEach((f, i) =>
      tone({ freq: f, at: i * 0.07, dur: 0.24, type: 'sine', peak: 0.11 }),
    );
    noise({ dur: 0.35, peak: 0.05, type: 'lowpass', freq: 900, sweepTo: 200, attack: 0.05 });
    crowd.gasp(0.8);
  },

  /** The lead changes hands. Two stabs, so it cuts through a noisy room. */
  leadChange: () => {
    tone({ freq: 880, dur: 0.12, type: 'square', peak: 0.13 });
    tone({ freq: 1174.66, at: 0.1, dur: 0.22, type: 'square', peak: 0.12 });
    crowd.cheer(0.9);
    duck(0.9, 0.55);
  },

  /** Halfway. One clang of the lap bell. */
  bell: () => {
    tone({ freq: 1568, dur: 0.55, type: 'sine', peak: 0.12 });
    tone({ freq: 2093, at: 0.02, dur: 0.4, type: 'sine', peak: 0.06 });
    tone({ freq: 3136, at: 0.01, dur: 0.25, type: 'sine', peak: 0.03 });
  },

  /** Into the run home: the room stands up. */
  finalStraight: () => {
    tone({ freq: 330, dur: 0.9, type: 'sawtooth', peak: 0.07, slideTo: 660, attack: 0.5 });
    crowd.roar(0.7);
  },

  photo: () => {
    tone({ freq: 180, dur: 0.5, type: 'sawtooth', peak: 0.09 });
    tone({ freq: 240, at: 0.12, dur: 0.45, type: 'sawtooth', peak: 0.07 });
    /* Camera motor drive, because the banner says PHOTO FINISH. */
    for (let i = 0; i < 6; i++) {
      noise({ at: i * 0.09, dur: 0.04, peak: 0.05, type: 'highpass', freq: 5000, attack: 0.02 });
    }
    crowd.roar(1);
    duck(2, 0.4);
  },

  fanfare: () => {
    if (!playSample('sfx-fanfare', { gain: 0.8 })) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone({ freq: f, at: i * 0.13, dur: 0.42, type: 'triangle', peak: 0.17 }),
      );
    }
    crowd.roar(1.1);
  },

  crowd,
};
