'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addAudit, setState, useEvent } from '@/lib/event-store';
import { drawPackRace } from '@/lib/race-pack';
import { getPackFileUrl, hasPackFile, onPackFilesChange } from '@/lib/pack-files';
import { laneColour } from '@/lib/palette';
import { shortHash } from '@/lib/audit';
import type { PackRace, RaceResult } from '@/lib/types';

/**
 * The recorded race, on the projector.
 *
 * The pack is locked and committed before the night; this surface only draws
 * the next race from the eligible pool (seeded, audited), verifies the media
 * fingerprint is attached, plays it full bleed with honest REC PLAYBACK
 * chrome, and reveals the committed result at the end. Nothing here can
 * invent a result: the finishing order was fingerprinted at pack lock.
 */

export function PackRunner({
  onResult,
  onVoid,
}: {
  /** Hand the committed result to the shared settlement path. */
  onResult: (race: PackRace, results: RaceResult[]) => void;
  onVoid: (race: PackRace, reason: string) => void;
}) {
  const event = useEvent();
  const pack = event.racePack ?? null;
  const [mode, setMode] = useState<'idle' | 'playing'>('idle');
  const [mediaTick, setMediaTick] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => onPackFilesChange(() => setMediaTick((t) => t + 1)), []);

  const played = useMemo(() => new Set(event.packPlayed ?? []), [event.packPlayed]);
  const eligible = useMemo(
    () => (pack ? pack.races.filter((r) => !played.has(r.raceId)).map((r) => r.raceId) : []),
    [pack, played],
  );
  const current = pack?.races.find((r) => r.raceId === event.packCurrent) ?? null;
  /* mediaTick bumps when files attach, re-running the check. */
  const mediaReady = useMemo(() => {
    void mediaTick;
    return Boolean(current && hasPackFile(current.mediaSha256));
  }, [current, mediaTick]);

  const draw = useCallback(() => {
    if (!pack || !event.packLockedAt) return;
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const seed = buf[0] >>> 0;
    const chosen = drawPackRace(seed, eligible);
    if (!chosen) return;
    const race = pack.races.find((r) => r.raceId === chosen);
    setState({ packCurrent: chosen });
    addAudit({
      kind: 'pack_race_drawn',
      raceNo: event.raceNumber + 1,
      detail: `Race ${event.raceNumber + 1} drawn from locked pack ${pack.packId}: seed ${seed.toString(16).toUpperCase().padStart(8, '0')} over ${eligible.length} eligible selected ${chosen} ("${race?.title ?? ''}"), media SHA-256 ${shortHash(race?.mediaSha256)}…`,
    });
  }, [pack, event.packLockedAt, event.raceNumber, eligible]);

  const play = useCallback(() => {
    if (!current || !hasPackFile(current.mediaSha256)) return;
    setMode('playing');
  }, [current]);

  const finish = useCallback(() => {
    if (!current) return;
    setMode('idle');
    const results: RaceResult[] = current.resultOrder.map((lane, i) => ({
      lane,
      name: current.runners[lane] ?? `Lane ${lane + 1}`,
      place: i + 1,
      finishMs: current.durationMs - (current.resultOrder.length - 1 - i) * 400,
    }));
    setState((s) => ({
      packPlayed: [...(s.packPlayed ?? []), current.raceId],
      packCurrent: null,
    }));
    onResult(current, results);
  }, [current, onResult]);

  const voidPlayback = useCallback(() => {
    if (!current) return;
    setMode('idle');
    setState({ packCurrent: null });
    onVoid(current, 'Recorded race declared void during playback. It stays eligible for a re-draw.');
  }, [current, onVoid]);

  if (!pack) {
    return (
      <div className="pack-stage glass grid place-items-center p-10 text-center">
        <div>
          <h2 className="text-xl font-bold">Recorded mode has no Race Pack yet</h2>
          <p className="mt-2 max-w-md text-sm text-(--tx)/55">
            Open Controls and build or import a pack in the Race Pack panel, attach its media,
            and lock it. The card runs from the locked pack only.
          </p>
        </div>
      </div>
    );
  }

  if (!event.packLockedAt) {
    return (
      <div className="pack-stage glass grid place-items-center p-10 text-center">
        <div>
          <h2 className="text-xl font-bold">The pack is not locked</h2>
          <p className="mt-2 max-w-md text-sm text-(--tx)/55">
            Lock &quot;{pack.title}&quot; in Controls to publish its commitment to the audit
            trail. Races can only run from a locked pack.
          </p>
        </div>
      </div>
    );
  }

  /* ── Playback ─────────────────────────────────────────────────────── */

  if (mode === 'playing' && current) {
    const url = getPackFileUrl(current.mediaSha256);
    return (
      <div className="pack-stage pack-playing">
        <div className="tv-top" aria-hidden="true">
          <span className="tv-live tv-replay">
            <i /> REC PLAYBACK
          </span>
          <span className="tv-title">
            {current.title}
            {current.sponsor ? ` · ${current.sponsor}` : ''}
          </span>
        </div>
        {url ? (
          <video
            ref={videoRef}
            className="pack-video"
            src={url}
            autoPlay
            playsInline
            onEnded={finish}
            onError={() => {
              setMode('idle');
              addAudit({
                kind: 'note',
                raceNo: event.raceNumber + 1,
                detail: `Playback of ${current.mediaFileName} failed to decode. The race was not revealed; re-attach or re-check the media.`,
              });
            }}
          />
        ) : null}
        <div className="pack-controls no-print">
          <button type="button" className="btn btn-ghost" onClick={finish}>
            Skip to result
          </button>
          <button type="button" className="btn btn-ghost !text-(--bad)" onClick={voidPlayback}>
            Void race
          </button>
        </div>
      </div>
    );
  }

  /* ── Between recorded races ───────────────────────────────────────── */

  return (
    <div className="pack-stage glass p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl font-bold">
          {pack.title}
          <span className="num ml-3 text-sm font-normal text-(--tx)/45">
            {played.size}/{pack.races.length} raced · commit {shortHash(event.packCommit)}
          </span>
        </h2>
      </div>

      {current ? (
        <div className="mt-5">
          <p className="eyebrow mb-2">Drawn and ready</p>
          <div className="rounded-xl border border-(--tx)/10 p-4">
            <p className="text-lg font-bold">{current.title}</p>
            <p className="num text-xs text-(--tx)/45">
              {Math.round(current.durationMs / 1000)}s · media {shortHash(current.mediaSha256)}…
              {current.sponsor ? ` · sponsored by ${current.sponsor}` : ''}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {current.runners.map((n, i) => (
                <span key={i} className="flex items-center gap-1.5 rounded-full bg-(--tx)/6 px-2.5 py-1 text-xs">
                  <span className="h-2 w-2 rounded-full" style={{ background: laneColour(i).shell }} aria-hidden="true" />
                  {i + 1}. {n}
                </span>
              ))}
            </div>
            {!mediaReady ? (
              <p role="alert" className="mt-3 rounded-lg bg-(--bad)/10 px-3 py-2 text-sm font-medium text-(--bad)">
                The verified media for this race is not attached on this device. Attach and
                verify it in Controls, then play. The result stays sealed until the race runs.
              </p>
            ) : null}
            <div className="mt-4 flex gap-2">
              <button type="button" className="btn btn-go" disabled={!mediaReady} onClick={play}>
                Play race
              </button>
            </div>
          </div>
        </div>
      ) : eligible.length ? (
        <div className="mt-5">
          <p className="text-sm text-(--tx)/60">
            {eligible.length} of {pack.races.length} races still sealed. The draw picks one at
            random and writes the seed to the audit trail before anything plays.
          </p>
          <button type="button" className="btn btn-go mt-4" onClick={draw}>
            Draw the next race
          </button>
        </div>
      ) : (
        <p className="mt-5 text-sm text-(--tx)/60">
          The card is complete - every race in the pack has run. Advance the show to the finale.
        </p>
      )}

      <p className="mt-6 text-[11px] leading-snug text-(--tx)/45">
        Results were committed and fingerprinted when the pack locked; this device holds that
        manifest, so treat it like the sealed envelope it is - tamper-evident to the room, not
        secret from whoever owns the laptop.
      </p>
    </div>
  );
}
