import type { RaceResult } from './types';

/**
 * The telecast.
 *
 * A race on television is shot from the side, from a camera that runs along
 * the track with the field. That single decision is what makes athletics
 * legible: the lanes are parallel bars across the screen, every runner sits in
 * one of them for the whole race, and the ground streaming past behind them is
 * what tells you how fast they are going.
 *
 * The top-down course this replaces had none of that. Seen from above, a snail
 * on the far bend is upside down, lanes cross the screen at every angle, and a
 * tight shot frames two runners and a lot of empty dirt. From the side there is
 * no bend to be on, nothing to be upside down, and the camera only ever has one
 * axis to worry about.
 *
 * Nothing here can affect the result. The engine still hands out one number per
 * snail, `p` from 0 at the gate to 1 at the line, and this module only decides
 * where on the screen that number lands. The fairness argument in
 * `race-engine.ts` is untouched.
 */

/* ── The frame ─────────────────────────────────────────────────────────── */

/** The screen, in the units everything below is authored in. 16:9. */
export const VIEW_W = 1600;
export const VIEW_H = 900;

/**
 * How far past the authored frame the ground, the sky and the lanes are drawn.
 *
 * A projector is not 16:9 and neither is a laptop. Rather than crop the frame
 * to fit - which is what put the outside lanes off the bottom of the picture -
 * the visible window is fitted to whatever shape the screen is, and on a very
 * wide one that window is wider than the frame was authored. The bleed is what
 * it finds out there: more track, more stand, more grass.
 */
export const BLEED = 900;

/**
 * The shortest window that still shows the whole track with room for the
 * graphics above and below it. Anchored to the bottom of the frame, so what a
 * letterbox screen loses is sky.
 */
export const FLOOR_H = 596;

/** The far side of the stadium: sky and stand above, track below. */
export const HORIZON = 296;
/** Advertising hoardings run along the far side of the track. */
export const HOARD_TOP = HORIZON;
export const HOARD_H = 72;
/** Grass between the hoardings and the outside lane. */
export const VERGE_TOP = HOARD_TOP + HOARD_H;
export const TRACK_TOP = VERGE_TOP + 36;
/*
 * The near kerb stops well short of the bottom of frame. The strap and the
 * running order live down there, and a lane the graphics sit on top of is a
 * lane nobody can follow.
 */
export const TRACK_BOTTOM = 782;
export const TRACK_H = TRACK_BOTTOM - TRACK_TOP;

/**
 * How long one lap is, in world units.
 *
 * World units are arbitrary - they only have to be consistent with the zoom
 * range below - but they are sized so that the painted metre marks land on
 * round numbers a caller could read out.
 */
export const LAP_LEN = 4000;
/** Distance between painted cross-marks on the surface. */
export const MARK_EVERY = 100;

/** Roughly how tall a snail is drawn at scale 1, ground to eye stalk. */
export const SNAIL_H = 84;

/* ── Lanes ─────────────────────────────────────────────────────────────── */

export interface LaneBand {
  lane: number;
  /** 0 for the lane nearest the camera, 1 for the far side of the track. */
  depth: number;
  /** Centre of the lane, in screen units. */
  y: number;
  /** Height of the painted band. */
  h: number;
  /** How big a snail in this lane is drawn. */
  scale: number;
}

/** The far side of the track is further away, so it is thinner and smaller. */
const DEPTH_SQUASH = 0.45;
const DEPTH_SHRINK = 0.34;
/**
 * A snail may stand taller than its own lane. Runners are drawn back to front,
 * so a near one overlapping the lane behind it reads as depth rather than as a
 * mistake - and at twenty lanes, a snail confined to its band would be a speck.
 */
const OVERLAP = 0.95;
const MAX_SCALE = 1.2;

/**
 * Lay out the lanes.
 *
 * Lane 0 is nearest the camera and sits at the bottom of the screen, which is
 * where lane 1 is in every athletics broadcast. Band heights taper towards the
 * far side so the track reads as a surface receding away rather than as a bar
 * chart, and the whole set is normalised to fill the track area exactly at any
 * field size - three snails or twenty, the track is the same width of screen.
 */
