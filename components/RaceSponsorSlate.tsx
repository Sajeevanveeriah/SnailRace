'use client';

import { CLUB_LOGO, CLUB_NAME } from './brand/ClubBrand';
import { sponsorArt } from './SponsorLogo';
import { sponsorsFromRace } from '@/lib/club-sponsors';

/**
 * The race sponsor's moment, full screen, as each race comes to the gate.
 *
 * A sponsored race names its sponsor beside the club crest: a club team
 * (Grey Dinos, NDCC Womens team) is the crest and the team's name; a club
 * sponsor shows its logo next to the crest; anyone else shows their name
 * next to the crest. A race nobody sponsored thanks one of the club's
 * sponsors instead, a different one each race.
 */
export function RaceSponsorSlate({
  raceNo,
  plannedRaces,
  raceLabel,
  snails,
  sponsor,
  leaving = false,
}: {
  raceNo: number;
  /** Races on the card; 0 for a run-off, which is not one of them. */
  plannedRaces: number;
  /** "Race 5", or the run-off's name. */
  raceLabel: string;
  /** "Snails 33 to 40". */
  snails: string;
  sponsor: { name: string; title: string; logo: string };
  leaving?: boolean;
}) {
  const sponsored = Boolean(sponsor.name.trim());
  const art = sponsored ? sponsorArt(sponsor.name, sponsor.logo) : sponsorsFromRace(raceNo)[0] ?? null;
  return (
    <div className={`rs-slate ${leaving ? 'rs-leave' : 'rs-enter'}`} role="status" aria-live="polite" aria-label={sponsored ? `${raceLabel}, sponsored by ${sponsor.name}` : `${raceLabel}, supported by ${art?.name ?? 'our club sponsors'}`}>
      <div className="rs-card">
        <p className="rs-race num">
          {raceLabel}
          {plannedRaces > 0 && raceNo <= plannedRaces ? <span className="rs-of"> of {plannedRaces}</span> : null}
          {snails ? <span className="rs-snails"> · {snails}</span> : null}
        </p>
        {sponsored && sponsor.title ? <h2 className="rs-title">{sponsor.title}</h2> : null}
        <p className="rs-kicker">{sponsored ? 'Proudly sponsored by' : 'Proudly supported by'}</p>
        <div className="rs-lockup">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="rs-crest" src={CLUB_LOGO.src} alt="" width={CLUB_LOGO.width} height={CLUB_LOGO.height} />
          {art ? (
            <span className="rs-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={art.src} alt="" />
            </span>
          ) : null}
        </div>
        <p className="rs-name">{sponsored ? sponsor.name : art?.name ?? CLUB_NAME}</p>
      </div>
    </div>
  );
}
