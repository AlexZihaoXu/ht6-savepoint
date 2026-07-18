import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Card, Chip } from "@heroui/react";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import { findPerson, TODAY_ISO } from "@/lib/seed";

/** Person info — big sprite, notes, tags, and recent interactions. */
export function PersonPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const person = findPerson(id);

  if (!person) {
    return (
      <section className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="text-4xl">🫥</span>
        <h1 className="text-xl font-semibold">No one here yet</h1>
        <p className="text-sm text-[var(--muted)]">
          We haven&rsquo;t met this character.
        </p>
        <Button variant="secondary" onPress={() => navigate("/people")}>
          Back to People
        </Button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5" aria-labelledby="person-heading">
      <Link to="/people" className="text-sm text-[var(--muted)]">
        ‹ People
      </Link>

      <div className="flex items-center gap-4">
        <span className="sprite-bob">
          <SpriteAvatar person={person} size={80} />
        </span>
        <div className="min-w-0">
          <h1
            id="person-heading"
            className="flex items-center gap-2 text-2xl font-semibold tracking-tight"
          >
            {person.name}
            {person.favorite && <span aria-label="favorite">⭐</span>}
          </h1>
          <p className="text-sm text-[var(--muted)]">
            Last seen {person.lastSeen}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {person.tags.map((tag) => (
          <Chip key={tag}>{tag}</Chip>
        ))}
      </div>

      <Card>
        <Card.Header>
          <Card.Title>Notes</Card.Title>
        </Card.Header>
        <Card.Content>
          <p className="text-sm leading-relaxed">{person.blurb}</p>
        </Card.Content>
      </Card>

      <Card variant="secondary">
        <Card.Header>
          <Card.Title>Recent interactions</Card.Title>
          <Card.Description>Tap a row to replay that day</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-2">
          <Link
            to={`/day/${TODAY_ISO}`}
            className="flex items-center justify-between border border-[var(--separator)] px-3 py-2 text-sm hover:bg-[var(--surface-tertiary)]"
          >
            <span>Today · morning</span>
            <span aria-hidden className="text-[var(--muted)]">
              ›
            </span>
          </Link>
          <Link
            to="/day/2026-07-15"
            className="flex items-center justify-between border border-[var(--separator)] px-3 py-2 text-sm hover:bg-[var(--surface-tertiary)]"
          >
            <span>Jul 15 · afternoon</span>
            <span aria-hidden className="text-[var(--muted)]">
              ›
            </span>
          </Link>
        </Card.Content>
      </Card>
    </section>
  );
}
