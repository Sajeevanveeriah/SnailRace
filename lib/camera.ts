import { mulberry32 } from './race-engine';
import { COURSE_H, COURSE_W } from './course';

/**
 * The television director.
 *
 * A fixed frame makes a two-minute race feel like a spreadsheet, and a camera
 * welded to the leader loses the snail the room actually has money on. So this
 * cuts between shots the way a race broadcast does: establish wide, sit on the
 * pack, drop into a battle when two are close, cut to whoever something just
 * happened to, and end locked on the line.
 *
 * Two rules keep it from being motion sickness:
 *
 *   1. A shot is held for a minimum time. Real coverage cuts every few
 *      seconds, not every few frames, and a director that re-chose every
 *      frame would strobe between two equally good options.
 *   2. Only a genuine event can break that hold - a surprise landing, the
 *      lead changing, the run home starting. That is what makes a cut read as
 *      "something happened" rather than as a camera fidgeting.
 *
 * It is deterministic: the shot sequence is drawn from the race seed, so a
 * replayed race is shot the same way. Nothing here can touch the result -
 * this module only decides where to point.
 */

export type ShotId = 'wide' | 'pack' | 'leader' | 'battle' | 'reaction' | 'finish';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DirectorInput {
  /** Race time in milliseconds. */
  tMs: number;
  /** Course-space position of every runner, by lane. */
  points: Map<number, { x: number; y: number }>;
  /** Lane of the current leader. */
  leadLane: number;
  /** Lane of the snail in second, for the battle shot. */
  chaseLane: number;
  /** The leader's progress, 0 to 1. */
  leadP: number;
  finalStraight: boolean;
  photoFinish: boolean;
  /** Where the finish line sits in course space. */
  finishAt: { x: number; y: number } | null;
  /**
   * Narrowest a shot may be. A twenty-lane field is wider than a close-up,
   * and a tight shot that cannot contain the field frames empty track.
   */
  minWidth: number;
  /** Set for one frame when something worth cutting to happened. */
  cutTo?: number | null;
}

export interface Framing {
  rect: Rect;
  shot: ShotId;
  label: string;
  /** True on the frame the shot changed, so the view can flash the cut. */
  cut: boolean;
}

const ASPECT = COURSE_W / COURSE_H;

/** Half-width of each shot in course units. Smaller is tighter. */
const SHOT_WIDTH: Record<ShotId, number> = {
  wide: COURSE_W,
  pack: 0, // computed from the field's spread
  leader: 520,
  battle: 460,
  reaction: 430,
  finish: 540,
};

const SHOT_LABEL: Record<ShotId, string> = {
  wide: 'WIDE',
  pack: 'PACK',
  leader: 'LEADER',
  battle: 'BATTLE',
  reaction: 'REACTION',
  finish: 'FINISH LINE',
};

/** How long each shot must hold before the director may cut away, in ms. */
const MIN_HOLD: Record<ShotId, number> = {
  wide: 2600,
  pack: 4200,
  leader: 3400,
  battle: 3600,
  reaction: 2200,
  finish: 3000,
};

export class CameraDirector {
  private rnd: () => number;
  private shot: ShotId = 'wide';
  private shotAt = 0;
  private focus: number | null = null;
  private lastCut = false;

  constructor(seed: number) {
    this.rnd = mulberry32(seed >>> 0);
  }

  reset(seed?: number) {
    if (seed !== undefined) this.rnd = mulberry32(seed >>> 0);
    this.shot = 'wide';
    this.shotAt = 0;
    this.focus = null;
    this.lastCut = false;
  }

  get current(): ShotId {
    return this.shot;
  }

  private cut(to: ShotId, at: number, focus: number | null = null) {
    this.shot = to;
    this.shotAt = at;
    this.focus = focus;
    this.lastCut = true;
  }