export function laneBands(fieldSize: number): LaneBand[] {
  const n = Math.max(1, fieldSize);
  const depth = (i: number) => (n === 1 ? 0 : i / (n - 1));

  let total = 0;
  for (let i = 0; i < n; i++) total += 1 - DEPTH_SQUASH * depth(i);
  const unit = TRACK_H / total;

  const bands: LaneBand[] = [];
  let edge = TRACK_BOTTOM; // built from the near side upwards
  for (let i = 0; i < n; i++) {
    const d = depth(i);
    const h = unit * (1 - DEPTH_SQUASH * d);
    const y = edge - h / 2;
    edge -= h;
    bands.push({
      lane: i,
      depth: d,
      y,
      h,
      scale: Math.min(MAX_SCALE, ((h * OVERLAP) / SNAIL_H) * (1 - DEPTH_SHRINK * d)),
    });
  }
  return bands;
}

/* ── The camera ────────────────────────────────────────────────────────── */

export type ShotId = 'field' | 'leaders' | 'low' | 'finish';

export const SHOT_LABEL: Record<ShotId, string> = {
  field: 'TRACKING',
  leaders: 'LEAD GROUP',
  low: 'LOW ANGLE',
  finish: 'FINISH LINE',
};

export interface BroadcastInput {
  /** Race time in milliseconds. */
  tMs: number;
  /** World position of every runner, leader first. */
  worldByPosition: number[];
  /** Where the line is, in world units. */
  finishWorld: number;
  leadP: number;
  finalStraight: boolean;
  photoFinish: boolean;
  /** Unobscured horizontal window in authored SVG units. */
  safeLeft?: number;
  safeRight?: number;
}

export interface Framing {
  /** World position at the centre of the frame. */
  camX: number;
  /** Screen units per world unit. */
  zoom: number;
  shot: ShotId;
  label: string;
  safeLeft: number;
  safeRight: number;
}

/** Wide enough for a twenty-runner finish on a portrait phone if required. */
const ZOOM_MIN = 0.025;
const ZOOM_MAX = 0.62;
/** Elbow room either side of the runners, in world units. */
const PAD_WORLD = 260;

export interface RunnerSafeFrame {
  left: number;
  right: number;
}

/**
 * Reserve the right-hand graphics area and a sprite-width at both edges.
 * The values are derived from the actual SVG viewBox, so ultra-wide and
 * portrait screens protect the same visible part of the picture.
 */
export function runnerSafeFrame(viewX: number, viewWidth: number): RunnerSafeFrame {
  const width = Math.max(1, viewWidth);
  const inset = Math.min(90, width * 0.08);
  const graphicsShare = width < 650 ? 0.52 : width < 1100 ? 0.42 : 0.26;
  const left = viewX + inset;
  const right = Math.max(left + 100, viewX + width * (1 - graphicsShare) - inset);
  return { left, right };
}

/** Keep an eased pan inside a frame that the selected zoom can contain. */
export function clampCameraX(
  camX: number,
  zoom: number,
  worldByPosition: number[],
  safe: RunnerSafeFrame,
): number {
  if (!worldByPosition.length || !Number.isFinite(zoom) || zoom <= 0) return camX;
  let lo = Infinity;
  let hi = -Infinity;
  for (const world of worldByPosition) {
    lo = Math.min(lo, world);
    hi = Math.max(hi, world);
  }
  const minCam = hi + (VIEW_W / 2 - safe.right) / zoom;
  const maxCam = lo + (VIEW_W / 2 - safe.left) / zoom;
  return minCam <= maxCam ? Math.min(maxCam, Math.max(minCam, camX)) : camX;
}

/** How long each shot runs before the director looks for another, in ms. */
const HOLD: Record<ShotId, number> = {
  field: 9000,
  leaders: 7000,
  low: 6500,
  finish: Infinity,
};

/**
 * Where to point the camera.
 *
 * Deliberately dull. A race director cutting every two seconds between tight
 * shots is a director nobody can follow, and the version of this that did that
 * was the single loudest complaint about the old view. So: three framings, all
 * of which contain the runners the room has money on, each held for the better
 * part of ten seconds, and every change eased rather than cut. The only hard
 * commitment is the finish, which the camera takes and keeps.
 */
export class Broadcaster {
  private shot: ShotId = 'field';
  private shotAt = 0;
  private turn = 0;
  /**
   * The zoom is HELD, not tracked.
   *
   * Re-deriving it every frame from the field's spread meant the picture
   * breathed in and out for the whole race - the pack bunches, the lens
   * creeps in; it strings out, the lens creeps back - and from the room that
   * reads as the screen compressing and expanding continuously. A real camera
   * operator sets a focal length and leaves it there until there is a reason.
   * So this only re-zooms at a change of shot, or when the field is genuinely
   * about to run out of the frame.
   */
  private zoom = 0.42;

