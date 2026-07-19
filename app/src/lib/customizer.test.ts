import { beforeEach, describe, expect, it } from "vitest";
import {
  AVATAR_KEY,
  CANVAS_H,
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
  it("assembles the strip-A starter combo at the measured offsets", () => {
    // legs feet(34) on row 95 → legsY 61, waist 65; body bottom hangs 2px
    // over the waist → bodyY 21; chin(29) lands 3px below shoulder(13) → 8.
    expect(characterLayers({ head: 0, body: 0, legs: 0 })).toEqual([
      { slot: "legs", sx: 0, sy: 174, sw: 32, sh: 36, y: 61 },
      { slot: "body", sx: 0, sy: 81, sw: 32, sh: 47, y: 21 },
      { slot: "head", sx: 0, sy: 6, sw: 32, sh: 39, y: 8 },
    ]);
  });

  it("assembles a strip-B combo (indices 8+ map to the second strip)", () => {
    expect(characterLayers({ head: 9, body: 8, legs: 9 })).toEqual([
      { slot: "legs", sx: 32, sy: 214, sw: 32, sh: 36, y: 60 },
      { slot: "body", sx: 0, sy: 131, sw: 32, sh: 36, y: 27 },
      { slot: "head", sx: 32, sy: 45, sw: 32, sh: 32, y: 5 },
    ]);
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

  it("keeps every combo on the canvas (1px legs-A overhang allowed)", () => {
    for (let head = 0; head < PART_COUNTS.head; head++)
      for (let body = 0; body < PART_COUNTS.body; body += 5)
        for (let legs = 0; legs < PART_COUNTS.legs; legs += 3) {
          for (const l of characterLayers({ head, body, legs })) {
            expect(l.y).toBeGreaterThanOrEqual(0);
            expect(l.y + l.sh).toBeLessThanOrEqual(CANVAS_H + 1);
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
    expect(normalizePart("head", 16)).toBe(0);
    expect(normalizePart("head", -1)).toBe(15);
    expect(normalizePart("legs", 35)).toBe(3);
    expect(stepPart({ head: 15, body: 0, legs: 0 }, "head", 1)).toEqual({
      head: 0,
      body: 0,
      legs: 0,
    });
    expect(stepPart({ head: 0, body: 0, legs: 0 }, "body", -1)).toEqual({
      head: 0,
      body: 15,
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
      JSON.stringify({ head: 20, body: -2, legs: 5 }),
    );
    expect(loadAvatar()).toEqual({ head: 4, body: 14, legs: 5 });
  });

  it("clears the saved character", () => {
    saveAvatar(DEFAULT_PARTS);
    clearAvatar();
    expect(loadAvatar()).toBeNull();
  });
});
