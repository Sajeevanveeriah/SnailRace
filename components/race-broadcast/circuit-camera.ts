/**
 * The circuit director: where the camera looks, and how it gets there.
 *
 * Pure framing (`targetShot`) decides the shot for each kind of moment: the
 * whole course at the gate, the leader and the next two or three runners in
 * running, the finish line for the run home, and the line and the winner
 * for the finish hold. `CameraRig` turns that stream of targets into a calm
 * picture: eased pans, a rate-limited zoom that only tightens when the new
 * shot has been wanted for a while (so it never pumps), eased push-ins on
 * every change of shot, and the leader held clear of the frame edge.
 *
 * Shots are in course units: `cx, cy` is the course point at the centre of
 * the viewport and `z` is screen pixels per course unit.
 */

export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** A rectangle on screen, in pixels, relative to the course pane. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Shot {
  cx: number;
  cy: number;
  z: number;
}

export type ShotKind = 'gate' | 'pack' | 'full' | 'finish' | 'hold';

export function boxOf(points: readonly Pt[]): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

export const grow = (b: Box, pad: number): Box => ({ x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad });

/** The widest course span (in units) a box needs at the viewport's shape. */
export function spanFor(b: Box, vp: Rect): number {
  const aspect = vp.w / Math.max(1, vp.h);
  return Math.max(b.x1 - b.x0, (b.y1 - b.y0) * aspect);
}

/** Hold the whole box, centred, in the viewport. */
export function fitBox(b: Box, vp: Rect, minSpan = 0): Shot {
  const span = Math.max(minSpan, spanFor(b, vp), 1);
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, z: vp.w / span };
}

export function toScreen(p: Pt, shot: Shot, vp: Rect): Pt {
  return { x: vp.x + vp.w / 2 + (p.x - shot.cx) * shot.z, y: vp.y + vp.h / 2 + (p.y - shot.cy) * shot.z };
}

export interface PackInput {
  vp: Rect;
  /** The leader's feet and heading in degrees. */
  leader: Pt & { angle: number };
  /** The rest of the leading group, in running order. */
  chasers: readonly Pt[];
  /** The twist's target snail and its prop, while a twist is on air. */
  twist?: readonly Pt[];
  /** Tightest and widest shots allowed, in course units across. */
  minSpan: number;
  maxSpan: number;
  /** How far ahead of the leader the shot leaves room, in course units. */
  lookAhead?: number;
  pad?: number;
}

/**
 * The lead-pack shot: the leader with room to run into, plus as many of
 * the next runners as fit a tight frame. Never wider than `maxSpan`, so on a
 * short lap the camera stays with the front of the race instead of pulling
 * out to the whole course. A twist on air is always framed: with the
 * leader when they fit together, on its own when they do not.
 */
export function packShot(input: PackInput): Shot {
  const { vp, leader, minSpan, maxSpan } = input;
  const pad = input.pad ?? 60;
  const look = input.lookAhead ?? 90;
  const rad = (leader.angle * Math.PI) / 180;
  const ahead = { x: leader.x + Math.cos(rad) * look, y: leader.y + Math.sin(rad) * look };
  const fits = (pts: readonly Pt[]) => spanFor(grow(boxOf(pts), pad), vp) <= maxSpan;
  let core: Pt[] = [leader, ahead];
  if (input.twist?.length) {
    const together = [...core, ...input.twist];
    core = fits(together) ? together : [...input.twist];
  }
  for (const p of input.chasers) {
    const next = [...core, p];
    if (fits(next)) core = next;
  }
  return fitBox(grow(boxOf(core), pad), vp, minSpan);
}

/** The run home: the finish line, the leader and whoever else fits. */
export function finishShot(vp: Rect, line: readonly Pt[], runners: readonly Pt[], minSpan: number, maxSpan: number, pad = 56): Shot {
  let core: Pt[] = [...line];
  for (const p of runners) {
    const next = [...core, p];
    if (spanFor(grow(boxOf(next), pad), vp) <= maxSpan || core.length === line.length) core = next;
  }
  return fitBox(grow(boxOf(core), pad), vp, minSpan);
}

