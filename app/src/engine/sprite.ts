/**
 * Person sprite rendering: PixelLab sheet when the person has one, a cozy
 * parametric placeholder (shirt + skin + hair from `avatar_params`) when not.
 *
 * Rules (CANVAS_SPEC): idle → `static.south` (front); walking → the
 * `walk.east` cycle at ~8 fps, mirrored horizontally when facing left.
 * Frames lazy-load through the shared asset cache — until a frame lands the
 * placeholder is drawn, so people always show.
 */

import { spriteUrl, type ApiPerson } from "../lib/api";
import { px } from "./surface";
import { ensure } from "./ui";

/** Horizontal facing while moving ("right" draws east frames as-is). */
export type Facing = "left" | "right";

export interface DrawPersonOpts {
  /** Walking? (true → walk cycle; false → front idle). Default false. */
  moving?: boolean;
  /** Mirror the walk frames when "left". Default "right". */
  facing?: Facing;
  /** Walk-cycle clock in SECONDS (advance it only while moving). Default 0. */
  phase?: number;
  /**
   * Draw height in art px. Keep it a simple ratio of the 92px tile — the
   * default 46 (=92/2) is the plaza world size.
   */
  height?: number;
}

/** Walk-cycle speed, frames per second. */
export const WALK_FPS = 8;

/** Named backend palette values → hex. Unknown names fall back sensibly. */
const SKIN: Record<string, string> = {
  fair: "#f6d6b2",
  light: "#f0c8a0",
  tan: "#d9a86c",
  medium: "#c68d5c",
  olive: "#b08d57",
  brown: "#96613a",
  deep: "#6f4428",
  dark: "#5d3a22",
};
const HAIR: Record<string, string> = {
  black: "#2a2140",
  brown: "#6b4a2b",
  red: "#c14a2e",
  auburn: "#8a3b22",
  blond: "#e6c15a",
  blonde: "#e6c15a",
  gray: "#9a9aa5",
  grey: "#9a9aa5",
  white: "#efeadf",
  blue: "#3b5fd4",
  green: "#3f8f5f",
  pink: "#d46a9f",
  purple: "#7c5cbf",
};
const SHIRT: Record<string, string> = {
  red: "#c0392b",
  orange: "#d97b29",
  gold: "#d9a520",
  yellow: "#d9c520",
  green: "#3f8f3f",
  teal: "#2e8f83",
  blue: "#3b6fd4",
  navy: "#2a3f7a",
  violet: "#7c5cbf",
  purple: "#7c5cbf",
  pink: "#d46a9f",
  brown: "#8a5a34",
  white: "#e8e2d2",
  black: "#3a3244",
  gray: "#8a8a95",
  grey: "#8a8a95",
};

function color(
  table: Record<string, string>,
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value) return fallback;
  if (value.startsWith("#")) return value;
  return table[value.toLowerCase()] ?? fallback;
}

/**
 * Draw `person` anchored BOTTOM-CENTER at (x, y) — y is the feet line.
 * Pure immediate call: pass fresh opts every frame; keep `phase` per entity
 * and advance it by dt only while moving so feet don't slide.
 */
export function drawPersonSprite(
  ctx: CanvasRenderingContext2D,
  person: ApiPerson,
  x: number,
  y: number,
  opts: DrawPersonOpts = {},
): void {
  const h = px(opts.height ?? 46);
  const moving = opts.moving ?? false;
  const facing = opts.facing ?? "right";
  const m = person.sprite;

  if (m) {
    let file = m.static.south;
    let flip = false;
    if (moving && m.walk.east.length > 0) {
      const i =
        Math.floor((opts.phase ?? 0) * WALK_FPS) % m.walk.east.length;
      file = m.walk.east[i] ?? m.static.east;
      flip = facing === "left";
    }
    const img =
      ensure(spriteUrl(person.local_id, file)) ??
      (moving ? ensure(spriteUrl(person.local_id, m.static.south)) : undefined);
    if (img) {
      const w = px((img.width / img.height) * h);
      const dx = px(x - w / 2);
      const dy = px(y - h);
      if (flip) {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(img, -dx - w, dy, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(img, dx, dy, w, h);
      }
      return;
    }
  }
  drawPlaceholder(ctx, person, x, y, h, moving, opts.phase ?? 0);
}

/**
 * The no-sprite stand-in: a chunky little body in the person's shirt color,
 * a head in their skin tone and a hair cap — deterministic per person, with a
 * 1px step-bob while moving so walkers still read as walking.
 */
function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  person: ApiPerson,
  x: number,
  y: number,
  h: number,
  moving: boolean,
  phase: number,
): void {
  const a = person.avatar_params;
  const shirt = color(SHIRT, a.shirt_color, "#7c5cbf");
  const skin = color(SKIN, a.skin_tone, "#e0b48a");
  const hair = color(HAIR, a.hair_color, "#3a2a20");

  // Proportions relative to h (h ~ a 46px world sprite; body fills ~60%).
  const bodyH = px(h * 0.34);
  const bodyW = px(h * 0.36);
  const headR = px(h * 0.16);
  const bob = moving ? (Math.floor(phase * WALK_FPS) % 2) : 0;
  const feet = px(y) - bob;
  const cx = px(x);

  // legs
  ctx.fillStyle = "#3a3244";
  ctx.fillRect(cx - px(bodyW * 0.32), feet - px(h * 0.1), px(bodyW * 0.25), px(h * 0.1));
  ctx.fillRect(cx + px(bodyW * 0.08), feet - px(h * 0.1), px(bodyW * 0.25), px(h * 0.1));
  // body
  const bodyTop = feet - px(h * 0.1) - bodyH;
  ctx.fillStyle = shirt;
  ctx.fillRect(cx - px(bodyW / 2), bodyTop, bodyW, bodyH);
  // head
  const headCY = bodyTop - headR;
  ctx.fillStyle = skin;
  ctx.fillRect(cx - headR, headCY - headR, headR * 2, headR * 2);
  // hair cap (+ a hat brim line if they wear one)
  ctx.fillStyle = a.hat ? "#8a5a34" : hair;
  ctx.fillRect(cx - headR, headCY - headR, headR * 2, Math.max(2, px(headR * 0.8)));
  // glasses
  if (a.glasses) {
    ctx.fillStyle = "#2a2140";
    ctx.fillRect(cx - headR + 1, headCY, headR * 2 - 2, 1);
  }
}
