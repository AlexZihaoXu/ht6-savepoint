/**
 * Person profile as a pop-up (waterprism: "pop ups, not full pages").
 *
 * Renders the same profile content the old PersonPage did — sprite, name with
 * inline rename, seen/first-met line, bio, tags, notes, recent interactions —
 * inside a centered modal over a dimmed backdrop. Opened from in-app taps
 * (a plaza character bubble, a People-list row) and from the /people/:id
 * deep-link. Closing on a deep-link returns to /people (handled by the caller).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Chip } from "@heroui/react";
import {
  PiCaretRight,
  PiCheck,
  PiPencilSimple,
  PiPlus,
  PiStarFill,
  PiUserCircleDashed,
  PiX,
} from "react-icons/pi";
import { Icon } from "./Icon";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useToast } from "@/lib/toast";
import { PixelSprite } from "@/lib/pixel-sprite";
import {
  api,
  ApiError,
  displayName,
  renamePerson,
  updatePerson,
  type ApiPersonDetail,
} from "@/lib/api";
import { formatClock, noteLines, relativeSeen } from "@/lib/scene-utils";

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

type Status = "loading" | "ready" | "missing" | "error";

export function PersonModal({
  localId,
  onClose,
  onRenamed,
}: {
  localId: string;
  onClose: () => void;
  /** Push a rename back up so an underlying list/plaza reflects it at once. */
  onRenamed?: (localId: string, name: string | null) => void;
}) {
  const toast = useToast();

  const [person, setPerson] = useState<ApiPersonDetail | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  // Inline rename (next to the name heading) — draft text lives separately
  // from `person` so a failed save doesn't clobber the last-good name.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  // Notes editor — draft lives separately from `person` (like the name edit)
  // so a failed save keeps what the user typed.
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  // Tags edit — a compact "add a tag" input plus per-chip removal. Tag writes
  // are optimistic (revert + toast on failure).
  const [tagInput, setTagInput] = useState("");
  const [savingTags, setSavingTags] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Only a press that BOTH starts and ends on the backdrop should close — a
  // drag that begins inside (e.g. selecting text in the rename field) and
  // releases outside must not tear the modal down + lose the draft.
  const pressOnBackdrop = useRef(false);

  useEffect(() => {
    const ac = new AbortController();
    setStatus("loading");
    setPerson(null);
    // Re-pointing the same modal at a different person must not carry over an
    // in-progress rename draft/edit from the previous one.
    setEditingName(false);
    setNameDraft("");
    setSavingName(false);
    setEditingNotes(false);
    setNotesDraft("");
    setSavingNotes(false);
    setTagInput("");
    setSavingTags(false);
    api.person(localId, ac.signal).then(
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
  }, [localId]);

  // Escape closes the modal — but while an inline editor is open (rename or
  // notes), Escape belongs to that editor (cancel edit), so don't also tear
  // down the modal then.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editingName && !editingNotes) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editingName, editingNotes]);

  // Return focus to whatever opened the modal once it closes (captured before
  // we move focus onto the dialog).
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => opener?.focus?.();
  }, []);
  // Shared ref-counted body scroll-lock — safe when this modal is stacked over
  // the People pop-up (avoids a leaked `overflow: hidden` after close).
  useBodyScrollLock();

  // Move focus onto the dialog (its close button) when it opens.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const startEditingName = () => {
    setNameDraft(person?.name ?? "");
    setEditingName(true);
  };

  const cancelEditingName = () => {
    setEditingName(false);
  };

  // Trim client-side, but an empty result is a legitimate save (clears the
  // name back to "Neighbor XXX" — see `displayName`), not a validation error.
  const saveName = async () => {
    if (!person) return;
    setSavingName(true);
    try {
      const updated = await renamePerson(person.local_id, nameDraft.trim());
      setPerson((p) => (p ? { ...p, name: updated.name } : p));
      onRenamed?.(person.local_id, updated.name);
      setEditingName(false);
    } catch (e) {
      const why =
        e instanceof ApiError
          ? `the backend said HTTP ${e.status}`
          : "the backend can't be reached";
      toast.show("error", `Couldn't rename — ${why}.`);
      // Stay in edit mode so the draft isn't lost — the user can retry.
    } finally {
      setSavingName(false);
    }
  };

  const startEditingNotes = () => {
    setNotesDraft(person?.notes ?? "");
    setEditingNotes(true);
  };

  const cancelEditingNotes = () => {
    setEditingNotes(false);
  };

  const saveNotes = async () => {
    if (!person) return;
    setSavingNotes(true);
    try {
      const updated = await updatePerson(person.local_id, {
        notes: notesDraft.trim(),
      });
      setPerson((p) => (p ? { ...p, notes: updated.notes } : p));
      setEditingNotes(false);
    } catch (e) {
      const why =
        e instanceof ApiError
          ? `the backend said HTTP ${e.status}`
          : "the backend can't be reached";
      toast.show("error", `Couldn't save notes — ${why}.`);
      // Stay in edit mode so the draft isn't lost — the user can retry.
    } finally {
      setSavingNotes(false);
    }
  };

  // Optimistically swap in `next` tags, then persist; revert + toast on failure.
  const commitTags = async (next: string[]) => {
    if (!person) return;
    const prev = person.tags;
    setPerson((p) => (p ? { ...p, tags: next } : p));
    setSavingTags(true);
    try {
      const updated = await updatePerson(person.local_id, { tags: next });
      setPerson((p) => (p ? { ...p, tags: updated.tags } : p));
    } catch (e) {
      setPerson((p) => (p ? { ...p, tags: prev } : p));
      const why =
        e instanceof ApiError
          ? `the backend said HTTP ${e.status}`
          : "the backend can't be reached";
      toast.show("error", `Couldn't update tags — ${why}.`);
    } finally {
      setSavingTags(false);
    }
  };

  const addTag = () => {
    if (!person) return;
    const tag = tagInput.trim();
    // Skip empties + client-side dupes (server also normalizes).
    if (!tag || person.tags.includes(tag)) {
      setTagInput("");
      return;
    }
    setTagInput("");
    void commitTags([...person.tags, tag]);
  };

  const removeTag = (tag: string) => {
    if (!person) return;
    void commitTags(person.tags.filter((t) => t !== tag));
  };

  let body: ReactNode;

  if (status === "loading") {
    body = (
      <section className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="animate-pulse text-sm text-[var(--muted)]">
          Loading your world…
        </p>
      </section>
    );
  } else if (status === "missing" || status === "error" || !person) {
    body = (
      <section className="flex flex-col items-center gap-3 px-2 py-12 text-center">
        <Icon
          icon={PiUserCircleDashed}
          className="text-5xl text-[var(--muted)]"
        />
        <h2 className="font-pixel text-[13px]">
          {status === "error" ? "Backend asleep…" : "No one here yet"}
        </h2>
        <p className="text-sm text-[var(--muted)]">
          {status === "error"
            ? "Couldn't reach the SavePoint API — is it up?"
            : "We haven't met this character."}
        </p>
        <button
          type="button"
          className="pixel-btn touch-target mt-1 px-4 py-2"
          onClick={onClose}
        >
          <span className="font-pixel text-[10px]">Close</span>
        </button>
      </section>
    );
  } else {
    const name = displayName(person);
    // Most recent days this person appeared in (from their event history).
    // `first` is their opening moment that day — the row's clock AND the
    // deep-link target, so tapping lands at the start of that conversation.
    const recentDays = [...person.events]
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .reduce<Array<{ day: string; count: number; first: string }>>(
        (acc, e) => {
          const hit = acc.find((d) => d.day === e.day_id);
          if (hit) {
            hit.count += 1;
            hit.first = e.ts; // descending scan → the last write is the earliest
          } else if (acc.length < 5)
            acc.push({ day: e.day_id, count: 1, first: e.ts });
          return acc;
        },
        [],
      );

    body = (
      <section
        aria-labelledby="person-modal-heading"
        className="flex flex-col gap-5"
      >
        {/* Header row: sprite left · name + AI description middle · rename
            pencil far right (waterprism's profile layout). */}
        <div className="flex items-start gap-4">
          <span className="sprite-bob flex-none">
            <PixelSprite
              localId={person.local_id}
              sprite={person.sprite}
              params={person.avatar_params}
              size={84}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h2
                id="person-modal-heading"
                className="font-pixel flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[13px] leading-6 break-words"
              >
                {editingName ? (
                  <span className="flex flex-1 items-center gap-1.5">
                    <input
                      type="text"
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void saveName();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEditingName();
                        }
                      }}
                      disabled={savingName}
                      autoFocus
                      aria-label="Name"
                      placeholder="Name"
                      className="min-w-0 flex-1 border-2 border-[var(--border)] bg-[var(--field-background)] px-2 py-1 font-sans text-sm text-[var(--field-foreground)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
                    />
                    <button
                      type="button"
                      aria-label="Save name"
                      disabled={savingName}
                      onClick={() => void saveName()}
                      className="pixel-btn touch-target flex flex-none items-center justify-center disabled:opacity-60"
                    >
                      <Icon icon={PiCheck} size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label="Cancel"
                      disabled={savingName}
                      onClick={cancelEditingName}
                      className="pixel-btn touch-target flex flex-none items-center justify-center disabled:opacity-60"
                    >
                      <Icon icon={PiX} size={14} />
                    </button>
                  </span>
                ) : (
                  <>
                    {name}
                    {person.favorite && (
                      <Icon
                        icon={PiStarFill}
                        label="favorite"
                        className="text-[var(--accent)]"
                      />
                    )}
                  </>
                )}
              </h2>
              {!editingName && (
                <button
                  type="button"
                  aria-label="Rename"
                  onClick={startEditingName}
                  className="pixel-btn touch-target flex flex-none items-center justify-center"
                >
                  <Icon icon={PiPencilSimple} size={14} />
                </button>
              )}
            </div>
            {/* AI-generated character description — read-only, ~1–2 lines. */}
            {person.bio?.trim() && (
              <p className="mt-1.5 line-clamp-2 text-sm leading-snug text-[var(--muted)] italic">
                {person.bio.trim()}
              </p>
            )}
          </div>
        </div>

        {/* seen / first-met line */}
        <p className="-mt-2 text-sm text-[var(--muted)]">
          Seen {relativeSeen(person.last_seen)}
          {person.first_seen ? ` · first met ${fmtDay(person.first_seen)}` : ""}
        </p>

        {/* Tags — editable: remove a chip via its ×, add one via the input. */}
        <div className="flex flex-wrap items-center gap-2">
          {person.tags.map((tag) => (
            <Chip key={tag}>
              <span className="flex items-center gap-1">
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  disabled={savingTags}
                  onClick={() => removeTag(tag)}
                  className="flex flex-none items-center justify-center opacity-70 transition-opacity hover:opacity-100 disabled:opacity-40"
                >
                  <Icon icon={PiX} size={10} />
                </button>
              </span>
            </Chip>
          ))}
          <span className="flex items-center gap-1">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                } else if (e.key === "Escape") {
                  // Escape belongs to the tag input (clear the draft), not the
                  // modal — stop it reaching the window close-on-Escape handler.
                  e.preventDefault();
                  e.stopPropagation();
                  setTagInput("");
                  e.currentTarget.blur();
                }
              }}
              disabled={savingTags}
              aria-label="Add a tag"
              placeholder="add a tag"
              className="w-24 min-w-0 border-2 border-[var(--border)] bg-[var(--field-background)] px-2 py-1 font-sans text-xs text-[var(--field-foreground)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
            />
            <button
              type="button"
              aria-label="Add tag"
              disabled={savingTags}
              onClick={() => addTag()}
              className="pixel-btn touch-target flex flex-none items-center justify-center disabled:opacity-60"
            >
              <Icon icon={PiPlus} size={12} />
            </button>
          </span>
        </div>

        <div className="pixel-panel">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-pixel text-[10px]">Notes</h3>
            {!editingNotes && (
              <button
                type="button"
                aria-label="Edit notes"
                onClick={startEditingNotes}
                className="pixel-btn touch-target flex flex-none items-center justify-center"
              >
                <Icon icon={PiPencilSimple} size={14} />
              </button>
            )}
          </div>
          {editingNotes ? (
            <div className="mt-2 flex flex-col gap-2">
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEditingNotes();
                  }
                }}
                disabled={savingNotes}
                autoFocus
                rows={4}
                aria-label="Notes"
                placeholder="Jot something down about them…"
                className="w-full resize-y border-2 border-[var(--border)] bg-[var(--field-background)] px-2 py-1 font-sans text-sm leading-relaxed text-[var(--field-foreground)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  aria-label="Save notes"
                  disabled={savingNotes}
                  onClick={() => void saveNotes()}
                  className="pixel-btn touch-target flex flex-none items-center justify-center disabled:opacity-60"
                >
                  <Icon icon={PiCheck} size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Cancel notes edit"
                  disabled={savingNotes}
                  onClick={cancelEditingNotes}
                  className="pixel-btn touch-target flex flex-none items-center justify-center disabled:opacity-60"
                >
                  <Icon icon={PiX} size={14} />
                </button>
              </div>
            </div>
          ) : (
            (() => {
              const jots = noteLines(person.notes);
              return jots.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1">
                  {jots.map((line, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed">
                      <span
                        aria-hidden
                        className="flex-none text-[var(--accent)]"
                      >
                        •
                      </span>
                      <span className="min-w-0">{line}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                  No notes yet — tap the pencil to add one.
                </p>
              );
            })()
          )}
        </div>

        <div className="pixel-panel">
          <h3 className="font-pixel text-[10px]">Recent interactions</h3>
          <p className="mt-1 text-xs opacity-70">
            Tap a row to jump into that chat
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {recentDays.length === 0 && (
              <p className="text-sm opacity-70">
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
                className="touch-target flex items-center justify-between gap-3 rounded-lg border-2 border-[#d9a066]/40 bg-[#eec39a]/20 px-3 py-2.5 transition-colors hover:bg-[#eec39a]/50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {fmtDay(d.day + "T00:00:00Z")}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {formatClock(d.first)}
                  </p>
                </div>
                <div className="flex flex-none items-center gap-1.5">
                  <span className="text-xs text-[var(--muted)]">
                    {d.count} {d.count === 1 ? "moment" : "moments"}
                  </span>
                  <Icon icon={PiCaretRight} className="opacity-60" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="presentation"
      onMouseDown={(e) => {
        pressOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={person ? displayName(person) : "Person profile"}
        className="pixel-bubble sp-modal-card relative flex max-h-[85vh] w-full max-w-md flex-col p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="pixel-icon-btn touch-target absolute top-2 right-2 z-10 flex items-center justify-center"
        >
          <Icon icon={PiX} size={16} />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-5">{body}</div>
      </div>
    </div>
  );
}