  reset() {
    this.shot = 'field';
    this.shotAt = 0;
    this.turn = 0;
    this.zoom = 0.42;
  }

  get current(): ShotId {
    return this.shot;
  }

  update(input: BroadcastInput): Framing {
    const held = input.tMs - this.shotAt;
    let changed = false;

    if (input.finalStraight || input.photoFinish) {
      if (this.shot !== 'finish') changed = true;
      this.shot = 'finish';
    } else if (input.tMs < 3000) {
      this.shot = 'field';
    } else if (held > HOLD[this.shot]) {
      /* A fixed rotation, not a dice roll. Coverage that alternates between a
         wide and a lead-group shot is what a viewer can follow; coverage that
         picks at random is what feels like a fault. */
      this.turn += 1;
      this.shot = this.turn % 3 === 1 ? 'leaders' : this.turn % 3 === 2 ? 'low' : 'field';
      this.shotAt = input.tMs;
      changed = true;
    }

    const all = input.worldByPosition;
    const safeLeft = Number.isFinite(input.safeLeft) ? input.safeLeft! : 100;
    const safeRight = Number.isFinite(input.safeRight) ? input.safeRight! : 1100;
    const safeWidth = Math.max(100, safeRight - safeLeft);
    if (!all.length) {
      return {
        camX: 0,
        zoom: this.zoom,
        shot: this.shot,
        label: SHOT_LABEL[this.shot],
        safeLeft,
        safeRight,
      };
    }

    /*
     * Which runners the shot is obliged to contain.
     *
     * Every shot contains every runner. A leader shot may still change the
     * lens and label, but never at the cost of a club member's snail leaving
     * the visible picture or disappearing behind the running-order panel.
     */
    const group = this.shot === 'finish' ? [...all, input.finishWorld] : all;
    let lo = Infinity;
    let hi = -Infinity;
    for (const w of group) {
      if (w < lo) lo = w;
      if (w > hi) hi = w;
    }

    const span = hi - lo + PAD_WORLD * 2;

    /*
     * Re-zoom on a cut, or when what is in frame no longer fits - never
     * merely because the numbers drifted. The generous hysteresis is the
     * whole point: between these two bounds the lens does not move at all.
     */
    const onScreen = span * this.zoom;
    const mustWiden = onScreen > safeWidth;
    const wastingFrame = onScreen < safeWidth * 0.4 && held > 7000;

    /*
     * The finish camera is locked the moment it is taken. Nothing that happens
     * in the last ten seconds is a good enough reason to move the lens, and a
     * zoom over the line is the one move that would actually cost the room the
     * result.
     */
    const locked = this.shot === 'finish' && !changed;
    if (!locked && (changed || mustWiden || wastingFrame || input.tMs < 3000)) {
      let want = safeWidth / span;
      /* Quantised, so a re-zoom is a deliberate step rather than a nudge that
         will need another nudge two seconds later. */
      want = Math.round(want / 0.03) * 0.03;
      this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, want));
    }

    /* A held lens is allowed to stay wide, never too tight. This immediate
       cap is the invariant that prevents a trailing runner leaving frame. */
    this.zoom = Math.min(this.zoom, safeWidth / span);

    /*
     * Sit the field slightly left of centre so there is track ahead of the
     * leader. A camera centred on the runners frames as much of where they
     * have been as where they are going, which reads as a lens pointed
     * backwards.
     */
    const middle = (lo + hi) / 2;
    const safeCentre = (safeLeft + safeRight) / 2;
    const camX = middle + (VIEW_W / 2 - safeCentre) / this.zoom;

    return {
      camX,
      zoom: this.zoom,
      shot: this.shot,
      label: SHOT_LABEL[this.shot],
      safeLeft,
      safeRight,
    };
  }
}

/* ── Formatting ────────────────────────────────────────────────────────── */

/** A race clock the way a broadcast prints one: 1:04.3 */
export function clockText(ms: number): string {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const d = Math.floor((t % 1000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}

/** Final classification is not a fabricated crossing time or a retirement. */
export function resultGapText(result: RaceResult): string {
  if (result.status === 'retired') return 'RET';
  if (result.finishMs != null) return `${(result.finishMs / 1000).toFixed(1)}s`;
  return 'CLASSIFIED';
}

/** Position around the current lap, with the final finish kept at the line. */
export function lapProgress(progress: number, laps: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return p === 1 ? 1 : (p * Math.max(1, laps)) % 1;
}
