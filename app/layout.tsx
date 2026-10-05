import type { Metadata, Viewport } from 'next';
import './globals.css';
import './broadcast-theatre.css';
import './moderator-desk.css';

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
const clubLogo = new URL(
  `${basePath || '/SnailRace'}/brand/20260403-NDCC-Logo-Bg-Removed-Rev00.png`,
  metadataBase.origin,
).toString();

const poster = new URL(
  `${basePath || '/SnailRace'}/brand/20261003-NDCC-Snail-Racing-Poster-Rev00.webp`,
  metadataBase.origin,
).toString();

export const metadata: Metadata = {
  metadataBase,
  title: 'Snail Racing - A Night at the Races | Newcomb & District Cricket Club',
  description:
    'Newcomb & District Cricket Club presents Snail Racing: a night at the races, Saturday 24 October 2026 from 7 pm at the club rooms. $10 per snail. Back your snail, cheer it home. Slow race, big cheers.',
  applicationName: 'NDCC Snail Race',
  openGraph: {
    title: 'Snail Racing - A Night at the Races',
    description:
      'Saturday 24 October 2026 from 7 pm at the NDCC club rooms. $10 per snail. Back your snail, cheer it home.',
    type: 'website',
    images: [{ url: poster, width: 900, height: 1125, alt: 'NDCC Snail Racing poster: Saturday 24 October, from 7 pm, club rooms, $10 per snail' }],
  },
  icons: {
    icon: clubLogo,
    apple: clubLogo,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f4f4' },
    { media: '(prefers-color-scheme: dark)', color: '#5d1b27' },
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
      </body>
    </html>
  );
}
