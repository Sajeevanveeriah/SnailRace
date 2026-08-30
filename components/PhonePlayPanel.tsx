'use client';

import { useState } from 'react';
import { DonateQr } from './DonateQr';
import type { RoomSummary } from '@/lib/use-phone-play';

/**
 * The console's Phone Play panel: open a session, show the join QR, watch
 * the room. The operator key never leaves the stage device; the QR carries
 * only the join code.
 */
export function PhonePlayPanel({
  session,
  summary,
  online,
  controlReady,
  controlError,
  playUrl,
  onStart,
  onEnd,
  say,
}: {
  session: { code: string; pin?: string } | null;
  summary: RoomSummary;
  online: boolean;
  controlReady: boolean;
  controlError: string;
  playUrl: string;
  onStart: (pin?: string) => Promise<string | null>;
  onEnd: () => void;
  say: (message: string) => void;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  if (!session) {
    return (
      <div className="grid gap-3">
        <p className="text-[11px] leading-snug text-(--tx)/45">
          Phones join with a room code and 100 free fun chips: picks, reactions and a live
          leaderboard, all validated by the event server. Phones are never authoritative for
          results, settlement or money.
        </p>
        <label className="fld">
          <span>Optional PIN (printed nowhere; tell the room out loud)</span>
          <input
            type="text"
            inputMode="numeric"
            value={pin}
            maxLength={12}
            onChange={(e) => setPin(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onStart(pin.trim() || undefined).then((error) => {
              setBusy(false);
              if (error) say(error);
              else say('Phone Play is open. The join QR is on the lobby and market screens.');
            });
          }}
        >
          {busy ? 'Opening…' : 'Open Phone Play'}
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="num rounded-xl bg-(--tx)/8 px-4 py-2 text-2xl font-bold tracking-[0.2em]">
          {session.code}
        </span>
        <span className={`text-xs font-semibold ${online && controlReady ? 'text-(--ok)' : 'text-(--bad)'}`} role="status">
          {online && controlReady ? 'Server live' : controlError || 'Restoring server control…'}
        </span>
        <span className="num text-xs text-(--tx)/55">
          {summary.players} {summary.players === 1 ? 'phone' : 'phones'} joined
        </span>
      </div>
      {playUrl ? <DonateQr url={playUrl} caption={`Join code ${session.code}`} /> : null}
      {summary.leaderboard.length ? (
        <ol className="max-h-36 overflow-y-auto text-xs">
          {summary.leaderboard.map((row, i) => (
            <li key={`${row.name}-${i}`} className="flex items-center gap-2 border-b border-(--tx)/8 py-1 last:border-0">
              <span className="num w-4 text-(--tx)/40">{i + 1}</span>
              <span className="truncate">{row.name}</span>
              <span className="num ml-auto font-semibold">{row.chips}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="fun-chip-tag">fun chips - no monetary value</p>
      <button
        type="button"
        className="btn btn-ghost !text-(--bad)"
        onClick={() => {
          if (window.confirm('Close Phone Play? Phones are told the event has ended, and the room closes with its chips and picks.')) {
            onEnd();
          }
        }}
      >
        Close Phone Play
      </button>
    </div>
  );
}
