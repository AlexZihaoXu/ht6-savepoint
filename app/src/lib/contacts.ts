/**
 * Pure helpers for the phone-contacts style People list (waterprism's
 * "contacts app" request, 2026-07-18): filtering, recency sort, and the
 * A–Z section grouping with a trailing "#" bucket, iOS-contacts style.
 */

import type { ApiPerson } from "./api";

export type PeopleFilter = "all" | "recents" | "favorites";
export type PeopleSort = "az" | "recent";

/** "Recents" = seen within the last few days. */
export const RECENT_MS = 3 * 86400000;

/**
 * Whether a last-seen timestamp is recent enough to surface (within the last
 * few days). Drives the People pop-up's far-right "seen …" line, which shows
 * only for people you've run into lately. `now` is injectable for tests.
 */
export function isRecentlySeen(
  lastSeen: string | null,
  now = Date.now(),
): boolean {
  return !!lastSeen && now - new Date(lastSeen).getTime() < RECENT_MS;
}

/**
 * The section header a display name files under: its first letter (accents
 * folded, so "Émile" files under E), else "#" for digits/symbols/empty.
 */
export function sectionLetter(name: string): string {
  const ch = name
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .charAt(0)
    .toUpperCase();
  return ch >= "A" && ch <= "Z" ? ch : "#";
}

/** Apply one of the People filters. `now` is injectable for tests. */
export function filterPeople(
  people: ApiPerson[],
  filter: PeopleFilter,
  now = Date.now(),
): ApiPerson[] {
  if (filter === "favorites") return people.filter((p) => p.favorite);
  if (filter === "recents")
    return people.filter((p) => isRecentlySeen(p.last_seen, now));
  return people;
}

export interface ContactSection<T> {
  letter: string;
  items: T[];
}

/**
 * Group into alphabetical sections sorted A→Z with the "#" bucket last;
 * items inside a section sort by name, case-insensitively.
 */
export function groupContacts<T>(
  items: T[],
  nameOf: (item: T) => string,
): ContactSection<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const letter = sectionLetter(nameOf(item));
    const bucket = buckets.get(letter);
    if (bucket) bucket.push(item);
    else buckets.set(letter, [item]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)))
    .map(([letter, list]) => ({
      letter,
      items: [...list].sort((a, b) =>
        nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base" }),
      ),
    }));
}

/** Most recently seen first; never-seen people sink to the end, A–Z there. */
export function sortByRecent<T extends { last_seen: string | null }>(
  items: T[],
  nameOf: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => {
    const ta = a.last_seen ? new Date(a.last_seen).getTime() : -Infinity;
    const tb = b.last_seen ? new Date(b.last_seen).getTime() : -Infinity;
    if (ta !== tb) return tb - ta;
    return nameOf(a).localeCompare(nameOf(b), undefined, {
      sensitivity: "base",
    });
  });
}
