import { describe, expect, it } from "vitest";
import {
  createWanderer,
  gaitOffset,
  hopOffset,
  stepWanderers,
  HOP_DURATION,
  type Wanderer,
} from "./wander";
import { rand } from "./scene-utils";

/** Deterministic rng from scene-utils' hash (same trick the page uses). */
function seededRng(seed: string) {
  let n = 0;
  return () => rand(seed, n++);
}

/** rng pinned to 0.5 → zero steering jitter, so paths are fully predictable. */
const flat = () => 0.5;

const BOUNDS = { w: 400, h: 300 };

function make(id: string, x: number, y: number, heading = 0): Wanderer {
  const w = createWanderer(id, x, y, seededRng(id));
  w.heading = heading;
  w.turnIn = 999; // no spontaneous intent changes during the test
  w.idleIn = 999; // no idle pauses during the test
  return w;
}

describe("wander sim", () => {
  it("never leaves the plot over a long random walk", () => {
    const ws = ["a", "b", "c", "d", "e", "f", "g"].map((id, i) =>
      createWanderer(id, 50 + i * 40, 60 + (i % 3) * 60, seededRng(id)),
    );
    const rng = seededRng("world");
    for (let step = 0; step < 3000; step++) {
      stepWanderers(ws, 1 / 30, BOUNDS, rng);
      for (const w of ws) {
        expect(w.x).toBeGreaterThanOrEqual(0);
        expect(w.x).toBeLessThanOrEqual(BOUNDS.w);
        expect(w.y).toBeGreaterThanOrEqual(0);
        expect(w.y).toBeLessThanOrEqual(BOUNDS.h);
      }
    }
  });

  it("reflects off a wall instead of clipping through", () => {
    const w = make("wall", 395, 150, 0); // heading right, at the right edge
    stepWanderers([w], 1 / 30, BOUNDS, flat);
    expect(w.x).toBeLessThanOrEqual(BOUNDS.w - 29);
    expect(Math.cos(w.heading)).toBeLessThan(0); // now heading left
  });

  it("bumps two characters apart when close in BOTH axes", () => {
    const a = make("a", 100, 100, 0); // walking right…
    const b = make("b", 120, 106, Math.PI); // …into b walking left
    const d0 = Math.hypot(b.x - a.x, b.y - a.y);
    stepWanderers([a, b], 1 / 30, BOUNDS, flat);
    expect(a.bumpCooldown).toBeGreaterThan(0);
    expect(b.bumpCooldown).toBeGreaterThan(0);
    // They turn onto diverging courses and separate over the next second.
    for (let i = 0; i < 30; i++) stepWanderers([a, b], 1 / 30, BOUNDS, flat);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(d0);
  });

  it("does NOT collide when overlapping in x but far apart in y (depth levels)", () => {
    const a = make("a", 100, 60, 0);
    const b = make("b", 104, 160, Math.PI); // same x zone, other depth level
    stepWanderers([a, b], 1 / 30, BOUNDS, flat);
    expect(a.bumpCooldown).toBe(0);
    expect(b.bumpCooldown).toBe(0);
    expect(a.heading).toBeCloseTo(0, 5); // course unchanged — they pass by
    expect(b.heading).toBeCloseTo(Math.PI, 5);
  });

  it("freezes a selected character but keeps the others moving", () => {
    const a = make("a", 100, 100, 0);
    const b = make("b", 300, 200, Math.PI);
    a.frozen = true;
    stepWanderers([a, b], 1 / 30, BOUNDS, flat);
    expect(a.x).toBe(100);
    expect(a.y).toBe(100);
    expect(b.x).not.toBe(300);
  });

  it("faces the direction of travel", () => {
    const right = make("r", 200, 150, 0);
    const left = make("l", 200, 150, Math.PI);
    left.x = 100;
    stepWanderers([right, left], 1 / 30, BOUNDS, flat);
    expect(right.facing).toBe(1);
    expect(left.facing).toBe(-1);
  });

  it("gives each character its own pace + gait phase (deterministic per id)", () => {
    const a = createWanderer("a", 0, 0, seededRng("a"));
    const b = createWanderer("b", 0, 0, seededRng("b"));
    const a2 = createWanderer("a", 0, 0, seededRng("a"));
    expect(a.baseSpeed).not.toBe(b.baseSpeed); // amblers vs brisk walkers
    expect(a.gaitT).not.toBe(b.gaitT); // staggered bounce phase
    expect(a.idleIn).not.toBe(b.idleIn); // staggered pauses
    expect(a.baseSpeed).toBe(a2.baseSpeed); // same id → same personality
    expect(a.gaitT).toBe(a2.gaitT);
  });

  it("varies a character's speed over time around its own pace", () => {
    const w = make("pace", 200, 150, 0);
    const before = w.speed;
    w.turnIn = 0; // force an intent change
    stepWanderers([w], 1 / 30, BOUNDS, seededRng("roll"));
    expect(w.speed).not.toBe(before);
    expect(w.speed).toBeGreaterThan(0);
  });

  it("bounces in two beats: up-tilt-right then up-tilt-left", () => {
    expect(hopOffset(-1)).toEqual({ dy: 0, tilt: 0 });
    const first = hopOffset(HOP_DURATION * 0.25);
    const second = hopOffset(HOP_DURATION * 0.75);
    expect(first.dy).toBeLessThan(0); // airborne
    expect(second.dy).toBeLessThan(0);
    expect(first.tilt).toBeGreaterThan(0); // right…
    expect(second.tilt).toBeLessThan(0); // …then left
  });

  it("bounces ONLY while moving — idle or frozen characters stand still", () => {
    const w = make("gait", 200, 150, 0);
    w.gaitT = HOP_DURATION * 0.25; // mid-stride
    expect(gaitOffset(w).dy).toBeLessThan(0); // walking → airborne

    w.idleFor = 2; // paused → no bounce
    expect(gaitOffset(w)).toEqual({ dy: 0, tilt: 0 });

    w.idleFor = 0;
    w.frozen = true; // tapped → no bounce
    expect(gaitOffset(w)).toEqual({ dy: 0, tilt: 0 });
  });

  it("advances the gait only while walking", () => {
    const walking = make("walk", 200, 150, 0);
    walking.gaitT = 0;
    stepWanderers([walking], 1 / 30, BOUNDS, flat);
    expect(walking.gaitT).toBeGreaterThan(0);

    const idle = make("stand", 200, 150, 0);
    idle.gaitT = 0;
    idle.idleFor = 5;
    stepWanderers([idle], 1 / 30, BOUNDS, flat);
    expect(idle.gaitT).toBe(0);
  });

  it("takes an idle pause — decelerates to a stop, stands, then resumes", () => {
    const w = make("pause", 200, 150, 0);
    w.idleIn = 0.001; // pause imminent
    // Deceleration ramp: speed only shrinks until the stop lands.
    let prev = w.speed;
    let steps = 0;
    while (w.idleFor === 0 && steps < 200) {
      stepWanderers([w], 1 / 30, BOUNDS, flat);
      expect(w.speed).toBeLessThanOrEqual(prev); // never speeds up mid-stop
      prev = w.speed;
      steps++;
    }
    expect(w.idleFor).toBeGreaterThan(0); // reached the pause…
    expect(steps).toBeGreaterThan(3); // …but NOT instantly (eased ramp)
    expect(w.speed).toBe(0);
    const [x0, y0] = [w.x, w.y];
    for (let i = 0; i < 30; i++) stepWanderers([w], 1 / 30, BOUNDS, flat);
    if (w.idleFor > 0) {
      expect(w.x).toBe(x0); // …not moving while idle
      expect(w.y).toBe(y0);
    }
    for (let i = 0; i < 200; i++) stepWanderers([w], 1 / 30, BOUNDS, flat);
    expect(w.idleFor).toBe(0); // pause ended
    expect(w.x === x0 && w.y === y0).toBe(false); // walking again
  });

  it("accelerates smoothly out of a stop (no instant velocity jump)", () => {
    const w = make("ramp", 200, 150, 0);
    w.idleIn = 999;
    w.speed = 0;
    w.targetSpeed = 30;
    stepWanderers([w], 1 / 30, BOUNDS, flat);
    expect(w.speed).toBeGreaterThan(0); // pulling away…
    expect(w.speed).toBeLessThan(10); // …but nowhere near cruise yet
    for (let i = 0; i < 90; i++) stepWanderers([w], 1 / 30, BOUNDS, flat);
    expect(w.speed).toBeGreaterThan(25); // eased up to cruising speed
  });

  it("fades the bounce out as speed ramps down", () => {
    const w = make("fade", 200, 150, 0);
    w.gaitT = HOP_DURATION * 0.25; // mid-stride
    w.speed = 30;
    const fast = Math.abs(gaitOffset(w).dy);
    w.speed = 5; // decelerating through the fade band
    const slow = Math.abs(gaitOffset(w).dy);
    w.speed = 0;
    const stopped = Math.abs(gaitOffset(w).dy);
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThan(0);
    expect(stopped).toBe(0);
  });
});
