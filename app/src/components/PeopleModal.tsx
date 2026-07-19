/**
 * People log as a POP-UP (waterprism: "a simple pop-up box, not a full page —
 * no titles, no count, no character-customization button; just the filter, the
 * people, and last-seen only if recent, tags below").
 *
 * Renders over a dimmed backdrop. Opened by the /people route (the bottom-nav
 * People destination); the /people/:id deep-link additionally opens that
 * person's PersonModal on top. Closing the pop-up returns to /plaza; tapping a
 * row opens the PersonModal client-side (no full-page navigation).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  PiCheck,
  PiFunnel,
  PiStarFill,
  PiUsersThree,
  PiX,
} from "react-icons/pi";
import { Icon } from "./Icon";
import { PersonModal } from "./PersonModal";
import { PixelSprite } from "@/lib/pixel-sprite";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { api, displayName, type ApiPerson } from "@/lib/api";
import {
  filterPeople,
  groupContacts,
  isRecentlySeen,
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

export function PeopleModal() {
  // /people/:id deep-links straight to a person's pop-up (opened on top of the
  // list). A row tap opens the same modal client-side, without navigating.
  const { id } = useParams();
  const navigate = useNavigate();

  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [sort, setSort] = useState<PeopleSort>("az");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [people, setPeople] = useState<ApiPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(id ?? null);

  const closeRef = useRef<HTMLButtonElement>(null);
  // Only a press that BOTH starts and ends on the backdrop should close — a
  // drag that begins inside and releases outside must not tear the pop-up down.
  const pressOnBackdrop = useRef(false);

  // Keep the open person pop-up in sync with the URL: a deep-link (or going
  // back to /people) drives which profile — if any — is showing.
  useEffect(() => {
    setOpenId(id ?? null);
  }, [id]);

  const closePopup = useCallback(() => navigate("/plaza"), [navigate]);

  const closePerson = useCallback(() => {
    // Opened via the deep-link URL → return to the bare list; opened via a row
    // tap → just drop the overlay (stay on the list pop-up).
    if (id) navigate("/people");
    else setOpenId(null);
  }, [id, navigate]);

  const applyRename = useCallback((localId: string, name: string | null) => {
    setPeople((ps) =>
      ps ? ps.map((p) => (p.local_id === localId ? { ...p, name } : p)) : ps,
    );
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    api.people(ac.signal).then(setPeople, (e) => {
      if (!ac.signal.aborted) setError(String(e));
    });
    return () => ac.abort();
  }, []);

  // Return focus to the opener on unmount.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => opener?.focus?.();
  }, []);
  // Shared ref-counted body scroll-lock (see hook) — a stacked Person profile
  // won't leave scroll stuck locked after close.
  useBodyScrollLock();

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Escape: close the filter menu first; then, only when no person modal is on
  // top (that owns Escape itself), close the whole pop-up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (filtersOpen) {
        setFiltersOpen(false);
        return;
      }
      if (openId) return; // PersonModal handles its own Escape
      closePopup();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtersOpen, openId, closePopup]);

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
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        pressOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressOnBackdrop.current && e.target === e.currentTarget)
          closePopup();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="People"
        className="pixel-bubble relative flex max-h-[85vh] w-full max-w-sm flex-col p-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header: just the filter funnel + close — no title, no count */}
        <div className="relative flex flex-none items-center justify-end gap-2 px-3 pt-3 pb-2">
          <button
            type="button"
            aria-label="Filter and sort"
            aria-expanded={filtersOpen}
            className="pixel-icon-btn touch-target relative flex flex-none items-center justify-center"
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
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={closePopup}
            className="pixel-icon-btn touch-target flex flex-none items-center justify-center"
          >
            <Icon icon={PiX} size={16} />
          </button>

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

        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
          {!people && !error && (
            <p className="animate-pulse py-10 text-center text-sm text-[var(--muted)]">
              Loading your world…
            </p>
          )}

          {error && !people && (
            <p className="py-10 text-center text-sm text-[var(--muted)]">
              Backend asleep… is the API up?
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
                    <h2 className="font-pixel sticky top-0 z-10 bg-[var(--bubble-bg)] px-3 py-1.5 text-[9px] text-[var(--muted)]">
                      {letter}
                    </h2>
                  )}
                  <ul>
                    {items.map((p) => (
                      <ContactRow
                        key={p.local_id}
                        person={p}
                        onOpen={() => setOpenId(p.local_id)}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {openId && (
        <PersonModal
          localId={openId}
          onClose={closePerson}
          onRenamed={applyRename}
        />
      )}
    </div>
  );
}

/**
 * One pop-up row: avatar + name; last-seen far right (only if recent); tags,
 * if any, below the name. Deliberately minimal per waterprism's spec.
 */
function ContactRow({
  person: p,
  onOpen,
}: {
  person: ApiPerson;
  onOpen: () => void;
}) {
  const recent = isRecentlySeen(p.last_seen);
  const tags = p.tags.join(" · ");
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${displayName(p)}`}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors active:bg-black/5"
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
          {tags && (
            <p className="truncate text-xs text-[var(--muted)]">{tags}</p>
          )}
        </div>
        {recent && (
          <span className="flex-none text-xs text-[var(--muted)]">
            seen {relativeSeen(p.last_seen)}
          </span>
        )}
      </button>
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
