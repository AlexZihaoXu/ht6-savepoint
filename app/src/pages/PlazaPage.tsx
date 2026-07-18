import { useEffect, useMemo, useRef, useState } from "react";
import { GiWhistle } from "react-icons/gi";
import { PiUsersThreeFill, PiArrowsOutCardinalFill } from "react-icons/pi";
import { Icon } from "@/components/Icon";
import { ParametricSprite } from "@/lib/sprite";
import { api, displayName, type ApiPerson } from "@/lib/api";

/** Stable 0..1 pseudo-random from a string + salt (deterministic per person). */
function rand(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function relativeSeen(iso: string | null): string {
  if (!iso) return "a while ago";
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.parse("2026-07-18T18:00:00Z") - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/**
 * Character plaza (redesign, waterprism) — everyone you've met as a little
 * wandering pixel character, straight from the live `/people` API. The whistle
 * calls them into a tidy line; tap one to peek at who they are. Sprites are the
 * parametric placeholder (real pixel kit TBD), so identity → a stable character.
 */
export function PlazaPage() {
  const [people, setPeople] = useState<ApiPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lined, setLined] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    api
      .people(ac.signal)
      .then(setPeople)
      .catch((e) => {
        if (!ac.signal.aborted) setError(String(e));
      });
    return () => ac.abort();
  }, []);

  const placed = useMemo(() => {
    const list = people ?? [];
    return list.map((p, i) => {
      // Scattered "home" spot in the field (deterministic), and a line slot.
      const sx = 8 + rand(p.local_id, 1) * 78;
      const sy = 20 + rand(p.local_id, 2) * 58;
      const cols = Math.min(list.length, 5);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const lx = 12 + (col + 0.5) * (76 / cols);
      const ly = 40 + row * 26;
      return { p, sx, sy, lx, ly, drift: 5 + rand(p.local_id, 3) * 4 };
    });
  }, [people]);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="plaza-heading">
      <style>{`
        @keyframes sp-bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
        @keyframes sp-drift { 0%,100%{margin-left:0} 50%{margin-left:var(--drift,6px)} }
        .sp-actor{ position:absolute; transition:left .9s cubic-bezier(.4,0,.2,1),top .9s cubic-bezier(.4,0,.2,1); }
        .sp-bob{ animation:sp-bob 2.6s ease-in-out infinite; }
        .sp-drift{ animation:sp-drift 6s ease-in-out infinite; }
      `}</style>

      <header className="flex items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h1 id="plaza-heading" className="text-2xl font-semibold tracking-tight">
            Your plaza
          </h1>
          <p className="text-sm text-[var(--muted)] flex items-center gap-1.5">
            <Icon icon={PiUsersThreeFill} />
            {people ? `${people.length} met` : "loading…"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setLined((v) => !v)}
          className="flex items-center gap-1.5 bg-[var(--accent)] text-[var(--accent-foreground)] px-3 py-2 text-sm font-semibold shadow-sm active:translate-y-px"
        >
          <Icon icon={lined ? PiArrowsOutCardinalFill : GiWhistle} size={18} />
          {lined ? "Free roam" : "Whistle"}
        </button>
      </header>

      <div
        ref={fieldRef}
        onClick={() => setSelected(null)}
        className="relative w-full overflow-hidden rounded-none ring-1 ring-[var(--separator)]"
        style={{
          height: "clamp(360px, 62vh, 560px)",
          background:
            "linear-gradient(#bfe08a,#a6d06e 55%,#93c25c)",
          imageRendering: "pixelated",
        }}
      >
        {/* decorative scenery */}
        <Scenery />

        {error && <Centered>Couldn’t reach the backend.<br />{"Is the API up?"}</Centered>}
        {!error && people && people.length === 0 && (
          <Centered>Nobody here yet 🌱<br />Go say hi to someone.</Centered>
        )}

        {placed.map(({ p, sx, sy, lx, ly, drift }) => {
          const left = lined ? lx : sx;
          const top = lined ? ly : sy;
          const isSel = selected === p.local_id;
          return (
            <div
              key={p.local_id}
              className="sp-actor"
              style={{ left: `${left}%`, top: `${top}%`, zIndex: isSel ? 30 : Math.round(top) }}
            >
              <div className={lined ? "" : "sp-drift"} style={{ ["--drift" as string]: `${drift}px` }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(isSel ? null : p.local_id);
                  }}
                  className="sp-bob block -translate-x-1/2 -translate-y-full cursor-pointer"
                  aria-label={displayName(p)}
                >
                  <ParametricSprite params={p.avatar_params} size={72} />
                </button>
                {isSel && <Bubble person={p} />}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-[var(--muted)] text-center">
        Live from <code>/people</code> · tap a character · whistle to line them up
      </p>
    </section>
  );
}

function Bubble({ person }: { person: ApiPerson }) {
  const note = person.notes?.trim();
  return (
    <div
      className="absolute left-1/2 bottom-full mb-1 -translate-x-1/2 w-44 bg-[var(--surface)] text-[var(--surface-foreground)] ring-1 ring-[var(--separator)] shadow-md px-3 py-2 text-left"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-sm font-semibold leading-tight">{displayName(person)}</p>
      <p className="text-xs text-[var(--muted)]">seen {relativeSeen(person.last_seen)}</p>
      {note && <p className="mt-1 text-xs leading-snug line-clamp-2">{note}</p>}
      <span className="absolute left-1/2 top-full -translate-x-1/2 border-8 border-transparent border-t-[var(--surface)]" />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-center text-sm font-medium text-[oklch(28%_0.04_146)] px-6">
      <p>{children}</p>
    </div>
  );
}

/** Cheap cozy scenery: a few trees, bushes, and a fence line. */
function Scenery() {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* dirt patch */}
      <ellipse cx="50" cy="86" rx="46" ry="9" fill="#c9a26a" opacity="0.5" />
      {/* fence */}
      <g stroke="#8a6a44" strokeWidth="1.1">
        <line x1="4" y1="14" x2="96" y2="14" />
        <line x1="4" y1="17" x2="96" y2="17" />
      </g>
      {[10, 26, 42, 58, 74, 90].map((x) => (
        <rect key={x} x={x} y="11" width="1.6" height="8" fill="#9a764c" />
      ))}
      {/* trees */}
      {[
        [12, 26],
        [86, 22],
        [72, 30],
      ].map(([x, y], i) => (
        <g key={i}>
          <rect x={x - 1} y={y} width="2" height="6" fill="#7a552f" />
          <circle cx={x} cy={y - 3} r="6" fill="#5f9a44" />
          <circle cx={x - 3} cy={y - 1} r="4" fill="#6fae4f" />
          <circle cx={x + 3} cy={y - 1} r="4" fill="#548a3c" />
        </g>
      ))}
    </svg>
  );
}
