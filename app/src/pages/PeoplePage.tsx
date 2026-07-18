import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, Chip } from "@heroui/react";
import { PiCaretRight, PiStarFill, PiUsersThree } from "react-icons/pi";
import { Icon } from "@/components/Icon";
import { ParametricSprite } from "@/lib/sprite";
import { api, displayName, type ApiPerson } from "@/lib/api";
import { relativeSeen } from "@/lib/scene-utils";

const FILTERS = ["All", "Recents", "Favorites"] as const;
type Filter = (typeof FILTERS)[number];

/** "Recents" = seen within the last few days. */
const RECENT_MS = 3 * 86400000;

/** People log — everyone from the live `/people` API. Tap → Person info. */
export function PeoplePage() {
  const [filter, setFilter] = useState<Filter>("All");
  const [people, setPeople] = useState<ApiPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    api.people(ac.signal).then(setPeople, (e) => {
      if (!ac.signal.aborted) setError(String(e));
    });
    return () => ac.abort();
  }, []);

  const list = (people ?? []).filter((p) => {
    if (filter === "Favorites") return p.favorite;
    if (filter === "Recents")
      return (
        !!p.last_seen &&
        Date.now() - new Date(p.last_seen).getTime() < RECENT_MS
      );
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
          {people
            ? `${people.length} characters in your town`
            : error
              ? "Backend asleep… is the API up?"
              : "Loading your world…"}
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

      {!people && !error && (
        <p className="animate-pulse py-8 text-center text-sm text-[var(--muted)]">
          Loading your world…
        </p>
      )}

      {people && list.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Icon icon={PiUsersThree} className="text-4xl text-[var(--muted)]" />
          <p className="text-sm text-[var(--muted)]">
            {filter === "Favorites"
              ? "No favorites yet — star someone you love running into."
              : filter === "Recents"
                ? "No one these past days — your next chat will show up here."
                : "Nobody here yet. Go say hi!"}
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {list.map((p) => (
          <li key={p.local_id}>
            <Link
              to={`/people/${p.local_id}`}
              aria-label={`Open ${displayName(p)}`}
            >
              <Card
                variant="secondary"
                className="transition-transform active:scale-[0.99]"
              >
                <Card.Content className="flex items-center gap-3">
                  <ParametricSprite params={p.avatar_params} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">
                        {displayName(p)}
                      </span>
                      {p.favorite && (
                        <Icon
                          icon={PiStarFill}
                          label="favorite"
                          className="shrink-0 text-[var(--accent)]"
                        />
                      )}
                    </div>
                    <p className="truncate text-xs text-[var(--muted)]">
                      {[p.tags.join(" · "), `seen ${relativeSeen(p.last_seen)}`]
                        .filter(Boolean)
                        .join(" — ")}
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
