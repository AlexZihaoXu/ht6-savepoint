import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  PiCaretRight,
  PiCheck,
  PiFunnel,
  PiStarFill,
  PiUserGear,
  PiUsersThree,
} from "react-icons/pi";
import { Icon } from "@/components/Icon";
import { PixelBottomNav, PixelHeader } from "@/components/PixelChrome";
import { PixelSprite } from "@/lib/pixel-sprite";
import { api, displayName, type ApiPerson } from "@/lib/api";
import {
  filterPeople,
  groupContacts,
  sortByRecent,
  type PeopleFilter,
  type PeopleSort,
} from "@/lib/contacts";
import { relativeSeen } from "@/lib/scene-utils";

const FILTER_LABELS: Record<PeopleFilter, string> = {
  all: "Everyone",
  recents: "Recents",
  favorites: "Favorites",
};
const SORT_LABELS: Record<PeopleSort, string> = {
  az: "A to Z",
  recent: "Recently seen",
};

/**
 * People log — everyone from the live `/people` API as a phone-contacts
 * style list: A–Z sticky section headers, avatar + name rows, and a funnel
 * button that opens the filter/sort options. Tap a row → Person info.
 */
export function PeoplePage() {
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [sort, setSort] = useState<PeopleSort>("az");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [people, setPeople] = useState<ApiPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    api.people(ac.signal).then(setPeople, (e) => {
      if (!ac.signal.aborted) setError(String(e));
    });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFiltersOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtersOpen]);

  const visible = useMemo(
    () => filterPeople(people ?? [], filter),
    [people, filter],
  );
  // A–Z mode → lettered sections; recency mode → one flat, unlettered run.
  const sections = useMemo(
    () =>
      sort === "az"
        ? groupContacts(visible, displayName)
        : [{ letter: "", items: sortByRecent(visible, displayName) }],
    [visible, sort],
  );

  const nonDefault = filter !== "all" || sort !== "az";

  return (
    <div className="flex h-[100svh] flex-col overflow-hidden">
      <PixelHeader />

      {/* sub-header: title + count, and the funnel that opens filter/sort */}
      <div className="relative z-30 flex flex-none items-center justify-between gap-3 border-b-2 border-[var(--pixel-bar-border)] bg-[var(--pixel-bar-bg)] px-4 py-2">
        <div className="min-w-0">
          <h1 id="people-heading" className="font-pixel text-[13px]">
            People
          </h1>
          <p className="mt-1 truncate text-xs text-[var(--muted)]">
            {people
              ? nonDefault
                ? `${visible.length} of ${people.length} — ${FILTER_LABELS[filter]} · ${SORT_LABELS[sort]}`
                : `${people.length} characters in your town`
              : error
                ? "Backend asleep… is the API up?"
                : "Loading your world…"}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {/* your own character — the modular customizer (SAV-61) */}
          <Link
            to="/customize"
            aria-label="Customize your character"
            className="pixel-btn touch-target flex flex-none items-center justify-center"
          >
            <Icon icon={PiUserGear} size={20} />
          </Link>
          <button
            type="button"
            aria-label="Filter and sort"
            aria-expanded={filtersOpen}
            className="pixel-btn touch-target relative flex flex-none items-center justify-center"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <Icon icon={PiFunnel} size={20} />
            {nonDefault && (
              <span
                aria-hidden
                className="absolute top-0.5 right-0.5 h-2 w-2 bg-[var(--accent)]"
              />
            )}
          </button>
        </div>

        {filtersOpen && (
          <FilterSheet
            filter={filter}
            sort={sort}
            onFilter={setFilter}
            onSort={setSort}
            onClose={() => setFiltersOpen(false)}
          />
        )}
      </div>

      <section
        aria-labelledby="people-heading"
        className="min-h-0 flex-1 overflow-y-auto pb-2"
      >
        {!people && !error && (
          <p className="animate-pulse py-10 text-center text-sm text-[var(--muted)]">
            Loading your world…
          </p>
        )}

        {people && visible.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Icon
              icon={PiUsersThree}
              className="text-4xl text-[var(--muted)]"
            />
            <p className="text-sm text-[var(--muted)]">
              {filter === "favorites"
                ? "No favorites yet — star someone you love running into."
                : filter === "recents"
                  ? "No one these past days — your next chat will show up here."
                  : "Nobody here yet. Go say hi!"}
            </p>
          </div>
        )}

        {visible.length > 0 && (
          <ul>
            {sections.map(({ letter, items }) => (
              <li key={letter || "recent"}>
                {letter && (
                  <h2 className="font-pixel sticky top-0 z-10 border-y border-[var(--separator)] bg-[var(--surface-secondary)] px-4 py-1.5 text-[9px] text-[var(--muted)]">
                    {letter}
                  </h2>
                )}
                <ul>
                  {items.map((p) => (
                    <ContactRow key={p.local_id} person={p} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PixelBottomNav />
    </div>
  );
}

/** One contacts row: sprite avatar + name (+ star), sub-line, chevron. */
function ContactRow({ person: p }: { person: ApiPerson }) {
  return (
    <li className="border-b border-[var(--separator)] last:border-b-0">
      <Link
        to={`/people/${p.local_id}`}
        aria-label={`Open ${displayName(p)}`}
        className="flex items-center gap-3 px-4 py-2 transition-colors active:bg-[var(--surface-tertiary)]"
      >
        <PixelSprite
          localId={p.local_id}
          sprite={p.sprite}
          params={p.avatar_params}
          size={40}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">{displayName(p)}</span>
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
        <Icon icon={PiCaretRight} className="shrink-0 text-[var(--muted)]" />
      </Link>
    </li>
  );
}

/**
 * The tap-to-open filter options: a small bubble anchored under the funnel
 * with Show (Everyone / Recents / Favorites) and Sort (A to Z / Recently
 * seen). Choices apply live; tap outside (or Esc) to close.
 */
function FilterSheet({
  filter,
  sort,
  onFilter,
  onSort,
  onClose,
}: {
  filter: PeopleFilter;
  sort: PeopleSort;
  onFilter: (f: PeopleFilter) => void;
  onSort: (s: PeopleSort) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* invisible backdrop — tap anywhere outside to close */}
      <button
        type="button"
        aria-label="Close filters"
        className="fixed inset-0 z-30 cursor-default"
        onClick={onClose}
      />
      <div
        role="group"
        aria-label="Filter and sort options"
        className="pixel-bubble absolute top-full right-3 z-40 mt-1.5 flex w-56 flex-col p-2"
      >
        <p className="font-pixel px-2 pt-1 pb-0.5 text-[8px] opacity-60">
          SHOW
        </p>
        {(Object.keys(FILTER_LABELS) as PeopleFilter[]).map((f) => (
          <OptionRow
            key={f}
            active={filter === f}
            label={FILTER_LABELS[f]}
            onPress={() => onFilter(f)}
          />
        ))}
        <p className="font-pixel px-2 pt-2.5 pb-0.5 text-[8px] opacity-60">
          SORT
        </p>
        {(Object.keys(SORT_LABELS) as PeopleSort[]).map((s) => (
          <OptionRow
            key={s}
            active={sort === s}
            label={SORT_LABELS[s]}
            onPress={() => onSort(s)}
          />
        ))}
      </div>
    </>
  );
}

function OptionRow({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onPress}
      className={`flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium ${
        active
          ? "bg-[color-mix(in_oklch,var(--accent)_16%,transparent)]"
          : "opacity-70"
      }`}
    >
      {label}
      {active && <Icon icon={PiCheck} className="text-[var(--accent)]" />}
    </button>
  );
}
