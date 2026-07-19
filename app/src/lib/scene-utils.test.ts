import { describe, expect, it } from "vitest";
import {
  activeEventIndex,
  fallbackAvatar,
  formatClock,
  isUnnamedSpeaker,
  nearestEventTs,
  partnerAt,
  YOU_AVATAR,
} from "./scene-utils";
import type { ApiEvent } from "./api";

describe("scene helpers", () => {
  it("gives the same fallback avatar for the same id (deterministic)", () => {
    expect(fallbackAvatar("Speaker 1")).toEqual(fallbackAvatar("Speaker 1"));
    expect(fallbackAvatar("Speaker 1")).not.toEqual(
      fallbackAvatar("Speaker 2"),
    );
  });

  it("maps 'you' to the wearer's fixed avatar", () => {
    expect(fallbackAvatar("you")).toEqual(YOU_AVATAR);
  });

  it("formats event timestamps as UTC wall-clock", () => {
    expect(formatClock("2026-07-18T08:00:00Z")).toBe("8:00AM");
    expect(formatClock("2026-07-18T22:30:00Z")).toBe("10:30PM");
    expect(formatClock("2026-07-18T17:30:00Z", false)).toBe("5:30");
  });
});

describe("nearestEventTs (?t= deep link into a conversation)", () => {
  const at = (ts: string): ApiEvent => ({
    _id: `e-${ts}`,
    ts,
    person_id: "kenji",
    type: "spoke",
    text: "hi",
    emotion: null,
    place: null,
    day_id: "d",
  });
  const events = [
    at("2026-07-18T08:00:00Z"),
    at("2026-07-18T08:04:00Z"),
    at("2026-07-18T12:30:00Z"),
  ];
  const ms = (iso: string) => new Date(iso).getTime();

  it("snaps an exact event timestamp to that event", () => {
    expect(nearestEventTs(events, ms("2026-07-18T08:04:00Z"))).toBe(
      ms("2026-07-18T08:04:00Z"),
    );
  });

  it("picks the nearest event for an in-between time", () => {
    expect(nearestEventTs(events, ms("2026-07-18T08:05:30Z"))).toBe(
      ms("2026-07-18T08:04:00Z"),
    );
    expect(nearestEventTs(events, ms("2026-07-18T11:00:00Z"))).toBe(
      ms("2026-07-18T12:30:00Z"),
    );
  });

  it("clamps to the first/last event outside the day's range", () => {
    expect(nearestEventTs(events, ms("2026-07-18T01:00:00Z"))).toBe(
      ms("2026-07-18T08:00:00Z"),
    );
    expect(nearestEventTs(events, ms("2026-07-18T23:00:00Z"))).toBe(
      ms("2026-07-18T12:30:00Z"),
    );
  });

  it("is null with no events or an invalid target (fallback: day start)", () => {
    expect(nearestEventTs([], ms("2026-07-18T08:00:00Z"))).toBeNull();
    expect(nearestEventTs(events, Number.NaN)).toBeNull();
  });
});

describe("isUnnamedSpeaker (tap-to-name — SAV-57)", () => {
  const nobody = new Map<string, unknown>();

  it("flags raw diarizer labels with no Person doc", () => {
    expect(isUnnamedSpeaker("Speaker 1", nobody)).toBe(true);
    expect(isUnnamedSpeaker("speaker 2", nobody)).toBe(true);
    expect(isUnnamedSpeaker("SPEAKER12", nobody)).toBe(true);
  });

  it("resolves once a Person exists under that exact label", () => {
    const people = new Map<string, unknown>([["Speaker 1", {}]]);
    expect(isUnnamedSpeaker("Speaker 1", people)).toBe(false);
    // …but a different label on the same day still needs naming.
    expect(isUnnamedSpeaker("Speaker 2", people)).toBe(true);
  });

  it("never flags 'you', real local_ids, or non-label strings", () => {
    expect(isUnnamedSpeaker("you", nobody)).toBe(false);
    expect(isUnnamedSpeaker("a1b2c3d4", nobody)).toBe(false);
    expect(isUnnamedSpeaker("Speaker", nobody)).toBe(false);
    expect(isUnnamedSpeaker("Speaker one", nobody)).toBe(false);
    expect(isUnnamedSpeaker("Speaker 1 jr", nobody)).toBe(false);
  });
});

describe("activeEventIndex (which line the scrubber sits on)", () => {
  const at = (ts: string): ApiEvent => ({
    _id: `e-${ts}`,
    ts,
    person_id: "Speaker 1",
    type: "spoke",
    text: "hi",
    emotion: null,
    place: null,
    day_id: "d",
  });
  const events = [
    at("2026-07-10T09:00:00Z"),
    at("2026-07-10T09:05:00Z"),
    at("2026-07-10T14:00:00Z"),
  ];
  const ms = (iso: string) => new Date(iso).getTime();

  it("picks the last event at or before the scrub time", () => {
    expect(activeEventIndex(events, ms("2026-07-10T09:05:00Z"))).toBe(1);
    expect(activeEventIndex(events, ms("2026-07-10T10:00:00Z"))).toBe(1);
  });

  it("clamps to the day's first/last line at the extremes", () => {
    expect(activeEventIndex(events, ms("2026-07-10T01:00:00Z"))).toBe(0);
    expect(activeEventIndex(events, ms("2026-07-10T23:00:00Z"))).toBe(2);
  });

  it("is 0 with no events", () => {
    expect(activeEventIndex([], ms("2026-07-10T09:00:00Z"))).toBe(0);
  });
});

describe("partnerAt (who shares the stage with you)", () => {
  const ev = (person_id: string): ApiEvent => ({
    _id: `e-${person_id}-${Math.random()}`,
    ts: "2026-07-18T09:00:00Z",
    person_id,
    type: "spoke",
    text: "hi",
    emotion: null,
    place: null,
    day_id: "d",
  });

  it("is the current speaker when someone else is talking", () => {
    const events = [ev("kenji"), ev("you"), ev("mia")];
    expect(partnerAt(events, 2)).toBe("mia");
  });

  it("is whoever spoke last when YOU are talking", () => {
    const events = [ev("kenji"), ev("you"), ev("mia"), ev("you")];
    expect(partnerAt(events, 1)).toBe("kenji");
    expect(partnerAt(events, 3)).toBe("mia");
  });

  it("looks ahead when the day opens with you talking", () => {
    const events = [ev("you"), ev("Speaker 1")];
    expect(partnerAt(events, 0)).toBe("Speaker 1");
  });

  it("is null when nobody else appears all day (or no events)", () => {
    expect(partnerAt([ev("you"), ev("you")], 1)).toBeNull();
    expect(partnerAt([], 0)).toBeNull();
  });
});
