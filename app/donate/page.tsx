import { Suspense } from 'react';
import { DonateFlow } from '@/components/DonateFlow';
import { CLUB, CLUB_TITLE } from '@/lib/club';

export const metadata = {
  title: `Back a snail | ${CLUB_TITLE}`,
  description: `Choose a snail, choose an amount, and donate to the ${CLUB.name}.`,
};

export default function DonatePage() {
  return (
    <Suspense fallback={<div className="sheet min-h-dvh" />}>
      <DonateFlow />
    </Suspense>
  );
}
