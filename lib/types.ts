/**
 * Shared domain types.
 *
 * Money is handled in two forms and they are never mixed:
 *   - `cents`  integer minor units, the only form sent to or read from Stripe
 *   - `amount` a decimal AUD number, used for on-screen display only
 * Any value crossing the network boundary is in cents.
 */

import type { CourseId } from './courses';
import type { CardState } from './card';
import type { QuaddieEntry, QuaddieSettings } from './quaddie';

export type DonationSource = 'stripe' | 'cash';

/** What plays on the projector. One choice, never three toggles. */
export type AudioMode = 'music' | 'commentary' | 'off';

/** How the race is framed: the leading pack, or the whole course. */
export type CameraMode = 'telecast' | 'full';

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
  /** Set when the payment bought a numbered snail on the card (1 to 100). */
  snailNo?: number;
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
    | 'tote_enabled'
    | 'tote_disabled'
    | 'tote_sale'
    | 'tote_settled'
    | 'auction_bid'
    | 'auction_settled'
    | 'snail_sold'
    | 'quaddie_enabled'
    | 'quaddie_disabled'
    | 'quaddie_entry'
    | 'quaddie_settled'
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

/* ── Permit-gated cash tote ─────────────────────────────────────────────── */

/**
 * The cash tote is a SEPARATE product from the free fun chips and from the
 * donations, and it is off by default. It exists for clubs that hold their
 * own authority to run a tote at a race night (in Victoria, typically a
 * VGCCC minor gaming permit, or the club's confirmed exemption). The app
 * records the operator's attestation and reference, it never claims the
 * activity is lawful, and nothing in it is readable by the race engine, the
 * fun-chip maths or the donation ledger.
 */
export interface CashToteSettings {
  enabled: boolean;
  /** Wall-clock ms of the operator's permit attestation. Null until given. */
  permitAcknowledgedAt: number | null;
  /** Permit number or the club's stated authority. Required to go live. */
  permitReference: string;
  /** Price of one paper tote ticket, in cents. */
  ticketCents: number;
  /** Share of each race pool the club keeps, 0 to 100. */
  retainedPercent: number;
  /** The last race on the card is sold by runner auction instead of tickets. */
  auctionLastRace: boolean;
  /** Share of the auction pool the club keeps, 0 to 100. */
  auctionRetainedPercent: number;
}

/** A tally of paper tickets sold on one runner for one race. */
export interface ToteSale {
  id: string;
  raceNo: number;
  lane: number;
  /** Tickets added by this entry. Negative entries correct a miscount. */
  tickets: number;
  createdAt: number;
  void?: boolean;
  note?: string;
}

/** One bid for one runner in the last-race auction. */
export interface AuctionBid {
  id: string;
  raceNo: number;
  lane: number;
  bidder: string;
  cents: number;
  createdAt: number;
  void?: boolean;
}

/** The settled tote for one race, stored with its result and printed. */
export interface ToteDividend {
  raceNo: number;
  ticketCents: number;
  retainedPercent: number;
  perLane: { lane: number; tickets: number }[];
  tickets: number;
  poolCents: number;
  retainedCents: number;
  returnedCents: number;
  winnerLane: number;
  winningTickets: number;
  /** Payout per winning ticket, rounded down to ten cents. */
  dividendCents: number;
  /** Rounding left over after the dividend, kept by the club. */
  breakageCents: number;
  /** Nobody held the winner: the returned share stays with the club. */
  unbacked: boolean;
}

/** The settled runner auction for the last race. */
export interface AuctionSettlement {
  raceNo: number;
  retainedPercent: number;
  /** Highest standing bid per runner; lanes with no bid are absent. */
  owners: { lane: number; bidder: string; cents: number }[];
  poolCents: number;
  retainedCents: number;
  prizeCents: number;
  winnerLane: number;
  /** Null when the winning runner was never bid for. */
  winningOwner: { bidder: string; cents: number } | null;
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
  /** Cash tote settlement, only when the permit-gated tote was live. */
  tote?: ToteDividend;
  /** Runner auction settlement, only on the auctioned last race. */
  auction?: AuctionSettlement;
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
  /** Poster strapline shown above the event name on the welcome screen. */
  eventTagline?: string;
  /** Doors or first race, as HH:MM in the event timezone. Presentation only. */
  startTime?: string;
  /** The advertised amount to back a snail, in cents. A suggested donation, never a stake. */
  backingCents?: number;
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
  /** Optional sponsor per runner lane, shown on the racecard and lower thirds. */
  runnerSponsors: string[];
  /**
   * The card: one hundred numbered snails, ten per race, named by the
   * people who bought them. Race N's field is always snails 10N-9 to 10N.
   */
  card: CardState;
  /** The permit-gated quaddie on four nominated races. Off by default. */
  quaddie: QuaddieSettings;
  quaddieEntries: QuaddieEntry[];
  /** Music, commentary or silence on the projector. */
  audioMode: AudioMode;
  /** Leading-pack telecast or the whole course. The desk can flip it live. */
  cameraMode: CameraMode;
  /**
   * Once-a-night surprise cards already dealt tonight, by card id. The deck
   * is dealt without replacement so the room never sees the same set piece
   * twice in one night.
   */
  dealtCards: string[];
  /** The permit-gated cash tote. Off by default; see CashToteSettings. */
  cashTote: CashToteSettings;
  toteSales: ToteSale[];
  auctionBids: AuctionBid[];
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
