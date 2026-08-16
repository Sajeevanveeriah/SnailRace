'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HAS_API } from './deployment';
import type { Donation, DonationsResponse } from './types';

export type FeedStatus = 'loading' | 'live' | 'offline' | 'unconfigured';

/**
 * Polls Stripe for this event's card donations.
 *
 * Polling rather than streaming is a deliberate choice: a serverless
 * deployment has nowhere to hold a socket, and a club night needs the board
 * correct within a few seconds, not within a few milliseconds.
 *
 * The important behaviour is what happens when the poll fails. The last good
 * snapshot is kept and the status drops to `offline`, so a flaky venue
 * connection makes the board go stale and say so, rather than blanking the
 * running total in front of the room.
 */
export function useDonations(eventId: string, intervalMs = 4000) {
  const [donations, setDonations] = useState<Donation[]>([]);
  const [status, setStatus] = useState<FeedStatus>('loading');
  const [lastOk, setLastOk] = useState(0);
  const [arrival, setArrival] = useState<Donation | null>(null);

  const seenRef = useRef<Set<string>>(new Set());
  /*
   * The very first successful read is a catch-up, not news. Without this a
   * screen opened halfway through the night would fire a toast and a coin
   * sound for every donation already taken.
   */
  const primedRef = useRef(false);

  const poll = useCallback(async () => {
    if (!eventId) return;
    /*
     * A static export has no API. Saying so once beats asking a host that
     * cannot answer, every four seconds, for the length of a club night.
     */
    if (!HAS_API) {
      setStatus('unconfigured');
      return;
    }
    try {
      const res = await fetch(`/api/donations?eventId=${encodeURIComponent(eventId)}`, {
        cache: 'no-store',
      });

      /*
       * 404 means there is no API at all - a static host such as GitHub
       * Pages. That is cash-only mode, not an outage, and the stage should
       * say so rather than cry offline all night.
       */
      if (res.status === 404) {
        setStatus('unconfigured');
        return;
      }

      const body = (await res.json()) as DonationsResponse;

      if (!body.configured) {
        setStatus('unconfigured');
        return;
      }
      if (!res.ok || !body.ok) {
        setStatus('offline');
        return;
      }

      let newest: Donation | null = null;
      for (const d of body.donations) {
        if (seenRef.current.has(d.id)) continue;
        seenRef.current.add(d.id);
        if (primedRef.current && (!newest || d.createdAt > newest.createdAt)) newest = d;
      }
      primedRef.current = true;

      setDonations(body.donations);
      setStatus('live');
      setLastOk(body.at);
      if (newest) setArrival(newest);
    } catch {
      setStatus('offline');
    }
  }, [eventId]);

  useEffect(() => {
    /*
     * The first read is scheduled rather than called inline so the effect
     * body itself stays free of state updates and the interval below is the
     * only thing driving the feed.
     */
    const kickoff = window.setTimeout(() => void poll(), 0);
    /* Nothing to poll when there is no API behind the build. */
    const timer = HAS_API ? window.setInterval(() => void poll(), intervalMs) : 0;

    /* A projector laptop that has been asleep should catch up immediately. */
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll, intervalMs]);

  return { donations, status, lastOk, arrival, refresh: poll };
}
