import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Chip } from "@heroui/react";
import {
  PiCaretLeft,
  PiCaretRight,
  PiCheck,
  PiPencilSimple,
  PiStarFill,
  PiUserCircleDashed,
  PiX,
} from "react-icons/pi";
import { Icon } from "@/components/Icon";
import { PixelBottomNav, PixelHeader } from "@/components/PixelChrome";
import { useToast } from "@/lib/toast";
import { PixelSprite } from "@/lib/pixel-sprite";
import {
  api,
  ApiError,
  displayName,
  renamePerson,
  type ApiPersonDetail,
} from "@/lib/api";
import { formatClock, relativeSeen } from "@/lib/scene-utils";

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

type Status = "loading" | "ready" | "missing" | "error";

/** Shared pixel chrome around every Person state (loading/missing/ready). */
function PersonChrome({ children }: { children: ReactNode }) {
  return (
    <div className="app-h flex flex-col overflow-hidden">
      <PixelHeader />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <PixelBottomNav />
    </div>
  );
}

/** Person info — real `/people/{id}` data: sprite, bio, notes, recent days. */
export function PersonPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [person, setPerson] = useState<ApiPersonDetail | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  // Inline rename (next to the name heading) — draft text lives separately
  // from `person` so a failed save doesn't clobber the last-good name.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

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
      <PersonChrome>
        <section className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="animate-pulse text-sm text-[var(--muted)]">
            Loading your world…
          </p>
        </section>
      </PersonChrome>
    );
  }

  if (status === "missing" || status === "error" || !person) {
    return (
      <PersonChrome>
        <section className="flex flex-col items-center gap-3 px-4 py-12 text-center">
          <Icon
            icon={PiUserCircleDashed}
            className="text-5xl text-[var(--muted)]"
          />
          <h1 className="font-pixel text-[13px]">
            {status === "error" ? "Backend asleep…" : "No one here yet"}
          </h1>
          <p className="text-sm text-[var(--muted)]">
            {status === "error"
              ? "Couldn't reach the SavePoint API — is it up?"
              : "We haven't met this character."}
          </p>
          <button
            type="button"
            className="pixel-btn touch-target mt-1 px-4 py-2"
            onClick={() => navigate("/people")}
          >
            <span className="font-pixel text-[10px]">Back to People</span>
          </button>
        </section>
      </PersonChrome>
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

  const startEditingName = () => {
    setNameDraft(person.name ?? "");
    setEditingName(true);
  };

  const cancelEditingName = () => {
    setEditingName(false);
  };

  // Trim client-side, but an empty result is a legitimate save (clears the
  // name back to "Neighbor XXX" — see `displayName`), not a validation error.
  const saveName = async () => {
    setSavingName(true);
    try {
      const updated = await renamePerson(person.local_id, nameDraft.trim());
      setPerson((p) => (p ? { ...p, name: updated.name } : p));
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

  return (
    <PersonChrome>
      <section
        aria-labelledby="person-heading"
        className="flex flex-col gap-5 px-4 pt-4 pb-6"
      >
        <Link
          to="/people"
          className="pixel-btn touch-target inline-flex items-center gap-1.5 self-start px-3 py-1.5"
        >
          <Icon icon={PiCaretLeft} size={12} />
          <span className="font-pixel text-[9px]">People</span>
        </Link>

        <div className="flex items-center gap-4">
          <span className="sprite-bob">
            <PixelSprite
              localId={person.local_id}
              sprite={person.sprite}
              params={person.avatar_params}
              size={84}
            />
          </span>
          <div className="min-w-0">
            <h1
              id="person-heading"
              className="font-pixel flex flex-wrap items-center gap-2 text-[13px] leading-6 break-words"
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
                  <button
                    type="button"
                    aria-label="Rename"
                    onClick={startEditingName}
                    className="pixel-btn touch-target flex flex-none items-center justify-center"
                  >
                    <Icon icon={PiPencilSimple} size={14} />
                  </button>
                </>
              )}
            </h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Seen {relativeSeen(person.last_seen)}
              {person.first_seen
                ? ` · first met ${fmtDay(person.first_seen)}`
                : ""}
            </p>
          </div>
        </div>

        {/* Generated character flavor — distinct from the Notes card below. */}
        {person.bio?.trim() && (
          <p className="border-l-2 border-[var(--accent)] pl-3 text-sm leading-relaxed text-[var(--muted)] italic">
            {person.bio.trim()}
          </p>
        )}

        {person.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {person.tags.map((tag) => (
              <Chip key={tag}>{tag}</Chip>
            ))}
          </div>
        )}

        <div className="pixel-panel">
          <h2 className="font-pixel text-[10px]">Notes</h2>
          <p className="mt-2 text-sm leading-relaxed">
            {person.notes?.trim() ||
              "No notes yet — your next chat will fill this in."}
          </p>
        </div>

        <div className="pixel-panel">
          <h2 className="font-pixel text-[10px]">Recent interactions</h2>
          <p className="mt-1 text-xs opacity-70">
            Tap a row to jump into that chat
          </p>
          <div className="mt-2 flex flex-col">
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
                className="touch-target flex items-center justify-between border-b-2 border-[#d9a066]/40 px-1 py-2 text-sm transition-colors last:border-b-0 hover:bg-[#eec39a]/50"
              >
                <span>
                  {fmtDay(d.day + "T00:00:00Z")} · {formatClock(d.first)} ·{" "}
                  {d.count} {d.count === 1 ? "moment" : "moments"}
                </span>
                <Icon icon={PiCaretRight} className="opacity-60" />
              </Link>
            ))}
          </div>
        </div>
      </section>
    </PersonChrome>
  );
}
