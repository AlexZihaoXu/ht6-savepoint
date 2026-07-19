/**
 * UI layer (engine v2, CANVAS_ARCH_V2.md) — the SCREEN coordinate system.
 *
 * Chrome (headers, buttons, panels, nav bars) is drawn AFTER the world, in
 * screen px, untouched by the camera. It has its own INTEGER `guiScale` from
 * the window size (Minecraft-style GUI scale): UI art/text is authored in
 * UI-units and blitted at × guiScale.
 *
 * `UiContext` is the per-frame layout brain:
 *   - `place(anchor, wUnits, hUnits, {margin}) -> UiRect` — an anchored screen
 *     rect, already guiScaled, CLAMPED into the viewport and OVERLAP-RESOLVED
 *     against everything placed earlier this frame (shift first; if a shifted
 *     spot can't be found, drop that element's scale a notch and retry). No
 *     element ever renders off-screen or on top of another.
 *   - `button()/panel()/text()` draw at the rect's scale and register their
 *     rects for hit-testing (`onUi`) — the SceneManager's input routing rule
 *     is "UI first, world only if nothing UI was hit".
 *   - `scaled(ctx, rect, fn)` — escape hatch: translate+scale into a placed
 *     rect so custom art (icons, bars) draws in UI-units with the old helpers.
 *
 * The legacy free functions below (nineSlice/panel/button/…) draw in the
 * CURRENT transform at 1:1 — UiContext composes them under its scale, and the
 * not-yet-migrated scenes still call them inside their own scaled space.
 */

import { cached, loadImage, SHEET } from "./assets";
import { px } from "./surface";
import { drawText, measure, type PixelFontSize, type TextOpts } from "./text";

/** Base UI-unit size the guiScale divides the viewport by (~180). */
const UI_BASE = 180;
const MIN_GUI = 1;
const MAX_GUI = 4;

/** Axis-aligned rectangle (units depend on context: screen px or UI units). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A placed screen rect + the integer scale its content draws at. */
export interface UiRect extends Rect {
  scale: number;
}

/** Convenience Rect literal. */
export function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

