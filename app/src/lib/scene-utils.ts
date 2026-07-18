/**
 * Pure helpers for the pixel scenes: deterministic placement + fallback
 * avatars and wall-clock formatting. (Scene COMPONENTS live in scene.tsx —
 * split so component files export only components, keeping Fast Refresh happy.)
 */

import type { ApiEvent, AvatarParams, ApiPerson } from "./api";

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

/**
 * Who "you" are talking to at event `activeIdx`: the nearest non-"you"
 * person at or before it (when you speak, that's whoever spoke last), else
 * the next one coming up (a day that opens with you talking). Null only
 * when the day has no other people at all.
 */
export function partnerAt(
  events: ApiEvent[],
  activeIdx: number,
): string | null {
  for (let i = Math.min(activeIdx, events.length - 1); i >= 0; i--) {
    const id = events[i]?.person_id;
    if (id && id !== "you") return id;
  }
  for (let i = activeIdx + 1; i < events.length; i++) {
    const id = events[i].person_id;
    if (id !== "you") return id;
  }
  return null;
}

/**
 * The timestamp (epoch ms) of the event nearest `targetMs` — used by the
 * day scene's `?t=` deep link to land the scrubber ON a conversation moment
 * (a person's profile links straight into their chat). Ties go to the
 * earlier event. Null when there are no events or the target is NaN.
 */
export function nearestEventTs(
  events: ApiEvent[],
  targetMs: number,
): number | null {
  if (!events.length || Number.isNaN(targetMs)) return null;
  let best: number | null = null;
  for (const e of events) {
    const ts = new Date(e.ts).getTime();
    if (best === null || Math.abs(ts - targetMs) < Math.abs(best - targetMs))
      best = ts;
  }
  return best;
}

/** The diarizer's raw speaker labels ("Speaker 1", "speaker2", …). */
const SPEAKER_LABEL = /^speaker\s*\d+$/i;

/**
 * True when an event's `person_id` is still a raw diarization label with no
 * Person doc behind it — a speaker the user hasn't named yet. The day-view
 * nameplate becomes a tap-to-name affordance for exactly these (SAV-57).
 * (A Person whose local_id IS a speaker label counts as resolved.)
 */
export function isUnnamedSpeaker(
  personId: string,
  people: ReadonlyMap<string, unknown>,
): boolean {
  return SPEAKER_LABEL.test(personId) && !people.has(personId);
}

/**
 * The day's active line at scrub time `t`: the index of the LAST event whose
 * timestamp is at or before `t` (0 when the scrub sits before the first
 * event, or when there are no events).
 */
export function activeEventIndex(events: ApiEvent[], t: number): number {
  let idx = 0;
  for (let i = 0; i < events.length; i++) {
    if (new Date(events[i].ts).getTime() <= t) idx = i;
  }
  return idx;
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

/** "today" / "yesterday" / "n days ago" for a last-seen timestamp. */
export function relativeSeen(iso: string | null): string {
  if (!iso) return "a while ago";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `${Math.floor(days / 7)}w ago`;
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
