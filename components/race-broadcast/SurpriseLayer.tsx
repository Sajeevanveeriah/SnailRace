'use client';

import { presentationForMoment } from './surprise-presentation';
import type { RaceController } from '@/lib/use-race';

const ART_BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/art`;

/** Visual duplicate of the commentary status rail, kept out of the a11y tree. */
export function SurpriseLayer({ race }: { race: RaceController }) {
  const phase = race.phase as string;
  const moment = phase === 'running' ? race.moment : null;
  const presentation = presentationForMoment(moment);
  if (!moment || !presentation) return null;

  return (
    <div
      key={moment.id}
      className={`race-surprise race-surprise-${presentation.cue} ${moment.big ? 'race-surprise-field' : ''}`}
      aria-hidden="true"
    >
      {presentation.art ? (
        <span
          className={`tv-surprise-art tv-surprise-${presentation.art}`}
          style={{ backgroundImage: `url(${ART_BASE}/surprises/${presentation.art}.png)` }}
        />
      ) : null}
      <p className={`tv-flash moment-${moment.tone} ${moment.big ? 'tv-flash-big' : ''}`}>
        {moment.big ? <b>FIELD EVENT</b> : null}
        {moment.text}
      </p>
    </div>
  );
}
