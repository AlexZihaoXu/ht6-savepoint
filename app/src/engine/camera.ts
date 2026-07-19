/**
 * Camera — the WORLD coordinate system (engine v2, CANVAS_ARCH_V2.md).
 *
 * Scenes are authored in world units (1 world unit = 1 source-art pixel; a
 * 92px sprite is 92 units tall). The camera maps world→screen:
 *
 *   sx = round(wx * zoom + ox)   where ox = round(viewW/2 - cam.x * zoom)
 *   sy = round(wy * zoom + oy)         oy = round(viewH/2 - cam.y * zoom)
 *
 * `cam.x/y` is the world point at screen center. `zoom` is ALWAYS an integer
 * (screen px per world px) picked from the viewport — never fractional — so
 * integer world coords land on integer screen px and pixels stay crisp. The
 * world fills the whole viewport at any aspect ratio: wider windows simply see
 * MORE world (no letterbox — tile the ground across `visibleWorld()`).
 *
 * Draw either through `withWorld(ctx, fn)` (sets the world transform so a
 * scene draws in plain world coords with the existing helpers — round world
 * coords to integers via `px()`), or through `drawWorldImage` for one-off
 * anchored sprites.
 */

import { px } from "./surface";

/** World-units of the viewport's short side the zoom aims to show (~220). */
const WORLD_VIEW = 220;
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

export interface WorldPoint {
  x: number;
  y: number;
}

/** Axis-aligned world-space rectangle (x0/y0 top-left, x1/y1 bottom-right). */
export interface WorldBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface DrawWorldImageOpts {
  /** Anchor of (wx, wy) on the image (default "top-left"). */
  anchor?: "top-left" | "bottom-center";
  /** Mirror horizontally around the anchor (walk cycles facing left). */
  flip?: boolean;
}

export class Camera {
  /** World point at the center of the screen. */
  x = 0;
  y = 0;
  /** INTEGER screen px per world px. */
  zoom = 1;
  /** Viewport size, CSS px (fed by the SceneManager every frame). */
  viewW = 1;
  viewH = 1;

  /** Update the viewport this camera projects into. */
  setView(viewW: number, viewH: number): void {
    this.viewW = Math.max(1, viewW);
    this.viewH = Math.max(1, viewH);
  }

  /**
   * The integer zoom for a viewport: phones land ~2, desktops 3–4 — a similar
   * slice of world everywhere, just bigger crisper blocks on bigger screens.
   */
  pickZoom(viewW = this.viewW, viewH = this.viewH): number {
    const z = Math.round(Math.min(viewW, viewH) / WORLD_VIEW);
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  }

  /** Point the camera at a world position. */
  centerOn(wx: number, wy: number): void {
    this.x = wx;
    this.y = wy;
  }

  /** Screen-px offset of world origin (rounded once so draws + hits agree). */
  private ox(): number {
    return Math.round(this.viewW / 2 - this.x * this.zoom);
  }

  private oy(): number {
    return Math.round(this.viewH / 2 - this.y * this.zoom);
  }

  worldToScreen(wx: number, wy: number): WorldPoint {
    return {
      x: Math.round(wx * this.zoom + this.ox()),
      y: Math.round(wy * this.zoom + this.oy()),
    };
  }

  screenToWorld(sx: number, sy: number): WorldPoint {
    return {
      x: (sx - this.ox()) / this.zoom,
      y: (sy - this.oy()) / this.zoom,
    };
  }

  /** The world rect currently on screen (for tiling ground across it all). */
  visibleWorld(): WorldBounds {
    const tl = this.screenToWorld(0, 0);
    const br = this.screenToWorld(this.viewW, this.viewH);
    return { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
  }

  /**
   * Run `fn` under the world transform (translate + integer scale): inside it
   * you draw in WORLD coordinates and everything lands zoomed + camera-offset.
   * Integer world coords → integer screen px (the offset is pre-rounded).
   */
  withWorld(ctx: CanvasRenderingContext2D, fn: () => void): void {
    ctx.save();
    ctx.translate(this.ox(), this.oy());
    ctx.scale(this.zoom, this.zoom);
    fn();
    ctx.restore();
  }

  /**
   * Draw `img` at world position (wx, wy) at native world size (1 unit per
   * source px), without needing `withWorld`. Rounded + integer-scaled.
   */
  drawWorldImage(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    wx: number,
    wy: number,
    opts: DrawWorldImageOpts = {},
  ): void {
    const z = this.zoom;
    const w = img.width * z;
    const h = img.height * z;
    let tlx: number;
    let tly: number;
    if (opts.anchor === "bottom-center") {
      const p = this.worldToScreen(px(wx - img.width / 2), px(wy - img.height));
      tlx = p.x;
      tly = p.y;
    } else {
      const p = this.worldToScreen(px(wx), px(wy));
      tlx = p.x;
      tly = p.y;
    }
    if (opts.flip) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(img, -tlx - w, tly, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(img, tlx, tly, w, h);
    }
  }
}
