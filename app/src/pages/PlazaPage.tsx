/**
 * Main page — ONE continuous pixel world you swipe between (scroll-snap):
 *   panel 1: the character plaza — everyone from `/people` wandering a plot;
 *   panel 2: the calendar garden — `/days` as a month of growing plants.
 * Matches waterprism's mockup: wooden Savepoint header, whistle + Past
 * floating controls, and the [ Today ][ journal ][ people ] bottom bar.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GiWhistle } from "react-icons/gi";
import { PiCaretLeft, PiCaretRight } from "react-icons/pi";
import { Icon } from "@/components/Icon";
import { PixelBottomNav, PixelHeader } from "@/components/PixelChrome";
import { ParametricSprite } from "@/lib/sprite";
import { api, displayName, type ApiDay, type ApiPerson } from "@/lib/api";
import { addMonth, monthGrid, monthName } from "@/lib/calendar";
import { FenceRow, Pine, PlantSprite, Rock, Tree } from "@/lib/scene";
import { rand } from "@/lib/scene-utils";
import { TODAY_ISO } from "@/lib/seed";

function relativeSeen(iso: string | null): string {
  if (!iso) return "a while ago";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export function PlazaPage() {
  const [searchParams] = useSearchParams();
  const scrollerRef = useRef<HTMLDivElement>(null);

  const [people, setPeople] = useState<ApiPerson[] | null>(null);
  const [days, setDays] = useState<ApiDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<0 | 1>(
    searchParams.get("view") === "garden" ? 1 : 0,
  );
  const [lined, setLined] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    api.people(ac.signal).then(setPeople, (e) => {
      if (!ac.signal.aborted) setError(String(e));
    });
    api.days(ac.signal).then(setDays, (e) => {
      if (!ac.signal.aborted) setError(String(e));
    });
    return () => ac.abort();
  }, []);

  // Deep-link ?view=garden: land on the garden panel without animating.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el && searchParams.get("view") === "garden") {
      el.scrollTo({ left: el.clientWidth });
    }
    // Initial placement only — later navigation is user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gotoPanel = (idx: 0 | 1) => {
    const el = scrollerRef.current;
    if (el) el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
  };

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth) === 0 ? 0 : 1;
    if (idx !== view) setView(idx);
  };

  return (
    <div className="flex h-[100svh] flex-col overflow-hidden">
      <PixelHeader />

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className="no-scrollbar flex h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
        >
          <PlazaPanel people={people} error={error} lined={lined} />
          <GardenPanel days={days} />
        </div>

        {/* floating controls (whistle + Past), per the mockup */}
        <div className="absolute right-3 bottom-9 z-20 flex flex-col items-end gap-2">
          <button
            type="button"
            aria-label={lined ? "Free roam" : "Whistle — line everyone up"}
            aria-pressed={lined}
            className="pixel-btn flex h-12 w-14 items-center justify-center"
            onClick={() => {
              setLined((v) => !v);
              gotoPanel(0);
            }}
          >
            <Icon icon={GiWhistle} size={26} />
          </button>
          <button
            type="button"
            className="pixel-btn touch-target px-5 py-2.5"
            onClick={() => gotoPanel(view === 0 ? 1 : 0)}
          >
            <span className="font-pixel text-[12px]">
              {view === 0 ? "Past" : "Plaza"}
            </span>
          </button>
        </div>

        {/* swipe indicator */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-2 z-20 flex justify-center gap-1.5"
        >
          {[0, 1].map((i) => (
            <span
              key={i}
              className={`h-1.5 w-1.5 rounded-full ${view === i ? "bg-white" : "bg-white/40"}`}
              style={{ boxShadow: "0 1px 0 rgba(0,0,0,.4)" }}
            />
          ))}
        </div>
      </div>

      <PixelBottomNav />
    </div>
  );
}

/* ---- panel 1: character plaza --------------------------------------------- */

