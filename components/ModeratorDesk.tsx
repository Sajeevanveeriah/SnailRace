'use client';

import { useEffect, useState, type ReactNode, type RefCallback } from 'react';
import { ClubBrand } from './brand/ClubBrand';
import { laneColour } from '@/lib/palette';
import { setState } from '@/lib/event-store';
import { showPhaseSpec } from '@/lib/show';
import type { EventState } from '@/lib/types';
import type { BoardRow, RaceController } from '@/lib/use-race';

interface Props {
  event: EventState;
  race: RaceController;
  courseName: string;
  raceNo: number;
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
  marketLockAt: number | null;
  winnerOpen: boolean;
  onPrimary: () => void;
  onBack: () => void;
  onSettings: () => void;
  onReturn: () => void;
  onHold: () => void;
  onCamera: (full: boolean) => void;
  onVoid: () => void;
  onMarketTimer: () => void;
  onCancelTimer: () => void;
  onInterval: () => void;
  onDismissWinner: () => void;
  children: ReactNode;
  packControlsRef: RefCallback<HTMLDivElement>;
}

const screenNames = ['Welcome', 'Racecard', 'Market', 'Race', 'Results', 'Championship'];
const phaseIds = ['lobby', 'racecard', 'market', 'race', 'results', 'championship'];
const notes: Record<string, string> = {
  lobby: 'Welcome the room. Open the racecard when everyone is ready.',
  racecard: 'Introduce the runners and the race sponsor, then open selections.',
  market: 'Give the room time to choose. Lock selections when everyone is ready.',
  race: 'The projector runs the race and the commentary. Let the finish play out.',
  results: 'Celebrate the winner, then reveal the championship standings.',
  championship: 'Read out the leaders. Continue to the next field or take an interval.',
  intermission: 'Take a short break. Continue when the room is ready.',
  finale: 'Thank the room and sponsors. Save a backup in Settings before closing.',
};

