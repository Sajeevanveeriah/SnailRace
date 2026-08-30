import { laneColour } from '@/lib/palette';
import { runnerArtForLane } from '@/lib/presentation/runner-art';

/** Projector-sized field card. The racecard below remains the factual layer. */
export function RunnerLineup({ names }: { names: string[] }) {
  const field = names.slice(0, 8);

  return (
    <ol className="show-runner-grid" aria-label={`${field.length} runner field`}>
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
            <span className="show-runner-number num">{lane + 1}</span>
            <span
              className="show-runner-art"
              style={{ backgroundImage: `url(${runnerArtForLane(lane).src})` }}
              aria-hidden="true"
            />
            <span className="show-runner-name">{name}</span>
          </li>
        );
      })}
    </ol>
  );
}
