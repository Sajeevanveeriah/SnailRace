import type { Metadata, Viewport } from 'next';
import './globals.css';
import './broadcast-theatre.css';

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

export const metadata: Metadata = {
  metadataBase,
  title: 'Dino Snail Race Night | Newcomb & District Cricket Club',
  description:
    'An original eight-runner cartoon snail race night for Newcomb & District Cricket Club, with free fun chips, live commentary and seeded surprise theatre.',
  applicationName: 'NDCC Snail Race',
  openGraph: {
    title: 'Dino Snail Race Night',
    description:
      'Eight original club snails, live commentary and surprise-filled race-night theatre.',
    type: 'website',
    images: [{ url: clubLogo, width: 1184, height: 896, alt: 'Newcomb and District Cricket Club crest' }],
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
