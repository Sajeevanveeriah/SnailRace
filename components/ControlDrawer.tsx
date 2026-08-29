'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { addAudit, auditChainSettled, currentState, hydrate, resetEvent, restore, setState, useEvent } from '@/lib/event-store';
import { commitmentOf, resultHashOf, shortHash, verifyAuditChain, type RaceConfig } from '@/lib/audit';
import { archiveNight, listNights, removeNight, verifyNight, type ArchivedNight } from '@/lib/event-archive';
import { PhonePlayPanel } from './PhonePlayPanel';
import { PackManager } from './PackManager';
import { Preflight } from './Preflight';
import type { usePhonePlay } from '@/lib/use-phone-play';
import type { SurpriseIntensity } from '@/lib/types';
import { money, moneyShort, parseAmountToCents, MIN_DONATION_CENTS, MAX_DONATION_CENTS } from '@/lib/money';
import { MAX_FIELD, MIN_FIELD, QUICK_AMOUNTS_CENTS, RACE_LENGTHS, STAGE_THEMES, drawNames, laneColour } from '@/lib/palette';
import { LAP_LEN } from '@/lib/broadcast';
import { sponsorFor, standingsFrom } from '@/lib/standings';
import { INTENSITY_FACTOR, eventBudget, verifyDraw } from '@/lib/race-engine';
import { dateStamp, formattedNow, newId, nowMs } from '@/lib/ids';
import {
  initVoice,
  onVoicesChanged,
  previewVoice,
  primeAudio,
  sampleReport,
  samplesSettled,
  selectVoice,
  selectedVoiceURI,
  sfx,
  soundCheck,
  voiceChoices,
  type VoiceChoice,
} from '@/lib/sound';
import { useCanSpeak } from '@/lib/use-can-speak';
import type { Donation } from '@/lib/types';

/**
 * The moderator's console.
 *
 * Everything a volunteer needs between races, in one sheet they can reach
 * without leaving the stage. Two rules shape it:
 *   - nothing here can reach the draw. The console writes names, goals and
 *     ledger entries; the finishing order comes from the seed alone.
 *   - nothing is ever silently deleted. Voiding an entry marks it and leaves
 *     it in the ledger, because the club has to reconcile at the end of the
 *     night against Stripe and the cash tin.
 */
