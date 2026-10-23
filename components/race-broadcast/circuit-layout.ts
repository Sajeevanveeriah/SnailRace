/**
 * The projector layout, in units of `--u` (1% of the width of the largest
 * 16:9 frame that fits). The stylesheet reads the same numbers from inline
 * custom properties, so the camera and the graphics never disagree about
 * where the course pane is.
 */
export const CIRCUIT_LAYOUT = {
  /** Course pane top: under the title bar and the commentary strap. The twist card takes over the strap while it plays. */
  sceneTop: 6.4,
  /**
   * A frame much wider than 16:9 runs short of height, not width, so the
   * commentary moves into a column of this width beside the course and the
   * pane starts under the title bar alone.
   */
  side: 26,
  sideTop: 6.4,
  gap: 0.8,
  /** The timing tower while racing, and the field board at the gate. */
  tower: 20,
  board: 40,
  /** The whole-course mini-map: under the tower, or under the commentary column in the side layout. */
  mapW: 20,
  mapH: 7.4,
  /** The result bar at the foot of the pane. */
  resultH: 15,
  /** A runner's number badge radius. */
  badge: 1.3,
  /**
   * The whole-course height, in units, that the badge and the smallest snail
   * were sized for. A bigger course scales them up with it, to `labelMax`.
   */
  labelBase: 38,
  labelMax: 1.5,
} as const;

export type CircuitLayout = 'top' | 'side';

/**
 * Which arrangement gives the course the bigger picture in a broadcast box of
 * this size: commentary under the title bar, or in a column beside the course.
 * `aspect` is the course's own width over height.
 */
export function circuitLayoutFor(width: number, height: number, aspect: number): CircuitLayout {
  const L = CIRCUIT_LAYOUT;
  const u = Math.min(width / 100, (height * 1.7778) / 100);
  if (!(u > 0) || !(aspect > 0)) return 'top';
  /* The course's height on screen, in units, with the pane starting at `left` and `top`. */
  const course = (left: number, top: number) => Math.min((width / u - left - L.tower - L.gap * 2) / aspect, height / u - top - L.gap);
  /* The commentary is a small caption over the course now, so the column beside it would only cost the course width. */
  void course;
  return 'top';
}
