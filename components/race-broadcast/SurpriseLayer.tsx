'use client';

import { twistKicker, type StagedTwist } from './twist-staging';

/**
 * The twist card for the circuits: the same card the side-on straight puts
 * up (`.side-splash`, kicker and title), top centre over the course. An
 * INCOMING warning, then the hit (TWIST, BOOST or OUT), then clear. The
 * camera keeps the leaders and the line below the band this card sits in.
 */
export function TwistCard({ twist }: { twist: StagedTwist | null }) {
  if (!twist) return null;
  return (
    <div
      key={twist.key}
      className={`side-splash side-splash-${twist.phase} tone-${twist.tone}`}
      data-twist={twist.eventId}
      role="status"
      aria-live="assertive"
      aria-atomic="true"
    >
      <span className="side-splash-kicker">{twistKicker(twist)}</span>
      <strong className="side-splash-title">{twist.label}</strong>
    </div>
  );
}
