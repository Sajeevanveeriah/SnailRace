import { Suspense } from 'react';
import { ThanksCard } from '@/components/ThanksCard';
import { CLUB_TITLE } from '@/lib/club';

export const metadata = {
  title: `Thank you | ${CLUB_TITLE}`,
};

export default function ThanksPage() {
  return (
    <Suspense fallback={<div className="sheet min-h-dvh" />}>
      <ThanksCard />
    </Suspense>
  );
}