export function ControlDrawer({
  open,
  onClose,
  donations,
  stripeDonations,
  nextRaceNo,
  nightCents,
  locked = false,
  phonePlay,
  playUrl,
}: {
  open: boolean;
  onClose: () => void;
  donations: Donation[];
  stripeDonations: Donation[];
  nextRaceNo: number;
  nightCents: number;
  /** The stage's Phone Play controller; the drawer only presents it. */
  phonePlay: ReturnType<typeof usePhonePlay>;
  playUrl: string;
  /**
   * True while a race is armed or running. The set-up that the seed
   * commitment binds - field, names, length, laps, surprises - cannot be
   * edited while locked; voiding the race is the audited way out.
   */
  locked?: boolean;
}) {
  const event = useEvent();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [cashLane, setCashLane] = useState(0);
  const [cashName, setCashName] = useState('');
  const [cashAmount, setCashAmount] = useState('10');
  const [seedInput, setSeedInput] = useState('');
  const [verifyOut, setVerifyOut] = useState('');
  const [chainOut, setChainOut] = useState('');
  const [nights, setNights] = useState<ArchivedNight[]>([]);
  const [notice, setNotice] = useState('');
  /*
   * Stamped when the report is asked for, not while rendering. A clock read
   * during render disagrees with the server-rendered HTML and breaks
   * hydration, and it would also print the wrong time.
   */
  const [printedAt, setPrintedAt] = useState('');
  const [voices, setVoices] = useState<VoiceChoice[]>([]);
  const [voiceURI, setVoiceURI] = useState('');

  const names = event.names.slice(0, event.fieldSize);

  /*
   * Which drop-in audio files were found. The probe runs once the audio
   * context exists and resolves asynchronously, so this is re-read while the
   * console is open rather than being captured once at mount.
   */
  const canSpeak = useCanSpeak();

  useEffect(() => {
    if (!open) return;
    const refresh = () => {
      initVoice();
      setVoices(voiceChoices());
      setVoiceURI(selectedVoiceURI());
    };
    refresh();
    return onVoicesChanged(refresh);
  }, [open]);

  /* The device archive is read when the console opens, not held live. */
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setNights(listNights()), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const [samples, setSamples] = useState(() => sampleReport());
  useEffect(() => {
    if (!open || samplesSettled()) return;
    const id = window.setInterval(() => {
      setSamples(sampleReport());
      if (samplesSettled()) window.clearInterval(id);
    }, 600);
    return () => window.clearInterval(id);
  }, [open]);

  /*
   * On a circuit the stored duration is the whole race, and the moderator
   * thinks in laps: "twenty seconds a lap, five laps". So the control edits
   * lap length and lap count, and the product is what gets stored - which
   * keeps `raceDurationMs` meaning the same thing it always has for the
   * engine, the history and the straight track.
   */
  const laps = event.trackShape === 'circuit' ? Math.max(1, event.laps) : 1;
  const lapMs = Math.round(event.raceDurationMs / laps);

  const setLength = (nextLapMs: number, nextLaps: number) => {
    const l = event.trackShape === 'circuit' ? Math.max(1, nextLaps) : 1;
    setState({ laps: l, raceDurationMs: nextLapMs * l });
  };

  /*
   * A night saved under an earlier build can carry a lap length that is no
   * longer offered. Dropping it would leave the select showing nothing and
   * silently change the race length on the next save, so it is listed too.
   */
  /*
   * Pace, stated plainly. A lap is 4,000 world units and a snail is roughly
   * 170 of them long on screen, so a forty-five second lap is about half a
   * body-length a second - which is what an actual snail does. Showing the
   * number stops a twelve-second lap being a surprise on the night.
   */
  const totalMs = event.raceDurationMs;
  const raceLength =
    totalMs >= 60_000
      ? `${Math.floor(totalMs / 60_000)}m ${String(Math.round((totalMs % 60_000) / 1000)).padStart(2, '0')}s`
      : `${Math.round(totalMs / 1000)}s`;
  const pace = (LAP_LEN / (lapMs / 1000) / 170).toFixed(1);

  const lengthOptions = useMemo(() => {
    const list = RACE_LENGTHS.map((l) => ({ ms: l.ms as number, label: l.label as string }));
    if (!list.some((l) => l.ms === lapMs)) {
      list.push({ ms: lapMs, label: `Custom, ${(lapMs / 1000).toFixed(0)}s` });
      list.sort((a, b) => b.ms - a.ms);
    }
    return list;
  }, [lapMs]);
  const cashCents = useMemo(
    () => event.cashLedger.filter((d) => !d.void).reduce((s, d) => s + d.cents, 0),
    [event.cashLedger],
  );
  const cardCents = nightCents - cashCents;

  const say = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4000);
  };

  const addCash = () => {
    const cents = parseAmountToCents(cashAmount);
    if (cents === null || cents < MIN_DONATION_CENTS || cents > MAX_DONATION_CENTS) {
      say(`Enter an amount between ${money(MIN_DONATION_CENTS)} and ${money(MAX_DONATION_CENTS)}.`);
      return;
    }
    const entry: Donation = {
      id: newId('cash'),
      raceNo: nextRaceNo,
      lane: cashLane,
      snailName: names[cashLane] ?? `Lane ${cashLane + 1}`,
      backerName: cashName.trim(),
      cents,
      source: 'cash',
      createdAt: nowMs(),
    };
    setState({ cashLedger: [entry, ...event.cashLedger] });
    setCashName('');
    sfx.coin();
    say(`${money(cents)} recorded on ${entry.snailName}.`);
  };

  const voidEntry = (id: string) => {
    setState({
      cashLedger: event.cashLedger.map((d) => (d.id === id ? { ...d, void: !d.void } : d)),
    });
  };

  const setName = (index: number, value: string) => {
    const names = event.names.slice();
    names[index] = value.slice(0, 24);
    setState({ names });
  };

  const suggestNames = () => {
    setState({ names: drawNames(MAX_FIELD) });
    say('New names drawn.');
  };

  /** The newest race that still stands. Voided entries are already undone. */
  const lastStanding = event.history.find((h) => !h.void);

  /**
   * Undo the last race - as a COMPENSATING entry, never a deletion.
   *
   * The result row stays in the history marked void with the reason printed
   * beside it, chips and streaks are restored from the snapshots taken
   * before settlement, its bets reopen, and an audit line records all of it.
   * A ledger that can be silently shortened is not a ledger.
   */
  const undoLastRace = () => {
    const last = lastStanding;
    if (!last) return;

    const canRestore = Boolean(last.chipBankBefore && last.streaksBefore);
    setState((s) => ({
      history: s.history.map((h) =>
        h.raceNo === last.raceNo && !h.void && h.seedHex === last.seedHex
          ? {
              ...h,
              void: true,
              voidReason: `Undone by the moderator at ${new Date().toLocaleTimeString('en-AU')}. ${
                canRestore
                  ? 'Chips and streaks restored from pre-settlement snapshots; bets reopened.'
                  : 'Recorded before chip snapshots existed, so chips were left as they were.'
              }`,
            }
          : h,
      ),
      raceNumber: Math.max(0, last.raceNo - 1),
      bets: s.bets.map((b) =>
        b.raceNo === last.raceNo
          ? { ...b, settled: false, won: undefined, returned: undefined }
          : b,
      ),
      bettingOpen: true,
      ...(canRestore
        ? { chipBank: { ...last.chipBankBefore }, streaks: { ...last.streaksBefore } }
        : {}),
    }));
    addAudit({
      kind: 'race_undone',
      raceNo: last.raceNo,
      detail: `Race ${last.raceNo} (seed ${last.seedHex}) undone via compensating void entry. ${
        canRestore ? 'Chip bank and streaks restored exactly; bets reopened.' : 'Chips left as they were (pre-snapshot race).'
      } The result row remains in the history marked void.`,
    });

    say(
      canRestore
        ? `Race ${last.raceNo} undone. Chips and streaks restored, bets reopened. The result stays in the ledger marked void.`
        : `Race ${last.raceNo} voided. This race predates chip snapshots, so chips were left as they are.`,
    );
  };

  const runVerify = () => {
    const past = event.history.find(
      (h) => h.seedHex.toUpperCase() === seedInput.trim().toUpperCase(),
    );
    const order = verifyDraw(seedInput, past?.fieldSize ?? event.fieldSize);
    if (!order) {
      setVerifyOut('That is not a readable seed. Copy it exactly as printed on the stage.');
      return;
    }
    const replay = order.map((lane, i) => `${i + 1}. lane ${lane + 1}`).join('  ');
    if (!past) {
      setVerifyOut(`Replayed order for a ${event.fieldSize}-snail field: ${replay}`);
      return;
    }
    const actual = past.results.slice().sort((a, b) => a.place - b.place).map((r) => r.lane);
    const matches = actual.every((lane, i) => lane === order[i]);
    setVerifyOut(
      matches
        ? `Match. Race ${past.raceNo} finished exactly as seed ${past.seedHex} drew it: ${replay}`
        : `Mismatch against the recorded result for race ${past.raceNo}. Replay says ${replay}.`,
    );

    /* The audit block, when the race recorded one: recompute both hashes. */
    if (past.commitHash || past.resultHash) {
      void (async () => {
        const lines: string[] = [];
        if (past.commitHash && past.names && past.laps !== undefined && past.surprises !== undefined) {
          const config: RaceConfig = {
            raceNo: past.raceNo,
            raceType: past.raceType,
            fieldSize: past.fieldSize,
            names: past.names,
            durationMs: past.durationMs,
            laps: past.laps,
            surprises: past.surprises,
            trackShape: past.trackShape ?? 'circuit',
          };
          const commit = await commitmentOf(past.seedHex, config);
          lines.push(
            commit === past.commitHash
              ? `Commitment ${shortHash(commit)}… verifies: the seed was bound to exactly this set-up.`
              : 'COMMITMENT MISMATCH: the recorded set-up is not the one the seed was committed to.',
          );
        }
        if (past.resultHash) {
          const rh = await resultHashOf(past.seedHex, past.results);
          lines.push(
            rh === past.resultHash
              ? `Result hash ${shortHash(rh)}… verifies.`
              : 'RESULT HASH MISMATCH: the recorded finishing order has been altered.',
          );
        }
        if (lines.length) setVerifyOut((prev) => `${prev} ${lines.join(' ')}`);
      })();
    }
  };

  const download = (filename: string, text: string, mime: string) => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const csvCell = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const exportCsv = () => {
    const rows = [
      ['race', 'sponsor', 'lane', 'snail', 'backer', 'amount_aud', 'source', 'status', 'timestamp'],
      ...donations
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((d) => [
          d.raceNo,
          event.history.find((h) => h.raceNo === d.raceNo)?.sponsor ?? '',
          d.lane + 1,
          d.snailName,
          d.backerName || 'Anonymous',
          (d.cents / 100).toFixed(2),
          d.source,
          d.void ? 'void' : 'counted',
          new Date(d.createdAt).toISOString(),
        ]),
    ];
    download(
      `${dateStamp()}-Snail-Race-Donations-Rev00.csv`,
      rows.map((r) => r.map(csvCell).join(',')).join('\n'),
      'text/csv;charset=utf-8',
    );
  };

  /** Race audit block plus the trail, in one reconciliation-friendly file. */
  const exportAuditCsv = () => {
    const rows = [
      ['section', 'race', 'kind', 'timestamp', 'seed', 'commit_sha256', 'result_sha256', 'detail'],
      ...event.history
        .slice()
        .reverse()
        .map((h) => [
          'race',
          h.raceNo,
          h.void ? 'void' : 'result',
          new Date(h.at).toISOString(),
          h.seedHex,
          h.commitHash ?? '',
          h.resultHash ?? '',
          h.void
            ? (h.voidReason ?? 'void')
            : h.results.map((r) => `${r.place}. ${r.name} (lane ${r.lane + 1})`).join('; '),
        ]),
      ...event.audit
        .slice()
        .reverse()
        .map((a) => ['audit', a.raceNo, a.kind, new Date(a.at).toISOString(), '', '', '', a.detail]),
    ];
    download(
      `${dateStamp()}-Snail-Race-Audit-Rev00.csv`,
      rows.map((r) => r.map(csvCell).join(',')).join('\n'),
      'text/csv;charset=utf-8',
    );
  };

  const exportBackup = () => {
    download(
      `${dateStamp()}-Snail-Race-Night-Backup-Rev00.json`,
      JSON.stringify(event, null, 2),
      'application/json',
    );
    addAudit({
      kind: 'backup_exported',
      raceNo: 0,
      detail: `Backup exported: ${event.history.length} race rows, ${event.audit.length} audit entries at the time of export.`,
    });
  };

  const importBackup = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const ok = restore(String(reader.result));
      if (ok) {
        addAudit({
          kind: 'backup_restored',
          raceNo: 0,
          detail: `Night restored from the backup file "${file.name}". The restored trail continues from here.`,
        });
      }
      say(ok ? 'Night restored from backup.' : 'That backup could not be read.');
      hydrate();
    };
    reader.readAsText(file);
  };

  /**
   * Verify the audit hash chain as stored. Settlement hashes entries
   * asynchronously, so the check waits for the chain queue before reading
   * the live state - the rendered `event` may be a step behind it.
   */
  const runChainVerify = () => {
    void auditChainSettled()
      .then(() => verifyAuditChain(currentState().audit))
      .then((r) =>
        setChainOut(
          r.ok
            ? `Chain verifies: ${r.chained} hashed ${r.chained === 1 ? 'entry' : 'entries'}${
                r.unchained ? `, plus ${r.unchained} pre-chain entries from before v4 anchoring it` : ''
              }. Each entry hash is SHA-256(previous hash + the entry's canonical line), so an edited, removed or reordered entry breaks every hash after it.`
            : `CHAIN BROKEN at entry ${r.breakAt}: the stored trail does not match its own hashes. It has been edited, reordered or truncated after being written.`,
        ),
      );
  };

  const saveNightToArchive = () => {
    void auditChainSettled()
      .then(() => archiveNight(currentState()))
      .then((ok) => {
        setNights(listNights());
        if (ok) {
          addAudit({
            kind: 'backup_exported',
            raceNo: 0,
            detail: 'Night saved to the on-device archive with a SHA-256 integrity fingerprint.',
          });
          say('Night saved to the archive on this device.');
        } else {
          say('The archive refused the save - storage is full or blocked.');
        }
      });
  };

  const restoreNightFromArchive = (n: ArchivedNight) => {
    void verifyNight(n).then((intact) => {
      if (!intact) {
        say('Integrity check failed: that saved night no longer matches its fingerprint. It was not loaded.');
        return;
      }
      if (!window.confirm(`Load "${n.name}"? The current night on this device is replaced.`)) return;
      const ok = restore(JSON.stringify(n.state));
      if (ok) {
        addAudit({
          kind: 'backup_restored',
          raceNo: 0,
          detail: `Night "${n.name}" restored from the on-device archive after its SHA-256 integrity fingerprint verified.`,
        });
        say('Night restored from the archive.');
      } else {
        say('That saved night could not be read.');
      }
    });
  };

  /**
   * End a rehearsal cleanly: rehearsal races, fun bets and chips go, the
   * event set-up, names and the donation ledgers stay. Donations are real
   * money even on a rehearsal night, so they are never cleared here.
   */
  const resetRehearsal = () => {
    if (
      !window.confirm(
        'Clear the rehearsal? Races, fun bets and chips from the rehearsal are removed. Names, set-up and all donations stay.',
      )
    ) {
      return;
    }
    setState({
      history: [],
      bets: [],
      chipBank: {},
      streaks: {},
      raceNumber: 0,
      bettingOpen: true,
      showPhase: 'lobby',
      rehearsal: false,
      packPlayed: [],
      packCurrent: null,
    });
    addAudit({
      kind: 'note',
      raceNo: 0,
      detail: 'Rehearsal cleared: rehearsal races, fun bets and chips removed. Donation ledgers untouched.',
    });
    say('Rehearsal cleared. Ready for the real night; donations were untouched.');
  };

  return (
    <>
      <section
        id="controls"
        className={`drawer glass glass-strong no-print ${open ? 'open' : ''}`}
        aria-label="Moderator controls"
        aria-hidden={!open}
      >
        <div className="mx-auto max-w-[1500px] p-5 sm:p-7">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">Moderator controls</h2>
              <p className="num text-xs text-(--tx)/50">
                {moneyShort(cardCents)} on card, {moneyShort(cashCents)} cash,{' '}
                {stripeDonations.length} card {stripeDonations.length === 1 ? 'entry' : 'entries'}
              </p>
            </div>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Hide <kbd>M</kbd>
            </button>
          </div>

          {notice ? (
            <p role="status" className="mb-4 rounded-xl bg-(--tx)/10 px-4 py-2.5 text-sm">
              {notice}
            </p>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {/* ── Cash tin ─────────────────────────────────────────── */}
            <section className="panel">
              <h3 className="mb-3 font-semibold">Cash tin</h3>
              <div className="grid gap-3">
                <label className="fld">
                  <span>Backing</span>
                  <select
                    value={cashLane}
                    onChange={(e) => setCashLane(Number(e.target.value))}
                  >
                    {names.map((n, i) => (
                      <option key={i} value={i}>
                        {i + 1}. {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="fld">
                  <span>Backer name (optional)</span>
                  <input
                    type="text"
                    value={cashName}
                    maxLength={40}
                    placeholder="e.g. Dave S."
                    onChange={(e) => setCashName(e.target.value)}
                  />
                </label>
                <label className="fld">
                  <span>Amount (AUD)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="1"
                    step="0.01"
                    value={cashAmount}
                    onChange={(e) => setCashAmount(e.target.value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  {QUICK_AMOUNTS_CENTS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="btn btn-ghost px-3 py-1.5 text-xs"
                      onClick={() => setCashAmount((c / 100).toFixed(2))}
                    >
                      {moneyShort(c)}
                    </button>
                  ))}
                </div>
                <button type="button" className="btn btn-primary" onClick={addCash}>
                  Record cash donation
                </button>
                <p className="text-[11px] text-(--tx)/45">
                  Cash is recorded on this device. Card donations arrive from Stripe on their own.
                </p>
              </div>
            </section>

            {/* ── Event identity and stage look ────────────────────── */}
            <section className="panel">
              <h3 className="mb-3 font-semibold">Event</h3>
              <div className="grid gap-3">
                <label className="fld">
                  <span>Club name</span>
                  <input
                    type="text"
                    value={event.clubName}
                    maxLength={60}
                    onChange={(e) => setState({ clubName: e.target.value })}
                  />
                </label>
                <label className="fld">
                  <span>Event name</span>
                  <input
                    type="text"
                    value={event.eventName}
                    maxLength={60}
                    onChange={(e) => setState({ eventName: e.target.value })}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="fld">
                    <span>Event date</span>
                    <input
                      type="date"
                      value={event.eventDate ?? ''}
                      onChange={(e) => setState({ eventDate: e.target.value || undefined })}
                    />
                  </label>
                  <label className="fld">
                    <span>Venue</span>
                    <input
                      type="text"
                      value={event.venue ?? ''}
                      maxLength={60}
                      placeholder="e.g. the clubrooms"
                      onChange={(e) => setState({ venue: e.target.value || undefined })}
                    />
                  </label>
                </div>
                <label className="fld">
                  <span>Race sponsors</span>
                  <textarea
                    rows={3}
                    value={event.sponsors.join('\n')}
                    placeholder={'One sponsor per line\nUsed in order and cycled'}
                    onChange={(e) => setState({ sponsors: e.target.value.split('\n') })}
                  />
                </label>
                {event.sponsors.some((x) => x.trim()) ? (
                  <p className="text-[11px] text-(--tx)/50">
                    Race {nextRaceNo}: {sponsorFor(event.sponsors, nextRaceNo) || 'none'}
                  </p>
                ) : null}

                <div>
                  <p className="fld mb-2"><span>Stage look</span></p>
                  <div className="flex flex-wrap gap-2">
                    {STAGE_THEMES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="swatch"
                        aria-pressed={event.stageTheme === t.id}
                        onClick={() => setState({ stageTheme: t.id })}
                      >
                        <i style={{ background: `linear-gradient(180deg, ${t.a}, ${t.b})` }} />
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* ── Race setup ───────────────────────────────────────── */}
            <section className="panel">
              <h3 className="mb-3 font-semibold">Race setup</h3>
              {locked ? (
                <p className="mb-3 rounded-xl bg-(--bad)/10 px-3 py-2 text-[11px] font-medium text-(--bad)">
                  LOCKED: race {nextRaceNo} is armed or running. The set-up the seed was
                  committed to cannot change now. Void the race (stage bar) to change it;
                  the void is written to the audit trail.
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="fld">
                  <span>{event.trackShape === 'circuit' ? 'Lap length' : 'Race length'}</span>
                  <select
                    value={lapMs}
                    disabled={locked}
                    onChange={(e) => setLength(Number(e.target.value), event.laps)}
                  >
                    {lengthOptions.map((o) => (
                      <option key={o.ms} value={o.ms}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="fld">
                  <span>Track</span>
                  <select
                    value={event.trackShape}
                    disabled={locked}
                    onChange={(e) =>
                      setState({ trackShape: e.target.value as 'circuit' | 'lanes' })
                    }
                  >
                    <option value="circuit">Trackside telecast</option>
                    <option value="lanes">Straight lanes</option>
                  </select>
                </label>

                {event.trackShape === 'circuit' ? (
                  <label className="fld">
                    <span>Laps</span>
                    <select
                      value={event.laps}
                      disabled={locked}
                      onChange={(e) => setLength(lapMs, Number(e.target.value))}
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                        <option key={n} value={n}>
                          {n} {n === 1 ? 'lap' : 'laps'}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="fld">
                  <span>Race type</span>
                  <select
                    value={event.raceType}
                    disabled={locked}
                    onChange={(e) => setState({ raceType: e.target.value })}
                  >
                    <option>Heat</option>
                    <option>Final</option>
                    <option>Champion of champions</option>
                  </select>
                </label>
                <label className="fld">
                  <span>Number of racers</span>
                  <select
                    value={event.fieldSize}
                    disabled={locked}
                    onChange={(e) => setState({ fieldSize: Number(e.target.value) })}
                  >
                    {Array.from({ length: MAX_FIELD - MIN_FIELD + 1 }, (_, i) => MIN_FIELD + i).map(
                      (n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="fld">
                  <span>Tonight&apos;s goal (AUD)</span>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    value={event.goalCents / 100}
                    onChange={(e) =>
                      setState({ goalCents: Math.max(0, Math.round(Number(e.target.value) * 100)) })
                    }
                  />
                </label>
              </div>
              <p className="mt-3 text-[11px] leading-snug text-(--tx)/50">
                {event.trackShape === 'circuit'
                  ? `${event.laps} ${event.laps === 1 ? 'lap' : 'laps'} at ${Math.round(lapMs / 1000)}s = a ${raceLength} race, at about ${pace} body-lengths a second. A snail reads as a snail at about one; much above two and it looks like a beetle.`
                  : `A ${raceLength} race.`}
              </p>

              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={event.goalShow}
                  onChange={(e) => setState({ goalShow: e.target.checked })}
                />
                Show the goal ring on the stage
              </label>
              {event.trackShape === 'circuit' ? (
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={event.chaseCam}
                    onChange={(e) => setState({ chaseCam: e.target.checked })}
                  />
                  Camera director (cuts between shots)
                </label>
              ) : null}
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={event.surprises}
                  disabled={locked}
                  onChange={(e) => setState({ surprises: e.target.checked })}
                />
                In-race surprises
              </label>
              <p className="mt-2 text-[11px] leading-snug text-(--tx)/50">
                {event.surprises
                  ? `About ${eventBudget(event.raceDurationMs, event.fieldSize)} turbo boosts, shell slips and naps per race, marked on the track before they land. They are drawn from the race seed after the finishing order is settled, so they change the drama and never the result.`
                  : 'Surprises are off. The field runs on wobble alone.'}
              </p>
            </section>

            {/* ── Run of show ──────────────────────────────────────── */}
            <section className="panel">
              <h3 className="mb-3 font-semibold">Run of show</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="fld">
                  <span>Event mode</span>
                  <select
                    value={event.eventMode}
                    disabled={locked}
                    onChange={(e) => setState({ eventMode: e.target.value as 'live' | 'recorded' })}
                  >
                    <option value="live">Live animated races</option>
                    <option value="recorded">Recorded race pack</option>
                  </select>
                </label>
                <label className="fld">
                  <span>Races on the card</span>
                  <select
                    value={event.plannedRaces}
                    onChange={(e) => setState({ plannedRaces: Number(e.target.value) })}
                  >
                    {[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                      <option key={n} value={n}>
                        {n} races
                      </option>
                    ))}
                  </select>
                </label>
                <label className="fld sm:col-span-2">
                  <span>Surprise director</span>
                  <select
                    value={event.intensity}
                    disabled={locked}
                    onChange={(e) => setState({ intensity: e.target.value as SurpriseIntensity })}
                  >
                    <option value="calm">Calm night</option>
                    <option value="standard">Standard</option>
                    <option value="big">Big night</option>
                    <option value="chaos">Chaos</option>
                  </select>
                </label>
              </div>
              <p className="mt-2 text-[11px] leading-snug text-(--tx)/50">
                {`About ${eventBudget(event.raceDurationMs, event.fieldSize, INTENSITY_FACTOR[event.intensity])} surprises a race at this setting. `}
                Presets change only how much drama is drawn - every surprise still comes from
                the race seed after the finishing order is settled, and every envelope closes
                to zero at the line, so the preset can never change a result.
              </p>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={event.rehearsal}
                  onChange={(e) => {
                    setState({ rehearsal: e.target.checked });
                    addAudit({
                      kind: 'note',
                      raceNo: 0,
                      detail: e.target.checked
                        ? 'Rehearsal mode ON: the stage and phones are badged REHEARSAL.'
                        : 'Rehearsal mode off.',
                    });
                  }}
                />
                Rehearsal mode
                {event.rehearsal ? (
                  <span className="rounded-md bg-(--gold)/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-(--gold)">
                    Rehearsal
                  </span>
                ) : null}
              </label>
              {event.rehearsal || event.history.length ? (
                <button type="button" className="btn btn-ghost mt-3 w-full" onClick={resetRehearsal}>
                  Clear rehearsal (keep set-up and donations)
                </button>
              ) : null}
              <p className="mt-2 text-[11px] leading-snug text-(--tx)/50">
                On the stage, the clicker walks the night forward: lobby, racecard, market,
                race, results, championship, and an interval when you want one. Backspace
                steps back.
              </p>
            </section>

            {/* ── Phone Play ───────────────────────────────────────── */}
            <section className="panel">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h3 className="font-semibold">Phone Play</h3>
                <span className="fun-chip-tag">fun chips - no monetary value</span>
              </div>
              <PhonePlayPanel
                session={phonePlay.session}
                summary={phonePlay.summary}
                online={phonePlay.online}
                playUrl={playUrl}
                onStart={phonePlay.start}
                onEnd={phonePlay.end}
                say={say}
              />
            </section>

            {/* ── Race Pack (recorded mode) ────────────────────────── */}
            {event.eventMode === 'recorded' ? (
              <section className="panel lg:col-span-2">
                <h3 className="mb-3 font-semibold">Race Pack</h3>
                <PackManager say={say} />
              </section>
            ) : null}

            {/* ── Preflight ────────────────────────────────────────── */}
            <section className="panel">
              <h3 className="mb-3 font-semibold">Preflight</h3>
              <Preflight />
            </section>

            {/* ── Saved nights ─────────────────────────────────────── */}
            <section className="panel">
              <h3 className="mb-1 font-semibold">Saved nights</h3>
              <p className="mb-3 text-[11px] leading-snug text-(--tx)/50">
                Whole nights saved on this device with a SHA-256 fingerprint. A saved night
                that fails its fingerprint check refuses to load.
              </p>
              <button type="button" className="btn btn-ghost mb-3 w-full" onClick={saveNightToArchive}>
                Save this night to the archive
              </button>
              {nights.length === 0 ? (
                <p className="text-sm text-(--tx)/45">No nights saved on this device.</p>
              ) : (
                <ul className="max-h-48 overflow-y-auto text-xs">
                  {nights.map((n) => (
                    <li key={n.id} className="flex items-center gap-2 border-b border-(--tx)/8 py-1.5 last:border-0">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {n.name}
                          {n.rehearsal ? (
                            <span className="ml-1.5 rounded bg-(--gold)/15 px-1 text-[9px] font-bold uppercase text-(--gold)">
                              rehearsal
                            </span>
                          ) : null}
                        </p>
                        <p className="num text-[10px] text-(--tx)/40">
                          {new Date(n.savedAt).toLocaleString('en-AU')}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="ml-auto shrink-0 text-(--tx)/55 underline hover:text-(--tx)"
                        onClick={() => restoreNightFromArchive(n)}
                      >
                        load
                      </button>
                      <button
                        type="button"
                        className="shrink-0 text-(--tx)/40 underline hover:text-(--bad)"
                        onClick={() => {
                          if (window.confirm(`Delete the saved night "${n.name}" from this device?`)) {
                            removeNight(n.id);
                            setNights(listNights());
                          }
                        }}
                      >
                        delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── Sound ────────────────────────────────────────────── */}
            <section className="panel">
              <h3 className="mb-3 font-semibold">Sound</h3>
              <div className="grid gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={event.sound}
                    onChange={(e) => {
                      primeAudio();
                      setState({ sound: e.target.checked });
                    }}
                  />
                  Sound on <kbd>S</kbd>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={event.music}
                    disabled={!event.sound}
                    onChange={(e) => {
                      primeAudio();
                      setState({ music: e.target.checked });
                    }}
                  />
                  Music and crowd <kbd>B</kbd>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={event.caller}
                    disabled={!event.sound || !canSpeak}
                    onChange={(e) => {
                      primeAudio();
                      initVoice();
                      setState({ caller: e.target.checked });
                    }}
                  />
                  Spoken race caller <kbd>V</kbd>
                </label>
                {!canSpeak ? (
                  <p className="text-[11px] leading-snug text-(--tx)/50">
                    This browser has no speech voices installed, so the caller is
                    unavailable. The written commentary still runs.
                  </p>
                ) : null}
                {canSpeak && voices.length ? (
                  <div className="grid gap-2 rounded-md border border-(--tx)/10 p-3">
                    <label className="fld">
                      <span>Commentary voice</span>
                      <select
                        value={voiceURI}
                        onChange={(e) => {
                          selectVoice(e.target.value);
                          setVoiceURI(e.target.value);
                        }}
                      >
                        {voices.map((v) => (
                          <option key={v.uri} value={v.uri}>
                            {v.name} - {v.lang}{v.local ? '' : ' - online'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        primeAudio();
                        previewVoice();
                      }}
                    >
                      Preview commentator
                    </button>
                    <p className="text-[11px] leading-snug text-(--tx)/50">
                      Natural or enhanced Australian voices are preferred when this device provides them.
                    </p>
                  </div>
                ) : null}

                <label className="fld">
                  <span>Overall volume</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={event.volume}
                    disabled={!event.sound}
                    onChange={(e) => setState({ volume: Number(e.target.value) })}
                  />
                </label>
                <label className="fld">
                  <span>Music under the commentary</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={event.musicVolume}
                    disabled={!event.sound || !event.music}
                    onChange={(e) => setState({ musicVolume: Number(e.target.value) })}
                  />
                </label>

                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    primeAudio();
                    soundCheck();
                    say('Playing every cue in order. Set the room level against this.');
                  }}
                >
                  Sound check
                </button>

                <div className="rounded-xl border border-(--tx)/10 p-3">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-(--tx)/45">
                    Your own audio
                  </p>
                  <p className="text-[11px] leading-snug text-(--tx)/50">
                    Everything is synthesised in the browser, so it needs no files, no
                    licence and no connection. To use real recordings instead, drop them
                    into <span className="num">public/audio/</span> and rebuild - each one
                    found replaces its synthesised cue.
                  </p>
                  <ul className="mt-2 grid gap-1">
                    {samples.map((s) => (
                      <li key={s.slot} className="flex items-center gap-2 text-[11px]">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            s.loaded ? 'bg-(--ok)' : 'bg-(--tx)/20'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="num truncate text-(--tx)/60">{s.file}</span>
                        <span className="ml-auto shrink-0 text-(--tx)/40">
                          {s.loaded ? 'in use' : 'synthesised'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            {/* ── Racers ───────────────────────────────────────────── */}
            <section className="panel">
              <h3 className="mb-3 font-semibold">Racers</h3>
              <div className="grid gap-2">
                {names.map((n, i) => (
                  <label key={i} className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ background: laneColour(i).shell }}
                      aria-hidden="true"
                    />
                    <span className="sr-only">Lane {i + 1} name</span>
                    <input
                      type="text"
                      value={n}
                      maxLength={24}
                      disabled={locked}
                      onChange={(e) => setName(i, e.target.value)}
                      className="w-full rounded-lg border border-(--tx)/15 bg-(--well) px-3 py-1.5 text-sm"
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-ghost mt-3 w-full"
                disabled={locked}
                onClick={suggestNames}
              >
                Suggest names
              </button>
              {locked ? (
                <p className="mt-2 text-[11px] text-(--tx)/45">
                  Names are locked while a race is armed or running.
                </p>
              ) : null}
            </section>

            {/* ── Ledger ───────────────────────────────────────────── */}
            <section className="panel lg:col-span-2">
              <h3 className="mb-3 font-semibold">
                Donation ledger{' '}
                <span className="num text-xs font-normal text-(--tx)/45">
                  {donations.length} {donations.length === 1 ? 'entry' : 'entries'}
                </span>
              </h3>
              <div className="max-h-64 overflow-y-auto rounded-xl border border-(--tx)/10">
                {donations.length === 0 ? (
                  <p className="p-4 text-sm text-(--tx)/45">Nothing recorded yet.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-(--card) text-[11px] uppercase tracking-wider text-(--tx)/45">
                      <tr>
                        <th className="p-2">Race</th>
                        <th className="p-2">Snail</th>
                        <th className="p-2">Backer</th>
                        <th className="p-2 text-right">Amount</th>
                        <th className="p-2">Source</th>
                        <th className="p-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {donations
                        .slice()
                        .sort((a, b) => b.createdAt - a.createdAt)
                        .map((d) => (
                          <tr
                            key={d.id}
                            className={`border-t border-(--tx)/8 ${d.void ? 'opacity-40 line-through' : ''}`}
                          >
                            <td className="num p-2">{d.raceNo}</td>
                            <td className="p-2">{d.snailName}</td>
                            <td className="p-2">{d.backerName || 'Anonymous'}</td>
                            <td className="num p-2 text-right">{money(d.cents)}</td>
                            <td className="p-2 text-(--tx)/50">{d.source}</td>
                            <td className="p-2 text-right">
                              {d.source === 'cash' ? (
                                <button
                                  type="button"
                                  className="text-xs text-(--tx)/50 underline hover:text-(--tx)"
                                  onClick={() => voidEntry(d.id)}
                                >
                                  {d.void ? 'restore' : 'void'}
                                </button>
                              ) : (
                                <span
                                  className="text-[11px] text-(--tx)/30"
                                  title="Card donations are held by Stripe. Refund it in the Stripe dashboard and the board nets it off on the next read."
                                >
                                  {d.refundedCents ? `refunded ${money(d.refundedCents)}` : 'Stripe'}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {/* ── Results ──────────────────────────────────────────── */}
            <section className="panel">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h3 className="font-semibold">Results</h3>
                {lastStanding ? (
                  <button
                    type="button"
                    className="text-xs text-(--tx)/55 underline hover:text-(--tx)"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Undo race ${lastStanding.raceNo}? The result stays in the ledger marked void, its fun bets reopen and chips go back to what they were. An audit entry is written.`,
                        )
                      ) {
                        undoLastRace();
                      }
                    }}
                  >
                    Undo last race
                  </button>
                ) : null}
              </div>
              {event.history.length === 0 ? (
                <p className="text-sm text-(--tx)/45">No races run yet.</p>
              ) : (
                <ol className="max-h-64 overflow-y-auto text-sm">
                  {event.history.map((h) => (
                    <li
                      key={`${h.raceNo}-${h.at}`}
                      className={`border-b border-(--tx)/8 py-2 last:border-0 ${h.void ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={`font-semibold ${h.void ? 'line-through' : ''}`}>
                          {h.raceType} {h.raceNo}: {h.results[0]?.name ?? 'no result'}
                        </span>
                        <span className="num text-xs text-(--tx)/45">{moneyShort(h.potCents)}</span>
                      </div>
                      {h.void ? (
                        <p className="text-[11px] font-semibold text-(--bad)">
                          VOID - {h.voidReason ?? 'voided'}
                        </p>
                      ) : null}
                      {h.sponsor ? (
                        <p className="text-[11px] text-(--gold)">{h.sponsor}</p>
                      ) : null}
                      <p className="num text-[11px] text-(--tx)/40">
                        seed {h.seedHex}
                        {h.commitHash ? ` - commit ${shortHash(h.commitHash)}` : ''}
                        {h.resultHash ? ` - result ${shortHash(h.resultHash)}` : ''}
                        {h.photoFinish ? ' - photo finish' : ''}
                        {h.highlights?.length
                          ? ` - ${h.highlights.length} ${h.highlights.length === 1 ? 'surprise' : 'surprises'}`
                          : ''}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-2 text-[11px] text-(--tx)/45">
                Full results, replays and audit metadata live in the{' '}
                <Link href="/archive" className="underline hover:text-(--tx)">
                  race archive
                </Link>
                .
              </p>
            </section>

            {/* ── Fun-chip settlement ──────────────────────────────── */}
            <section className="panel">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className="font-semibold">Fun-chip settlement</h3>
                <span className="fun-chip-tag">fun chips - no monetary value</span>
              </div>
              <p className="mb-3 text-[11px] leading-snug text-(--tx)/50">
                Every bet settles exactly once, at the odds locked before the start. Undoing a
                race writes a compensating entry and reopens its bets; nothing is deleted.
              </p>
              {event.bets.length === 0 ? (
                <p className="text-sm text-(--tx)/45">No fun bets placed yet.</p>
              ) : (
                <ul className="max-h-64 overflow-y-auto text-xs">
                  {event.bets
                    .slice()
                    .reverse()
                    .slice(0, 40)
                    .map((b) => (
                      <li
                        key={b.id}
                        className="flex items-center gap-2 border-b border-(--tx)/8 py-1.5 last:border-0"
                      >
                        <span className="num w-8 shrink-0 text-(--tx)/40">R{b.raceNo}</span>
                        <span className="truncate font-medium">{b.punter}</span>
                        <span className="truncate text-(--tx)/50">on {b.snailName}</span>
                        <span className="num ml-auto shrink-0 text-(--gold)">
                          {b.chips} @ {b.odds.toFixed(2)}
                        </span>
                        <span
                          className={`w-14 shrink-0 text-right font-semibold ${
                            !b.settled
                              ? 'text-(--tx)/40'
                              : b.won
                                ? 'text-(--ok)'
                                : 'text-(--tx)/50'
                          }`}
                        >
                          {!b.settled ? 'open' : b.won ? `+${b.returned ?? 0}` : 'lost'}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </section>

            {/* ── Audit trail ──────────────────────────────────────── */}
            <section className="panel">
              <h3 className="mb-1 font-semibold">Audit trail</h3>
              <p className="mb-3 text-[11px] leading-snug text-(--tx)/50">
                Locks, starts, finishes, voids, undos and settlements, newest first. Entries are
                appended by the app and never edited here; they ride along in every backup and
                the audit CSV. Each entry is hash-chained to the one before it.
              </p>
              <button type="button" className="btn btn-ghost mb-3 w-full" onClick={runChainVerify}>
                Verify the hash chain
              </button>
              {chainOut ? (
                <p
                  className={`mb-3 rounded-xl px-3 py-2 text-[11px] leading-snug ${
                    chainOut.startsWith('CHAIN BROKEN') ? 'bg-(--bad)/10 text-(--bad)' : 'bg-(--ok)/10 text-(--ok)'
                  }`}
                  role="status"
                >
                  {chainOut}
                </p>
              ) : null}
              {event.audit.length === 0 ? (
                <p className="text-sm text-(--tx)/45">Nothing recorded yet.</p>
              ) : (
                <ul className="max-h-64 overflow-y-auto text-xs">
                  {event.audit.map((a) => (
                    <li key={a.id} className="border-b border-(--tx)/8 py-1.5 last:border-0">
                      <p className="num text-[10px] text-(--tx)/40">
                        {new Date(a.at).toLocaleTimeString('en-AU')} · {a.kind.replace(/_/g, ' ')}
                      </p>
                      <p className="leading-snug text-(--tx)/75">{a.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── End of night ─────────────────────────────────────── */}
            <section className="panel lg:col-span-2 xl:col-span-3">
              <h3 className="mb-3 font-semibold">End of night</h3>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-ghost" onClick={exportCsv}>
                  Export donations CSV
                </button>
                <button type="button" className="btn btn-ghost" onClick={exportAuditCsv}>
                  Export audit CSV
                </button>
                <button type="button" className="btn btn-ghost" onClick={exportBackup}>
                  Save backup
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => fileRef.current?.click()}
                >
                  Restore backup
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setPrintedAt(formattedNow());
                    window.setTimeout(() => window.print(), 60);
                  }}
                >
                  Print report
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importBackup(f);
                    e.target.value = '';
                  }}
                />
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
                <label className="fld">
                  <span>Verify a past race (paste its seed)</span>
                  <input
                    type="text"
                    value={seedInput}
                    maxLength={12}
                    placeholder="8F2A31C0"
                    onChange={(e) => setSeedInput(e.target.value)}
                  />
                </label>
                <button type="button" className="btn btn-ghost self-end" onClick={runVerify}>
                  Verify draw
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-snug text-(--tx)/50">
                {verifyOut ||
                  'The seed is shown on the stage before each race. Re-running it reproduces the same finishing order, which is the proof the draw was made before the snails moved.'}
              </p>

              <div className="mt-5 border-t border-(--tx)/10 pt-4">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Start a brand new event? This clears the line-up, cash ledger, results and chips on this device. Card donations stay in Stripe.',
                      )
                    ) {
                      resetEvent();
                      say('New event started.');
                    }
                  }}
                >
                  Start a brand new event
                </button>
              </div>
            </section>
          </div>
        </div>
      </section>

      {/* Printable summary, hidden until the browser print sheet opens. */}
      <div className="print-only p-8 text-black">
        <h1 className="text-2xl font-bold">
          {event.clubName} - {event.eventName}
        </h1>
        <p className="mb-4 text-sm">
          {printedAt ? `Report generated ${printedAt}. ` : ''}Total raised {money(nightCents)}{' '}
          across {event.history.length} races.
        </p>
        {standingsFrom(event.history).length > 0 ? (
          <>
            <h2 className="mt-4 text-lg font-bold">Championship</h2>
            <table className="mb-4 w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="border-b p-1">#</th>
                  <th className="border-b p-1">Snail</th>
                  <th className="border-b p-1 text-right">Races</th>
                  <th className="border-b p-1 text-right">Wins</th>
                  <th className="border-b p-1 text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {standingsFrom(event.history).map((row, i) => (
                  <tr key={row.name}>
                    <td className="p-1">{i + 1}</td>
                    <td className="p-1">{row.name}</td>
                    <td className="p-1 text-right">{row.races}</td>
                    <td className="p-1 text-right">{row.wins}</td>
                    <td className="p-1 text-right">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {event.history.some((h) => h.sponsor) ? (
          <p className="mb-4 text-sm">
            With thanks to tonight&apos;s race sponsors:{' '}
            {[...new Set(event.history.map((h) => h.sponsor).filter(Boolean))].join(', ')}.
          </p>
        ) : null}

        <h2 className="text-lg font-bold">Donations</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="border-b p-1">Race</th>
              <th className="border-b p-1">Snail</th>
              <th className="border-b p-1">Backer</th>
              <th className="border-b p-1">Source</th>
              <th className="border-b p-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {donations
              .filter((d) => !d.void)
              .sort((a, b) => a.createdAt - b.createdAt)
              .map((d) => (
                <tr key={d.id}>
                  <td className="p-1">{d.raceNo}</td>
                  <td className="p-1">{d.snailName}</td>
                  <td className="p-1">{d.backerName || 'Anonymous'}</td>
                  <td className="p-1">{d.source}</td>
                  <td className="p-1 text-right">{money(d.cents)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
