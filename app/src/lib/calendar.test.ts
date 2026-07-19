import { describe, expect, it } from "vitest";
import { addMonth, isoOf, monthGrid, monthName, todayIso } from "./calendar";

describe("calendar", () => {
  it("lays out July 2026 as Sunday-first weeks", () => {
    const weeks = monthGrid(2026, 7);
    // July 1 2026 is a Wednesday → 3 leading blanks.
    expect(weeks[0].slice(0, 3).every((c) => c.iso === null)).toBe(true);
    expect(weeks[0][3]).toEqual({ iso: "2026-07-01", day: 1 });
    const days = weeks.flat().filter((c) => c.iso !== null);
    expect(days).toHaveLength(31);
    expect(days.at(-1)?.iso).toBe("2026-07-31");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it("wraps month arithmetic across year edges", () => {
    expect(addMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonth(2026, 7, -1)).toEqual({ year: 2026, month: 6 });
  });

  it("formats iso + month names", () => {
    expect(isoOf(2026, 7, 4)).toBe("2026-07-04");
    expect(monthName(7)).toBe("July");
  });

  it("returns today as a UTC YYYY-MM-DD string", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayIso()).toBe(new Date().toISOString().slice(0, 10));
  });
});
