/**
 * Modular character customizer — atlas math + persistence (diamondpixals).
 *
 * The v2 parts sheet (`public/assets/customizer/parts.png`, 256×256) is a
 * denser 14-column grid on a FRACTIONAL ~18.29px pitch — the art was
 * resampled non-integerly, so column edges are `round(col·256/14)` and
 * cells are 18–19px wide. Vertically it holds 12 content strips, several
 * of which are near-duplicates (same art re-rendered on a different
 * subpixel phase — visually identical, not pixel-identical):
 *
 *   heads  A y0–19 · B y20–39 · C y40–60 (tall hats poke 1px higher)
 *          y61–80 duplicates A, y82–106 duplicates C — both skipped
 *   bodies jackets y110–126 · shirts/dresses y128–146 (dress hems hang
 *          2px below the common waist cut at local row 16)
 *   legs   A y153–171 · B y173–191; y197/217/237 duplicate A/B/B — skipped
 *
 * Duplicate CELLS inside the kept head strips are skipped too (strip B
 * repeats A's cols 7+11; strip C only adds 6 new heads), leaving 32
 * distinct heads, 28 bodies and 28 legs.
 *
 * Assembly stacks the three parts on a 20×52 canvas anchored at the FEET
 * (canvas bottom row): the legs' waist row sets the waistline, the body's
 * waist-cut row hangs `BODY_DROP` px over it (garment over pants), and the
 * head's chin row sits `CHIN_DROP` px below the body's shoulder top so the
 * chin overlaps the collar. Layers are centered horizontally on the canvas.
 * Paint order legs → body → head. All integer source-pixel math — same
 * parts always compose the identical character.
 */

export type Slot = "head" | "body" | "legs";

/** One picked part index per slot — the whole custom character. */
export interface CharacterParts {
  head: number;
  body: number;
  legs: number;
}

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** A source rect plus its destination cell on the 20×52 assembly canvas. */
export interface CharacterLayer extends SourceRect {
  slot: Slot;
  x: number;
  y: number;
}

export const SHEET_URL = "/assets/customizer/parts.png";
export const SHEET_W = 256;
export const SHEET_H = 256;

/** Assembled-character canvas, feet on the bottom row. */
export const CANVAS_W = 20;
export const CANVAS_H = 52;

export const SLOTS: readonly Slot[] = ["head", "body", "legs"];

/** Starter combo when nothing is saved yet. */
export const DEFAULT_PARTS: CharacterParts = { head: 0, body: 0, legs: 0 };

const COLS = 14;

/** Column left edge — the fractional pitch means widths alternate 18/19px. */
function cellX(col: number): number {
  return Math.round((col * SHEET_W) / COLS);
}

/* Per-strip bands, measured from the atlas (see module comment). `chin` /
   `shoulder` / `waist` / `feet` are strip-local rows (0 = strip top). */
const HEAD_STRIPS = [
  { sy: 0, sh: 20, chin: 18 },
  { sy: 20, sh: 20, chin: 18 },
  { sy: 40, sh: 21, chin: 19 },
];
const BODY_STRIPS = [
  { sy: 110, sh: 17, shoulder: 0, waist: 16 },
  { sy: 128, sh: 19, shoulder: 0, waist: 16 },
];
const LEGS_STRIPS = [
  { sy: 153, sh: 19, waist: 0, feet: 18 },
  { sy: 173, sh: 19, waist: 0, feet: 18 },
];

/** One selectable part: which strip it lives in and its grid column. */
interface AtlasPart<S> {
  strip: S;
  col: number;
}

function stripParts<S>(strip: S, cols: readonly number[]): AtlasPart<S>[] {
  return cols.map((col) => ({ strip, col }));
}

const ALL_COLS = Array.from({ length: COLS }, (_, c) => c);

/* Explicit part lists — duplicated cells in the sheet are skipped here
   (measured by perceptual cell-dedupe; see module comment). */
const HEAD_PARTS = [
  ...stripParts(HEAD_STRIPS[0], ALL_COLS),
  ...stripParts(HEAD_STRIPS[1], [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 13]),
  ...stripParts(HEAD_STRIPS[2], [0, 1, 2, 4, 7, 11]),
];
const BODY_PARTS = [
  ...stripParts(BODY_STRIPS[0], ALL_COLS),
  ...stripParts(BODY_STRIPS[1], ALL_COLS),
];
const LEGS_PARTS = [
  ...stripParts(LEGS_STRIPS[0], ALL_COLS),
  ...stripParts(LEGS_STRIPS[1], ALL_COLS),
];

