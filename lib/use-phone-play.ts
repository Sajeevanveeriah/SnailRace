'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { addAudit, setState, useEvent } from './event-store';
import { HAS_API } from './deployment';
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

export function usePhonePlay(show: LiveShow | null) {
  const event = useEvent();
  const session = event.phonePlay ?? null;
  const [summary, setSummary] = useState<RoomSummary>(EMPTY);
  const [online, setOnline] = useState(true);
  const [reactionBurst, setReactionBurst] = useState<Record<string, number>>({});
  const lastPushRef = useRef('');
  /* 0 would replay the whole reaction ring on first poll; seeded lazily. */
  const reactionsSinceRef = useRef(0);

  const start = useCallback(
    async (pin?: string): Promise<string | null> => {
      if (!HAS_API || !show) return 'Phone Play needs the server build.';
      try {
        const res = await fetch('/api/live/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ show, ...(pin ? { pin } : {}) }),
        });
        const body = (await res.json()) as {
          ok: boolean;
          code?: string;
          operatorKey?: string;
          error?: string;
        };
        if (!body.ok || !body.code || !body.operatorKey) {
          return body.error ?? 'The event server refused to open a session.';
        }
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

  const end = useCallback(() => {
    if (session) {
      /* Close the room on the server too, so phones are told the event has
         ended instead of polling an abandoned session. Best-effort: the
         session also dies on its own at the server's TTL. */
      void fetch('/api/live/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: session.code, operatorKey: session.operatorKey }),
      }).catch(() => undefined);
      addAudit({ kind: 'note', raceNo: 0, detail: `Phone Play session ${session.code} closed by the operator; the server room was ended with it.` });
    }
    setState({ phonePlay: null });
    setSummary(EMPTY);
  }, [session]);

  /* Push the authoritative snapshot whenever it materially changes. */
  useEffect(() => {
    if (!HAS_API || !session || !show) return;
    const payload = JSON.stringify(show);
    if (payload === lastPushRef.current) return;
    const timer = window.setTimeout(() => {
      lastPushRef.current = payload;
      void fetch('/api/live/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: session.code, operatorKey: session.operatorKey, show }),
      }).catch(() => setOnline(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [session, show]);

  /* Poll the room for the projector: pick totals, reactions, leaderboard. */
  useEffect(() => {
    if (!HAS_API || !session) return;
    let cancel = false;
    if (reactionsSinceRef.current === 0) reactionsSinceRef.current = Date.now();
    const tick = async () => {
      try {
        const query = new URLSearchParams({
          code: session.code,
          operatorKey: session.operatorKey,
          since: String(reactionsSinceRef.current),
        });
        const res = await fetch(`/api/live/summary?${query}`, { cache: 'no-store' });
        const body = (await res.json()) as (RoomSummary & { ok: boolean; at: number }) | { ok: false };
        if (cancel) return;
        if (!body.ok) {
          setOnline(false);
          return;
        }
        setOnline(true);
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
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 4000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [session]);

  /** Settle the room's picks for a finished race. Server-side exactly-once. */
  const settle = useCallback(
    async (raceNo: number, results: RaceResult[]) => {
      const winner = results.find((r) => r.place === 1);
      if (!HAS_API || !session || !winner) return;
      try {
        await fetch('/api/live/settle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: session.code,
            operatorKey: session.operatorKey,
            raceNo,
            winnerLane: winner.lane,
          }),
        });
      } catch {
        /* The next successful settle call is idempotent server-side. */
      }
    },
    [session],
  );

  return { session, summary, online, reactionBurst, start, end, settle };
}
