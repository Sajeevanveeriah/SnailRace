'use client';

import { useEffect, useState, type ReactNode, type RefCallback } from 'react';
import { ClubBrand } from './brand/ClubBrand';
import { RosterPanel } from './RosterPanel';
import { QuaddieDesk } from './QuaddiePanel';
import { laneColour } from '@/lib/palette';
import { audioPatch, setState } from '@/lib/event-store';
import { isAuctionRace, toteIsLive } from '@/lib/cash-tote';
import { AuctionDesk, ToteTally } from './CashTotePanel';
import { showPhaseSpec } from '@/lib/show';
import { MAX_SNAILS_ON_CARD, cardRaceNames, cardRaceOwners, nextSnailsRace, snailsForRace } from '@/lib/card';
import { quaddieIsLive } from '@/lib/quaddie';
import { championField, raceSettings, raceSummary, ranSummary } from '@/lib/run-sheet';
import { MIN_LIVE_FIELD } from '@/lib/palette';
import { useCanSpeak } from '@/lib/use-can-speak';
import { initVoice, primeAudio } from '@/lib/sound';
import type { AudioMode, EventState } from '@/lib/types';
import type { BoardRow, RaceController } from '@/lib/use-race';

interface Props {
  event: EventState;
  race: RaceController;
  courseName: string;
  /** The race on the projector: the one just run while on a result. */
  raceNo: number;
  /** The race that will be armed next. */
  nextRaceNo: number;
  fullscreen: boolean;
  wakeLock: boolean;
  audio: string;
  holding: boolean;
  fullCourse: boolean;
  locked: boolean;
  primaryLabel: string;
  primaryDisabled: boolean;
  canBack: boolean;
  startError: string;
  winnerOpen: boolean;
  onPrimary: () => void;
  onBack: () => void;
  onSettings: () => void;
  onReturn: () => void;
  onHold: () => void;
  onCamera: (full: boolean) => void;
  onVoid: () => void;
  onDismissWinner: () => void;
  /** Add a race after the card: the next snails, or a winners' run-off. */
  onAddRace: (kind: 'next' | 'runoff') => void;
  children: ReactNode;
  packControlsRef: RefCallback<HTMLDivElement>;
}

/**
 * The desk: three panels.
 *
 * Run of show (one big button, void, hold), the roster for the race in hand,
 * and the settings that change during a night (audio, camera). Everything
 * else lives behind Admin, where a volunteer never has to look mid-race.
 */

const sequence: { id: EventState['showPhase']; name: string }[] = [
  { id: 'lobby', name: 'Welcome' },
  { id: 'racecard', name: 'Racecard' },
  { id: 'race', name: 'Race' },
  { id: 'results', name: 'Result' },
  { id: 'championship', name: 'Quaddie' },
  { id: 'finale', name: 'Thank you' },
];

const notes: Record<string, string> = {
  lobby: 'Welcome the room. Open the racecard when ready.',
  racecard: 'Read out the snails and their owners. Then send them to the gate.',
  race: 'Press Start. The projector runs the race. Let the finish play out.',
  results: 'Name the winner and the owner. Then move on to the next racecard.',
  championship: 'Read out who is still alive in the quaddie, then the next race.',
  finale: 'Thank the room. Want one more? Add a race below. Save a backup in Admin (Night tab) before closing.',
};

