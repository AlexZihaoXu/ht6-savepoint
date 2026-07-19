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
import {
  PiCaretDown,
  PiCaretLeft,
  PiFlagPennantFill,
  PiScroll,
  PiUserPlus,
  PiX,
} from "react-icons/pi";
import { Icon } from "@/components/Icon";
import { PixelHeader } from "@/components/PixelChrome";
import { CustomAvatar } from "@/lib/custom-avatar";
import { CANVAS_W, loadAvatar } from "@/lib/customizer";
import { PixelSprite } from "@/lib/pixel-sprite";
import { ParametricSprite } from "@/lib/sprite";
import {
  api,
  assignSpeaker,
  displayName,
  type ApiDayView,
  type ApiEvent,
  type ApiPerson,
} from "@/lib/api";
import { Cabin, FenceRow, Tree } from "@/lib/scene";
import {
  activeEventIndex,
  fallbackAvatar,
  formatClock,
  isUnnamedSpeaker,
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
  // Tap-to-name (SAV-57): the raw "Speaker N" label being assigned, or null
  // when the picker is closed. Captured on tap so scrubbing mid-pick can't
  // silently retarget the assignment.
  const [namingLabel, setNamingLabel] = useState<string | null>(null);
  // The wearer's own customizer-built character (SAV-61), read once per
  // visit — null falls back to the parametric "You" sprite.
  const [customYou] = useState(() => loadAvatar());

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
  const t = scrubT ?? t0;

  // Active line = the last event whose timestamp has passed the scrub time.
  const activeIdx = useMemo(() => activeEventIndex(events, t), [events, t]);

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

  // Tap-to-name: the current line's speaker is still a raw diarizer label
  // with no Person behind it — the nameplate becomes the naming affordance.
  const assignDate = view?.day?.date ?? null;
  const canName =
    !!assignDate &&
    !!active &&
    !youSpeaking &&
    isUnnamedSpeaker(active.person_id, peopleById);

  const jumpTo = (i: number) => {
    const e = events[i];
    if (e) setScrubT(new Date(e.ts).getTime());
  };

  // Back = wherever the user came from (person page, garden…) when there IS
  // in-app history; a cold-opened deep link falls back to the plaza.
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/plaza");
  };

  return (
    <div className="flex h-[100svh] flex-col overflow-hidden bg-black">
      <PixelHeader />

      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* chrome row floating over the top letterbox — back + date on the
            left, transcript toggle on the right (absolute so it doesn't skew
            the centered film frame) */}
        <div className="absolute inset-x-0 top-0 z-20 flex h-12 items-center justify-between gap-2 px-2">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* 44px hit area around a 36px glass square (plaza-arrow scale) */}
            <button
              type="button"
              aria-label="Back"
              className="touch-target flex flex-none cursor-pointer items-center justify-center"
              onClick={goBack}
            >
              <span
                aria-hidden
                className="scene-glass-btn flex h-11 w-11 items-center justify-center"
              >
                <Icon icon={PiCaretLeft} size={24} />
              </span>
            </button>
            <span className="font-pixel truncate text-[9px] text-white/50">
              {isToday
                ? "Today"
                : /^\d{4}-\d{2}-\d{2}$/.test(dateLabel)
                  ? new Date(`${dateLabel}T00:00:00Z`).toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric", timeZone: "UTC" },
                    )
                  : dateLabel}
            </span>
          </div>
          <button
            type="button"
            aria-label="Transcript history"
            aria-expanded={showTranscript}
            className="touch-target flex items-center justify-center text-white/90"
            onClick={() => setShowTranscript((v) => !v)}
          >
            <Icon icon={PiScroll} size={24} />
          </button>
        </div>

        {/* top letterbox bar — pairs with the bottom one so the stage +
            dialogue band sits vertically centered, like a film frame */}
        <div className="min-h-0 flex-1" />

        {/* the scene — a tight cinematic band rather than a tall window */}
        <div className="grass-bg scene-dimmable relative isolate h-[clamp(170px,29svh,250px)] flex-none overflow-hidden">
          <FenceRow className="absolute top-1 left-0 w-full" />
          <Tree className="absolute -top-1 -left-2 h-16 w-auto" />
          <Tree className="absolute -top-2 right-0 h-16 w-auto" />

          <div className="dirt-plot absolute inset-x-[5%] top-[18%] bottom-[8%]">
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

        {/* dialogue box — the two stage characters stand right on top of it,
            [you] LEFT / partner RIGHT, feet tucked behind it */}
        <div className="flex-none px-2 pt-4">
          {active && (
            <div className="relative">
              {/* the talking pair shows their REAL PixelLab sprite, blown up
                  to stage scale (integer pixel scale, so it stays crisp);
                  anyone un-sprited keeps the parametric fallback */}
              <StageActor side="left" name="You" lit={youSpeaking}>
                {customYou ? (
                  // The customizer-built You (SAV-61): feet on the layout
                  // box's bottom edge, centered like the sprite tiles.
                  <span
                    style={{
                      position: "relative",
                      display: "block",
                      width: STAGE_SIZE,
                      height: STAGE_SIZE,
                    }}
                  >
                    <CustomAvatar
                      parts={customYou}
                      scale={YOU_STAGE_SCALE}
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: (STAGE_SIZE - CANVAS_W * YOU_STAGE_SCALE) / 2,
                      }}
                    />
                  </span>
                ) : (
                  <PixelSprite
                    localId="you"
                    sprite={null}
                    params={YOU_AVATAR}
                    size={STAGE_SIZE}
                  />
                )}
              </StageActor>
              {partnerId && (
                <StageActor
                  key={partnerId}
                  side="right"
                  name={nameFor(partnerId, peopleById, displayName)}
                  lit={!youSpeaking}
                  enter
                >
                  <PixelSprite
                    localId={partnerId}
                    sprite={peopleById.get(partnerId)?.sprite ?? null}
                    params={
                      peopleById.get(partnerId)?.avatar_params ??
                      fallbackAvatar(partnerId)
                    }
                    size={STAGE_SIZE}
                    pixelScale={STAGE_PIXEL_SCALE}
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
                onNameTap={
                  canName ? () => setNamingLabel(active.person_id) : undefined
                }
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

        {/* bottom letterbox bar */}
        <div className="min-h-0 flex-1" />

        {/* timeline — tap a flag to jump to that moment (no drag scrubber) */}
        <div className="flex-none px-3 pt-1 pb-[max(0.9rem,env(safe-area-inset-bottom))]">
          <TimelineFlags events={events} activeIdx={activeIdx} onPick={jumpTo} />
        </div>

        {/* tap-to-name person picker (SAV-57) */}
        {namingLabel && assignDate && (
          <SpeakerPickerSheet
            label={namingLabel}
            date={assignDate}
            onClose={() => setNamingLabel(null)}
            onAssigned={(day) => {
              // Swap in the refreshed DayView — event timestamps are
              // unchanged, so the scrub position (and active line) hold
              // while the lines re-attribute to the chosen person.
              setView(day);
              setNamingLabel(null);
            }}
          />
        )}

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

/**
 * Visual-novel scale. A PixelLab tile is 92px with the drawn character
 * ~70px of it — at 2× (STAGE_PIXEL_SCALE) the character stands ~140px, so
 * the layout box (which the parametric fallback fills exactly) matches.
 */
const STAGE_SIZE = 140;
/** Crisp integer blow-up of the sprite tile on stage (92 → 184px). */
const STAGE_PIXEL_SCALE = 2;
/**
 * The custom "You" avatar's stage scale: the v2 sheet's 20×52 canvas holds
 * a ~48px character, so 2.5× stands it ~120px tall — matching the ~140px
 * PixelLab partner beside it. Half-integer scale stays device-pixel exact
 * on the ≥2× phone screens this ships on.
 */
const YOU_STAGE_SCALE = 2.5;
/** The characters' feet/shins tuck behind the dialogue box. */
const STAGE_CLIP = 28;

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
          {/* z-10: the blown-up sprite overflows its box upward — the head
              tag must paint over the character, not get buried behind it */}
          <span className="pixel-name font-pixel absolute top-0 left-1/2 z-10 -translate-x-1/2 text-[8px] whitespace-nowrap">
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
  onNameTap,
}: {
  event: ApiEvent;
  name: string;
  /** Which stage side the speaker stands on — anchors the nameplate. */
  side: "left" | "right";
  hasNext: boolean;
  onAdvance: () => void;
  /** Final tap on the day's last line/page — leave the scene. */
  onDone: () => void;
  /** Set only for un-named "Speaker N" lines — makes the nameplate the
      tap-to-name affordance (SAV-57). */
  onNameTap?: () => void;
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
      {/* speaker nameplate riding the box's top edge, on the speaker's side.
          PROVISIONAL (SAV-57): an un-named speaker's plate is a button with a
          "who's this?" hint that opens the person picker — team may restyle. */}
      {onNameTap ? (
        <button
          type="button"
          onClick={onNameTap}
          aria-label={`${name} — tap to say who this is`}
          className={`dlg-nameplate font-pixel absolute -top-4 z-10 flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-[9px] ${
            side === "left" ? "left-2" : "right-2"
          }`}
        >
          <Icon icon={PiUserPlus} size={12} />
          {name}
          <span className="opacity-70">· who's this?</span>
        </button>
      ) : (
        <span
          className={`dlg-nameplate font-pixel absolute -top-4 z-10 px-2.5 py-1.5 text-[9px] ${
            side === "left" ? "left-2" : "right-2"
          }`}
        >
          {name}
        </span>
      )}
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

/* ---- tap-to-name person picker (SAV-57) ------------------------------------ */

/**
 * Bottom-sheet picker for naming a raw "Speaker N": lists everyone from
 * GET /people (named people first); picking one calls
 * POST /day/{date}/assign-speaker and hands the refreshed DayView back up so
 * the scene re-attributes in place — no reload. PROVISIONAL placement +
 * styling (bottom sheet, row layout) — the team may restyle.
 */
function SpeakerPickerSheet({
  label,
  date,
  onClose,
  onAssigned,
}: {
  label: string;
  date: string;
  onClose: () => void;
  onAssigned: (day: ApiDayView) => void;
}) {
  const [people, setPeople] = useState<ApiPerson[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    api.people(ac.signal).then(
      (ps) =>
        setPeople(
          // Named people first (the likely targets), then the "Neighbor"s.
          [...ps].sort(
            (a, b) =>
              Number(!!b.name) - Number(!!a.name) ||
              displayName(a).localeCompare(displayName(b)),
          ),
        ),
      () => {
        if (!ac.signal.aborted) setLoadError(true);
      },
    );
    return () => ac.abort();
  }, []);

  const pick = async (p: ApiPerson) => {
    if (pendingId) return;
    setSaveError(false);
    setPendingId(p.local_id);
    try {
      const res = await assignSpeaker(date, label, p.local_id);
      onAssigned(res.day);
    } catch {
      // Friendly retry state — the sheet stays open, nothing crashes.
      setSaveError(true);
      setPendingId(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Who is ${label}?`}
      className="absolute inset-0 z-50 flex flex-col justify-end bg-black/60"
    >
      {/* tap the dimmed scene above the sheet to dismiss */}
      <button
        type="button"
        aria-label="Close picker"
        className="min-h-0 flex-1 cursor-pointer"
        onClick={onClose}
      />
      <div className="dlg-wood flex max-h-[70%] flex-none flex-col">
        <div className="flex flex-none items-center justify-between gap-2 pb-1">
          <h2 className="font-pixel flex items-center gap-1.5 text-[10px] text-[#663931]">
            <Icon icon={PiUserPlus} size={14} />
            Who is {label}?
          </h2>
          <button
            type="button"
            aria-label="Close picker"
            className="touch-target flex items-center justify-center text-[#663931]"
            onClick={onClose}
          >
            <Icon icon={PiX} size={20} />
          </button>
        </div>
        {saveError && (
          <p className="font-pixel flex-none pb-1.5 text-[8px] text-[#a4453d]">
            Hmm, that didn't save — give it another tap?
          </p>
        )}
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {people?.map((p) => (
            <li
              key={p.local_id}
              className="border-b-2 border-[#d9a066]/40 last:border-0"
            >
              <button
                type="button"
                disabled={pendingId !== null}
                onClick={() => pick(p)}
                className={`flex w-full items-center gap-3 py-1.5 pr-1 text-left text-[#663931] disabled:opacity-60 ${
                  pendingId === p.local_id ? "animate-pulse" : ""
                }`}
              >
                <ParametricSprite params={p.avatar_params} size={40} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                  {displayName(p)}
                </span>
                {pendingId === p.local_id && (
                  <span className="font-pixel flex-none text-[8px] opacity-70">
                    naming…
                  </span>
                )}
              </button>
            </li>
          ))}
          {people && people.length === 0 && (
            <li className="py-4 text-center text-sm text-[#663931]/70">
              No people saved yet — meet someone first!
            </li>
          )}
          {!people && !loadError && (
            <li className="animate-pulse py-4 text-center text-sm text-[#663931]/70">
              Fetching your people…
            </li>
          )}
          {loadError && (
            <li className="py-4 text-center text-sm text-[#a4453d]">
              Couldn't load people — is the backend awake?
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

/* ---- timeline + transcript ------------------------------------------------- */

/**
 * The day's moments as a row of clickable flags (waterprism: "clickable flags,
 * not a direct video timeline"). Each event is a pennant + its clock time;
 * tapping one jumps the scene to that moment. The active moment's flag is
 * enlarged + lit. Overflows to a horizontal scroll on very busy days.
 */
function TimelineFlags({
  events,
  activeIdx,
  onPick,
}: {
  events: ApiEvent[];
  activeIdx: number;
  onPick: (i: number) => void;
}) {
  if (events.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label="Jump to a moment"
      className="no-scrollbar flex items-end gap-1 overflow-x-auto"
    >
      {events.map((e, i) => {
        const isActive = i === activeIdx;
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={`Moment at ${formatClock(e.ts)}`}
            className="flex flex-none flex-col items-center gap-0.5 px-1 pt-0.5 transition-opacity"
            onClick={() => onPick(i)}
          >
            <Icon
              icon={PiFlagPennantFill}
              size={isActive ? 22 : 15}
              className={isActive ? "text-[#f9f360]" : "text-white/50"}
            />
            <span
              className={`font-pixel text-[7px] ${isActive ? "text-white/90" : "text-white/45"}`}
            >
              {formatClock(e.ts)}
            </span>
          </button>
        );
      })}
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
