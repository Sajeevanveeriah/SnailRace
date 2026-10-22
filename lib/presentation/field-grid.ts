/**
 * Centring a short last row of a card grid.
 *
 * The grid has twice as many tracks as columns and every card spans two, so
 * a last row short by k cards starts k tracks in: nine cards on five columns
 * is five and then four, centred, with no hole at bottom right.
 */
export interface GridPlacement {
  /** Tracks across: twice the columns. */
  tracks: number;
  /** 1-based first track of the first card in a short last row, or null when the rows are full. */
  lastRowStart: number | null;
  /** Index of the first card in that short last row. */
  lastRowFirst: number;
}

export function gridPlacement(count: number, cols: number): GridPlacement {
  const c = Math.max(1, Math.trunc(cols));
  const n = Math.max(0, Math.trunc(count));
  const remainder = n % c;
  const short = n > c && remainder > 0;
  return {
    tracks: c * 2,
    lastRowStart: short ? c - remainder + 1 : null,
    lastRowFirst: short ? n - remainder : -1,
  };
}

/** The inline grid-column for card `index`, or undefined when it sits where the grid puts it. */
export function cardColumn(index: number, placement: GridPlacement): string | undefined {
  return placement.lastRowStart !== null && index === placement.lastRowFirst ? `${placement.lastRowStart} / span 2` : undefined;
}