function PlazaPanel({
  people,
  error,
  lined,
}: {
  people: ApiPerson[] | null;
  error: string | null;
  lined: boolean;
}) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);

  const placed = useMemo(() => {
    // Curated scatter spots (plot %), so any crowd up to 12 reads evenly
    // spread like the mockup; a small per-person hash jitter keeps it organic.
    const SLOTS: Array<[number, number]> = [
      [22, 26],
      [68, 20],
      [44, 40],
      [86, 46],
      [14, 54],
      [58, 60],
      [32, 74],
      [78, 80],
      [20, 88],
      [52, 90],
      [90, 66],
      [40, 14],
    ];
    const list = people ?? [];
    return list.map((p, i) => {
      const [bx, by] = SLOTS[i % SLOTS.length];
      const sx = bx + (rand(p.local_id, 1) - 0.5) * 9;
      const sy = by + (rand(p.local_id, 2) - 0.5) * 9;
      const cols = Math.min(Math.max(list.length, 1), 4);
      const lx = ((i % cols) + 0.5) * (100 / cols);
      const ly = 30 + Math.floor(i / cols) * 32;
      return { p, sx, sy, lx, ly, drift: 5 + rand(p.local_id, 3) * 5 };
    });
  }, [people]);

  return (
    <section
      aria-label="Plaza — everyone you have met"
      className="grass-bg scene-dimmable relative isolate h-full w-full shrink-0 snap-start overflow-hidden"
      onClick={() => setSelected(null)}
    >
      {/* scenery ring around the plot */}
      <FenceRow className="absolute top-2 left-0 w-full" />
      <Tree className="absolute -top-1 left-3 h-24 w-auto" />
      <Tree className="absolute -top-2 right-4 h-24 w-auto" />
      <Pine className="absolute right-[-14px] bottom-[10%] h-24 w-auto" />
      <Tree className="absolute bottom-[2%] left-2 h-20 w-auto" />
      <Rock className="absolute top-[42%] right-1 h-8 w-auto" />
      <Rock small className="absolute right-[30%] bottom-[7%] h-7 w-auto" />
      <FenceRow className="absolute bottom-[3%] left-0 w-[55%]" />

      {/* the plot everyone stands in */}
      <div className="dirt-plot absolute inset-x-[7%] top-[15%] bottom-[21%]">
        {error && (
          <p className="pixel-name font-pixel absolute inset-x-4 top-1/3 text-center text-[10px] leading-5">
            Backend asleep… is the API up?
          </p>
        )}
        {!error && people && people.length === 0 && (
          <p className="pixel-name font-pixel absolute inset-x-4 top-1/3 text-center text-[10px] leading-5">
            Nobody here yet. Go say hi!
          </p>
        )}

        {placed.map(({ p, sx, sy, lx, ly, drift }) => {
          const x = lined ? lx : sx;
          const y = lined ? ly : sy;
          const isSel = selected === p.local_id;
          return (
            <div
              key={p.local_id}
              className="sp-actor"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                zIndex: isSel ? 30 : Math.round(y),
              }}
            >
              <div
                className={lined ? "" : "sp-drift"}
                style={{ ["--drift" as string]: `${drift}px` }}
              >
                <button
                  type="button"
                  aria-label={displayName(p)}
                  className="sp-bob block -translate-x-1/2 -translate-y-full cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(isSel ? null : p.local_id);
                  }}
                >
                  <ParametricSprite params={p.avatar_params} size={60} />
                </button>
                {isSel && (
                  <PersonBubble
                    person={p}
                    x={x}
                    onOpen={() => navigate(`/people/${p.local_id}`)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---- panel 2: calendar garden --------------------------------------------- */

function GardenPanel({ days }: { days: ApiDay[] | null }) {
  const navigate = useNavigate();
  const [cursor, setCursor] = useState(() => ({
    year: Number(TODAY_ISO.slice(0, 4)),
    month: Number(TODAY_ISO.slice(5, 7)),
  }));
  const [selected, setSelected] = useState<{
    iso: string;
    week: number;
    col: number;
  } | null>(null);
  const [peeks, setPeeks] = useState<Record<string, string>>({});

  const byIso = useMemo(
    () => new Map((days ?? []).map((d) => [d.date, d])),
    [days],
  );
  const weeks = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);

  // Lazily fetch a short recap line for the tapped day's bubble.
  useEffect(() => {
    if (!selected || peeks[selected.iso] !== undefined) return;
    const iso = selected.iso;
    api.day(iso).then(
      (v) => setPeeks((p) => ({ ...p, [iso]: v.recap?.narrative ?? "" })),
      () => setPeeks((p) => ({ ...p, [iso]: "" })),
    );
  }, [selected, peeks]);

  const selectedDay = selected ? byIso.get(selected.iso) : undefined;

  return (
    <section
      aria-label="Garden — your days as plants"
      className="grass-bg scene-dimmable relative isolate h-full w-full shrink-0 snap-start overflow-hidden"
      onClick={() => setSelected(null)}
    >
      <FenceRow className="absolute top-2 left-0 w-full" />
      <Tree className="absolute -top-1 left-2 h-20 w-auto" />
      <Tree className="absolute -top-2 right-3 h-24 w-auto" />
      <Rock small className="absolute bottom-[8%] left-[8%] h-7 w-auto" />
      <Pine className="absolute bottom-[2%] left-[-12px] h-20 w-auto" />

      <div className="dirt-plot absolute inset-x-[4%] top-[13%] bottom-[13%] flex flex-col">
        {/* month header */}
        <div className="flex items-center justify-between px-1 pt-1">
          <button
            type="button"
            aria-label="Previous month"
            className="touch-target px-1 text-white/90"
            onClick={(e) => {
              e.stopPropagation();
              setSelected(null);
              setCursor((c) => addMonth(c.year, c.month, -1));
            }}
          >
            <Icon icon={PiCaretLeft} size={20} />
          </button>
          <h2 className="pixel-name font-pixel text-lg">
            {monthName(cursor.month)}
          </h2>
          <button
            type="button"
            aria-label="Next month"
            className="touch-target px-1 text-white/90"
            onClick={(e) => {
              e.stopPropagation();
              setSelected(null);
              setCursor((c) => addMonth(c.year, c.month, 1));
            }}
          >
            <Icon icon={PiCaretRight} size={20} />
          </button>
        </div>

        {/* weekday row */}
        <div className="grid grid-cols-7 px-1 pt-1 pb-0.5">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <span
              key={i}
              className="pixel-name font-pixel text-center text-[9px] opacity-90"
            >
              {d}
            </span>
          ))}
        </div>

        {/* the plot grid */}
        <div className="relative min-h-0 flex-1 px-1 pb-1">
          <div
            className="grid h-full grid-cols-7"
            style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}
          >
            {weeks.flatMap((week, w) =>
              week.map((cell, c) =>
                cell.iso ? (
                  <button
                    key={cell.iso}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const iso = cell.iso!;
                      setSelected((s) =>
                        s?.iso === iso ? null : { iso, week: w, col: c },
                      );
                    }}
                    aria-label={`Day ${cell.day}`}
                    className={[
                      "relative flex items-end justify-center border border-black/10 pb-0.5",
                      cell.iso === TODAY_ISO
                        ? "outline-2 outline-offset-[-2px] outline-[#ffdf8a]"
                        : "",
                    ].join(" ")}
                  >
                    <span className="font-pixel absolute top-0 left-0.5 text-[7px] text-[#f3e2b8] opacity-90">
                      {cell.day}
                    </span>
                    <PlantSprite
                      stage={byIso.get(cell.iso)?.plant_stage ?? 0}
                      size={18 + (byIso.get(cell.iso)?.plant_stage ?? 0) * 8}
                    />
                  </button>
                ) : (
                  <span key={`x-${w}-${c}`} aria-hidden />
                ),
              ),
            )}
          </div>

          {/* tapped-day bubble */}
          {selected && (
            <DayBubble
              iso={selected.iso}
              day={selectedDay}
              peek={peeks[selected.iso]}
              x={((selected.col + 0.5) / 7) * 100}
              y={(selected.week / weeks.length) * 100}
              onOpen={() => navigate(`/scene/${selected.iso}`)}
            />
          )}
        </div>
      </div>
    </section>
  );
}

