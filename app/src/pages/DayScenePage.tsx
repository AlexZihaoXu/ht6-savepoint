/**
 * Day/Today view — a cinematic letterboxed replay of one day, staged like a
 * visual-novel conversation: only TWO characters are ever on the otherwise
 * empty garden — [you] fixed on the LEFT and the current conversation
 * partner on the RIGHT (swapping as the day moves between people). Whoever
 * is speaking stands lit at full opacity with a nameplate riding the
 * dialogue box; the listener waits dimmed. A Stardew-style wooden dialogue
 * box plays the active utterance (typewriter, tap-to-advance), a top-right
 * toggle opens the transcript history, and a stone timeline scrubber at the
 * bottom moves through the day.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useReducedMotion } from "framer-motion";
import { PiCaretDown, PiScroll, PiX } from "react-icons/pi";
import { Icon } from "@/components/Icon";
import { PixelHeader } from "@/components/PixelChrome";
import { ParametricSprite } from "@/lib/sprite";
import {
  api,
  displayName,
  type ApiDayView,
  type ApiEvent,
  type ApiPerson,
} from "@/lib/api";
import { Cabin, FenceRow, Tree } from "@/lib/scene";
import {
  fallbackAvatar,
  formatClock,
  nameFor,
  nearestEventTs,
  partnerAt,
  YOU_AVATAR,
} from "@/lib/scene-utils";

export function DayScenePage() {
  const { date } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isToday = !date || date === "today";

  // ?t= / ?ts= deep link (ISO string or epoch ms): open the day scrubbed to
  // that moment — a person's "Recent interactions" rows land the user right
  // inside the conversation instead of at the start of the day.
  const rawT = searchParams.get("t") ?? searchParams.get("ts");
  const deepMs = rawT
    ? /^\d+$/.test(rawT)
      ? Number(rawT)
      : Date.parse(rawT)
    : NaN;

  const [view, setView] = useState<ApiDayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrubT, setScrubT] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    (isToday ? api.today(ac.signal) : api.day(date!, ac.signal)).then(
      (v) => {
        setView(v);
        // Land on the deep-linked moment (snapped to the nearest event so
        // the matching line is active), else on the day's first event.
        const first = v.events[0];
        setScrubT(
          nearestEventTs(v.events, deepMs) ??
            (first ? new Date(first.ts).getTime() : null),
        );
      },
      (e) => {
        if (!ac.signal.aborted) setError(String(e));
      },
    );
    return () => ac.abort();
    // deepMs only changes with the URL (scrubbing is local state), so this
    // re-runs exactly on navigation. NaN is Object.is-stable as a dep.
  }, [date, isToday, deepMs]);

  const events = useMemo(() => view?.events ?? [], [view]);
  const peopleById = useMemo(
    () => new Map((view?.people ?? []).map((p) => [p.local_id, p])),
    [view],
  );

  const t0 = events.length ? new Date(events[0].ts).getTime() : 0;
  const t1 = events.length
    ? new Date(events[events.length - 1].ts).getTime()
    : 0;
  const t = scrubT ?? t0;

  // Active line = the last event whose timestamp has passed the scrub time.
  const activeIdx = useMemo(() => {
    let idx = 0;
    for (let i = 0; i < events.length; i++) {
      if (new Date(events[i].ts).getTime() <= t) idx = i;
    }
    return idx;
  }, [events, t]);

  // Who shares the stage with you right now (the RIGHT-side character).
  const partnerId = useMemo(
    () => partnerAt(events, activeIdx),
    [events, activeIdx],
  );

  const active: ApiEvent | undefined = events[activeIdx];
  const youSpeaking = active?.person_id === "you";
  const speakerName = active
    ? nameFor(active.person_id, peopleById, displayName)
    : "";
  const dateLabel = (view?.day?.date ?? (isToday ? "today" : date)) as string;

  const jumpTo = (i: number) => {
    const e = events[i];
    if (e) setScrubT(new Date(e.ts).getTime());
  };

  return (
    <div className="flex h-[100svh] flex-col overflow-hidden bg-black">
      <PixelHeader />

      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* top letterbox bar */}
        <div className="relative h-14 flex-none">
          <span className="font-pixel absolute top-3 left-3 text-[9px] text-white/50">
            {isToday
              ? "Today"
              : /^\d{4}-\d{2}-\d{2}$/.test(dateLabel)
                ? new Date(`${dateLabel}T00:00:00Z`).toLocaleDateString(
                    "en-US",
                    { month: "short", day: "numeric", timeZone: "UTC" },
                  )
                : dateLabel}
          </span>
          <button
            type="button"
            aria-label="Transcript history"
            aria-expanded={showTranscript}
            className="touch-target absolute top-1.5 right-2 flex items-center justify-center text-white/90"
            onClick={() => setShowTranscript((v) => !v)}
          >
            <Icon icon={PiScroll} size={24} />
          </button>
        </div>

        {/* the scene */}
        <div className="grass-bg scene-dimmable scene-vignette relative isolate [height:36%] flex-none overflow-hidden">
          <FenceRow className="absolute top-1 left-0 w-full" />
          <Tree className="absolute -top-1 -left-2 h-16 w-auto" />
          <Tree className="absolute -top-2 right-0 h-16 w-auto" />

          <div className="dirt-plot absolute inset-x-[5%] top-[18%] bottom-[6%]">
            {error && (
              <p className="pixel-name font-pixel absolute inset-x-4 top-1/3 z-10 text-center text-[10px] leading-5">
                Backend asleep… is the API up?
              </p>
            )}
            {!error && !view && (
              <p className="pixel-name font-pixel absolute inset-x-4 top-1/3 z-10 animate-pulse text-center text-[10px] leading-5">
                Loading your world…
              </p>
            )}
            {!error && view && events.length === 0 && (
              <p className="pixel-name font-pixel absolute inset-x-4 top-1/4 z-10 text-center text-[10px] leading-5">
                Nothing recorded this day.
              </p>
            )}
          </div>

          {/* waterprism's cabin at the back of the yard (1x scale), clear of
              the stage characters standing along the bottom of the scene */}
          <Cabin className="absolute top-[8%] right-[8%] h-[95px] w-auto" />
        </div>

        {/* dialogue box — the two big characters stand right on top of it,
            [you] LEFT / partner RIGHT, their lower third hidden by the box */}
        <div className="flex-none px-2 pt-4">
          {active && (
            <div className="relative">
              <StageActor side="left" name="You" lit={youSpeaking}>
                <ParametricSprite params={YOU_AVATAR} size={STAGE_SIZE} />
              </StageActor>
              {partnerId && (
                <StageActor
                  key={partnerId}
                  side="right"
                  name={nameFor(partnerId, peopleById, displayName)}
                  lit={!youSpeaking}
                  enter
                >
                  <ParametricSprite
                    params={
                      peopleById.get(partnerId)?.avatar_params ??
                      fallbackAvatar(partnerId)
                    }
                    size={STAGE_SIZE}
                  />
                </StageActor>
              )}
              <DialogueBox
                event={active}
                name={speakerName}
                side={youSpeaking ? "left" : "right"}
                hasNext={activeIdx < events.length - 1}
                onAdvance={() =>
                  jumpTo(Math.min(activeIdx + 1, events.length - 1))
                }
                onDone={() => navigate("/plaza")}
              />
            </div>
          )}
          {!active && view && events.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-white/60">
              A quiet day — no moments were saved.{" "}
              <Link to="/plaza" className="underline">
                Back to the plaza
              </Link>
            </p>
          )}
        </div>

        {/* bottom letterbox */}
        <div className="min-h-0 flex-1" />

        {/* timeline scrubber */}
        <div className="flex-none px-4 pt-1 pb-[max(0.9rem,env(safe-area-inset-bottom))]">
          <input
            type="range"
            className="scrub"
            aria-label="Scrub through the day"
            min={t0}
            max={Math.max(t1, t0 + 1)}
            step={30000}
            value={t}
            disabled={events.length < 2}
            onChange={(e) => setScrubT(Number(e.target.value))}
          />
          <TimelineMarks events={events} t0={t0} t1={t1} />
        </div>

        {/* transcript history panel */}
        {showTranscript && (
          <TranscriptPanel
            events={events}
            peopleById={peopleById}
            activeIdx={activeIdx}
            onJump={(i) => {
              jumpTo(i);
              setShowTranscript(false);
            }}
            onClose={() => setShowTranscript(false)}
          />
        )}
      </div>
    </div>
  );
}

