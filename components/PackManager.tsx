'use client';

import { useMemo, useRef, useState } from 'react';
import { addAudit, setState, useEvent } from '@/lib/event-store';
import { packCommitment, validatePack, PACK_MAX_RACES } from '@/lib/race-pack';
import { sha256HexOfBuffer, shortHash } from '@/lib/audit';
import { hasPackFile, putPackFile, verifiedPackHashes } from '@/lib/pack-files';
import { newId, dateStamp } from '@/lib/ids';
import { DEFAULT_NAMES } from '@/lib/palette';
import type { PackRace, RacePackManifest } from '@/lib/types';

/**
 * The Race Pack panel: build or import a card of recorded races, attach and
 * verify its media, and lock it - which publishes the pack commitment to the
 * audit trail and freezes the card for the night.
 *
 * Committed results are never shown here. Each race says "result sealed"
 * until it has actually run on the projector.
 */

export function PackManager({ say }: { say: (message: string) => void }) {
  const event = useEvent();
  const pack = event.racePack ?? null;
  const locked = Boolean(event.packLockedAt);
  const importRef = useRef<HTMLInputElement | null>(null);
  const mediaRef = useRef<HTMLInputElement | null>(null);
  const addMediaRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState('');
  const [raceTitle, setRaceTitle] = useState('');
  const [runnersText, setRunnersText] = useState(DEFAULT_NAMES.slice(0, 8).join('\n'));
  const [sponsor, setSponsor] = useState('');
  const [orderText, setOrderText] = useState('');
  const [source, setSource] = useState('');
  const [licence, setLicence] = useState('');
  const [pendingMedia, setPendingMedia] = useState<{
    file: File;
    sha256: string;
    durationMs: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mediaReport, setMediaReport] = useState('');

  const errors = useMemo(() => (pack ? validatePack(pack) : []), [pack]);
  const attached = useMemo(() => {
    void mediaReport;
    return pack ? pack.races.filter((r) => hasPackFile(r.mediaSha256)).length : 0;
  }, [pack, mediaReport]);

  /* ── Creation ─────────────────────────────────────────────────────── */

  const startPack = () => {
    const t = title.trim() || `Race night pack ${dateStamp()}`;
    setState({
      racePack: { schema: 1, packId: newId('pack'), title: t, createdAt: Date.now(), races: [] },
      packLockedAt: undefined,
      packCommit: undefined,
      packPlayed: [],
      packCurrent: null,
    });
    say(`Pack "${t}" started. Add its recorded races below.`);
  };

  const probeAndHash = async (file: File) => {
    setBusy(true);
    try {
      const sha256 = await sha256HexOfBuffer(await file.arrayBuffer());
      const durationMs = await new Promise<number>((resolve) => {
        const url = URL.createObjectURL(file);
        const probe = document.createElement('video');
        probe.preload = 'metadata';
        probe.onloadedmetadata = () => {
          URL.revokeObjectURL(url);
          resolve(Number.isFinite(probe.duration) ? Math.round(probe.duration * 1000) : 0);
        };
        probe.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(0);
        };
        probe.src = url;
      });
      setPendingMedia({ file, sha256, durationMs });
    } finally {
      setBusy(false);
    }
  };

  const addRace = () => {
    if (!pack || !pendingMedia) return;
    const runners = runnersText
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean)
      .slice(0, 20);
    const order = orderText
      .split(',')
      .map((x) => Number(x.trim()) - 1)
      .filter((x) => Number.isInteger(x));
    const race: PackRace = {
      raceId: newId('pr'),
      title: raceTitle.trim() || `Race ${pack.races.length + 1}`,
      runners,
      ...(sponsor.trim() ? { sponsor: sponsor.trim() } : {}),
      durationMs: pendingMedia.durationMs || 60_000,
      mediaFileName: pendingMedia.file.name,
      mediaSha256: pendingMedia.sha256,
      mediaBytes: pendingMedia.file.size,
      mediaType: pendingMedia.file.type || 'video/mp4',
      resultOrder: order,
      source: source.trim(),
      licence: licence.trim(),
      createdAt: Date.now(),
    };
    const next: RacePackManifest = { ...pack, races: [...pack.races, race] };
    const raceErrors = validatePack(next).filter((e) => e.includes(race.raceId) || e.startsWith(`Race ${next.races.length} `));
    if (raceErrors.length) {
      say(raceErrors[0]);
      return;
    }
    putPackFile(pendingMedia.sha256, pendingMedia.file);
    setState({ racePack: next });
    setPendingMedia(null);
    setRaceTitle('');
    setOrderText('');
    say(`"${race.title}" added with sealed result and fingerprint ${shortHash(race.mediaSha256)}…`);
  };

  const removeRace = (raceId: string) => {
    if (!pack || locked) return;
    setState({ racePack: { ...pack, races: pack.races.filter((r) => r.raceId !== raceId) } });
  };

  /* ── Import, export, lock ─────────────────────────────────────────── */

  const importManifest = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as RacePackManifest;
        const problems = validatePack(parsed);
        if (problems.length) {
          say(`That manifest has ${problems.length} problem(s): ${problems[0]}`);
          return;
        }
        setState({
          racePack: parsed,
          packLockedAt: undefined,
          packCommit: undefined,
          packPlayed: [],
          packCurrent: null,
        });
        say(`Pack "${parsed.title}" imported with ${parsed.races.length} races. Attach its media, then lock.`);
      } catch {
        say('That file is not a readable pack manifest.');
      }
    };
    reader.readAsText(file);
  };

  const exportManifest = () => {
    if (!pack) return;
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dateStamp()}-Race-Pack-${pack.title.replace(/[^\w-]+/g, '-')}-Rev00.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const lockPack = async () => {
    if (!pack || errors.length) return;
    setBusy(true);
    try {
      const commit = await packCommitment(pack);
      setState({
        racePack: { ...pack, manifestHash: commit },
        packLockedAt: Date.now(),
        packCommit: commit,
      });
      addAudit({
        kind: 'pack_locked',
        raceNo: 0,
        detail: `Race Pack "${pack.title}" (${pack.packId}) locked with ${pack.races.length} races. Commitment SHA-256 ${commit}. Results are sealed in the manifest; changing any file or field breaks this hash.`,
      });
      say('Pack locked. The commitment is in the audit trail.');
    } finally {
      setBusy(false);
    }
  };

  const attachMedia = async (files: FileList) => {
    if (!pack) return;
    setBusy(true);
    let matched = 0;
    const refused: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const sha = await sha256HexOfBuffer(await file.arrayBuffer());
        const race = pack.races.find((r) => r.mediaSha256 === sha);
        if (race) {
          putPackFile(sha, file);
          matched += 1;
        } else {
          refused.push(file.name);
        }
      }
    } finally {
      setBusy(false);
    }
    const verified = pack.races.filter((r) => hasPackFile(r.mediaSha256)).length;
    setMediaReport(
      `${matched} file(s) verified against the manifest${refused.length ? `; REFUSED (no fingerprint match): ${refused.join(', ')}` : ''}. ${verified}/${pack.races.length} races playable.`,
    );
    say(
      refused.length
        ? `${refused.length} file(s) refused: their SHA-256 does not match any committed race.`
        : `${matched} media file(s) verified.`,
    );
  };

  /* ── Render ───────────────────────────────────────────────────────── */

  if (event.eventMode !== 'recorded') {
    return (
      <p className="text-sm text-(--tx)/50">
        The event is in live animated mode. Switch Event mode to &quot;Recorded race pack&quot;
        to run a card of recorded races.
      </p>
    );
  }

  if (!pack) {
    return (
      <div className="grid gap-3">
        <label className="fld">
          <span>New pack title</span>
          <input
            type="text"
            value={title}
            maxLength={60}
            placeholder="e.g. Spring race night card"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={startPack}>
            Start a new pack
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => importRef.current?.click()}>
            Import manifest JSON
          </button>
        </div>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importManifest(f);
            e.target.value = '';
          }}
        />
        <p className="text-[11px] leading-snug text-(--tx)/45">
          A pack is a card of 4 to {PACK_MAX_RACES} recorded races. Only footage you made or hold
          a licence for may enter a pack - the manifest records source and licence per race.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">
          {pack.title}{' '}
          <span className="num text-xs font-normal text-(--tx)/45">
            {pack.races.length} races · {attached}/{pack.races.length} media verified
          </span>
        </p>
        {locked ? (
          <span className="rounded-full bg-(--ok)/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-(--ok)">
            Locked · {shortHash(event.packCommit)}
          </span>
        ) : (
          <span className="rounded-full bg-(--gold)/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-(--gold)">
            Draft
          </span>
        )}
      </div>

      {pack.races.length ? (
        <ul className="max-h-44 overflow-y-auto rounded-xl border border-(--tx)/10 text-xs">
          {pack.races.map((r) => (
            <li key={r.raceId} className="flex items-center gap-2 border-b border-(--tx)/8 px-3 py-2 last:border-0">
              <span className="truncate font-medium">{r.title}</span>
              <span className="text-(--tx)/45">
                {r.runners.length} runners · {Math.round(r.durationMs / 1000)}s
              </span>
              <span className={`ml-auto shrink-0 ${hasPackFile(r.mediaSha256) ? 'text-(--ok)' : 'text-(--bad)'}`}>
                {hasPackFile(r.mediaSha256) ? 'media verified' : 'media missing'}
              </span>
              <span className="shrink-0 text-(--tx)/40">
                {(event.packPlayed ?? []).includes(r.raceId) ? 'raced' : 'result sealed'}
              </span>
              {!locked ? (
                <button
                  type="button"
                  className="shrink-0 text-(--tx)/50 underline hover:text-(--tx)"
                  onClick={() => removeRace(r.raceId)}
                >
                  remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {errors.length ? (
        <ul className="rounded-xl bg-(--bad)/10 px-3 py-2 text-[11px] text-(--bad)">
          {errors.slice(0, 6).map((e) => (
            <li key={e}>{e}</li>
          ))}
          {errors.length > 6 ? <li>…and {errors.length - 6} more.</li> : null}
        </ul>
      ) : null}

      {!locked ? (
        <details className="rounded-xl border border-(--tx)/10 p-3">
          <summary className="cursor-pointer text-sm font-semibold">Add a recorded race</summary>
          <div className="mt-3 grid gap-2">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => mediaRef.current?.click()}
            >
              {pendingMedia
                ? `${pendingMedia.file.name} · ${Math.round(pendingMedia.durationMs / 1000)}s · ${shortHash(pendingMedia.sha256)}…`
                : busy
                  ? 'Fingerprinting…'
                  : '1. Attach the race video'}
            </button>
            <input
              ref={mediaRef}
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void probeAndHash(f);
                e.target.value = '';
              }}
            />
            <label className="fld">
              <span>Race title</span>
              <input type="text" value={raceTitle} maxLength={60} placeholder={`Race ${pack.races.length + 1}`} onChange={(e) => setRaceTitle(e.target.value)} />
            </label>
            <label className="fld">
              <span>Runners, one per line, lane order</span>
              <textarea rows={4} value={runnersText} onChange={(e) => setRunnersText(e.target.value)} />
            </label>
            <label className="fld">
              <span>Finishing order in the footage (runner numbers, winner first, e.g. 3,1,4,2…)</span>
              <input type="text" value={orderText} placeholder="3,1,4,2,5,6,7,8" onChange={(e) => setOrderText(e.target.value)} />
            </label>
            <label className="fld">
              <span>Race sponsor (optional)</span>
              <input type="text" value={sponsor} maxLength={60} onChange={(e) => setSponsor(e.target.value)} />
            </label>
            <label className="fld">
              <span>Footage source</span>
              <input type="text" value={source} maxLength={120} placeholder="e.g. Filmed by the club, March 2026" onChange={(e) => setSource(e.target.value)} />
            </label>
            <label className="fld">
              <span>Licence for this use</span>
              <input type="text" value={licence} maxLength={120} placeholder="e.g. Club-owned footage; all rights held" onChange={(e) => setLicence(e.target.value)} />
            </label>
            <button type="button" className="btn btn-primary" disabled={!pendingMedia || busy} onClick={addRace}>
              Add race with sealed result
            </button>
          </div>
        </details>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!locked ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || errors.length > 0 || pack.races.length === 0}
            onClick={() => void lockPack()}
          >
            Lock pack and publish commitment
          </button>
        ) : null}
        <button type="button" className="btn btn-ghost" onClick={() => addMediaRef.current?.click()}>
          Attach and verify media
        </button>
        <button type="button" className="btn btn-ghost" onClick={exportManifest}>
          Export manifest
        </button>
        <button
          type="button"
          className="btn btn-ghost !text-(--bad)"
          onClick={() => {
            if (
              window.confirm(
                locked
                  ? 'Replace the LOCKED pack? Races already played keep their results; the replacement is a new pack and the change is written to the audit trail.'
                  : 'Discard this draft pack?',
              )
            ) {
              if (locked) {
                addAudit({
                  kind: 'note',
                  raceNo: 0,
                  detail: `LOCKED Race Pack "${pack.title}" (${pack.packId}, commit ${shortHash(event.packCommit)}…) was replaced by the operator before the card completed.`,
                });
              }
              setState({
                racePack: null,
                packLockedAt: undefined,
                packCommit: undefined,
                packPlayed: [],
                packCurrent: null,
              });
            }
          }}
        >
          {locked ? 'Replace pack' : 'Discard draft'}
        </button>
      </div>
      <input
        ref={addMediaRef}
        type="file"
        accept="video/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void attachMedia(e.target.files);
          e.target.value = '';
        }}
      />
      {mediaReport ? <p className="text-[11px] text-(--tx)/55">{mediaReport}</p> : null}
      <p className="text-[11px] leading-snug text-(--tx)/45">
        Media never enters the manifest - only fingerprints do, so a reload asks for the files
        again and verifies before playing. Verified this session: {verifiedPackHashes().length}.
        Results stay sealed on screen until each race runs; the manifest on this device does
        contain them, which is tamper evidence for the room, not secrecy from the laptop&apos;s
        owner.
      </p>
    </div>
  );
}