/** True when `p` lies inside `r` (null/undefined p → false). */
export function hit(
  r: Rect,
  p: { x: number; y: number } | null | undefined,
): boolean {
  return !!p && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/* ------------------------------------------------------------- UiContext -- */

export type Anchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "center"
  | "left-edge"
  | "right-edge";

export interface PlaceOpts {
  /** Gap from the anchored viewport edges, UI units (default 4). */
  margin?: number;
  /** Extra offset from the anchor position, UI units. */
  dx?: number;
  dy?: number;
}

export class UiContext {
  /** Integer UI scale for this frame: clamp(floor(min(vw,vh)/180), 1, 4). */
  guiScale = 1;
  viewW = 1;
  viewH = 1;

  /** Rects placed this frame (layout collision set). */
  private placed: Rect[] = [];
  /** Interactive rects registered this frame (being drawn now). */
  private hits: Rect[] = [];
  /** Last COMPLETED frame's interactive rects — what update() hit-tests. */
  private prevHits: Rect[] = [];

  /** Start a UI frame: recompute guiScale, rotate the hit-rect buffers. */
  beginFrame(viewW: number, viewH: number): void {
    this.viewW = Math.max(1, viewW);
    this.viewH = Math.max(1, viewH);
    const s = Math.floor(Math.min(this.viewW, this.viewH) / UI_BASE);
    this.guiScale = Math.max(MIN_GUI, Math.min(MAX_GUI, s));
    this.placed = [];
    this.prevHits = this.hits;
    this.hits = [];
  }

  /**
   * Anchor a `wUnits`×`hUnits` element (UI units) into the viewport. Returns
   * its screen rect at the best integer scale ≤ guiScale that fits without
   * clipping or overlapping anything placed earlier this frame.
   */
  place(anchor: Anchor, wUnits: number, hUnits: number, opts: PlaceOpts = {}): UiRect {
    const margin = opts.margin ?? 4;
    for (let s = this.guiScale; s >= 1; s--) {
      const raw = this.anchored(
        anchor,
        wUnits * s,
        hUnits * s,
        margin * s,
        (opts.dx ?? 0) * s,
        (opts.dy ?? 0) * s,
      );
      const r = this.resolve(this.fitSize(raw), anchor);
      if (r) {
        const out: UiRect = { ...r, scale: s };
        this.placed.push(out);
        return out;
      }
    }
    // Last resort (pathologically small window): scale 1, clamped on-screen.
    const fallback = this.clampPos(
      this.fitSize(
        this.anchored(anchor, wUnits, hUnits, margin, opts.dx ?? 0, opts.dy ?? 0),
      ),
    );
    const out: UiRect = { ...fallback, scale: 1 };
    this.placed.push(out);
    return out;
  }

  /** The anchored rect in screen px (before clamping/resolution). */
  private anchored(
    anchor: Anchor,
    w: number,
    h: number,
    m: number,
    dx: number,
    dy: number,
  ): Rect {
    const W = this.viewW;
    const H = this.viewH;
    const cx = Math.round((W - w) / 2);
    const cy = Math.round((H - h) / 2);
    let x: number;
    let y: number;
    switch (anchor) {
      case "top-left":
        x = m; y = m; break;
      case "top-center":
        x = cx; y = m; break;
      case "top-right":
        x = W - w - m; y = m; break;
      case "bottom-left":
        x = m; y = H - h - m; break;
      case "bottom-center":
        x = cx; y = H - h - m; break;
      case "bottom-right":
        x = W - w - m; y = H - h - m; break;
      case "center":
        x = cx; y = cy; break;
      case "left-edge":
        x = m; y = cy; break;
      case "right-edge":
        x = W - w - m; y = cy; break;
    }
    return { x: x + dx, y: y + dy, w, h };
  }

  /** Cap a rect's size to the viewport (a "full-width" bar just fills it). */
  private fitSize(r: Rect): Rect {
    return {
      x: r.x,
      y: r.y,
      w: Math.min(r.w, this.viewW),
      h: Math.min(r.h, this.viewH),
    };
  }

  /** Clamp a rect's position fully inside the viewport. */
  private clampPos(r: Rect): Rect {
    return {
      ...r,
      x: Math.max(0, Math.min(r.x, this.viewW - r.w)),
      y: Math.max(0, Math.min(r.y, this.viewH - r.h)),
    };
  }

  /**
   * The overlap pass: nudge `r` vertically away from whatever it collides
   * with (top-anchored elements flow down, bottom-anchored flow up, everything
   * else away from the blocker's center) until it sits clear + on-screen.
   * Returns null when no clear spot exists at this scale.
   */
  private resolve(start: Rect, anchor: Anchor): Rect | null {
    let r = this.clampPos(start);
    for (let i = 0; i < 16; i++) {
      const blocker = this.placed.find((p) => intersects(r, p));
      if (!blocker) return r;
      const down =
        anchor.startsWith("top") ||
        (!anchor.startsWith("bottom") &&
          blocker.y + blocker.h / 2 <= r.y + r.h / 2);
      const y = down ? blocker.y + blocker.h + 2 : blocker.y - r.h - 2;
      if (y < 0 || y + r.h > this.viewH) return null; // no room this way
      r = { ...r, y };
    }
    return null;
  }

  /* ---------------------------------------------------------- widgets ---- */

  /**
   * Translate+scale into a placed rect and run `fn(wUnits, hUnits)` — inside,
   * draw in UI-units with the legacy helpers (drawText, button, nineSlice…).
   */
  scaled(
    ctx: CanvasRenderingContext2D,
    r: UiRect,
    fn: (wUnits: number, hUnits: number) => void,
  ): void {
    ctx.save();
    ctx.translate(px(r.x), px(r.y));
    ctx.scale(r.scale, r.scale);
    fn(r.w / r.scale, r.h / r.scale);
    ctx.restore();
  }

  /**
   * A 9-sliced `btn*.png` button filling `r`, label centered, drawn at the
   * rect's scale. Registers `r` for hit-testing; keep the returned rect and
   * hit-test taps against it in update().
   */
  button(
    ctx: CanvasRenderingContext2D,
    r: UiRect,
    label: string,
    opts: ButtonOpts = {},
  ): UiRect {
    this.scaled(ctx, r, (w, h) => {
      button(ctx, rect(0, 0, w, h), label, opts);
    });
    this.registerHit(r);
    return r;
  }

  /** A 9-sliced parchment panel filling `r` (not interactive by default). */
  panel(ctx: CanvasRenderingContext2D, r: UiRect): UiRect {
    this.scaled(ctx, r, (w, h) => {
      panel(ctx, 0, 0, w, h);
    });
    return r;
  }

  /**
   * PressStart2P text at `size * scale` (default scale = guiScale). (x, y) are
   * SCREEN px; size is UI units (6 / 8 / 10).
   */
  text(
    ctx: CanvasRenderingContext2D,
    str: string,
    x: number,
    y: number,
    opts: TextOpts & { scale?: number } = {},
  ): void {
    const s = opts.scale ?? this.guiScale;
    ctx.save();
    ctx.translate(px(x), px(y));
    ctx.scale(s, s);
    drawText(ctx, str, 0, 0, opts);
    ctx.restore();
  }

  /** Register an interactive screen rect (custom-drawn tap zones). */
  registerHit(r: Rect): void {
    this.hits.push({ x: r.x, y: r.y, w: r.w, h: r.h });
  }

  /**
   * True when `p` (screen px) lands on any UI element drawn last frame —
   * the "hit-test UI first" half of the input routing rule.
   */
  onUi(p: { x: number; y: number } | null | undefined): boolean {
    if (!p) return false;
    return this.prevHits.some((r) => hit(r, p));
  }
}

/* ----------------------------------------------------- legacy primitives -- */

const pending = new Set<string>();

/**
 * Synchronously get a cached image, kicking off ONE deduped background load
 * on first miss (returns undefined until it lands). Draw-helpers below use it
 * so scenes never await UI art.
 */
export function ensure(url: string): HTMLImageElement | undefined {
  const img = cached(url);
  if (img) return img;
  if (!pending.has(url)) {
    pending.add(url);
    loadImage(url)
      .catch(() => undefined)
      .finally(() => pending.delete(url));
  }
  return undefined;
}

/**
 * Draw `img` as a 9-slice in the CURRENT transform: corners at 1:1, edges/
 * center stretched. `inset` is the corner size in SOURCE px (default 8).
 */
export function nineSlice(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  inset = 8,
): void {
  const sw = img.width;
  const sh = img.height;
  const i = Math.min(inset, Math.floor(sw / 2) - 1, Math.floor(sh / 2) - 1);
  const X = px(x);
  const Y = px(y);
  const W = px(w);
  const H = px(h);
  const cw = W - 2 * i; // centre span (dest)
  const ch = H - 2 * i;
  const scw = sw - 2 * i; // centre span (src)
  const sch = sh - 2 * i;
  // corners
  ctx.drawImage(img, 0, 0, i, i, X, Y, i, i);
  ctx.drawImage(img, sw - i, 0, i, i, X + W - i, Y, i, i);
  ctx.drawImage(img, 0, sh - i, i, i, X, Y + H - i, i, i);
  ctx.drawImage(img, sw - i, sh - i, i, i, X + W - i, Y + H - i, i, i);
  // edges
  if (cw > 0) {
    ctx.drawImage(img, i, 0, scw, i, X + i, Y, cw, i);
    ctx.drawImage(img, i, sh - i, scw, i, X + i, Y + H - i, cw, i);
  }
  if (ch > 0) {
    ctx.drawImage(img, 0, i, i, sch, X, Y + i, i, ch);
    ctx.drawImage(img, sw - i, i, i, sch, X + W - i, Y + i, i, ch);
  }
  // centre
  if (cw > 0 && ch > 0) {
    ctx.drawImage(img, i, i, scw, sch, X + i, Y + i, cw, ch);
  }
}

/**
 * Parchment panel (9-sliced `panel.png`) in the current transform. Falls back
 * to a flat parchment rect + border until the image lands.
 */
export function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const img = ensure(`${SHEET}/panel.png`);
  if (img) {
    nineSlice(ctx, img, x, y, w, h, 8);
  } else {
    ctx.fillStyle = "#4a3225";
    ctx.fillRect(px(x), px(y), px(w), px(h));
    ctx.fillStyle = "#eec39a";
    ctx.fillRect(px(x) + 1, px(y) + 1, px(w) - 2, px(h) - 2);
  }
}

