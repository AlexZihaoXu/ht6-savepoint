/**
 * Tiny calendar math for the garden view (no date library needed).
 * Months are 1-based; weeks start on Sunday, like the mockup's S M T W T F S.
 */

export interface MonthCell {
  /** ISO date, or null for a cell outside the month. */
  iso: string | null;
  day: number | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function isoOf(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The month laid out as full Sunday-first weeks (rows of 7 cells). */
export function monthGrid(year: number, month: number): MonthCell[][] {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: MonthCell[] = [];
  for (let i = 0; i < firstDow; i++) cells.push({ iso: null, day: null });
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ iso: isoOf(year, month, d), day: d });
  while (cells.length % 7 !== 0) cells.push({ iso: null, day: null });

  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? "";
}

/** A month that has journaled days: its "YYYY-MM" key + how many days. */
export interface MonthEntry {
  month: string;
  days: number;
}

/**
 * The distinct "YYYY-MM" months across a list of dated records (e.g. `/days`),
 * newest first, each with its day count — feeds the Past button's month picker.
 * Records whose date doesn't start with "YYYY-MM" are skipped.
 */
export function distinctMonths(dated: Array<{ date: string }>): MonthEntry[] {
  const counts = new Map<string, number>();
  for (const { date } of dated) {
    if (!/^\d{4}-\d{2}(-|$)/.test(date)) continue;
    const key = date.slice(0, 7);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, days]) => ({ month, days }));
}

/** "2026-07" → "July 2026" (empty string for anything unparseable). */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return "";
  const name = monthName(Number(m[2]));
  return name ? `${name} ${Number(m[1])}` : "";
}

/** Step a (year, month) cursor by +-1 month. */
export function addMonth(
  year: number,
  month: number,
  delta: 1 | -1,
): { year: number; month: number } {
  const m = month + delta;
  if (m < 1) return { year: year - 1, month: 12 };
  if (m > 12) return { year: year + 1, month: 1 };
  return { year, month: m };
}
