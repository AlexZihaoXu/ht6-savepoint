import { describe, expect, it } from "vitest";
import {
  fallbackAvatar,
  formatClock,
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
