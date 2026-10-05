import { money, moneyShort } from './money';
import type { Standing } from './standings';

/**
 * The bottom-of-screen ticker, built from facts the night already has.
 *
 * A broadcast ticker is the cheapest way to make a projector look like a
 * channel rather than a web page, and it is also where the house rules live:
 * the free-chip disclaimer rides past every thirty seconds without anyone
 * having to say it. Every item here is derived from recorded state. Nothing
 * is invented, and nothing about a runner's chances is ever implied.
 */
export interface TickerInput {
  clubName: string;
  eventName: string;
  raceNo: number;
  plannedRaces: number;
  courseName: string;
  laps: number;
  sponsor?: string;
  names: string[];
  runnerSponsors?: string[];
  nightCents: number;
  goalCents?: number;
  standings: Standing[];
  /** Live cash tote board, only when the permit-gated tote is live. */
  tote?: { ticketCents: number; poolCents: number; tickets: number } | null;
  /** Standing auction owners on the auctioned race. */
  auction?: { poolCents: number; owners: number } | null;
  phonePlayCode?: string | null;
  weather?: 'clear' | 'drizzle' | 'downpour';
}

const WEATHER_TEXT = {
  clear: 'Conditions: clear',
  drizzle: 'Conditions: drizzle, greasy track',
  downpour: 'Conditions: downpour',
} as const;

export function tickerItems(input: TickerInput): string[] {
  const items: string[] = [];
  items.push(`${input.eventName.toUpperCase()} · RACE ${input.raceNo} OF ${input.plannedRaces}`);
  items.push(`${input.courseName}, ${input.laps} ${input.laps === 1 ? 'lap' : 'laps'}`);
  if (input.sponsor?.trim()) items.push(`Race ${input.raceNo} presented by ${input.sponsor.trim()}`);
  const runnerSponsors = (input.runnerSponsors ?? [])
    .map((s, i) => (s?.trim() && input.names[i] ? `${input.names[i]} with ${s.trim()}` : ''))
    .filter(Boolean);
  if (runnerSponsors.length) items.push(`Runner sponsors: ${runnerSponsors.join(' · ')}`);
  if (input.weather) items.push(WEATHER_TEXT[input.weather]);
  items.push('FUN CHIPS - NO MONETARY VALUE · every snail has the same chance');
  if (input.nightCents > 0) {
    items.push(
      `Raised tonight for ${input.clubName}: ${moneyShort(input.nightCents)}${
        input.goalCents ? ` of a ${moneyShort(input.goalCents)} goal` : ''
      }`,
    );
  }
  const leader = input.standings[0];
  if (leader) {
    items.push(
      `Championship: ${leader.name} leads on ${leader.points} ${leader.points === 1 ? 'point' : 'points'}${
        input.standings[1] ? `, ${input.standings[1].name} ${input.standings[1].points}` : ''
      }`,
    );
  }
  if (input.tote) {
    items.push(
      `Club cash tote: ${input.tote.tickets} ${input.tote.tickets === 1 ? 'ticket' : 'tickets'} at ${money(input.tote.ticketCents)}, pool ${money(input.tote.poolCents)}`,
    );
  }
  if (input.auction) {
    items.push(`Runner auction: ${input.auction.owners} ${input.auction.owners === 1 ? 'runner' : 'runners'} sold, pool ${money(input.auction.poolCents)}`);
  }
  if (input.phonePlayCode) items.push(`Play along on your phone with free chips - join code ${input.phonePlayCode}`);
  items.push('Donations are gifts to the club and never touch a race');
  return items;
}

/** A split, the way a timing graphic quotes it. */
export function splitText(leader: string, chaser: string, gapSeconds: number): string {
  if (!chaser || chaser === leader) return `${leader} leads`;
  if (gapSeconds < 0.15) return `${leader} and ${chaser} level`;
  return `${leader} leads ${chaser} by ${gapSeconds.toFixed(1)}s`;
}

/** Time of day for the on-air clock. Local to the projector machine. */
export function onAirClock(date: Date): string {
  return date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])m/i, ' $1m').toUpperCase();
}
