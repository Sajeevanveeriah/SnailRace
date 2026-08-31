/**
 * Shared domain types.
 *
 * Money is handled in two forms and they are never mixed:
 *   - `cents`  integer minor units, the only form sent to or read from Stripe
 *   - `amount` a decimal AUD number, used for on-screen display only
 * Any value crossing the network boundary is in cents.
 */

import type { CourseId } from './courses';

export type DonationSource = 'stripe' | 'cash';

export interface Racer {
  /** Lane index, 0-based. Stable for the life of a race. */
  lane: number;
  name: string;
}

export interface Donation {
  id: string;
  /** Race number this donation is attached to. 0 for direct donations. */
  raceNo: number;
  /** Lane index, 0-based. -1 for direct QR donations backing no snail. */
  lane: number;
  snailName: string;
  backerName: string;
  cents: number;
  source: DonationSource;
  createdAt: number;
  /** Present for Stripe donations only. */
  sessionId?: string;
  /** Voided entries stay in the ledger for auditability but leave the totals. */
  void?: boolean;
  /**
   * Cents Stripe has refunded on this payment. `cents` is already net of
   * this; the field exists so the ledger can say why the number changed.
   */
  refundedCents?: number;
}

export interface RaceResult {
  lane: number;
  name: string;
  place: number;
  /**
   * Wall-clock race time at which this runner crossed the line. New
   * first-finisher races leave this null for runners that were merely
   * classified when the winner crossed, and for runners that retired.
   */
  finishMs: number | null;
  /** Missing on legacy results, where every stored row was a finisher. */
  status?: 'finished' | 'classified' | 'retired';
  /** Progress, 0 to 1, at the instant the winner ended the race. */
  progressAtStop?: number;
  retiredAtMs?: number;
  retirementCode?: string;
  retirementLabel?: string;
}

/* ── Locked consequential races ─────────────────────────────────────── */

export type RaceCuePhase = 'warning' | 'reveal' | 'effect' | 'commentary';
export type RaceConsequence = 'advance' | 'delay' | 'retire';

/** One deterministic audience-facing beat in a surprise sequence. */
export interface LockedRaceCue {
  id: string;
  eventId: string;
  phase: RaceCuePhase;
  atMs: number;
  text: string;
  lane?: number;
  tone?: 'good' | 'bad' | 'wild';
  sound?: string;
  big?: boolean;
}

/** One surprise and its complete, pre-race consequence. */
export interface LockedRaceEvent {
  id: string;
  kind: string;
  label: string;
  tone: 'good' | 'bad' | 'wild';
  sound: string;
  targetLanes: number[];
  consequence: RaceConsequence;
  warningAtMs: number;
  revealAtMs: number;
  effectAtMs: number;
  commentaryAtMs: number;
  effectEndMs: number;
  /** Signed persistent race-clock shift per affected lane. */
  clockDeltaMsByLane: Record<number, number>;
  warningText: string;
  revealText: string;
  commentaryText: string;
  retirementCode?: string;
  retirementLabel?: string;
}

/** Immutable inputs for one runner in a locked race. */
export interface LockedRaceRunner {
  lane: number;
  name: string;
  baseFinishMs: number;
  A: number;
  w1: number;
  w2: number;
  ph1: number;
  ph2: number;
}

/**
 * The complete race, drawn and hashed before countdown. Runtime animation
 * clones this value; it never adds decisions to it.
 */
export interface LockedRacePlan {
  schema: 1;
  engine: 'consequential-eight-v1';
  seed: number;
  seedHex: string;
  names: string[];
  durationMs: number;
  laps: number;
  surprises: boolean;
  intensity: SurpriseIntensity;
  trackShape: 'lanes' | 'circuit';
  /** Authored broadcast course. Optional only for pre-course-plan archives. */
  courseId?: CourseId;
  weather: 'clear' | 'drizzle' | 'downpour';
  photoFinish: boolean;
  runners: LockedRaceRunner[];
  events: LockedRaceEvent[];
  cues: LockedRaceCue[];
  results: RaceResult[];
  winnerLane: number;
  /** Race-time of the first active runner crossing. */
  stopAtMs: number;
}

