'use client';

import { useCallback } from 'react';
import { Snail } from './Snail';
import { laneColour } from '@/lib/palette';
import type { LaneNodes, RaceController } from '@/lib/use-race';

interface Props {
  names: string[];
  race: RaceController;
  clubName: string;
}

export function RaceTrack({ names, race, clubName }: Props) {
  const { registerLane, trackRef, flashRef } = race;

  /*
   * One callback ref per lane, holding the five nodes the animation loop
   * writes to. Collecting them here means the loop never queries the DOM
   * mid-frame, and React still owns creation and teardown.
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
      };
      if (nodes.field && nodes.token && nodes.trail && nodes.chip && nodes.label) {
        registerLane(index, nodes);
      }
    },
    [registerLane],
  );

  return (
    <div ref={trackRef} className="track-wrap">
      <div className="scenery" aria-hidden="true">
        <div className="bunting" />
        <div className="sun" />
        <div className="hills" />
        <div className="crowd" />
      </div>

      <div className="lanes" role="list" aria-label="Racing lanes">
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
                <div className="trail" aria-hidden="true" />
                <span className="label">
                  <span className="pos-chip num" aria-hidden="true" />
                  <span className="name-pill">{name}</span>
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
        <div className="finish-banner">
          <span>FINISH</span>
        </div>
        <div className="finish-chequer" />
      </div>

      <div ref={flashRef} className="flash" aria-hidden="true" />

      {race.countdown ? (
        <div className="countdown" aria-hidden="true">
          <span key={race.countdown}>{race.countdown}</span>
        </div>
      ) : null}

      {race.photoFinish && race.phase === 'running' ? (
        <p className="photo-banner">PHOTO FINISH</p>
      ) : null}

      <p className="absolute bottom-2 right-4 text-[10px] uppercase tracking-[0.28em] text-white/35 z-2 no-print">
        {clubName}
      </p>
    </div>
  );
}
