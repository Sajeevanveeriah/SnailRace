'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { addAudit, setState, useEvent } from './event-store';
import { HAS_LIVE_API, liveApiUrl } from './deployment';
import { newId } from './ids';
import { fetchWithTimeout } from './network';
import type { LiveShow } from './live/store';
import type { RaceResult } from './types';

/**
 * The stage's half of Phone Play.
 *
 * The stage device is the operator: it opens the session, pushes the
 * authoritative show snapshot whenever it changes, polls the room summary
 * for the projector, and asks the server to settle - the server holds the
 * exactly-once guard, so a stage that reloads and asks again cannot pay the
 * room twice.
 */

export interface RoomSummary {
  players: number;
  perLane: Record<number, { chips: number; players: number }>;
  reactions: Record<string, number>;
  leaderboard: { name: string; chips: number }[];
}

const EMPTY: RoomSummary = { players: 0, perLane: {}, reactions: {}, leaderboard: [] };

type AckBody = { ok: boolean; error?: string; [key: string]: unknown };
type AckResult<T extends AckBody> =
  | { ok: true; status: number; body: T }
  | { ok: false; status?: number; error: string; body?: AckBody };

const retryDelay = (attempt: number): number => [0, 300, 900, 2000, 4000][attempt] ?? 4000;
const pause = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
const retryableStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

async function acknowledgedJson<T extends AckBody>(
  url: string,
  init: RequestInit,
  attempts = 5,
): Promise<AckResult<T>> {
  let lastError = 'Could not reach the event server.';
  let lastStatus: number | undefined;
  let lastBody: AckBody | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await pause(retryDelay(attempt));
    try {
      const res = await fetchWithTimeout(url, init);
      const body = (await res.json()) as AckBody;
      if (res.ok && body.ok) return { ok: true, status: res.status, body: body as T };
      lastStatus = res.status;
      lastBody = body;
      lastError = body.error ?? `The event server returned ${res.status}.`;
      if (!retryableStatus(res.status)) {
        return { ok: false, status: res.status, error: lastError, body };
      }
    } catch {
      lastError = 'Could not reach the event server.';
    }
  }
  return { ok: false, status: lastStatus, error: lastError, body: lastBody };
}

const operatorHeaders = (operatorKey: string): HeadersInit => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${operatorKey}`,
});

type ControlSnapshot = AckBody & {
  ok: true;
  raceNo: number;
  raceStatus: string;
  raceAttempt: number;
  planHash: string | null;
  settledWinnerLane: number | null;
  showRevision: number;
};

const readControlSnapshot = (
  code: string,
  operatorKey: string,
): Promise<AckResult<ControlSnapshot>> =>
  acknowledgedJson<ControlSnapshot>(
    liveApiUrl(`/api/live/summary?${new URLSearchParams({ code, since: '0' })}`),
    {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${operatorKey}` },
    },
    3,
  );

type ShowSnapshot = AckBody & {
  ok: true;
  show: LiveShow;
  showRevision: number;
  raceAttempt: number;
};

const readShowSnapshot = (code: string): Promise<AckResult<ShowSnapshot>> =>
  acknowledgedJson<ShowSnapshot>(
    liveApiUrl(`/api/live/state?${new URLSearchParams({ code })}`),
    { cache: 'no-store' },
    3,
  );

