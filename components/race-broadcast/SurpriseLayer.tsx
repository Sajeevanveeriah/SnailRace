'use client';

import { presentationForMoment } from './surprise-presentation';
import type { RaceController, RaceMoment } from '@/lib/use-race';

function consequenceText(
  deltaMs: number | undefined,
  consequence: RaceMoment['consequence'],
): string {
  if (consequence === 'retire') return 'RETIRED SAFELY';
  if (!deltaMs)
    return consequence === 'advance'
      ? 'BOOST ACTIVE'
      : consequence === 'delay'
        ? 'DELAY ACTIVE'
        : 'IMPACT ACTIVE';
  const seconds = Math.abs(deltaMs / 1000).toFixed(1);
  return consequence === 'advance'
    ? `${seconds}s ADVANTAGE`
    : `${seconds}s DELAY`;
}

export function SurpriseLayer({
  race,
  names,
}: {
  race: RaceController;
  names: string[];
}) {
  const phase = race.phase as string;
  const moment = phase === 'running' ? race.moment : null;
  const presentation = presentationForMoment(moment);
  /* Only a staged surprise belongs here. A change of leader is called on
     the commentary strap; it has no prop, no consequence and no phase. */
  if (!moment || !presentation || !moment.phase) return null;

  const surprisePhase = moment.phase ?? 'effect';
  const affected = (moment.targetLanes ?? [])
    .map((lane) => names[lane] ?? `Lane ${lane + 1}`)
    .join(', ');
  const eventLabel = moment.label ?? moment.text;
  const consequence =
    surprisePhase === 'warning'
      ? 'APPROACHING'
      : surprisePhase === 'reveal'
        ? 'IMPACT IMMINENT'
        : consequenceText(moment.deltaMs, moment.consequence);

  return (
    <div
      key={moment.eventId ?? moment.id}
      className="course-event-ticker race-surprise"
      role="status"
      aria-live="assertive"
      aria-atomic="true"
      aria-label={`${surprisePhase}: ${eventLabel}${affected ? `. Affected: ${affected}` : ''}. ${consequence}`}
    >
      <span className="course-event-phase">{consequence}</span>
      <strong>{eventLabel}</strong>
      <span className="course-event-affected">{affected || 'The field'}</span>
    </div>
  );
}
