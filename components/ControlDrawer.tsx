'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { hydrate, resetEvent, restore, setState, useEvent } from '@/lib/event-store';
import { money, moneyShort, parseAmountToCents, MIN_DONATION_CENTS, MAX_DONATION_CENTS } from '@/lib/money';
import { MAX_FIELD, MIN_FIELD, QUICK_AMOUNTS_CENTS, RACE_LENGTHS, STAGE_THEMES, drawNames, laneColour } from '@/lib/palette';
import { COURSES } from '@/lib/course';
import { eventBudget, verifyDraw } from '@/lib/race-engine';
import { dateStamp, formattedNow, newId, nowMs } from '@/lib/ids';
import { primeAudio, sampleReport, samplesSettled, sfx, soundCheck } from '@/lib/sound';
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
}: {
  open: boolean;
  onClose: () => void;
  donations: Donation[];
  stripeDonations: Donation[];
  nextRaceNo: number;
  nightCents: number;
}) {
  const event = useEvent();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [cashLane, setCashLane] = useState(0);
  const [cashName, setCashName] = useState('');
  const [cashAmount, setCashAmount] = useState('10');
  const [seedInput, setSeedInput] = useState('');
  const [verifyOut, setVerifyOut] = useState('');
  const [notice, setNotice] = useState('');
  /*
   * Stamped when the report is asked for, not while rendering. A clock read
   * during render disagrees with the server-rendered HTML and breaks
   * hydration, and it would also print the wrong time.
   */
  const [printedAt, setPrintedAt] = useState('');

  const names = event.names.slice(0, event.fieldSize);

  /*
   * Which drop-in audio files were found. The probe runs once the audio
   * context exists and resolves asynchronously, so this is re-read while the
   * console is open rather than being captured once at mount.
   */
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
   * Pace, stated plainly. The oval is about 2,200 course units round and a
   * snail is 48 long, so a twelve-second lap is five body-lengths a second -
   * which reads as a sprinting animal. Showing the number stops that being a
   * surprise on the night.
   */
  const totalMs = event.raceDurationMs;
  const raceLength =
    totalMs >= 60_000
      ? `${Math.floor(totalMs / 60_000)}m ${String(Math.round((totalMs % 60_000) / 1000)).padStart(2, '0')}s`
      : `${Math.round(totalMs / 1000)}s`;
  const pace = (2194 / (lapMs / 1000) / 48).toFixed(1);

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
      ['race', 'lane', 'snail', 'backer', 'amount_aud', 'source', 'status', 'timestamp'],
      ...donations
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((d) => [
          d.raceNo,
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

  const exportBackup = () => {
    download(
      `${dateStamp()}-Snail-Race-Night-Backup-Rev00.json`,
      JSON.stringify(event, null, 2),
      'application/json',
    );
  };

  const importBackup = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const ok = restore(String(reader.result));
      say(ok ? 'Night restored from backup.' : 'That backup could not be read.');
      hydrate();
    };
    reader.readAsText(file);
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
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="fld">
                  <span>{event.trackShape === 'circuit' ? 'Lap length' : 'Race length'}</span>
                  <select
                    value={lapMs}
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
                    value={event.trackShape === 'circuit' ? event.courseId : 'lanes'}
                    onChange={(e) =>
                      e.target.value === 'lanes'
                        ? setState({ trackShape: 'lanes' })
                        : setState({ trackShape: 'circuit', courseId: e.target.value })
                    }
                  >
                    {COURSES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                    <option value="lanes">Straight lanes</option>
                  </select>
                </label>

                {event.trackShape === 'circuit' ? (
                  <label className="fld">
                    <span>Laps</span>
                    <select
                      value={event.laps}
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
                      onChange={(e) => setName(i, e.target.value)}
                      className="w-full rounded-lg border border-(--tx)/15 bg-(--well) px-3 py-1.5 text-sm"
                    />
                  </label>
                ))}
              </div>
              <button type="button" className="btn btn-ghost mt-3 w-full" onClick={suggestNames}>
                Suggest names
              </button>
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
                                  title="Card donations are held by Stripe. Refund it in the Stripe dashboard and it leaves this board on the next read."
                                >
                                  Stripe
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
              <h3 className="mb-3 font-semibold">Results</h3>
              {event.history.length === 0 ? (
                <p className="text-sm text-(--tx)/45">No races run yet.</p>
              ) : (
                <ol className="max-h-64 overflow-y-auto text-sm">
                  {event.history.map((h) => (
                    <li key={h.raceNo} className="border-b border-(--tx)/8 py-2 last:border-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold">
                          {h.raceType} {h.raceNo}: {h.results[0]?.name}
                        </span>
                        <span className="num text-xs text-(--tx)/45">{moneyShort(h.potCents)}</span>
                      </div>
                      <p className="num text-[11px] text-(--tx)/40">
                        seed {h.seedHex}
                        {h.photoFinish ? ' - photo finish' : ''}
                        {h.highlights?.length
                          ? ` - ${h.highlights.length} ${h.highlights.length === 1 ? 'surprise' : 'surprises'}`
                          : ''}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* ── End of night ─────────────────────────────────────── */}
            <section className="panel lg:col-span-2 xl:col-span-3">
              <h3 className="mb-3 font-semibold">End of night</h3>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-ghost" onClick={exportCsv}>
                  Export donations CSV
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
