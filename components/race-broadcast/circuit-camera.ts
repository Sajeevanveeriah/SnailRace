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

/**
 * The time of the frame being drawn, in ms: the same for every callback in
 * a frame, however late in the frame each one runs. Moving the camera by
 * this clock gives even steps; `performance.now()` inside a callback wobbles
 * with whatever ran before it, and the picture judders by that wobble.
 */
export function frameClockMs(): number {
  const t = typeof document !== 'undefined' ? document.timeline?.currentTime : null;
  return typeof t === 'number' ? t : performance.now();
}

/**
 * A critically damped follow (a spring with no bounce). Position and speed
 * both stay continuous, so when the target jumps, as it does whenever a
 * runner joins or leaves the shot, the picture eases into the new move
 * instead of jolting. `state.v` carries the speed between frames.
 */
export function smoothDamp(current: number, target: number, state: { v: number }, smoothTime: number, dt: number, maxSpeed = Infinity): number {
  if (dt <= 0) return current;
  const t = Math.max(0.0001, smoothTime);
  const omega = 2 / t;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const maxChange = maxSpeed * t;
  const change = Math.max(-maxChange, Math.min(maxChange, current - target));
  const goal = current - change;
  const temp = (state.v + omega * change) * dt;
  state.v = (state.v - omega * temp) * decay;
  let out = goal + (change + temp) * decay;
  /* Never overshoot the target. */
  if (target - current > 0 === out > target) {
    out = target;
    state.v = 0;
  }
  return out;
}

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

/** Following the lead pack: pan and zoom settle times, in seconds. */
const FOLLOW_PAN_S = 0.45;
const FOLLOW_ZOOM_S = 1.1;
/** A set shot (the line, the whole course) settles quicker. */
const SET_PAN_S = 0.3;
const SET_ZOOM_S = 0.35;
/** Widening for a shot that needs more room settles quicker than tightening. */
const FOLLOW_ZOOM_OUT_S = 0.5;
/** Where the frame edge starts for a point that must stay in shot, as a share of the viewport. */
const KEEP_MARGIN = 0.14;
/** The last-resort edge: only a point already past it is pulled back at once. */
const HARD_MARGIN = 0.03;
/** How quickly the camera's estimate of the leader's speed follows the leader, in seconds. */
const LEAD_SPEED_S = 0.25;
/** The share of each settle time spent smoothing the goal before the camera follows it. */
const PRE_SHARE = 0.4;
/** A twist joining or leaving the shot is a camera move of its own, this long in ms. */
const REFRAME_MS = 900;

export class CameraRig {
  private live: Shot | null = null;
  private vel = { cx: { v: 0 }, cy: { v: 0 }, z: { v: 0 } };
  /* The leader's smoothed speed in course units per second, for leading the shot. */
  private lead: { p: Pt; vx: number; vy: number } | null = null;
  private zGoal = 0;
  /* How many points the shot must hold, and when that last changed. */
  private keepCount: number | null = null;
  private keepChangedAt = -Infinity;
  /* When the last change of shot finished, so the speed lead can fade back in. */
  private blendEndedAt = -Infinity;
  private wantTighterSince: number | null = null;
  private kind: ShotKind | null = null;
  private blend: { start: number; dur: number } | null = null;
  /* The goal after its own smoothing stage: the camera follows this, so any jump in the goal starts and ends softly. */
  private pre: { cx: number; cy: number; lz: number } | null = null;
  private preVel = { cx: { v: 0 }, cy: { v: 0 }, lz: { v: 0 } };
  private last = 0;
  shot: Shot | null = null;

  /** Forget everything: the next step cuts straight to its target. */
  reset() {
    this.live = null;
    this.shot = null;
    this.kind = null;
    this.blend = null;
    this.wantTighterSince = null;
    this.vel = { cx: { v: 0 }, cy: { v: 0 }, z: { v: 0 } };
    this.lead = null;
    this.keepCount = null;
    this.keepChangedAt = -Infinity;
    this.pre = null;
    this.preVel = { cx: { v: 0 }, cy: { v: 0 }, lz: { v: 0 } };
  }

