'use client';

import { presentationForMoment } from './surprise-presentation';
import type { RaceController, RaceMoment } from '@/lib/use-race';

const ART_BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/art`;

const PHASES = ['warning', 'reveal', 'effect'] as const;

function consequenceText(deltaMs: number | undefined, consequence: RaceMoment['consequence']): string {
  if (consequence === 'retire') return 'RETIRED SAFELY';
  if (!deltaMs) return consequence === 'advance' ? 'BOOST ACTIVE' : consequence === 'delay' ? 'DELAY ACTIVE' : 'IMPACT ACTIVE';
  const seconds = Math.abs(deltaMs / 1000).toFixed(1);
  return consequence === 'advance' ? `${seconds}s ADVANTAGE` : `${seconds}s DELAY`;
}

export function SurpriseLayer({ race, names }: { race: RaceController; names: string[] }) {
  const phase = race.phase as string;
  const moment = phase === 'running' ? race.moment : null;
  const presentation = presentationForMoment(moment);
  if (!moment || !presentation) return null;

  const surprisePhase = moment.phase ?? 'effect';
  const activeIndex = PHASES.indexOf(surprisePhase);
  const affected = (moment.targetLanes ?? [])
    .map((lane) => names[lane] ?? `Lane ${lane + 1}`)
    .join(', ');
  const eventLabel = moment.label ?? moment.text;
  const consequence = consequenceText(moment.deltaMs, moment.consequence);

  return (
    <div
      key={moment.id}
      className={`race-surprise race-surprise-${presentation.cue} surprise-phase-${surprisePhase} ${moment.big ? 'race-surprise-field' : ''}`}
      role="status"
      aria-live="assertive"
      aria-atomic="true"
      aria-label={`${surprisePhase}: ${eventLabel}${affected ? `. Affected: ${affected}` : ''}. ${consequence}`}
    >
      {presentation.art ? (
        <span
          className={`tv-surprise-art tv-surprise-${presentation.art}`}
          style={{ backgroundImage: `url(${ART_BASE}/surprises/${presentation.art}.png)` }}
          aria-hidden="true"
        />
      ) : (
        <span className="tv-surprise-symbol" aria-hidden="true">{presentation.symbol}</span>
      )}

      <section className="surprise-signal" aria-hidden="true">
        <header>
          <span>{moment.big ? 'FIELD EVENT' : 'SURPRISE EVENT'}</span>
          <strong>{eventLabel}</strong>
        </header>
        <ol>
          {PHASES.map((item, index) => (
            <li key={item} className={index === activeIndex ? 'active' : index < activeIndex ? 'complete' : ''}>
              <i>{index + 1}</i>
              <span>{item}</span>
            </li>
          ))}
        </ol>
        <p>{moment.text}</p>
      </section>

      <aside className="surprise-ledger" aria-hidden="true">
        <span className="surprise-ledger-icon">{presentation.symbol}</span>
        <dl>
          <div><dt>EVENT</dt><dd>{eventLabel}</dd></div>
          <div><dt>AFFECTED</dt><dd>{affected || (moment.big ? 'THE FIELD' : 'COURSE')}</dd></div>
          <div><dt>CONSEQUENCE</dt><dd>{consequence}</dd></div>
        </dl>
      </aside>
    </div>
  );
}
