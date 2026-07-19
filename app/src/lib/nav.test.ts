import { describe, it, expect } from "vitest";
import { activeNav } from "./nav";

describe("activeNav", () => {
  it("treats the root, plaza and scene routes as Home", () => {
    expect(activeNav("/")).toBe("home");
    expect(activeNav("/plaza")).toBe("home");
    expect(activeNav("/plaza/anything")).toBe("home");
    expect(activeNav("/scene")).toBe("home");
    expect(activeNav("/scene/2026-07-18")).toBe("home");
  });

  it("maps the People routes (list + deep-link) to People", () => {
    expect(activeNav("/people")).toBe("people");
    expect(activeNav("/people/demo-alex")).toBe("people");
  });

  it("maps the Record route to Record", () => {
    expect(activeNav("/record")).toBe("record");
  });

  it("returns null for routes owned by no primary destination", () => {
    expect(activeNav("/voice-setup")).toBeNull();
  });

  it("does not confuse a prefix-lookalike path", () => {
    // "/peoplesque" must NOT count as the People destination.
    expect(activeNav("/peoplesque")).toBeNull();
    expect(activeNav("/plazaland")).toBeNull();
  });
});
