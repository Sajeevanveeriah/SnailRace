'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';
import { ClubBrand } from './brand/ClubBrand';
import { HAS_LIVE_API, liveApiUrl } from '@/lib/deployment';
import { laneColour } from '@/lib/palette';
import { runnerArtForLane } from '@/lib/presentation/runner-art';
import { ordinal } from '@/lib/race-engine';
import { newId } from '@/lib/ids';
import { fetchWithTimeout } from '@/lib/network';
import type { LivePick, LiveShow } from '@/lib/live/store';

/**
 * The audience phone.
 *
 * Never authoritative: this surface renders the server's revisioned snapshot
 * and submits picks and reactions the server validates. A dead connection
 * shows itself honestly, a reload rejoins from the token kept on the phone,
 * and everything chip-shaped says what chips are: fun, and worth nothing.
 */

const STAKES = [10, 25, 50, 100];
const POLL_MS = 2000;

function PlayerSnailArt({ lane = 0, className = '' }: { lane?: number; className?: string }) {
  return (
    <span
      className={`player-snail-art ${className}`}
      style={{ backgroundImage: `url(${runnerArtForLane(lane).src})` }}
      aria-hidden="true"
    />
  );
}

interface StateResponse {
  ok: boolean;
  unchanged?: boolean;
  revision: number;
  show?: LiveShow;
  players?: number;
  leaderboard?: { name: string; chips: number }[];
  you?: { name: string; chips: number; pick: LivePick | null } | null;
  error?: string;
}

interface Identity {
  playerId: string;
  token: string;
  name: string;
}

function restoredIdentity(value: unknown): Identity | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.playerId !== 'string' ||
    !/^pl[A-Za-z0-9_-]{8,64}$/.test(candidate.playerId) ||
    typeof candidate.token !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(candidate.token) ||
    typeof candidate.name !== 'string' ||
    !candidate.name.trim() ||
    candidate.name.length > 24
  ) {
    return null;
  }
  return {
    playerId: candidate.playerId,
    token: candidate.token,
    name: candidate.name.trim(),
  };
}

const REACTIONS: { kind: string; glyph: string; label: string }[] = [
  { kind: 'cheer', glyph: '📣', label: 'Cheer' },
  { kind: 'clap', glyph: '👏', label: 'Applaud' },
  { kind: 'laugh', glyph: '😂', label: 'Laugh' },
  { kind: 'shock', glyph: '😱', label: 'Shock' },
  { kind: 'snail', glyph: '🐌', label: 'Snail' },
];

