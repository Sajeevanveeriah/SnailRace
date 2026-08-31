'use client';

import { useSyncExternalStore } from 'react';
import { DEFAULT_NAMES, MAX_FIELD, MIN_LIVE_FIELD } from './palette';
import { normaliseCourseId } from './courses';
import { canonicalAuditEntry, sha256Hex } from './audit';
import type {
  AuditEntry,
  EventState,
  HeldRaceStartState,
  ShowPhase,
  SurpriseIntensity,
  VoidRecoveryState,
} from './types';

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

/*
 * The storage key is unchanged from v3 on purpose: a club laptop that ran a
 * v3 night upgrades in place, with `merge` performing the deterministic
 * v3-to-v4 migration on first load. Nothing is ever discarded by version.
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
    version: 4,
    eventId: newEventId(),
    clubName: 'Newcomb & District Cricket Club',
    eventName: 'Snail Racing Fundraiser',
    timezone: 'Australia/Melbourne',
    eventMode: 'live',
    plannedRaces: 6,
    rehearsal: false,
    showPhase: 'lobby',
    intensity: 'standard',
    racePack: null,
    packPlayed: [],
    packCurrent: null,
    phonePlay: null,
    heldRaceStart: null,
    voidRecovery: null,
    fieldSize: 8,
    names: DEFAULT_NAMES.slice(),
    goalCents: 100_000,
    goalShow: true,
    /*
     * 40 seconds a lap, three laps. Pace matters more than it looks: the
     * oval is about 2,200 course units round and a snail is 48 long, so a
     * 12-second lap has them covering five body-lengths a second, which
     * reads as a sprinting animal rather than a snail. 40 seconds is about
     * one length a second, which is brisk enough for a two-minute race-night film.
     */
    raceDurationMs: 120_000,
    trackShape: 'circuit',
    courseId: 'boundary-oval',
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
    audit: [],
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

/** The last JSON this tab wrote, so a foreign write is recognisable. */
let lastRaw: string | null = null;

function persist() {
  try {
    lastRaw = JSON.stringify(state);
    localStorage.setItem(KEY, lastRaw);
  } catch {
    /* Private browsing or a full quota. The night continues in memory. */
  }
}

/**
 * Re-read before writing when another tab got there first.
 *
 * Two open tabs both hold the night in memory, and the `storage` event that
 * keeps them aligned is asynchronous - so a bet placed in each tab within the
 * same beat used to have the second write silently drop the first. Functional
 * patches applied on top of the freshest persisted state close most of that
 * window; the stage being a single operator device closes the rest.
 */
function syncFromStorage() {
  if (!hydrated || typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null && raw !== lastRaw) {
      state = merge(raw);
      lastRaw = raw;
    }
  } catch {
    /* unreadable storage: keep the in-memory night */
  }
}

/**
 * Merge rather than replace. A saved night from an older build is missing the
 * newer keys, and a half-populated state object crashes the stage far away
 * from the line that caused it.
 */
const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

const HEX_64 = /^[a-f0-9]{64}$/i;

const validLiveFieldSize = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= MIN_LIVE_FIELD && Number(value) <= MAX_FIELD;

/**
 * Accept only a complete consequential plan as a reloadable start. A partial
 * JSON write must fail closed instead of letting Stage draw over a remote room
 * that may already have acknowledged the original plan hash.
 */
