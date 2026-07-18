import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Card, Chip } from "@heroui/react";
import {
  PiCaretLeft,
  PiCaretRight,
  PiStarFill,
  PiUserCircleDashed,
} from "react-icons/pi";
import { Icon } from "@/components/Icon";
import { ParametricSprite } from "@/lib/sprite";
import { api, ApiError, displayName, type ApiPersonDetail } from "@/lib/api";
import { formatClock, relativeSeen } from "@/lib/scene-utils";

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

type Status = "loading" | "ready" | "missing" | "error";

/** Person info — real `/people/{id}` data: sprite, notes, tags, recent days. */
export function PersonPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [person, setPerson] = useState<ApiPersonDetail | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    if (!id) {
      setStatus("missing");
      return;
    }
    const ac = new AbortController();
    setStatus("loading");
    setPerson(null);
    api.person(id, ac.signal).then(
      (p) => {
        setPerson(p);
        setStatus("ready");
      },
      (e) => {
        if (ac.signal.aborted) return;
        setStatus(
          e instanceof ApiError && e.status === 404 ? "missing" : "error",
        );
      },
    );
    return () => ac.abort();
  }, [id]);

  if (status === "loading") {
    return (
      <section className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="animate-pulse text-sm text-[var(--muted)]">
          Loading your world…
        </p>
      </section>
    );
  }

  if (status === "missing" || status === "error" || !person) {
    return (
      <section className="flex flex-col items-center gap-3 py-10 text-center">
        <Icon
          icon={PiUserCircleDashed}
          className="text-5xl text-[var(--muted)]"
        />
        <h1 className="text-xl font-semibold">
          {status === "error" ? "Backend asleep…" : "No one here yet"}
        </h1>
        <p className="text-sm text-[var(--muted)]">
          {status === "error"
            ? "Couldn't reach the SavePoint API — is it up?"
            : "We haven't met this character."}
        </p>
        <Button variant="secondary" onPress={() => navigate("/people")}>
          Back to People
        </Button>
      </section>
    );
  }

  const name = displayName(person);
  // Most recent days this person appeared in (from their event history).
  // `first` is their opening moment that day — the row's clock AND the
  // deep-link target, so tapping lands at the start of that conversation.
  const recentDays = [...person.events]
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .reduce<Array<{ day: string; count: number; first: string }>>((acc, e) => {
      const hit = acc.find((d) => d.day === e.day_id);
      if (hit) {
        hit.count += 1;
        hit.first = e.ts; // descending scan → the last write is the earliest
      } else if (acc.length < 5)
        acc.push({ day: e.day_id, count: 1, first: e.ts });
      return acc;
    }, []);

  return (
    <section className="flex flex-col gap-5" aria-labelledby="person-heading">
      {/* py/-my + px/-mx grow the tap target to ≥44px without moving layout. */}
      <Link
        to="/people"
        className="-mx-2 -my-3 inline-flex items-center gap-1 self-start px-2 py-3 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <Icon icon={PiCaretLeft} /> People
      </Link>

      <div className="flex items-center gap-4">
        <span className="sprite-bob">
          <ParametricSprite params={person.avatar_params} size={84} />
        </span>
        <div className="min-w-0">
          <h1
            id="person-heading"
            className="flex items-center gap-2 text-2xl font-semibold tracking-tight"
          >
            {name}
            {person.favorite && (
              <Icon
                icon={PiStarFill}
                label="favorite"
                className="text-[var(--accent)]"
              />
            )}
          </h1>
          <p className="text-sm text-[var(--muted)]">
            Seen {relativeSeen(person.last_seen)}
            {person.first_seen
              ? ` · first met ${fmtDay(person.first_seen)}`
              : ""}
          </p>
        </div>
      </div>

      {person.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {person.tags.map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
        </div>
      )}

      <Card>
        <Card.Header>
          <Card.Title>Notes</Card.Title>
        </Card.Header>
        <Card.Content>
          <p className="text-sm leading-relaxed">
            {person.notes?.trim() ||
              "No notes yet — your next chat will fill this in."}
          </p>
        </Card.Content>
      </Card>

      <Card variant="secondary">
        <Card.Header>
          <Card.Title>Recent interactions</Card.Title>
          <Card.Description>Tap a row to jump into that chat</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-2">
          {recentDays.length === 0 && (
            <p className="text-sm text-[var(--muted)]">
              Nothing recorded together yet.
            </p>
          )}
          {recentDays.map((d) => (
            <Link
              key={d.day}
              // ?t= deep-links the day scene STRAIGHT to this interaction —
              // the scrubber opens at the row's timestamp, mid-conversation,
              // not at the start of the day.
              to={`/scene/${d.day}?t=${encodeURIComponent(d.first)}`}
              className="touch-target flex items-center justify-between border border-[var(--separator)] px-3 py-2 text-sm transition-colors hover:bg-[var(--surface-tertiary)]"
            >
              <span>
                {fmtDay(d.day + "T00:00:00Z")} · {formatClock(d.first)} ·{" "}
                {d.count} {d.count === 1 ? "moment" : "moments"}
              </span>
              <Icon icon={PiCaretRight} className="text-[var(--muted)]" />
            </Link>
          ))}
        </Card.Content>
      </Card>
    </section>
  );
}
