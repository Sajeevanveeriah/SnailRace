/**
 * The night, said the way the poster says it: "Saturday 24 October · from 7 pm · Club rooms".
 * Every part is optional and omitted when the operator has not set it.
 */
export function eventWhen(input: {
  eventDate?: string;
  startTime?: string;
  venue?: string;
  timezone?: string;
}): string {
  const parts: string[] = [];
  if (input.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)) {
    const [y, m, d] = input.eventDate.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12));
    parts.push(
      date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
    );
  }
  if (input.startTime && /^\d{2}:\d{2}$/.test(input.startTime)) {
    const [h, min] = input.startTime.split(':').map(Number);
    const suffix = h >= 12 ? 'pm' : 'am';
    const hour = h % 12 === 0 ? 12 : h % 12;
    parts.push(`from ${hour}${min ? `:${String(min).padStart(2, '0')}` : ''} ${suffix}`);
  }
  if (input.venue?.trim()) parts.push(input.venue.trim());
  return parts.join(' · ');
}