  get current(): ShotKind | null {
    return this.kind;
  }

  step(target: Shot, kind: ShotKind, now: number, opts: StepOptions): Shot {
    const dt = this.last ? Math.min(0.1, Math.max(0, (now - this.last) / 1000)) : 0;
    this.last = now;
    if (opts.reduce || !this.live || !this.shot) {
      this.reset();
      this.zGoal = target.z;
      this.kind = kind;
      this.live = this.keep({ ...target }, opts, KEEP_MARGIN);
      this.shot = { ...this.live };
      return this.shot;
    }
    if (kind !== this.kind) {
      /* The gate is the start of a new race and is cut to cleanly. Any
         other change of shot keeps the camera's motion and eases on. */
      if (kind === 'gate') {
        this.reset();
        return this.step(target, kind, now, opts);
      }
      this.blend = { start: now, dur: blendMs(this.kind ?? kind, kind) };
      this.kind = kind;
      this.zGoal = target.z;
      this.wantTighterSince = null;
    }

    /* A twist coming on air (or going off) changes what the shot must
       hold: travel there as a deliberate move, never a cut. */
    const keepCount = opts.keepIn ? (Array.isArray(opts.keepIn) ? opts.keepIn.length : 1) : 0;
    if (this.keepCount !== null && keepCount !== this.keepCount) {
      this.keepChangedAt = now;
      if (!this.blend) this.blend = { start: now, dur: REFRAME_MS };
    }
    this.keepCount = keepCount;

    /* Zoom: widen as soon as the shot needs it, tighten only once the
       tighter shot has been wanted for most of a second, so it never pumps. */
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

    /* Where the camera wants to be: the target at the chosen zoom, slid so
       the kept points sit inside the frame. The camera then follows that
       goal smoothly, so keeping the leader in shot is a glide, not a snap. */
    const goal = this.keep({ cx: target.cx, cy: target.cy, z: this.zGoal }, opts, KEEP_MARGIN);
    const follow = kind === 'pack';
    let panS = follow ? FOLLOW_PAN_S : SET_PAN_S;
    let zoomS = follow ? FOLLOW_ZOOM_S : SET_ZOOM_S;
    /* Widening for a shot that needs it is quicker than tightening; the
       settle time changes rather than a speed cap, so the zoom never kinks. */
    if (follow && goal.z < this.live.z * 0.9) zoomS = FOLLOW_ZOOM_OUT_S;
    if (this.blend) {
      /* A change of shot travels in about its blend time, then hands over to the follow. */
      const k = (now - this.blend.start) / this.blend.dur;
      if (k >= 1) {
        this.blend = null;
        this.blendEndedAt = now;
      }
      else {
        /* A change of shot travels in about its blend time. */
        const travel = this.blend.dur / 1000 / 2.2;
        panS = travel;
        zoomS = travel;
      }
    }
    /* A follow lags a moving subject by about its settle time, so aim that
       far ahead of where the leader is going and the lag cancels out. */
    const kept = opts.keepIn ? (Array.isArray(opts.keepIn) ? opts.keepIn : [opts.keepIn]) : [];
    const leader = kept[kept.length - 1] as Pt | undefined;
    if (leader && dt > 0) {
      if (this.lead) {
        const vx = (leader.x - this.lead.p.x) / dt;
        const vy = (leader.y - this.lead.p.y) / dt;
        /* A new leader is a jump in the kept point, not a burst of speed: ignore it. */
        const known = Math.hypot(this.lead.vx, this.lead.vy);
        if (Math.hypot(vx, vy) <= Math.max(4 * known, 400)) {
          const k = 1 - Math.exp(-dt / LEAD_SPEED_S);
          this.lead.vx += (vx - this.lead.vx) * k;
          this.lead.vy += (vy - this.lead.vy) * k;
        }
        this.lead.p = { x: leader.x, y: leader.y };
      } else this.lead = { p: { x: leader.x, y: leader.y }, vx: 0, vy: 0 };
    } else if (!leader) this.lead = null;
    if (follow && !this.blend && this.lead) {
      const fade = Math.min(1, Math.max(0, (now - this.blendEndedAt) / 500));
      goal.cx += this.lead.vx * panS * fade;
      goal.cy += this.lead.vy * panS * fade;
    }
    const live = this.live;
    /* The nearer a kept point is to the edge of the picture on screen now,
       the more briskly the camera moves: a runner faster than the follow is
       caught by a quicker glide, not a snap. */
    const reframing = now - this.keepChangedAt < REFRAME_MS;
    const edge = reframing ? 0 : Math.min(1, this.edgePressure(live, opts));
    if (edge > 0) panS /= 1 + 6 * edge;
    /* Two damped stages in a row: the goal is smoothed, then the camera
       follows the smoothed goal. A jump anywhere upstream (a runner let in,
       a twist, a change of shot) then starts from rest and lands softly,
       with no kick in speed or in acceleration. */
    const pre = (this.pre ??= { cx: live.cx, cy: live.cy, lz: Math.log(live.z) });
    pre.cx = smoothDamp(pre.cx, goal.cx, this.preVel.cx, panS * PRE_SHARE, dt);
    pre.cy = smoothDamp(pre.cy, goal.cy, this.preVel.cy, panS * PRE_SHARE, dt);
    pre.lz = smoothDamp(pre.lz, Math.log(goal.z), this.preVel.lz, zoomS * PRE_SHARE, dt);
    live.cx = smoothDamp(live.cx, pre.cx, this.vel.cx, panS * (1 - PRE_SHARE), dt);
    live.cy = smoothDamp(live.cy, pre.cy, this.vel.cy, panS * (1 - PRE_SHARE), dt);
    live.z = Math.exp(smoothDamp(Math.log(live.z), pre.lz, this.vel.z, zoomS * (1 - PRE_SHARE), dt));
    /* A runner faster than the follow is still never lost off the edge,
       except while the camera is travelling to a new framing. */
    if (!reframing) this.keep(live, opts, HARD_MARGIN);
    this.shot = { ...live };
    return this.shot;
  }

