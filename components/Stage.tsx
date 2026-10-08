'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ModeratorDesk } from './ModeratorDesk';
import { ClubBrand } from './brand/ClubBrand';
import { useModeratorWindow } from '@/lib/use-moderator-window';
import { useProjectorDisplay } from '@/lib/use-projector-display';
import { RaceTrack } from './RaceTrack';
import { Telecast } from './Telecast';
import { WinnerOverlay } from './WinnerOverlay';
import { ControlDrawer } from './ControlDrawer';
import { ThemeToggle } from './ThemeToggle';
import { AudioModePicker } from './AudioModePicker';
import { addAudit, audioPatch, currentState, hydrate, useEvent, setState } from '@/lib/event-store';
import { commitmentOf, planHashOf, shortHash } from '@/lib/audit';
import { recordRaceResult } from '@/lib/settlement';
import { hostLineFor, nextShowPhase, showPhaseSpec } from '@/lib/show';
import { applyPurchases, cardRaceNames, cardRaceOwners, raceForSnail, releaseRefunded, type SnailPurchase } from '@/lib/card';
import { quaddieIsLive } from '@/lib/quaddie';
import { usePhonePlay } from '@/lib/use-phone-play';
import { ShowOverlay } from './ShowScreens';
import { PackRunner } from './PackRunner';
import type { LiveShow } from '@/lib/live/store';
import type {
  HeldRaceStartState,
  PackRace,
  ShowPhase,
  VoidRecoveryState,
} from '@/lib/types';
import { useOrigin } from '@/lib/use-origin';
import { HAS_API, HAS_LIVE_API, withBasePath } from '@/lib/deployment';
import { useCanSpeak } from '@/lib/use-can-speak';
import { newId, nowMs } from '@/lib/ids';
import { useDonations } from '@/lib/use-donations';
import { useRace } from '@/lib/use-race';
import { funChipPoolsFor } from '@/lib/tote';
import { sponsorFor } from '@/lib/standings';
import { money } from '@/lib/money';
import { MAX_FIELD, MIN_LIVE_FIELD } from '@/lib/palette';
import { courseById, courseForRace } from '@/lib/courses';
import {
  audioState,
  initVoice,
  say,
  resumeAudio,
  setCallerOn,
  primeAudio,
  setLevels,
  setMusicOn,
  setSoundEnabled,
  sfx,
  silence,
  startTrack,
  stopTrack,
} from '@/lib/sound';
import type { AudioMode, Donation, RaceHighlight, RaceHistoryEntry, RaceResult } from '@/lib/types';
import {
  dealtDeckCards,
  drawLockedRacePlan,
  freshSeed,
  type DrawnRace,
} from '@/lib/race-engine';

