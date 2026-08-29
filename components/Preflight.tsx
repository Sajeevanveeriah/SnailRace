'use client';

import { useCallback, useState } from 'react';
import QRCode from 'qrcode';
import { useEvent } from '@/lib/event-store';
import { HAS_API } from '@/lib/deployment';
import { audioState, voicesReady } from '@/lib/sound';
import { validatePack } from '@/lib/race-pack';
import { hasPackFile } from '@/lib/pack-files';
import type { DonationsResponse } from '@/lib/types';

/**
 * Preflight: the pre-event health check.
 *
 * Every row is an inspectable fact with an exact reason, and the overall
 * verdict is the worst row - READY is earned, not assumed because the page
 * rendered. Two rows are honest manual checks (clicker, phone join) because
 * only real hardware can prove them.
 */

type Verdict = 'pass' | 'attention' | 'blocked' | 'manual';

interface CheckRow {
  name: string;
  verdict: Verdict;
  reason: string;
}

export function Preflight() {
  const event = useEvent();
  const [rows, setRows] = useState<CheckRow[] | null>(null);
  const [running, setRunning] = useState(false);
  const [clickerArmed, setClickerArmed] = useState(false);
  const [clickerOk, setClickerOk] = useState<boolean | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    const out: CheckRow[] = [];
    const add = (name: string, verdict: Verdict, reason: string) => out.push({ name, verdict, reason });

    /* Projector basics. */
    add(
      'Full screen',
      document.fullscreenEnabled ? 'pass' : 'attention',
      document.fullscreenEnabled ? 'Available - press F on the stage.' : 'This browser refuses full screen; use the window maximised.',
    );
    const w = window.screen.width;
    const h = window.screen.height;
    add(
      'Screen resolution',
      w >= 1280 && h >= 720 ? 'pass' : 'attention',
      `${w} x ${h}${w >= 1280 && h >= 720 ? '.' : ' - below 1280 x 720 the running order gets tight.'}`,
    );
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    add('Reduced motion', 'pass', rm ? 'System requests reduced motion; decorative motion is stilled.' : 'Full motion available; calm mode (C) stills it on demand.');

    /* Sound. */
    const audio = audioState();
    add(
      'Audio',
      audio === 'running' ? 'pass' : audio === 'blocked' ? 'attention' : 'attention',
      audio === 'running'
        ? 'The audio context is running.'
        : audio === 'blocked'
          ? 'The browser is blocking audio - click anywhere once, then use Sound check.'
          : audio === 'off'
            ? 'Sound is switched off in Controls.'
            : 'Audio arms on the first click; use Sound check before doors.',
    );
    add(
      'Speech voices',
      voicesReady() ? 'pass' : 'attention',
      voicesReady() ? 'Voices installed; the caller can speak.' : 'No speech voices in this browser; written commentary still runs.',
    );

    /* Storage and backups. */
    try {
      localStorage.setItem('ndcc-preflight', '1');
      localStorage.removeItem('ndcc-preflight');
      add('Event storage', 'pass', 'localStorage is writable.');
    } catch {
      add('Event storage', 'blocked', 'localStorage refuses writes (private browsing or full quota). The night cannot persist - fix before doors.');
    }
    try {
      const size = JSON.stringify(event).length;
      add('Backup export', 'pass', `A backup serialises cleanly (${(size / 1024).toFixed(0)} KB).`);
    } catch {
      add('Backup export', 'blocked', 'The event state does not serialise; export would fail.');
    }

    /* QR generation. */
    try {
      await QRCode.toDataURL('preflight');
      add('QR generation', 'pass', 'QR codes render.');
    } catch {
      add('QR generation', 'attention', 'QR generation failed; the join and donate codes will not display.');
    }

    /* Server, donations, Phone Play. */
    if (HAS_API) {
      try {
        const res = await fetch(`/api/donations?eventId=${encodeURIComponent(event.eventId)}`, { cache: 'no-store' });
        const body = (await res.json()) as DonationsResponse & { mode?: 'test' | 'live' };
        if (!body.configured) {
          add('Stripe donations', 'attention', 'STRIPE_SECRET_KEY is not set: cash-only night. Card donations need the server configured.');
        } else if (body.ok) {
          add('Stripe donations', 'pass', `Stripe answers in ${body.mode === 'live' ? 'LIVE' : 'TEST'} mode. ${body.mode === 'test' ? 'Switch to the live key before a real night.' : ''}`);
        } else {
          add('Stripe donations', 'attention', 'Stripe is configured but the last read failed; the board will show its last snapshot.');
        }
      } catch {
        add('Stripe donations', 'attention', 'The donations API did not answer; check the server.');
      }
      try {
        const res = await fetch('/api/live/state?code=PREFLT', { cache: 'no-store' });
        add(
          'Phone Play server',
          res.status === 404 || res.status === 400 ? 'pass' : 'attention',
          res.status === 404 || res.status === 400
            ? 'The live event API answers.'
            : `Unexpected answer (${res.status}) from the live event API.`,
        );
      } catch {
        add('Phone Play server', 'attention', 'The live event API did not answer; phones cannot join.');
      }
      add(
        'Phone join',
        'manual',
        event.phonePlay
          ? `Session ${event.phonePlay.code} is open - scan the join QR with one phone to prove the room path.`
          : 'Open a Phone Play session and scan the join QR with one phone.',
      );
    } else {
      add('Server mode', 'pass', 'Static build: cash and chips only, zero API calls by design. Phone Play and card donations are truthfully unavailable.');
    }

    /* Recorded mode. */
    if (event.eventMode === 'recorded') {
      const pack = event.racePack;
      if (!pack) {
        add('Race Pack', 'blocked', 'Recorded mode with no pack. Build or import one in the Race Pack panel.');
      } else {
        const problems = validatePack(pack);
        if (problems.length) {
          add('Race Pack', 'blocked', `${problems.length} validation problem(s): ${problems[0]}`);
        } else if (!event.packLockedAt) {
          add('Race Pack', 'attention', 'The pack is valid but not locked; lock it to publish the commitment.');
        } else {
          add('Race Pack', 'pass', `"${pack.title}" locked with ${pack.races.length} races.`);
        }
        const missing = pack ? pack.races.filter((r) => !hasPackFile(r.mediaSha256)).length : 0;
        add(
          'Pack media',
          missing === 0 ? 'pass' : 'blocked',
          missing === 0
            ? 'Every race has verified media attached this session.'
            : `${missing} race(s) missing verified media. Attach and verify in the Race Pack panel - files do not survive a reload.`,
        );
      }
    }

    add(
      'Presenter clicker',
      clickerOk === true ? 'pass' : 'manual',
      clickerOk === true
        ? 'Forward press received.'
        : 'Use "Test the clicker" below and press the clicker forward button.',
    );

    setRows(out);
    setRunning(false);
  }, [event, clickerOk]);

  const armClicker = useCallback(() => {
    setClickerArmed(true);
    setClickerOk(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'PageDown' || e.code === 'ArrowRight' || e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        setClickerOk(true);
        setClickerArmed(false);
        window.removeEventListener('keydown', onKey, true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.setTimeout(() => {
      window.removeEventListener('keydown', onKey, true);
      setClickerArmed(false);
      setClickerOk((ok) => (ok === true ? true : false));
    }, 6000);
  }, []);

  const worst: Verdict | null = rows
    ? rows.some((r) => r.verdict === 'blocked')
      ? 'blocked'
      : rows.some((r) => r.verdict === 'attention' || r.verdict === 'manual')
        ? 'attention'
        : 'pass'
    : null;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={running} onClick={() => void run()}>
          {running ? 'Checking…' : rows ? 'Run preflight again' : 'Run preflight'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={armClicker} disabled={clickerArmed}>
          {clickerArmed ? 'Press the clicker forward…' : clickerOk ? 'Clicker OK - test again' : 'Test the clicker'}
        </button>
        {clickerOk === false ? (
          <span className="text-xs text-(--bad)">No forward press received in 6 seconds.</span>
        ) : null}
      </div>

      {worst ? (
        <p
          className={`rounded-xl px-4 py-2.5 text-sm font-bold uppercase tracking-[0.14em] ${
            worst === 'pass'
              ? 'bg-(--ok)/12 text-(--ok)'
              : worst === 'blocked'
                ? 'bg-(--bad)/12 text-(--bad)'
                : 'bg-(--gold)/12 text-(--gold)'
          }`}
          role="status"
        >
          {worst === 'pass' ? 'READY' : worst === 'blocked' ? 'BLOCKED' : 'ATTENTION'}
        </p>
      ) : null}

      {rows ? (
        <ul className="grid gap-1.5">
          {rows.map((r) => (
            <li key={r.name} className="flex items-baseline gap-2 text-xs">
              <span
                className={`w-20 shrink-0 font-bold uppercase tracking-[0.08em] ${
                  r.verdict === 'pass'
                    ? 'text-(--ok)'
                    : r.verdict === 'blocked'
                      ? 'text-(--bad)'
                      : 'text-(--gold)'
                }`}
              >
                {r.verdict === 'manual' ? 'check' : r.verdict}
              </span>
              <span className="font-semibold">{r.name}</span>
              <span className="text-(--tx)/55">{r.reason}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-(--tx)/45">
          Run this before doors open: screen, sound, storage, server, pack media and the
          clicker, each with an exact reason rather than a green light for rendering.
        </p>
      )}
    </div>
  );
}
