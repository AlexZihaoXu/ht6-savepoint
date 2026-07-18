/**
 * Plaza wander simulation — pure logic, no DOM (rendering lives in
 * PlazaPage, which runs `stepWanderers` in a requestAnimationFrame loop and
 * writes the results to element styles).
 *
 * Model: each wanderer is a point (the character's feet) in plot pixel space
 * with a heading + speed. It strolls at its own per-character pace (some
 * amble, some brisk — and the pace drifts over time), occasionally picks a
 * new intent (heading/speed), sometimes just STOPS for a stretch (idle
 * pause), and reflects off the plot walls. The walk itself is a continuous
 * two-beat bounce (up + tilt right, up + tilt left) that runs ONLY while
 * moving — an idle or frozen character stands still. Characters bump only
 * when close in BOTH axes — vertically separated characters are on
 * different depth "levels" and pass in front of / behind each other instead
 * (the renderer z-sorts by y).
 */

export interface Wanderer {
  id: string;
  /** Feet position in plot pixels. */
  x: number;
  y: number;
  /** Travel direction (radians) + speed (px/s). */
  heading: number;
  speed: number;
  /** This character's personal pace (px/s) — speeds re-roll around it. */
  baseSpeed: number;
  /** Which way the sprite faces while moving: 1 = right, -1 = left. */
  facing: 1 | -1;
  /** Seconds until the next spontaneous change of intent. */
  turnIn: number;
  /** Seconds of post-bump grace so a pair doesn't re-collide jitter. */
  bumpCooldown: number;
  /** Seconds until the next idle pause (counts down while walking). */
  idleIn: number;
  /** Remaining idle-pause seconds; > 0 = standing still, no bounce. */
  idleFor: number;
  /** Walk-bounce phase (s); advances only while actually moving. */
  gaitT: number;
  /** Paused (selected/bubble open) — keeps position, ignores the tick. */
  frozen: boolean;
}

export interface WanderBounds {
  w: number;
  h: number;
}

export type Rng = () => number;

/** Two-beat walk bounce: up + tilt right, then up + tilt left. */
export const HOP_DURATION = 0.8;
const HOP_HEIGHT = 8;
const HOP_TILT_DEG = 8;

/** Personal paces span amblers to brisk walkers. */
const BASE_SPEED_MIN = 11;
const BASE_SPEED_MAX = 34;
/** Hard clamp for the per-intent speed re-rolls around baseSpeed. */
const SPEED_MIN = 7;
const SPEED_MAX = 42;

/** Idle pauses: how often + how long a character just stands there. */
const IDLE_EVERY_MIN = 4;
const IDLE_EVERY_VAR = 9;
const IDLE_LEN_MIN = 1.2;
const IDLE_LEN_VAR = 3.4;
/** Only drop into idle near a gait phase boundary (feet on the ground). */
const IDLE_PHASE_WINDOW = 0.07;

/** Bump only when closer than this in BOTH axes (px). */
const COLLIDE_X = 34;
const COLLIDE_Y = 16;

/** Keep feet inside the plot: sprite is ~60px wide, anchored bottom-center. */
const MARGIN_X = 30;
const MARGIN_TOP = 30;
const MARGIN_BOTTOM = 8;

const BUMP_GRACE = 1.1;
/** Gentle per-second un-stacking push while overlapping (px/s). */
const SEPARATE_SPEED = 70;

