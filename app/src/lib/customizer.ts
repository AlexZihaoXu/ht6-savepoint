/**
 * Modular character customizer — atlas math + persistence (diamondpixals).
 *
 * The parts sheet (`public/assets/customizer/parts.png`, 256×256) is a grid
 * of 8 columns × 6 content strips: two strips of HEADS, two of BODIES and
 * two of LEGS — 16 parts per slot. The strips are NOT on a uniform 32px
 * grid; each band was measured off the atlas (transparent-gap scan):
 *
 *   heads A rows 6–44 (chin at row 35) · heads B rows 45–76 (chin 71)
 *   bodies A rows 81–127 · bodies B rows 131–166 (both bottom-aligned — the
 *     strip's last row IS the waist cut)
 *   legs A rows 174–209 (waist 178, feet 208) · legs B rows 214–249
 *     (waist 214, feet 249)
 *
 * Assembly stacks the three parts on a 32×96 canvas anchored at the FEET
 * (canvas bottom row): the legs' waist row sets the waistline, the body's
 * bottom row hangs `BODY_DROP` px over it (garment over pants), and the
 * head's chin row sits `CHIN_DROP` px below the body's shoulder top so the
 * chin overlaps the collar. Paint order legs → body → head. All integer
 * source-pixel math — same parts always compose the identical character.
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

/** A source rect plus its destination row on the 32×96 assembly canvas. */
export interface CharacterLayer extends SourceRect {
  slot: Slot;
  y: number;
}

export const SHEET_URL = "/assets/customizer/parts.png";
export const SHEET_W = 256;
export const SHEET_H = 256;

/** Assembled-character canvas, feet on the bottom row. */
export const CANVAS_W = 32;
export const CANVAS_H = 96;

export const SLOTS: readonly Slot[] = ["head", "body", "legs"];
export const PART_COUNTS: Record<Slot, number> = {
  head: 16,
  body: 16,
  legs: 16,
};

/** Starter combo when nothing is saved yet. */
export const DEFAULT_PARTS: CharacterParts = { head: 0, body: 0, legs: 0 };

const COLS = 8;
const CELL_W = 32;

/* Per-strip bands, measured from the atlas (see module comment). `chin` /
   `shoulder` / `waist` / `feet` are strip-local rows (0 = strip top). */
const HEAD_STRIPS = [
  { sy: 6, sh: 39, chin: 29 },
  { sy: 45, sh: 32, chin: 26 },
];
const BODY_STRIPS = [
  { sy: 81, sh: 47, shoulder: 13 },
  { sy: 131, sh: 36, shoulder: 1 },
];
const LEGS_STRIPS = [
  { sy: 174, sh: 36, waist: 4, feet: 34 },
  { sy: 214, sh: 36, waist: 0, feet: 35 },
];

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

/** Typed strip + column lookup — each slot keeps its own strip shape. */
function pick<S>(strips: readonly S[], slot: Slot, index: number) {
  const i = normalizePart(slot, index);
  return { col: i % COLS, strip: strips[Math.floor(i / COLS)] };
}
const headOf = (i: number) => pick(HEAD_STRIPS, "head", i);
const bodyOf = (i: number) => pick(BODY_STRIPS, "body", i);
const legsOf = (i: number) => pick(LEGS_STRIPS, "legs", i);

/** Source rect of one part cell — what a picker thumbnail shows. */
export function partRect(slot: Slot, index: number): SourceRect {
  const { col, strip } =
    slot === "head"
      ? headOf(index)
      : slot === "body"
        ? bodyOf(index)
        : legsOf(index);
  return { sx: col * CELL_W, sy: strip.sy, sw: CELL_W, sh: strip.sh };
}

/** Tallest strip of a slot — uniform picker-thumbnail box height. */
export function slotBoxHeight(slot: Slot): number {
  const strips =
    slot === "head" ? HEAD_STRIPS : slot === "body" ? BODY_STRIPS : LEGS_STRIPS;
  return Math.max(...strips.map((s) => s.sh));
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
  const bodyY = waist + BODY_DROP - (b.strip.sh - 1); // bottom row = waist cut
  const headY = bodyY + b.strip.shoulder + CHIN_DROP - h.strip.chin;

  return [
    { slot: "legs", ...partRect("legs", parts.legs), y: legsY },
    { slot: "body", ...partRect("body", parts.body), y: bodyY },
    { slot: "head", ...partRect("head", parts.head), y: headY },
  ];
}

/** Stepper helper: move one slot by ±delta, wrapping around the 16 parts. */
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