const smootherstep = (k: number) => {
  const t = Math.max(0, Math.min(1, k));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** How long the camera takes to move between kinds of shot, in ms. */
export function blendMs(from: ShotKind, to: ShotKind): number {
  if (from === 'gate' && to === 'pack') return 1300;
  if (from === 'gate' && to === 'full') return 1100;
  if (to === 'finish') return 1200;
  if (to === 'hold') return 800;
  return 700;
}

export interface StepOptions {
  vp: Rect;
  reduce: boolean;
  /** Points that must stay well inside the frame, most important last (the leader). */
  keepIn?: Pt | readonly Pt[];
  /** Screen rectangles the kept point must stay out of (the mini-map). */
  keepOut?: readonly Rect[];
}

export class CameraRig {
  private live: Shot | null = null;
  private zGoal = 0;
  private wantTighterSince: number | null = null;
  private kind: ShotKind | null = null;
  private blend: { from: Shot; start: number; dur: number } | null = null;
  private last = 0;
  shot: Shot | null = null;

  /** Forget everything: the next step cuts straight to its target. */
  reset() {
    this.live = null;
    this.shot = null;
    this.kind = null;
    this.blend = null;
    this.wantTighterSince = null;
  }

  get current(): ShotKind | null {
    return this.kind;
  }

  step(target: Shot, kind: ShotKind, now: number, opts: StepOptions): Shot {
    const dt = this.last ? Math.min(0.1, Math.max(0, (now - this.last) / 1000)) : 0;
    this.last = now;
    if (opts.reduce || !this.live || !this.shot) {
      this.live = { ...target };
      this.zGoal = target.z;
      this.kind = kind;
      this.blend = null;
      this.shot = this.keep({ ...target }, opts);
      return this.shot;
    }
    if (kind !== this.kind) {
      /* A new kind of shot: ease from the picture on screen now. The gate
         is the start of a new race and is cut to cleanly. */
      if (kind === 'gate') {
        this.reset();
        return this.step(target, kind, now, opts);
      }
      this.blend = { from: { ...this.shot }, start: now, dur: blendMs(this.kind ?? kind, kind) };
      this.kind = kind;
      this.live = { ...target };
      this.zGoal = target.z;
      this.wantTighterSince = null;
    }

    /* Zoom: widen as soon as the shot needs it, tighten only once the
       tighter shot has been wanted for most of a second. */
    if (kind === 'pack') {
      if (target.z < this.zGoal * 0.98) {
        this.zGoal = target.z;
        this.wantTighterSince = null;
      } else if (target.z > this.zGoal * 1.12) {
        this.wantTighterSince ??= now;
        if (now - this.wantTighterSince > 900) {
          this.zGoal = target.z;
          this.wantTighterSince = null;
        }
      } else {
        this.wantTighterSince = null;
      }
    } else {
      this.zGoal = target.z;
    }
    const live = this.live;
    /* The following shot is calm and rate-limited; the set shots (the
       line, the whole course) settle quickly once the blend has brought
       the camera there. */
    const follow = kind === 'pack';
    const urgent = this.zGoal < live.z * 0.9;
    const rate = follow ? (urgent ? 1.4 : 0.5) : 3;
    const gap = Math.log(this.zGoal / live.z);
    const eased = gap * (1 - Math.exp(-dt / (follow ? 0.9 : 0.3)));
    const limited = Math.max(-rate * dt, Math.min(rate * dt, eased));
    live.z *= Math.exp(limited);
    const pan = 1 - Math.exp(-dt / (follow ? 0.5 : 0.25));
    live.cx += (target.cx - live.cx) * pan;
    live.cy += (target.cy - live.cy) * pan;
    this.keep(live, opts);

    let out: Shot = { ...live };
    if (this.blend) {
      const k = (now - this.blend.start) / this.blend.dur;
      if (k >= 1) this.blend = null;
      else {
        const e = smootherstep(k);
        const from = this.blend.from;
        out = {
          cx: from.cx + (live.cx - from.cx) * e,
          cy: from.cy + (live.cy - from.cy) * e,
          z: from.z * Math.pow(live.z / from.z, e),
        };
      }
    }
    this.shot = out;
    return out;
  }

  /** Slide the shot so the kept point sits inside the safe frame. */
  private keep(shot: Shot, opts: StepOptions): Shot {
    const points = opts.keepIn ? (Array.isArray(opts.keepIn) ? opts.keepIn : [opts.keepIn]) : [];
    for (const p of points) this.keepPoint(shot, p as Pt, opts);
    return shot;
  }

  private keepPoint(shot: Shot, p: Pt, opts: StepOptions) {
    const vp = opts.vp;
    const mx = vp.w * 0.14,
      my = vp.h * 0.14;
    let s = toScreen(p, shot, vp);
    let dx = 0,
      dy = 0;
    if (s.x < vp.x + mx) dx = s.x - (vp.x + mx);
    else if (s.x > vp.x + vp.w - mx) dx = s.x - (vp.x + vp.w - mx);
    if (s.y < vp.y + my) dy = s.y - (vp.y + my);
    else if (s.y > vp.y + vp.h - my) dy = s.y - (vp.y + vp.h - my);
    shot.cx += dx / shot.z;
    shot.cy += dy / shot.z;
    for (const r of opts.keepOut ?? []) {
      s = toScreen(p, shot, vp);
      const margin = 24;
      if (s.x > r.x - margin && s.x < r.x + r.w + margin && s.y > r.y - margin && s.y < r.y + r.h + margin) {
        /* Out the short way: over the top of the box or past its side. */
        const up = s.y - (r.y - margin);
        const right = r.x + r.w + margin - s.x;
        const left = s.x - (r.x - margin);
        if (up <= Math.min(right, left)) shot.cy += up / shot.z;
        else if (right <= left) shot.cx -= right / shot.z;
        else shot.cx += left / shot.z;
      }
    }
  }
}