const ordinalPlace = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export function ModeratorDesk(p: Props) {

  const { event, race, packControlsRef } = p;
  const [board, setBoard] = useState<BoardRow[]>([]);
  const { onBoard } = race;
  useEffect(() => onBoard(setBoard), [onBoard]);
  const canSpeak = useCanSpeak();
  const recorded = event.eventMode === 'recorded';
  const recordedRace = event.racePack?.races.find((r) => r.raceId === event.packCurrent);
  /* The race on the projector, as it ran when it has run, as the run sheet says otherwise. */
  const ranEntry = event.history.find((h) => !h.void && h.raceNo === p.raceNo);
  const held = event.heldRaceStart?.raceNo === p.raceNo ? event.heldRaceStart : null;
  const settings = raceSettings(event, p.raceNo);
  const raceLine = ranEntry && !held ? ranSummary(ranEntry) : raceSummary(settings);
  const deskSnails = ranEntry?.snails ?? (ranEntry && ranEntry.snailOffset !== undefined && !ranEntry.snails
    ? Array.from({ length: ranEntry.fieldSize }, (_, lane) => ranEntry.snailOffset! + lane + 1)
    : snailsForRace(p.raceNo, event.card));
  const lineup = recordedRace?.runners ?? ranEntry?.names ?? cardRaceNames(event.card, p.raceNo);
  const owners = recordedRace ? [] : ranEntry?.owners ?? cardRaceOwners(event.card, p.raceNo);
  /* The whole field at every phase: live order while racing, the result once run, the gate before. */
  const settled = ranEntry?.results.length ? ranEntry.results.slice().sort((a, b) => a.place - b.place) : null;
  const rows = race.phase === 'done' && race.results.length
    ? race.results.map((r) => ({ lane: r.lane, place: r.place, gapText: r.place === 1 ? 'Winner' : r.status === 'retired' ? 'Retired' : ordinalPlace(r.place) }))
    : race.phase === 'running' || race.phase === 'confirming'
      ? board
      : settled && !held
        ? settled.map((r) => ({ lane: r.lane, place: r.place, gapText: r.place === 1 ? 'Winner' : r.status === 'retired' ? 'Retired' : ordinalPlace(r.place) }))
        : lineup.map((_, lane) => ({ lane, place: lane + 1, gapText: recorded ? 'Recorded runner' : 'At the gate' }));
  const title = p.holding ? 'Holding screen' : (sequence.find((s) => s.id === event.showPhase)?.name ?? showPhaseSpec(event.showPhase).label);
  const championshipOn = quaddieIsLive(event.quaddie) && event.championshipScreens && event.quaddieEntries.length > 0;
  const visibleSequence = sequence.filter((s) => s.id !== 'championship' || championshipOn);
  const racing = race.phase === 'running' || race.phase === 'countdown' || race.phase === 'confirming';
  const lockedRaceNo = p.locked ? p.nextRaceNo : null;
  /* After the last race the roster has nothing next; show the last field. */
  const rosterRaceNo = Math.min(event.plannedRaces, p.nextRaceNo);
  const racesRun = event.history.filter((h) => !h.void).length;
  const cardDone = racesRun >= event.plannedRaces && p.nextRaceNo > event.plannedRaces;
  const offerAddRace = cardDone && !p.locked && (event.showPhase === 'results' || event.showPhase === 'finale' || event.showPhase === 'championship');
  const runOffField = offerAddRace ? championField(event.history) : [];
  const nextRace = offerAddRace ? nextSnailsRace(event.card) : null;
  const nextFits = nextRace !== null;
  const fieldLabel = settings.runOff || ranEntry?.snails
    ? `${deskSnails.length} runners`
    : `snails ${deskSnails[0]} to ${deskSnails[deskSnails.length - 1]}`;
  /* The welcome note points at the QR only when there is a QR to point at. */
  const note = event.showPhase === 'lobby'
    ? event.card.paymentLinkUrl
      ? 'Welcome the room. Point at the QR: buy a snail, name it. Open the racecard when ready.'
      : 'Welcome the room. Send people to the table to buy and name a snail. Open the racecard when ready.'
    : notes[event.showPhase];
  const setAudio = (mode: AudioMode) => {
    primeAudio();
    if (mode === 'commentary' || mode === 'both') initVoice();
    setState(audioPatch(mode));
  };

  return (
    <div className="moderator-desk" data-moderator-desk="true">
      <header className="desk-header">
        <ClubBrand className="desk-brand" imageClassName="desk-crest" showName={false} />
        <div><p className="desk-eyebrow">{event.clubName} / {event.eventName}</p><h1>Moderator desk</h1></div>
        <div className="desk-connection" role="status">
          <span>Projector connected</span>
          <span>{p.fullscreen ? 'Fullscreen' : 'Windowed - press F on projector'}</span>
        </div>
      </header>

      <ol className="desk-sequence" aria-label="Run of show">
        {visibleSequence.map((s) => <li key={s.id} aria-current={event.showPhase === s.id ? 'step' : undefined}>{s.name}</li>)}
      </ol>

      <main className="desk-layout">
        <div className="desk-main">
          <section className="desk-program" aria-label="Projector status">
            <p className="desk-label">On the projector</p>
            <h2>{title}</h2>
            <p className="desk-race-title">
              {settings.runOff ? settings.title : `Race ${p.raceNo} of ${event.plannedRaces}`}
              {settings.typeLabel && !settings.runOff ? `, ${settings.typeLabel}` : ''} - {fieldLabel} - {raceLine}
            </p>
            <p className="desk-status" role="status">
              {p.holding ? 'The audience sees the holding screen. The show is held.' : event.showPhase === 'race' || event.showPhase === 'results' ? race.status : `The audience sees the ${title.toLowerCase()} screen.`}
            </p>
            {p.startError ? <p className="desk-error" role="alert">{p.startError}</p> : null}
            {event.card.conflictNotice ? <p className="desk-error" role="alert">Card payment conflict: {event.card.conflictNotice}. See the audit trail in Admin.</p> : null}
            <div className="desk-actions">
              {event.showPhase === 'finale' ? (
                <p className="desk-done" role="status">Night complete</p>
              ) : !(recorded && event.showPhase === 'race') ? <button className="btn btn-go" type="button" disabled={p.primaryDisabled || p.holding} onClick={(e) => { if (e.detail < 2) p.onPrimary(); }}>{p.primaryLabel}</button> : null}
              <button className="btn btn-ghost" type="button" disabled={!p.canBack || p.holding} onClick={p.onBack}>Back</button>
              {racing ? <button className="btn btn-ghost desk-void" type="button" onClick={p.onVoid}>Void race</button> : null}
              {p.winnerOpen ? <button className="btn btn-ghost" type="button" onClick={p.onDismissWinner}>Dismiss winner card</button> : null}
            </div>
            {offerAddRace ? (
              <div className="desk-add-race" role="group" aria-label="Add a race">
                <p className="desk-label">That was the last race on the run sheet. Add one more?</p>
                <div className="desk-actions">
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={!nextFits}
                    title={nextFits ? undefined : `The card already sells close to ${MAX_SNAILS_ON_CARD} snails, the most it can hold.`}
                    onClick={() => p.onAddRace('next')}
                  >
                    {nextRace ? `Add a race: snails ${nextRace.first} to ${nextRace.last} (${nextRace.last - nextRace.first + 1} runners)` : 'Add a race: the next snails'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={runOffField.length < MIN_LIVE_FIELD}
                    title={runOffField.length < MIN_LIVE_FIELD ? 'A run-off needs eight runners: run at least three races first.' : undefined}
                    onClick={() => p.onAddRace('runoff')}
                  >
                    Add a race: Champion of champions ({runOffField.length} runners)
                  </button>
                </div>
                {runOffField.length < MIN_LIVE_FIELD || !nextFits ? (
                  <p className="desk-label">
                    {runOffField.length < MIN_LIVE_FIELD
                      ? 'Champion of champions needs eight runners: run at least three races first.'
                      : `The card already sells close to ${MAX_SNAILS_ON_CARD} snails, the most it can hold.`}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="desk-actions desk-secondary">
              <label><input type="checkbox" checked={p.holding} disabled={p.locked} onChange={p.onHold} /> Holding screen</label>
              <button className="btn btn-ghost" type="button" onClick={p.onSettings}>Admin</button>
              <button className="btn btn-ghost" type="button" onClick={p.onReturn}>Return controls to projector</button>
            </div>
            <div className="desk-notes"><p className="desk-label">Speaker notes</p><p>{note}</p></div>
          </section>

          <div ref={packControlsRef} className="desk-pack-tools" hidden={event.eventMode !== 'recorded' || event.showPhase !== 'race'} />

          <section className="desk-panel desk-roster" aria-label="Roster">
            <h2>Roster <span className="num desk-label">race {rosterRaceNo}</span></h2>
            <RosterPanel event={event} raceNo={rosterRaceNo} lockedRaceNo={lockedRaceNo} compact />
          </section>

          {quaddieIsLive(event.quaddie) ? <QuaddieDesk event={event} racing={p.locked} nextRaceNo={p.nextRaceNo} /> : null}

          {toteIsLive(event.cashTote) && ['lobby', 'racecard'].includes(event.showPhase) ? (
            <section className="desk-panel desk-tote" aria-label="Cash tote tally">
              <h2>Cash tote</h2>
              <ToteTally raceNo={p.nextRaceNo} locked={p.locked} compact />
              {isAuctionRace(event.cashTote, p.nextRaceNo, event.plannedRaces, event.auctionBids) ? <AuctionDesk raceNo={p.nextRaceNo} locked={p.locked} /> : null}
            </section>
          ) : null}

          <div className="desk-settings-strip">
            <section className="desk-panel" aria-label="Sound controls">
              <h2>Audio</h2>
              <div className="desk-camera" role="radiogroup" aria-label="Audio mode">
                <label><input type="radio" name="desk-audio" checked={event.audioMode === 'music'} onChange={() => setAudio('music')} /> Music</label>
                <label><input type="radio" name="desk-audio" checked={event.audioMode === 'commentary'} disabled={!canSpeak} onChange={() => setAudio('commentary')} /> Commentary</label>
                <label><input type="radio" name="desk-audio" checked={event.audioMode === 'both'} disabled={!canSpeak} onChange={() => setAudio('both')} /> Both</label>
                <label><input type="radio" name="desk-audio" checked={event.audioMode === 'off'} onChange={() => setAudio('off')} /> Off</label>
              </div>
              <label className="desk-volume">Volume <input type="range" min="0" max="1" step="0.05" value={event.volume} onChange={(e) => setState({ volume: Number(e.target.value) })} /><output>{Math.round(event.volume * 100)}%</output></label>
              <p className="desk-label">{event.audioMode === 'off' ? 'Silent' : p.audio === 'running' ? 'Sound plays on the projector' : 'Click the game window once to enable sound'}</p>
            </section>
            <section className="desk-panel" aria-label="Display controls">
              <h2>Camera</h2>
              {event.eventMode === 'live' ? <div className="desk-camera" role="radiogroup" aria-label="Camera view">
                <label><input type="radio" name="desk-camera" checked={!p.fullCourse} onChange={() => p.onCamera(false)} /> Telecast</label>
                <label><input type="radio" name="desk-camera" checked={p.fullCourse} onChange={() => p.onCamera(true)} /> Full field</label>
              </div> : null}
              <p className="desk-display-help">Telecast rides with the leading pack; Full field shows every runner. Move the game window to the projector, then press F for fullscreen. Keep this desk on the laptop.</p>
              <p className="desk-label">{p.wakeLock ? 'Keeping the projector awake' : 'Check the laptop sleep settings before the event'}</p>
            </section>
          </div>
        </div>

        <section className="desk-order" aria-label="Live running order">
          <h2>Running order</h2>
          <ol>{rows.map((row) => <li key={row.lane}>
            <span className="desk-lane" style={{ background: laneColour(row.lane).shell }}>{deskSnails[row.lane] ?? row.lane + 1}</span>
            <span>{lineup[row.lane]}{owners[row.lane] ? <small className="desk-owner"> {owners[row.lane]}</small> : null}</span><span className="desk-gap">{row.gapText}</span>
          </li>)}</ol>
          {race.commentary ? <p className="desk-commentary">{race.commentary}</p> : null}
        </section>
      </main>
      <footer className="desk-footer">Controls stay on this screen. The race and sound play on the projector. Space, Enter or PgDn advances, PgUp goes back, A cycles the sound, S silences it, V switches the camera during a race, F is fullscreen on the projector. Shortcuts pause while Admin is open.</footer>
      {p.children}
    </div>
  );
}
