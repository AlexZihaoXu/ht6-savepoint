import { Link } from "react-router-dom";
import { Card } from "@heroui/react";
import { gardenDays, type DayTile } from "@/lib/seed";

const PLANT_BY_STAGE = ["·", "🌱", "🌿", "🌻"] as const;

function plantFor(day: DayTile): string {
  return PLANT_BY_STAGE[day.stage];
}

/** Garden — a calendar where each day is a plant tile. Tap a plant → Day view. */
export function GardenPage() {
  return (
    <section className="flex flex-col gap-5" aria-labelledby="garden-heading">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-[var(--muted)]">July 2026</p>
        <h1
          id="garden-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          Garden
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Every day you live becomes a plant. Tap one to revisit it.
        </p>
      </header>

      <Card>
        <Card.Content>
          <div
            className="grid grid-cols-7 gap-1.5"
            role="grid"
            aria-label="Garden calendar"
          >
            {gardenDays.map((day) => (
              <Link
                key={day.date}
                to={`/day/${day.date}`}
                aria-label={`July ${day.label}, ${day.people} people`}
                className={[
                  "flex aspect-square touch-target flex-col items-center justify-center gap-0.5 border transition-colors",
                  day.isToday
                    ? "border-[var(--accent)] bg-[color-mix(in_oklch,var(--accent)_16%,transparent)]"
                    : "border-[var(--separator)] hover:bg-[var(--surface-secondary)]",
                ].join(" ")}
              >
                <span className="text-[0.6rem] text-[var(--muted)]">
                  {day.label}
                </span>
                <span aria-hidden className="text-lg leading-none">
                  {plantFor(day)}
                </span>
              </Link>
            ))}
          </div>
        </Card.Content>
        <Card.Footer className="justify-between text-xs text-[var(--muted)]">
          <span>🌱 sprouting · 🌿 growing · 🌻 in bloom</span>
          <span>Past months ▾</span>
        </Card.Footer>
      </Card>
    </section>
  );
}
