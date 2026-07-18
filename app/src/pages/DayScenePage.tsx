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

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
import { FenceRow, Tree } from "@/lib/scene";
import {
  fallbackAvatar,
  formatClock,
  nameFor,
  partnerAt,
  YOU_AVATAR,
} from "@/lib/scene-utils";

export function DayScenePage() {
  const { date } = useParams();
  const isToday = !date || date === "today";

  const [view, setView] = useState<ApiDayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrubT, setScrubT] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    (isToday ? api.today(ac.signal) : api.day(date!, ac.signal)).then(
      (v) => {
        setView(v);
        const first = v.events[0];
        setScrubT(first ? new Date(first.ts).getTime() : null);
      },
      (e) => {
        if (!ac.signal.aborted) setError(String(e));
      },
    );
    return () => ac.abort();
  }, [date, isToday]);

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
        <div className="grass-bg scene-dimmable relative isolate [height:36%] flex-none overflow-hidden">
          <FenceRow className="absolute top-1 left-0 w-full" />
          <Tree className="absolute -top-1 -left-2 h-16 w-auto" />
          <Tree className="absolute -top-2 right-0 h-16 w-auto" />

          <div className="dirt-plot absolute inset-x-[5%] top-[18%] bottom-[6%]">
            {error && (
              <p className="pixel-name font-pixel absolute inset-x-4 top-1/3 text-center text-[10px] leading-5">
                Backend asleep… is the API up?
              </p>
            )}
            {!error && view && events.length === 0 && (
              <p className="pixel-name font-pixel absolute inset-x-4 top-1/4 text-center text-[10px] leading-5">
                Nothing recorded this day.
              </p>
            )}

            {/* only the two of you on the empty garden: [you] LEFT … */}
            {!error && view && events.length > 0 && (
              <SceneActor name="You" x={24} y={82} lit={youSpeaking}>
                <ParametricSprite params={YOU_AVATAR} size={56} />
              </SceneActor>
            )}

            {/* … and the current conversation partner RIGHT (keyed so a
                partner change pops the newcomer in) */}
            {!error && view && events.length > 0 && partnerId && (
              <SceneActor
                key={partnerId}
                name={nameFor(partnerId, peopleById, displayName)}
                x={76}
                y={82}
                lit={!youSpeaking}
                enter
              >
                <ParametricSprite
                  params={
                    peopleById.get(partnerId)?.avatar_params ??
                    fallbackAvatar(partnerId)
                  }
                  size={56}
                />
              </SceneActor>
            )}
          </div>
        </div>

        {/* dialogue box */}
        <div className="flex-none px-2 pt-4">
          {active && (
            <DialogueBox
              event={active}
              name={speakerName}
              side={youSpeaking ? "left" : "right"}
              hasNext={activeIdx < events.length - 1}
              onAdvance={() =>
                jumpTo(Math.min(activeIdx + 1, events.length - 1))
              }
            />
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

/* ---- scene actor ---------------------------------------------------------- */

/**
 * One of the two conversation characters. The speaker (`lit`) stands at full
 * opacity, gently bobbing and slightly raised; the listener waits dimmed,
 * desaturated and set a step back (ref: speaker lit, non-speaker faded).
 */
function SceneActor({
  name,
  x,
  y,
  lit,
  enter,
  children,
}: {
  name: string;
  x: number;
  y: number;
  lit: boolean;
  enter?: boolean;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <div
      className="sp-actor"
      style={{ left: `${x}%`, top: `${y}%`, zIndex: Math.round(y) }}
    >
      <div
        className={`relative -translate-x-1/2 -translate-y-full ${
          enter && !reduce ? "sp-enter" : ""
        }`}
      >
        <div
          className={`transition-[opacity,filter,transform] duration-500 ${
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
                  transform: "translateY(3px) scale(0.94)",
                }
          }
        >
          <span className="pixel-name font-pixel absolute -top-4 left-1/2 -translate-x-1/2 text-[7px] whitespace-nowrap">
            [{name}]
          </span>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ---- dialogue box ---------------------------------------------------------- */

function DialogueBox({
  event,
  name,
  side,
  hasNext,
  onAdvance,
}: {
  event: ApiEvent;
  name: string;
  /** Which stage side the speaker stands on — anchors the nameplate. */
  side: "left" | "right";
  hasNext: boolean;
  onAdvance: () => void;
}) {
  const reduce = useReducedMotion();
  const text =
    event.type === "spoke" && event.text ? event.text : `(${name} stopped by.)`;

  // Typewriter reveal, restarted per line; instant for reduced motion.
  // (No run-once guards: the effect must survive StrictMode's double-invoke,
  // so it is written to be safely restartable — reset, tick, cleanup.)
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (reduce) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const iv = window.setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          window.clearInterval(iv);
          return n;
        }
        return n + 2;
      });
    }, 22);
    return () => window.clearInterval(iv);
  }, [event._id, text.length, reduce]);

  const meta = [event.place, formatClock(event.ts)].filter(Boolean).join(" · ");

  return (
    <div className="relative">
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
        onClick={() =>
          shown < text.length ? setShown(text.length) : hasNext && onAdvance()
        }
        aria-label="Dialogue — tap to continue"
      >
        <div className="dlg-text relative min-h-24 px-3 py-2">
          {meta && <p className="font-pixel text-[8px] opacity-60">{meta}</p>}
          <p className="mt-1.5 text-[15px] leading-snug font-medium">
            {text.slice(0, shown)}
          </p>
          {shown >= text.length && hasNext && (
            <span
              aria-hidden
              className="absolute right-2 bottom-1 animate-bounce opacity-60"
            >
              <Icon icon={PiCaretDown} size={14} />
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
    <div className="absolute inset-0 z-40 flex flex-col bg-[#0d0906]">
      <div className="flex flex-none items-center justify-between px-4 py-3">
        <h2 className="font-pixel text-[11px] text-[#f3e2b8]">Transcript</h2>
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
                  <span className="text-xs font-bold text-[#ffdf8a]">
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
