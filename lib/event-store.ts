'use client';

import { useSyncExternalStore } from 'react';
import { DEFAULT_NAMES, MAX_FIELD, MIN_LIVE_FIELD } from './palette';
import { normaliseCourseId, normaliseTrackDesigns } from './courses';
import { canonicalAuditEntry, sha256Hex } from './audit';
import { DEFAULT_CASH_TOTE, normaliseCashTote } from './cash-tote';
import { DEFAULT_CARD, DEFAULT_RACE_TYPE, RACES_ON_CARD, SNAILS_PER_RACE, freshCard, normaliseCard, snailCountLock } from './card';
import type { CardState } from './card';
import { NDCC_NIGHT_RACES, ndccCard, ndccRaceSponsors, normaliseRaceSponsors } from './ndcc-night';
import { DEFAULT_QUADDIE, normaliseQuaddie, validQuaddieEntry } from './quaddie';
import type {
  AuctionBid,
  AudioMode,
  AuditEntry,
  CameraMode,
  EventState,
  ToteSale,
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

/**
 * A fresh night in the browser starts from the club's sold card (see
 * `ndcc-night.ts`). Unit tests run without a window, and the browser tests
 * build with NEXT_PUBLIC_NIGHT_PRESET=off, so both keep the generic card of
 * one hundred numbered snails they were written against.
 */
const nightPreset = (): boolean =>
  typeof window !== 'undefined' && process.env.NEXT_PUBLIC_NIGHT_PRESET !== 'off';

/** Bounds on the snail speed setting, as a multiple of the standard pace. */
export const SNAIL_SPEED_MIN = 0.5;
export const SNAIL_SPEED_MAX = 3;
export const clampSnailSpeed = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(SNAIL_SPEED_MAX, Math.max(SNAIL_SPEED_MIN, Math.round(n * 100) / 100));
};

export function freshState(preset: boolean = nightPreset()): EventState {
  const card = preset ? ndccCard() : freshCard();
  return {
    version: 4,
    eventId: newEventId(),
    clubName: 'Newcomb & District Cricket Club',
    eventName: 'Snail Racing',
    eventTagline: 'A night at the races',
    eventDate: '2026-10-24',
    startTime: '19:00',
    venue: 'Club rooms',
    backingCents: card.snailCents,
    timezone: 'Australia/Melbourne',
    eventMode: 'live',
    plannedRaces: preset ? NDCC_NIGHT_RACES : RACES_ON_CARD,
    championshipScreens: false,
    rehearsal: false,
    showPhase: 'lobby',
    intensity: preset ? 'chaos' : 'standard',
    racePack: null,
    packPlayed: [],
    packCurrent: null,
    phonePlay: null,
    heldRaceStart: null,
    voidRecovery: null,
    fieldSize: SNAILS_PER_RACE,
    names: DEFAULT_NAMES.slice(),
    goalCents: 100_000,
    goalShow: false,
    /* Thirty seconds, one of the listed lengths: on the straight that is the
       whole race; switch a circuit on and it becomes the lap length. */
    raceDurationMs: 30_000,
    /* The side-on cartoon straight is the night's race view; the oval stays
       as an option in Admin. */
    trackShape: 'lanes',
    courseId: 'boundary-oval',
    trackDesigns: null,
    laps: 1,
    surprises: true,
    raceType: DEFAULT_RACE_TYPE,
    raceNumber: 0,
    sponsors: [],
    raceSponsors: preset ? ndccRaceSponsors() : [],
    snailSpeed: 1,
    runnerSponsors: [],
    card,
    quaddie: { ...DEFAULT_QUADDIE, legs: DEFAULT_QUADDIE.legs.slice() },
    quaddieEntries: [],
    audioMode: 'music',
    cameraMode: 'telecast',
    dealtCards: [],
    cashTote: { ...DEFAULT_CASH_TOTE },
    toteSales: [],
    auctionBids: [],
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
    caller: false,
    audioRev: AUDIO_REV,
    volume: 1,
    musicVolume: 0.72,
    bettingOpen: true,
    startedAt: Date.now(),
  };
}

