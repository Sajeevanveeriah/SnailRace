import { Suspense } from 'react';
import { PlayFlow } from '@/components/PlayFlow';

export const metadata = {
  title: 'Phone Play | Snail Racing Fundraiser',
  description:
    'Join the room, pick a snail and play along with free fun chips. No monetary value, ever.',
};

export default function PlayPage() {
  return (
    <Suspense fallback={<div className="sheet min-h-dvh" />}>
      <PlayFlow />
    </Suspense>
  );
}
