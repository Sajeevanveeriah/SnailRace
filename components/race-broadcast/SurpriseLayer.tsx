'use client';

import { presentationForMoment } from './surprise-presentation';
import type { RaceController } from '@/lib/use-race';

/**
 * The surprise strip: what the twist is called and nothing more. Who it hit
 * is on the course, where the prop lands on the snails' own numbers; the
 * room is not asked to read seconds or a list of names.
 */
export function SurpriseLayer({
  race,
}: {
  race: RaceController;
  names?: string[];
}) {
  const phase = race.phase as string;
  const moment = phase === 'running' ? race.moment : null;
  const presentation = presentationForMoment(moment);
  /* Only a staged surprise belongs here. A change of leader is called on
     the commentary strap; it has no prop, no consequence and no phase. */
  if (!moment || !presentation || !moment.phase) return null;

  const surprisePhase = moment.phase ?? 'effect';
  const eventLabel = moment.label ?? moment.text;
  const kicker =
    surprisePhase === 'warning'
      ? 'INCOMING'
      : surprisePhase === 'reveal'
        ? 'LOOK OUT'
        : moment.consequence === 'retire'
          ? 'OUT'
          : moment.consequence === 'advance'
            ? 'BOOST'
            : 'TWIST';

  return (
    <div
      key={moment.eventId ?? moment.id}
      className="course-event-ticker race-surprise"
      role="status"
      aria-live="assertive"
      aria-atomic="true"
      aria-label={`${kicker}: ${eventLabel}`}
    >
      <span className="course-event-phase">{kicker}</span>
      <strong>{eventLabel}</strong>
    </div>
  );
}
