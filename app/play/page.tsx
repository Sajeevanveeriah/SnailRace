import { Suspense } from 'react';
import { PlayFlow } from '@/components/PlayFlow';
import { CLUB_TITLE } from '@/lib/club';

export const metadata = {
  title: `Phone Play | ${CLUB_TITLE}`,
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
