import { Archive } from '@/components/Archive';
import { CLUB_TITLE } from '@/lib/club';

export const metadata = {
  title: `Race archive | ${CLUB_TITLE}`,
  description: 'Completed races, results, replays and audit metadata.',
};

export default function ArchivePage() {
  return <Archive />;
}
