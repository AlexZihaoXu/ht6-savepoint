/**
 * Main page — ONE continuous pixel world you swipe between (scroll-snap):
 *   panel 1: the character plaza — everyone from `/people` wandering a plot;
 *   panel 2: the calendar garden — `/days` as a month of growing plants.
 * Matches waterprism's mockup: wooden Savepoint header, whistle + Past
 * floating controls, and the [ Today ][ journal ][ people ] bottom bar.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useReducedMotion } from "framer-motion";
import { GiWhistle } from "react-icons/gi";
import {
  PiCaretDown,
  PiCaretLeft,
  PiCaretRight,
  PiCheck,
  PiPencilSimple,
  PiTrash,
  PiX,
} from "react-icons/pi";
import { Icon } from "@/components/Icon";
import { MicCapture } from "@/components/MicCapture";
import { PixelBottomNav, PixelHeader } from "@/components/PixelChrome";
import { PixelSprite } from "@/lib/pixel-sprite";
import {
  api,
  ApiError,
  displayName,
  renamePerson,
  resetData,
  type ApiDay,
  type ApiMonthSummary,
  type ApiPerson,
} from "@/lib/api";
import { useToast } from "@/lib/toast";
import { addMonth, monthGrid, monthName, todayIso } from "@/lib/calendar";
import {
  FenceRow,
  GroundFlower,
  Lamp,
  Log,
  Pine,
  PlantSprite,
  Rock,
  Tree,
} from "@/lib/scene";
import { rand, relativeSeen, talkingToId } from "@/lib/scene-utils";
import {
  createWanderer,
  gaitOffset,
  stepWanderers,
  TALK_GAP,
  type Rng,
  type Wanderer,
} from "@/lib/wander";

/** How often the plaza re-checks /people for a new Pi camera detection. */
const PEOPLE_POLL_MS = 4000;

