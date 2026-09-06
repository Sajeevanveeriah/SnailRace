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