export function createWanderer(
  id: string,
  x: number,
  y: number,
  rng: Rng,
): Wanderer {
  const baseSpeed = BASE_SPEED_MIN + rng() * (BASE_SPEED_MAX - BASE_SPEED_MIN);
  return {
    id,
    x,
    y,
    heading: rng() * Math.PI * 2,
    speed: baseSpeed,
    baseSpeed,
    facing: rng() < 0.5 ? -1 : 1,
    turnIn: 0.6 + rng() * 2.4,
    bumpCooldown: 0,
    // Staggered idles + gait phase: per-character random so the crowd never
    // pauses or bounces in sync.
    idleIn: 1.5 + rng() * IDLE_EVERY_VAR,
    idleFor: 0,
    gaitT: rng() * HOP_DURATION,
    frozen: false,
  };
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

/**
 * Advance the whole crowd by `dt` seconds (mutates in place — this runs per
 * animation frame). Deterministic given an injected `rng`.
 */
export function stepWanderers(
  ws: Wanderer[],
  dt: number,
  bounds: WanderBounds,
  rng: Rng = Math.random,
): void {
  const minX = MARGIN_X;
  const maxX = Math.max(bounds.w - MARGIN_X, minX + 1);
  const minY = MARGIN_TOP;
  const maxY = Math.max(bounds.h - MARGIN_BOTTOM, minY + 1);

  for (const w of ws) {
    if (w.bumpCooldown > 0) w.bumpCooldown = Math.max(0, w.bumpCooldown - dt);
    if (w.frozen) continue;

    // Idle pause: stand still (no move, no bounce) until it elapses.
    if (w.idleFor > 0) {
      w.idleFor -= dt;
      if (w.idleFor <= 0) {
        w.idleFor = 0;
        w.idleIn = IDLE_EVERY_MIN + rng() * IDLE_EVERY_VAR;
        // Wander off refreshed: new direction + a re-roll of the pace.
        w.heading = rng() * Math.PI * 2;
        w.speed = rerollSpeed(w.baseSpeed, rng);
        w.turnIn = 1.2 + rng() * 3;
      }
      continue;
    }

    // Time for a pause? Wait for the feet to touch the ground (gait phase
    // boundary) so the bounce never freezes mid-air.
    w.idleIn -= dt;
    const phase = w.gaitT % (HOP_DURATION / 2);
    if (
      w.idleIn <= 0 &&
      (phase < IDLE_PHASE_WINDOW ||
        phase > HOP_DURATION / 2 - IDLE_PHASE_WINDOW)
    ) {
      w.idleFor = IDLE_LEN_MIN + rng() * IDLE_LEN_VAR;
      w.gaitT = 0;
      continue;
    }

    // Occasional new intent + continuous gentle steering noise. Speed
    // re-rolls around this character's personal pace, so it varies over
    // time AND differs per character.
    w.turnIn -= dt;
    if (w.turnIn <= 0) {
      w.heading += (rng() - 0.5) * 2.4;
      w.speed = rerollSpeed(w.baseSpeed, rng);
      w.turnIn = 1.2 + rng() * 3;
    }
    w.heading += (rng() - 0.5) * 1.4 * dt;

    w.x += Math.cos(w.heading) * w.speed * dt;
    w.y += Math.sin(w.heading) * w.speed * dt;

    // Walls: reflect, never clip outside the plot.
    if (w.x < minX) {
      w.x = minX;
      w.heading = Math.PI - w.heading;
    } else if (w.x > maxX) {
      w.x = maxX;
      w.heading = Math.PI - w.heading;
    }
    if (w.y < minY) {
      w.y = minY;
      w.heading = -w.heading;
    } else if (w.y > maxY) {
      w.y = maxY;
      w.heading = -w.heading;
    }

    // Face the travel direction (with hysteresis so near-vertical walks
    // don't flicker the flip).
    const cx = Math.cos(w.heading);
    if (cx > 0.25) w.facing = 1;
    else if (cx < -0.25) w.facing = -1;

    // The walk bounce advances only while actually moving.
    w.gaitT = (w.gaitT + dt) % HOP_DURATION;
  }

  // Pairwise bumps — only when near in BOTH axes. Vertically separated
  // characters are on different depth levels and just cross over.
  for (let i = 0; i < ws.length; i++) {
    for (let j = i + 1; j < ws.length; j++) {
      const a = ws[i];
      const b = ws[j];
      if (a.frozen && b.frozen) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (Math.abs(dx) >= COLLIDE_X || Math.abs(dy) >= COLLIDE_Y) continue;

      // Gently push apart every frame they overlap so nobody stacks.
      const d = Math.hypot(dx, dy);
      const ux = d > 0.001 ? dx / d : 1;
      const uy = d > 0.001 ? dy / d : 0;
      const sep = SEPARATE_SPEED * dt;
      if (!a.frozen) {
        a.x = clamp(a.x - ux * sep, minX, maxX);
        a.y = clamp(a.y - uy * sep, minY, maxY);
      }
      if (!b.frozen) {
        b.x = clamp(b.x + ux * sep, minX, maxX);
        b.y = clamp(b.y + uy * sep, minY, maxY);
      }

      // The turn-away fires once per encounter (grace period after).
      if (a.bumpCooldown > 0 || b.bumpCooldown > 0) continue;
      const away = Math.atan2(
        Math.abs(dy) > 0.001 ? dy : rng() - 0.5,
        Math.abs(dx) > 0.001 ? dx : rng() - 0.5,
      );
      if (!a.frozen) {
        a.heading = away + Math.PI + (rng() - 0.5) * 0.9;
        a.turnIn = 1 + rng() * 1.5;
      }
      if (!b.frozen) {
        b.heading = away + (rng() - 0.5) * 0.9;
        b.turnIn = 1 + rng() * 1.5;
      }
      a.bumpCooldown = BUMP_GRACE;
      b.bumpCooldown = BUMP_GRACE;
    }
  }
}

/** A fresh speed around a character's personal pace (±~40%). */
function rerollSpeed(baseSpeed: number, rng: Rng): number {
  return clamp(baseSpeed * (0.6 + rng() * 0.8), SPEED_MIN, SPEED_MAX);
}

/**
 * Vertical offset + tilt for the two-beat walk bounce at phase `hopT`:
 * first half bounces up tilting right, second half bounces up tilting left.
 */
export function hopOffset(hopT: number): { dy: number; tilt: number } {
  if (hopT < 0) return { dy: 0, tilt: 0 };
  const half = HOP_DURATION / 2;
  const second = hopT >= half;
  const p = clamp((hopT % half) / half, 0, 1);
  const arc = Math.sin(Math.PI * p);
  return {
    dy: -HOP_HEIGHT * arc,
    tilt: (second ? -HOP_TILT_DEG : HOP_TILT_DEG) * arc,
  };
}

/**
 * The render-facing bounce for one wanderer: zero while idle or frozen
 * (a stopped character does NOT bounce), and amplitude-scaled by speed
 * while walking (amblers bob gently, brisk walkers bounce harder).
 */
export function gaitOffset(w: Wanderer): { dy: number; tilt: number } {
  if (w.frozen || w.idleFor > 0) return { dy: 0, tilt: 0 };
  const k = 0.55 + 0.45 * clamp(w.speed / SPEED_MAX, 0, 1);
  const { dy, tilt } = hopOffset(w.gaitT);
  return { dy: dy * k, tilt: tilt * k };
}