/* Until hydrate() reads the browser, the store holds what the server rendered. */
let state: EventState = freshState(false);
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
  const intensities: SurpriseIntensity[] = ['calm', 'standard', 'big', 'chaos', 'mayhem'];
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
    /* The market and the interval left the run of show with the card night;
       a saved night parked on one reopens on the nearest surviving screen. */
    const phases: ShowPhase[] = ['lobby', 'racecard', 'race', 'results', 'championship', 'finale'];
    const audioModes: AudioMode[] = ['music', 'commentary', 'both', 'off'];
    const cameraModes: CameraMode[] = ['telecast', 'full'];
    /* A card saved before the run sheet becomes the races its split gave.
       A night saved before 5.4 keeps the split its snails were sold into
       whenever anything on the record is tied to a lane: a race run, a
       quaddie ticket, a tote sale, a bid, cash taken or an armed race (the
       same records that lock the snail count). Its card carries no split
       marker, so those records decide. A card with none takes the even split. */
    const showPhase: ShowPhase = phases.includes(parsed.showPhase as ShowPhase)
      ? (parsed.showPhase as ShowPhase)
      : parsed.showPhase === 'market'
        ? 'racecard'
        : 'lobby';
    /* An armed race belongs to the race screen. One saved with the show on
       any other screen was left behind by a reset or an old build, and
       would hold every show control with nothing on screen: it is dropped. */
    const heldRaceStart = showPhase === 'race' ? validHeldRaceStart(parsed.heldRaceStart) : null;
    const live = <T extends { void?: boolean }>(list: unknown): T[] =>
      Array.isArray(list) ? (list as T[]).filter((x) => x && typeof x === 'object') : [];
    const tied =
      snailCountLock(
        {
          history: live(parsed.history),
          quaddieEntries: live(parsed.quaddieEntries),
          toteSales: live(parsed.toteSales),
          auctionBids: live(parsed.auctionBids),
          cashLedger: live(parsed.cashLedger),
        },
        heldRaceStart !== null,
      ) !== '';
    const storedCard = parsed.card as Partial<CardState> | undefined;
    let card = normaliseCard(parsed.card, tied && storedCard?.split === undefined);
    /* A night saved before the club's orders were loaded, with nothing typed
       on the card and nothing run or sold against it, takes the sold card. */
    const untouched = !card.names.some((name) => name.trim()) && !card.owners.some((owner) => owner.trim());
    const loadOrders = nightPreset() && untouched && !tied && !Object.keys(card.claims).length;
    if (loadOrders) card = { ...ndccCard(), paymentLinkUrl: card.paymentLinkUrl, paymentLinkMinted: card.paymentLinkMinted };
    const audioMode: AudioMode = audioModes.includes(parsed.audioMode as AudioMode)
      ? (parsed.audioMode as AudioMode)
      : parsed.sound === false
        ? 'off'
        : parsed.caller === true && parsed.music === false
          ? 'commentary'
          : parsed.caller === true && parsed.music === true
            ? 'both'
            : 'music';
    const intensities: SurpriseIntensity[] = ['calm', 'standard', 'big', 'chaos', 'mayhem'];
    const recoveryValue = parsed.voidRecovery as VoidRecoveryState | null | undefined;
    const recoveryShow = recoveryValue?.openShow;
    /* A pending Phone Play recovery is the race screen's too; off it, it is
       a leftover of the same resets and would hold the show the same way. */
    const voidRecovery =
      showPhase === 'race' &&
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
      eventTagline: typeof parsed.eventTagline === 'string' ? parsed.eventTagline.slice(0, 60) : base.eventTagline,
      startTime: typeof parsed.startTime === 'string' && /^\d{2}:\d{2}$/.test(parsed.startTime) ? parsed.startTime : base.startTime,
      backingCents: loadOrders ? card.snailCents :
        typeof parsed.backingCents === 'number' && Number.isSafeInteger(parsed.backingCents) && parsed.backingCents >= 100
          ? parsed.backingCents
          : base.backingCents,
      eventMode: parsed.eventMode === 'recorded' ? 'recorded' : 'live',
      /* The races come from the card's run sheet, never from the backup's
         count, so a backup cannot desynchronise the numbers from their races. */
      plannedRaces: card.races.length,
      championshipScreens: parsed.championshipScreens === true,
      /* "Heat" was forced on every race before the night became a league. A
         night saved before the championship switch existed reads it as League;
         a Heat chosen since is kept. */
      raceType:
        typeof parsed.raceType === 'string' && parsed.raceType.trim() && !(parsed.raceType === 'Heat' && parsed.championshipScreens === undefined)
          ? parsed.raceType.slice(0, 40)
          : DEFAULT_RACE_TYPE,
      rehearsal: parsed.rehearsal === true,
      showPhase,
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
      fieldSize: SNAILS_PER_RACE,
      card,
      quaddie: normaliseQuaddie(parsed.quaddie),
      quaddieEntries: Array.isArray(parsed.quaddieEntries) ? parsed.quaddieEntries.filter(validQuaddieEntry) : [],
      audioMode,
      sound: audioMode !== 'off',
      music: audioMode === 'music' || audioMode === 'both',
      caller: audioMode === 'commentary' || audioMode === 'both',
      cameraMode: cameraModes.includes(parsed.cameraMode as CameraMode) ? (parsed.cameraMode as CameraMode) : 'telecast',
      dealtCards: Array.isArray(parsed.dealtCards)
        ? parsed.dealtCards.filter((x): x is string => typeof x === 'string').slice(0, 200)
        : [],
      courseId: normaliseCourseId(parsed.courseId),
      trackDesigns: normaliseTrackDesigns(parsed.trackDesigns),
      cashLedger: Array.isArray(parsed.cashLedger) ? parsed.cashLedger : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      bets: Array.isArray(parsed.bets) ? parsed.bets : [],
      sponsors: Array.isArray(parsed.sponsors)
        ? parsed.sponsors.filter((x): x is string => typeof x === 'string')
        : [],
      /* A night saved before per-race sponsors takes the night's sold ones. */
      raceSponsors: Array.isArray(parsed.raceSponsors) ? normaliseRaceSponsors(parsed.raceSponsors) : base.raceSponsors,
      snailSpeed: clampSnailSpeed(parsed.snailSpeed ?? base.snailSpeed),
      runnerSponsors: Array.isArray(parsed.runnerSponsors)
        ? parsed.runnerSponsors.filter((x): x is string => typeof x === 'string').slice(0, MAX_FIELD)
        : [],
      /* The cash tote never comes back live from storage without its
         attestation, and tallies are kept only in a shape the maths accepts. */
      cashTote: normaliseCashTote(parsed.cashTote),
      toteSales: Array.isArray(parsed.toteSales)
        ? parsed.toteSales.filter(
            (x): x is ToteSale =>
              Boolean(x) && typeof x === 'object' && Number.isSafeInteger((x as ToteSale).raceNo) &&
              Number.isSafeInteger((x as ToteSale).lane) && Number.isSafeInteger((x as ToteSale).tickets),
          )
        : [],
      auctionBids: Array.isArray(parsed.auctionBids)
        ? parsed.auctionBids.filter(
            (x): x is AuctionBid =>
              Boolean(x) && typeof x === 'object' && Number.isSafeInteger((x as AuctionBid).raceNo) &&
              Number.isSafeInteger((x as AuctionBid).lane) && Number.isSafeInteger((x as AuctionBid).cents),
          )
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
  /* The number of races always follows the run sheet. */
  if (next.card) {
    const races = state.card.races.length;
    state.plannedRaces = races;
    /* A quaddie leg past the last race could never be run: spread the four legs over the card. */
    if (races < 4) {
      /* Four legs need four races: a smaller card cannot run a quaddie. */
      if (state.quaddie.enabled) state.quaddie = { ...state.quaddie, enabled: false };
    } else if (state.quaddie.legs.some((leg) => leg > races)) {
      const legs = [races - 6, races - 4, races - 2, races].map((leg) => Math.max(1, leg));
      state.quaddie = { ...state.quaddie, legs: new Set(legs).size === 4 ? legs : [races - 3, races - 2, races - 1, races] };
    }
  }
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
const serverState = freshState(false);
const getServerSnapshot = () => serverState;

export function useEvent(): EventState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The three legacy flags, derived from the one audio choice the desk offers. */
export const audioPatch = (mode: AudioMode): Pick<EventState, 'audioMode' | 'sound' | 'music' | 'caller'> => ({
  audioMode: mode,
  sound: mode !== 'off',
  music: mode === 'music' || mode === 'both',
  caller: mode === 'commentary' || mode === 'both',
});