/* ---- bubbles -------------------------------------------------------------- */

/** Horizontal clamp so bubbles near the plot edges stay on screen. */
function bubbleShift(x: number): string {
  if (x < 26) return "-14%";
  if (x > 74) return "-86%";
  return "-50%";
}

/** Where the tail sits so it keeps pointing at the anchor after the clamp. */
function tailLeft(x: number): string {
  if (x < 26) return "14%";
  if (x > 74) return "86%";
  return "50%";
}

function PersonBubble({
  person,
  x,
  onOpen,
}: {
  person: ApiPerson;
  x: number;
  onOpen: () => void;
}) {
  const note = person.notes?.trim();
  return (
    <div
      className="pixel-bubble absolute bottom-full left-1/2 z-30 mb-16 w-48 px-3 py-2.5 text-left"
      style={{ transform: `translateX(${bubbleShift(x)})` }}
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-sm leading-tight font-bold">{displayName(person)}</p>
      <p className="text-xs opacity-60">
        seen {relativeSeen(person.last_seen)}
      </p>
      {note && <p className="mt-1 line-clamp-2 text-xs leading-snug">{note}</p>}
      <button
        type="button"
        className="pixel-btn font-pixel mt-2 px-3 py-1.5 text-[9px]"
        onClick={onOpen}
      >
        open profile
      </button>
      <span
        className="pixel-bubble-tail -translate-x-1/2"
        style={{ left: tailLeft(x) }}
      />
    </div>
  );
}

function DayBubble({
  iso,
  day,
  peek,
  x,
  y,
  onOpen,
}: {
  iso: string;
  day: ApiDay | undefined;
  peek: string | undefined;
  x: number;
  y: number;
  onOpen: () => void;
}) {
  const label = new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const summary = day?.summary;
  return (
    <div
      className="pixel-bubble absolute z-30 w-52 px-3 py-2.5 text-left"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        transform: `translate(${bubbleShift(x)}, calc(-100% - 12px))`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-sm leading-tight font-bold">{label}</p>
      {summary ? (
        <p className="text-xs opacity-60">
          {summary.people} {summary.people === 1 ? "person" : "people"} ·{" "}
          {summary.events} moments
        </p>
      ) : (
        <p className="text-xs opacity-60">nothing recorded</p>
      )}
      {peek ? (
        <p className="mt-1 line-clamp-2 text-xs leading-snug">{peek}</p>
      ) : null}
      {summary && (
        <button
          type="button"
          className="pixel-btn font-pixel mt-2 px-3 py-1.5 text-[9px]"
          onClick={onOpen}
        >
          view day
        </button>
      )}
      <span
        className="pixel-bubble-tail -translate-x-1/2"
        style={{ left: tailLeft(x) }}
      />
    </div>
  );
}
