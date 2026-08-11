import { Suspense } from 'react';
import { ThanksCard } from '@/components/ThanksCard';

export const metadata = {
  title: 'Thank you | Snail Racing Fundraiser',
};

export default function ThanksPage() {
  return (
    <Suspense fallback={<div className="sheet min-h-dvh" />}>
      <ThanksCard />
    </Suspense>
  );
}
