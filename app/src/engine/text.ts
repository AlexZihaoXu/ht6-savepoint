/**
 * Pixel-font text. PressStart2P only, at INTEGER sizes 6 / 8 / 10 px — the
 * font is a strict monospace grid (every glyph advances exactly 1em), so
 * measuring is pure arithmetic and never needs a canvas.
 *
 * `drawText` uses baseline TOP: (x, y) is the top(-left/center/right,
 * depending on `align`) corner of the text box. All coords are art px.
 */

import { px } from "./surface";

/** The only allowed pixel-font sizes (art px). */
export type PixelFontSize = 6 | 8 | 10;

export interface TextOpts {
  /** Font size in art px (default 8). */
  size?: PixelFontSize;
  /** Fill color (default ink `#2a2140`). */
  color?: string;
  /** Horizontal anchor of (x) (default "left"). */
  align?: "left" | "center" | "right";
  /** Optional 1px drop-shadow color drawn at (+1,+1). */
  shadow?: string;
  /** Global alpha for this text only (default 1). */
  alpha?: number;
}

/** Width in art px of `str` at `size` (monospace: 1em per glyph). */
export function measure(str: string, size: PixelFontSize): number {
  return str.length * size;
}

/**
 * Draw one line of PressStart2P text. Returns the drawn width (art px).
 * (x, y) is the TOP edge; `align` moves the horizontal anchor.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  opts: TextOpts = {},
): number {
  const size = opts.size ?? 8;
  const w = measure(str, size);
  let dx = px(x);
  if (opts.align === "center") dx = px(x - w / 2);
  else if (opts.align === "right") dx = px(x - w);
  const dy = px(y);
  ctx.save();
  ctx.font = `${size}px "PressStart2P"`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  if (opts.shadow) {
    ctx.fillStyle = opts.shadow;
    ctx.fillText(str, dx + 1, dy + 1);
  }
  ctx.fillStyle = opts.color ?? "#2a2140";
  ctx.fillText(str, dx, dy);
  ctx.restore();
  return w;
}

/**
 * Word-wrap `str` to lines no wider than `maxWidth` art px at `size`.
 * Splits on spaces; a single over-long word is hard-broken mid-word.
 */
export function wrapText(
  str: string,
  size: PixelFontSize,
  maxWidth: number,
): string[] {
  const maxChars = Math.max(1, Math.floor(maxWidth / size));
  const lines: string[] = [];
  for (const rawLine of str.split("\n")) {
    let line = "";
    for (const word of rawLine.split(" ")) {
      let w = word;
      // Hard-break words longer than a whole line.
      while (w.length > maxChars) {
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(w.slice(0, maxChars));
        w = w.slice(maxChars);
      }
      const candidate = line ? `${line} ${w}` : w;
      if (candidate.length > maxChars) {
        lines.push(line);
        line = w;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}
