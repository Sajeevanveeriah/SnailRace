'use client';

import { useCallback, useMemo } from 'react';
import { Snail } from './Snail';
import { laneColour, type StageThemeId } from '@/lib/palette';
import type { RaceEvent } from '@/lib/race-engine';
import type { LaneNodes, RaceController } from '@/lib/use-race';

interface Props {
  names: string[];
  race: RaceController;
  surface: StageThemeId;
}

/** Marker glyphs. The shape says "help" or "trouble" before the colour does. */
const PAD_MARK: Record<string, string> = {
  boost: '»',
  surge: '»',
  stumble: '!',
  nap: 'z',
  wander: '?',
};

export function RaceTrack({ names, race, surface }: Props) {
  const { registerLane, trackRef, flashRef } = race;

  /*
   * The pads are drawn per lane, so group once rather than filtering the whole
   * list inside every lane's render.
   */
  const padsByLane = useMemo(() => {
    const map = new Map<number, RaceEvent[]>();
    for (const e of race.events) {
      const list = map.get(e.lane);
      if (list) list.push(e);
      else map.set(e.lane, [e]);
    }
    return map;
  }, [race.events]);

  /*
   * One callback ref per lane, holding the nodes the animation loop writes
   * to. Collecting them here means the loop never queries the DOM mid-frame,
   * and React still owns creation and teardown.
   */
  const laneRef = useCallback(
    (index: number) => (root: HTMLDivElement | null) => {
      if (!root) {
        registerLane(index, null);
        return;
      }
      const nodes: LaneNodes = {
        root,
        field: root.querySelector('.field') as HTMLElement,
        token: root.querySelector('.token') as HTMLElement,
        trail: root.querySelector('.trail') as HTMLElement,
        chip: root.querySelector('.pos-chip') as HTMLElement,
        label: root.querySelector('.label') as HTMLElement,
        fx: root.querySelector('.fx-pill') as HTMLElement,
      };
      if (
        nodes.field && nodes.token && nodes.trail && nodes.chip && nodes.label && nodes.fx
      ) {
        registerLane(index, nodes);
      }
    },
    [registerLane],
  );

  return (
    <div ref={trackRef} className="track-wrap" data-surface={surface}>
      <div
        className="lanes"
        role="list"
        aria-label="Racing lanes"
        style={{ '--n': names.length } as React.CSSProperties}
      >
        {names.map((name, i) => {
          const c = laneColour(i);
          return (
            <div
              key={`${i}-${name}`}
              ref={laneRef(i)}
              className="lane"
              role="listitem"
              aria-label={`Lane ${i + 1}, ${name}`}
              style={
                {
                  '--shell': c.shell,
                  '--shell-dk': c.dark,
                  '--body': c.body,
                  '--glow': c.glow,
                } as React.CSSProperties
              }
            >
              <div className="rail">
                <span className="lane-badge num">{i + 1}</span>
              </div>
              <div className="field">
                <div className="gate" aria-hidden="true" />
                <div className="ticks" aria-hidden="true">
                  <i style={{ '--at': 0.25 } as React.CSSProperties} />
                  <i style={{ '--at': 0.5 } as React.CSSProperties} />
                  <i style={{ '--at': 0.75 } as React.CSSProperties} />
                </div>
                <div className="pads" aria-hidden="true">
                  {(padsByLane.get(i) ?? []).map((e) => (
                    <i
                      key={e.id}
                      className={`pad pad-${e.tone}`}
                      style={
                        { '--at': e.at, '--span': e.span } as React.CSSProperties
                      }
                    >
                      <b>{PAD_MARK[e.kind] ?? '*'}</b>
                    </i>
                  ))}
                </div>
                <div className="trail" aria-hidden="true" />
                <span className="label">
                  <span className="pos-chip num" aria-hidden="true" />
                  <span className="name-pill">{name}</span>
                  <span className="fx-pill" aria-hidden="true" />
                </span>
                <div className="token">
                  <Snail />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="finish" aria-hidden="true">
        <div className="finish-chequer" />
        <div className="finish-banner">FINISH</div>
      </div>

      <div ref={flashRef} className="flash" aria-hidden="true" />

      {race.phase === 'running' ? (
        <div className="race-progress" aria-hidden="true">
          <i />
        </div>
      ) : null}

      {race.countdown ? (
        <div className="countdown" aria-hidden="true">
          <span key={race.countdown}>{race.countdown}</span>
        </div>
      ) : null}

      {/*
        Surprises are announced twice over: here for the room at the back, and
        in the commentary rail, which is also what a screen reader follows.
      */}
      {race.moment && race.phase === 'running' ? (
        <p key={race.moment.id} className={`moment moment-${race.moment.tone}`} aria-hidden="true">
          {race.moment.text}
        </p>
      ) : null}

      {race.photoFinish && race.phase === 'running' ? (
        <p className="photo-banner">PHOTO FINISH</p>
      ) : null}
    </div>
  );
}