/**
 * A surprise that landed during a race: a turbo boost, a shell slip, a nap.
 *
 * In a legacy race this records decorative seeded theatre. In a locked race
 * it records one of the already committed consequential events, so the reel
 * explains both what the room saw and why the classification changed.
 */
export interface RaceHighlight {
  /** Race-time the surprise landed, in milliseconds. */
  atMs: number;
  lane: number;
  name: string;
  kind: string;
  label: string;
}

/** One line in the tamper-evident audit trail the console shows. */
export interface AuditEntry {
  id: string;
  /** Wall-clock ms. */
  at: number;
  kind:
    | 'race_locked'
    | 'race_started'
    | 'race_finished'
    | 'race_void'
    | 'race_undone'
    | 'bets_settled'
    | 'event_created'
    | 'phase_change'
    | 'pack_locked'
    | 'pack_race_drawn'
    | 'backup_exported'
    | 'backup_restored'
    | 'note';
  /** Race the entry belongs to. 0 for event-level notes. */
  raceNo: number;
  /** One human-readable line for the console and the export. */
  detail: string;
  /*
   * The hash chain. entryHash = SHA-256(prevHash + canonical entry), so a
   * removed or edited line breaks every hash after it. This is tamper
   * EVIDENCE on a device the operator controls, not proof against the
   * device's owner - stated, not oversold. Entries from a v3 night predate
   * the chain and anchor it where it begins.
   */
  prevHash?: string;
  entryHash?: string;
}

/* ── The show, as phases a volunteer steps through ─────────────────────── */

/**
 * The run of show. A race night is a sequence, not a settings page: the
 * projector renders each phase as its own screen and the clicker's forward
 * button advances through them. `race` hands control to the existing race
 * lifecycle (ready/countdown/running/finished/void) and returns to `results`.
 */
export type ShowPhase =
  | 'lobby'
  | 'racecard'
  | 'market'
  | 'race'
  | 'results'
  | 'championship'
  | 'intermission'
  | 'finale';

/** How busy the Surprise Director is allowed to be. Never touches results. */
export type SurpriseIntensity = 'calm' | 'standard' | 'big' | 'chaos';

/* ── Recorded Race Packs ───────────────────────────────────────────────── */

/**
 * One recorded, simulated race inside a pack. The media file itself never
 * enters the manifest - only its SHA-256, size and name - so a substituted
 * or corrupted file is refused before a frame plays.
 */
export interface PackRace {
  /** Unique within the pack. */
  raceId: string;
  title: string;
  /** Runner names, lane order. */
  runners: string[];
  sponsor?: string;
  durationMs: number;
  mediaFileName: string;
  mediaSha256: string;
  mediaBytes: number;
  mediaType: string;
  /**
   * The committed result: finishing order as lane indices, winner first.
   * Hidden by every operator surface until the race has been played.
   */
  resultOrder: number[];
  /** Optional timeline notes shown after reveal. */
  highlights?: { atMs: number; text: string }[];
  /** Where the footage came from and the licence that permits this use. */
  source: string;
  licence: string;
  createdAt: number;
}

/** A locked card of recorded races. Fingerprints make it tamper-evident. */
export interface RacePackManifest {
  schema: 1;
  packId: string;
  title: string;
  createdAt: number;
  races: PackRace[];
  /** SHA-256 over the canonical manifest (races included, hashes excluded). */
  manifestHash?: string;
}

/**
 * A recording attached to a completed race.
 *
 * The file itself cannot live in localStorage, so what is kept is its
 * fingerprint: on reload the operator re-attaches the file and the archive
 * verifies the SHA-256 before playing a frame of it. A file that does not
 * match is refused, with the deterministic seed replay always available as
 * the authoritative reconstruction.
 */
export interface RaceMedia {
  fileName: string;
  bytes: number;
  mimeType: string;
  sha256: string;
  addedAt: number;
}

