import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Card } from "@heroui/react";
import { sampleDialogue } from "@/lib/seed";

/**
 * Day view — the reusable timeline + Undertale-style dialogue playback.
 * This scaffold steps through the seed dialogue with ◀ / ▶; the real
 * typewriter engine + timeline flags (DESIGN.md §10.2/§10.5) land later.
 */
export function DayViewPage() {
  const { date } = useParams();
  const [index, setIndex] = useState(0);

  const line = sampleDialogue[index];
  const atStart = index === 0;
  const atEnd = index === sampleDialogue.length - 1;

  return (
    <section className="flex flex-col gap-5" aria-labelledby="day-heading">
      <header className="flex flex-col gap-1">
        <Link to="/garden" className="text-sm text-[var(--muted)]">
          ‹ Garden
        </Link>
        <h1 id="day-heading" className="text-2xl font-semibold tracking-tight">
          {date ?? "Today"}
        </h1>
        <p className="text-sm text-[var(--muted)]">
          A quiet, cozy replay of your day.
        </p>
      </header>

      {/* Undertale-style dialogue box */}
      <Card>
        <Card.Content className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs text-[var(--muted)]">
            <span>{line.name}</span>
            <span>{line.time}</span>
          </div>
          <div
            className={[
              "min-h-24 border border-[var(--separator)] p-4 text-base leading-relaxed",
              line.speaker === "you"
                ? "bg-[color-mix(in_oklch,var(--accent)_10%,transparent)]"
                : "bg-[var(--surface-secondary)]",
            ].join(" ")}
          >
            {line.text}
            <span className="ml-1 animate-pulse" aria-hidden>
              ▼
            </span>
          </div>
        </Card.Content>
        <Card.Footer className="justify-between">
          <Button
            variant="secondary"
            isDisabled={atStart}
            onPress={() => setIndex((i) => Math.max(0, i - 1))}
          >
            ◀ Back
          </Button>
          <span className="text-xs text-[var(--muted)]">
            {index + 1} / {sampleDialogue.length}
          </span>
          <Button
            variant="primary"
            isDisabled={atEnd}
            onPress={() =>
              setIndex((i) => Math.min(sampleDialogue.length - 1, i + 1))
            }
          >
            Next ▶
          </Button>
        </Card.Footer>
      </Card>

      {/* Timeline strip with flags */}
      <div
        className="flex items-center gap-2 overflow-x-auto py-2"
        aria-label="Timeline"
      >
        {sampleDialogue.map((l, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Jump to ${l.time}`}
            aria-current={i === index}
            className={[
              "touch-target flex shrink-0 flex-col items-center gap-1 px-1",
              i === index ? "text-[var(--accent)]" : "text-[var(--muted)]",
            ].join(" ")}
          >
            <span aria-hidden className="text-lg leading-none">
              🚩
            </span>
            <span className="text-[0.65rem]">{l.time}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
