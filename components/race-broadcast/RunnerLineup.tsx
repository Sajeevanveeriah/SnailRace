import { laneColour } from '@/lib/palette';
import { runnerArtForLane, runnerHueRotation } from '@/lib/presentation/runner-art';

/** Projector-sized field card. The racecard below remains the factual layer. */
export function RunnerLineup({ names, numberOffset = 0, dense = false }: { names: string[]; /** Added to the lane number: snail 21 is lane 1 of race 3. */ numberOffset?: number; dense?: boolean }) {
  const field = names;

  return (
    <ol className={`show-runner-grid ${field.length > 12 || dense ? 'show-runner-grid-dense' : ''}`} aria-label={`${field.length} runner field`}>
      {field.map((name, lane) => {
        const colour = laneColour(lane);
        return (
          <li
            key={`${lane}-${name}`}
            className="show-runner-card"
            style={
              {
                '--shell': colour.shell,
                '--shell-dk': colour.dark,
              } as React.CSSProperties
            }
          >
            <span className="show-runner-number num">{numberOffset + lane + 1}</span>
            <span
              className="show-runner-art"
              style={{
                backgroundImage: `url(${runnerArtForLane(lane).src})`,
                filter: `hue-rotate(${runnerHueRotation(lane)}deg)`,
              }}
              aria-hidden="true"
            />
            <span className="show-runner-name">{name}</span>
          </li>
        );
      })}
    </ol>
  );
}