/** Which `btn*.png` skin a button uses. */
export type ButtonStyle = "tan" | "blue" | "dark";

export interface ButtonOpts {
  /** Skin (default "tan"). */
  style?: ButtonStyle;
  /** Draw nudged 1px down (tap feedback / toggled-on look). */
  pressed?: boolean;
  /** Label size (default 6). */
  textSize?: PixelFontSize;
  /** Label color (default ink, or cream on "dark"/"blue"-pressed). */
  color?: string;
}

const BTN_SRC: Record<ButtonStyle, string> = {
  tan: `${SHEET}/btn.png`,
  blue: `${SHEET}/btn-blue.png`,
  dark: `${SHEET}/btn-dark.png`,
};

/**
 * Draw a button (9-sliced `btn*.png`) with a centered PressStart2P label, in
 * the current transform. Pass `label: ""` for icon buttons and draw the icon
 * over the returned rect. Returns `r` unchanged.
 */
export function button(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  opts: ButtonOpts = {},
): Rect {
  const style = opts.style ?? "tan";
  const off = opts.pressed ? 1 : 0;
  const img = ensure(BTN_SRC[style]);
  if (img) {
    nineSlice(ctx, img, r.x, r.y + off, r.w, r.h, 8);
  } else {
    ctx.fillStyle = style === "dark" ? "#8a5a34" : "#f0d0a0";
    ctx.fillRect(px(r.x), px(r.y + off), px(r.w), px(r.h));
  }
  if (label) {
    const size = opts.textSize ?? 6;
    const color = opts.color ?? (style === "dark" ? "#f5e5c5" : "#2a2140");
    drawText(ctx, label, r.x + r.w / 2, r.y + off + (r.h - size) / 2, {
      size,
      color,
      align: "center",
    });
  }
  return r;
}

/** Width a text button needs for `label` (label + comfy 9-slice padding). */
export function buttonWidth(label: string, size: PixelFontSize = 6): number {
  return measure(label, size) + 14;
}
