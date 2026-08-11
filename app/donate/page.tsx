import { Suspense } from 'react';
import { DonateFlow } from '@/components/DonateFlow';

export const metadata = {
  title: 'Back a snail | Snail Racing Fundraiser',
  description: 'Choose a snail, choose an amount, and donate to the Newcomb & District Cricket Club.',
};

export default function DonatePage() {
  return (
    <Suspense fallback={<div className="sheet min-h-dvh" />}>
      <DonateFlow />
    </Suspense>
  );
}
