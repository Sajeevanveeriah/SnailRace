import type { Metadata, Viewport } from 'next';
import './globals.css';
import './broadcast-theatre.css';

export const metadata: Metadata = {
  title: 'Snail Racing Fundraiser | Newcomb & District Cricket Club',
  description:
    'Back a snail, watch it race, raise money for the Newcomb & District Cricket Club. Card donations by Stripe, provably fair draws, live tote board.',
  applicationName: 'NDCC Snail Race',
  openGraph: {
    title: 'Snail Racing Fundraiser',
    description:
      'Back a snail, watch it race, raise money for the Newcomb & District Cricket Club.',
    type: 'website',
  },
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>%F0%9F%90%8C</text></svg>",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0f' },
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
