'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ReplayPlayer } from './ReplayPlayer';
import { ThemeToggle } from './ThemeToggle';
import { hydrate, useEvent } from '@/lib/event-store';
import { shortHash } from '@/lib/audit';
import { laneColour } from '@/lib/palette';
import { moneyShort } from '@/lib/money';
import type { RaceHistoryEntry } from '@/lib/types';

/**
 * The completed-race archive.
 *
 * Results link to replays, the way a racing site does it: every finished
 * race is a row, every row opens the recorded mode, and the audit metadata
 * (seed, commitment, result hash, void status) rides on the row so the night
 * can be checked without opening anything.
 *
 * All of it is local state, so the archive works identically on the static
 * Pages build and a server deployment, and after any reload.
 */
export function Archive() {
  const event = useEvent();
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    hydrate();
  }, []);

  /* Restore the race that was open before a reload. */
  const openStoreKey = `ndcc-archive-open-${event.eventId}`;
  useEffect(() => {
    /* Deferred a tick: restore-on-load, not a render-time cascade. */
    const id = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(openStoreKey);
        if (saved) setOpenKey(saved);
      } catch {
        /* no storage */
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [openStoreKey]);
  useEffect(() => {
    /* Only ever write a selection here. Clearing happens in the close
       handler - a null on first render must not erase the saved race
       before the deferred restore above has had its chance to read it. */
    try {
      if (openKey) localStorage.setItem(openStoreKey, openKey);
    } catch {
      /* no storage */
    }
  }, [openKey, openStoreKey]);

  const closeReplay = () => {
    setOpenKey(null);
    try {
      localStorage.removeItem(openStoreKey);
    } catch {
      /* no storage */
    }
  };

  const keyOf = (h: RaceHistoryEntry) => `${h.raceNo}-${h.at}`;

  /* Grouped by calendar day, newest day first, races newest first within. */
  const days = useMemo(() => {
    const map = new Map<string, RaceHistoryEntry[]>();
    for (const h of event.history) {
      const day = new Date(h.at).toLocaleDateString('en-AU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      const list = map.get(day) ?? [];
      list.push(h);
      map.set(day, list);
    }
    return [...map.entries()];
  }, [event.history]);

  const open = event.history.find((h) => keyOf(h) === openKey) ?? null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1100px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">{event.clubName}</p>
          <h1 className="display mt-1.5 text-4xl">Race archive</h1>
          <p className="mt-2 text-sm text-(--tx)/55">
            {event.eventName} · every completed race, its result, its replay and its audit
            block. Fun-chip settlement shown here is{' '}
            <b className="text-(--gold)">FUN CHIPS - NO MONETARY VALUE</b>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/" className="btn btn-ghost">
            Back to the stage
          </Link>
          <ThemeToggle />
        </div>
      </header>

      {open ? (
        <ReplayPlayer
          key={keyOf(open)}
          entry={open}
          event={event}
          onClose={closeReplay}
        />
      ) : null}

      {event.history.length === 0 ? (
        <section className="glass p-8 text-center text-sm text-(--tx)/50">
          No races have been run in this event yet. Results appear here the moment the first
          race finishes, with a replay attached.
        </section>
      ) : (
        days.map(([day, races]) => (
          <section key={day} className="glass p-5" aria-label={`Races on ${day}`}>
            <h2 className="eyebrow mb-2">{day}</h2>
            <div>
              {races.map((h) => {
                const winner = h.results.find((r) => r.place === 1);
                return (
                  <div key={keyOf(h)} className="archive-row">
                    <span className="num text-sm font-bold text-(--tx)/60">
                      {h.raceType} {h.raceNo}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {h.void ? (
                          <b className="text-(--bad)">VOID</b>
                        ) : winner ? (
                          <>
                            <span
                              className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-baseline"
                              style={{ background: laneColour(winner.lane).shell }}
                              aria-hidden="true"
                            />
                            <b>{winner.name}</b> wins
                            {h.results[1] ? ` from ${h.results[1].name}` : ''}
                          </>
                        ) : (
                          'No result recorded'
                        )}
                        {h.sponsor ? (
                          <span className="text-(--gold)"> · {h.sponsor}</span>
                        ) : null}
                      </p>
                      <p className="num truncate text-[11px] text-(--tx)/45">
                        {new Date(h.at).toLocaleTimeString('en-AU')} · {h.fieldSize} lanes ·{' '}
                        {Math.round(h.durationMs / 1000)}s · pot {moneyShort(h.potCents)} · seed{' '}
                        {h.seedHex}
                        {h.commitHash ? ` · commit ${shortHash(h.commitHash)}` : ' · no commitment (older build)'}
                        {h.resultHash ? ` · result ${shortHash(h.resultHash)}` : ''}
                        {h.media ? ' · recording fingerprinted' : ''}
                        {h.void && h.voidReason ? ` · ${h.voidReason}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost shrink-0"
                      onClick={() => setOpenKey(keyOf(h))}
                    >
                      Watch replay
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      <p className="text-[11px] leading-snug text-(--tx)/40">
        Replays are reconstructed deterministically from each race&apos;s printed seed and locked
        configuration, so they always match the announced result; the moderator console&apos;s
        Verify draw panel proves it. Attached recordings are verified by SHA-256 before playback.
      </p>
    </main>
  );
}
