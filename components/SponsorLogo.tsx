import { CLUB_LOGO } from './brand/ClubBrand';

/**
 * A race sponsor's mark. Sponsors bought on the night rarely send artwork,
 * so the mark is made from the name: a shield in a colour of its own (the
 * same name always gets the same colour), the initials, and the name set
 * under it. A sponsor that is one of the club's own teams ("NDCC Womens")
 * wears the club crest; a Dinos team gets the dino.
 */

const SHIELDS: ReadonlyArray<{ fill: string; edge: string; ink: string }> = [
  { fill: '#0f1e33', edge: '#f5b700', ink: '#f5b700' },
  { fill: '#7a1424', edge: '#f2c14e', ink: '#fff6d8' },
  { fill: '#1d4f91', edge: '#ffffff', ink: '#ffffff' },
  { fill: '#1f6b45', edge: '#f2c14e', ink: '#fff6d8' },
  { fill: '#4b2a7a', edge: '#ffd166', ink: '#ffffff' },
  { fill: '#2f3a44', edge: '#b9c4cc', ink: '#ffffff' },
];

const hashOf = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Up to two letters: the first of the first and last words that start with a letter. */
export function sponsorInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s&'-]/gu, ' ').split(/\s+/).filter((w) => /\p{L}|\p{N}/u.test(w) && !/^(the|and|&|of)$/i.test(w));
  if (!words.length) return '?';
  const first = [...words[0]][0] ?? '';
  const last = words.length > 1 ? [...words[words.length - 1]][0] ?? '' : '';
  return (first + last).toUpperCase();
}

export const sponsorShield = (name: string) => SHIELDS[hashOf(name.trim().toLowerCase()) % SHIELDS.length];

export const isClubTeam = (name: string): boolean => /^\s*ndcc\b/i.test(name);
const isDinos = (name: string): boolean => /\bdinos?\b/i.test(name);

/** The badge alone, as SVG content in a 100 x 116 box. Used inline on the track's boards. */
export function SponsorBadge({ name }: { name: string }) {
  const look = sponsorShield(name);
  const initials = sponsorInitials(name);
  if (isClubTeam(name)) {
    return <image href={CLUB_LOGO.src} x="0" y="8" width="100" height="100" preserveAspectRatio="xMidYMid meet" />;
  }
  return (
    <g>
      <path d="M50 2 L96 16 V56 C96 84 76 104 50 114 C24 104 4 84 4 56 V16 Z" fill={look.fill} stroke={look.edge} strokeWidth="5" />
      <path d="M50 12 L86 23 V56 C86 78 70 94 50 103 C30 94 14 78 14 56 V23 Z" fill="none" stroke={look.edge} strokeWidth="1.5" opacity=".6" />
      {isDinos(name) ? (
        <g transform="translate(50 64)" fill={look.ink}>
          {/* A friendly stegosaurus, the club's own mascot shape. */}
          <path d="M-30 10 C-30 -6 -16 -16 2 -16 C16 -16 24 -10 28 -2 L36 -6 C40 -8 42 -4 38 -1 L30 6 C30 12 26 16 20 16 L18 24 H12 L12 16 H-8 L-8 24 H-14 L-14 16 C-24 16 -30 14 -30 10 Z" />
          <path d="M-20 -12 L-16 -24 L-10 -14 L-6 -28 L0 -16 L6 -26 L10 -15 L16 -20 L18 -12 Z" opacity=".85" />
          <circle cx="26" cy="-3" r="1.8" fill={look.fill} />
        </g>
      ) : (
        <text x="50" y="72" textAnchor="middle" fontSize={initials.length > 1 ? 40 : 52} fontWeight="900" fontFamily="Inter, Arial, sans-serif" fill={look.ink} letterSpacing="1">
          {initials}
        </text>
      )}
    </g>
  );
}

/** The full lock-up for the racecard and the result: badge and name side by side. */
export function SponsorLogo({ name, title, className = '', label = 'Sponsored by' }: { name: string; title?: string; className?: string; label?: string }) {
  if (!name.trim()) return null;
  return (
    <figure className={`sponsor-logo ${className}`} aria-label={`${label} ${name}${title ? `, ${title}` : ''}`}>
      <svg className="sponsor-logo-badge" viewBox="0 0 100 116" aria-hidden="true">
        <SponsorBadge name={name} />
      </svg>
      <figcaption>
        <span className="sponsor-logo-kicker">{label}</span>
        <strong className="sponsor-logo-name">{name}</strong>
        {title ? <span className="sponsor-logo-title">{title}</span> : null}
      </figcaption>
    </figure>
  );
}
