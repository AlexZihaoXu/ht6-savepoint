import { describe, expect, it } from "vitest";
import type { ApiPerson } from "./api";
import {
  filterPeople,
  groupContacts,
  RECENT_MS,
  sectionLetter,
  sortByRecent,
} from "./contacts";

function person(over: Partial<ApiPerson> & { local_id: string }): ApiPerson {
  return {
    name: null,
    avatar_params: {
      skin_tone: "#e0b088",
      hair_color: "#3a2a1a",
      hair_style: "short",
      glasses: false,
      hat: null,
      shirt_color: "#7ebc49",
    },
    tags: [],
    favorite: false,
    first_seen: null,
    last_seen: null,
    notes: null,
    bio: null,
    sprite: null,
    ...over,
  };
}

describe("sectionLetter", () => {
  it("uses the uppercased first letter", () => {
    expect(sectionLetter("Priya")).toBe("P");
    expect(sectionLetter("zoe")).toBe("Z");
    expect(sectionLetter("  ana")).toBe("A");
  });

  it("folds accents onto their base letter", () => {
    expect(sectionLetter("Émile")).toBe("E");
    expect(sectionLetter("Åsa")).toBe("A");
  });

  it("buckets digits, symbols and empty names under #", () => {
    expect(sectionLetter("878")).toBe("#");
    expect(sectionLetter("(unknown)")).toBe("#");
    expect(sectionLetter("")).toBe("#");
  });
});

describe("filterPeople", () => {
  const now = Date.parse("2026-07-18T12:00:00Z");
  const fav = person({ local_id: "a", favorite: true });
  const fresh = person({ local_id: "b", last_seen: "2026-07-17T12:00:00Z" });
  const stale = person({ local_id: "c", last_seen: "2026-07-10T12:00:00Z" });
  const never = person({ local_id: "d" });
  const all = [fav, fresh, stale, never];

  it("passes everyone through for 'all'", () => {
    expect(filterPeople(all, "all", now)).toEqual(all);
  });

  it("keeps only favorites", () => {
    expect(filterPeople(all, "favorites", now)).toEqual([fav]);
  });

  it("keeps only people seen within the recency window", () => {
    expect(filterPeople(all, "recents", now)).toEqual([fresh]);
    // boundary: exactly RECENT_MS ago is no longer "recent"
    const edge = person({
      local_id: "e",
      last_seen: new Date(now - RECENT_MS).toISOString(),
    });
    expect(filterPeople([edge], "recents", now)).toEqual([]);
  });
});

describe("groupContacts", () => {
  const names = (people: ApiPerson[]) => people.map((p) => p.local_id);

  it("groups by letter, sections A→Z with # last", () => {
    const list = [
      person({ local_id: "zoe", name: "Zoe" }),
      person({ local_id: "878", name: "878 Neighbor" }),
      person({ local_id: "ana", name: "ana" }),
      person({ local_id: "alex", name: "Alex" }),
    ];
    const sections = groupContacts(list, (p) => p.name ?? "");
    expect(sections.map((s) => s.letter)).toEqual(["A", "Z", "#"]);
    expect(names(sections[0].items)).toEqual(["alex", "ana"]);
    expect(names(sections[2].items)).toEqual(["878"]);
  });

  it("sorts inside a section case-insensitively", () => {
    const list = [
      person({ local_id: "b", name: "adam" }),
      person({ local_id: "a", name: "Abby" }),
    ];
    const [a] = groupContacts(list, (p) => p.name ?? "");
    expect(names(a.items)).toEqual(["a", "b"]);
  });

  it("returns no sections for an empty list", () => {
    expect(groupContacts([], () => "")).toEqual([]);
  });
});

describe("sortByRecent", () => {
  it("orders most-recently-seen first, never-seen last A–Z", () => {
    const list = [
      person({ local_id: "old", last_seen: "2026-07-01T00:00:00Z" }),
      person({ local_id: "zz-never" }),
      person({ local_id: "new", last_seen: "2026-07-18T00:00:00Z" }),
      person({ local_id: "aa-never" }),
    ];
    expect(
      sortByRecent(list, (p) => p.local_id).map((p) => p.local_id),
    ).toEqual(["new", "old", "aa-never", "zz-never"]);
  });

  it("does not mutate its input", () => {
    const list = [
      person({ local_id: "a", last_seen: "2026-07-01T00:00:00Z" }),
      person({ local_id: "b", last_seen: "2026-07-18T00:00:00Z" }),
    ];
    sortByRecent(list, (p) => p.local_id);
    expect(list.map((p) => p.local_id)).toEqual(["a", "b"]);
  });
});
