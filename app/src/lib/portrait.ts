/**
 * Pure param → feature mapping for the detailed dialogue PORTRAIT
 * (`detailed-sprite.tsx`) — the higher-detail rendering of the same person
 * the tiny plaza `ParametricSprite` draws. Deterministic: the same 6
 * `avatar_params` axes always resolve to the same derived palette, so both
 * art styles read as one character. Kept apart from the component so the
 * mapping unit-tests without rendering (and Fast Refresh stays happy).
 *
 * Base swatches mirror sprite.tsx (waterprism's palette,
 * design-assets/palette.md): skin ramp #e7c69f → #d0a16e → #875940 →
 * #603b33, her saturated shirt row, and the shared hair set.
 */

import type { AvatarParams } from "./api";

export const PORTRAIT_SKIN: Record<string, string> = {
  porcelain: "#f2dcbb",
  fair: "#e7c69f",
  tan: "#d0a16e",
  brown: "#875940",
  deep: "#603b33",
};

export const PORTRAIT_HAIR: Record<string, string> = {
  black: "#222033",
  "dark-brown": "#40293b",
  brown: "#603b33",
  auburn: "#875940",
  blonde: "#d8b757",
  red: "#a03c37",
  gray: "#837e85",
  white: "#cedaf9",
};

export const PORTRAIT_SHIRT: Record<string, string> = {
  red: "#ca5f66",
  orange: "#d1773a",
  yellow: "#f9f360",
  green: "#7ebc49",
  teal: "#529271",
  blue: "#7099f9",
  indigo: "#5f6dda",
  violet: "#6f4586",
};

/** Iris colour keyed on hair colour — a cozy, deterministic pairing. */
const EYE_BY_HAIR: Record<string, string> = {
  black: "#2a2634",
  "dark-brown": "#3f2e26",
  brown: "#4a3428",
  auburn: "#5c3a2e",
  blonde: "#6b4a37",
  red: "#4f5d43",
  gray: "#55606f",
  white: "#5c6b83",
};

/** Lighten (t>0) / darken (t<0) a hex colour by a fraction, clamped. */
export function shade(hex: string, t: number): string {
  const m = hex.replace("#", "");
  const n =
    m.length === 3
      ? m.split("").map((c) => parseInt(c + c, 16))
      : [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
  const adj = n.map((v) =>
    Math.max(
      0,
      Math.min(255, Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t))),
    ),
  );
  return `#${adj.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Relative luminance 0..1 of a hex colour (rec. 709 weights). */
export function luminance(hex: string): number {
  const m = hex.replace("#", "");
  const [r, g, b] =
    m.length === 3
      ? m.split("").map((c) => parseInt(c + c, 16))
      : [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Mouth colour for a skin tone: darker than light skin, lighter than deep
 * skin — so the smile always reads against the face.
 */
export function lipColorFor(skin: string): string {
  return luminance(skin) < 0.3 ? shade(skin, 0.28) : shade(skin, -0.32);
}

/** Iris colour for a hair-colour axis value (warm brown fallback). */
export function eyeColorFor(hairColor: string): string {
  return EYE_BY_HAIR[hairColor] ?? "#4a3428";
}

/** Styles that also paint a BACK layer (behind the torso). */
export function hasBackHair(style: string): boolean {
  return style === "long" || style === "ponytail";
}

export interface PortraitColors {
  skin: string;
  skinShade: string;
  skinHi: string;
  lip: string;
  hair: string;
  hairShade: string;
  hairHi: string;
  brow: string;
  eye: string;
  shirt: string;
  shirtShade: string;
  shirtHi: string;
}

/**
 * Resolve the 6 avatar axes into the portrait's full derived palette.
 * Unknown axis values fall back to the same defaults sprite.tsx uses, so the
 * two renderings can never disagree about who someone is.
 */
export function portraitColors(params: AvatarParams): PortraitColors {
  const skin = PORTRAIT_SKIN[params.skin_tone] ?? "#e7c69f";
  const hair = PORTRAIT_HAIR[params.hair_color] ?? "#40293b";
  const shirt = PORTRAIT_SHIRT[params.shirt_color] ?? "#7099f9";
  return {
    skin,
    skinShade: shade(skin, -0.14),
    skinHi: shade(skin, 0.18),
    lip: lipColorFor(skin),
    hair,
    hairShade: shade(hair, -0.18),
    hairHi: shade(hair, 0.2),
    brow: shade(hair, -0.25),
    eye: eyeColorFor(params.hair_color),
    shirt,
    shirtShade: shade(shirt, -0.16),
    shirtHi: shade(shirt, 0.15),
  };
}
