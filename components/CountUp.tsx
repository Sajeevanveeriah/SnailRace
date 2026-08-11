'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Rolls a number up to its new value instead of swapping it.
 *
 * The total on the stage is the one figure the room watches all night, and a
 * silent jump from $340 to $365 reads as a rendering glitch rather than as
 * someone's donation landing. The roll makes the money visible as it arrives.
 */
export function CountUp({
  value,
  format,
  className = '',
  durationMs = 850,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
  durationMs?: number;
}) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(0);
  const nodeRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /*
     * A zero-length roll lands on the final value on the very first frame, so
     * the reduced-motion path needs no separate branch - and crucially no
     * synchronous setState inside the effect body.
     */
    const span = reduce ? 0 : durationMs;
    const started = performance.now();

    const tick = (now: number) => {
      const t = span <= 0 ? 1 : Math.min(1, (now - started) / span);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };

    rafRef.current = requestAnimationFrame(tick);

    if (value > from && nodeRef.current) {
      const node = nodeRef.current;
      node.classList.remove('money-tick');
      void node.offsetWidth;
      node.classList.add('money-tick');
    }

    return () => cancelAnimationFrame(rafRef.current);
  }, [value, durationMs]);

  return (
    <span ref={nodeRef} className={`num inline-block ${className}`}>
      {format(shown)}
    </span>
  );
}