function validHeldRaceStart(value: unknown): HeldRaceStartState | null {
  if (!value || typeof value !== 'object') return null;
  const held = value as Partial<HeldRaceStartState>;
  const config = held.config;
  const plan = held.plan;
  const odds = held.oddsAtLock;
  const intensities: SurpriseIntensity[] = ['calm', 'standard', 'big', 'chaos'];
  const trackShapes = ['lanes', 'circuit'];
  const names = config?.names;

  if (
    !Number.isSafeInteger(held.raceNo) ||
    (held.raceNo ?? 0) < 1 ||
    typeof held.lockedAt !== 'number' ||
    !Number.isFinite(held.lockedAt) ||
    held.lockedAt <= 0 ||
    typeof held.startedAt !== 'number' ||
    !Number.isFinite(held.startedAt) ||
    held.startedAt <= 0 ||
    typeof held.commitHash !== 'string' ||
    !HEX_64.test(held.commitHash) ||
    typeof held.planHash !== 'string' ||
    !HEX_64.test(held.planHash) ||
    !config ||
    config.raceNo !== held.raceNo ||
    typeof config.raceType !== 'string' ||
    !config.raceType.trim() ||
    !validLiveFieldSize(config.fieldSize) ||
    !Array.isArray(names) ||
    names.length !== config.fieldSize ||
    names.some((name) => typeof name !== 'string' || !name.trim()) ||
    !Number.isFinite(config.durationMs) ||
    config.durationMs <= 0 ||
    !Number.isSafeInteger(config.laps) ||
    config.laps < 1 ||
    typeof config.surprises !== 'boolean' ||
    !trackShapes.includes(config.trackShape) ||
    (config.courseId !== undefined && normaliseCourseId(config.courseId) !== config.courseId) ||
    !intensities.includes(config.intensity) ||
    !odds ||
    typeof odds !== 'object' ||
    !plan ||
    plan.schema !== 1 ||
    plan.engine !== 'consequential-eight-v1' ||
    !Number.isSafeInteger(plan.seed) ||
    typeof plan.seedHex !== 'string' ||
    !/^[a-f0-9]{8}$/i.test(plan.seedHex) ||
    !Array.isArray(plan.names) ||
    plan.names.length !== config.fieldSize ||
    !Array.isArray(plan.runners) ||
    plan.runners.length !== config.fieldSize ||
    !Array.isArray(plan.events) ||
    !Array.isArray(plan.cues) ||
    !Array.isArray(plan.results) ||
    plan.results.length !== config.fieldSize ||
    plan.durationMs !== config.durationMs ||
    plan.laps !== config.laps ||
    plan.surprises !== config.surprises ||
    plan.trackShape !== config.trackShape ||
    plan.courseId !== config.courseId ||
    plan.intensity !== config.intensity ||
    plan.names.some((name, lane) => name !== names[lane]) ||
    !Number.isSafeInteger(plan.winnerLane) ||
    plan.winnerLane < 0 ||
    plan.winnerLane >= config.fieldSize ||
    !Number.isFinite(plan.stopAtMs) ||
    plan.stopAtMs <= 0
  ) {
    return null;
  }

  const lanes = Array.from({ length: config.fieldSize }, (_, lane) => lane);
  if (
    lanes.some(
      (lane) =>
        typeof odds[lane] !== 'number' ||
        !Number.isFinite(odds[lane]) ||
        odds[lane] <= 0 ||
        plan.runners.filter((runner) => runner.lane === lane).length !== 1 ||
        plan.results.filter((result) => result.lane === lane).length !== 1,
    )
  ) {
    return null;
  }

  return held as HeldRaceStartState;
}

function merge(raw: string | null): EventState {
  const base = freshState();
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<EventState>;
    const names = Array.isArray(parsed.names) ? parsed.names.slice(0, MAX_FIELD) : base.names;
    while (names.length < MAX_FIELD) names.push(DEFAULT_NAMES[names.length % DEFAULT_NAMES.length]);
    const phases: ShowPhase[] = [
      'lobby', 'racecard', 'market', 'race', 'results', 'championship', 'intermission', 'finale',
    ];
    const intensities: SurpriseIntensity[] = ['calm', 'standard', 'big', 'chaos'];
    const heldRaceStart = validHeldRaceStart(parsed.heldRaceStart);
    const recoveryValue = parsed.voidRecovery as VoidRecoveryState | null | undefined;
    const recoveryShow = recoveryValue?.openShow;
    const voidRecovery =
      recoveryValue &&
      Number.isSafeInteger(recoveryValue.raceNo) &&
      recoveryValue.raceNo > 0 &&
      typeof recoveryValue.planHash === 'string' &&
      HEX_64.test(recoveryValue.planHash) &&
      typeof recoveryValue.reason === 'string' &&
      recoveryValue.reason.trim().length > 0 &&
      recoveryValue.reason.length <= 120 &&
      recoveryShow &&
      typeof recoveryShow === 'object' &&
      recoveryShow.raceNo === recoveryValue.raceNo &&
      recoveryShow.marketOpen === true &&
      Array.isArray(recoveryShow.names) &&
      validLiveFieldSize(recoveryShow.names.length)
        ? recoveryValue
        : null;
    return {
      ...base,
      ...parsed,
      version: 4,
      /* v3 nights predate these; every default is deterministic. */
      timezone: typeof parsed.timezone === 'string' && parsed.timezone ? parsed.timezone : base.timezone,
      eventMode: parsed.eventMode === 'recorded' ? 'recorded' : 'live',
      plannedRaces: Math.min(12, Math.max(1, Number(parsed.plannedRaces) || base.plannedRaces)),
      rehearsal: parsed.rehearsal === true,
      showPhase: phases.includes(parsed.showPhase as ShowPhase)
        ? (parsed.showPhase as ShowPhase)
        : 'lobby',
      intensity: intensities.includes(parsed.intensity as SurpriseIntensity)
        ? (parsed.intensity as SurpriseIntensity)
        : parsed.surprises === false
          ? 'calm'
          : 'standard',
      racePack:
        parsed.racePack && typeof parsed.racePack === 'object' && Array.isArray(parsed.racePack.races)
          ? parsed.racePack
          : null,
      packPlayed: Array.isArray(parsed.packPlayed)
        ? parsed.packPlayed.filter((x): x is string => typeof x === 'string')
        : [],
      packCurrent: typeof parsed.packCurrent === 'string' ? parsed.packCurrent : null,
      phonePlay:
        parsed.phonePlay && typeof parsed.phonePlay === 'object' && typeof parsed.phonePlay.code === 'string'
          ? parsed.phonePlay
          : null,
      heldRaceStart,
      voidRecovery,
      names,
      fieldSize: validLiveFieldSize(parsed.fieldSize) ? parsed.fieldSize : base.fieldSize,
      courseId: normaliseCourseId(parsed.courseId),
      cashLedger: Array.isArray(parsed.cashLedger) ? parsed.cashLedger : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      bets: Array.isArray(parsed.bets) ? parsed.bets : [],
      sponsors: Array.isArray(parsed.sponsors)
        ? parsed.sponsors.filter((x): x is string => typeof x === 'string')
        : [],
      chipBank: parsed.chipBank && typeof parsed.chipBank === 'object' ? parsed.chipBank : {},
      streaks: parsed.streaks && typeof parsed.streaks === 'object' ? parsed.streaks : {},
      audit: Array.isArray(parsed.audit) ? parsed.audit : [],
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
  reanchorChain();
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    state = merge(e.newValue);
    lastRaw = e.newValue;
    emit();
  });
  emit();
}

