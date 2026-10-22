'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  document.addEventListener('fullscreenchange', cb);
  return () => document.removeEventListener('fullscreenchange', cb);
};
const snapshot = () => Boolean(document.fullscreenElement);

export function useProjectorDisplay(active: boolean) {
  const fullscreen = useSyncExternalStore(subscribe, snapshot, () => false);
  const [error, setError] = useState('');
  const [wakeLock, setWakeLock] = useState(false);

  const toggleFullscreen = useCallback(async () => {
    setError('');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else setError('Fullscreen is unavailable in this browser. Maximise the game window instead.');
    } catch {
      setError('Click Fullscreen in the game window, or press F there. The browser needs that click on the projector.');
    }
  }, []);

  useEffect(() => {
    if (!active && !fullscreen) return;
    let disposed = false;
    let lock: WakeLockSentinel | null = null;
    let requesting = false;
    const acquire = async () => {
      if (disposed || requesting || (lock && !lock.released) || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
      requesting = true;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (disposed) { await next.release(); return; }
        lock = next;
        setWakeLock(true);
        next.addEventListener('release', () => { if (!disposed) setWakeLock(false); });
      } catch { if (!disposed) setWakeLock(false); }
      finally { requesting = false; }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, [active, fullscreen]);

  return { fullscreen, toggleFullscreen, error, wakeLock: (active || fullscreen) && wakeLock };
}

/* ── One tab holds the show ─────────────────────────────────────────────── */

/**
 * The show lease: which tab of this browser is running the night.
 *
 * The night's state is shared through localStorage, so every tab that opens
 * the site sees the same screens. Only one of them may run the race engine,
 * settle results and carry the operator's controls, or a second tab left
 * open on the laptop could start a race that is already running on the
 * projector. The first tab to load takes the lease and heartbeats it; any
 * other tab is a mirror until the holder goes away. A holder releases the
 * lease as its page unloads, and a mirror waits 8 s after a release before
 * stepping in, so a reloading main screen takes the lease straight back. A
 * lease silent for 15 s belongs to a tab that is gone or frozen; a merely
 * busy main screen never loses the show.
 */
const LEASE_KEY = 'ndcc-snailrace-show-lease';
const HEARTBEAT_MS = 1000;
/** A lease older than this belongs to a tab that is gone (or frozen), not merely busy. */
const STALE_MS = 15_000;
/** A mirror waits this long after a release before it takes over, so a reloading holder gets there first. */
const TAKEOVER_GRACE_MS = 8000;

interface Lease { id: string; at: number }

const readLease = (): Lease | null => {
  try {
    const raw = localStorage.getItem(LEASE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Lease>;
    return typeof parsed.id === 'string' && typeof parsed.at === 'number' ? { id: parsed.id, at: parsed.at } : null;
  } catch {
    return null;
  }
};

export interface ShowLease {
  /** This tab runs the show. False while another tab holds the lease. */
  holder: boolean;
  /** The first check has run; until then nothing should be drawn as either. */
  settled: boolean;
}

export function useShowLease(): ShowLease {
  const [lease, setLease] = useState<ShowLease>({ holder: false, settled: false });

  useEffect(() => {
    const id = `tab-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    let holder = false;
    let takeover = 0;
    const write = () => {
      try { localStorage.setItem(LEASE_KEY, JSON.stringify({ id, at: Date.now() })); } catch { /* the show still runs in memory */ }
    };
    const become = (next: boolean) => {
      holder = next;
      setLease((prev) => (prev.holder === next && prev.settled ? prev : { holder: next, settled: true }));
    };
    const claim = () => {
      write();
      become(true);
    };
    /* Another tab holds a live lease. */
    const taken = (current: Lease | null, now: number) => Boolean(current && current.id !== id && now - current.at < STALE_MS);
    const check = () => {
      const now = Date.now();
      const current = readLease();
      if (holder) {
        /* Two tabs claiming at once: the one that reads the other's fresh heartbeat yields. */
        if (taken(current, now)) become(false);
        else write();
        return;
      }
      if (!taken(current, now)) {
        if (!takeover) claim();
      } else {
        /* Another tab holds the show: this one is a mirror, and says so at once. */
        become(false);
      }
    };
    check();
    const beat = window.setInterval(check, HEARTBEAT_MS);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LEASE_KEY) return;
      if (holder) { check(); return; }
      if (e.newValue === null) {
        /* The holder released: give a reload a moment to take the lease back. */
        window.clearTimeout(takeover);
        takeover = window.setTimeout(() => { takeover = 0; check(); }, TAKEOVER_GRACE_MS);
      }
    };
    window.addEventListener('storage', onStorage);
    const release = () => {
      if (!holder) return;
      const current = readLease();
      if (current?.id === id) {
        try { localStorage.removeItem(LEASE_KEY); } catch { /* nothing to release */ }
      }
    };
    window.addEventListener('pagehide', release);
    return () => {
      window.clearInterval(beat);
      window.clearTimeout(takeover);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', release);
      release();
    };
  }, []);

  return lease;
}
