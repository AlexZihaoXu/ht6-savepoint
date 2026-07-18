import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, Card } from "@heroui/react";
import type { DateValue } from "@internationalized/date";
import { parseDate } from "@internationalized/date";
import type { IconType } from "react-icons";
import { GiSprout, GiThreeLeaves, GiSunflower } from "react-icons/gi";
import { Icon } from "@/components/Icon";
import { gardenDays, TODAY_ISO, type DayTile } from "@/lib/seed";

// Growth stages 1..3 → cozy plant glyphs; stage 0 is an un-logged day (a dot).
const PLANT_BY_STAGE: (IconType | null)[] = [
  null,
  GiSprout,
  GiThreeLeaves,
  GiSunflower,
];

// Each stage reads a little older; the bloom warms to a sunflower gold so a day
// full of life pops out of the green. Index by stage (0 is unused for plants).
const TINT_BY_STAGE: string[] = [
  "var(--muted)",
  "color-mix(in oklch, var(--accent) 60%, var(--muted))",
  "var(--accent)",
  "var(--warning)",
];

// Open the calendar on the seeded demo month so the garden is always populated.
const FOCUS_MONTH = parseDate(TODAY_ISO);

/**
 * Garden — the month view, rebuilt on HeroUI v3's <Calendar> (React Aria under
 * the hood, so it's fully keyboard-navigable). Each date cell IS a day-plant:
 * its growth-stage glyph tinted by stage, today highlighted by the Calendar's
 * built-in `data-today` state, and un-logged days left as a muted dot.
 * Selecting a day (click or Enter) opens that day's replay.
 */
export function GardenPage() {
  const navigate = useNavigate();

  // Map ISO date → day-plant so each calendar cell can look up its stage.
  const tileByIso = useMemo(
    () => new Map<string, DayTile>(gardenDays.map((d) => [d.date, d])),
    [],
  );

  const openDay = (value: DateValue | null) => {
    if (value) navigate(`/day/${value.toString()}`);
  };

  return (
    <section className="flex flex-col gap-5" aria-labelledby="garden-heading">
      <header className="flex flex-col gap-1">
        <h1
          id="garden-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          Garden
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Every day you live becomes a plant. Pick one to revisit it.
        </p>
      </header>

      <Card>
        <Card.Content>
          <Calendar
            aria-label="Garden — your days as plants"
            defaultFocusedValue={FOCUS_MONTH}
            className="w-full max-w-none"
            onChange={openDay}
          >
            <Calendar.Header className="pb-3">
              <Calendar.Heading className="text-base font-semibold tracking-tight" />
              <Calendar.NavButton
                slot="previous"
                className="rounded-none text-[var(--muted)]"
              />
              <Calendar.NavButton
                slot="next"
                className="rounded-none text-[var(--muted)]"
              />
            </Calendar.Header>
            <Calendar.Grid className="gap-1">
              <Calendar.GridHeader>
                {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
              </Calendar.GridHeader>
              <Calendar.GridBody>
                {(date) => (
                  <Calendar.Cell date={date} className="rounded-none">
                    {({ formattedDate, isOutsideMonth }) => {
                      const stage = tileByIso.get(date.toString())?.stage ?? 0;
                      const Plant = PLANT_BY_STAGE[stage];
                      const hasPlant = Plant != null && !isOutsideMonth;
                      const isTodayCell = date.toString() === TODAY_ISO;

                      return (
                        <span className="pointer-events-none flex flex-col items-center justify-center gap-0.5 leading-none">
                          <span
                            className={
                              isTodayCell
                                ? "text-[0.6rem] font-semibold text-[var(--accent)]"
                                : "text-[0.6rem] text-[var(--muted)]"
                            }
                          >
                            {formattedDate}
                          </span>
                          {hasPlant ? (
                            <span
                              aria-hidden
                              className="text-lg leading-none"
                              style={{ color: TINT_BY_STAGE[stage] }}
                            >
                              <Icon icon={Plant} />
                            </span>
                          ) : (
                            <span
                              aria-hidden
                              className="text-lg leading-none text-[var(--muted)] opacity-50"
                            >
                              ·
                            </span>
                          )}
                        </span>
                      );
                    }}
                  </Calendar.Cell>
                )}
              </Calendar.GridBody>
            </Calendar.Grid>
          </Calendar>
        </Card.Content>
        <Card.Footer className="text-xs text-[var(--muted)]">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <Icon icon={GiSprout} className="text-[var(--accent)]" /> sprouting
            · <Icon icon={GiThreeLeaves} className="text-[var(--accent)]" />{" "}
            growing ·{" "}
            <Icon icon={GiSunflower} className="text-[var(--warning)]" /> in
            bloom
          </span>
        </Card.Footer>
      </Card>
    </section>
  );
}