export function ModeratorDesk(p: Props) {
  const { event, race, packControlsRef } = p;
  const [board, setBoard] = useState<BoardRow[]>([]);
  const { onBoard } = race;
  useEffect(() => onBoard(setBoard), [onBoard]);
  const recorded = event.eventMode === 'recorded';
  const recordedRace = event.racePack?.races.find((r) => r.raceId === event.packCurrent);
  const lineup = recordedRace?.runners ?? event.names.slice(0, event.fieldSize);
  const rows = race.phase === 'done' && race.results.length
    ? race.results.map((r) => ({ lane: r.lane, place: r.place, gapText: r.place === 1 ? 'Winner' : r.status === 'retired' ? 'Retired' : 'Classified' }))
    : race.phase === 'running' || race.phase === 'confirming'
      ? board
      : lineup.map((_, lane) => ({ lane, place: lane + 1, gapText: recorded ? 'Recorded runner' : 'At the gate' }));
  const title = p.holding ? 'Holding screen' : (screenNames[phaseIds.indexOf(event.showPhase)] ?? showPhaseSpec(event.showPhase).label);

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
        {screenNames.map((name, i) => <li key={name} aria-current={event.showPhase === phaseIds[i] ? 'step' : undefined}>{name}</li>)}
      </ol>

      <main className="desk-layout">
        <div className="desk-main">
          <section className="desk-program" aria-label="Projector status">
            <p className="desk-label">On the projector</p>
            <h2>{title}</h2>
            <p className="desk-race-title">Race {p.raceNo} of {event.plannedRaces} - {p.courseName}</p>
            <p className="desk-status" role="status">
              {p.holding ? 'The audience sees the holding screen. The show is held.' : event.showPhase === 'race' || event.showPhase === 'results' ? race.status : `The audience sees the ${title.toLowerCase()} screen.`}
            </p>
            {p.startError ? <p className="desk-error" role="alert">{p.startError}</p> : null}
            <div className="desk-actions">
              {!(recorded && event.showPhase === 'race') ? <button className="btn btn-go" type="button" disabled={p.primaryDisabled || p.holding} onClick={(e) => { if (e.detail < 2) p.onPrimary(); }}>{p.primaryLabel}</button> : null}
              <button className="btn btn-ghost" type="button" disabled={!p.canBack || p.holding} onClick={p.onBack}>Back</button>
              <button className="btn btn-ghost" type="button" onClick={p.onSettings}>Settings</button>
              <button className="btn btn-ghost" type="button" onClick={p.onReturn}>Return controls to projector</button>
            </div>
            <div className="desk-actions desk-secondary">
              {event.showPhase === 'market' && !p.holding ? <>
                <button type="button" className="btn btn-ghost" onClick={p.marketLockAt ? p.onCancelTimer : p.onMarketTimer}>{p.marketLockAt ? 'Cancel market timer' : 'Lock in 60s'}</button>
                {p.marketLockAt ? <MarketClock until={p.marketLockAt} /> : null}
              </> : null}
              {event.showPhase === 'championship' && !p.holding ? <button className="btn btn-ghost" type="button" onClick={p.onInterval}>Intermission</button> : null}
              {p.winnerOpen ? <button className="btn btn-ghost" type="button" onClick={p.onDismissWinner}>Dismiss winner announcement</button> : null}
              {race.phase === 'running' || race.phase === 'countdown' ? <button className="btn btn-ghost desk-void" type="button" onClick={p.onVoid}>Void race</button> : null}
            </div>
            <div className="desk-notes"><p className="desk-label">Speaker notes</p><p>{notes[event.showPhase]}</p></div>
          </section>

          <div ref={packControlsRef} className="desk-pack-tools" hidden={event.eventMode !== 'recorded' || event.showPhase !== 'race'} />
          <div className="desk-settings-strip">
            <section className="desk-panel" aria-label="Sound controls">
              <h2>Sound</h2>
              <label><input type="checkbox" checked={event.sound} onChange={(e) => setState({ sound: e.target.checked })} /> Sound on</label>
              <label><input type="checkbox" checked={event.caller} disabled={!event.sound} onChange={(e) => setState({ caller: e.target.checked })} /> Commentary</label>
              <label><input type="checkbox" checked={event.music} disabled={!event.sound} onChange={(e) => setState({ music: e.target.checked })} /> Music</label>
              <label className="desk-volume">Master volume <input type="range" min="0" max="1" step="0.05" value={event.volume} onChange={(e) => setState({ volume: Number(e.target.value) })} /><output>{Math.round(event.volume * 100)}%</output></label>
              <p className="desk-label">{!event.sound ? 'Sound muted' : p.audio === 'running' ? 'Sound plays on the projector' : 'Click the game window once to enable sound'}</p>
            </section>
            <section className="desk-panel" aria-label="Display controls">
              <h2>Display</h2>
              {event.eventMode === 'live' && event.trackShape === 'circuit' ? <div className="desk-camera" role="group" aria-label="Camera view">
                <label><input type="radio" name="desk-camera" checked={!p.fullCourse} onChange={() => p.onCamera(false)} /> Follow field</label>
                <label><input type="radio" name="desk-camera" checked={p.fullCourse} onChange={() => p.onCamera(true)} /> Full course</label>
              </div> : null}
              <label><input type="checkbox" checked={p.holding} disabled={p.locked || Boolean(p.marketLockAt)} onChange={p.onHold} /> Holding screen</label>
              <p className="desk-label">{p.locked ? 'The active race must finish or be voided before holding the show.' : 'Hold the audience screen between races.'}</p>
              <p className="desk-display-help">Move the game window to the projector, then press F for fullscreen. Keep this desk on the laptop.</p>
              <p className="desk-label">{p.wakeLock ? 'Keeping the projector awake' : 'Check the laptop sleep settings before the event'}</p>
            </section>
          </div>
        </div>

        <section className="desk-order" aria-label="Live running order">
          <h2>Running order</h2>
          <ol>{rows.map((row) => <li key={row.lane}>
            <span className="desk-lane" style={{ background: laneColour(row.lane).shell }}>{row.lane + 1}</span>
            <span>{lineup[row.lane]}</span><span className="desk-gap">{row.gapText}</span>
          </li>)}</ol>
          {race.commentary ? <p className="desk-commentary">{race.commentary}</p> : null}
        </section>
      </main>
      <footer className="desk-footer">Controls stay on this screen. The race and sound play on the projector. Space / PgDn advances; PgUp goes back. Shortcuts pause while Settings is open.</footer>
      {p.children}
    </div>
  );
}

function MarketClock({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(id); }, []);
  return <span className="desk-label">Selections lock in {Math.max(0, Math.ceil((until - now) / 1000))}s</span>;
}