export const PART_COUNTS: Record<Slot, number> = {
  head: HEAD_PARTS.length, // 32
  body: BODY_PARTS.length, // 28
  legs: LEGS_PARTS.length, // 28
};

/** Garment rows hanging over the legs' waist (body paints above legs). */
const BODY_DROP = 2;
/** Chin rows overlapping the body's collar (head paints above body). */
const CHIN_DROP = 3;

/** Wrap any integer into [0, count) — steppers cycle, bad data can't escape
    the sheet. */
export function normalizePart(slot: Slot, index: number): number {
  const n = PART_COUNTS[slot];
  return ((Math.trunc(index) % n) + n) % n;
}

const headOf = (i: number) => HEAD_PARTS[normalizePart("head", i)];
const bodyOf = (i: number) => BODY_PARTS[normalizePart("body", i)];
const legsOf = (i: number) => LEGS_PARTS[normalizePart("legs", i)];

function rectOf(part: AtlasPart<{ sy: number; sh: number }>): SourceRect {
  const sx = cellX(part.col);
  return {
    sx,
    sy: part.strip.sy,
    sw: cellX(part.col + 1) - sx,
    sh: part.strip.sh,
  };
}

/** Source rect of one part cell — what a picker thumbnail shows. */
export function partRect(slot: Slot, index: number): SourceRect {
  return rectOf(
    slot === "head"
      ? headOf(index)
      : slot === "body"
        ? bodyOf(index)
        : legsOf(index),
  );
}

/** Tallest strip of a slot — uniform picker-thumbnail box height. */
export function slotBoxHeight(slot: Slot): number {
  const strips =
    slot === "head" ? HEAD_STRIPS : slot === "body" ? BODY_STRIPS : LEGS_STRIPS;
  return Math.max(...strips.map((s) => s.sh));
}

/** Center an 18/19px-wide cell on the canvas. */
function centerX(sw: number): number {
  return Math.floor((CANVAS_W - sw) / 2);
}

/**
 * The three positioned layers of an assembled character, in paint order
 * (legs under body under head). Deterministic: same parts → same layers.
 */
export function characterLayers(parts: CharacterParts): CharacterLayer[] {
  const h = headOf(parts.head);
  const b = bodyOf(parts.body);
  const l = legsOf(parts.legs);

  const legsY = CANVAS_H - 1 - l.strip.feet; // feet on the canvas bottom row
  const waist = legsY + l.strip.waist;
  const bodyY = waist + BODY_DROP - b.strip.waist; // waist-cut row over waist
  const headY = bodyY + b.strip.shoulder + CHIN_DROP - h.strip.chin;

  const place = (slot: Slot, r: SourceRect, y: number): CharacterLayer => ({
    slot,
    ...r,
    x: centerX(r.sw),
    y,
  });
  return [
    place("legs", rectOf(l), legsY),
    place("body", rectOf(b), bodyY),
    place("head", rectOf(h), headY),
  ];
}

/** Stepper helper: move one slot by ±delta, wrapping around the parts. */
export function stepPart(
  parts: CharacterParts,
  slot: Slot,
  delta: number,
): CharacterParts {
  return { ...parts, [slot]: normalizePart(slot, parts[slot] + delta) };
}

/* ---- persistence (the saved "You" avatar) -------------------------------- */

export const AVATAR_KEY = "savepoint.avatar";

/**
 * The saved custom avatar, or null when unset/corrupt — null means "no
 * custom character yet" and callers fall back to the parametric sprite.
 * Out-of-range indices are wrapped, never rejected (a future smaller sheet
 * still resolves to SOME character instead of dropping the save).
 */
export function loadAvatar(): CharacterParts | null {
  try {
    const raw = window.localStorage.getItem(AVATAR_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const o = v as Record<string, unknown>;
    if (
      !Number.isFinite(o.head) ||
      !Number.isFinite(o.body) ||
      !Number.isFinite(o.legs)
    )
      return null;
    return {
      head: normalizePart("head", o.head as number),
      body: normalizePart("body", o.body as number),
      legs: normalizePart("legs", o.legs as number),
    };
  } catch {
    return null; // storage blocked or JSON corrupt — behave as unset
  }
}

export function saveAvatar(parts: CharacterParts): void {
  try {
    window.localStorage.setItem(
      AVATAR_KEY,
      JSON.stringify({
        head: normalizePart("head", parts.head),
        body: normalizePart("body", parts.body),
        legs: normalizePart("legs", parts.legs),
      }),
    );
  } catch {
    // storage full/blocked — the customizer still works for the session
  }
}

export function clearAvatar(): void {
  try {
    window.localStorage.removeItem(AVATAR_KEY);
  } catch {
    // ignore — nothing to clear
  }
}
