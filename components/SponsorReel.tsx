'use client';

import { useEffect, useState } from 'react';
import { sponsorsFromRace } from '@/lib/club-sponsors';

/**
 * The club sponsors, one at a time, like the advert break after a race on
 * television. Every logo is in the page from the start (so it has loaded
 * long before its turn) and the reel cross-fades between them: no blank
 * frame between logos, no strip of dots. Under reduced motion the logos
 * still change, they just do not fade.
 */
export function SponsorReel({ raceNo, seconds = 3.5, running = true }: { raceNo: number; seconds?: number; running?: boolean }) {
  const sponsors = sponsorsFromRace(raceNo);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!running || !sponsors.length) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % sponsors.length), seconds * 1000);
    return () => window.clearInterval(t);
  }, [raceNo, seconds, sponsors.length, running]);
  /* A club with no sponsor logos has no reel. */
  if (!sponsors.length) return null;
  return (
    <aside className="sponsor-slate" aria-label="Our club sponsors">
      <p className="sponsor-slate-kicker">Proudly supported by</p>
      <div className="sponsor-slate-stage" aria-live="off">
        {sponsors.map((s, i) => (
          <figure key={s.src} className={`sponsor-slate-slide ${i === index % sponsors.length ? 'on' : ''}`} aria-hidden={i !== index % sponsors.length}>
            <span className="sponsor-slate-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.src} alt={s.name} decoding="async" loading="eager" />
            </span>
            <figcaption>{s.name}</figcaption>
          </figure>
        ))}
      </div>
    </aside>
  );
}