export function setState(patch: Partial<EventState> | ((s: EventState) => Partial<EventState>)) {
  /* Functional patches see the freshest persisted state, so concurrent tabs
     converge instead of clobbering each other's ledger writes. */
  if (typeof patch === 'function') syncFromStorage();
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  persist();
  emit();
}

/** How much audit trail a night keeps. A cap, not a design size. */
const AUDIT_CAP = 500;

/*
 * The chain head: the entryHash of the newest chained entry. Hashing is
 * async (SHA-256), so writes are serialised through one promise queue - the
 * chain order is the insertion order even when two entries land in the same
 * millisecond. The head re-anchors from storage on hydrate and restore.
 */
let chainHead = '';
let chainQueue: Promise<void> = Promise.resolve();

function reanchorChain() {
  chainHead = state.audit.find((a) => a.entryHash)?.entryHash ?? '';
}

/** Append one line to the audit trail. Newest first, capped, never edited. */
export function addAudit(entry: Omit<AuditEntry, 'id' | 'at' | 'prevHash' | 'entryHash'>) {
  const full: AuditEntry = { ...entry, id: newAuditId(), at: Date.now() };
  setState((s) => ({
    audit: [full, ...s.audit].slice(0, AUDIT_CAP),
  }));
  chainQueue = chainQueue.then(async () => {
    const prevHash = chainHead;
    const entryHash = await sha256Hex(prevHash + canonicalAuditEntry(full));
    chainHead = entryHash;
    setState((s) => ({
      audit: s.audit.map((a) => (a.id === full.id ? { ...a, prevHash, entryHash } : a)),
    }));
  });
}

/** Let tests and exports wait for in-flight chain hashes to settle. */
export const auditChainSettled = (): Promise<void> => chainQueue.then(() => undefined);

function newAuditId(): string {
  const buf = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  return `au${Date.now().toString(36)}${buf[0].toString(36)}`;
}

export function resetEvent() {
  state = freshState();
  persist();
  emit();
}

/** Replace the whole night, used by the backup restore. Returns false if unusable. */
export function restore(raw: string): boolean {
  /* A backup that does not even parse must refuse, never quietly become a
     fresh night: refusing loses nothing, "restoring" it loses the event. */
  try {
    const probe = JSON.parse(raw) as { eventId?: unknown } | null;
    if (!probe || typeof probe !== 'object' || typeof probe.eventId !== 'string' || !probe.eventId) {
      return false;
    }
  } catch {
    return false;
  }
  const next = merge(raw);
  if (!next.eventId) return false;
  state = next;
  reanchorChain();
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

/** The state as it stands right now - for reads after an awaited settle. */
export const currentState = (): EventState => state;
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