export function usePhonePlay(show: LiveShow | null) {
  const event = useEvent();
  const session = event.phonePlay ?? null;
  const [summary, setSummary] = useState<RoomSummary>(EMPTY);
  const [online, setOnline] = useState(true);
  const [controlReady, setControlReady] = useState(false);
  const [controlError, setControlError] = useState('');
  const [reactionBurst, setReactionBurst] = useState<Record<string, number>>({});
  const lastPushRef = useRef('');
  const lastQueuedRef = useRef('');
  const pendingPushRef = useRef<{ payload: string; commandId: string } | null>(null);
  const pushConflictRef = useRef<{ payload: string; count: number }>({ payload: '', count: 0 });
  const pushRetryTimerRef = useRef<number | null>(null);
  const [pushRetry, setPushRetry] = useState(0);
  const showRevisionRef = useRef<number | null>(null);
  const raceAttemptRef = useRef(1);
  const sessionCodeRef = useRef<string | null>(null);
  const statePushChainRef = useRef<Promise<void>>(Promise.resolve());
  const summaryPollInFlightRef = useRef(false);
  /* 0 would replay the whole reaction ring on first poll; seeded lazily. */
  const reactionsSinceRef = useRef(0);

  const start = useCallback(
    async (pin?: string): Promise<string | null> => {
      if (!HAS_LIVE_API || !show) return 'Phone Play needs the live event service.';
      setControlError('');
      try {
        const res = await fetchWithTimeout(liveApiUrl('/api/live/session'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ show, ...(pin ? { pin } : {}) }),
        });
        const body = (await res.json()) as {
          ok: boolean;
          code?: string;
          operatorKey?: string;
          showRevision?: number;
          raceAttempt?: number;
          error?: string;
        };
        if (!res.ok || !body.ok || !body.code || !body.operatorKey) {
          return body.error ?? 'The event server refused to open a session.';
        }
        showRevisionRef.current = Number.isSafeInteger(body.showRevision) ? body.showRevision! : 1;
        raceAttemptRef.current = Number.isSafeInteger(body.raceAttempt) ? body.raceAttempt! : 1;
        setState({ phonePlay: { code: body.code, operatorKey: body.operatorKey, ...(pin ? { pin } : {}) } });
        addAudit({
          kind: 'note',
          raceNo: 0,
          detail: `Phone Play session ${body.code} opened${pin ? ' with a PIN' : ''}. Fun chips only; phones are never authoritative.`,
        });
        return null;
      } catch {
        return 'Could not reach the event server.';
      }
    },
    [show],
  );

  useEffect(() => {
    const code = session?.code ?? null;
    if (sessionCodeRef.current === code) return;
    sessionCodeRef.current = code;
    lastPushRef.current = '';
    lastQueuedRef.current = '';
    pendingPushRef.current = null;
    pushConflictRef.current = { payload: '', count: 0 };
    if (pushRetryTimerRef.current !== null) {
      window.clearTimeout(pushRetryTimerRef.current);
      pushRetryTimerRef.current = null;
    }
    reactionsSinceRef.current = 0;
    summaryPollInFlightRef.current = false;
    setControlReady(false);
    setControlError('');
    if (!code) {
      showRevisionRef.current = null;
      raceAttemptRef.current = 1;
    }
  }, [session?.code]);

  /* A restored operator capability must first hydrate the server's current
     revision. Until that authenticated read succeeds, no stage write is
     allowed to omit or guess the compare-and-swap revision. */
  useEffect(() => {
    if (!HAS_LIVE_API || !session) return;
    let cancelled = false;
    let retryTimer: number | null = null;

    const hydrateControl = async () => {
      const snapshot = await readControlSnapshot(session.code, session.operatorKey);
      if (cancelled || sessionCodeRef.current !== session.code) return;
      if (snapshot.ok) {
        showRevisionRef.current = snapshot.body.showRevision;
        raceAttemptRef.current = snapshot.body.raceAttempt;
        setControlError('');
        setControlReady(true);
        setOnline(true);
        return;
      }

      setControlReady(false);
      setOnline(false);
      if ([400, 401, 403, 404, 410].includes(snapshot.status ?? 0)) {
        setControlError(snapshot.error);
        setState({ phonePlay: null });
        setSummary(EMPTY);
        return;
      }
      setControlError('Restoring the Phone Play room - no stage changes are being sent yet.');
      retryTimer = window.setTimeout(() => void hydrateControl(), 4000);
    };

    void hydrateControl();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [session]);

  const end = useCallback(async (): Promise<boolean> => {
    if (session && HAS_LIVE_API) {
      await statePushChainRef.current;
      const commandId = `end:${session.code}`;
      const result = await acknowledgedJson<{ ok: true; endedAt: number }>(
        liveApiUrl('/api/live/end'),
        {
          method: 'POST',
          headers: operatorHeaders(session.operatorKey),
          body: JSON.stringify({ code: session.code, commandId }),
        },
      );
      if (!result.ok) {
        const confirmation = await readControlSnapshot(session.code, session.operatorKey);
        if (confirmation.ok || confirmation.status !== 410) {
          setOnline(false);
          return false;
        }
      }
      addAudit({
        kind: 'note',
        raceNo: 0,
        detail: `Phone Play session ${session.code} closed by the operator after the server acknowledged the end command.`,
      });
    }
    setState({ phonePlay: null });
    setSummary(EMPTY);
    setControlReady(false);
    setControlError('');
    return true;
  }, [session]);

  /* Push the authoritative snapshot whenever it materially changes. */
  useEffect(() => {
    if (
      !HAS_LIVE_API ||
      !session ||
      !show ||
      !controlReady ||
      showRevisionRef.current === null
    ) {
      return;
    }
    const payload = JSON.stringify(show);
    if (payload === lastPushRef.current || payload === lastQueuedRef.current) return;
    lastQueuedRef.current = payload;
    const pending =
      pendingPushRef.current?.payload === payload
        ? pendingPushRef.current
        : { payload, commandId: newId('push') };
    pendingPushRef.current = pending;
    if (pushConflictRef.current.payload !== payload) {
      pushConflictRef.current = { payload, count: 0 };
    }
    const commandId = pending.commandId;
    const code = session.code;
    const operatorKey = session.operatorKey;

    statePushChainRef.current = statePushChainRef.current.then(async () => {
      if (sessionCodeRef.current !== code) return;
      const result = await acknowledgedJson<{
        ok: true;
        revision: number;
        showRevision: number;
        raceStatus: string;
        raceAttempt: number;
      }>(liveApiUrl('/api/live/state'), {
        method: 'POST',
        headers: operatorHeaders(operatorKey),
        body: JSON.stringify({
          code,
          show,
          commandId,
          expectedShowRevision: showRevisionRef.current,
        }),
      });
      if (sessionCodeRef.current !== code) return;
      if (!result.ok) {
        setOnline(false);
        setControlError(result.error);
        if ([400, 401, 403, 404, 410, 422].includes(result.status ?? 0)) {
          if ([401, 403, 404, 410].includes(result.status ?? 0)) {
            setState({ phonePlay: null });
            setSummary(EMPTY);
            setControlReady(false);
          }
          if (lastQueuedRef.current === payload) lastQueuedRef.current = '';
          return;
        }
        const confirmation = await readShowSnapshot(code);
        if (sessionCodeRef.current !== code) return;
        if (confirmation.ok) {
          showRevisionRef.current = confirmation.body.showRevision;
          raceAttemptRef.current = confirmation.body.raceAttempt;
          if (JSON.stringify(confirmation.body.show) === payload) {
            lastPushRef.current = payload;
            if (lastQueuedRef.current === payload) lastQueuedRef.current = '';
            if (pendingPushRef.current?.payload === payload) pendingPushRef.current = null;
            setOnline(true);
            setControlError('');
            return;
          }
          /* The server is reachable but at a different revision. The next
             push is a reconciled command with a new expected revision, so it
             needs a new idempotency identity rather than reusing different
             request data under the old command ID. */
          if (pendingPushRef.current?.payload === payload) pendingPushRef.current = null;
        }
        if (result.status === 409) {
          pushConflictRef.current.count += 1;
          if (pushConflictRef.current.count >= 3) {
            if (lastQueuedRef.current === payload) lastQueuedRef.current = '';
            setControlError(
              'The stage and Phone Play room disagree after three safe refreshes. Close the room or restore the matching event backup before continuing.',
            );
            return;
          }
        }
        if (lastQueuedRef.current === payload) {
          lastQueuedRef.current = '';
          if (pushRetryTimerRef.current !== null) {
            window.clearTimeout(pushRetryTimerRef.current);
          }
          pushRetryTimerRef.current = window.setTimeout(() => {
            pushRetryTimerRef.current = null;
            if (sessionCodeRef.current === code) setPushRetry((value) => value + 1);
          }, 1200);
        }
        return;
      }
      if (Number.isSafeInteger(result.body.showRevision)) {
        showRevisionRef.current = result.body.showRevision;
      }
      if (Number.isSafeInteger(result.body.raceAttempt)) {
        raceAttemptRef.current = result.body.raceAttempt;
      }
      lastPushRef.current = payload;
      if (pendingPushRef.current?.payload === payload) pendingPushRef.current = null;
      if (lastQueuedRef.current === payload) lastQueuedRef.current = '';
      pushConflictRef.current = { payload: '', count: 0 };
      setOnline(true);
      setControlError('');
    });
  }, [session, show, pushRetry, controlReady]);

  useEffect(
    () => () => {
      if (pushRetryTimerRef.current !== null) {
        window.clearTimeout(pushRetryTimerRef.current);
      }
    },
    [],
  );

  /* Poll the room for the projector: pick totals, reactions, leaderboard. */
  useEffect(() => {
    if (!HAS_LIVE_API || !session || !controlReady) return;
    let cancel = false;
    if (reactionsSinceRef.current === 0) reactionsSinceRef.current = Date.now();
    const tick = async () => {
      if (summaryPollInFlightRef.current) return;
      summaryPollInFlightRef.current = true;
      try {
        const query = new URLSearchParams({
          code: session.code,
          since: String(reactionsSinceRef.current),
        });
        const res = await fetchWithTimeout(liveApiUrl(`/api/live/summary?${query}`), {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${session.operatorKey}` },
        });
        const body = (await res.json()) as
          | (RoomSummary & { ok: true; at: number; showRevision: number; raceAttempt: number })
          | { ok: false };
        if (cancel) return;
        if (!res.ok || !body.ok) {
          setOnline(false);
          setControlError('The Phone Play room could not be refreshed.');
          return;
        }
        setOnline(true);
        setControlError('');
        if (Number.isSafeInteger(body.showRevision)) showRevisionRef.current = body.showRevision;
        if (Number.isSafeInteger(body.raceAttempt)) raceAttemptRef.current = body.raceAttempt;
        reactionsSinceRef.current = body.at;
        setSummary({
          players: body.players,
          perLane: body.perLane,
          reactions: body.reactions,
          leaderboard: body.leaderboard,
        });
        if (Object.keys(body.reactions).length) setReactionBurst(body.reactions);
      } catch {
        if (!cancel) setOnline(false);
      } finally {
        summaryPollInFlightRef.current = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 4000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [session, controlReady]);

  /** A race cannot start until the server has durably acknowledged this lock. */
  const lockRace = useCallback(
    async (raceNo: number, lockedShow: LiveShow, planHash: string): Promise<boolean> => {
      if (
        !HAS_LIVE_API ||
        !session ||
        !controlReady ||
        showRevisionRef.current === null ||
        !Number.isSafeInteger(raceNo) ||
        raceNo !== lockedShow.raceNo ||
        lockedShow.marketOpen ||
        !/^[A-Fa-f0-9]{64}$/.test(planHash)
      ) {
        return false;
      }

      await statePushChainRef.current;
      if (sessionCodeRef.current !== session.code) return false;
      const attempt = raceAttemptRef.current;
      const normalPlanHash = planHash.toLowerCase();
      const lockCommandId = `lock:${session.code}:${raceNo}:${attempt}:${normalPlanHash}`;
      const locked = await acknowledgedJson<{
        ok: true;
        raceNo: number;
        revision: number;
        showRevision: number;
        raceStatus: 'LOCKED';
        raceAttempt: number;
        planHash: string;
      }>(
        liveApiUrl('/api/live/lock'),
        {
          method: 'POST',
          headers: operatorHeaders(session.operatorKey),
          body: JSON.stringify({
            code: session.code,
            raceNo,
            show: lockedShow,
            planHash: normalPlanHash,
            commandId: lockCommandId,
            expectedShowRevision: showRevisionRef.current,
          }),
        },
        6,
      );
      const lockConfirmation = locked.ok
        ? null
        : await readControlSnapshot(session.code, session.operatorKey);
      const lockState = locked.ok
        ? locked.body
        : lockConfirmation?.ok
          ? lockConfirmation.body
          : null;
      if (
        !lockState ||
        lockState.raceNo !== raceNo ||
        (lockState.raceStatus !== 'LOCKED' && lockState.raceStatus !== 'RUNNING') ||
        lockState.planHash !== normalPlanHash
      ) {
        setOnline(false);
        return false;
      }
      showRevisionRef.current = lockState.showRevision;
      raceAttemptRef.current = lockState.raceAttempt;
      lastPushRef.current = JSON.stringify(lockedShow);
      if (lockState.raceStatus === 'RUNNING') {
        setOnline(true);
        return true;
      }

      const running = await acknowledgedJson<{
        ok: true;
        raceNo: number;
        revision: number;
        showRevision: number;
        raceStatus: 'RUNNING';
        raceAttempt: number;
        planHash: string;
      }>(
        liveApiUrl('/api/live/run'),
        {
          method: 'POST',
          headers: operatorHeaders(session.operatorKey),
          body: JSON.stringify({
            code: session.code,
            raceNo,
            planHash: normalPlanHash,
            commandId: `run:${session.code}:${raceNo}:${attempt}`,
            expectedShowRevision: showRevisionRef.current,
          }),
        },
        6,
      );
      const runConfirmation = running.ok
        ? null
        : await readControlSnapshot(session.code, session.operatorKey);
      const runState = running.ok
        ? running.body
        : runConfirmation?.ok
          ? runConfirmation.body
          : null;
      if (
        !runState ||
        runState.raceNo !== raceNo ||
        runState.raceStatus !== 'RUNNING' ||
        runState.planHash !== normalPlanHash
      ) {
        setOnline(false);
        return false;
      }
      showRevisionRef.current = runState.showRevision;
      raceAttemptRef.current = runState.raceAttempt;
      setOnline(true);
      return true;
    },
    [session, controlReady],
  );

  /** Persist a void and refund every held pick before the local UI reopens. */
  const voidRace = useCallback(
    async (raceNo: number, planHash: string, reason: string): Promise<boolean> => {
      if (
        !HAS_LIVE_API ||
        !session ||
        !controlReady ||
        showRevisionRef.current === null ||
        !Number.isSafeInteger(raceNo) ||
        !/^[A-Fa-f0-9]{64}$/.test(planHash) ||
        !reason.trim()
      ) {
        return false;
      }
      await statePushChainRef.current;
      const attempt = raceAttemptRef.current;
      const result = await acknowledgedJson<{
        ok: true;
        revision: number;
        showRevision: number;
        raceStatus: 'VOID';
        raceAttempt: number;
      }>(
        liveApiUrl('/api/live/void'),
        {
          method: 'POST',
          headers: operatorHeaders(session.operatorKey),
          body: JSON.stringify({
            code: session.code,
            raceNo,
            planHash: planHash.toLowerCase(),
            reason: reason.trim().slice(0, 120),
            commandId: `void:${session.code}:${raceNo}:${attempt}`,
            expectedShowRevision: showRevisionRef.current,
          }),
        },
        6,
      );
      if (!result.ok) {
        const confirmation = await readControlSnapshot(session.code, session.operatorKey);
        if (
          !confirmation.ok ||
          confirmation.body.raceNo !== raceNo ||
          confirmation.body.raceStatus !== 'VOID' ||
          confirmation.body.planHash !== planHash.toLowerCase()
        ) {
          setOnline(false);
          return false;
        }
        showRevisionRef.current = confirmation.body.showRevision;
        raceAttemptRef.current = confirmation.body.raceAttempt;
      } else {
        if (result.body.raceStatus !== 'VOID') {
          setOnline(false);
          return false;
        }
        showRevisionRef.current = result.body.showRevision;
        raceAttemptRef.current = result.body.raceAttempt;
      }
      setOnline(true);
      return true;
    },
    [session, controlReady],
  );

  /** Reopen a persisted void as the next attempt of the same race number. */
  const rearmRace = useCallback(
    async (raceNo: number, openShow: LiveShow): Promise<boolean> => {
      if (
        !HAS_LIVE_API ||
        !session ||
        !controlReady ||
        showRevisionRef.current === null ||
        !Number.isSafeInteger(raceNo) ||
        openShow.raceNo !== raceNo ||
        !openShow.marketOpen ||
        openShow.result?.raceNo === raceNo
      ) {
        return false;
      }
      await statePushChainRef.current;
      const attempt = raceAttemptRef.current;
      const result = await acknowledgedJson<{
        ok: true;
        revision: number;
        showRevision: number;
        raceStatus: 'OPEN';
        raceAttempt: number;
      }>(
        liveApiUrl('/api/live/rearm'),
        {
          method: 'POST',
          headers: operatorHeaders(session.operatorKey),
          body: JSON.stringify({
            code: session.code,
            raceNo,
            show: openShow,
            commandId: `rearm:${session.code}:${raceNo}:${attempt}`,
            expectedShowRevision: showRevisionRef.current,
          }),
        },
        6,
      );
      if (!result.ok) {
        const confirmation = await readControlSnapshot(session.code, session.operatorKey);
        if (
          !confirmation.ok ||
          confirmation.body.raceNo !== raceNo ||
          confirmation.body.raceStatus !== 'OPEN' ||
          confirmation.body.raceAttempt <= attempt
        ) {
          setOnline(false);
          return false;
        }
        showRevisionRef.current = confirmation.body.showRevision;
        raceAttemptRef.current = confirmation.body.raceAttempt;
      } else {
        if (result.body.raceStatus !== 'OPEN') {
          setOnline(false);
          return false;
        }
        showRevisionRef.current = result.body.showRevision;
        raceAttemptRef.current = result.body.raceAttempt;
      }
      lastPushRef.current = JSON.stringify(openShow);
      setOnline(true);
      return true;
    },
    [session, controlReady],
  );

  /** Settle the room's picks for a finished race. Server-side exactly-once. */
  const settle = useCallback(
    async (raceNo: number, results: RaceResult[]): Promise<void> => {
      const winner = results.find((r) => r.place === 1);
      if (
        !HAS_LIVE_API ||
        !session ||
        !controlReady ||
        showRevisionRef.current === null ||
        !winner
      ) {
        return;
      }
      await statePushChainRef.current;
      const commandId = `settle:${session.code}:${raceNo}:${raceAttemptRef.current}`;
      const result = await acknowledgedJson<{ ok: true; revision?: number }>(
        liveApiUrl('/api/live/settle'),
        {
          method: 'POST',
          headers: operatorHeaders(session.operatorKey),
          body: JSON.stringify({
            code: session.code,
            raceNo,
            winnerLane: winner.lane,
            commandId,
          }),
        },
        6,
      );
      if (!result.ok) {
        const confirmation = await readControlSnapshot(session.code, session.operatorKey);
        if (
          !confirmation.ok ||
          confirmation.body.raceNo !== raceNo ||
          confirmation.body.raceStatus !== 'SETTLED' ||
          confirmation.body.settledWinnerLane !== winner.lane
        ) {
          setOnline(false);
          return;
        }
      }
      setOnline(true);
    },
    [session, controlReady],
  );

  return {
    session,
    summary,
    online,
    controlReady,
    controlError,
    reactionBurst,
    start,
    end,
    lockRace,
    voidRace,
    rearmRace,
    settle,
  };
}