export function Stage() {
  const event = useEvent();
  const moderator = useModeratorWindow();
  const display = useProjectorDisplay(Boolean(moderator.target));
  const { open: openModeratorWindow } = moderator;
  const { toggleFullscreen } = display;
  const [holding, setHolding] = useState(false);
  const [fullCourse, setFullCourse] = useState(false);
  /* One camera choice, whether it comes from the on-screen button or the desk. */
  const setCameraFull = useCallback((full: boolean) => {
    setFullCourse(full);
    setState({ cameraMode: full ? 'full' : 'telecast' });
  }, []);
  const [packControlsRoot, setPackControlsRoot] = useState<HTMLDivElement | null>(null);
  const audienceOnly = Boolean(moderator.target) || display.fullscreen;

  const [clientReady, setClientReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [dismissedToast, setDismissedToast] = useState<string | null>(null);
  const origin = useOrigin();

  useEffect(() => {
    hydrate();
    const id = window.setTimeout(() => setClientReady(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    setSoundEnabled(event.sound);
  }, [event.sound]);

  useEffect(() => {
    setMusicOn(event.music);
  }, [event.music]);

  useEffect(() => {
    setCallerOn(event.sound && event.caller);
  }, [event.sound, event.caller]);

  useEffect(() => {
    setLevels({ master: event.volume, music: event.musicVolume });
  }, [event.volume, event.musicVolume]);

  useEffect(() => () => {
    stopTrack(0.2);
  }, []);

  const feed = useDonations(event.eventId);
  const nextRaceNo = event.raceNumber + 1;
  /*
   * The field on the projector. While the show sits on a result the stage
   * still shows the race that just ran, so its names come from that race's
   * ten snails, not the next ten. Everywhere else it is the next field.
   */
  /* After race ten there is no race eleven: the card's last field stays up. */
  const shownRaceNo = Math.min(event.plannedRaces, event.showPhase === 'results' ? event.raceNumber : nextRaceNo);
  const names = useMemo(() => cardRaceNames(event.card, shownRaceNo), [event.card, shownRaceNo]);
  const owners = useMemo(() => cardRaceOwners(event.card, shownRaceNo), [event.card, shownRaceNo]);
  const fieldNames = useMemo(() => cardRaceNames(event.card, nextRaceNo), [event.card, nextRaceNo]);
  const finishedCourseId = event.showPhase === 'results'
    ? event.history.find((entry) => entry.raceNo === event.raceNumber && !entry.void)?.courseId
    : undefined;
  const activeCourse = courseById(
    event.heldRaceStart?.plan.courseId ?? finishedCourseId ?? courseForRace(nextRaceNo).id,
  );
  const sponsor = useMemo(
    () => sponsorFor(event.sponsors, nextRaceNo),
    [event.sponsors, nextRaceNo],
  );

  /** Stripe is authoritative for cards; the cash tin lives on this device. */
  const allDonations: Donation[] = useMemo(
    () => [...feed.donations, ...event.cashLedger],
    [feed.donations, event.cashLedger],
  );

  const liveDonations = useMemo(() => allDonations.filter((d) => !d.void), [allDonations]);
  const nightCents = useMemo(
    () => liveDonations.reduce((sum, d) => sum + d.cents, 0),
    [liveDonations],
  );

  const raceDonationCents = useMemo(
    () =>
      liveDonations
        .filter((donation) => donation.raceNo === nextRaceNo)
        .reduce((sum, donation) => sum + donation.cents, 0),
    [liveDonations, nextRaceNo],
  );

  /* Fixed fair-play prices for the lock snapshot and any Phone Play room. */
  const { lanes } = useMemo(
    () => funChipPoolsFor(event.bets, fieldNames, nextRaceNo),
    [event.bets, fieldNames, nextRaceNo],
  );

  /* ── Paid snails fill the roster ─────────────────────────────────────── */

  /*
   * A Stripe payment that bought a numbered snail names it on the card. The
   * feed is polled, so this runs on every snapshot and applies only what is
   * new; a slot the desk typed by hand is never overwritten by a payment.
   */
  /* Conflicts already told to the desk, so a poll does not repeat them. */
  const reportedConflictsRef = useRef<Set<string>>(new Set());
  const lockedRaceNo = event.heldRaceStart?.raceNo ?? null;
  useEffect(() => {
    /*
     * A race that is armed or running keeps the names its plan was hashed
     * with. A payment for one of its snails waits in the feed and is applied
     * once the race has settled; manual edits are disabled for the same
     * reason, and Stripe gets no exception.
     */
    const purchases: SnailPurchase[] = feed.donations
      .filter((d) => !d.void && d.snailNo && raceForSnail(d.snailNo) !== lockedRaceNo)
      .map((d) => ({ snailNo: d.snailNo!, snailName: d.snailName, owner: d.backerName, id: d.id }));
    /* A fully refunded purchase releases the slot it bought. */
    const refunded = feed.donations.filter((d) => d.void && d.snailNo && raceForSnail(d.snailNo) !== lockedRaceNo).map((d) => d.id);
    if (!purchases.length && !refunded.length) return;
    const id = window.setTimeout(() => {
      const before = currentState().card;
      const freed = releaseRefunded(before, refunded);
      const applied = applyPurchases(freed.card, purchases);
      if (freed.released.length || applied.changed) setState({ card: applied.card });
      for (const n of freed.released) {
        addAudit({ kind: 'note', raceNo: raceForSnail(n), detail: `Snail ${n} released: its card payment was refunded in full.` });
      }
      const fresh = purchases.filter((p) => !freed.card.claims[p.snailNo] && applied.card.claims[p.snailNo] === p.id);
      for (const p of fresh) {
        addAudit({ kind: 'snail_sold', raceNo: raceForSnail(p.snailNo), detail: `Snail ${p.snailNo} sold by card: "${p.snailName}" for ${p.owner || 'an anonymous owner'}.` });
      }
      /* A paid number that was already taken is a real problem for a real
         person at the bar: it goes to the audit trail and the desk notice. */
      for (const c of applied.conflicts) {
        if (reportedConflictsRef.current.has(c.id)) continue;
        reportedConflictsRef.current.add(c.id);
        addAudit({
          kind: 'note',
          raceNo: raceForSnail(c.snailNo),
          detail: `CONFLICT: ${c.owner || 'a buyer'} paid for snail ${c.snailNo} ("${c.snailName}", Stripe ${c.id}) but that number is already taken. Resolve at the desk and refund or reassign.`,
        });
      }
      setState((s) => {
        const pending = applied.conflicts.map((c) => `Snail ${c.snailNo} was paid for by ${c.owner || 'a buyer'} but is already taken`);
        return pending.join('; ') === s.card.conflictNotice ? {} : { card: { ...s.card, conflictNotice: pending.join('; ') } };
      });
    }, 0);
    return () => window.clearTimeout(id);
  }, [feed.donations, lockedRaceNo]);

  /* ── Race lifecycle ──────────────────────────────────────────────────── */

  const [highlights, setHighlights] = useState<RaceHighlight[]>([]);
  const [preparingRace, setPreparingRace] = useState(false);
  const [heldRaceStart, setHeldRaceStart] = useState(false);
  const [voidingRace, setVoidingRace] = useState(false);
  const voidRecovery = event.voidRecovery;
  const [startError, setStartError] = useState('');

  /*
   * The armed race: everything the audit block needs, captured at lock so a
   * mid-race rename or setting change cannot rewrite what was committed to.
   */
  const armedRef = useRef<HeldRaceStartState | null>(null);

  /** Set once Phone Play mounts; onFinish settles the room through it. */
  const phonePlayRef = useRef<((raceNo: number, results: RaceResult[]) => Promise<void>) | null>(
    null,
  );
  const phoneLockRef = useRef<
    ((raceNo: number, show: LiveShow, planHash: string) => Promise<boolean>) | null
  >(null);
  const phoneVoidRef = useRef<
    ((raceNo: number, planHash: string, reason: string) => Promise<boolean>) | null
  >(null);
  const phoneRearmRef = useRef<
    ((raceNo: number, show: LiveShow) => Promise<boolean>) | null
  >(null);
  const liveShowRef = useRef<LiveShow | null>(null);

  const onFinish = useCallback(
    (drawn: DrawnRace, results: RaceResult[], reel: RaceHighlight[]) => {
      const armed = armedRef.current;
      const raceNo = armed?.raceNo ?? nextRaceNo;
      const finishedAt = nowMs();

      /*
       * One settlement path for every race source. `recordRaceResult` holds
       * the exactly-once guard, snapshots, streaks, audit entries and the
       * async result hash; this callback only supplies the engine's entry
       * and drives the stage furniture.
       */
      const { recorded } = recordRaceResult({
        raceNo,
        raceType: armed?.config.raceType ?? event.raceType,
        seedHex: drawn.seedHex,
        fieldSize: armed?.config.fieldSize ?? names.length,
        durationMs: armed?.config.durationMs ?? event.raceDurationMs,
        at: finishedAt,
        results,
        potCents: raceDonationCents,
        photoFinish: drawn.photoFinish,
        highlights: reel,
        sponsor,
        source: 'engine',
        names: armed?.config.names ?? names,
        laps: armed?.config.laps,
        surprises: armed?.config.surprises,
        trackShape: armed?.config.trackShape ?? event.trackShape,
        courseId: armed?.config.courseId ?? activeCourse.id,
        intensity: armed?.config.intensity ?? event.intensity,
        lockedAt: armed?.lockedAt,
        startedAt: armed?.startedAt,
        finishedAt,
        oddsAtLock: armed?.oddsAtLock,
        commitHash: armed?.commitHash,
        planHash: armed?.planHash,
        racePlan: armed?.plan,
      });
      if (!recorded) {
        /* A crash can land after the standing result was persisted but before
           this recovery record was cleared. The exactly-once guard proves the
           local completion already stands, so the held plan is now spent. */
        void phonePlayRef.current?.(raceNo, results);
        armedRef.current = null;
        setHeldRaceStart(false);
        setState({ heldRaceStart: null });
        setPreparingRace(false);
        return;
      }

      void phonePlayRef.current?.(raceNo, results);
      armedRef.current = null;
      /* The deck is dealt without replacement: a once-a-night card this race
         used is off the table for the rest of the card. */
      const used = armed?.plan ? dealtDeckCards(armed.plan) : [];
      setState((s) => ({
        heldRaceStart: null,
        dealtCards: used.length ? [...new Set([...s.dealtCards, ...used])] : s.dealtCards,
      }));
      setPreparingRace(false);
      setHeldRaceStart(false);
      setStartError('');
      setHighlights(reel);
      setOverlayOpen(true);
    },
    [event.raceDurationMs, event.raceType, event.trackShape, event.intensity, names, nextRaceNo, raceDonationCents, sponsor, activeCourse.id],
  );

  const race = useRace(onFinish);

  /* Re-arm the exact durable plan after hydration or a storage event. The
     engine itself is intentionally in-memory; only an idle controller needs
     to enter retry mode, while an already running instance keeps its banner. */
  useEffect(() => {
    const held = event.heldRaceStart;
    if (!held || armedRef.current?.planHash === held.planHash) return;
    armedRef.current = held;
    if (race.phase === 'idle' || race.phase === 'done' || race.phase === 'void') {
      const id = window.setTimeout(() => {
        if (armedRef.current?.planHash !== held.planHash) return;
        setPreparingRace(false);
        setHeldRaceStart(true);
        setStartError(
          'Recovered the exact held race plan. Selections stay closed; retry the same Phone Play lock without redrawing.',
        );
        if (event.bettingOpen) setState({ bettingOpen: false });
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [event.heldRaceStart, event.bettingOpen, race.phase]);

  /*
   * Audio waits for the room to touch something.
   *
   * A browser will not start an AudioContext without a user gesture, and
   * building one anyway just to have it sit suspended earns a console warning
   * on every load. So the first pointer or key press arms the soundtrack, and
   * nothing before it creates a context at all.
   */
  const [primed, setPrimed] = useState(false);
  const [audio, setAudio] = useState<'idle' | 'blocked' | 'running' | 'off'>('idle');
  const canSpeak = useCanSpeak();
  useEffect(() => {
    initVoice();
  }, []);

  useEffect(() => {
    /*
     * Every gesture, not just the first. A browser can suspend a running
     * context long after it was created - the machine changes output device,
     * the tab is backgrounded - and it does so silently, which on the night
     * looks like an app with no sound rather than a browser wanting a click.
     */
    const arm = () => {
      primeAudio();
      resumeAudio();
      initVoice();
      setPrimed(true);
      setAudio(audioState());
    };
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
    const poll = window.setInterval(() => setAudio(audioState()), 1500);
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
      window.clearInterval(poll);
    };
  }, []);

  /*
   * The soundtrack is idle-driven: whenever no race is running and the desk
   * has chosen music, the lobby groove comes back up. The race lifecycle in
   * `use-race` owns everything from the countdown to the winner fanfare, so
   * this only has to cover the gaps between races. There is no crowd bed.
   */
  useEffect(() => {
    if (!primed || !event.sound) return;
    if (event.music && race.phase === 'idle') startTrack('lobby');
  }, [primed, event.sound, event.music, race.phase]);

  const startInFlight = useRef(false);
  const prepareStartRace = useCallback(async () => {
    if (
      preparingRace ||
      voidingRace ||
      voidRecovery !== null ||
      race.phase === 'countdown' ||
      race.phase === 'running' ||
      race.phase === 'confirming'
    ) {
      return;
    }
    primeAudio();
    setOverlayOpen(false);
    setStartError('');

    const lockedShowFor = (armed: HeldRaceStartState, currentShow: LiveShow): LiveShow => ({
      ...currentShow,
      raceNo: armed.raceNo,
      phase: 'race',
      marketOpen: false,
      names: armed.config.names.slice(),
      odds: { ...armed.oddsAtLock },
    });

    const beginArmedRace = (armed: HeldRaceStartState) => {
      const started: HeldRaceStartState = { ...armed, startedAt: nowMs() };
      armedRef.current = started;
      /* Retain the complete plan through the local run. If the moderator tab
         reloads before its standing result is durable, it restarts this exact
         plan and the server reconciles the same LOCK/RUN command identities. */
      setState({ bettingOpen: false, heldRaceStart: started });
      addAudit({
        kind: 'race_locked',
        raceNo: started.raceNo,
        detail: `Race ${started.raceNo} locked: ${started.config.fieldSize} selections closed, odds snapshotted, and complete plan ${shortHash(started.planHash)}… acknowledged before countdown.`,
      });
      addAudit({
        kind: 'race_started',
        raceNo: started.raceNo,
        detail: `Race ${started.raceNo} starts from seed ${started.plan.seedHex}. Commitment ${shortHash(started.commitHash)}… binds the set-up; plan ${shortHash(started.planHash)}… binds every consequential cue and the first-finisher classification.`,
      });
      setPreparingRace(false);
      setHeldRaceStart(false);
      setStartError('');
      race.startLocked(started.plan);
    };

    if (heldRaceStart || event.heldRaceStart) {
      const held = armedRef.current ?? event.heldRaceStart;
      if (!held?.planHash || !held.commitHash) {
        setHeldRaceStart(true);
        setState({ bettingOpen: false });
        setStartError('The held race plan is incomplete. Selections remain closed; restore a valid backup before continuing.');
        return;
      }
      armedRef.current = held;
      setPreparingRace(true);
      setHeldRaceStart(false);

      try {
        const [commitHash, planHash] = await Promise.all([
          commitmentOf(held.plan.seedHex, held.config),
          planHashOf(held.plan),
        ]);
        if (armedRef.current !== held) return;
        if (commitHash !== held.commitHash || planHash !== held.planHash) {
          setPreparingRace(false);
          setHeldRaceStart(true);
          setState({ bettingOpen: false, heldRaceStart: held });
          setStartError(
            'The recovered race plan failed its integrity check. Selections remain closed; do not draw another plan.',
          );
          return;
        }

        const lockPhoneRoom = phoneLockRef.current;
        if (event.phonePlay && !lockPhoneRoom) {
          setPreparingRace(false);
          setHeldRaceStart(true);
          setState({ bettingOpen: false, heldRaceStart: held });
          setStartError('Phone Play control is still restoring. The exact plan remains held; retry when the server is live.');
          return;
        }
        if (!lockPhoneRoom) {
          beginArmedRace(held);
          return;
        }
        const currentShow = liveShowRef.current;
        if (!currentShow) {
          setPreparingRace(false);
          setHeldRaceStart(true);
          setStartError('The Phone Play snapshot is not ready. The same plan remains held.');
          return;
        }
        const acknowledged = await lockPhoneRoom(
          held.raceNo,
          lockedShowFor(held, currentShow),
          held.planHash,
        );
        if (armedRef.current !== held) return;
        if (acknowledged) {
          beginArmedRace(held);
        } else {
          setPreparingRace(false);
          setHeldRaceStart(true);
          setState({ bettingOpen: false, heldRaceStart: held });
          setStartError(
            'Phone Play lock acknowledgement is uncertain. The same plan is held and selections stay closed; retry the lock without redrawing.',
          );
        }
      } catch {
        if (armedRef.current !== held) return;
        setPreparingRace(false);
        setHeldRaceStart(true);
        setState({ bettingOpen: false, heldRaceStart: held });
        setStartError('The held race could not be verified. The exact plan remains closed for a safe retry.');
      }
      return;
    }

    if (nextRaceNo > event.plannedRaces) {
      setStartError(`The card is complete: all ${event.plannedRaces} races have run.`);
      return;
    }
    if (fieldNames.length < MIN_LIVE_FIELD || fieldNames.length > MAX_FIELD) {
      setStartError(`The live race needs ${MIN_LIVE_FIELD} to ${MAX_FIELD} runners.`);
      return;
    }

    const laps = event.trackShape === 'circuit' ? event.laps : 1;
    const lockedAt = nowMs();
    const oddsAtLock: Record<number, number> = {};
    for (const lane of lanes) oddsAtLock[lane.lane] = lane.odds;

    const plan = drawLockedRacePlan(
      freshSeed(),
      fieldNames,
      event.raceDurationMs,
      event.surprises,
      event.intensity,
      laps,
      event.trackShape,
      activeCourse.id,
      event.dealtCards,
    );
    const config: HeldRaceStartState['config'] = {
      raceNo: nextRaceNo,
      raceType: event.raceType,
      fieldSize: fieldNames.length,
      names: fieldNames.slice(),
      durationMs: event.raceDurationMs,
      laps,
      surprises: event.surprises,
      trackShape: event.trackShape,
      courseId: activeCourse.id,
      intensity: event.intensity,
    };
    const armedDraft: HeldRaceStartState = {
      raceNo: nextRaceNo,
      lockedAt,
      startedAt: lockedAt,
      config,
      oddsAtLock,
      commitHash: '',
      planHash: '',
      plan,
    };
    armedRef.current = armedDraft;
    setPreparingRace(true);
    setState({ bettingOpen: false });

    let armed = armedDraft;
    const phoneLockRequired = Boolean(event.phonePlay);
    try {
      const [commitHash, planHash] = await Promise.all([
        commitmentOf(plan.seedHex, config),
        planHashOf(plan),
      ]);
      if (armedRef.current !== armedDraft) return;
      armed = { ...armedDraft, commitHash, planHash };
      armedRef.current = armed;
      /* This write is synchronous and precedes the first remote request. */
      setState({ bettingOpen: false, heldRaceStart: armed });

      const lockPhoneRoom = phoneLockRef.current;
      if (phoneLockRequired) {
        if (!lockPhoneRoom) throw new Error('Phone Play control is still restoring.');
        const currentShow = liveShowRef.current;
        if (!currentShow) throw new Error('The Phone Play snapshot is not ready.');
        const acknowledged = await lockPhoneRoom(
          armed.raceNo,
          lockedShowFor(armed, currentShow),
          planHash,
        );
        if (!acknowledged) throw new Error('Phone Play did not acknowledge the market lock.');
      }
      if (armedRef.current !== armed) return;
      beginArmedRace(armed);
    } catch (error) {
      if (armedRef.current !== armed) return;
      setPreparingRace(false);
      const message = error instanceof Error ? error.message : 'The race could not be locked.';
      if (phoneLockRequired && armed.planHash) {
        setHeldRaceStart(true);
        setState({ bettingOpen: false, heldRaceStart: armed });
        setStartError(
          `${message} The same plan is held and selections stay closed; retry the lock without redrawing.`,
        );
      } else {
        armedRef.current = null;
        setHeldRaceStart(false);
        setState({ bettingOpen: true, heldRaceStart: null });
        setStartError(`${message} Selections have reopened; no race started.`);
      }
      addAudit({
        kind: 'note',
        raceNo: armed.raceNo,
        detail: phoneLockRequired
          ? `Race start held before countdown: ${message} The same plan remains held and selections stay closed pending an idempotent retry.`
          : `Race start held before countdown: ${message} Selections reopened; no settlement path ran.`,
      });
    }
  }, [
    preparingRace,
    heldRaceStart,
    voidingRace,
    voidRecovery,
    race,
    fieldNames,
    lanes,
    nextRaceNo,
    event.raceDurationMs,
    event.raceType,
    event.surprises,
    event.intensity,
    event.trackShape,
    activeCourse.id,
    event.laps,
    event.phonePlay,
    event.heldRaceStart,
    event.dealtCards,
    event.plannedRaces,
  ]);

  const startRace = useCallback(async () => {
    if (startInFlight.current) return;
    startInFlight.current = true;
    try { await prepareStartRace(); }
    finally { startInFlight.current = false; }
  }, [prepareStartRace]);

  const resetRace = useCallback(() => {
    if (
      preparingRace ||
      heldRaceStart ||
      event.heldRaceStart !== null ||
      voidingRace ||
      voidRecovery !== null ||
      race.phase === 'countdown' ||
      race.phase === 'running' ||
      race.phase === 'confirming'
    ) {
      return;
    }
    race.reset();
    setOverlayOpen(false);
    armedRef.current = null;
    setStartError('');
    setState({ bettingOpen: true, heldRaceStart: null });
  }, [preparingRace, heldRaceStart, event.heldRaceStart, voidingRace, voidRecovery, race]);

  /* A brand-new event replaces the night in the store, but the engine's last
     running order lives in this component - clear it so the fresh night does
     not open showing the old one's arrivals. Only the engine's visuals reset:
     this also fires when hydration swaps in the stored night on load, and a
     reload mid-race must NOT reopen its locked betting. */
  const eventIdRef = useRef(event.eventId);
  useEffect(() => {
    if (eventIdRef.current === event.eventId) return;
    eventIdRef.current = event.eventId;
    const id = window.setTimeout(() => {
      race.reset();
      setOverlayOpen(false);
      armedRef.current = event.heldRaceStart;
      setPreparingRace(false);
      setHeldRaceStart(Boolean(event.heldRaceStart));
      setVoidingRace(false);
      setStartError(
        event.heldRaceStart
          ? 'Recovered the exact held race plan. Selections stay closed; retry the same Phone Play lock without redrawing.'
          : '',
      );
      if (event.heldRaceStart && event.bettingOpen) setState({ bettingOpen: false });
    }, 0);
    return () => window.clearTimeout(id);
  }, [event.eventId, event.heldRaceStart, event.bettingOpen, race]);

  const acknowledgeVoidAndRearm = useCallback(
    async (recovery: VoidRecoveryState): Promise<boolean> => {
      /* With no active phone room, the local void is already complete. If a
         room exists, both durable acknowledgements are mandatory. */
      if (!event.phonePlay) return true;
      const voidPhoneRoom = phoneVoidRef.current;
      const rearmPhoneRoom = phoneRearmRef.current;
      if (!voidPhoneRoom || !rearmPhoneRoom || !recovery.planHash || !recovery.openShow) {
        return false;
      }
      const voided = await voidPhoneRoom(
        recovery.raceNo,
        recovery.planHash,
        recovery.reason,
      );
      if (!voided) return false;
      return rearmPhoneRoom(recovery.raceNo, recovery.openShow);
    },
    [event.phonePlay],
  );

  /** Declare the race in progress void: no result, no settlement, re-run. */
  const voidCurrentRace = useCallback(async () => {
    if (race.phase !== 'countdown' && race.phase !== 'running') return;
    const armed = armedRef.current;
    const raceNo = armed?.raceNo ?? nextRaceNo;
    const reason = 'Declared void by the moderator before the first finisher.';
    const currentShow = liveShowRef.current;
    const recovery: VoidRecoveryState = {
      raceNo,
      planHash: armed?.planHash ?? '',
      reason,
      openShow: currentShow
        ? {
            ...currentShow,
            raceNo,
            phase: 'race',
            marketOpen: true,
            result: currentShow.result?.raceNo === raceNo ? null : currentShow.result,
          }
        : null,
    };
    race.voidRace();
    setVoidingRace(true);
    const voidEntry: RaceHistoryEntry = {
      raceNo,
      raceType: armed?.config.raceType ?? event.raceType,
      seedHex: race.seedHex || '--------',
      fieldSize: armed?.config.fieldSize ?? fieldNames.length,
      durationMs: armed?.config.durationMs ?? event.raceDurationMs,
      at: nowMs(),
      results: [],
      potCents: raceDonationCents,
      photoFinish: false,
      sponsor,
      names: armed?.config.names ?? fieldNames,
      lockedAt: armed?.lockedAt,
      startedAt: armed?.startedAt,
      commitHash: armed?.commitHash || undefined,
      planHash: armed?.planHash || undefined,
      racePlan: armed?.plan,
      oddsAtLock: armed?.oddsAtLock,
      void: true,
      voidReason: `${reason} Phone Play recovery is pending; selections remain closed.`,
    };
    /* Persist the compensating entry and recovery intent before the first
       network await. A reload cannot lose the local VOID or resurrect this
       held plan while its remote acknowledgement is uncertain. */
    setState((state) => ({
      bettingOpen: false,
      heldRaceStart: null,
      voidRecovery: recovery,
      history: [voidEntry, ...state.history],
    }));

    const phoneReady = await acknowledgeVoidAndRearm(recovery);

    setState((s) => ({
      bettingOpen: phoneReady,
      voidRecovery: phoneReady ? null : recovery,
      history: s.history.map((entry) =>
        entry.at === voidEntry.at && entry.raceNo === raceNo && entry.void
          ? {
              ...entry,
              voidReason: phoneReady
                ? `${reason} Picks were released and selections reopened for the re-run.`
                : `${reason} Phone Play did not acknowledge a safe rearm; selections remain closed.`,
            }
          : entry,
      ),
    }));
    addAudit({
      kind: 'race_void',
      raceNo,
      detail: `Race ${raceNo} declared VOID before the finish (seed ${race.seedHex || 'not yet drawn'}). No settlement occurred; ${phoneReady ? 'Phone Play acknowledged the void and rearm, so selections reopened.' : 'Phone Play did not acknowledge a safe rearm, so selections remain closed.'}`,
    });
    setHeldRaceStart(false);
    setVoidingRace(false);
    if (phoneReady) {
      armedRef.current = null;
    }
    setStartError(
      phoneReady
        ? ''
        : 'Race voided locally, but Phone Play recovery is held. Retry the same void and rearm commands; no new race plan can be drawn.',
    );
  }, [race, nextRaceNo, event.raceType, event.raceDurationMs, fieldNames, raceDonationCents, sponsor, acknowledgeVoidAndRearm]);

  /** Retry only the stable void/rearm commands; never redraw the held race. */
  const retryVoidRecovery = useCallback(async () => {
    if (!voidRecovery || voidingRace) return;
    setVoidingRace(true);
    setStartError('Retrying the same Phone Play void and rearm commands…');
    const phoneReady = await acknowledgeVoidAndRearm(voidRecovery);
    if (!phoneReady) {
      setVoidingRace(false);
      setState({ bettingOpen: false });
      setStartError(
        'Phone Play recovery is still unacknowledged. Selections stay closed and the same commands remain safe to retry.',
      );
      return;
    }

    setState((state) => ({
      bettingOpen: true,
      voidRecovery: null,
      history: state.history.map((entry) =>
        entry.void &&
        entry.raceNo === voidRecovery.raceNo &&
        entry.planHash === voidRecovery.planHash
          ? {
              ...entry,
              voidReason: `${voidRecovery.reason} Phone Play later acknowledged the void and rearm; selections reopened for the re-run.`,
            }
          : entry,
      ),
    }));
    addAudit({
      kind: 'note',
      raceNo: voidRecovery.raceNo,
      detail: `Phone Play recovery acknowledged for void race ${voidRecovery.raceNo}. The same attempt was refunded and rearmed before selections reopened.`,
    });
    armedRef.current = null;
    setVoidingRace(false);
    setStartError('');
  }, [voidRecovery, voidingRace, acknowledgeVoidAndRearm]);

  /* ── The run of show ─────────────────────────────────────────────────── */

  const racesRun = useMemo(
    () => event.history.filter((h) => !h.void).length,
    [event.history],
  );

  const quaddieLive = quaddieIsLive(event.quaddie);

  /** The host speaks between races; the race keeps its own richer caller. */
  const sayHost = useCallback((text: string) => {
    say(text, 'big');
  }, []);

  const goToPhase = useCallback(
    (phase: ShowPhase) => {
      setState({ showPhase: phase, ...(phase === 'race' ? { bettingOpen: false } : {}) });
      addAudit({
        kind: 'phase_change',
        raceNo: nextRaceNo,
        detail: `Show advanced to ${showPhaseSpec(phase).screen}.`,
      });
      sayHost(
        hostLineFor(phase, {
          clubName: event.clubName,
          eventName: event.eventName,
          raceNo: nextRaceNo,
          plannedRaces: event.plannedRaces,
          sponsor,
          leaderName: undefined,
          intensity: event.intensity,
        }),
      );
    },
    [sayHost, event.clubName, event.eventName, event.plannedRaces, event.intensity, nextRaceNo, sponsor],
  );

  const advanceShow = useCallback(() => {
    if (holding || preparingRace || heldRaceStart || event.heldRaceStart || voidingRace || voidRecovery || event.showPhase === 'race') return;
    const next = nextShowPhase(event.showPhase, { racesRun, plannedRaces: event.plannedRaces, quaddieLive });
    if (next === event.showPhase) return;
    if (event.showPhase === 'results') {
      setOverlayOpen(false);
      race.reset();
    }
    goToPhase(next);
  }, [event.showPhase, event.plannedRaces, event.heldRaceStart, racesRun, goToPhase, race, holding, preparingRace, heldRaceStart, voidingRace, voidRecovery, quaddieLive]);

  const backShow = useCallback(() => {
    if (holding || preparingRace || heldRaceStart || event.heldRaceStart || voidingRace || voidRecovery || event.eventMode === 'recorded' && event.packCurrent) return;
    const back: Partial<Record<ShowPhase, ShowPhase>> = {
      racecard: 'lobby',
      market: 'racecard',
      race: 'racecard',
      intermission: 'lobby',
      finale: 'championship',
    };
    const prev = back[event.showPhase];
    if (prev) goToPhase(prev);
  }, [event.showPhase, event.heldRaceStart, event.eventMode, event.packCurrent, goToPhase, holding, preparingRace, heldRaceStart, voidingRace, voidRecovery]);

  /* A race taking the gate always lands the show in the race phase. */
  useEffect(() => {
    if (race.phase !== 'countdown') return;
    const id = window.setTimeout(() => {
      if (event.showPhase !== 'race') setState({ showPhase: 'race' });
    }, 0);
    return () => window.clearTimeout(id);
  }, [race.phase, event.showPhase]);

  /* ── Phone Play: the room on its own devices ─────────────────────────── */

  const liveShow = useMemo<LiveShow>(() => {
    const standing = event.history.find((h) => !h.void);
    const isRacing =
      preparingRace ||
      heldRaceStart ||
      event.heldRaceStart !== null ||
      voidingRace ||
      voidRecovery !== null ||
      race.phase === 'countdown' ||
      race.phase === 'running' ||
      race.phase === 'confirming';
    /* While the show sits on the results, the phones stay on the race that
       just ran - jumping the room to race N+1 the instant N settles would
       hide every result and outcome from the very people who picked. */
    const onResults = event.showPhase === 'results' && Boolean(standing);
    return {
      eventName: event.eventName,
      clubName: event.clubName,
      raceNo: onResults && standing ? standing.raceNo : nextRaceNo,
      phase: event.showPhase,
      marketOpen: event.bettingOpen && !isRacing && !onResults,
      names: fieldNames,
      odds: Object.fromEntries(lanes.map((l) => [l.lane, l.odds])),
      result:
        standing && standing.results.length
          ? {
              raceNo: standing.raceNo,
              winnerLane: standing.results.find((r) => r.place === 1)?.lane ?? -1,
              order: standing.results
                .slice()
                .sort((a, b) => a.place - b.place)
                .map((r) => ({ lane: r.lane, name: r.name, place: r.place })),
            }
          : null,
      rehearsal: event.rehearsal,
    };
  }, [event.history, event.eventName, event.clubName, event.showPhase, event.bettingOpen, event.rehearsal, event.heldRaceStart, preparingRace, heldRaceStart, voidingRace, voidRecovery, race.phase, nextRaceNo, fieldNames, lanes]);

  useEffect(() => {
    liveShowRef.current = liveShow;
  }, [liveShow]);

  const phonePlay = usePhonePlay(HAS_LIVE_API ? liveShow : null);
  useEffect(() => {
    const active = HAS_LIVE_API && Boolean(phonePlay.session);
    phonePlayRef.current = active ? phonePlay.settle : null;
    phoneLockRef.current = active ? phonePlay.lockRace : null;
    phoneVoidRef.current = active ? phonePlay.voidRace : null;
    phoneRearmRef.current = active ? phonePlay.rearmRace : null;
  }, [
    phonePlay.session,
    phonePlay.lockRace,
    phonePlay.voidRace,
    phonePlay.rearmRace,
    phonePlay.settle,
  ]);

  const playUrl = useMemo(
    () =>
      HAS_LIVE_API && origin && phonePlay.session
        ? `${origin}${withBasePath('/play')}?c=${phonePlay.session.code}`
        : '',
    [origin, phonePlay.session],
  );

  /* ── Recorded Race Pack results, through the same settlement path ────── */

  const onPackResult = useCallback(
    (packRace: PackRace, results: RaceResult[]) => {
      const raceNo = nextRaceNo;
      const finishedAt = nowMs();
      const { recorded } = recordRaceResult({
        raceNo,
        raceType: event.raceType,
        seedHex: packRace.mediaSha256.slice(0, 8).toUpperCase(),
        fieldSize: packRace.runners.length,
        durationMs: packRace.durationMs,
        at: finishedAt,
        results,
        potCents: raceDonationCents,
        photoFinish: false,
        sponsor: packRace.sponsor ?? sponsor,
        source: 'pack',
        packId: event.racePack?.packId,
        packRaceId: packRace.raceId,
        commitHash: event.packCommit,
        names: packRace.runners,
        finishedAt,
        oddsAtLock: Object.fromEntries(lanes.map((l) => [l.lane, l.odds])),
      });
      if (!recorded) return;
      void phonePlayRef.current?.(raceNo, results);
      setHighlights([]);
      setOverlayOpen(true);
    },
    [nextRaceNo, event.raceType, event.racePack?.packId, event.packCommit, raceDonationCents, sponsor, lanes],
  );

  const onPackVoid = useCallback(
    (packRace: PackRace, reason: string) => {
      const raceNo = nextRaceNo;
      setState((s) => ({
        bettingOpen: true,
        history: [
          {
            raceNo,
            raceType: event.raceType,
            seedHex: packRace.mediaSha256.slice(0, 8).toUpperCase(),
            fieldSize: packRace.runners.length,
            durationMs: packRace.durationMs,
            at: nowMs(),
            results: [],
            potCents: raceDonationCents,
            photoFinish: false,
            sponsor: packRace.sponsor ?? sponsor,
            source: 'pack',
            packId: event.racePack?.packId,
            packRaceId: packRace.raceId,
            names: packRace.runners,
            void: true,
            voidReason: reason,
          } satisfies RaceHistoryEntry,
          ...s.history,
        ],
      }));
      addAudit({
        kind: 'race_void',
        raceNo,
        detail: `Recorded race ${packRace.raceId} ("${packRace.title}") declared VOID: ${reason}`,
      });
    },
    [nextRaceNo, event.raceType, event.racePack?.packId, raceDonationCents, sponsor],
  );

  /* ── Donation arrivals ───────────────────────────────────────────────── */

  /*
   * The toast is derived from the newest arrival rather than copied into
   * state, so the only thing the effect does is ring the coin and start the
   * dismissal timer.
   */
  const toast =
    feed.arrival && feed.arrival.id !== dismissedToast ? feed.arrival : null;

  useEffect(() => {
    if (!toast) return;
    sfx.coin();
    const id = window.setTimeout(() => setDismissedToast(toast.id), 5200);
    return () => window.clearTimeout(id);
  }, [toast]);

  /* One command path for the projector, moderator desk and presenter clicker. */
  const forwardAction = useCallback(() => {
    if (holding) return;
    if (event.showPhase !== 'race') advanceShow();
    else if (event.eventMode === 'live') {
      if (voidRecovery) void retryVoidRecovery();
      else void startRace();
    }
  }, [holding, event.showPhase, event.eventMode, advanceShow, voidRecovery, retryVoidRecovery, startRace]);

  const backAction = useCallback(() => {
    if (holding) return;
    if (overlayOpen) setOverlayOpen(false);
    else if (event.showPhase !== 'race') backShow();
    else if (race.phase === 'idle' || race.phase === 'void') backShow();
  }, [holding, overlayOpen, event.showPhase, backShow, race.phase]);

  const openModerator = useCallback(() => {
    setDrawerOpen(false);
    openModeratorWindow();
  }, [openModeratorWindow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        // Esc never resets an active race or undoes a result when leaving fullscreen.
        if (drawerOpen) setDrawerOpen(false);
        else if (overlayOpen) setOverlayOpen(false);
        return;
      }
      const target = e.target as HTMLElement | null;
      // Tag/selector checks work in both document realms; instanceof does not.
      if (target?.closest?.('input,select,textarea,[contenteditable="true"]')) return;
      if (e.code === 'Space' && target?.closest?.('button,a')) return;
      if (k === 'm') { e.preventDefault(); setDrawerOpen((open) => !open); return; }
      if (drawerOpen) return;
      if (e.code === 'Space' || e.code === 'PageDown' || e.code === 'ArrowRight') {
        e.preventDefault(); forwardAction();
      } else if (e.code === 'PageUp' || e.code === 'ArrowLeft') {
        e.preventDefault(); backAction();
      } else if (k === 'c') setState({ calm: !event.calm });
      else if (k === 's') setState(audioPatch(event.audioMode === 'off' ? 'music' : 'off'));
      else if (k === 'a') {
        const order: AudioMode[] = ['music', 'commentary', 'off'];
        setState(audioPatch(order[(order.indexOf(event.audioMode) + 1) % order.length]));
      }
      else if (k === 'f' && e.currentTarget === window) void toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    moderator.target?.window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      try { moderator.target?.window.removeEventListener('keydown', onKey); }
      catch { /* A desk navigated to another origin no longer exposes its listeners. */ }
    };
  }, [drawerOpen, overlayOpen, forwardAction, backAction, moderator.target, toggleFullscreen, event.calm, event.audioMode]);

  /* ── The snail link ──────────────────────────────────────────────────── */

  /*
   * One QR for the night: a reusable Stripe Payment Link that sells a $4
   * snail and asks for its number, its name and the owner's name. A server
   * deployment mints it here; the static Pages build cannot, so there the
   * link the operator pasted into Admin stands. A minted link is replaced
   * when the price changes; a pasted link is never replaced by the stage.
   */
  useEffect(() => {
    if (!event.eventId || !HAS_API) return;
    let cancel = false;
    void (async () => {
      try {
        const res = await fetch('/api/payment-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: event.eventId, kind: 'snail', cents: event.card.snailCents }),
        });
        const body = (await res.json()) as { ok: boolean; url?: string };
        if (cancel || !body.ok || !body.url) return;
        /* A pasted link is the operator's; a minted one follows the price. */
        setState((s) =>
          s.card.paymentLinkUrl && !s.card.paymentLinkMinted
            ? {}
            : s.card.paymentLinkUrl === body.url
              ? {}
              : { card: { ...s.card, paymentLinkUrl: body.url!, paymentLinkMinted: true } },
        );
      } catch {
        /* The link is an extra. The pasted link, or none, still stands. */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [event.eventId, event.card.snailCents]);

  const snailLinkUrl = event.card.paymentLinkUrl;

  const voidable = race.phase === 'running' || race.phase === 'countdown';
  const racing = (event.eventMode === 'recorded' && event.packCurrent !== null) || preparingRace || heldRaceStart || event.heldRaceStart !== null || voidingRace || voidRecovery !== null || voidable || race.phase === 'confirming';
  const startDisabled = preparingRace || voidingRace || voidable || race.phase === 'confirming';
  /*
   * Cinema mode. A projector at the back of a hall wants the race, not the
   * furniture: while one is on, the course goes full bleed and everything a
   * moderator reads between races gets out of the way. Measured on a 1080p
   * screen the course went from under half of it to nearly all of it.
   */
  const cinema = audienceOnly || voidable || race.phase === 'confirming' || race.phase === 'done';

  return (
    <div
      className={`${event.calm ? 'calm ' : ''}${cinema ? 'cinema ' : ''}${audienceOnly ? 'projector-audience ' : ''}${display.fullscreen ? 'projector-fullscreen' : ''}`}
      data-projector-fullscreen={display.fullscreen}
      data-moderator-connected={Boolean(moderator.target)}
      data-hydrated={clientReady ? 'true' : 'false'}
    >
      {!audienceOnly && (event.showPhase === 'race' || event.showPhase === 'results') ? (
        <a className="skip-link" href="#controls">
          Skip to moderator controls
        </a>
      ) : null}
      <div className="aurora" aria-hidden="true" />
      <div className="projector-tools no-print" role="toolbar" aria-label="Projector display">
        <button type="button" className="btn btn-ghost" disabled={!clientReady} onClick={openModerator}>{moderator.target ? 'Focus moderator window' : 'Open moderator window'}</button>
        <button type="button" className="btn btn-ghost" disabled={!clientReady} onClick={(e) => {
          const button = e.currentTarget;
          const pointer = e.detail > 0;
          void display.toggleFullscreen().then(() => { if (pointer && document.fullscreenElement) button.blur(); });
        }}>{display.fullscreen ? 'Exit fullscreen' : 'Fullscreen'} <kbd>F</kbd></button>
        {holding ? <button type="button" className="btn btn-go" onClick={() => setHolding(false)}>Resume show</button> : null}
        {display.error || moderator.notice ? <p role="status">{display.error || moderator.notice}</p> : null}
      </div>

      <div
        className="stage-shell mx-auto flex min-h-dvh w-full max-w-[1700px] flex-col gap-5 p-4 sm:p-6 lg:p-8"
        inert={event.showPhase !== 'race' && event.showPhase !== 'results'}
        aria-hidden={event.showPhase !== 'race' && event.showPhase !== 'results'}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <header className="reveal flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <p className="eyebrow">{event.clubName}</p>
            <h1 className="display mt-1.5 text-4xl sm:text-5xl lg:text-[3.4rem]">
              {event.eventName}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="chip-toggle pointer-events-none">
              Race {shownRaceNo} of {event.plannedRaces}
            </span>
            {event.rehearsal ? (
              <span className="chip-toggle pointer-events-none !text-(--bad)">REHEARSAL</span>
            ) : null}
            {sponsor ? (
              <span className="sponsor-line" title="Race sponsor">
                Sponsored by <b>{sponsor}</b>
              </span>
            ) : null}
            <FeedPill status={feed.status} lastOk={feed.lastOk} />
            <button
              type="button"
              className="chip-toggle"
              aria-pressed={event.calm}
              onClick={() => setState({ calm: !event.calm })}
              title="Calm mode stops decorative motion (C)"
            >
              Calm
            </button>
            <AudioModePicker mode={event.audioMode} canSpeak={canSpeak} onChange={(mode) => { primeAudio(); if (mode === 'commentary') initVoice(); setState(audioPatch(mode)); }} />
            <ThemeToggle />
          </div>
        </header>

        {/* ── Stage body ─────────────────────────────────────────────── */}
        <main className="stage-main grid flex-1 gap-5">
          <div className="stage-track flex min-w-0 flex-col gap-4">
            {event.eventMode === 'recorded' ? (
              <PackRunner onResult={onPackResult} onVoid={onPackVoid} controlsTarget={packControlsRoot} />
            ) : event.trackShape === 'circuit' ? (
              // The imperative SVG painter starts after saved state is restored.
              clientReady ? (
                <Telecast
                  names={names}
                  owners={owners}
                  race={race}
                  surface={event.stageTheme}
                  laps={event.laps}
                  chase={event.chaseCam}
                  cameraMode={event.cameraMode}
                  calm={event.calm}
                  clubName={event.clubName}
                  raceNo={shownRaceNo}
                  courseId={activeCourse.id}
                  fullCourse={fullCourse || event.cameraMode === 'full'}
                  onCourseViewChange={setCameraFull}
                  sponsor={event.showPhase === 'results' ? (event.history[0]?.sponsor ?? sponsor) : sponsor}
                  toteResult={event.history.find((h) => !h.void && h.raceNo === event.raceNumber)?.tote ?? null}
                  numberOffset={(shownRaceNo - 1) * 10}
                />
              ) : (
                <div className="track-wrap tv-wrap race-broadcast" aria-hidden="true" />
              )
            ) : (
              <RaceTrack names={names} race={race} surface={event.stageTheme} />
            )}

            <div className="stage-bar glass flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-baseline gap-3">
                  <StateBanner
                    phase={
                      voidingRace
                        ? 'voiding'
                        : voidRecovery
                          ? 'recovery'
                          : preparingRace
                          ? 'preparing'
                          : heldRaceStart
                            ? 'held'
                            : race.phase
                    }
                  />
                  <p className="text-lg font-semibold">
                    {preparingRace ? 'Locking the complete race plan…' : startError || race.status}
                  </p>
                  {race.seedHex ? (
                    <span
                      className="num text-[11px] text-(--tx)/35"
                      title="The seed the finishing order was drawn from, printed before the snails moved."
                    >
                      seed {race.seedHex}
                    </span>
                  ) : null}
                </div>
                {event.trackShape === 'circuit' ? null : (
                  <p className="call-rail h-5 truncate text-sm text-(--tx)/55">{race.commentary}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {event.eventMode === 'live' ? (
                <button
                  type="button"
                  className={`btn btn-go ${!racing ? 'btn-pulse' : ''}`}
                  onClick={() => {
                    if (voidRecovery) void retryVoidRecovery();
                    else void startRace();
                  }}
                  disabled={startDisabled}
                >
                  {voidingRace
                    ? 'Recovering…'
                    : voidRecovery
                      ? 'Retry void/rearm'
                      : preparingRace
                    ? 'Locking…'
                    : heldRaceStart
                      ? 'Retry lock'
                    : race.phase === 'done'
                      ? 'Next race'
                      : race.phase === 'void'
                        ? 'Re-run race'
                        : 'Start race'}{' '}
                  <kbd>Space</kbd>
                </button>
                ) : null}
                {voidable && event.eventMode === 'live' ? (
                  <button
                    type="button"
                    className="btn btn-ghost !text-(--bad)"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Void race ${nextRaceNo}? No result, no settlement; bets reopen for the re-run and an audit entry is written.`,
                        )
                      ) {
                        voidCurrentRace();
                      }
                    }}
                  >
                    Void race
                  </button>
                ) : null}
                <button type="button" className="btn btn-ghost" onClick={resetRace} disabled={racing}>
                  Reset
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setDrawerOpen((o) => !o)}
                  aria-expanded={drawerOpen}
                  aria-controls="controls"
                >
                  Controls <kbd>M</kbd>
                </button>
              </div>
            </div>

          </div>
        </main>
      </div>

      <ShowOverlay
        event={event}
        nightCents={nightCents}
        nextRaceNo={nextRaceNo}
        sponsor={sponsor}
        snailLinkUrl={snailLinkUrl}
      />

      {!audienceOnly && event.showPhase !== 'race' ? (
        <div className="show-controls no-print" role="toolbar" aria-label="Show controls">
          <button type="button" className="btn btn-ghost" disabled={!clientReady} onClick={backAction}>
            Back <kbd>PgUp</kbd>
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!clientReady}
            aria-controls="controls"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
          >
            Controls <kbd>M</kbd>
          </button>
          <button type="button" className={`btn btn-go`} disabled={!clientReady} onClick={forwardAction}>
            {showPhaseSpec(event.showPhase).advance} <kbd>Space</kbd>
          </button>
        </div>
      ) : null}

      {audio === 'blocked' || (audio === 'idle' && primed) ? (
        <button
          type="button"
          className="audio-blocked"
          onClick={() => {
            primeAudio();
            resumeAudio();
            setAudio(audioState());
            sfx.bell();
          }}
        >
          <span className="audio-blocked-dot" aria-hidden="true" />
          Sound is blocked by the browser - click here to turn it on
        </button>
      ) : null}

      {toast ? (
        <div className="toast glass glass-strong fixed right-5 top-5 z-[95] max-w-xs px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.2em] text-(--tx)/50">{toast.snailNo ? 'Snail sold' : 'Donation in'}</p>
          <p className="mt-1 font-semibold">
            {toast.snailNo
              ? `${toast.backerName || 'Someone'} bought snail ${toast.snailNo}, "${toast.snailName}"`
              : `${toast.backerName || 'Anonymous'} ${toast.lane < 0 ? 'gave straight to the club' : `backed ${toast.snailName}`}`}
          </p>
          <p className="num text-2xl font-bold text-(--money-b)">{money(toast.cents)}</p>
        </div>
      ) : null}

      <WinnerOverlay
        audienceOnly={audienceOnly}
        open={overlayOpen}
        raceNo={event.raceNumber}
        results={
          /* Recorded races settle without the engine, so the card falls back
             to the standing ledger entry for the race just recorded. */
          race.results.length
            ? race.results
            : (event.history.find((h) => !h.void && h.raceNo === event.raceNumber)?.results ?? [])
                .slice()
                .sort((a, b) => a.place - b.place)
        }
        owners={owners}
        highlights={highlights}
        nextRaceNo={event.raceNumber + 1}
        sponsor={event.history[0]?.sponsor ?? ''}
        lastRace={racesRun >= event.plannedRaces}
        tote={event.history.find((h) => !h.void && h.raceNo === event.raceNumber)?.tote}
        auction={event.history.find((h) => !h.void && h.raceNo === event.raceNumber)?.auction}
        onClose={() => setOverlayOpen(false)}
      />

      {holding ? <div className="projector-hold" role="status">
        <ClubBrand className="hold-brand" />
        <h2>Back shortly</h2><p>{event.eventName}</p>
      </div> : null}

      {moderator.target ? createPortal(
        <ModeratorDesk
          packControlsRef={setPackControlsRoot}
          event={event} race={race} courseName={activeCourse.name}
          raceNo={shownRaceNo} nextRaceNo={nextRaceNo}
          fullscreen={display.fullscreen} wakeLock={display.wakeLock} audio={audio}
          holding={holding} fullCourse={fullCourse || event.cameraMode === 'full'} locked={racing || event.eventMode === 'recorded' && event.packCurrent !== null}
          primaryLabel={event.showPhase !== 'race' ? showPhaseSpec(event.showPhase).advance : voidRecovery ? 'Retry void/rearm' : heldRaceStart ? 'Retry lock' : startDisabled ? race.phase === 'running' ? 'Race in progress' : 'Preparing race' : 'Start race'}
          primaryDisabled={!clientReady || (event.showPhase === 'race' ? startDisabled || event.eventMode === 'recorded' : racing || event.showPhase === 'finale')}
          canBack={!racing && ['racecard', 'market', 'race', 'intermission', 'finale'].includes(event.showPhase)}
          startError={startError} winnerOpen={overlayOpen}
          onPrimary={forwardAction} onBack={backAction}
          onSettings={() => setDrawerOpen(true)}
          onReturn={() => { setDrawerOpen(false); moderator.close(); }}
          onHold={() => { if (!racing) { silence(); setHolding((v) => !v); } }}
          onCamera={setCameraFull}
          onVoid={() => { if (moderator.target?.window.confirm(`Void race ${nextRaceNo}? No result or settlement; the same ten snails re-run.`)) voidCurrentRace(); }}
          onDismissWinner={() => setOverlayOpen(false)}
        >
      <ControlDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        donations={allDonations}
        stripeDonations={feed.donations}
        nextRaceNo={nextRaceNo}
        nightCents={nightCents}
        locked={racing}
        phonePlay={phonePlay}
        playUrl={playUrl}
      />
        </ModeratorDesk>, moderator.target.root,
      ) : (
      <ControlDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        donations={allDonations}
        stripeDonations={feed.donations}
        nextRaceNo={nextRaceNo}
        nightCents={nightCents}
        locked={racing}
        phonePlay={phonePlay}
        playUrl={playUrl}
      />
      )}
    </div>
  );
}

/* ── Small presentational pieces ──────────────────────────────────────── */

/**
 * The live lifecycle, said out loud from local lock through the official result.
 */
function StateBanner({ phase }: { phase: string }) {
  const labels: Record<string, string> = {
    idle: 'READY',
    preparing: 'LOCKING',
    held: 'HELD',
    recovery: 'RECOVERY HELD',
    voiding: 'VOIDING',
    countdown: 'COUNTDOWN',
    running: 'RUNNING',
    confirming: 'FINISH',
    done: 'FINISHED',
    void: 'VOID',
  };
  const label = labels[phase] ?? 'VOID';
  return <span className={`state-banner state-${phase}`}>{label}</span>;
}

function FeedPill({ status, lastOk }: { status: string; lastOk: number }) {
  const label =
    status === 'live'
      ? 'Stripe live'
      : status === 'offline'
        ? 'Stripe offline'
        : status === 'unconfigured'
          ? 'Card donations off'
          : 'Connecting';

  const tone =
    status === 'live'
      ? '!text-(--ok)'
      : status === 'offline'
        ? '!text-(--bad)'
        : '';

  return (
    <span
      className={`chip-toggle pointer-events-auto cursor-default ${tone}`}
      title={
        status === 'live'
          ? `Last successful read ${new Date(lastOk).toLocaleTimeString('en-AU')}`
          : status === 'unconfigured'
            ? 'STRIPE_SECRET_KEY is not set, so only cash entries are counted.'
            : 'The last read of Stripe failed. The board is showing the previous snapshot.'
      }
    >
      {status === 'live' ? <span className="live-dot" aria-hidden="true" /> : null}
      {label}
    </span>
  );
}
