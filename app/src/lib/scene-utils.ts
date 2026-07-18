/**
 * Pure helpers for the pixel scenes: deterministic placement + fallback
 * avatars and wall-clock formatting. (Scene COMPONENTS live in scene.tsx —
 * split so component files export only components, keeping Fast Refresh happy.)
 */

import type { AvatarParams, ApiPerson } from "./api";

/** Stable 0..1 pseudo-random from a string + salt (deterministic per id). */
export function rand(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** The wearer's own character (no backend person exists for "you"). */
export const YOU_AVATAR: AvatarParams = {
  skin_tone: "fair",
  hair_color: "dark-brown",
  hair_style: "short",
  glasses: false,
  hat: null,
  shirt_color: "green",
};

const SKINS = ["porcelain", "fair", "tan", "brown", "deep"];
const HAIR_COLORS = ["black", "dark-brown", "brown", "auburn", "blonde", "red"];
const HAIR_STYLES = ["short", "medium", "long", "curly", "ponytail", "buzz"];
const SHIRTS = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "indigo",
  "violet",
];

/**
 * Deterministic stand-in avatar for ids with no `people` doc yet — e.g. the
 * diarizer's raw "Speaker N" labels, or "you". Same id → same character.
 */
export function fallbackAvatar(id: string): AvatarParams {
  if (id === "you") return YOU_AVATAR;
  const pick = <T>(arr: T[], salt: number) =>
    arr[Math.floor(rand(id, salt) * arr.length) % arr.length];
  return {
    skin_tone: pick(SKINS, 11),
    hair_color: pick(HAIR_COLORS, 22),
    hair_style: pick(HAIR_STYLES, 33),
    glasses: rand(id, 44) > 0.72,
    hat: null,
    shirt_color: pick(SHIRTS, 55),
  };
}

/** Name for an event's person_id, given the day's resolved people. */
export function nameFor(
  id: string,
  people: Map<string, ApiPerson>,
  displayName: (p: ApiPerson) => string,
): string {
  if (id === "you") return "You";
  const p = people.get(id);
  return p ? displayName(p) : id;
}

/**
 * Format an event timestamp as the wall-clock it was recorded at. Event `ts`
 * values are stored as UTC and treated as wall-clock in this prototype, so we
 * format in UTC to keep the display (and screenshots) deterministic.
 */
export function formatClock(iso: string, ampm = true): string {
  const s = new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return ampm ? s.replace(" ", "") : s.replace(/ ?[AP]M$/i, "");
}
