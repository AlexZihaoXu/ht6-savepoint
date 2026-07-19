/**
 * Ground + border helpers. All draw with integer coords in the CURRENT
 * transform (world space inside `cam.withWorld`, or a scene's scaled UI
 * space) and clip to their rect, so partially-covered edge tiles never bleed.
 */

import type { Camera } from "./camera";
import { SHEET } from "./assets";
import { px } from "./surface";
import { ensure } from "./ui";

/**
 * Tile grass across the ENTIRE visible world — the "no letterbox, grass to
 * every edge" ground pass. Snaps to the tile grid in world units so the
 * pattern stays camera-stable. Flat green until the tile image lands.
 */
export function drawWorldGrass(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
): void {
  const img = ensure(`${SHEET}/grass.png`);
  cam.withWorld(ctx, () => {
    const v = cam.visibleWorld();
    if (img) {
      const tw = img.width;
      const th = img.height;
      const x0 = Math.floor(v.x0 / tw) * tw;
      const y0 = Math.floor(v.y0 / th) * th;
      const x1 = Math.ceil(v.x1 / tw) * tw;
      const y1 = Math.ceil(v.y1 / th) * th;
      fillTiles(ctx, img, x0, y0, x1 - x0, y1 - y0);
    } else {
      ctx.fillStyle = "#57a63f";
      ctx.fillRect(
        px(v.x0) - 1,
        px(v.y0) - 1,
        px(v.x1 - v.x0) + 2,
        px(v.y1 - v.y0) + 2,
      );
    }
  });
}

/** Tile `img` across rect (x,y,w,h), clipped, starting at the rect's origin. */
export function fillTiles(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const X = px(x);
  const Y = px(y);
  const W = px(w);
  const H = px(h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(X, Y, W, H);
  ctx.clip();
  for (let ty = Y; ty < Y + H; ty += img.height) {
    for (let tx = X; tx < X + W; tx += img.width) {
      ctx.drawImage(img, tx, ty);
    }
  }
  ctx.restore();
}

/**
 * A big organic patch built from one self-bordered tile (e.g.
 * `dirt-patch.png`, whose 48² sprite has a grass-fringe edge): corners 1:1,
 * edges tiled, interior tiled from the tile's core. `inset` = fringe width in
 * source px (default 10).
 */
export function tiledPatch(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  inset = 10,
): void {
  const sw = img.width;
  const sh = img.height;
  const i = Math.min(inset, Math.floor(sw / 3), Math.floor(sh / 3));
  const X = px(x);
  const Y = px(y);
  const W = px(w);
  const H = px(h);
  const coreW = sw - 2 * i;
  const coreH = sh - 2 * i;

  const tileSpan = (
    sx: number,
    sy: number,
    sSpanW: number,
    sSpanH: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void => {
    if (dw <= 0 || dh <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.clip();
    for (let ty = dy; ty < dy + dh; ty += sSpanH) {
      for (let tx = dx; tx < dx + dw; tx += sSpanW) {
        ctx.drawImage(img, sx, sy, sSpanW, sSpanH, tx, ty, sSpanW, sSpanH);
      }
    }
    ctx.restore();
  };

  // interior
  tileSpan(i, i, coreW, coreH, X + i, Y + i, W - 2 * i, H - 2 * i);
  // edges
  tileSpan(i, 0, coreW, i, X + i, Y, W - 2 * i, i); // top
  tileSpan(i, sh - i, coreW, i, X + i, Y + H - i, W - 2 * i, i); // bottom
  tileSpan(0, i, i, coreH, X, Y + i, i, H - 2 * i); // left
  tileSpan(sw - i, i, i, coreH, X + W - i, Y + i, i, H - 2 * i); // right
  // corners (1:1)
  ctx.drawImage(img, 0, 0, i, i, X, Y, i, i);
  ctx.drawImage(img, sw - i, 0, i, i, X + W - i, Y, i, i);
  ctx.drawImage(img, 0, sh - i, i, i, X, Y + H - i, i, i);
  ctx.drawImage(img, sw - i, sh - i, i, i, X + W - i, Y + H - i, i, i);
}

/** Which edges `fenceBorder` draws (all true by default). */
export interface FenceSides {
  top?: boolean;
  bottom?: boolean;
  left?: boolean;
  right?: boolean;
}

/**
 * Fence the perimeter of rect (x,y,w,h) with `fence.png` (16×24 rail
 * segments). Top/bottom rails tile horizontally, BOTTOM-aligned to the rect's
 * top/bottom edge; side rails are the same segment rotated 90°, so posts run
 * down the sides. Draw it BEFORE entities so walkers overlap the bottom rail.
 */
export function fenceBorder(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  sides: FenceSides = {},
): void {
  const { top = true, bottom = true, left = true, right = true } = sides;
  const X = px(x);
  const Y = px(y);
  const W = px(w);
  const H = px(h);
  const fw = img.width;
  const fh = img.height;

  const rail = (rx: number, ry: number, span: number): void => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx, ry - fh, span, fh);
    ctx.clip();
    for (let tx = rx; tx < rx + span; tx += fw) {
      ctx.drawImage(img, tx, ry - fh);
    }
    ctx.restore();
  };

  if (top) rail(X, Y, W);
  if (bottom) rail(X, Y + H, W);

  const sideRail = (sx: number, mirror: boolean): void => {
    const y0 = Y + Math.floor(fh / 2);
    const span = H - fh;
    if (span <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, y0, fh, span);
    ctx.clip();
    ctx.translate(sx + (mirror ? 0 : fh), y0);
    ctx.rotate(Math.PI / 2);
    if (mirror) ctx.scale(1, -1);
    for (let t = 0; t < span; t += fw) {
      ctx.drawImage(img, t, 0);
    }
    ctx.restore();
  };

  if (left) sideRail(X - Math.floor(fh / 2), false);
  if (right) sideRail(X + W - Math.floor(fh / 2), true);
}
