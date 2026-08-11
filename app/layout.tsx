import type { Metadata, Viewport } from 'next';
import './globals.css';

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
  themeColor: '#0b0b0f',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