  /**
   * Choose the shot for this frame and return the rectangle to frame.
   *
   * Order matters: the forced cuts are checked before the timed ones, so a
   * surprise landing always wins over "this shot has run long enough".
   */
  update(input: DirectorInput): Framing {
    this.lastCut = false;
    const held = input.tMs - this.shotAt;

    /* The run home and the photo finish own the camera outright. */
    if ((input.finalStraight || input.photoFinish) && this.shot !== 'finish') {
      this.cut('finish', input.tMs, input.leadLane);
    } else if (input.cutTo != null && this.shot !== 'finish' && held > 900) {
      /* Something happened to a named snail. Cut to it, briefly. */
      this.cut('reaction', input.tMs, input.cutTo);
    } else if (held > MIN_HOLD[this.shot] && this.shot !== 'finish') {
      this.cut(this.pick(input), input.tMs, null);
    }

    /* An establishing wide for the first couple of seconds, always. */
    if (input.tMs < 1800 && this.shot !== 'finish') {
      this.shot = 'wide';
    }

    return {
      rect: this.frame(input),
      shot: this.shot,
      label: SHOT_LABEL[this.shot],
      cut: this.lastCut,
    };
  }

  /**
   * Weighted choice of the next shot, never repeating the current one.
   *
   * The weights are the editorial opinion: most of a race should be shot on
   * the pack, because that is the shot that shows a punter where their snail
   * is. The tight shots are seasoning.
   */
  private pick(input: DirectorInput): ShotId {
    const tight = this.gap(input);
    const options: [ShotId, number][] = [
      ['pack', 5],
      ['leader', 2],
      ['wide', input.leadP > 0.5 ? 1 : 2],
      /* Only offer a battle when there actually is one. */
      ['battle', tight < 90 ? 4 : 0],
    ];

    const pool = options.filter(([id, w]) => w > 0 && id !== this.shot);
    const total = pool.reduce((sum, [, w]) => sum + w, 0);
    if (!total) return 'pack';

    let roll = this.rnd() * total;
    for (const [id, w] of pool) {
      roll -= w;
      if (roll <= 0) return id;
    }
    return pool[pool.length - 1][0];
  }

  /** Distance in course units between the leader and the snail behind it. */
  private gap(input: DirectorInput): number {
    const a = input.points.get(input.leadLane);
    const b = input.points.get(input.chaseLane);
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity;
  }

  /** The rectangle for the current shot. */
  private frame(input: DirectorInput): Rect {
    const pts = [...input.points.values()];
    if (!pts.length) return { x: 0, y: 0, w: COURSE_W, h: COURSE_H };
    const floor = Math.max(300, input.minWidth);

    if (this.shot === 'wide') return { x: 0, y: 0, w: COURSE_W, h: COURSE_H };

    if (this.shot === 'pack') {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const pad = 150;
      return fit(
        (minX + maxX) / 2,
        (minY + maxY) / 2,
        Math.max(floor, Math.max(maxX - minX, maxY - minY) + pad * 2),
      );
    }

    if (this.shot === 'battle') {
      const a = input.points.get(input.leadLane);
      const b = input.points.get(input.chaseLane);
      if (a && b) {
        const span = Math.hypot(a.x - b.x, a.y - b.y) + 280;
        return fit((a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(floor, SHOT_WIDTH.battle, span));
      }
    }

    if (this.shot === 'finish' && input.finishAt) {
      /*
       * Bias the frame back down the track from the line, so the field is
       * seen arriving rather than the camera staring at empty chequers.
       */
      const lead = input.points.get(input.leadLane);
      const cx = lead ? (lead.x + input.finishAt.x * 2) / 3 : input.finishAt.x;
      const cy = lead ? (lead.y + input.finishAt.y * 2) / 3 : input.finishAt.y;
      return fit(cx, cy, Math.max(floor, SHOT_WIDTH.finish));
    }

    const target =
      (this.focus != null ? input.points.get(this.focus) : null) ??
      input.points.get(input.leadLane) ??
      pts[0];
    return fit(target.x, target.y, Math.max(floor, SHOT_WIDTH[this.shot] || SHOT_WIDTH.leader));
  }
}

/**
 * A rectangle of the given width about a centre, in the course's aspect ratio
 * and never larger than the course itself.
 */
function fit(cx: number, cy: number, width: number): Rect {
  const w = Math.min(COURSE_W, Math.max(300, width));
  const h = w / ASPECT;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
