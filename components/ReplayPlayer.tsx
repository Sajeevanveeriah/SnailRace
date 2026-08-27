'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Telecast } from './Telecast';
import { RaceTrack } from './RaceTrack';
import { useReplay } from '@/lib/use-replay';
import { clockText } from '@/lib/broadcast';
import { sha256HexOfBuffer, shortHash } from '@/lib/audit';
import { laneColour } from '@/lib/palette';
import { ordinal } from '@/lib/race-engine';
import { setState } from '@/lib/event-store';
import { money } from '@/lib/money';
import type { EventState, RaceHistoryEntry } from '@/lib/types';

/**
 * The recorded race.
 *
 * Two sources, clearly separated:
 *   - the DETERMINISTIC REPLAY, reconstructed from the seed and the audit
 *     block. Always available, survives any reload, and provably matches the
 *     result that was announced - it is the same arithmetic.
 *   - an attached RECORDING, when the operator filmed the night. The file is
 *     fingerprinted with SHA-256 at ingest; on reload the file is re-attached
 *     and verified before a frame of it plays. A file that fails the check is
 *     refused, with the reason on screen - a doctored tape does not get the
 *     club's screen.
 */
export function ReplayPlayer({
  entry,
  event,
  onClose,
}: {
  entry: RaceHistoryEntry;
  event: EventState;
  onClose: () => void;
}) {
  const replay = useReplay(entry);
  const names =
    entry.names ??
    entry.results
      .slice()
      .sort((a, b) => a.lane - b.lane)
      .map((r) => r.name);

  /* ── Reload recovery: remember where the tape was ─────────────────── */

  const posKey = `ndcc-replay-pos-${event.eventId}-${entry.raceNo}-${entry.seedHex}`;
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const saved = Number(localStorage.getItem(posKey));
      if (Number.isFinite(saved) && saved > 0) replay.seek(saved);
    } catch {
      /* no storage: start at the top of the tape */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posKey]);
  useEffect(() => {
    try {
      if (replay.t > 0) localStorage.setItem(posKey, String(Math.round(replay.t)));
    } catch {
      /* ignore */
    }
  }, [replay.t, posKey]);

  /* ── Keyboard transport: space, arrows, home ──────────────────────── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      /* A focused control keeps its own keys - the scrubber's arrows already
         seek through its onChange. */
      if (
        t instanceof HTMLElement &&
        (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        replay.toggle();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        replay.seek(replay.t + 5000);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        replay.seek(replay.t - 5000);
      } else if (e.code === 'Home') {
        e.preventDefault();
        replay.restart();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [replay, onClose]);

  /* ── Verified media ───────────────────────────────────────────────── */

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaState, setMediaState] = useState<
    'none' | 'verifying' | 'verified' | 'mismatch' | 'unreadable'
  >('none');
  const [mediaNote, setMediaNote] = useState('');

  useEffect(
    () => () => {
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    },
    [mediaUrl],
  );

  const attachMedia = useCallback(
    async (file: File) => {
      setMediaState('verifying');
      setMediaNote(`Hashing ${file.name}…`);
      let hash = '';
      try {
        hash = await sha256HexOfBuffer(await file.arrayBuffer());
      } catch {
        setMediaState('unreadable');
        setMediaNote(`${file.name} could not be read. The file may be corrupt or still copying.`);
        return;
      }

      if (entry.media) {
        if (hash !== entry.media.sha256) {
          setMediaState('mismatch');
          setMediaNote(
            `VERIFICATION FAILED. ${file.name} does not match the recording fingerprinted for this race (expected SHA-256 ${shortHash(entry.media.sha256)}…, got ${shortHash(hash)}…). Playback refused; the deterministic replay above remains authoritative.`,
          );
          return;
        }
        setMediaState('verified');
        setMediaNote(
          `${file.name} verified against SHA-256 ${shortHash(hash)}… recorded at ingest.`,
        );
        setMediaUrl(URL.createObjectURL(file));
        return;
      }

      /* First ingest: record the fingerprint on the race entry. */
      setState((s) => ({
        history: s.history.map((h) =>
          h.raceNo === entry.raceNo && h.at === entry.at
            ? {
                ...h,
                media: {
                  fileName: file.name,
                  bytes: file.size,
                  mimeType: file.type || 'video/*',
                  sha256: hash,
                  addedAt: Date.now(),
                },
              }
            : h,
        ),
      }));
      setMediaState('verified');
      setMediaNote(
        `${file.name} attached and fingerprinted: SHA-256 ${shortHash(hash)}…. Re-attach the same file after a reload and it is verified against this fingerprint.`,
      );
      setMediaUrl(URL.createObjectURL(file));
    },
    [entry],
  );

  const remaining = Math.max(0, replay.tMax - replay.t);

  return (
    <section className="glass glass-strong flex flex-col gap-4 p-5" aria-label={`Replay of race ${entry.raceNo}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold">
            {entry.raceType} {entry.raceNo} replay
            {entry.void ? <span className="ml-2 text-sm font-bold text-(--bad)">VOID</span> : null}
          </h2>
          <p className="num text-xs text-(--tx)/50">
            {new Date(entry.at).toLocaleString('en-AU')} · seed {entry.seedHex}
            {entry.commitHash ? ` · commit ${shortHash(entry.commitHash)}` : ''}
            {entry.resultHash ? ` · result ${shortHash(entry.resultHash)}` : ''}
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Back to archive <kbd>Esc</kbd>
        </button>
      </div>

      {entry.void ? (
        <p className="rounded-xl bg-(--bad)/10 px-4 py-2.5 text-sm text-(--bad)">
          This race was voided: {entry.voidReason ?? 'no reason recorded'}. The reconstruction
          below shows the race the seed had drawn; no result stood and no bets settled.
        </p>
      ) : null}

      {/* ── The deterministic replay ─────────────────────────────────── */}

      <div className="replay-stage" style={{ minHeight: '340px' }}>
        {(entry.trackShape ?? 'circuit') === 'circuit' ? (
          <Telecast
            names={names}
            race={replay}
            surface={event.stageTheme}
            laps={Math.max(1, entry.laps ?? 1)}
            chase
            calm={event.calm}
            clubName={event.clubName}
            raceNo={entry.raceNo}
            replay
          />
        ) : (
          <RaceTrack names={names} race={replay} surface={event.stageTheme} />
        )}
      </div>

      {/* ── Transport ────────────────────────────────────────────────── */}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={replay.toggle}>
          {replay.playing ? 'Pause' : replay.ended ? 'Play again' : 'Play'} <kbd>Space</kbd>
        </button>
        <button type="button" className="btn btn-ghost" onClick={replay.restart}>
          Reset
        </button>
        <span className="num text-sm text-(--tx)/70">
          {clockText(replay.t)} <span className="text-(--tx)/40">elapsed</span>
        </span>
        <span className="num text-sm text-(--tx)/70">
          -{clockText(remaining)} <span className="text-(--tx)/40">remaining</span>
        </span>
      </div>

      <div>
        <input
          type="range"
          className="replay-scrub"
          min={0}
          /* A step-quantised range can only reach max if max sits on the
             step grid; otherwise the slider tops out one step short and the
             tape can never be scrubbed to its end. */
          max={Math.max(100, Math.ceil(replay.tMax / 100) * 100)}
          step={100}
          /* Held on the step grid. Off-grid values are sanitised by the
             browser and echoed back through a trailing change event, which
             used to re-seek a hair backwards and un-end the tape. */
          value={Math.round(replay.t / 100) * 100}
          aria-label="Replay timeline"
          onChange={(e) => replay.seek(Number(e.target.value))}
        />
        {/* Surprise markers, synchronised to the tape. */}
        {entry.highlights?.length ? (
          <div className="replay-marks" aria-hidden="true">
            {entry.highlights.map((h, i) => (
              <i
                key={`${h.atMs}-${i}`}
                style={{ left: `${Math.min(100, (h.atMs / Math.max(1, replay.tMax)) * 100)}%` }}
                title={`${(h.atMs / 1000).toFixed(1)}s ${h.name}: ${h.label}`}
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* ── Synchronised events and the result ───────────────────────── */}

      <div className="grid gap-4 lg:grid-cols-2">
        {entry.results.length > 0 ? (
          <div>
            <p className="eyebrow mb-2">Result</p>
            <ol className="flex flex-col gap-1 text-sm">
              {entry.results
                .slice()
                .sort((a, b) => a.place - b.place)
                .map((r) => (
                  <li key={r.lane} className="flex items-center gap-2.5 rounded-lg bg-(--tx)/5 px-3 py-1.5">
                    <span className="num w-9 shrink-0 font-bold text-(--tx)/60">{ordinal(r.place)}</span>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: laneColour(r.lane).shell }} aria-hidden="true" />
                    <span className="truncate font-medium">{r.name}</span>
                    <span className="num ml-auto text-(--tx)/45">{(r.finishMs / 1000).toFixed(2)}s</span>
                  </li>
                ))}
            </ol>
            <p className="num mt-2 text-[11px] text-(--tx)/45">
              Pot {money(entry.potCents)}
              {entry.sponsor ? ` · sponsored by ${entry.sponsor}` : ''}
            </p>
          </div>
        ) : (
          <p className="text-sm text-(--tx)/45">No result stood for this race.</p>
        )}

        {entry.highlights?.length ? (
          <div>
            <p className="eyebrow mb-2">What happened, when</p>
            <ul className="flex max-h-52 flex-col gap-1 overflow-y-auto pr-1 text-xs">
              {entry.highlights.map((h, i) => (
                <li key={`${h.atMs}-${h.lane}-${i}`} className="flex items-center gap-2.5 rounded-lg bg-(--tx)/5 px-3 py-1.5">
                  <button
                    type="button"
                    className="num shrink-0 text-(--accent-bright,#2997ff) underline"
                    onClick={() => replay.seek(Math.max(0, h.atMs - 1500))}
                    title="Jump the replay to this moment"
                  >
                    {(h.atMs / 1000).toFixed(1)}s
                  </button>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: laneColour(h.lane).shell }} aria-hidden="true" />
                  <span className="truncate font-medium">{h.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] font-bold tracking-[0.14em] text-(--tx)/55">{h.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* ── Verified recording ───────────────────────────────────────── */}

      <div className="rounded-xl border border-(--tx)/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">Recording of the night</p>
            <p className="text-[11px] leading-snug text-(--tx)/50">
              {entry.media
                ? `${entry.media.fileName} (${(entry.media.bytes / 1_000_000).toFixed(1)} MB) fingerprinted ${new Date(entry.media.addedAt).toLocaleString('en-AU')}, SHA-256 ${shortHash(entry.media.sha256)}…. Files are not stored in the browser: re-attach the file to play it, and it is verified first.`
                : 'Attach a video of this race to keep alongside the reconstruction. The file is fingerprinted with SHA-256 so a later playback can be verified as the same footage.'}
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            {entry.media ? 'Re-attach and verify' : 'Attach recording'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void attachMedia(f);
              e.target.value = '';
            }}
          />
        </div>

        {mediaState === 'verifying' ? (
          <p className="mt-3 text-sm text-(--tx)/60">{mediaNote}</p>
        ) : null}
        {mediaState === 'mismatch' || mediaState === 'unreadable' ? (
          <p role="alert" className="mt-3 rounded-lg bg-(--bad)/10 px-3 py-2 text-sm font-medium text-(--bad)">
            {mediaNote}
          </p>
        ) : null}
        {mediaState === 'verified' ? (
          <>
            <p className="mt-3 text-sm text-(--ok)">{mediaNote}</p>
            {mediaUrl ? (
              <video
                className="mt-3 w-full rounded-lg"
                src={mediaUrl}
                controls
                playsInline
                onError={() => {
                  setMediaState('unreadable');
                  setMediaNote(
                    'The file verified but the browser could not decode it as video. The deterministic replay above remains available.',
                  );
                  setMediaUrl('');
                }}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
