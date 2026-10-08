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
import { cardRaceNames, cardRaceOwners } from '@/lib/card';
import { quaddieIsLive } from '@/lib/quaddie';
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
  lobby: 'Welcome the room. Point at the QR: buy a snail, name it. Open the racecard when ready.',
  racecard: 'Read out the ten snails and their owners. Then send them to the gate.',
  race: 'Press Start. The projector runs the race. Let the finish play out.',
  results: 'Name the winner and the owner. Then move on.',
  championship: 'Read out who is still alive in the quaddie, then the next race.',
  finale: 'Thank the room. Save a backup in Admin before closing.',
  market: 'Send them to the gate.',
  intermission: 'Open the racecard when the room is ready.',
};

export function ModeratorDesk(p: Props) {
  const { event, race, packControlsRef } = p;
  const [board, setBoard] = useState<BoardRow[]>([]);
  const { onBoard } = race;
  useEffect(() => onBoard(setBoard), [onBoard]);
  const canSpeak = useCanSpeak();
  const recorded = event.eventMode === 'recorded';
  const recordedRace = event.racePack?.races.find((r) => r.raceId === event.packCurrent);
  const lineup = recordedRace?.runners ?? cardRaceNames(event.card, p.raceNo);
  const owners = recordedRace ? [] : cardRaceOwners(event.card, p.raceNo);
  const rows = race.phase === 'done' && race.results.length
    ? race.results.map((r) => ({ lane: r.lane, place: r.place, gapText: r.place === 1 ? 'Winner' : r.status === 'retired' ? 'Retired' : 'Classified' }))
    : race.phase === 'running' || race.phase === 'confirming'
      ? board
      : lineup.map((_, lane) => ({ lane, place: lane + 1, gapText: recorded ? 'Recorded runner' : 'At the gate' }));
  const title = p.holding ? 'Holding screen' : (sequence.find((s) => s.id === event.showPhase)?.name ?? showPhaseSpec(event.showPhase).label);
  const visibleSequence = sequence.filter((s) => s.id !== 'championship' || quaddieIsLive(event.quaddie));
  const racing = race.phase === 'running' || race.phase === 'countdown' || race.phase === 'confirming';
  const lockedRaceNo = p.locked ? p.nextRaceNo : null;
  const setAudio = (mode: AudioMode) => {
    primeAudio();
    if (mode === 'commentary') initVoice();
    setState(audioPatch(mode));
  };

  return (
    <div className="moderator-desk" data-moderator-desk="true">
      <header className="desk-header">
        <ClubBrand className="desk-brand" imageClassName="desk-crest" showName={false} />
        <div><p>NDCC / SAJ RACE NIGHT</p><h1>Moderator desk</h1></div>
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
            <p className="desk-race-title">Race {p.raceNo} of {event.plannedRaces} - snails {(p.raceNo - 1) * 10 + 1} to {p.raceNo * 10} - {p.courseName}</p>
            <p className="desk-status" role="status">
              {p.holding ? 'The audience sees the holding screen. The show is held.' : event.showPhase === 'race' || event.showPhase === 'results' ? race.status : `The audience sees the ${title.toLowerCase()} screen.`}
            </p>
            {p.startError ? <p className="desk-error" role="alert">{p.startError}</p> : null}
            <div className="desk-actions">
              {!(recorded && event.showPhase === 'race') ? <button className="btn btn-go" type="button" disabled={p.primaryDisabled || p.holding} onClick={(e) => { if (e.detail < 2) p.onPrimary(); }}>{p.primaryLabel}</button> : null}
              <button className="btn btn-ghost" type="button" disabled={!p.canBack || p.holding} onClick={p.onBack}>Back</button>
              {racing ? <button className="btn btn-ghost desk-void" type="button" onClick={p.onVoid}>Void race</button> : null}
              {p.winnerOpen ? <button className="btn btn-ghost" type="button" onClick={p.onDismissWinner}>Dismiss winner card</button> : null}
            </div>
            <div className="desk-actions desk-secondary">
              <label><input type="checkbox" checked={p.holding} disabled={p.locked} onChange={p.onHold} /> Holding screen</label>
              <button className="btn btn-ghost" type="button" onClick={p.onSettings}>Admin</button>
              <button className="btn btn-ghost" type="button" onClick={p.onReturn}>Return controls to projector</button>
            </div>
            <div className="desk-notes"><p className="desk-label">Speaker notes</p><p>{notes[event.showPhase]}</p></div>
          </section>

          <div ref={packControlsRef} className="desk-pack-tools" hidden={event.eventMode !== 'recorded' || event.showPhase !== 'race'} />

          <section className="desk-panel desk-roster" aria-label="Roster">
            <h2>Roster <span className="num desk-label">race {p.nextRaceNo}</span></h2>
            <RosterPanel card={event.card} raceNo={p.nextRaceNo} lockedRaceNo={lockedRaceNo} compact />
          </section>

          {quaddieIsLive(event.quaddie) ? <QuaddieDesk event={event} racing={p.locked} nextRaceNo={p.nextRaceNo} /> : null}

          {toteIsLive(event.cashTote) && ['lobby', 'racecard'].includes(event.showPhase) ? (
            <section className="desk-panel desk-tote" aria-label="Cash tote tally">
              <h2>Cash tote</h2>
              <ToteTally raceNo={p.nextRaceNo} locked={p.locked} compact />
              {isAuctionRace(event.cashTote, p.nextRaceNo, event.plannedRaces) ? <AuctionDesk raceNo={p.nextRaceNo} locked={p.locked} /> : null}
            </section>
          ) : null}

          <div className="desk-settings-strip">
            <section className="desk-panel" aria-label="Sound controls">
              <h2>Audio</h2>
              <div className="desk-camera" role="radiogroup" aria-label="Audio mode">
                <label><input type="radio" name="desk-audio" checked={event.audioMode === 'music'} onChange={() => setAudio('music')} /> Music</label>
                <label><input type="radio" name="desk-audio" checked={event.audioMode === 'commentary'} disabled={!canSpeak} onChange={() => setAudio('commentary')} /> Commentary</label>
                <label><input type="radio" name="desk-audio" checked={event.audioMode === 'off'} onChange={() => setAudio('off')} /> Off</label>
              </div>
              <label className="desk-volume">Volume <input type="range" min="0" max="1" step="0.05" value={event.volume} onChange={(e) => setState({ volume: Number(e.target.value) })} /><output>{Math.round(event.volume * 100)}%</output></label>
              <p className="desk-label">{event.audioMode === 'off' ? 'Silent' : p.audio === 'running' ? 'Sound plays on the projector' : 'Click the game window once to enable sound'}</p>
            </section>
            <section className="desk-panel" aria-label="Display controls">
              <h2>Camera</h2>
              {event.eventMode === 'live' && event.trackShape === 'circuit' ? <div className="desk-camera" role="radiogroup" aria-label="Camera view">
                <label><input type="radio" name="desk-camera" checked={!p.fullCourse} onChange={() => { p.onCamera(false); setState({ cameraMode: 'telecast' }); }} /> Telecast (lead pack)</label>
                <label><input type="radio" name="desk-camera" checked={p.fullCourse} onChange={() => { p.onCamera(true); setState({ cameraMode: 'full' }); }} /> Full course</label>
              </div> : null}
              <p className="desk-display-help">Move the game window to the projector, then press F for fullscreen. Keep this desk on the laptop.</p>
              <p className="desk-label">{p.wakeLock ? 'Keeping the projector awake' : 'Check the laptop sleep settings before the event'}</p>
            </section>
          </div>
        </div>

        <section className="desk-order" aria-label="Live running order">
          <h2>Running order</h2>
          <ol>{rows.map((row) => <li key={row.lane}>
            <span className="desk-lane" style={{ background: laneColour(row.lane).shell }}>{(p.raceNo - 1) * 10 + row.lane + 1}</span>
            <span>{lineup[row.lane]}{owners[row.lane] ? <small className="desk-owner"> {owners[row.lane]}</small> : null}</span><span className="desk-gap">{row.gapText}</span>
          </li>)}</ol>
          {race.commentary ? <p className="desk-commentary">{race.commentary}</p> : null}
        </section>
      </main>
      <footer className="desk-footer">Controls stay on this screen. The race and sound play on the projector. Space / PgDn advances; PgUp goes back. Shortcuts pause while Admin is open.</footer>
      {p.children}
    </div>
  );
}
