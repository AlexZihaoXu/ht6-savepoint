/**
 * Scene v2 + SceneManager + the nav-intent bus (engine v2, CANVAS_ARCH_V2.md).
 *
 * A scene renders in TWO passes over two coordinate systems:
 *   1. `renderWorld(ctx, cam, surface)` — the scene's world, drawn under the
 *      Camera (world units, integer zoom, fills the whole viewport).
 *   2. `renderUI(ctx, ui)` — chrome, drawn after the world in screen px at the
 *      UiContext's integer guiScale with anchored auto-layout.
 *
 * `update(dt, input)` receives a `SceneInput` carrying BOTH spaces: screen
 * coords (`tap`, `drag`, `pointer`) and their world projections (`tapWorld`,
 * `pointerWorld`, via `cam.screenToWorld`). Input routing rule: hit-test your
 * UI rects FIRST (screen space; `input.onUi` covers anything registered with
 * the UiContext), and only if no UI was hit, hit-test the world.
 *
 * Scenes never switch themselves — they emit a `NavIntent` through the `Nav`
 * handle their factory received, and main.ts maps intents to `switchTo(...)`.
 */

import { Camera } from "./camera";
import type {
  DragEndEvent,
  DragState,
  Input,
  PointerState,
  TapEvent,
} from "./input";
import type { PixelSurface } from "./surface";
import { UiContext } from "./ui";

/** A point in world units. */
export interface ScenePoint {
  x: number;
  y: number;
}

/** Per-frame input, in BOTH coordinate systems. */
export interface SceneInput {
  /** Live pointer, screen px. */
  pointer: PointerState;
  /** Tap completed this frame (screen px), or null. */
  tap: TapEvent | null;
  /** Drag in progress (screen px), or null. */
  drag: DragState | null;
  /** Drag released this frame (screen px), or null. */
  dragEnd: DragEndEvent | null;
  /** The pointer, projected into world units via the camera. */
  pointerWorld: ScenePoint;
  /** The tap, projected into world units (null when no tap). */
  tapWorld: ScenePoint | null;
  /** True when p (screen px) lands on UI drawn last frame — check FIRST. */
  onUi(p: { x: number; y: number } | null | undefined): boolean;
  /** Viewport size, CSS px. */
  viewW: number;
  viewH: number;
}

export interface Scene {
  /** Called once when the scene becomes current (kick off data fetches here). */
  enter?(): void | Promise<void>;
  /** Advance simulation + handle input (dt in seconds). */
  update(dt: number, input: SceneInput): void;
  /** Draw the world under the camera (pass 1). */
  renderWorld(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    surface: PixelSurface,
  ): void;
  /** Draw screen-space chrome at guiScale (pass 2, after the world). */
  renderUI(ctx: CanvasRenderingContext2D, ui: UiContext): void;
  /** Called when the scene is switched away from. */
  exit?(): void;
}

/** Everywhere the UI can navigate to. `date` accepts "today" or YYYY-MM-DD. */
export type NavIntent =
  | { kind: "plaza" }
  | { kind: "garden" }
  | { kind: "day"; date: string }
  | { kind: "people" }
  | { kind: "person"; localId: string }
  | { kind: "past" }
  | { kind: "back" };

/** The handle scenes use to request navigation. */
export interface Nav {
  go(intent: NavIntent): void;
}

export type NavHandler = (intent: NavIntent) => void;

/* -------------------------------------------------- legacy input adapter -- */

/**
 * The pointer surface the pre-v2 scenes were written against (they polled
 * `input.tap/drag/dragEnd/pointer` in ART px). `scaleInput` reproduces that
 * shape in a scene's own scaled UI space: screen px ÷ k.
 *
 * TRANSITIONAL — only for scenes not yet refactored to the two-space model
 * (garden/day/people/past render their old layout under one ctx.scale(k,k)).
 */
export interface LegacyInput {
  pointer: PointerState;
  tap: TapEvent | null;
  drag: DragState | null;
  dragEnd: DragEndEvent | null;
}

