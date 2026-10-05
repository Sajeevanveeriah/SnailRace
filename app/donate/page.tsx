import { Suspense } from 'react';
import { DonateFlow } from '@/components/DonateFlow';

export const metadata = {
  title: 'Back a snail | NDCC Snail Racing',
  description: 'Choose a snail, choose an amount, and donate to the Newcomb & District Cricket Club.',
};

export default function DonatePage() {
  return (
    <Suspense fallback={<div className="sheet min-h-dvh" />}>
      <DonateFlow />
    </Suspense>
  );
}
