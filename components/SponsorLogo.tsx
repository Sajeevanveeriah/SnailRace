import { CLUB_LOGO } from './brand/ClubBrand';
import { raceSponsorArt } from '@/lib/club-sponsors';

/**
 * A race sponsor's mark, always beside the club crest.
 *
 * A sponsor that is one of the club's own teams (an NDCC team, a Dinos team)
 * is the crest and its name. A sponsor that is one of the club's sponsors
 * (or has one chosen for it in Admin) shows that sponsor's logo next to the
 * crest. Any other sponsor shows its name next to the crest: no artwork is
 * made up for a name.
 */

export const isClubTeam = (name: string): boolean => /^\s*ndcc\b/i.test(name) || /\bdinos?\b/i.test(name);

/** The sponsor logo shown beside the crest: one chosen in Admin always wins; a club team has none of its own. */
export const sponsorArt = (name: string, logo?: string) => {
  const pick = logo?.trim() ?? '';
  if (pick && pick.toLowerCase() !== 'none') return raceSponsorArt(name, pick);
  return isClubTeam(name) ? null : raceSponsorArt(name, pick);
};

/** The badge alone, as SVG content in a 100 x 116 box. Used inline on the track's boards and banner. */
export function SponsorBadge({ name, logo }: { name: string; logo?: string }) {
  const art = sponsorArt(name, logo);
  return (
    <g>
      <rect x="0" y="0" width="100" height="116" rx="12" fill="#fffaf0" />
      <image href={art?.src ?? CLUB_LOGO.src} x="6" y="8" width="88" height="100" preserveAspectRatio="xMidYMid meet" />
    </g>
  );
}

/** The full lock-up for the racecard and the result: crest, the sponsor's logo when it has one, and the name. */
export function SponsorLogo({ name, title, logo, className = '', label = 'Sponsored by' }: { name: string; title?: string; logo?: string; className?: string; label?: string }) {
  if (!name.trim()) return null;
  const art = sponsorArt(name, logo);
  return (
    <figure className={`sponsor-logo ${className}`} aria-label={`${label} ${name}${title ? `, ${title}` : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="sponsor-logo-crest" src={CLUB_LOGO.src} alt="" width={CLUB_LOGO.width} height={CLUB_LOGO.height} />
      {art ? (
        <span className="sponsor-logo-art">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={art.src} alt="" />
        </span>
      ) : null}
      <figcaption>
        <span className="sponsor-logo-kicker">{label}</span>
        <strong className="sponsor-logo-name">{name}</strong>
        {title ? <span className="sponsor-logo-title">{title}</span> : null}
      </figcaption>
    </figure>
  );
}
