/**
 * Pointer input, normalized to SCREEN coordinates (CSS px) via
 * `surface.toScreen`. World-space projections are added by the SceneManager
 * (`SceneInput.tapWorld` etc. via `cam.screenToWorld`) — this layer knows
 * nothing about the camera.
 *
 * One `Input` instance owns the global listeners on the canvas and exposes a
 * per-frame POLLING API (no callbacks): scenes read `input.tap` / `input.drag`
 * / `input.dragEnd` inside `update(dt, input)`. One-frame events (`tap`,
 * `dragEnd`) are cleared by `endFrame()`, which the SceneManager calls after
 * each update — scenes never clear anything themselves.
 */

import type { PixelSurface } from "./surface";

/** Live pointer position (screen px) + whether a pointer is currently down. */
export interface PointerState {
  x: number;
  y: number;
  down: boolean;
}

/** A completed tap (down + up within `TAP_SLOP` px), in screen coords. */
export interface TapEvent {
  x: number;
  y: number;
}

/** An in-progress drag: where it started, where it is, and the deltas. */
export interface DragState {
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** Total delta since the drag started (screen px). */
  dx: number;
  dy: number;
}

/** Fired the frame a drag is released — check `dx`/`durationMs` for swipes. */
export interface DragEndEvent extends DragState {
  durationMs: number;
}

/** Movement (screen px) beyond which a press becomes a drag, not a tap. */
const TAP_SLOP = 9;
/** Presses longer than this never count as taps. */
const TAP_MAX_MS = 500;

export class Input {
  /** Current pointer, always up to date (screen px). */
  readonly pointer: PointerState = { x: 0, y: 0, down: false };

  private surface: PixelSurface;
  private pointerId: number | null = null;
  private downAt = 0; // performance.now() at press
  private start = { x: 0, y: 0 };
  private isDrag = false;

  private tapEvent: TapEvent | null = null;
  private dragState: DragState | null = null;
  private dragEndEvent: DragEndEvent | null = null;

  private readonly onDown = (e: PointerEvent): void => this.handleDown(e);
  private readonly onMove = (e: PointerEvent): void => this.handleMove(e);
  private readonly onUp = (e: PointerEvent): void => this.handleUp(e, false);
  private readonly onCancel = (e: PointerEvent): void => this.handleUp(e, true);

  constructor(surface: PixelSurface) {
    this.surface = surface;
    const c = surface.canvas;
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onCancel);
  }

  /** Tap completed THIS frame, or null. Cleared by `endFrame()`. */
  get tap(): TapEvent | null {
    return this.tapEvent;
  }

  /** The drag in progress (past the tap slop), or null. Persists across frames. */
  get drag(): DragState | null {
    return this.dragState;
  }

  /** Drag released THIS frame, or null. Cleared by `endFrame()`. */
  get dragEnd(): DragEndEvent | null {
    return this.dragEndEvent;
  }

  /** Clear one-frame events. The SceneManager calls this after each update. */
  endFrame(): void {
    this.tapEvent = null;
    this.dragEndEvent = null;
  }

  /** Detach all listeners (tests / teardown). */
  dispose(): void {
    const c = this.surface.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onCancel);
  }

  private art(e: PointerEvent): { x: number; y: number } {
    return this.surface.toScreen(e.clientX, e.clientY);
  }

  private handleDown(e: PointerEvent): void {
    if (this.pointerId !== null) return; // primary pointer only
    this.pointerId = e.pointerId;
    this.surface.canvas.setPointerCapture(e.pointerId);
    const p = this.art(e);
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    this.pointer.down = true;
    this.downAt = performance.now();
    this.start = { x: p.x, y: p.y };
    this.isDrag = false;
  }

  private handleMove(e: PointerEvent): void {
    const p = this.art(e);
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    if (this.pointerId !== e.pointerId || !this.pointer.down) return;
    const dx = p.x - this.start.x;
    const dy = p.y - this.start.y;
    if (!this.isDrag && Math.hypot(dx, dy) > TAP_SLOP) this.isDrag = true;
    if (this.isDrag) {
      this.dragState = {
        startX: this.start.x,
        startY: this.start.y,
        x: p.x,
        y: p.y,
        dx,
        dy,
      };
    }
  }

  private handleUp(e: PointerEvent, cancelled: boolean): void {
    if (this.pointerId !== e.pointerId) return;
    this.pointerId = null;
    this.pointer.down = false;
    const p = this.art(e);
    const elapsed = performance.now() - this.downAt;
    if (this.isDrag) {
      if (!cancelled) {
        this.dragEndEvent = {
          startX: this.start.x,
          startY: this.start.y,
          x: p.x,
          y: p.y,
          dx: p.x - this.start.x,
          dy: p.y - this.start.y,
          durationMs: elapsed,
        };
      }
    } else if (!cancelled && elapsed <= TAP_MAX_MS) {
      this.tapEvent = { x: p.x, y: p.y };
    }
    this.dragState = null;
    this.isDrag = false;
  }
}
