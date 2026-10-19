'use client';

import { useEffect, useState } from 'react';
import { sponsorsFromRace } from '@/lib/club-sponsors';

/**
 * The club sponsors, one at a time, like the advert break after a race on
 * television. Every logo gets a few seconds full size; the strip of dots
 * underneath shows the reel is rolling. Under reduced motion the logos
 * still change, they just do not slide.
 */
export function SponsorReel({ raceNo, seconds = 3.5 }: { raceNo: number; seconds?: number }) {
  const sponsors = sponsorsFromRace(raceNo);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setIndex((i) => (i + 1) % sponsors.length), seconds * 1000);
    return () => window.clearInterval(t);
  }, [raceNo, seconds, sponsors.length]);
  const current = sponsors[index % sponsors.length];
  return (
    <aside className="sponsor-reel" aria-label="Our club sponsors">
      <p className="sponsor-reel-kicker">Proudly supported by</p>
      <div className="sponsor-reel-stage">
        <figure key={current.src} className="sponsor-reel-slide">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current.src} alt={current.name} />
          <figcaption>{current.name}</figcaption>
        </figure>
      </div>
      <ol className="sponsor-reel-dots" aria-hidden="true">
        {sponsors.map((s, i) => (
          <li key={s.src} className={i === index % sponsors.length ? 'on' : ''} />
        ))}
      </ol>
    </aside>
  );
}
