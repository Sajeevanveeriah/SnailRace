'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ModeratorDesk } from './ModeratorDesk';
import { useModeratorWindow } from '@/lib/use-moderator-window';
import { useProjectorDisplay, useShowLease } from '@/lib/use-projector-display';
import { Telecast } from './Telecast';
import { Sidescroller } from './Sidescroller';
import { WinnerOverlay } from './WinnerOverlay';
import { ControlDrawer } from './ControlDrawer';
import { addAudit, audioPatch, currentState, hydrate, useEvent, setState } from '@/lib/event-store';
import { commitmentOf, planHashOf, shortHash } from '@/lib/audit';
import { recordRaceResult } from '@/lib/settlement';
import { advanceLabel, heldRaceLine, hostLineFor, interruptedRace, nextRaceNumber, nextShowPhase, raceHasRun, showPhaseSpec } from '@/lib/show';
import { addRunOff, applyPurchases, cardRaceNames, cardRaceOwners, isRunOff, nextSnailsRace, raceForSnail, validSnailNo, releaseRefunded, snailOffsetForRace, snailsForRace, type SnailPurchase } from '@/lib/card';
import { championField, raceSettings } from '@/lib/run-sheet';
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
import { useRace, type RaceController } from '@/lib/use-race';
import { funChipPoolsFor } from '@/lib/tote';
import { resolveRaceSponsor } from '@/lib/ndcc-night';
import { money } from '@/lib/money';
import { MAX_FIELD, MIN_LIVE_FIELD } from '@/lib/palette';
import { courseById } from '@/lib/courses';
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
  instantiateLockedRace,
  type DrawnRace,
} from '@/lib/race-engine';