/** Divide every screen coord by `k` (a scene's guiScale). */
export function scaleInput(input: SceneInput, k: number): LegacyInput {
  const s = 1 / Math.max(1, k);
  const p = input.pointer;
  return {
    pointer: { x: p.x * s, y: p.y * s, down: p.down },
    tap: input.tap ? { x: input.tap.x * s, y: input.tap.y * s } : null,
    drag: input.drag
      ? {
          startX: input.drag.startX * s,
          startY: input.drag.startY * s,
          x: input.drag.x * s,
          y: input.drag.y * s,
          dx: input.drag.dx * s,
          dy: input.drag.dy * s,
        }
      : null,
    dragEnd: input.dragEnd
      ? {
          startX: input.dragEnd.startX * s,
          startY: input.dragEnd.startY * s,
          x: input.dragEnd.x * s,
          y: input.dragEnd.y * s,
          dx: input.dragEnd.dx * s,
          dy: input.dragEnd.dy * s,
          durationMs: input.dragEnd.durationMs,
        }
      : null,
  };
}

/* ----------------------------------------------------------- SceneManager -- */

/** Fade-out / fade-in halves of a scene switch, seconds. */
const FADE_OUT_S = 0.14;
const FADE_IN_S = 0.18;

export class SceneManager {
  /** Pass this to scene factories: `createPlazaScene(manager.nav)`. */
  readonly nav: Nav;
  /** The world camera (scenes set zoom/center; input projects through it). */
  readonly camera = new Camera();
  /** The UI layout/draw context (per-frame guiScale + anchored auto-layout). */
  readonly ui = new UiContext();

  private surface: PixelSurface;
  private input: Input;
  private current: Scene | null = null;
  private next: Scene | null = null;
  private phase: "idle" | "out" | "in" = "idle";
  private fade = 0; // 0 = clear, 1 = fully dark
  private handler: NavHandler | null = null;

  constructor(surface: PixelSurface, input: Input) {
    this.surface = surface;
    this.input = input;
    this.nav = { go: (intent) => this.emit(intent) };
  }

  /** Register the intent→scene router. Unrouted intents log. */
  onNav(handler: NavHandler): void {
    this.handler = handler;
  }

  /**
   * Make `scene` current, with a short fade transition. The first call (boot)
   * fades straight in. Calls exit() on the old scene and enter() on the new
   * (async enter is fire-and-forget — render a loading state meanwhile).
   */
  switchTo(scene: Scene): void {
    if (!this.current) {
      this.current = scene;
      void scene.enter?.();
      this.phase = "in";
      this.fade = 1;
      return;
    }
    if (scene === this.current || scene === this.next) return;
    this.next = scene;
    this.phase = "out";
  }

  /** Tick the current scene + transition. Calls `input.endFrame()` itself. */
  update(dt: number): void {
    this.camera.setView(this.surface.viewW, this.surface.viewH);
    if (this.phase === "out") {
      this.fade = Math.min(1, this.fade + dt / FADE_OUT_S);
      if (this.fade >= 1 && this.next) {
        this.current?.exit?.();
        this.current = this.next;
        this.next = null;
        void this.current.enter?.();
        this.phase = "in";
      }
    } else if (this.phase === "in") {
      this.fade = Math.max(0, this.fade - dt / FADE_IN_S);
      if (this.fade <= 0) this.phase = "idle";
    }
    // Freeze the outgoing scene's input handling during the fade-out.
    if (this.phase !== "out") this.current?.update(dt, this.sceneInput());
    this.input.endFrame();
  }

  /** World pass under the camera, then UI on top, then the transition veil. */
  render(): void {
    const s = this.surface;
    const ctx = s.ctx;
    s.beginFrame();
    this.camera.setView(s.viewW, s.viewH);
    this.ui.beginFrame(s.viewW, s.viewH);

    if (this.current) {
      this.current.renderWorld(ctx, this.camera, s);
      this.current.renderUI(ctx, this.ui);
    } else {
      ctx.fillStyle = "#14101e";
      ctx.fillRect(0, 0, s.viewW, s.viewH);
    }
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(20, 16, 30, ${this.fade.toFixed(3)})`;
      ctx.fillRect(0, 0, s.viewW, s.viewH);
    }
  }

  /** Bundle this frame's input in both spaces (world via the camera). */
  private sceneInput(): SceneInput {
    const i = this.input;
    const cam = this.camera;
    return {
      pointer: i.pointer,
      tap: i.tap,
      drag: i.drag,
      dragEnd: i.dragEnd,
      pointerWorld: cam.screenToWorld(i.pointer.x, i.pointer.y),
      tapWorld: i.tap ? cam.screenToWorld(i.tap.x, i.tap.y) : null,
      onUi: (p) => this.ui.onUi(p),
      viewW: this.surface.viewW,
      viewH: this.surface.viewH,
    };
  }

  private emit(intent: NavIntent): void {
    if (this.handler) this.handler(intent);
    else console.info("[nav] unrouted intent:", intent);
  }
}
