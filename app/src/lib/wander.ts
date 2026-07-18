/**
 * Plaza wander simulation — pure logic, no DOM (rendering lives in
 * PlazaPage, which runs `stepWanderers` in a requestAnimationFrame loop and
 * writes the results to element styles).
 *
 * Model: each wanderer is a point (the character's feet) in plot pixel space
 * with a heading + speed. Tuned like the Wii Mii Plaza lobby: characters
 * mostly STAND AROUND idle (long, staggered pauses — at any moment most of
 * the crowd is still), and only occasionally take a short, slow amble — a
 * small drift, not a purposeful crossing — before stopping again. Each has
 * its own gentle pace, occasionally picks a new intent (heading/speed),
 * and reflects off the plot walls. The walk itself is a continuous
 * two-beat bounce (up + tilt right, up + tilt left) that runs ONLY while
 * moving — an idle or frozen character stands still. Characters bump only
 * when close in BOTH axes — vertically separated characters are on
 * different depth "levels" and pass in front of / behind each other instead
 * (the renderer z-sorts by y).
 *
 * Sometimes a bump becomes a CHAT instead (TALK_CHANCE): the pair stops,
 * turns to face each other, slides onto the same depth line standing side
 * by side, and talks for a short random moment (the renderer floats an
 * animated chat bubble over them) before both wander off. A talking
 * character ignores wandering, bumping, and other passers-by.
 */

export interface Wanderer {
  id: string;
  /** Feet position in plot pixels. */
  x: number;
  y: number;
  /** Travel direction (radians) + current speed (px/s). */
  heading: number;
  speed: number;
  /** Where `speed` is easing to — decel/accel ramps, never instant jumps. */
  targetSpeed: number;
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
  /** Mid-conversation partner id, or null when not talking. */
  talkPartner: string | null;
  /** Remaining conversation seconds; counts down only while talking. */
  talkFor: number;
  /** Where this talker slides to stand — side-by-side, shared depth line. */
  talkX: number;
  talkY: number;
}

export interface WanderBounds {
  w: number;
  h: number;
}

export type Rng = () => number;

/** Two-beat walk bounce: up + tilt right, then up + tilt left. */
export const HOP_DURATION = 0.8;
const HOP_HEIGHT = 5;
const HOP_TILT_DEG = 6;

/** Personal paces: everyone ambles — a lobby mill, nobody power-walks. */
const BASE_SPEED_MIN = 6;
const BASE_SPEED_MAX = 16;
/** Hard clamp for the per-intent speed re-rolls around baseSpeed. */
const SPEED_MIN = 4;
const SPEED_MAX = 20;

/**
 * Idle pauses: how often + how long a character just stands there.
 * Calm-lobby duty cycle: short walk bouts (~1.2–3.4 s) between LONG stands
 * (~4–13 s) → any given character is idle ~4/5 of the time, so with a
 * plaza-sized crowd only one or two are ambling at any moment.
 */
const IDLE_EVERY_MIN = 1.2;
const IDLE_EVERY_VAR = 2.2;
const IDLE_LEN_MIN = 4;
const IDLE_LEN_VAR = 9;

/** Fraction of the crowd that spawns mid-amble; the rest start standing. */
const WALK_ON_SPAWN = 0.25;

/** Speed easing time-constant (s): decelerate into stops, accelerate out. */
const ACCEL_TAU = 0.45;
/** Below this (px/s) a decelerating character counts as stopped. */
const STOP_EPS = 0.8;
/** Bounce amplitude fades to zero below this speed (px/s). */
const GAIT_FADE_SPEED = 10;

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

/** Chance a bump becomes a conversation instead of a shove. */
const TALK_CHANCE = 0.2;
/** Conversation length: TALK_MIN..TALK_MIN+TALK_VAR seconds (~2–5 s). */
const TALK_MIN = 2;
const TALK_VAR = 3;
/** Side-by-side stance — how far apart a chatting pair stands (px). */
export const TALK_GAP = 30;
/** How fast a talker slides into stance (px/s). */
const TALK_ALIGN_SPEED = 40;

