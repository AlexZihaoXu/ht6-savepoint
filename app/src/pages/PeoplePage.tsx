import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, Chip } from "@heroui/react";
import { PiCaretRight, PiStarFill, PiUsersThree } from "react-icons/pi";
import { Icon } from "@/components/Icon";
import { SpriteAvatar } from "@/components/SpriteAvatar";
import { people } from "@/lib/seed";

const FILTERS = ["All", "Recents", "Favorites"] as const;
type Filter = (typeof FILTERS)[number];

/** People log — everyone you've met, with filter chips. Tap → Person info. */
export function PeoplePage() {
  const [filter, setFilter] = useState<Filter>("All");

  const list = people.filter((p) => {
    if (filter === "Favorites") return p.favorite;
    if (filter === "Recents") return p.spokeToday;
    return true;
  });

  return (
    <section className="flex flex-col gap-4" aria-labelledby="people-heading">
      <header className="flex flex-col gap-1">
        <h1
          id="people-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          People
        </h1>
        <p className="text-sm text-[var(--muted)]">
          {people.length} characters in your town
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filters">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className="touch-target"
          >
            {filter === f ? <Chip color="accent">{f}</Chip> : <Chip>{f}</Chip>}
          </button>
        ))}
      </div>

      {list.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Icon icon={PiUsersThree} className="text-4xl text-[var(--muted)]" />
          <p className="text-sm text-[var(--muted)]">
            {filter === "Favorites"
              ? "No favorites yet — star someone you love running into."
              : "No one today yet — your next chat will show up here."}
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {list.map((p) => (
          <li key={p.id}>
            <Link to={`/people/${p.id}`} aria-label={`Open ${p.name}`}>
              <Card
                variant="secondary"
                className="transition-transform active:scale-[0.99]"
              >
                <Card.Content className="flex items-center gap-3">
                  <SpriteAvatar person={p} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{p.name}</span>
                      {p.favorite && (
                        <Icon
                          icon={PiStarFill}
                          label="favorite"
                          className="shrink-0 text-[var(--accent)]"
                        />
                      )}
                    </div>
                    <p className="truncate text-xs text-[var(--muted)]">
                      {p.tags.join(" · ")} — {p.lastSeen}
                    </p>
                  </div>
                  <Icon
                    icon={PiCaretRight}
                    className="shrink-0 text-[var(--muted)]"
                  />
                </Card.Content>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
