import { beforeEach, describe, expect, it } from "vitest";
import {
  AVATAR_KEY,
  CANVAS_H,
  CANVAS_W,
  characterLayers,
  clearAvatar,
  DEFAULT_PARTS,
  loadAvatar,
  normalizePart,
  PART_COUNTS,
  partRect,
  saveAvatar,
  SHEET_H,
  SHEET_W,
  SLOTS,
  slotBoxHeight,
  stepPart,
} from "./customizer";

describe("customizer atlas math", () => {
  it("exposes the v2 sheet's distinct part counts (dupes skipped)", () => {
    expect(PART_COUNTS).toEqual({ head: 32, body: 28, legs: 28 });
  });

  it("assembles the strip-A starter combo at the measured offsets", () => {
    // legs feet(18) on row 51 → legsY 33, waist 33; body waist-cut(16)
    // hangs 2px over the waist → bodyY 19; chin(18) lands 3px below
    // shoulder(0) → headY 4. 18px-wide cells center at x=1.
    expect(characterLayers({ head: 0, body: 0, legs: 0 })).toEqual([
      { slot: "legs", sx: 0, sy: 153, sw: 18, sh: 19, x: 1, y: 33 },
      { slot: "body", sx: 0, sy: 110, sw: 18, sh: 17, x: 1, y: 19 },
      { slot: "head", sx: 0, sy: 0, sw: 18, sh: 20, x: 1, y: 4 },
    ]);
  });

  it("assembles a cross-strip combo (head C / body B / legs B)", () => {
    // head 26 = strip C col 0 (sy 40, sh 21, chin 19) → headY 3;
    // body 14 = shirts strip col 0 (sy 128, sh 19, waist 16) → bodyY 19.
    expect(characterLayers({ head: 26, body: 14, legs: 14 })).toEqual([
      { slot: "legs", sx: 0, sy: 173, sw: 18, sh: 19, x: 1, y: 33 },
      { slot: "body", sx: 0, sy: 128, sw: 18, sh: 19, x: 1, y: 19 },
      { slot: "head", sx: 0, sy: 40, sw: 18, sh: 21, x: 1, y: 3 },
    ]);
  });

  it("maps columns onto the fractional 14-col pitch (18/19px cells)", () => {
    // col 1 spans x 18–36 (19px); col 6 starts at round(6·256/14) = 110.
    expect(partRect("head", 1)).toEqual({ sx: 18, sy: 0, sw: 19, sh: 20 });
    expect(partRect("body", 6)).toEqual({ sx: 110, sy: 110, sw: 18, sh: 17 });
    // head 20 = strip B's 7th kept col (col 6 — B skips nothing until 7).
    expect(partRect("head", 20)).toEqual({ sx: 110, sy: 20, sw: 18, sh: 20 });
  });

  it("keeps every part cell inside the 256×256 sheet", () => {
    for (const slot of SLOTS) {
      for (let i = 0; i < PART_COUNTS[slot]; i++) {
        const r = partRect(slot, i);
        expect(r.sx).toBeGreaterThanOrEqual(0);
        expect(r.sy).toBeGreaterThanOrEqual(0);
        expect(r.sx + r.sw).toBeLessThanOrEqual(SHEET_W);
        expect(r.sy + r.sh).toBeLessThanOrEqual(SHEET_H);
        expect(r.sh).toBeLessThanOrEqual(slotBoxHeight(slot));
      }
    }
  });

  it("keeps every combo fully on the canvas", () => {
    for (let head = 0; head < PART_COUNTS.head; head++)
      for (let body = 0; body < PART_COUNTS.body; body += 5)
        for (let legs = 0; legs < PART_COUNTS.legs; legs += 3) {
          for (const l of characterLayers({ head, body, legs })) {
            expect(l.y).toBeGreaterThanOrEqual(0);
            expect(l.y + l.sh).toBeLessThanOrEqual(CANVAS_H);
            expect(l.x).toBeGreaterThanOrEqual(0);
            expect(l.x + l.sw).toBeLessThanOrEqual(CANVAS_W);
          }
        }
  });

  it("head always paints over body over legs, chin overlapping the collar", () => {
    const [legs, body, head] = characterLayers({ head: 4, body: 12, legs: 7 });
    expect(legs.slot).toBe("legs");
    expect(body.slot).toBe("body");
    expect(head.slot).toBe("head");
    // the joints overlap (no gaps): each upper layer reaches past the next
    expect(head.y + head.sh).toBeGreaterThan(body.y);
    expect(body.y + body.sh).toBeGreaterThan(legs.y);
  });

  it("wraps stepper moves and out-of-range indices", () => {
    expect(normalizePart("head", 32)).toBe(0);
    expect(normalizePart("head", -1)).toBe(31);
    expect(normalizePart("legs", 35)).toBe(7);
    expect(stepPart({ head: 31, body: 0, legs: 0 }, "head", 1)).toEqual({
      head: 0,
      body: 0,
      legs: 0,
    });
    expect(stepPart({ head: 0, body: 0, legs: 0 }, "body", -1)).toEqual({
      head: 0,
      body: 27,
      legs: 0,
    });
  });
});

describe("customizer persistence", () => {
  beforeEach(() => window.localStorage.clear());

  it("returns null when nothing is saved", () => {
    expect(loadAvatar()).toBeNull();
  });

  it("round-trips a saved character under the savepoint.avatar key", () => {
    saveAvatar({ head: 3, body: 12, legs: 7 });
    expect(AVATAR_KEY).toBe("savepoint.avatar");
    expect(window.localStorage.getItem(AVATAR_KEY)).toBeTruthy();
    expect(loadAvatar()).toEqual({ head: 3, body: 12, legs: 7 });
  });

  it("treats corrupt or wrong-shaped payloads as unset", () => {
    window.localStorage.setItem(AVATAR_KEY, "not json{");
    expect(loadAvatar()).toBeNull();
    window.localStorage.setItem(AVATAR_KEY, JSON.stringify({ head: "x" }));
    expect(loadAvatar()).toBeNull();
    window.localStorage.setItem(AVATAR_KEY, JSON.stringify([1, 2, 3]));
    expect(loadAvatar()).toBeNull();
  });

  it("wraps out-of-range saved indices instead of dropping the save", () => {
    window.localStorage.setItem(
      AVATAR_KEY,
      JSON.stringify({ head: 40, body: -2, legs: 5 }),
    );
    expect(loadAvatar()).toEqual({ head: 8, body: 26, legs: 5 });
  });

  it("clears the saved character", () => {
    saveAvatar(DEFAULT_PARTS);
    clearAvatar();
    expect(loadAvatar()).toBeNull();
  });
});
