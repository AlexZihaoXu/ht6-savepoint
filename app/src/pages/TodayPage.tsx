import { Link, useNavigate } from "react-router-dom";
import { Button, Card, Chip } from "@heroui/react";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import { people, TODAY_ISO } from "@/lib/seed";

/** Today / Scene — the people you met today as sprites + a daily recap. */
export function TodayPage() {
  const navigate = useNavigate();
  const metToday = people.filter((p) => p.spokeToday);

  return (
    <section className="flex flex-col gap-5" aria-labelledby="today-heading">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-[var(--muted)]">Friday · July 18</p>
        <h1
          id="today-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          Today
        </h1>
      </header>

      {/* Scene: the townsfolk you talked to today */}
      <Card>
        <Card.Header>
          <Card.Title>Who you met</Card.Title>
          <Card.Description>
            {metToday.length} character{metToday.length === 1 ? "" : "s"} joined
            your day
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {metToday.length > 0 ? (
            <div className="flex flex-wrap gap-4">
              {metToday.map((p) => (
                <Link
                  key={p.id}
                  to={`/people/${p.id}`}
                  className="flex w-16 flex-col items-center gap-1.5 text-center"
                  aria-label={`Open ${p.name}`}
                >
                  <span className="sprite-bob">
                    <SpriteAvatar person={p} size={56} />
                  </span>
                  <span className="truncate text-xs font-medium">{p.name}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <span className="text-4xl">🌱</span>
              <p className="text-sm text-[var(--muted)]">
                A quiet day so far — go say hi to someone.
              </p>
            </div>
          )}
        </Card.Content>
      </Card>

      {/* Daily recap (Gemini) placeholder */}
      <Card variant="secondary">
        <Card.Header>
          <Card.Title>Daily recap</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          <div>
            <Chip color="accent">Gemini</Chip>
          </div>
          <p className="text-sm leading-relaxed">
            You spent the morning building the garden view with Vee and caught
            up with Dan about the Pi. It felt like a good, productive save
            point. 🌟
          </p>
        </Card.Content>
        <Card.Footer>
          <Button
            variant="primary"
            onPress={() => navigate(`/day/${TODAY_ISO}`)}
          >
            Replay today&rsquo;s story →
          </Button>
        </Card.Footer>
      </Card>

      <p className="text-center text-xs text-[var(--muted)]">
        Your life autosaves.
      </p>
    </section>
  );
}
