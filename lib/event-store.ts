'use client';

import { useSyncExternalStore } from 'react';
import { DEFAULT_NAMES, MAX_FIELD, MIN_FIELD } from './palette';
import type { EventState } from './types';

/**
 * The moderator's night lives on the moderator's device.
 *
 * Card donations are held by Stripe and read back over the network, but the
 * line-up, the goal, the cash tin entries, the results and the play-money bet
 * book are local. That keeps the app deployable with no database, and it
 * means a dropped connection costs the club its live card feed and nothing
 * else - the race still runs and cash still records.
 *
 * The store is a plain module singleton behind `useSyncExternalStore`, which
 * also gives us cross-tab sync for free through the `storage` event.
 */

const KEY = 'ndcc-snailrace-v3';

/*
 * The shipped mix. A night saved under an older revision has its levels reset
 * to the current defaults on load: the first mix was set far too conservative
 * and a club that had already run a night would otherwise keep it forever.
 */
const AUDIO_REV = 3;

function newEventId(): string {
  const buf = new Uint32Array(2);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  return `ev${Date.now().toString(36)}${buf[0].toString(36)}`.slice(0, 24);
}

export function freshState(): EventState {
  return {
    version: 3,
    eventId: newEventId(),
    clubName: 'Newcomb & District Cricket Club',
    eventName: 'Snail Racing Fundraiser',
    fieldSize: 6,
    names: DEFAULT_NAMES.slice(),
    goalCents: 100_000,
    goalShow: true,
    /*
     * 45 seconds a lap, three laps. Pace matters more than it looks: the
     * oval is about 2,200 course units round and a snail is 48 long, so a
     * 12-second lap has them covering five body-lengths a second, which
     * reads as a sprinting animal rather than a snail. 45 seconds is about
     * one length a second, which is brisk for a snail and still a race.
     */
    raceDurationMs: 135_000,
    trackShape: 'circuit',
    courseId: 'oval',
    laps: 3,
    chaseCam: true,
    surprises: true,
    raceType: 'Heat',
    raceNumber: 0,
    sponsors: [],
    cashLedger: [],
    history: [],
    bets: [],
    chipBank: {},
    streaks: {},
    stageTheme: 'midnight',
    calm: false,
    sound: true,
    music: true,
    caller: true,
    audioRev: AUDIO_REV,
    volume: 1,
    musicVolume: 0.72,
    bettingOpen: true,
    startedAt: Date.now(),
  };
}

let state: EventState = freshState();
let hydrated = false;
const listeners = new Set<() => void>();

/** `useSyncExternalStore` compares by reference, so every write makes a new object. */
function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* Private browsing or a full quota. The night continues in memory. */
  }
}

/**
 * Merge rather than replace. A saved night from an older build is missing the
 * newer keys, and a half-populated state object crashes the stage far away
 * from the line that caused it.
 */
const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

function merge(raw: string | null): EventState {
  const base = freshState();
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<EventState>;
    const names = Array.isArray(parsed.names) ? parsed.names.slice(0, MAX_FIELD) : base.names;
    while (names.length < MAX_FIELD) names.push(DEFAULT_NAMES[names.length % DEFAULT_NAMES.length]);
    return {
      ...base,
      ...parsed,
      version: 3,
      names,
      fieldSize: Math.min(MAX_FIELD, Math.max(MIN_FIELD, Number(parsed.fieldSize) || base.fieldSize)),
      cashLedger: Array.isArray(parsed.cashLedger) ? parsed.cashLedger : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      bets: Array.isArray(parsed.bets) ? parsed.bets : [],
      sponsors: Array.isArray(parsed.sponsors)
        ? parsed.sponsors.filter((x): x is string => typeof x === 'string')
        : [],
      chipBank: parsed.chipBank && typeof parsed.chipBank === 'object' ? parsed.chipBank : {},
      streaks: parsed.streaks && typeof parsed.streaks === 'object' ? parsed.streaks : {},
      /* Levels are clamped on the way in: a hand-edited backup with a volume
         of 40 would hit the limiter hard enough to sound broken. */
      laps: Math.min(9, Math.max(1, Number(parsed.laps) || base.laps)),
      ...(Number(parsed.audioRev) === AUDIO_REV
        ? {
            volume: clamp01(parsed.volume, base.volume),
            musicVolume: clamp01(parsed.musicVolume, base.musicVolume),
          }
        : { audioRev: AUDIO_REV, volume: base.volume, musicVolume: base.musicVolume }),
    };
  } catch {
    return base;
  }
}

export function hydrate() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  state = merge(localStorage.getItem(KEY));
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    state = merge(e.newValue);
    emit();
  });
  emit();
}

export function setState(patch: Partial<EventState> | ((s: EventState) => Partial<EventState>)) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  persist();
  emit();
}

export function resetEvent() {
  state = freshState();
  persist();
  emit();
}

/** Replace the whole night, used by the backup restore. Returns false if unusable. */
export function restore(raw: string): boolean {
  const next = merge(raw);
  if (!next.eventId) return false;
  state = next;
  persist();
  emit();
  return true;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => state;
/*
 * The server renders the default night, never a restored one: localStorage is
 * not readable there, and returning a different object on the server than on
 * the first client render is exactly what produces a hydration mismatch.
 */
const serverState = freshState();
const getServerSnapshot = () => serverState;

export function useEvent(): EventState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
