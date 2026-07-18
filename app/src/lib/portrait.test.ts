import { describe, expect, it } from "vitest";
import {
  eyeColorFor,
  hasBackHair,
  lipColorFor,
  luminance,
  PORTRAIT_HAIR,
  PORTRAIT_SHIRT,
  PORTRAIT_SKIN,
  portraitColors,
  shade,
} from "./portrait";
import type { AvatarParams } from "./api";

const P = (over: Partial<AvatarParams> = {}): AvatarParams => ({
  skin_tone: "fair",
  hair_color: "dark-brown",
  hair_style: "short",
  glasses: false,
  hat: null,
  shirt_color: "green",
  ...over,
});

describe("portrait param → feature mapping", () => {
  it("is deterministic — same avatar_params, same derived palette", () => {
    expect(portraitColors(P())).toEqual(portraitColors(P()));
    expect(portraitColors(P({ skin_tone: "deep", hair_color: "red" }))).toEqual(
      portraitColors(P({ skin_tone: "deep", hair_color: "red" })),
    );
  });

  it("resolves base swatches from waterprism's palette", () => {
    const c = portraitColors(
      P({ skin_tone: "tan", hair_color: "blonde", shirt_color: "blue" }),
    );
    expect(c.skin).toBe("#d0a16e");
    expect(c.hair).toBe("#d8b757");
    expect(c.shirt).toBe("#7099f9");
  });

  it("falls back to the plaza sprite's defaults on unknown axis values", () => {
    const c = portraitColors(
      P({ skin_tone: "??", hair_color: "??", shirt_color: "??" }),
    );
    expect(c.skin).toBe("#e7c69f");
    expect(c.hair).toBe("#40293b");
    expect(c.shirt).toBe("#7099f9");
  });

  it("derives shading darker and highlights lighter than the base", () => {
    const c = portraitColors(P());
    expect(luminance(c.skinShade)).toBeLessThan(luminance(c.skin));
    expect(luminance(c.skinHi)).toBeGreaterThan(luminance(c.skin));
    expect(luminance(c.hairShade)).toBeLessThan(luminance(c.hair));
    expect(luminance(c.hairHi)).toBeGreaterThan(luminance(c.hair));
    expect(luminance(c.shirtShade)).toBeLessThan(luminance(c.shirt));
    expect(luminance(c.shirtHi)).toBeGreaterThan(luminance(c.shirt));
    expect(luminance(c.brow)).toBeLessThan(luminance(c.hair));
  });

  it("keeps every skin / hair / shirt swatch distinct within its axis", () => {
    for (const map of [PORTRAIT_SKIN, PORTRAIT_HAIR, PORTRAIT_SHIRT]) {
      const values = Object.values(map);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("always contrasts the lip against the skin (dark skin gets a lighter lip)", () => {
    for (const skin of Object.values(PORTRAIT_SKIN)) {
      expect(lipColorFor(skin)).not.toBe(skin);
    }
    expect(luminance(lipColorFor("#603b33"))).toBeGreaterThan(
      luminance("#603b33"),
    ); // deep → lighter
    expect(luminance(lipColorFor("#e7c69f"))).toBeLessThan(
      luminance("#e7c69f"),
    ); // fair → darker
  });

  it("pairs every hair colour with an iris colour (warm-brown fallback)", () => {
    for (const hair of Object.keys(PORTRAIT_HAIR)) {
      expect(eyeColorFor(hair)).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(eyeColorFor("no-such-colour")).toBe("#4a3428");
  });

  it("only long + ponytail paint a back-hair layer", () => {
    expect(hasBackHair("long")).toBe(true);
    expect(hasBackHair("ponytail")).toBe(true);
    for (const s of ["short", "medium", "curly", "buzz", "??"]) {
      expect(hasBackHair(s)).toBe(false);
    }
  });

  it("shade lightens, darkens, and clamps", () => {
    expect(shade("#808080", 0)).toBe("#808080");
    expect(luminance(shade("#808080", 0.2))).toBeGreaterThan(
      luminance("#808080"),
    );
    expect(luminance(shade("#808080", -0.2))).toBeLessThan(
      luminance("#808080"),
    );
    expect(shade("#ffffff", 0.5)).toBe("#ffffff");
    expect(shade("#000000", -0.5)).toBe("#000000");
    expect(shade("#fff", 0)).toBe("#ffffff"); // 3-digit form
  });
});