export function Stage() {
  const event = useEvent();
  /*
   * One tab runs the show. A second tab of the site in the same browser is
   * a mirror: it follows the screens, shows a running race as in progress
   * on the main screen, and carries no controls, so nobody can start a race
   * that is already running on the projector.
   */
  const lease = useShowLease();
  const mirror = lease.settled && !lease.holder;
  const moderator = useModeratorWindow(!mirror);
  const display = useProjectorDisplay(Boolean(moderator.target));
  const mirrorRef = useRef(mirror);
  useEffect(() => {
    mirrorRef.current = mirror;
  }, [mirror]);
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
  const audienceOnly = mirror || Boolean(moderator.target) || display.fullscreen;
  /* The audience view locks page scroll with a body class rather than body:has(), which restyled the page every frame. */
  useEffect(() => {
    document.body.classList.toggle('projector-audience-on', audienceOnly);
    return () => document.body.classList.remove('projector-audience-on');
  }, [audienceOnly]);

  const [clientReady, setClientReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  /* True for a moment after the winner moment hands over to the next screen. */
  const [winnerHandoff, setWinnerHandoff] = useState(false);
  useEffect(() => {
    if (!winnerHandoff) return;
    const id = window.setTimeout(() => setWinnerHandoff(false), 700);
    return () => window.clearTimeout(id);
  }, [winnerHandoff]);
  const [dismissedToast, setDismissedToast] = useState<string | null>(null);
  const origin = useOrigin();

  useEffect(() => {
    hydrate();
    /* A reload on a result comes back on the result: the winner card goes up
       over the official result, as it was when the page went. */
    const saved = currentState();
    const standing = saved.history.find((h) => !h.void && h.raceNo === saved.raceNumber);
    const id = window.setTimeout(() => {
      setClientReady(true);
      if (saved.showPhase === 'results' && standing && !saved.heldRaceStart) setOverlayOpen(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  /* A mirror is silent: the main screen already plays the room's sound. */
  useEffect(() => {
    setSoundEnabled(event.sound && !mirror);
  }, [event.sound, mirror]);

  useEffect(() => {
    setMusicOn(event.music);
  }, [event.music]);

  useEffect(() => {
    setCallerOn(event.sound && event.caller && !mirror);
  }, [event.sound, event.caller, mirror]);

  useEffect(() => {
    setLevels({ master: event.volume, music: event.musicVolume });
  }, [event.volume, event.musicVolume]);

  useEffect(() => () => {
    stopTrack(0.2);
  }, []);

  const feed = useDonations(event.eventId);
  /* One past the latest race that stands: never a race already in the history. */
  const nextRaceNo = useMemo(() => nextRaceNumber(event.raceNumber, event.history), [event.raceNumber, event.history]);
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
  /* Everything the next race runs on comes from its run sheet row. */
  const nextSettings = useMemo(() => raceSettings(event, nextRaceNo), [event, nextRaceNo]);
  const finishedEntry = event.showPhase === 'results'
    ? event.history.find((entry) => entry.raceNo === event.raceNumber && !entry.void)
    : undefined;
  const finishedCourseId = finishedEntry?.courseId;
  const activeCourse = courseById(
    event.heldRaceStart?.plan.courseId ?? finishedCourseId ?? nextSettings.courseId,
  );
  /* The view on the projector: the held race's, the finished race's, or the next one's. */
  const shownTrackShape =
    event.heldRaceStart?.config.trackShape ?? finishedEntry?.trackShape ?? nextSettings.trackShape;
  /* Laps on screen: the held race's, the finished race's, or the next one's. */
  const shownLaps = event.heldRaceStart?.config.laps ?? finishedEntry?.laps ?? nextSettings.laps;
  /* A run-off's lanes are not a run of numbers: the track shows lane numbers. */
  const shownOffset = isRunOff(event.card, shownRaceNo) ? 0 : snailOffsetForRace(shownRaceNo, event.card);
  /* The snail number in each lane: a run-off's runners are not consecutive. */
  const shownNumbers = useMemo(() => snailsForRace(shownRaceNo, event.card), [shownRaceNo, event.card]);
  const sponsorInfo = useMemo(
    () => resolveRaceSponsor(event.raceSponsors, event.sponsors, nextRaceNo),
    [event.raceSponsors, event.sponsors, nextRaceNo],
  );
  const sponsor = sponsorInfo.name;

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
        /* A Stripe snail purchase is tagged by number; its race depends on tonight's card size. */
        .filter((donation) => (donation.snailNo ? validSnailNo(donation.snailNo, event.card) && raceForSnail(donation.snailNo, event.card) : donation.raceNo) === nextRaceNo)
        .reduce((sum, donation) => sum + donation.cents, 0),
    [liveDonations, nextRaceNo, event.card],
  );

  /* Fixed fair-play prices for the lock snapshot and any Phone Play room. */
  const { lanes } = useMemo(
    () => funChipPoolsFor(event.bets, fieldNames, nextRaceNo),
    [event.bets, fieldNames, nextRaceNo],
  );

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

  /* ── Paid snails fill the roster ─────────────────────────────────────── */

  /*
   * A Stripe payment that bought a numbered snail names it on the card. The
   * feed is polled, so this runs on every snapshot and applies only what is
   * new; a slot the desk typed by hand is never overwritten by a payment.
   */
  /* Conflicts already told to the desk, so a poll does not repeat them. */
  const reportedConflictsRef = useRef<Set<string>>(new Set());
  /* Locked from the moment Start is pressed, not only once the hashed plan
     has been persisted: the names were copied into the plan at the first
     synchronous step of arming. */
  const lockedRaceNo = event.heldRaceStart?.raceNo ?? (preparingRace || heldRaceStart ? nextRaceNo : null);
  useEffect(() => {
    /*
     * A race that is armed or running keeps the names its plan was hashed
     * with. A payment for one of its snails waits in the feed and is applied
     * once the race has settled; manual edits are disabled for the same
     * reason, and Stripe gets no exception.
     */
    const card = event.card;
    const snailCount = card.snailCount;
    /* The locked race's own field: a run-off's runners belong to their own
       numbered races too, so race membership alone would let them through. */
    const runsIn = (raceNo: number | null) => {
      const field = raceNo === null ? [] : snailsForRace(raceNo, card);
      return (n: number) => field.includes(n);
    };
    const locked = runsIn(lockedRaceNo);
    const purchases: SnailPurchase[] = feed.donations
      .filter((d) => !d.void && d.snailNo && !locked(d.snailNo))
      .map((d) => ({ snailNo: d.snailNo!, snailName: d.snailName, owner: d.backerName, id: d.id }));
    /* A fully refunded purchase releases the slot it bought. */
    const refunded = feed.donations.filter((d) => d.void && d.snailNo && !locked(d.snailNo)).map((d) => d.id);
    /* The holder applies payments to the card; a mirror only reads it. */
    if (mirror || (!purchases.length && !refunded.length)) return;
    const id = window.setTimeout(() => {
      /* Re-check inside the deferred callback: arming may have begun since. */
      if (armedRef.current) {
        const armed = runsIn(armedRef.current.raceNo);
        const refundedSnails = feed.donations.filter((d) => d.void && d.snailNo && refunded.includes(d.id)).map((d) => d.snailNo!);
        if (purchases.some((p) => armed(p.snailNo)) || refundedSnails.some(armed)) return;
      }
      const before = currentState().card;
      const freed = releaseRefunded(before, refunded);
      const applied = applyPurchases(freed.card, purchases);
      if (freed.released.length || applied.changed) setState({ card: applied.card });
      for (const n of freed.released) {
        addAudit({ kind: 'note', raceNo: raceForSnail(n, card), detail: `Snail ${n} released: its card payment was refunded in full.` });
      }
      const fresh = purchases.filter((p) => !freed.card.claims[p.snailNo] && applied.card.claims[p.snailNo] === p.id);
      for (const p of fresh) {
        addAudit({ kind: 'snail_sold', raceNo: raceForSnail(p.snailNo, card), detail: `Snail ${p.snailNo} sold by card: "${p.snailName}" for ${p.owner || 'an anonymous owner'}.` });
      }
      /* A paid number that was already taken is a real problem for a real
         person at the bar: it goes to the audit trail and the desk notice. */
      for (const c of applied.conflicts) {
        if (reportedConflictsRef.current.has(c.id)) continue;
        reportedConflictsRef.current.add(c.id);
        addAudit({
          kind: 'note',
          raceNo: raceForSnail(c.snailNo, card),
          detail: `CONFLICT: ${c.owner || 'a buyer'} paid for snail ${c.snailNo} ("${c.snailName}", Stripe ${c.id}) but that number ${c.snailNo > snailCount ? `is past the ${snailCount} snails on the card` : 'is already taken'}. Resolve at the desk and refund or reassign.`,
        });
      }
      setState((s) => {
        const pending = applied.conflicts.map((c) => `Snail ${c.snailNo} was paid for by ${c.owner || 'a buyer'} but ${c.snailNo > snailCount ? 'is not on the card' : 'is already taken'}`);
        return pending.join('; ') === s.card.conflictNotice ? {} : { card: { ...s.card, conflictNotice: pending.join('; ') } };
      });
    }, 0);
    return () => window.clearTimeout(id);
  }, [feed.donations, lockedRaceNo, preparingRace, heldRaceStart, nextRaceNo, event.card, mirror]);

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

      /* A mirror never settles: only the tab that holds the show records a result. */
      if (mirrorRef.current) {
        armedRef.current = null;
        setHighlights(reel);
        return;
      }

      /*
       * One settlement path for every race source. `recordRaceResult` holds
       * the exactly-once guard, snapshots, streaks, audit entries and the
       * async result hash; this callback only supplies the engine's entry
       * and drives the stage furniture.
       */
      const { recorded } = recordRaceResult({
        raceNo,
        raceType: armed?.config.raceType ?? nextSettings.raceType,
        seedHex: drawn.seedHex,
        fieldSize: armed?.config.fieldSize ?? names.length,
        durationMs: armed?.config.durationMs ?? nextSettings.durationMs,
        at: finishedAt,
        results,
        potCents: raceDonationCents,
        photoFinish: drawn.photoFinish,
        highlights: reel,
        sponsor,
        source: 'engine',
        names: armed?.config.names ?? names,
        owners: cardRaceOwners(event.card, raceNo),
        snailOffset: snailOffsetForRace(raceNo, event.card),
        ...(isRunOff(event.card, raceNo) ? { snails: snailsForRace(raceNo, event.card) } : {}),
        laps: armed?.config.laps,
        surprises: armed?.config.surprises,
        trackShape: armed?.config.trackShape ?? nextSettings.trackShape,
        courseId: armed?.config.courseId ?? activeCourse.id,
        intensity: armed?.config.intensity ?? nextSettings.intensity,
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
    [nextSettings, event.card, names, nextRaceNo, raceDonationCents, sponsor, activeCourse.id],
  );

  const race = useRace(onFinish);

  /*
   * Re-arm the exact durable plan after hydration. The engine itself is
   * intentionally in-memory; only an idle controller needs to act, while an
   * already running instance keeps its banner. The plan is judged from the
   * wall clock: a race whose result already stood before the page came back
   * is recorded from the plan, and one the room was watching restarts from
   * the gate with a plain line. (The engine runs a plan from the off only;
   * resuming it part way needs `startLocked` to take a race time offset.)
   */
  useEffect(() => {
    const held = event.heldRaceStart;
    if (!held || !lease.settled || mirror || armedRef.current?.planHash === held.planHash) return;
    armedRef.current = held;
    if (race.phase === 'idle' || race.phase === 'done' || race.phase === 'void') {
      const id = window.setTimeout(() => {
        if (armedRef.current?.planHash !== held.planHash) return;
        const verdict = interruptedRace(held, nowMs());
        if (verdict.kind === 'finished' && !event.phonePlay) {
          const ordered = held.plan.results.slice().sort((a, b) => a.place - b.place);
          addAudit({
            kind: 'note',
            raceNo: held.raceNo,
            detail: `Race ${held.raceNo} finished while the projector page was away: its sealed result (plan ${shortHash(held.planHash)}…) is recorded from the plan.`,
          });
          onFinish(instantiateLockedRace(held.plan), ordered, []);
          return;
        }
        setPreparingRace(false);
        setHeldRaceStart(true);
        setStartError(heldRaceLine(held.raceNo, verdict.kind, Boolean(event.phonePlay)));
        if (event.bettingOpen) setState({ bettingOpen: false });
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [event.heldRaceStart, event.bettingOpen, event.phonePlay, race.phase, lease.settled, mirror, onFinish]);

  /* A race left on a mirror's screen clears with the main screen's next step,
     and a tab that loses the show mid-race stops its own engine at once. */
  useEffect(() => {
    if (!mirror || race.phase === 'idle') return;
    const live = race.phase === 'countdown' || race.phase === 'running' || race.phase === 'confirming';
    if (!live && (event.showPhase === 'race' || event.showPhase === 'results')) return;
    race.reset();
  }, [mirror, event.showPhase, race]);

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
      /* Strictly after the lock: a reload reads "started" from this. */
      const started: HeldRaceStartState = { ...armed, startedAt: Math.max(nowMs(), armed.lockedAt + 1) };
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

    if (raceHasRun(nextRaceNo, event.history)) {
      setStartError(`Race ${nextRaceNo} has already run. Press Next.`);
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

    const laps = nextSettings.trackShape === 'circuit' ? nextSettings.laps : 1;
    const lockedAt = nowMs();
    const oddsAtLock: Record<number, number> = {};
    for (const lane of lanes) oddsAtLock[lane.lane] = lane.odds;

    const plan = drawLockedRacePlan(
      freshSeed(),
      fieldNames,
      nextSettings.durationMs,
      event.surprises,
      nextSettings.intensity,
      laps,
      nextSettings.trackShape,
      nextSettings.courseId,
      event.dealtCards,
    );
    const config: HeldRaceStartState['config'] = {
      raceNo: nextRaceNo,
      raceType: nextSettings.raceType,
      fieldSize: fieldNames.length,
      names: fieldNames.slice(),
      durationMs: nextSettings.durationMs,
      laps,
      surprises: event.surprises,
      trackShape: nextSettings.trackShape,
      courseId: nextSettings.courseId,
      intensity: nextSettings.intensity,
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
    nextSettings,
    event.surprises,
    event.phonePlay,
    event.heldRaceStart,
    event.dealtCards,
    event.plannedRaces,
    event.history,
  ]);

  /*
   * The in-memory race lifecycle follows the store: when the night's armed
   * race is cleared with the show off the race screen (a cleared rehearsal,
   * a dropped stale start), the local lock and the armed plan go with it,
   * or the show controls would stay held in this tab until a reload.
   */
  useEffect(() => {
    if (event.showPhase === 'race' || event.heldRaceStart) return;
    if (!heldRaceStart && !preparingRace && !armedRef.current) return;
    armedRef.current = null;
    setHeldRaceStart(false);
    setPreparingRace(false);
    setStartError('');
  }, [event.showPhase, event.heldRaceStart, heldRaceStart, preparingRace]);

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
          ? heldRaceLine(event.heldRaceStart.raceNo, interruptedRace(event.heldRaceStart, nowMs()).kind, Boolean(event.phonePlay))
          : '',
      );
      if (event.heldRaceStart && event.bettingOpen) setState({ bettingOpen: false });
    }, 0);
    return () => window.clearTimeout(id);
  }, [event.eventId, event.heldRaceStart, event.bettingOpen, event.phonePlay, race]);

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
      raceType: armed?.config.raceType ?? nextSettings.raceType,
      seedHex: race.seedHex || '--------',
      fieldSize: armed?.config.fieldSize ?? fieldNames.length,
      durationMs: armed?.config.durationMs ?? nextSettings.durationMs,
      at: nowMs(),
      results: [],
      potCents: raceDonationCents,
      photoFinish: false,
      sponsor,
      names: armed?.config.names ?? fieldNames,
      owners: cardRaceOwners(event.card, raceNo),
      snailOffset: snailOffsetForRace(raceNo, event.card),
      ...(isRunOff(event.card, raceNo) ? { snails: snailsForRace(raceNo, event.card) } : {}),
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
  }, [race, nextRaceNo, nextSettings, event.card, fieldNames, raceDonationCents, sponsor, acknowledgeVoidAndRearm]);

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

  /* The night is a league: the quaddie board shows between races only when Admin switches the championship screens on. */
  const quaddieLive = quaddieIsLive(event.quaddie) && event.championshipScreens && event.quaddieEntries.length > 0;

  /** The host speaks between races; the race keeps its own richer caller. */
  const sayHost = useCallback((text: string) => {
    say(text, 'big');
  }, []);

  const goToPhase = useCallback(
    (phase: ShowPhase) => {
      setState({ showPhase: phase, ...(phase === 'race' ? { bettingOpen: false } : {}) });
      /* A race with its own camera on the run sheet starts on it. */
      if ((phase === 'racecard' || phase === 'race') && nextSettings.camera) setCameraFull(nextSettings.camera === 'full');
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
    [sayHost, event.clubName, event.eventName, event.plannedRaces, event.intensity, nextRaceNo, sponsor, nextSettings.camera, setCameraFull],
  );

  /*
   * The night never dead-ends: after the last race the desk can add one
   * more, either the next snails on the card or a winners' run-off. The
   * show goes straight to the new race's racecard.
   */
  const addRaceAfterCard = useCallback(
    (kind: 'next' | 'runoff') => {
      if (holding || preparingRace || heldRaceStart || event.heldRaceStart || voidingRace || voidRecovery) return;
      const card = currentState().card;
      const raceNo = card.races.length + 1;
      if (kind === 'runoff') {
        const field = championField(currentState().history);
        if (field.length < MIN_LIVE_FIELD) return;
        setState({ card: addRunOff(card, field) });
        addAudit({ kind: 'note', raceNo, detail: `Race ${raceNo} added after the card: Champion of champions, snails ${field.join(', ')}.` });
      } else {
        const next = nextSnailsRace(card);
        if (!next) return;
        setState({ card: next.card });
        addAudit({ kind: 'note', raceNo, detail: `Race ${raceNo} added after the card: snails ${next.first} to ${next.last}${next.added ? `, ${next.added} more put on sale` : ''}.` });
      }
      if (event.showPhase === 'results' || event.showPhase === 'finale' || event.showPhase === 'championship') {
        if (overlayOpen) setWinnerHandoff(true);
        setOverlayOpen(false);
        race.reset();
        goToPhase('racecard');
      }
    },
    [holding, preparingRace, heldRaceStart, event.heldRaceStart, voidingRace, voidRecovery, event.showPhase, race, goToPhase, overlayOpen],
  );

  const advanceShow = useCallback(() => {
    if (holding || preparingRace || heldRaceStart || voidingRace || voidRecovery || event.showPhase === 'race') return;
    /* An armed race only has meaning on the race screen; one left behind
       anywhere else is cleared rather than left to hold the show. */
    if (event.heldRaceStart) setState({ heldRaceStart: null });
    const next = nextShowPhase(event.showPhase, { racesRun, plannedRaces: event.plannedRaces, quaddieLive, nextRaceNo });
    if (next === event.showPhase) return;
    if (event.showPhase === 'results') {
      /* The winner moment fades out over the next screen, which comes on at once beneath it. */
      if (overlayOpen) setWinnerHandoff(true);
      setOverlayOpen(false);
      race.reset();
    }
    goToPhase(next);
  }, [event.showPhase, event.plannedRaces, event.heldRaceStart, racesRun, nextRaceNo, goToPhase, race, holding, preparingRace, heldRaceStart, voidingRace, voidRecovery, quaddieLive, overlayOpen]);

  const backShow = useCallback(() => {
    if (holding || preparingRace || heldRaceStart || voidingRace || voidRecovery || (event.eventMode === 'recorded' && event.packCurrent)) return;
    if (event.heldRaceStart && event.showPhase === 'race') return;
    if (event.heldRaceStart) setState({ heldRaceStart: null });
    const back: Partial<Record<ShowPhase, ShowPhase>> = {
      racecard: 'lobby',
      race: 'racecard',
      finale: quaddieLive ? 'championship' : 'results',
    };
    const prev = back[event.showPhase];
    if (prev) goToPhase(prev);
  }, [event.showPhase, event.heldRaceStart, event.eventMode, event.packCurrent, goToPhase, holding, preparingRace, heldRaceStart, voidingRace, voidRecovery, quaddieLive]);

  /*
   * The run sheet shrunk to (or below) the races already run while a
   * racecard or an idle gate is up: there is no race left to show, so the
   * show goes to the thank you screen rather than offering a race that has
   * already happened. Adding a race afterwards brings the racecard back.
   */
  useEffect(() => {
    if (mirror || !lease.settled || holding) return;
    if (event.showPhase !== 'racecard' && event.showPhase !== 'race') return;
    if (event.heldRaceStart || preparingRace || heldRaceStart || voidingRace || voidRecovery || race.phase !== 'idle') return;
    if (event.eventMode === 'recorded') return;
    if (racesRun === 0 || nextRaceNo <= event.plannedRaces) return;
    const id = window.setTimeout(() => goToPhase('finale'), 0);
    return () => window.clearTimeout(id);
  }, [mirror, lease.settled, holding, event.showPhase, event.heldRaceStart, event.eventMode, event.plannedRaces, preparingRace, heldRaceStart, voidingRace, voidRecovery, race.phase, racesRun, nextRaceNo, goToPhase]);

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

  const phonePlay = usePhonePlay(HAS_LIVE_API && !mirror ? liveShow : null);
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
      if (mirrorRef.current) return;
      const raceNo = nextRaceNo;
      const finishedAt = nowMs();
      const { recorded } = recordRaceResult({
        raceNo,
        raceType: nextSettings.raceType,
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
    [nextRaceNo, nextSettings.raceType, event.racePack?.packId, event.packCommit, raceDonationCents, sponsor, lanes],
  );

  const onPackVoid = useCallback(
    (packRace: PackRace, reason: string) => {
      if (mirrorRef.current) return;
      const raceNo = nextRaceNo;
      setState((s) => ({
        bettingOpen: true,
        history: [
          {
            raceNo,
            raceType: nextSettings.raceType,
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
    [nextRaceNo, nextSettings.raceType, event.racePack?.packId, raceDonationCents, sponsor],
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
    if (mirrorRef.current) return;
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
      /* A focused button already acts on Space and Enter: do not advance as well. */
      if ((e.code === 'Space' || k === 'enter') && target?.closest?.('button,a')) return;
      /* A mirror has one key: F for fullscreen. The show is driven from the main screen. */
      if (mirror) {
        if (k === 'f' && e.currentTarget === window) void toggleFullscreen();
        return;
      }
      if (k === 'm') { e.preventDefault(); setDrawerOpen((open) => !open); return; }
      if (drawerOpen) return;
      /* Enter is what a presenter clicker sends: forward, like Space. */
      if (e.code === 'Space' || e.code === 'PageDown' || e.code === 'ArrowRight' || k === 'enter') {
        e.preventDefault(); forwardAction();
      } else if (e.code === 'PageUp' || e.code === 'ArrowLeft') {
        e.preventDefault(); backAction();
      } else if (k === 'c') setState({ calm: !event.calm });
      else if (k === 's') setState(audioPatch(event.audioMode === 'off' ? 'music' : 'off'));
      else if (k === 'a') {
        const order: AudioMode[] = ['music', 'commentary', 'both', 'off'];
        setState(audioPatch(order[(order.indexOf(event.audioMode) + 1) % order.length]));
      }
      /* The camera is a race-screen choice: V does nothing on the welcome or the racecard. */
      else if (k === 'v') { if (event.showPhase === 'race') setCameraFull(!(fullCourse || event.cameraMode === 'full')); }
      else if (k === 'd') openModerator();
      else if (k === 'f' && e.currentTarget === window) void toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    moderator.target?.window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      try { moderator.target?.window.removeEventListener('keydown', onKey); }
      catch { /* A desk navigated to another origin no longer exposes its listeners. */ }
    };
  }, [drawerOpen, overlayOpen, forwardAction, backAction, moderator.target, toggleFullscreen, event.calm, event.audioMode, event.cameraMode, event.showPhase, fullCourse, setCameraFull, openModerator, mirror]);

  /* ── The snail link ──────────────────────────────────────────────────── */

  /*
   * One QR for the night: a reusable Stripe Payment Link that sells a $4
   * snail and asks for its number, its name and the owner's name. A server
   * deployment mints it here; the static Pages build cannot, so there the
   * link the operator pasted into Admin stands. A minted link is replaced
   * when the price changes; a pasted link is never replaced by the stage.
   */
  useEffect(() => {
    if (!event.eventId || !HAS_API || mirror) return;
    let cancel = false;
    void (async () => {
      try {
        const res = await fetch('/api/payment-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: event.eventId, kind: 'snail', cents: event.card.snailCents, snails: event.card.snailCount }),
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
  }, [event.eventId, event.card.snailCents, event.card.snailCount, mirror]);

  const snailLinkUrl = event.card.paymentLinkUrl;

  /*
   * The result screen is rebuilt from the history whenever the show sits on
   * a result with the engine idle: after a reload, after Back from the thank
   * you screen, or on a mirror. The stage then draws the official result and
   * the desk reads the winner, not "Ready to race".
   */
  const restoredEntry = useMemo(() => {
    if (event.showPhase !== 'results' || race.phase !== 'idle' || event.heldRaceStart) return null;
    /* The latest standing race, the same one the next race is counted from. */
    const entry = event.history.find((h) => !h.void && h.raceNo === nextRaceNo - 1);
    return entry && entry.results.length ? entry : null;
  }, [event.showPhase, event.history, nextRaceNo, event.heldRaceStart, race.phase]);
  const shownRace = useMemo<RaceController>(() => {
    if (!restoredEntry) return race;
    const results = restoredEntry.results.slice().sort((a, b) => a.place - b.place);
    const winner = results.find((r) => r.place === 1);
    return {
      ...race,
      phase: 'done',
      status: winner ? `${winner.name} wins!` : 'Race over',
      commentary: '',
      countdown: '',
      seedHex: restoredEntry.seedHex,
      photoFinish: restoredEntry.photoFinish,
      results,
      laps: restoredEntry.laps ?? 1,
      moment: null,
    };
  }, [race, restoredEntry]);

  const voidable = race.phase === 'running' || race.phase === 'countdown';
  const racing = (event.eventMode === 'recorded' && event.packCurrent !== null) || preparingRace || heldRaceStart || event.heldRaceStart !== null || voidingRace || voidRecovery !== null || voidable || race.phase === 'confirming';
  const startDisabled = preparingRace || voidingRace || voidable || race.phase === 'confirming';
  /*
   * Cinema mode. A projector at the back of a hall wants the race, not the
   * furniture: while one is on, the course goes full bleed and everything a
   * moderator reads between races gets out of the way. Measured on a 1080p
   * screen the course went from under half of it to nearly all of it.
   */
  const cinema = audienceOnly || voidable || race.phase === 'confirming' || shownRace.phase === 'done';
  const showControlsVisible = !audienceOnly && event.showPhase !== 'race' && event.showPhase !== 'results';
  const showCtx = { racesRun, plannedRaces: event.plannedRaces, quaddieLive, nextRaceNo };
  const nightDone = event.showPhase === 'finale';
  /* The desk's or the display's one-line notice: in the control band when one is showing, else in the corner. */
  const noticeText = display.error || moderator.notice;
  const notice = noticeText ? <p className="projector-note" role="status">{noticeText}</p> : null;
  /*
   * A mirror never runs the engine: a second copy of the race in a hidden or
   * throttled tab would finish early and show the result before the main
   * screen does. While the main screen races, the mirror says so; the
   * official result appears here when it stands.
   */
  const mirrorRacing = mirror && event.showPhase === 'race' && event.heldRaceStart !== null && event.heldRaceStart.startedAt > event.heldRaceStart.lockedAt;

  /* The same two buttons on every operator screen: open the desk, go fullscreen. */
  const deskButton = (
    <button type="button" className="btn btn-ghost" disabled={!clientReady} onClick={(e) => { e.currentTarget.blur(); openModerator(); }}>
      {moderator.target ? 'Focus desk' : 'Open desk'} <kbd>D</kbd>
    </button>
  );
  const fullscreenButton = (
    <button
      type="button"
      className="btn btn-ghost"
      disabled={!clientReady}
      onClick={(e) => {
        const button = e.currentTarget;
        const pointer = e.detail > 0;
        void display.toggleFullscreen().then(() => { if (pointer && document.fullscreenElement) button.blur(); });
      }}
    >
      {display.fullscreen ? 'Exit fullscreen' : 'Fullscreen'} <kbd>F</kbd>
    </button>
  );

  return (
    <div
      className={`${event.calm ? 'calm ' : ''}${cinema ? 'cinema ' : ''}${audienceOnly ? 'projector-audience ' : ''}${display.fullscreen ? 'projector-fullscreen' : ''}`}
      data-projector-fullscreen={display.fullscreen}
      data-moderator-connected={Boolean(moderator.target)}
      data-hydrated={clientReady ? 'true' : 'false'}
    >
      {!audienceOnly && (event.showPhase === 'race' || event.showPhase === 'results') ? (
        <a className="skip-link" href="#controls">
          Skip to Admin
        </a>
      ) : null}
      <div className="aurora" aria-hidden="true" />
      {/* Desk and fullscreen live in the control row of each screen. This
          corner appears once the desk is open or the projector is fullscreen
          (it has no other controls then; it fades until hovered), for a held
          show, or for a notice. */}
      {/* With the desk connected the projector carries no operator controls:
          the desk has them all. Fullscreen without a desk keeps a corner that
          fades until hovered. */}
      {mirror ? (
        <div className="projector-tools projector-mirror no-print" role="toolbar" aria-label="Projector display">
          <span className="projector-mirror-badge">Mirror of the main screen</span>
          {fullscreenButton}
        </div>
      ) : !moderator.target && (display.fullscreen || holding) ? (
        <div className="projector-tools no-print" role="toolbar" aria-label="Projector display">
          {display.fullscreen ? fullscreenButton : null}
          {holding ? <button type="button" className="btn btn-go" onClick={() => setHolding(false)}>Resume show</button> : null}
        </div>
      ) : null}
      {noticeText && audienceOnly ? (
        <p className="projector-notice no-print" role="status">{noticeText}</p>
      ) : null}
      {mirrorRacing ? (
        <div className="mirror-card" role="status">
          <span className="mirror-card-kicker">Race {event.heldRaceStart?.raceNo}</span>
          <strong>Race in progress on the main screen</strong>
          <span>The result shows here when it stands.</span>
        </div>
      ) : null}

      <div
        className="stage-shell mx-auto flex min-h-dvh w-full max-w-[1700px] flex-col gap-5 p-4 sm:p-6 lg:p-8"
        inert={event.showPhase !== 'race' && event.showPhase !== 'results'}
        aria-hidden={event.showPhase !== 'race' && event.showPhase !== 'results'}
      >
        {/* The projector shows the telecast and nothing else; its own title
            bar names the club, the race and the clock. Settings live on the
            desk and in Admin. */}
        {/* ── Stage body ─────────────────────────────────────────────── */}
        <main className="stage-main grid flex-1 gap-5">
          <div className="stage-track flex min-w-0 flex-col gap-4">
            {event.eventMode === 'recorded' && mirror ? null : event.eventMode === 'recorded' ? (
              <PackRunner onResult={onPackResult} onVoid={onPackVoid} controlsTarget={packControlsRoot} raceNo={nextRaceNo} />
            ) : shownTrackShape === 'circuit' ? (
              // The imperative SVG painter starts after saved state is restored.
              clientReady ? (
                <Telecast
                  names={names}
                  owners={owners}
                  race={shownRace}
                  surface={event.stageTheme}
                  laps={shownLaps}
                  cameraMode={event.cameraMode}
                  calm={event.calm}
                  clubName={event.clubName}
                  raceNo={shownRaceNo}
                  courseId={activeCourse.id}
                  fullCourse={fullCourse || event.cameraMode === 'full'}
                  onCourseViewChange={setCameraFull}
                  sponsor={event.showPhase === 'results' ? (event.history[0]?.sponsor ?? sponsor) : sponsor}
                  toteResult={event.history.find((h) => !h.void && h.raceNo === event.raceNumber)?.tote ?? null}
                  numberOffset={shownOffset}
                  numbers={shownNumbers}
                />
              ) : (
                <div className="track-wrap tv-wrap race-broadcast" aria-hidden="true" />
              )
            ) : clientReady ? (
              <Sidescroller
                names={names}
                owners={owners}
                race={shownRace}
                calm={event.calm}
                clubName={event.clubName}
                raceNo={shownRaceNo}
                cameraMode={event.cameraMode}
                fullCourse={fullCourse || event.cameraMode === 'full'}
                onCourseViewChange={setCameraFull}
                sponsor={event.showPhase === 'results' ? (event.history[0]?.sponsor ?? sponsor) : sponsor}
                sponsors={event.sponsors}
                toteResult={event.history.find((h) => !h.void && h.raceNo === event.raceNumber)?.tote ?? null}
                numberOffset={shownOffset}
                numbers={shownNumbers}
              />
            ) : (
              <div className="track-wrap tv-wrap race-broadcast" aria-hidden="true" />
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
                            : shownRace.phase
                    }
                  />
                  <p className="text-lg font-semibold">
                    {preparingRace ? 'Locking the complete race plan…' : startError || shownRace.status}
                  </p>
                  {shownRace.seedHex ? (
                    <span
                      className="num text-[11px] text-(--tx)/35"
                      title="The seed the finishing order was drawn from, printed before the snails moved."
                    >
                      seed {shownRace.seedHex}
                    </span>
                  ) : null}
                </div>
                {event.showPhase === 'race' || event.showPhase === 'results' ? notice : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {event.eventMode === 'live' ? (
                <button
                  type="button"
                  className={`btn btn-go ${!racing ? 'btn-pulse' : ''}`}
                  onClick={(e) => {
                    /* A clicked button keeps focus, and a focused strip stays
                       over the course; the keyboard still works unfocused. */
                    e.currentTarget.blur();
                    if (voidRecovery) void retryVoidRecovery();
                    else if (shownRace.phase === 'done') forwardAction();
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
                      ? event.phonePlay ? 'Retry lock' : 'Start race'
                    : shownRace.phase === 'done'
                      ? 'Next'
                      : race.phase === 'void'
                        ? 'Re-run race'
                        : 'Start race'}{' '}
                  <kbd>Space</kbd>
                </button>
                ) : null}
                {voidable && event.eventMode === 'live' ? (
                  <button
                    type="button"
                    className="btn btn-ghost stage-void"
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
                <button type="button" className="btn btn-ghost" onClick={(e) => { e.currentTarget.blur(); resetRace(); }} disabled={racing}>
                  Reset
                </button>
                {deskButton}
                {fullscreenButton}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setDrawerOpen((o) => !o)}
                  aria-expanded={drawerOpen}
                  aria-controls="controls"
                >
                  Admin <kbd>M</kbd>
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
        controlsVisible={showControlsVisible}
        holding={holding}
        beneathWinner={winnerHandoff}
      />

      {showControlsVisible ? (
        <div className="show-controls no-print" role="toolbar" aria-label="Show controls">
          {notice}
          <button type="button" className="btn btn-ghost" disabled={!clientReady} onClick={backAction}>
            Back <kbd>PgUp</kbd>
          </button>
          {deskButton}
          {fullscreenButton}
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!clientReady}
            aria-controls="controls"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
          >
            Admin <kbd>M</kbd>
          </button>
          {nightDone ? (
            <span className="show-done" role="status">Night complete</span>
          ) : (
            <button type="button" className={`btn btn-go`} disabled={!clientReady} onClick={forwardAction}>
              {advanceLabel(event.showPhase, showCtx)} <kbd>Space</kbd>
            </button>
          )}
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
            : (event.history.find((h) => !h.void && h.raceNo === nextRaceNo - 1)?.results ?? [])
                .slice()
                .sort((a, b) => a.place - b.place)
        }
        owners={owners}
        highlights={highlights}
        nextRaceNo={nextRaceNo}
        card={event.card}
        entry={event.history.find((h) => !h.void && h.raceNo === nextRaceNo - 1)}
        sponsor={event.history[0]?.sponsor ?? ''}
        lastRace={racesRun >= event.plannedRaces}
        calm={event.calm}
        tote={event.history.find((h) => !h.void && h.raceNo === nextRaceNo - 1)?.tote}
        auction={event.history.find((h) => !h.void && h.raceNo === nextRaceNo - 1)?.auction}
        onClose={() => setOverlayOpen(false)}
      />

      {moderator.target ? createPortal(
        <ModeratorDesk
          packControlsRef={setPackControlsRoot}
          event={event} race={shownRace} courseName={activeCourse.name}
          onAddRace={addRaceAfterCard}

          raceNo={shownRaceNo} nextRaceNo={nextRaceNo}
          fullscreen={display.fullscreen} wakeLock={display.wakeLock} audio={audio}
          holding={holding} fullCourse={fullCourse || event.cameraMode === 'full'} locked={racing || event.eventMode === 'recorded' && event.packCurrent !== null}
          primaryLabel={event.showPhase !== 'race' ? advanceLabel(event.showPhase, showCtx) : voidRecovery ? 'Retry void/rearm' : heldRaceStart ? event.phonePlay ? 'Retry lock' : 'Start race' : startDisabled ? race.phase === 'running' ? 'Race in progress' : 'Preparing race' : 'Start race'}
          primaryDisabled={!clientReady || (event.showPhase === 'race' ? startDisabled || event.eventMode === 'recorded' : racing || event.showPhase === 'finale')}
          canBack={!racing && ['racecard', 'race', 'finale'].includes(event.showPhase)}
          startError={startError} winnerOpen={overlayOpen}
          onPrimary={forwardAction} onBack={backAction}
          onSettings={() => setDrawerOpen(true)}
          onReturn={() => { setDrawerOpen(false); moderator.close(); }}
          onHold={() => { if (!racing) { silence(); setHolding((v) => !v); } }}
          onCamera={setCameraFull}
          onVoid={() => { if (moderator.target?.window.confirm(`Void race ${nextRaceNo}? No result or settlement; the same snails re-run.`)) voidCurrentRace(); }}
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

