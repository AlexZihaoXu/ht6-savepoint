/**
 * PixelSurface v2 — a full-viewport backbuffer (engine v2, CANVAS_ARCH_V2.md).
 *
 * The canvas backbuffer IS the device viewport: `canvas.width = round(innerWidth
 * * dpr)` (device px), CSS size = innerWidth × innerHeight, and a
 * `setTransform(dpr, 0, 0, dpr, 0, 0)` so all drawing happens in CSS px. There
 * is NO fixed design resolution, NO CSS upscaling and NO letterbox — all
 * scaling now comes from the world `Camera.zoom` (integer) and the UI
 * `guiScale` (integer). Nearest-neighbor sampling is asserted every frame.
 *
 * Scenes never read `window` sizes — they get `viewW`/`viewH` (CSS px) from
 * here (via the Camera / UiContext the SceneManager feeds them).
 */

export class PixelSurface {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Viewport size in CSS px (the space all screen coords live in). */
  viewW = 1;
  viewH = 1;
  /** Device-pixel ratio baked into the backbuffer + base transform. */
  dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.resize();
  }

  /** Match the backbuffer to the current viewport (call on window resize). */
  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.viewW = Math.max(1, window.innerWidth);
    this.viewH = Math.max(1, window.innerHeight);
    // Backbuffer in DEVICE px; CSS box in CSS px — 1 CSS unit = dpr device px.
    this.canvas.width = Math.max(1, Math.round(this.viewW * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.viewH * this.dpr));
    this.canvas.style.width = `${this.viewW}px`;
    this.canvas.style.height = `${this.viewH}px`;
    this.applyBase();
  }

  /**
   * Re-assert the base transform + nearest-neighbor sampling. The SceneManager
   * calls this at the top of every frame — cheap, and robust against anything
   * that resets context state (e.g. a resize mid-frame).
   */
  beginFrame(): void {
    this.applyBase();
  }

  private applyBase(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Map a DOM client point (pointer event) to screen coords (CSS px). */
  toScreen(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }
}

/** Round to a whole pixel — position/size sprites through this for crispness. */
export const px = (n: number): number => Math.round(n);