  /** How far inside the keep margin the deepest kept point has strayed, as a share of the margin (0 when all are clear). */
  private edgePressure(shot: Shot, opts: StepOptions): number {
    const points = opts.keepIn ? (Array.isArray(opts.keepIn) ? opts.keepIn : [opts.keepIn]) : [];
    const vp = opts.vp;
    const mx = vp.w * KEEP_MARGIN,
      my = vp.h * KEEP_MARGIN;
    let worst = 0;
    for (const p of points) {
      const s = toScreen(p as Pt, shot, vp);
      const ix = Math.max(vp.x + mx - s.x, s.x - (vp.x + vp.w - mx), 0) / mx;
      const iy = Math.max(vp.y + my - s.y, s.y - (vp.y + vp.h - my), 0) / my;
      worst = Math.max(worst, ix, iy);
    }
    return worst;
  }

  /** Slide the shot so every kept point sits inside the frame's margin. */
  private keep(shot: Shot, opts: StepOptions, margin: number): Shot {
    const points = opts.keepIn ? (Array.isArray(opts.keepIn) ? opts.keepIn : [opts.keepIn]) : [];
    for (const p of points) this.keepPoint(shot, p as Pt, opts, margin);
    return shot;
  }

  private keepPoint(shot: Shot, p: Pt, opts: StepOptions, margin: number) {
    const vp = opts.vp;
    const mx = vp.w * margin,
      my = vp.h * margin;
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
      const gap = 24;
      if (s.x > r.x - gap && s.x < r.x + r.w + gap && s.y > r.y - gap && s.y < r.y + r.h + gap) {
        /* Out the short way: over the top of the box or past its side. */
        const up = s.y - (r.y - gap);
        const right = r.x + r.w + gap - s.x;
        const left = s.x - (r.x - gap);
        if (up <= Math.min(right, left)) shot.cy += up / shot.z;
        else if (right <= left) shot.cx -= right / shot.z;
        else shot.cx += left / shot.z;
      }
    }
  }
}