export function PlayFlow() {
  const params = useSearchParams();
  const codeFromQr = (params.get('c') ?? '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);

  const [code, setCode] = useState(codeFromQr);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [needsPin, setNeedsPin] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  const [snap, setSnap] = useState<StateResponse | null>(null);
  const [online, setOnline] = useState(true);
  const revisionRef = useRef(0);
  const pollInFlightRef = useRef(false);

  const storeKey = code ? `ndcc-play-${code}` : '';

  /* Reconnect: a reload keeps the same player, chips and pick. Deferred a
     tick so restore-on-load is not a render-time cascade. */
  useEffect(() => {
    if (!storeKey || identity) return;
    const id = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(storeKey);
        if (saved) {
          const restored = restoredIdentity(JSON.parse(saved) as unknown);
          if (restored) setIdentity(restored);
          else localStorage.removeItem(storeKey);
        }
      } catch {
        /* no storage: joining again is fine */
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [storeKey, identity]);

  const join = useCallback(async () => {
    setError('');
    setJoining(true);
    try {
      const res = await fetchWithTimeout(liveApiUrl('/api/live/join'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, ...(pin ? { pin } : {}) }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        error?: string;
        playerId?: string;
        token?: string;
        name?: string;
      };
      if (!body.ok || !body.playerId || !body.token) {
        if (res.status === 403) setNeedsPin(true);
        setError(body.error ?? 'Could not join. Check the code on the big screen.');
        return;
      }
      const id: Identity = { playerId: body.playerId, token: body.token, name: body.name ?? name };
      setIdentity(id);
      try {
        localStorage.setItem(storeKey, JSON.stringify(id));
      } catch {
        /* fine */
      }
    } catch {
      setError('No connection to the event. Check the venue wifi and try again.');
    } finally {
      setJoining(false);
    }
  }, [code, name, pin, storeKey]);

  /* The poll. Every phone asks a couple of times a second in aggregate;
     the server answers `unchanged` from its revision when nothing moved. */
  const poll = useCallback(async () => {
    if (!code || code.length !== 6 || pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      const query = new URLSearchParams({ code, since: String(revisionRef.current) });
      if (identity) {
        query.set('playerId', identity.playerId);
      }
      const res = await fetchWithTimeout(liveApiUrl(`/api/live/state?${query}`), {
        cache: 'no-store',
        ...(identity ? { headers: { Authorization: `Bearer ${identity.token}` } } : {}),
      });
      const body = (await res.json()) as StateResponse;
      if (!body.ok) {
        setOnline(res.status < 500);
        if (res.status === 404 || res.status === 410) {
          setSnap(null);
          setError(body.error ?? 'The session has ended.');
        }
        return;
      }
      setOnline(true);
      if (body.unchanged) return;
      if (identity && body.you === null) {
        setIdentity(null);
        setSnap(null);
        setError('Your saved phone session expired. Rejoin with the room code.');
        try {
          localStorage.removeItem(storeKey);
        } catch {
          /* fine */
        }
        return;
      }
      revisionRef.current = body.revision;
      setSnap(body);
    } catch {
      setOnline(false);
    } finally {
      pollInFlightRef.current = false;
    }
  }, [code, identity, storeKey]);

  useEffect(() => {
    if (!HAS_LIVE_API || !identity) return;
    revisionRef.current = 0;
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [identity, poll]);

  /* ── Picks ─────────────────────────────────────────────────────────── */

  const [lane, setLane] = useState<number | null>(null);
  const [stake, setStake] = useState(25);
  const [sending, setSending] = useState(false);
  const [pickError, setPickError] = useState('');

  const show = snap?.show;
  const you = snap?.you ?? null;
  const marketOpen = Boolean(show?.marketOpen);

  const submitPick = useCallback(async () => {
    if (!identity || !show || lane === null) {
      setPickError('Pick a snail first.');
      return;
    }
    setSending(true);
    setPickError('');
    try {
      const res = await fetchWithTimeout(liveApiUrl('/api/live/pick'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          playerId: identity.playerId,
          token: identity.token,
          raceNo: show.raceNo,
          lane,
          chips: stake,
          nonce: newId('pick'),
        }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) {
        setPickError(body.error ?? 'The pick did not land. Try again.');
        if (res.status === 401) {
          setIdentity(null);
          try {
            localStorage.removeItem(storeKey);
          } catch {
            /* fine */
          }
        }
      } else {
        setLane(null);
      }
      revisionRef.current = 0;
      void poll();
    } catch {
      setPickError('No connection. Your chips are safe - try again.');
    } finally {
      setSending(false);
    }
  }, [identity, show, lane, stake, code, storeKey, poll]);

  /* ── Reactions ─────────────────────────────────────────────────────── */

  const [reactedAt, setReactedAt] = useState(0);
  const sendReaction = useCallback(
    async (kind: string) => {
      if (!identity || Date.now() - reactedAt < 1500) return;
      setReactedAt(Date.now());
      try {
        await fetchWithTimeout(liveApiUrl('/api/live/react'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, playerId: identity.playerId, token: identity.token, kind }),
        });
      } catch {
        /* atmosphere only; a lost reaction costs nothing */
      }
    },
    [identity, reactedAt, code],
  );

  const myOutcome = useMemo(() => {
    if (!you?.pick || !show?.result || show.result.raceNo !== show.raceNo) return null;
    if (!you.pick.settled) return null;
    return you.pick.returned && you.pick.returned > 0
      ? { won: true, chips: you.pick.returned }
      : { won: false, chips: 0 };
  }, [you, show]);

  /* ── Static build: the truth, with zero API calls ──────────────────── */

  if (!HAS_LIVE_API) {
    return (
      <main className="sheet phone-race-shell grid min-h-dvh place-items-center p-6">
        <div className="fixed right-4 top-4 z-30">
          <ThemeToggle />
        </div>
        <div className="card play-fallback reveal max-w-md p-8 text-center">
          <ClubBrand
            className="club-brand phone-join-brand"
            imageClassName="club-brand-logo phone-club-logo"
            nameClassName="phone-club-name"
            priority
          />
          <PlayerSnailArt lane={7} />
          <h1 className="display mt-4 text-3xl">Phone Play needs the event server</h1>
          <p className="mt-3 text-sm text-(--tx)/60">
            This copy of the site is the offline build, which runs the races and fun chips on
            the big screen only. On nights where the club runs the event server, the QR code on
            the projector brings this page to life.
          </p>
          <Link className="btn btn-sheet mt-6 inline-flex" href="/">
            Open the projector experience
          </Link>
        </div>
      </main>
    );
  }

  /* ── Join ──────────────────────────────────────────────────────────── */

  if (!identity || !show) {
    return (
      <main className="sheet phone-race-shell grid min-h-dvh place-items-center p-6">
        <div className="fixed right-4 top-4 z-30">
          <ThemeToggle />
        </div>
        <div className="card reveal w-full max-w-sm p-8">
          <ClubBrand
            className="club-brand phone-join-brand"
            imageClassName="club-brand-logo phone-club-logo"
            nameClassName="phone-club-name"
            priority
          />
          <PlayerSnailArt />
          <h1 className="display mt-4 text-center text-3xl">Join the races</h1>
          <p className="fun-chip-banner mx-auto mt-3 w-fit" role="note">
            FUN CHIPS - NO MONETARY VALUE
          </p>
          <div className="mt-5 grid gap-3">
            <label className="fld">
              <span>Event code (on the big screen)</span>
              <input
                type="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                value={code}
                maxLength={6}
                placeholder="e.g. KQ7M2X"
                onChange={(e) =>
                  setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6))
                }
              />
            </label>
            <label className="fld">
              <span>Your name</span>
              <input
                type="text"
                value={name}
                maxLength={24}
                placeholder="e.g. Dave S."
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {needsPin ? (
              <label className="fld">
                <span>Event PIN</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={pin}
                  maxLength={12}
                  onChange={(e) => setPin(e.target.value)}
                />
              </label>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm font-medium text-(--bad)">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              className="btn btn-sheet w-full"
              disabled={joining || code.length !== 6 || !name.trim()}
              onClick={() => void join()}
            >
              {joining ? 'Joining…' : identity ? 'Reconnecting…' : 'Join with 100 free chips'}
            </button>
            <p className="text-center text-[11px] leading-relaxed text-(--tx)/75">
              Chips are free, cannot be bought and are worth nothing. The leaderboard is the
              prize. Donations to the club are completely separate.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const result = show.result;

  return (
    <main className="sheet phone-race-shell min-h-dvh pb-36">
      <div className="phone-race-inner mx-auto max-w-md px-5 pt-6">
        <header className="phone-race-header reveal">
          <div className="phone-race-brand-row flex items-start justify-between gap-3">
            <ClubBrand
              className="club-brand phone-club-brand"
              imageClassName="club-brand-logo phone-club-logo"
              nameClassName="phone-club-name"
              priority
            />
            <ThemeToggle className="phone-theme-toggle" />
          </div>
          <div className="phone-race-title-row mt-2 flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="phone-event-name truncate">{show.eventName}</p>
              <h1 className="display text-3xl text-(--tx)">Race {show.raceNo}</h1>
            </div>
            {show.rehearsal ? (
              <span className="rounded-full bg-(--bad)/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-(--bad)">
                Rehearsal
              </span>
            ) : null}
            <span
              className={`ml-auto flex items-center gap-1.5 text-[11px] font-semibold ${online ? 'text-(--ok)' : 'text-(--bad)'}`}
              role="status"
            >
              <span
                className={`h-2 w-2 rounded-full ${online ? 'bg-(--ok)' : 'bg-(--bad)'}`}
                aria-hidden="true"
              />
              {online ? 'Live' : 'Reconnecting…'}
            </span>
          </div>
          <div className="phone-balance-card mt-3" role="note">
            <span className="phone-chip-icon" aria-hidden="true">★</span>
            <strong className="num">{you?.chips ?? 0}</strong>
            <span><b>Fun chips</b><small>Your balance - no monetary value</small></span>
          </div>
        </header>

        {/* ── Market ────────────────────────────────────────────────── */}
        {marketOpen ? (
          <section className="phone-pick-market reveal mt-6" aria-label="Pick a snail">
            <div className="phone-market-heading mb-3">
              <h2>The market is open</h2>
              <p>Choose one of {show.names.length} runners, then set your fun chips.</p>
            </div>
            <div className="phone-runner-list flex flex-col gap-2">
              {show.names.map((n, i) => {
                const c = laneColour(i);
                const picked = lane === i;
                const mine = you?.pick?.lane === i;
                return (
                  <button
                    key={i}
                    type="button"
                    className="pick"
                    aria-pressed={picked}
                    onClick={() => setLane(picked ? null : i)}
                    style={
                      {
                        '--shell': c.shell,
                        '--shell-dk': c.dark,
                        '--body': c.body,
                        '--glow': c.glow,
                      } as React.CSSProperties
                    }
                  >
                    <span className="phone-lane-number num">{i + 1}</span>
                    <PlayerSnailArt lane={i} className="phone-runner-thumb" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-(--tx)">{n}</span>
                      <span className="block text-xs text-(--tx)/50">
                        {(show.odds[i] ?? show.names.length).toFixed(2)} for 1 in fun chips
                        {mine ? ' · your pick' : ''}
                      </span>
                    </span>
                    {picked ? (
                      <span
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white"
                        style={{ background: c.shell }}
                        aria-hidden="true"
                      >
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="phone-chip-choices mt-3 flex flex-wrap gap-2" role="group" aria-label="Chips to play">
              {STAKES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip-amount"
                  aria-pressed={stake === s}
                  onClick={() => setStake(s)}
                >
                  {s} chips
                </button>
              ))}
            </div>
            {pickError ? (
              <p role="alert" className="mt-2 text-sm font-medium text-(--bad)">
                {pickError}
              </p>
            ) : null}
            <button
              type="button"
              className="btn btn-sheet phone-lock-pick mt-3 w-full"
              disabled={sending || lane === null}
              onClick={() => void submitPick()}
            >
              {sending
                ? 'Sending…'
                : you?.pick
                  ? `Change pick to ${lane === null ? '…' : show.names[lane]} for ${stake} chips`
                  : lane === null
                    ? 'Pick a snail to continue'
                    : `Play ${stake} chips on ${show.names[lane]}`}
            </button>
          </section>
        ) : (
          <section className="reveal mt-6" aria-label="Market closed">
            <div className="card p-5 text-center">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-(--bad)">
                Market closed
              </p>
              {you?.pick ? (
                <p className="mt-2 text-sm text-(--tx)/65">
                  You have <b className="num">{you.pick.chips}</b> chips on{' '}
                  <b>{show.names[you.pick.lane] ?? `lane ${you.pick.lane + 1}`}</b> at{' '}
                  <span className="num">{you.pick.odds.toFixed(2)}</span>. Eyes on the big screen.
                </p>
              ) : (
                <p className="mt-2 text-sm text-(--tx)/65">
                  No pick this race - cheer anyway, the next market opens after the result.
                </p>
              )}
            </div>
          </section>
        )}

        {/* ── Result ────────────────────────────────────────────────── */}
        {result && result.raceNo === show.raceNo && !marketOpen ? (
          <section className="reveal mt-4" aria-label="Result">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-(--tx)/45">
              Result - race {result.raceNo}
            </h2>
            <ol className="flex flex-col gap-1.5">
              {result.order.slice(0, 8).map((r) => (
                <li
                  key={r.lane}
                  className="flex items-center gap-2.5 rounded-xl bg-(--tx)/5 px-3 py-2 text-sm"
                >
                  <span className="num w-9 font-bold text-(--tx)/60">{ordinal(r.place)}</span>
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: laneColour(r.lane).shell }}
                    aria-hidden="true"
                  />
                  <span className="truncate font-medium">{r.name}</span>
                </li>
              ))}
            </ol>
            {myOutcome ? (
              <p
                className={`mt-3 rounded-xl px-4 py-3 text-sm font-semibold ${
                  myOutcome.won ? 'bg-(--ok)/12 text-(--ok)' : 'bg-(--tx)/6 text-(--tx)/60'
                }`}
                role="status"
              >
                {myOutcome.won
                  ? `Your snail got home! ${myOutcome.chips} fun chips back at locked odds.`
                  : 'Not this time - your chips went down with the ship. The next market is your comeback.'}
              </p>
            ) : null}
          </section>
        ) : null}

        {/* ── Leaderboard ───────────────────────────────────────────── */}
        {snap.leaderboard?.length ? (
          <section className="reveal mt-6" aria-label="Chip leaderboard">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-(--tx)/45">
              Room leaderboard <span className="fun-chip-tag">fun chips - no monetary value</span>
            </h2>
            <ol className="flex flex-col gap-1">
              {snap.leaderboard.map((row, i) => (
                <li key={`${row.name}-${i}`} className="flex items-center gap-2 text-sm">
                  <span className="num w-5 text-(--tx)/40">{i + 1}</span>
                  <span className="truncate">{row.name}</span>
                  <span className="num ml-auto font-semibold">{row.chips.toLocaleString('en-AU')}</span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[11px] text-(--tx)/40">
              {snap.players ?? 0} {snap.players === 1 ? 'player' : 'players'} in the room.
            </p>
          </section>
        ) : null}
      </div>

      {/* ── Reactions: always in thumb reach ─────────────────────────── */}
      <div className="phone-reactions fixed inset-x-0 bottom-0 z-20 border-t border-(--tx)/10 bg-(--card)/85 px-5 pb-[max(0.9rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-md items-center justify-between gap-2">
          {REACTIONS.map((r) => (
            <button
              key={r.kind}
              type="button"
              className="react-btn"
              aria-label={r.label}
              onClick={() => void sendReaction(r.kind)}
            >
              <span aria-hidden="true">{r.glyph}</span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-center text-[10px] text-(--tx)/35">
          Reactions reach the room&apos;s atmosphere only - they never touch a race.
        </p>
      </div>
    </main>
  );
}