export function PlazaPage() {
  const [searchParams] = useSearchParams();
  const scrollerRef = useRef<HTMLDivElement>(null);

  const [people, setPeople] = useState<ApiPerson[] | null>(null);
  const [days, setDays] = useState<ApiDay[] | null>(null);
  // Independent failures: a dead /days must not blank a working plaza.
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [daysError, setDaysError] = useState<string | null>(null);
  const [view, setView] = useState<0 | 1>(
    searchParams.get("view") === "garden" ? 1 : 0,
  );
  const [lined, setLined] = useState(false);
  // "Clean the save" — the confirm-gated wipe of all People + moments.
  const [cleanOpen, setCleanOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    api.days(ac.signal).then(setDays, (e) => {
      if (!ac.signal.aborted) setDaysError(String(e));
    });
    return () => ac.abort();
  }, []);

  // Poll /people so a Pi camera detection appears without a manual reload —
  // the wander sim (below) merges this in without disturbing anyone already
  // on the plot.
  useEffect(() => {
    const ac = new AbortController();
    const fetchPeople = () =>
      api.people(ac.signal).then(setPeople, (e) => {
        if (!ac.signal.aborted) setPeopleError(String(e));
      });
    fetchPeople();
    const id = window.setInterval(fetchPeople, PEOPLE_POLL_MS);
    return () => {
      ac.abort();
      window.clearInterval(id);
    };
  }, []);

  // ?view=garden drives the panel: jump there on mount (deep link), slide
  // there when the query changes while mounted (e.g. the journal button on
  // this very page). User swipes never rewrite the query, so no feedback.
  const firstPlacement = useRef(true);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = searchParams.get("view") === "garden" ? 1 : 0;
    el.scrollTo({
      left: idx * el.clientWidth,
      behavior: firstPlacement.current ? "auto" : "smooth",
    });
    firstPlacement.current = false;
  }, [searchParams]);

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

  // Confirm-gated clean-slate wipe (POST /admin/reset). On success the plaza
  // and garden reflect empty at once, no reload.
  const doClean = async () => {
    setCleaning(true);
    setCleanError(null);
    try {
      await resetData();
      setPeople([]);
      setDays([]);
      setPeopleError(null);
      setDaysError(null);
      setCleanOpen(false);
    } catch (e) {
      setCleanError(String(e));
    } finally {
      setCleaning(false);
    }
  };

  // Reflect an inline rename immediately so the floating name tag + bubble
  // update without waiting for the 4s /people poll (which then confirms it).
  const applyRename = (localId: string, name: string | null) =>
    setPeople((ps) =>
      ps ? ps.map((p) => (p.local_id === localId ? { ...p, name } : p)) : ps,
    );

  return (
    <div className="flex h-[100svh] flex-col overflow-hidden">
      <PixelHeader />

      <div className="relative min-h-0 flex-1">
        {/* the ground lives on the SCROLLER (background-attachment: local via
            .grass-scroll), so plaza + garden share one continuous grass
            surface — the tile pattern never restarts at the swipe seam */}
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className="grass-bg grass-scroll scene-dimmable no-scrollbar flex h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
        >
          <PlazaPanel
            people={people}
            error={peopleError}
            lined={lined}
            active={view === 0}
            onRenamed={applyRename}
          />
          <GardenPanel days={days} error={daysError} active={view === 1} />
        </div>

        {/* floating controls (mic + whistle + clean), per the mockup */}
        <div className="absolute right-3 bottom-9 z-20 flex flex-col items-end gap-2">
          {/* SAV-40 first pass — placement is provisional, team may reposition */}
          <MicCapture />
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
          {/* clean the save — confirm-gated wipe of everyone + every moment */}
          <button
            type="button"
            aria-label="Clean the save — wipe everyone and every moment"
            className="pixel-btn flex h-12 w-14 items-center justify-center"
            onClick={() => {
              setCleanError(null);
              setCleanOpen(true);
            }}
          >
            <Icon icon={PiTrash} size={22} />
          </button>
        </div>

        {/* "Clean the save" confirm dialog — full-screen overlay */}
        {cleanOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6"
            onClick={() => {
              if (!cleaning) {
                setCleanOpen(false);
                setCleanError(null);
              }
            }}
          >
            <div
              role="alertdialog"
              aria-label="Clean the save"
              aria-modal="true"
              className="pixel-bubble w-72 max-w-full p-4 text-left"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="font-pixel text-[12px] leading-relaxed">
                Clean the save?
              </p>
              <p className="mt-2 text-xs leading-snug opacity-80">
                This erases <b>everyone</b> and <b>every moment</b> from the
                database — the plaza and garden start empty. This can’t be
                undone.
              </p>
              {cleanError && (
                <p className="mt-2 text-xs leading-snug text-[#a03c37]">
                  Couldn’t clean — is the backend awake?
                </p>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  className="pixel-btn font-pixel px-3 py-1.5 text-[10px]"
                  disabled={cleaning}
                  onClick={() => {
                    setCleanOpen(false);
                    setCleanError(null);
                  }}
                >
                  cancel
                </button>
                <button
                  type="button"
                  className="pixel-btn font-pixel px-3 py-1.5 text-[10px] text-[#a03c37]"
                  disabled={cleaning}
                  onClick={doClean}
                >
                  {cleaning ? "cleaning…" : "clean"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* swipe affordance — tap-to-move for anyone who doesn't realize the
            world swipes (the arrow points at the neighboring panel; swiping
            is untouched) */}
        {view === 0 ? (
          <button
            type="button"
            aria-label="Go to the garden"
            className="swipe-arrow absolute top-1/2 right-1 z-20 flex h-12 w-9 -translate-y-1/2 cursor-pointer items-center justify-center"
            onClick={() => gotoPanel(1)}
          >
            <span className="swipe-nudge-r flex">
              <Icon icon={PiCaretRight} size={24} />
            </span>
          </button>
        ) : (
          <button
            type="button"
            aria-label="Back to the plaza"
            className="swipe-arrow absolute top-1/2 left-1 z-20 flex h-12 w-9 -translate-y-1/2 cursor-pointer items-center justify-center"
            onClick={() => gotoPanel(0)}
          >
            <span className="swipe-nudge-l flex">
              <Icon icon={PiCaretLeft} size={24} />
            </span>
          </button>
        )}

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

/** Per-character deterministic rng (same id → same wander personality). */
function seededRng(seed: string): Rng {
  let n = 0;
  return () => rand(seed, n++);
}

const ACTOR_TRANSITION =
  "left 0.9s cubic-bezier(0.4, 0, 0.2, 1), top 0.9s cubic-bezier(0.4, 0, 0.2, 1)";

/**
 * The sprite-facing animation inputs the wander sim feeds PixelSprite.
 * Position/gait stay imperative (per-frame style writes); facing, walking
 * and chatting flip rarely, so THOSE go through React state — the
 * walk-frame cycling then lives inside PixelSprite.
 */
interface ActorAnim {
  facing: 1 | -1;
  moving: boolean;
  /** Mid-conversation — side-facing stance + chat bubble over the pair. */
  talking: boolean;
  /** The one talker per pair (its left/right-facing one) owns the bubble. */
  bubble: boolean;
}

/** Below this speed (px/s) a wanderer reads as standing (→ south idle). */
const WALK_EPS = 1;

function PlazaPanel({
  people,
  error,
  lined,
  active,
  onRenamed,
}: {
  people: ApiPerson[] | null;
  error: string | null;
  lined: boolean;
  /** Swiped off-screen panels are inert — no tab stops, no stray taps. */
  active: boolean;
  /** Push an inline rename back up so the panel's people list re-renders. */
  onRenamed: (localId: string, name: string | null) => void;
}) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [selected, setSelected] = useState<{ id: string; xPct: number } | null>(
    null,
  );

  const plotRef = useRef<HTMLDivElement>(null);
  const actorEls = useRef(new Map<string, HTMLDivElement>());
  const spriteEls = useRef(new Map<string, HTMLSpanElement>());
  const simRef = useRef<Wanderer[]>([]);
  // facing/walking per actor — only transitions re-render (see ActorAnim).
  const [anim, setAnim] = useState<Record<string, ActorAnim>>({});
  const animRef = useRef<Record<string, ActorAnim>>({});

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
      return { p, sx, sy, lx, ly };
    });
  }, [people]);

  // Who the Pi camera most recently confirmed present — the plaza's live
  // "who am I facing right now" highlight. Re-derived on every /people poll
  // tick (PlazaPage's PEOPLE_POLL_MS), which is a fine-enough refresh cadence
  // for a signal that isn't itself continuous (see talkingToId's docstring).
  const talkingTo = useMemo(
    () => talkingToId(people ?? [], Date.now()),
    [people],
  );

  // Line-up tidies the plaza — close any open bubble.
  useEffect(() => {
    if (lined) setSelected(null);
  }, [lined]);

  // The wander engine: sim state lives in refs; this effect owns positioning
  // (per-frame styles while wandering, transitioned styles for line-up,
  // static placement under prefers-reduced-motion).
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot || placed.length === 0) return;

    let w = plot.clientWidth || 1;
    let h = plot.clientHeight || 1;

    // Merge the crowd by id (NOT by array position/order): /people is
    // sorted by last_seen desc server-side, so a poll (§ people-fetch above)
    // reorders on ANY sighting, new or repeat. Reusing existing Wanderer
    // objects here means only a genuinely new arrival spawns fresh — everyone
    // already on the plot keeps wandering undisturbed instead of teleporting
    // back to their spawn point every poll.
    const ids = placed.map(({ p }) => p.local_id);
    const sameCrowd =
      simRef.current.length === ids.length &&
      simRef.current.every((s) => ids.includes(s.id));
    if (!sameCrowd) {
      const prevById = new Map(simRef.current.map((s) => [s.id, s]));
      simRef.current = placed.map(({ p, sx, sy }) => {
        const existing = prevById.get(p.local_id);
        if (existing) return existing;
        return createWanderer(
          p.local_id,
          (sx / 100) * w,
          (sy / 100) * h,
          seededRng(p.local_id),
        );
      });
    }
    const sim = simRef.current;
    for (const s of sim) {
      s.frozen = s.id === selected?.id;
      if (s.frozen) s.gaitT = 0; // land before the bubble opens
    }

    const paint = (s: Wanderer, moving: boolean) => {
      const el = actorEls.current.get(s.id);
      if (!el) return;
      el.style.left = `${s.x}px`;
      el.style.top = `${s.y}px`;
      // y-sort for the depth cross-over; the tapped one always on top.
      el.style.zIndex = String(
        s.id === selected?.id ? 10000 : Math.max(1, Math.round(s.y)),
      );
      const sp = spriteEls.current.get(s.id);
      if (sp) {
        if (moving) {
          // Facing-flips live inside PixelSprite (React-driven) — the
          // per-frame write handles only the hop, so they never fight.
          const { dy, tilt } = gaitOffset(s);
          sp.style.transform = `translateY(${dy}px) rotate(${tilt}deg)`;
        } else {
          sp.style.transform = "";
        }
      }
    };

    // Publish facing/walking to React only when someone's state actually
    // flips — PixelSprite swaps south↔walk frames and mirrors from these.
    const syncAnim = (freeRoam: boolean) => {
      const prev = animRef.current;
      let dirty = Object.keys(prev).length !== sim.length;
      const next: Record<string, ActorAnim> = {};
      for (const s of sim) {
        const talking = freeRoam && !s.frozen && s.talkPartner !== null;
        const moving =
          freeRoam &&
          !s.frozen &&
          !talking &&
          s.idleFor <= 0 &&
          s.speed > WALK_EPS;
        // Static layouts (whistle line / reduced-motion) face everyone
        // forward, matching the old un-flipped standing pose.
        const facing = freeRoam ? s.facing : 1;
        // ONE bubble per chatting pair, floated between the two heads —
        // owned by the left (right-facing) talker.
        const bubble = talking && s.facing === 1;
        const cur = prev[s.id];
        if (
          cur &&
          cur.facing === facing &&
          cur.moving === moving &&
          cur.talking === talking &&
          cur.bubble === bubble
        ) {
          next[s.id] = cur;
        } else {
          next[s.id] = { facing, moving, talking, bubble };
          dirty = true;
        }
      }
      if (dirty) {
        animRef.current = next;
        setAnim(next);
      }
    };

    const setTransition = (t: string) => {
      for (const s of sim) {
        const el = actorEls.current.get(s.id);
        if (el) el.style.transition = t;
      }
    };

    const freeRoam = !lined && !reduce;

    // Whistle / reduced-motion snaps everyone to attention — conversations
    // break up (stale stance targets must not survive into the next roam).
    if (!freeRoam) {
      for (const s of sim) {
        s.talkPartner = null;
        s.talkFor = 0;
      }
    }

    // Static layouts (whistle line / reduced-motion) place from the curated
    // percentages, so they can be re-derived at any plot size.
    const placeStatic = () => {
      sim.forEach((s, i) => {
        s.x = ((lined ? placed[i].lx : placed[i].sx) / 100) * w;
        s.y = ((lined ? placed[i].ly : placed[i].sy) / 100) * h;
        s.gaitT = 0;
        paint(s, false);
      });
    };

    let raf = 0;
    if (freeRoam) {
      // Free roam: a lightweight rAF tick over ~8 characters.
      setTransition("none");
      let last = performance.now();
      const tick = (now: number) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        stepWanderers(sim, dt, { w, h });
        for (const s of sim) paint(s, true);
        syncAnim(true);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } else {
      // Whistle line (CSS-transitioned) or reduced-motion scatter (instant).
      setTransition(lined && !reduce ? ACTOR_TRANSITION : "none");
      placeStatic();
      syncAnim(false);
    }

    // Observe in EVERY mode: resize/rotate rescales the sim positions, and
    // static layouts re-derive so they never go stale.
    const ro = new ResizeObserver(() => {
      const nw = plot.clientWidth;
      const nh = plot.clientHeight;
      if (!nw || !nh || (nw === w && nh === h)) return;
      for (const s of sim) {
        s.x *= nw / w;
        s.y *= nh / h;
      }
      w = nw;
      h = nh;
      if (!freeRoam) placeStatic();
    });
    ro.observe(plot);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [placed, lined, reduce, selected]);

  return (
    <section
      aria-label="Plaza — everyone you have met"
      inert={!active}
      className="relative isolate h-full w-full shrink-0 snap-start overflow-hidden"
      onClick={() => setSelected(null)}
    >
      {/* scenery ring around the plot */}
      <FenceRow className="absolute top-2 left-0 w-full" />
      <Tree className="absolute -top-1 left-3 h-24 w-auto" />
      <Tree className="absolute -top-2 right-4 h-24 w-auto" />
      <Pine className="absolute right-[-14px] bottom-[10%] h-24 w-auto" />
      <Tree className="absolute bottom-[2%] left-2 h-20 w-auto" />
      <Rock className="absolute top-[42%] right-2 h-8 w-auto" />
      <Rock small className="absolute right-[30%] bottom-[7%] h-7 w-auto" />
      {/* 8 whole 24px fence tiles + 18px so the run ENDS on a post — a
          percent width cut the last tile mid-rail */}
      <FenceRow className="absolute bottom-[3%] left-0 w-[210px]" />
      <Lamp className="absolute bottom-[2.5%] left-[58%] h-20 w-auto" />
      <Log className="absolute top-[6%] left-[44%] h-[22px] w-auto" />
      <GroundFlower
        kind="daisies"
        className="absolute top-[8.5%] right-[24%] h-[26px] w-auto"
      />
      <GroundFlower
        kind="mushroom"
        className="absolute top-[9.5%] left-[28%] h-4 w-auto"
      />
      <GroundFlower
        kind="buttercups"
        className="absolute top-[40%] left-[1%] h-4 w-auto"
      />

      {/* the plot everyone wanders */}
      <div
        ref={plotRef}
        className="dirt-plot absolute inset-x-[7%] top-[15%] bottom-[21%]"
      >
        {error && (
          <p className="pixel-name font-pixel absolute inset-x-4 top-1/3 text-center text-[10px] leading-5">
            Backend asleep… is the API up?
          </p>
        )}
        {!error && !people && (
          <p className="pixel-name font-pixel absolute inset-x-4 top-1/3 animate-pulse text-center text-[10px] leading-5">
            Loading your world…
          </p>
        )}
        {!error && people && people.length === 0 && (
          <p className="pixel-name font-pixel absolute inset-x-4 top-1/3 text-center text-[10px] leading-5">
            Nobody here yet. Go say hi!
          </p>
        )}

        {placed.map(({ p, sx, sy, lx }) => {
          const isSel = selected?.id === p.local_id;
          return (
            <div
              key={p.local_id}
              ref={(el) => {
                if (el) actorEls.current.set(p.local_id, el);
                else actorEls.current.delete(p.local_id);
              }}
              className="sp-actor-free"
              style={{
                left: `${sx}%`,
                top: `${sy}%`,
                zIndex: Math.max(1, Math.round(sy)),
              }}
            >
              <button
                type="button"
                aria-label={displayName(p)}
                className="block -translate-x-1/2 -translate-y-full cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isSel) {
                    setSelected(null);
                    return;
                  }
                  const plotW = plotRef.current?.clientWidth || 1;
                  const s = simRef.current.find((s) => s.id === p.local_id);
                  const xPct = lined
                    ? lx
                    : s && !reduce
                      ? (s.x / plotW) * 100
                      : sx;
                  setSelected({ id: p.local_id, xPct });
                }}
              >
                <span
                  ref={(el) => {
                    if (el) spriteEls.current.set(p.local_id, el);
                    else spriteEls.current.delete(p.local_id);
                  }}
                  className={`sp-flip block ${
                    p.local_id === talkingTo ? "sp-live-talking" : ""
                  }`}
                >
                  <PixelSprite
                    localId={p.local_id}
                    sprite={p.sprite}
                    params={p.avatar_params}
                    size={60}
                    facing={anim[p.local_id]?.facing ?? 1}
                    moving={anim[p.local_id]?.moving ?? false}
                    talking={anim[p.local_id]?.talking ?? false}
                  />
                </span>
              </button>
              {/* floating name tag over the head — only for people with a real
                  name (raw p.name; unnamed faces / Speaker N get no label).
                  Sibling of the sprite so paint() carries it along each frame;
                  z-30 to paint over the upward-overflowing sprite; no pointer
                  events so it never steals the select tap. */}
              {p.name && (
                <span
                  aria-hidden
                  className="pixel-name font-pixel pointer-events-none absolute left-0 z-30 -translate-x-1/2 text-[8px] whitespace-nowrap"
                  style={{ top: -88 }}
                >
                  [{p.name}]
                </span>
              )}
              {/* the pair's animated "…" chat bubble, centered between the
                  two heads (this talker faces right; partner stands TALK_GAP
                  to the right) */}
              {anim[p.local_id]?.bubble && (
                <span
                  aria-hidden
                  className="sp-chat-bubble"
                  style={{ left: TALK_GAP / 2, top: -96 }}
                />
              )}
              {isSel && selected && (
                <PersonBubble
                  person={p}
                  x={selected.xPct}
                  onOpen={() => navigate(`/people/${p.local_id}`)}
                  onRenamed={onRenamed}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---- panel 2: calendar garden --------------------------------------------- */

function GardenPanel({
  days,
  error,
  active,
}: {
  days: ApiDay[] | null;
  error: string | null;
  /** Swiped off-screen panels are inert — no tab stops, no stray taps. */
  active: boolean;
}) {
  const navigate = useNavigate();
  const [todayIsoStr] = useState(() => todayIso());
  const [cursor, setCursor] = useState(() => ({
    year: Number(todayIsoStr.slice(0, 4)),
    month: Number(todayIsoStr.slice(5, 7)),
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

  // Month-in-review summary for the always-present strip below the calendar.
  const monthKey = `${cursor.year}-${String(cursor.month).padStart(2, "0")}`;
  const [summary, setSummary] = useState<ApiMonthSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [monthMenuOpen, setMonthMenuOpen] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setSummary(null);
    setSummaryLoading(true);
    api.monthSummary(monthKey, ac.signal).then(
      (s) => {
        setSummary(s);
        setSummaryLoading(false);
      },
      () => {
        if (!ac.signal.aborted) setSummaryLoading(false);
      },
    );
    return () => ac.abort();
  }, [monthKey]);

  // Distinct months that have journaled days (newest first) — the picker list.
  const monthsWithData = useMemo(() => {
    const set = new Set((days ?? []).map((d) => d.date.slice(0, 7)));
    set.add(monthKey); // always offer the current cursor month
    return [...set].sort().reverse();
  }, [days, monthKey]);

  return (
    <section
      aria-label="Garden — your days as plants"
      inert={!active}
      className="relative isolate h-full w-full shrink-0 snap-start overflow-hidden"
      onClick={() => {
        setSelected(null);
        setMonthMenuOpen(false);
      }}
    >
      <FenceRow className="absolute top-2 left-0 w-full" />
      <Tree className="absolute -top-1 left-2 h-20 w-auto" />
      <Tree className="absolute -top-2 right-3 h-24 w-auto" />
      <Rock small className="absolute bottom-[8%] left-[8%] h-7 w-auto" />
      <Pine className="absolute bottom-[2%] left-[-12px] h-20 w-auto" />
      <GroundFlower
        kind="daisies"
        className="absolute right-[10%] bottom-[4%] h-[26px] w-auto"
      />
      <GroundFlower
        kind="mushroom"
        className="absolute bottom-[5%] left-[24%] h-4 w-auto"
      />

      <div className="dirt-plot absolute inset-x-[4%] top-[13%] bottom-[30%] flex flex-col">
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
          <div className="relative">
            <button
              type="button"
              aria-label="Pick a month"
              aria-expanded={monthMenuOpen}
              className="pixel-name font-pixel touch-target flex items-center gap-1 px-2 text-lg"
              onClick={(e) => {
                e.stopPropagation();
                setMonthMenuOpen((v) => !v);
              }}
            >
              {monthName(cursor.month)}
              <Icon icon={PiCaretDown} size={14} />
            </button>
            {monthMenuOpen && (
              <div
                role="menu"
                aria-label="Jump to a month"
                className="pixel-bubble absolute top-full left-1/2 z-30 mt-1 flex max-h-52 w-40 -translate-x-1/2 flex-col overflow-y-auto p-1 text-left"
                onClick={(e) => e.stopPropagation()}
              >
                {monthsWithData.map((m) => {
                  const y = Number(m.slice(0, 4));
                  const mo = Number(m.slice(5, 7));
                  return (
                    <button
                      key={m}
                      type="button"
                      role="menuitem"
                      className="touch-target px-2.5 py-2 text-left text-sm transition-colors hover:bg-black/5"
                      onClick={() => {
                        setSelected(null);
                        setCursor({ year: y, month: mo });
                        setMonthMenuOpen(false);
                      }}
                    >
                      {monthName(mo)} {y}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
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
          {error && (
            <p className="pixel-name font-pixel absolute inset-x-4 top-1/3 z-10 text-center text-[10px] leading-5">
              Backend asleep… is the API up?
            </p>
          )}
          {!error && !days && (
            <p className="pixel-name font-pixel absolute inset-x-4 top-1/3 z-10 animate-pulse text-center text-[10px] leading-5">
              Loading your world…
            </p>
          )}
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
                      cell.iso === todayIsoStr
                        ? "outline-2 outline-offset-[-2px] outline-[#f9f360]"
                        : "",
                    ].join(" ")}
                  >
                    <span className="font-pixel absolute top-0 left-0.5 text-[7px] text-[#f3e2b8] opacity-90">
                      {cell.day}
                    </span>
                    <PlantSprite
                      stage={byIso.get(cell.iso)?.plant_stage ?? 0}
                      size={26}
                      seed={cell.iso}
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

      {/* month-in-review summary — always present below the calendar, scrolls */}
      <div className="dirt-plot absolute inset-x-[4%] top-[72%] bottom-[8%] flex flex-col overflow-hidden p-2.5">
        {summaryLoading && !summary ? (
          <p className="font-pixel text-[9px] text-white/60">Loading month…</p>
        ) : summary && summary.days_journaled > 0 ? (
          <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto text-white/90">
            <p className="font-pixel text-[10px] leading-relaxed">
              {summary.days_journaled}{" "}
              {summary.days_journaled === 1 ? "day" : "days"} ·{" "}
              {summary.total_events} moments · {summary.people_count}{" "}
              {summary.people_count === 1 ? "person" : "people"}
            </p>
            {summary.top_people.length > 0 && (
              <p className="mt-1.5 text-xs leading-snug">
                Saw most:{" "}
                {summary.top_people
                  .slice(0, 3)
                  .map((tp) => displayName(tp.person))
                  .join(", ")}
              </p>
            )}
            {summary.busiest_day && (
              <p className="mt-1 text-[11px] opacity-70">
                Busiest:{" "}
                {new Date(
                  `${summary.busiest_day.date}T00:00:00Z`,
                ).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })}{" "}
                · {summary.busiest_day.events} moments
              </p>
            )}
          </div>
        ) : (
          <p className="font-pixel text-[9px] leading-relaxed text-white/55">
            No moments this month yet — your story fills in as you go.
          </p>
        )}
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
  onRenamed,
}: {
  person: ApiPerson;
  x: number;
  onOpen: () => void;
  onRenamed: (localId: string, name: string | null) => void;
}) {
  const toast = useToast();
  const note = person.notes?.trim();
  // Draft lives apart from `person` so a failed save keeps the last-good name.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(person.name ?? ""); // raw name → unnamed faces start blank
    setEditing(true);
  };

  // An empty result is a valid save — it clears the name back to "Neighbor XXX"
  // (see displayName) and drops the floating tag, not a validation error.
  const save = async () => {
    setSaving(true);
    try {
      const updated = await renamePerson(person.local_id, draft.trim());
      onRenamed(person.local_id, updated.name);
      setEditing(false);
    } catch (e) {
      const why =
        e instanceof ApiError
          ? `the backend said HTTP ${e.status}`
          : "the backend can't be reached";
      toast.show("error", `Couldn't rename — ${why}.`);
      // Stay in edit mode so the draft isn't lost — the user can retry.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="pixel-bubble absolute bottom-full left-1/2 z-30 mb-16 w-48 px-3 py-2.5 text-left"
      style={{ transform: `translateX(${bubbleShift(x)})` }}
      onClick={(e) => e.stopPropagation()}
    >
      {editing ? (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            disabled={saving}
            autoFocus
            aria-label="Name"
            placeholder="Name"
            className="min-w-0 flex-1 border-2 border-[var(--border)] bg-[var(--field-background)] px-1.5 py-1 font-sans text-sm text-[var(--field-foreground)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
          />
          <button
            type="button"
            aria-label="Save name"
            disabled={saving}
            onClick={() => void save()}
            className="pixel-btn flex flex-none items-center justify-center p-1 disabled:opacity-60"
          >
            <Icon icon={PiCheck} size={14} />
          </button>
          <button
            type="button"
            aria-label="Cancel"
            disabled={saving}
            onClick={() => setEditing(false)}
            className="pixel-btn flex flex-none items-center justify-center p-1 disabled:opacity-60"
          >
            <Icon icon={PiX} size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-sm leading-tight font-bold">
            {displayName(person)}
          </p>
          <button
            type="button"
            aria-label="Rename"
            onClick={startEdit}
            className="pixel-btn flex flex-none items-center justify-center p-1"
          >
            <Icon icon={PiPencilSimple} size={13} />
          </button>
        </div>
      )}
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
