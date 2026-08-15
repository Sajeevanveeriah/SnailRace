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
    raceDurationMs: 20_000,
    surprises: true,
    raceType: 'Heat',
    raceNumber: 0,
    cashLedger: [],
    history: [],
    bets: [],
    chipBank: {},
    streaks: {},
    stageTheme: 'midnight',
    calm: false,
    sound: true,
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
      chipBank: parsed.chipBank && typeof parsed.chipBank === 'object' ? parsed.chipBank : {},
      streaks: parsed.streaks && typeof parsed.streaks === 'object' ? parsed.streaks : {},
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