export interface RaceHistoryEntry {
  raceNo: number;
  raceType: string;
  seedHex: string;
  fieldSize: number;
  durationMs: number;
  at: number;
  results: RaceResult[];
  /** Total cents backed on this race, all lanes, all sources. */
  potCents: number;
  photoFinish: boolean;
  /** Who put their name to this race. Empty when nobody sponsored it. */
  sponsor?: string;
  /*
   * The audit block. SHA-256 of seed plus configuration, published at the
   * off; SHA-256 of the finishing order, recorded at the line; and the
   * configuration and timestamps they bind. Absent on races from an older
   * build, which the console says rather than hides.
   */
  commitHash?: string;
  resultHash?: string;
  /** Snail names as raced, so the replay is exact even after a rename. */
  names?: string[];
  laps?: number;
  surprises?: boolean;
  trackShape?: 'lanes' | 'circuit';
  courseId?: CourseId;
  /** Surprise Director preset the race ran under. Part of the commitment. */
  intensity?: SurpriseIntensity;
  lockedAt?: number;
  startedAt?: number;
  finishedAt?: number;
  /** Tote odds per lane at the moment betting locked. */
  oddsAtLock?: Record<number, number>;
  /**
   * A voided race stays in the history as a compensating entry rather than
   * being deleted: standings, sponsors and settlement all skip it, and the
   * reason is printed beside it.
   */
  void?: boolean;
  voidReason?: string;
  /** Verified recording, when the operator has attached one. */
  media?: RaceMedia;
  /** Where the result came from: the seeded engine, or a locked Race Pack. */
  source?: 'engine' | 'pack';
  packId?: string;
  packRaceId?: string;
  /*
   * Snapshots taken before the race settled, so the console can undo it
   * exactly. Reversing the arithmetic instead would have to re-derive a
   * streak that was already overwritten, and a wrong reversal is worse than
   * no undo when a club is reconciling chips in front of the room.
   */
  chipBankBefore?: Record<string, number>;
  streaksBefore?: Record<string, number>;
  /** Surprises that landed, oldest first. Absent on nights from an older build. */
  highlights?: RaceHighlight[];
  /** Complete immutable plan for consequential races. Absent on legacy races. */
  racePlan?: LockedRacePlan;
  /** SHA-256 over the canonical complete plan, published before countdown. */
  planHash?: string;
}

/** A free-to-play wager. No real money, no cash payout. */
export interface Bet {
  id: string;
  raceNo: number;
  lane: number;
  snailName: string;
  punter: string;
  /** Play-money chips staked. */
  chips: number;
  /** Decimal odds locked in at the moment the bet was placed. */
  odds: number;
  settled: boolean;
  won?: boolean;
  returned?: number;
}

/**
 * Durable local recovery intent for a race void whose Phone Play void/rearm
 * acknowledgement is still uncertain. It survives a moderator-page reload,
 * preventing a different plan from being drawn over the held attempt.
 */
export interface VoidRecoveryState {
  raceNo: number;
  planHash: string;
  reason: string;
  openShow: import('./live/store').LiveShow | null;
}

/**
 * The exact race held across an uncertain Phone Play LOCK/RUN acknowledgement.
 *
 * This remains durable until the local race records its result (or the attempt
 * moves into the explicit void/rearm recovery path). A moderator-page reload
 * can therefore retry the same hashes and animation plan instead of drawing a
 * different result over a room that may already be RUNNING.
 */
export interface HeldRaceStartState {
  raceNo: number;
  lockedAt: number;
  startedAt: number;
  config: {
    raceNo: number;
    raceType: string;
    fieldSize: number;
    names: string[];
    durationMs: number;
    laps: number;
    surprises: boolean;
    trackShape: 'lanes' | 'circuit';
    courseId?: CourseId;
    intensity: SurpriseIntensity;
  };
  oddsAtLock: Record<number, number>;
  commitHash: string;
  planHash: string;
  plan: LockedRacePlan;
}

