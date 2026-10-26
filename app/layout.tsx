import type { Metadata, Viewport } from 'next';
import './globals.css';
import './broadcast-theatre.css';
import './moderator-desk.css';
import './show-screens.css';
import { CLUB, clubImage } from '@/lib/club';

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');
const fallbackSiteUrl = 'https://sajeevanveeriah.github.io/SnailRace';
const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? fallbackSiteUrl;
const metadataBase = (() => {
  try {
    const url = new URL(configuredSiteUrl);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : new URL(fallbackSiteUrl);
  } catch {
    return new URL(fallbackSiteUrl);
  }
})();
/* Absolute URLs for link previews. The pages export resolves under /SnailRace. */
const absolute = (src: string): string =>
  new URL(basePath ? src : `/SnailRace${src}`, metadataBase.origin).toString();
const crest = clubImage(CLUB.crest);
const clubLogo = absolute(crest.src);
const share = clubImage(CLUB.shareImage ?? CLUB.poster ?? CLUB.crest);
const poster = absolute(share.src);
const title = [CLUB.event.name, CLUB.event.tagline].filter(Boolean).join(' - ');

export const metadata: Metadata = {
  metadataBase,
  title: `${title} | ${CLUB.name}`,
  description: CLUB.event.description,
  applicationName: `${CLUB.shortName} Snail Race`,
  openGraph: {
    title,
    description: CLUB.event.description,
    type: 'website',
    images: [{ url: poster, width: share.width, height: share.height, alt: `${CLUB.name} ${CLUB.event.name}` }],
  },
  icons: {
    icon: clubLogo,
    apple: clubLogo,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f4f4' },
    { media: '(prefers-color-scheme: dark)', color: CLUB.colours.primary },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/**
 * Runs before first paint so a saved Light/Dark choice never flashes the
 * other theme. "System" is stored as the absence of a choice: no attribute
 * is set and the prefers-color-scheme media query decides.
 */
const themeInit = `(function(){try{var t=localStorage.getItem('ndcc-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}})()`;

/* The club's colours, read by every stylesheet through --club-primary and --club-accent. */
const clubColours = {
  '--club-primary': CLUB.colours.primary,
  '--club-accent': CLUB.colours.accent,
  ...(CLUB.colours.secondary ? { '--club-secondary': CLUB.colours.secondary } : {}),
  ...(CLUB.colours.highlight ? { '--club-highlight': CLUB.colours.highlight } : {}),
} as React.CSSProperties;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" suppressHydrationWarning style={clubColours}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
      </body>
    </html>
  );
}