export function createWanderer(
  id: string,
  x: number,
  y: number,
  rng: Rng,
): Wanderer {
  const baseSpeed = BASE_SPEED_MIN + rng() * (BASE_SPEED_MAX - BASE_SPEED_MIN);
  // A calm lobby from the first frame: most characters SPAWN standing still
  // with a staggered wake-up; only a few start mid-amble (from rest they
  // accelerate smoothly, so `speed` starts at 0 for the standers).
  const walking = rng() < WALK_ON_SPAWN;
  return {
    id,
    x,
    y,
    heading: rng() * Math.PI * 2,
    speed: walking ? baseSpeed : 0,
    targetSpeed: walking ? baseSpeed : 0,
    baseSpeed,
    facing: rng() < 0.5 ? -1 : 1,
    turnIn: 0.6 + rng() * 2.4,
    bumpCooldown: 0,
    // Staggered idles + gait phase: per-character random so the crowd never
    // pauses or bounces in sync.
    idleIn: 1.5 + rng() * IDLE_EVERY_VAR,
    idleFor: walking ? 0 : 0.4 + rng() * IDLE_LEN_VAR,
    gaitT: rng() * HOP_DURATION,
    frozen: false,
    talkPartner: null,
    talkFor: 0,
    talkX: x,
    talkY: y,
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

    // Mid-conversation: no wandering — slide into the side-by-side stance
    // (same depth line) and hold it until the talk runs out. Ending clears
    // BOTH sides, so a pair always parts together (a frozen talker's clock
    // pauses, but its partner's still runs and ends the chat for both).
    if (w.talkPartner !== null) {
      w.talkFor -= dt;
      if (w.talkFor <= 0) {
        endTalk(w, ws, rng);
      } else {
        w.x = approach(w.x, w.talkX, TALK_ALIGN_SPEED * dt);
        w.y = approach(w.y, w.talkY, TALK_ALIGN_SPEED * dt);
      }
      continue;
    }

    // Idle pause: stand still (no move, no bounce) until it elapses.
    if (w.idleFor > 0) {
      w.idleFor -= dt;
      if (w.idleFor <= 0) {
        w.idleFor = 0;
        w.idleIn = IDLE_EVERY_MIN + rng() * IDLE_EVERY_VAR;
        // Wander off refreshed: new direction + a re-roll of the pace —
        // as a TARGET, so the character accelerates smoothly from rest.
        w.heading = rng() * Math.PI * 2;
        w.targetSpeed = rerollSpeed(w.baseSpeed, rng);
        w.turnIn = 1.2 + rng() * 3;
      }
      continue;
    }

    // Time for a pause? Ease the target to zero and glide down; only once
    // the ramp has all but stopped does the idle clock start. The bounce
    // amplitude fades with speed (gaitOffset), so the gait melts away
    // through the deceleration instead of cutting out.
    w.idleIn -= dt;
    if (w.idleIn <= 0) {
      w.targetSpeed = 0;
      if (w.speed < STOP_EPS) {
        w.speed = 0;
        w.idleFor = IDLE_LEN_MIN + rng() * IDLE_LEN_VAR;
        w.gaitT = 0;
        continue;
      }
    } else {
      // Occasional new intent + continuous gentle steering noise. Speed
      // re-rolls around this character's personal pace (as an eased
      // target), so it varies over time AND differs per character.
      w.turnIn -= dt;
      if (w.turnIn <= 0) {
        w.heading += (rng() - 0.5) * 2.4;
        w.targetSpeed = rerollSpeed(w.baseSpeed, rng);
        w.turnIn = 1.2 + rng() * 3;
      }
      w.heading += (rng() - 0.5) * 1.4 * dt;
    }

    // Ease the current speed toward its target (exponential ramp) —
    // characters decelerate into stops and accelerate back out.
    w.speed += (w.targetSpeed - w.speed) * (1 - Math.exp(-dt / ACCEL_TAU));

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
      // A talking pair holds its stance — no shoving them (or by them).
      if (a.talkPartner !== null || b.talkPartner !== null) continue;
      if (a.frozen && b.frozen) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (Math.abs(dx) >= COLLIDE_X || Math.abs(dy) >= COLLIDE_Y) continue;

      // Once per encounter (same gate as the turn-away below): a small
      // chance the meeting becomes a conversation instead of a bump —
      // rolled BEFORE the shove so a new pair of talkers stays close.
      if (
        a.bumpCooldown <= 0 &&
        b.bumpCooldown <= 0 &&
        !a.frozen &&
        !b.frozen &&
        rng() < TALK_CHANCE
      ) {
        startTalk(a, b, rng, minX, maxX, minY, maxY);
        continue;
      }

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

/** Move `v` toward `target` by at most `maxStep`, landing exactly on it. */
function approach(v: number, target: number, maxStep: number): number {
  const d = target - v;
  return Math.abs(d) <= maxStep ? target : v + Math.sign(d) * maxStep;
}

/**
 * Turn a meeting into a conversation: both stop dead (no gait), face each
 * other (whoever stands left faces right and vice versa), and get stance
 * targets — side by side TALK_GAP apart on a shared depth line at the
 * pair's midpoint (clamped inside the plot). One shared duration, so the
 * pair always parts together.
 */
function startTalk(
  a: Wanderer,
  b: Wanderer,
  rng: Rng,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): void {
  const left = a.x <= b.x ? a : b;
  const right = left === a ? b : a;
  const midX = clamp((a.x + b.x) / 2, minX + TALK_GAP / 2, maxX - TALK_GAP / 2);
  const midY = clamp((a.y + b.y) / 2, minY, maxY);
  const duration = TALK_MIN + rng() * TALK_VAR;
  for (const w of [a, b]) {
    w.talkFor = duration;
    w.talkY = midY;
    w.speed = 0;
    w.targetSpeed = 0;
    w.gaitT = 0;
  }
  a.talkPartner = b.id;
  b.talkPartner = a.id;
  left.talkX = midX - TALK_GAP / 2;
  right.talkX = midX + TALK_GAP / 2;
  left.facing = 1;
  right.facing = -1;
}

/**
 * A conversation ran out: clear BOTH sides and send the pair wandering off
 * in parting directions (each away from the other), with bump grace so the
 * goodbye doesn't instantly re-collide into another encounter.
 */
function endTalk(w: Wanderer, ws: Wanderer[], rng: Rng): void {
  const partner = ws.find((p) => p.id === w.talkPartner) ?? null;
  for (const p of partner ? [w, partner] : [w]) {
    p.talkPartner = null;
    p.talkFor = 0;
    p.idleFor = 0;
    p.idleIn = IDLE_EVERY_MIN + rng() * IDLE_EVERY_VAR;
    p.turnIn = 1.2 + rng() * 3;
    p.targetSpeed = rerollSpeed(p.baseSpeed, rng);
    p.bumpCooldown = BUMP_GRACE;
  }
  if (partner) {
    const dx = partner.x - w.x;
    const dy = partner.y - w.y;
    const away = Math.atan2(
      Math.abs(dy) > 0.001 ? dy : rng() - 0.5,
      Math.abs(dx) > 0.001 ? dx : rng() - 0.5,
    );
    w.heading = away + Math.PI + (rng() - 0.5) * 0.9;
    partner.heading = away + (rng() - 0.5) * 0.9;
  }
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
 * (a stopped character does NOT bounce), amplitude-scaled by speed while
 * walking (amblers bob gently, brisk walkers bounce harder), and fading
 * smoothly to nothing through the last ~10 px/s of a deceleration ramp —
 * so the bounce melts out into a stop and swells back in on resume.
 */
export function gaitOffset(w: Wanderer): { dy: number; tilt: number } {
  if (w.frozen || w.idleFor > 0) return { dy: 0, tilt: 0 };
  const fade = clamp(w.speed / GAIT_FADE_SPEED, 0, 1);
  if (fade === 0) return { dy: 0, tilt: 0 };
  const k = fade * (0.55 + 0.45 * clamp(w.speed / SPEED_MAX, 0, 1));
  const { dy, tilt } = hopOffset(w.gaitT);
  return { dy: dy * k, tilt: tilt * k };
}