export interface EventState {
  version: 4;
  eventId: string;
  clubName: string;
  eventName: string;
  /** Presentation timezone for the night. */
  timezone: string;
  /** ISO date of the event, for the archive and reports. Optional. */
  eventDate?: string;
  venue?: string;
  /** Which product the night runs on: the animated engine, or a Race Pack. */
  eventMode: 'live' | 'recorded';
  /** How many races the card plans. Presentation only; never a limit. */
  plannedRaces: number;
  /** Rehearsal nights are loudly labelled and cheap to reset. */
  rehearsal: boolean;
  /** Where the run of show currently stands. Survives reloads. */
  showPhase: ShowPhase;
  /** Surprise Director preset. Part of the race commitment. */
  intensity: SurpriseIntensity;
  /** The locked recorded card, when eventMode is 'recorded'. */
  racePack?: RacePackManifest | null;
  packLockedAt?: number;
  /** SHA-256 commitment over the locked pack, published to the audit. */
  packCommit?: string;
  /** raceIds already played from the pack, in play order. */
  packPlayed?: string[];
  /** The drawn-but-not-yet-finished pack race, so a reload recovers it. */
  packCurrent?: string | null;
  /** Phone Play session, when the server mode has one open. */
  phonePlay?: { code: string; operatorKey: string; pin?: string } | null;
  /** Exact plan retained until its local result stands or it enters void recovery. */
  heldRaceStart: HeldRaceStartState | null;
  /** Persisted until the same void/rearm commands are acknowledged or the room is ended. */
  voidRecovery: VoidRecoveryState | null;
  fieldSize: number;
  names: string[];
  goalCents: number;
  goalShow: boolean;
  raceDurationMs: number;
  /** Which renderer the stage uses: straight lanes, or laps of a circuit. */
  trackShape: 'lanes' | 'circuit';
  /** Which circuit, when trackShape is 'circuit'. */
  courseId: CourseId;
  /** Laps of the circuit. Total race time is lap length times laps. */
  laps: number;
  /** Let the camera director cut between shots, or hold the whole course. */
  chaseCam: boolean;
  /** Whether in-race surprises are dealt. Never affects the finishing order. */
  surprises: boolean;
  raceType: string;
  raceNumber: number;
  /** Sponsors, used in order and cycled. One line per race on the stage. */
  sponsors: string[];
  cashLedger: Donation[];
  history: RaceHistoryEntry[];
  bets: Bet[];
  chipBank: Record<string, number>;
  /** Consecutive winning races per punter, keyed the same way as chipBank. */
  streaks: Record<string, number>;
  /** The audit trail, newest first. Appended to, never edited from the UI. */
  audit: AuditEntry[];
  /** Which lighting the track runs under. Information design never changes. */
  stageTheme: 'midnight' | 'turf' | 'dusk';
  calm: boolean;
  sound: boolean;
  /** Music and crowd ambience. Independent of `sound`, which gates everything. */
  music: boolean;
  /** The spoken race caller. Independent of `music`, gated by `sound`. */
  caller: boolean;
  /**
   * Bumped when the shipped mix changes, so a saved night picks up new levels
   * instead of keeping a mix that was too quiet to hear in a function room.
   */
  audioRev: number;
  /** Master level, 0 to 1. */
  volume: number;
  /** Music bus level, 0 to 1. Sits under the effects by default. */
  musicVolume: number;
  bettingOpen: boolean;
  startedAt: number;
}

/** Wire shape returned by GET /api/donations. */
export interface DonationsResponse {
  ok: boolean;
  configured: boolean;
  /** Which Stripe mode the server key selects. Never the key itself. */
  mode?: 'test' | 'live';
  donations: Donation[];
  /** Server clock in ms, so the stage can detect a stalled poll. */
  at: number;
  error?: string;
}

/** URL-token payload that the donor phone page decodes. */
export interface LineupToken {
  v: 1;
  e: string;
  r: number;
  c: string;
  n: string[];
}