/* ---- stage characters ------------------------------------------------------ */

/** Visual-novel scale — the pair towers over the dialogue box. */
const STAGE_SIZE = 176;
/** Bottom ~third of each character hides behind the box. */
const STAGE_CLIP = Math.round(STAGE_SIZE * 0.34);

/**
 * One of the two conversation characters, anchored to the dialogue box: it
 * stands right on the box's top edge with its lower third behind the box
 * (the box paints above at z-10). The speaker (`lit`) is full opacity and
 * gently bobbing; the listener waits dimmed + desaturated.
 */
function StageActor({
  side,
  name,
  lit,
  enter,
  children,
}: {
  side: "left" | "right";
  name: string;
  lit: boolean;
  enter?: boolean;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <div
      className={`scene-dimmable pointer-events-none absolute z-0 ${
        side === "left" ? "left-[2%]" : "right-[2%]"
      }`}
      style={{ top: -(STAGE_SIZE - STAGE_CLIP) }}
    >
      {/* the pop-in animates ONLY opacity/scale — the actor mounts already
          at its final spot, so a partner swap can't flash or jump */}
      <div className={enter && !reduce ? "sp-pop" : ""}>
        <div
          className={`relative transition-[opacity,filter,transform] duration-500 ${
            lit && !reduce ? "sp-bob" : ""
          }`}
          style={
            lit
              ? {
                  opacity: 1,
                  filter: "none",
                  transform: reduce ? "translateY(-4px)" : undefined,
                }
              : {
                  opacity: 0.4,
                  filter: "saturate(0.35) brightness(0.92)",
                  transform: "translateY(4px) scale(0.97)",
                }
          }
        >
          <span className="pixel-name font-pixel absolute top-0 left-1/2 -translate-x-1/2 text-[8px] whitespace-nowrap">
            [{name}]
          </span>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ---- dialogue box ---------------------------------------------------------- */

/** A dialogue box never shows more than this many wrapped text lines. */
const MAX_BOX_LINES = 5;

function DialogueBox({
  event,
  name,
  side,
  hasNext,
  onAdvance,
  onDone,
}: {
  event: ApiEvent;
  name: string;
  /** Which stage side the speaker stands on — anchors the nameplate. */
  side: "left" | "right";
  hasNext: boolean;
  onAdvance: () => void;
  /** Final tap on the day's last line/page — leave the scene. */
  onDone: () => void;
}) {
  const reduce = useReducedMotion();
  const text =
    event.type === "spoke" && event.text ? event.text : `(${name} stopped by.)`;

  // Wrap-aware pagination: a hidden measurer with the exact width +
  // typography of the visible paragraph splits a long line into pages of at
  // most MAX_BOX_LINES rendered lines, breaking on word boundaries (binary
  // search per page for the longest word-span that still fits). One speaker
  // line can span as many boxes as it needs; nameplate + lit character stay
  // put while its pages turn.
  const measureRef = useRef<HTMLParagraphElement>(null);
  const [pages, setPages] = useState<string[]>([text]);
  const [page, setPage] = useState(0);

  useLayoutEffect(() => {
    const m = measureRef.current;
    if (!m) {
      setPages([text]);
      setPage(0);
      return;
    }
    const lineH = parseFloat(getComputedStyle(m).lineHeight) || 21;
    const maxH = lineH * (MAX_BOX_LINES + 0.5); // half-line tolerance
    const words = text.split(/\s+/).filter(Boolean);
    const out: string[] = [];
    let start = 0;
    while (start < words.length) {
      let lo = start + 1;
      let hi = words.length;
      let fit = start + 1; // always make progress, never split a word
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        m.textContent = words.slice(start, mid).join(" ");
        if (m.scrollHeight <= maxH) {
          fit = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      out.push(words.slice(start, fit).join(" "));
      start = fit;
    }
    m.textContent = "";
    setPages(out.length ? out : [text]);
    setPage(0);
  }, [text]);

  const pageText = pages[Math.min(page, pages.length - 1)] ?? text;
  const lastPage = page >= pages.length - 1;

  // Typewriter reveal, restarted per page; instant for reduced motion.
  // (No run-once guards: the effect must survive StrictMode's double-invoke,
  // so it is written to be safely restartable — reset, tick, cleanup.)
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (reduce) {
      setShown(pageText.length);
      return;
    }
    setShown(0);
    const iv = window.setInterval(() => {
      setShown((n) => {
        if (n >= pageText.length) {
          window.clearInterval(iv);
          return n;
        }
        return n + 2;
      });
    }, 22);
    return () => window.clearInterval(iv);
  }, [event._id, page, pageText.length, reduce]);

  const meta = [event.place, formatClock(event.ts)].filter(Boolean).join(" · ");
  const revealed = shown >= pageText.length;

  return (
    <div className="relative z-10">
      {/* speaker nameplate riding the box's top edge, on the speaker's side */}
      <span
        className={`dlg-nameplate font-pixel absolute -top-4 z-10 px-2.5 py-1.5 text-[9px] ${
          side === "left" ? "left-2" : "right-2"
        }`}
      >
        {name}
      </span>
      <button
        type="button"
        className="dlg-wood block w-full cursor-pointer p-3 text-left"
        onClick={() => {
          if (!revealed) setShown(pageText.length);
          else if (!lastPage) setPage((p) => p + 1);
          else if (hasNext) onAdvance();
          else onDone(); // day replayed to the end — back to the plaza
        }}
        aria-label="Dialogue — tap to continue"
      >
        <div className="dlg-text relative min-h-24 px-3 pt-2 pb-5">
          {meta && <p className="font-pixel text-[8px] opacity-60">{meta}</p>}
          <p className="mt-1.5 text-[15px] leading-snug font-medium">
            {pageText.slice(0, shown)}
          </p>
          {/* hidden measurer — same width + typography as the paragraph */}
          <p
            ref={measureRef}
            aria-hidden
            className="invisible absolute inset-x-3 top-0 text-[15px] leading-snug font-medium"
          />
          {pages.length > 1 && (
            <span className="font-pixel absolute bottom-1 left-2 text-[8px] opacity-50">
              {page + 1}/{pages.length}
            </span>
          )}
          {revealed && (!lastPage || hasNext) && (
            <span
              aria-hidden
              className="absolute right-2 bottom-1 animate-bounce opacity-60"
            >
              <Icon icon={PiCaretDown} size={14} />
            </span>
          )}
          {revealed && lastPage && !hasNext && (
            <span className="font-pixel absolute right-2 bottom-1.5 text-[8px] opacity-60">
              to the plaza
            </span>
          )}
        </div>
      </button>
    </div>
  );
}

/* ---- timeline + transcript ------------------------------------------------- */

function TimelineMarks({
  events,
  t0,
  t1,
}: {
  events: ApiEvent[];
  t0: number;
  t1: number;
}) {
  // Evenly spaced time marks (ends exact, interior ones rounded to a clean
  // half-hour) — event-based marks bunch up when a day clusters in one hour.
  const marks = useMemo(() => {
    if (events.length === 0) return [];
    if (t1 <= t0)
      return [{ key: 0, frac: 0, label: formatClock(events[0].ts) }];
    const HALF_HOUR = 30 * 60 * 1000;
    return [0, 1 / 3, 2 / 3, 1].map((f, k, arr) => {
      const isEnd = k === 0 || k === arr.length - 1;
      const raw = t0 + f * (t1 - t0);
      const ts = isEnd ? raw : Math.round(raw / HALF_HOUR) * HALF_HOUR;
      return {
        key: k,
        frac: (ts - t0) / (t1 - t0),
        label: formatClock(new Date(ts).toISOString(), isEnd),
      };
    });
  }, [events, t0, t1]);

  return (
    <div className="relative mt-0.5 h-5">
      {marks.map((m, k) => (
        <span
          key={m.key}
          className="font-pixel absolute text-[8px] text-white/70"
          style={{
            left: `${m.frac * 100}%`,
            transform:
              k === 0
                ? "none"
                : k === marks.length - 1
                  ? "translateX(-100%)"
                  : "translateX(-50%)",
          }}
        >
          {m.label}
        </span>
      ))}
    </div>
  );
}

function TranscriptPanel({
  events,
  peopleById,
  activeIdx,
  onJump,
  onClose,
}: {
  events: ApiEvent[];
  peopleById: Map<string, ApiPerson>;
  activeIdx: number;
  onJump: (i: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#14121e]">
      <div className="flex flex-none items-center justify-between px-4 py-3">
        <h2 className="font-pixel text-[11px] text-[#eec39a]">Transcript</h2>
        <button
          type="button"
          aria-label="Close transcript"
          className="touch-target flex items-center justify-center text-white/90"
          onClick={onClose}
        >
          <Icon icon={PiX} size={22} />
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {events.map((e, i) => {
          const name = nameFor(e.person_id, peopleById, displayName);
          return (
            <li key={e._id} className="border-b border-white/10">
              <button
                type="button"
                onClick={() => onJump(i)}
                className={`flex w-full gap-3 px-1 py-2.5 text-left ${
                  i === activeIdx ? "bg-white/10" : ""
                }`}
              >
                <span className="font-pixel w-16 flex-none pt-0.5 text-[8px] text-white/50">
                  {formatClock(e.ts)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-xs font-bold text-[#f9f360]">
                    {name}
                  </span>{" "}
                  <span className="text-sm text-white/90">
                    {e.type === "spoke" && e.text ? e.text : "stopped by"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {events.length === 0 && (
          <li className="pt-6 text-center text-sm text-white/60">
            Nothing recorded this day.
          </li>
        )}
      </ul>
    </div>
  );
}
