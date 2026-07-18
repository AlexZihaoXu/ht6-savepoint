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
