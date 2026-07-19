/**
 * Fixed rAF game loop: every animation frame it calls `update(dt)` then
 * `render()`. `dt` is in SECONDS, clamped to `MAX_DT` so a background tab or a
 * long GC pause never teleports the simulation.
 */

/** Largest dt (s) a single frame may report. */
const MAX_DT = 0.1;

export class GameLoop {
  private update: (dt: number) => void;
  private render: () => void;
  private rafId = 0;
  private last = 0;
  private running = false;

  constructor(update: (dt: number) => void, render: () => void) {
    this.update = update;
    this.render = render;
  }

  /** Start ticking (no-op if already running). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number): void => {
      if (!this.running) return;
      const dt = Math.min(MAX_DT, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.update(dt);
      this.render();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** Stop ticking (safe to call twice). */
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
