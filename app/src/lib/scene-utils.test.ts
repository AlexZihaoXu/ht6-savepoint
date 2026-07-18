import { describe, expect, it } from "vitest";
import { fallbackAvatar, formatClock, YOU_AVATAR } from "./scene-utils";

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
