/**
 * DayScene — cinematic playback of one day's memories (engine v2, two-space).
 *
 * WORLD (drawn under the Camera, world units, origin = stage center):
 *   grass tiles across the ENTIRE viewport (any aspect ratio, no letterbox),
 *   a dirt stage patch with the cabin + lamp as backdrop dressing, and the
 *   people present standing front-facing on the ground line (feet at world
 *   y = 0), spread around the origin. The current speaker is lit + bobbing
 *   while their line types; everyone else is dimmed. The camera frames the
 *   stage so the feet line sits in the stage band between the top chrome and
 *   the dialogue box. A dusk veil over the world gives the evening film mood.
 *
 * UI (drawn after, via the UiContext at guiScale, anchored + auto-laid-out):
 *   letterbox bars top + bottom (film feel; both swallow taps), back button
 *   (top-left), date title (top-center), transcript toggle (top-right), the
 *   Stardew dialogue box (bottom-center panel, typewriter playback of events
 *   in ts order, speaker via displayName), a draggable timeline scrubber in
 *   the bottom bar mapping event timestamps across the day, and a scrollable
 *   raw-transcript overlay.
 *
 * Input routing: own UI rects first (screen px) → `input.onUi` catch-all →
 * the world (tap a cast member → their Person view, real people only).
 *
 * Data: `api.day(date)` / `api.today()`. A 404 renders as a quiet empty day.
 */

import {
  api,
  ApiError,
  displayName,
  spriteUrl,
  type ApiDayView,
  type ApiEvent,
  type ApiPerson,
} from "../lib/api";
import { SHEET } from "../engine/assets";
import type { Camera } from "../engine/camera";
import type { Nav, Scene, SceneInput } from "../engine/scene";
import { drawPersonSprite } from "../engine/sprite";
import { px, type PixelSurface } from "../engine/surface";
import { drawText, measure, wrapText } from "../engine/text";
import { drawWorldGrass, tiledPatch } from "../engine/tilemap";
import {
  button,
  ensure,
  hit,
  panel,
  rect,
  type Rect,
  type UiContext,
  type UiRect,
} from "../engine/ui";

/** Typewriter speed, characters per second. */
const CPS = 28;
/** Seconds a completed line holds before auto-advancing. */
const HOLD_S = 1.8;
/** Stage sprite height in world units (92px tile at a clean 1:2). */
const SPRITE_H = 46;
/** World y of the cast's feet (the stage ground line). */
const FEET_Y = 0;
/** Dialogue text metrics (UI units). */
const TEXT_SIZE = 6;
const LINE_H = 9;
const MAX_LINES = 5;
/** UI units reserved above the dialogue panel for the nameplate overhang. */
const NAME_PAD = 8;
/** Dialogue box size in UI units (width is clamped to the viewport). */
const DIALOG_W = 320;
const DIALOG_H = NAME_PAD + 18 + MAX_LINES * LINE_H;
/** Letterbox bar heights, UI units. */
const TOP_BAR = 24;
const SCRUB_BAR = 30;
const THIN_BAR = 10;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Colors (palette-matched to the sheet art). */
const INK = "#2a2140";
const CREAM = "#f5e5c5";
const GOLD = "#d9a520";
const DIM = "#7a6a8a";
const ACCENT = "#7a4a20";
const BAR = "#0d0a14";
const EDGE = "#3a3244";

/** One prewrapped transcript-overlay line (UI units). */
interface TranscriptLine {
  text: string;
  color: string;
  /** Extra units of space ABOVE this line (gap between events). */
  gap: number;
}

/** One cast member standing on the stage (world units). */
interface StageActor {
  person: ApiPerson;
  x: number;
  speaking: boolean;
}

export function createDayScene(nav: Nav, date: string): Scene {
  return new DayScene(nav, date);
}

class DayScene implements Scene {
  private nav: Nav;
  private date: string;

  // data
  private view: ApiDayView | null = null;
  private error: string | null = null;
  private events: ApiEvent[] = [];
  private eventMs: number[] = [];
  /** Normalized 0..1 timeline position per event. */
  private eventPos: number[] = [];
  private personById = new Map<string, ApiPerson>();
  /** Ids that exist as real Persons (safe to navigate to). */
  private realIds = new Set<string>();

  // playback state
  private idx = 0;
  private chars = 0;
  private holdLeft = HOLD_S;
  private scrubbing = false;

  // transcript overlay
  private transcriptOpen = false;
  private transcriptLines: TranscriptLine[] | null = null;
  private transcriptW = 0;
  /** Scroll offset in UI units. */
  private scrollY = 0;
  private maxScroll = 0;
  private lastDragDy = 0;

  private t = 0;

  // layout cache (SCREEN px, filled by render; update bails until ready)
  private ready = false;
  private s = 1;
  private topHPx = 0;
  /** Screen y where the stage band ends (dialogue top, or the bottom bar). */
  private stageBottomPx = 0;
  private backRect: UiRect | null = null;
  private transcriptBtnRect: UiRect | null = null;
  private transcriptPanelRect: Rect | null = null;
  private dialogueRect: UiRect | null = null;
  private scrubRect: Rect | null = null;
  private trackX = 0;
  private trackW = 0;

  // world layout cache (world units, filled by renderWorld)
  private actors: StageActor[] = [];

  constructor(nav: Nav, date: string) {
    this.nav = nav;
    this.date = date;
  }

  enter(): void {
    const load = this.date === "today" ? api.today() : api.day(this.date);
    void load
      .then((view) => this.applyView(view))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) {
          // Missing day → render as a quiet empty day, not an error.
          this.applyView({ day: null, events: [], people: [], recap: null });
        } else {
          this.error = "The journal is out of reach...";
        }
      });
  }

  private applyView(view: ApiDayView): void {
    this.view = view;
    this.personById = new Map(view.people.map((p) => [p.local_id, p]));
    this.realIds = new Set(view.people.map((p) => p.local_id));
    this.events = [...view.events].sort(
      (a, b) => Date.parse(a.ts) - Date.parse(b.ts),
    );
    this.eventMs = this.events.map((e) => Date.parse(e.ts));
    const n = this.eventMs.length;
    const t0 = this.eventMs[0] ?? 0;
    const t1 = this.eventMs[n - 1] ?? 0;
    const span = t1 - t0;
    this.eventPos = this.eventMs.map((ms, i) => {
      if (span > 0) return (ms - t0) / span;
      return n <= 1 ? 0.5 : i / (n - 1);
    });
    this.idx = 0;
    this.chars = 0;
    this.holdLeft = HOLD_S;
    this.transcriptLines = null;
    // Warm the idle frame of everyone on stage so entrances never pop.
    for (const p of view.people) {
      if (p.sprite) ensure(spriteUrl(p.local_id, p.sprite.static.south));
    }
  }

  /* --------------------------------------------------------------- data -- */

  /** Person for an event id — synthesizes a stable stand-in for unbound ids. */
  private personFor(id: string): ApiPerson {
    let p = this.personById.get(id);
    if (!p) {
      let hash = 0;
      for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
      const shirts = ["blue", "green", "red", "violet", "teal", "gold"];
      p = {
        local_id: id,
        name: null,
        avatar_params: {
          skin_tone: "tan",
          hair_color: "brown",
          hair_style: "short",
          glasses: false,
          hat: null,
          shirt_color: shirts[hash % shirts.length] ?? "blue",
        },
        tags: [],
        favorite: false,
        first_seen: null,
        last_seen: null,
        notes: null,
        bio: null,
        sprite: null,
      };
      this.personById.set(id, p);
    }
    return p;
  }

  private nameFor(id: string): string {
    return displayName(this.personFor(id));
  }

  /** The dialogue line an event plays back as. */
  private lineFor(ev: ApiEvent): string {
    if (ev.type === "seen") return `* ${this.nameFor(ev.person_id)} appeared.`;
    return ev.text ?? "* ...";
  }

  /** Current dialogue: an event, or the recap on an event-less day. */
  private currentLine(): { name: string; text: string; seen: boolean } | null {
    const ev = this.events[this.idx];
    if (ev) {
      return {
        name: this.nameFor(ev.person_id),
        text: this.lineFor(ev),
        seen: ev.type === "seen",
      };
    }
    const recap = this.view?.recap;
    if (recap) return { name: "Journal", text: recap.narrative, seen: false };
    return null;
  }

  /** People who have appeared up to (and including) the current event. */
  private onStage(): { person: ApiPerson; speaking: boolean }[] {
    if (this.events.length === 0) {
      return (this.view?.people ?? []).map((person) => ({
        person,
        speaking: false,
      }));
    }
    const seen: string[] = [];
    for (let i = 0; i <= this.idx && i < this.events.length; i++) {
      const ev = this.events[i];
      if (ev && !seen.includes(ev.person_id)) seen.push(ev.person_id);
    }
    const speakerId = this.events[this.idx]?.person_id;
    return seen.map((id) => ({
      person: this.personFor(id),
      speaking: id === speakerId,
    }));
  }

  /* ------------------------------------------------------------- update -- */

  update(dt: number, input: SceneInput): void {
    this.t += dt;
    if (!this.ready) return; // waiting for the first render's layout

    const tap = input.tap;

    // 1) Own UI rects first, in screen space.
    if (tap && this.backRect && hit(this.backRect, tap)) {
      return this.nav.go({ kind: "back" });
    }
    if (tap && this.transcriptBtnRect && hit(this.transcriptBtnRect, tap)) {
      this.transcriptOpen = !this.transcriptOpen;
      this.lastDragDy = 0;
      return;
    }

    if (this.transcriptOpen) {
      this.updateTranscript(input, tap);
      return;
    }

    const n = this.events.length;

    // Scrubber — pointer-driven so both taps and drags work.
    if (n > 0 && this.scrubRect) {
      const p = input.pointer;
      if (p.down && (this.scrubbing || hit(this.scrubRect, p))) {
        this.scrubbing = true;
        this.setIndexFromX(p.x);
      } else if (!p.down) {
        this.scrubbing = false;
      }
    }

    const line = this.currentLine();
    if (line) {
      const full = line.text.length;

      // Tap the dialogue box: finish the line, else advance to the next event.
      if (tap && this.dialogueRect && hit(this.dialogueRect, tap)) {
        if (this.chars < full) this.chars = full;
        else if (this.idx < n - 1) this.jumpTo(this.idx + 1, true);
        return;
      }

      // Typewriter + auto-advance (paused while scrubbing).
      if (!this.scrubbing) {
        if (this.chars < full) {
          this.chars = Math.min(full, this.chars + dt * CPS);
        } else if (this.idx < n - 1) {
          this.holdLeft -= dt;
          if (this.holdLeft <= 0) this.jumpTo(this.idx + 1, true);
        }
      }
    }

    if (!tap) return;

    // 2) Any other chrome (bars, title, dead space) swallows the tap.
    if (input.onUi(tap)) return;

    // 3) Nothing UI hit → the world: tap a cast member → their Person view.
    const wp = input.tapWorld;
    if (!wp) return;
    for (const a of this.actors) {
      const r = rect(a.x - 13, FEET_Y - SPRITE_H + 4, 26, SPRITE_H - 2);
      if (hit(r, wp) && this.realIds.has(a.person.local_id)) {
        return this.nav.go({ kind: "person", localId: a.person.local_id });
      }
    }
  }

  private jumpTo(idx: number, type: boolean): void {
    this.idx = idx;
    const ev = this.events[idx];
    this.chars = type ? 0 : ev ? this.lineFor(ev).length : 0;
    this.holdLeft = HOLD_S;
  }

  private setIndexFromX(x: number): void {
    if (this.trackW <= 0 || this.eventPos.length === 0) return;
    const frac = Math.min(1, Math.max(0, (x - this.trackX) / this.trackW));
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.eventPos.length; i++) {
      const d = Math.abs((this.eventPos[i] ?? 0) - frac);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best !== this.idx) this.jumpTo(best, false); // instant while scrubbing
  }

  private updateTranscript(
    input: SceneInput,
    tap: { x: number; y: number } | null,
  ): void {
    const drag = input.drag;
    if (drag) {
      const delta = (drag.dy - this.lastDragDy) / this.s; // screen px → units
      this.lastDragDy = drag.dy;
      this.scrollY = Math.min(
        this.maxScroll,
        Math.max(0, this.scrollY - delta),
      );
    } else {
      this.lastDragDy = 0;
    }
    // Tap outside the panel closes the overlay.
    if (tap && this.transcriptPanelRect && !hit(this.transcriptPanelRect, tap)) {
      this.transcriptOpen = false;
    }
  }

  /* -------------------------------------------------------- renderWorld -- */

  renderWorld(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    surface: PixelSurface,
  ): void {
    // Integer zoom from the viewport; frame the stage so the feet line sits
    // ~4/5 down the stage band (between top chrome and the dialogue box).
    cam.zoom = cam.pickZoom();
    const topH = this.topHPx > 0 ? this.topHPx : 0;
    const stageBottom =
      this.stageBottomPx > topH ? this.stageBottomPx : surface.viewH * 0.62;
    const feetSy = topH + (stageBottom - topH) * 0.8;
    cam.centerOn(0, (surface.viewH / 2 - feetSy) / cam.zoom);

    // Grass over the WHOLE viewport (no letterbox at any aspect ratio).
    drawWorldGrass(ctx, cam);

    // Cast layout: spread around the origin, capped to the visible world.
    const cast = this.onStage();
    const n = cast.length;
    const v = cam.visibleWorld();
    const usable = Math.max(40, v.x1 - v.x0 - 70);
    const gap = n > 1 ? Math.min(38, usable / (n - 1)) : 0;
    const x0 = (-gap * (n - 1)) / 2;
    this.actors = cast.map((c, i) => ({ ...c, x: x0 + i * gap }));
    const halfSpan = (gap * (n - 1)) / 2;

    cam.withWorld(ctx, () => {
      this.drawStageSet(ctx, halfSpan);
      this.drawCast(ctx);
    });

    // Dusk veil over the set (UI is drawn after, so chrome stays bright).
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#1c1630";
    ctx.fillRect(0, 0, surface.viewW, surface.viewH);
    ctx.restore();
  }

  /** Dirt stage patch + cabin + lamp backdrop (world units, behind the cast). */
  private drawStageSet(ctx: CanvasRenderingContext2D, halfSpan: number): void {
    const patchHalf = halfSpan + 44;
    const dirt = ensure(`${SHEET}/dirt-patch.png`);
    if (dirt) {
      tiledPatch(ctx, dirt, -patchHalf, FEET_Y - 26, patchHalf * 2, 42, 10);
    }
    const cabin = ensure(`${SHEET}/cabin.png`);
    if (cabin) {
      ctx.drawImage(
        cabin,
        px(-(halfSpan + 64) - cabin.width / 2),
        px(FEET_Y + 2 - cabin.height),
      );
    }
    const lamp = ensure(`${SHEET}/lamp.png`);
    if (lamp) {
      ctx.drawImage(
        lamp,
        px(halfSpan + 34 - lamp.width / 2),
        px(FEET_Y - lamp.height),
      );
    }
  }

  /** The cast on the ground line: speaker lit + bobbing, listeners dimmed. */
  private drawCast(ctx: CanvasRenderingContext2D): void {
    const line = this.currentLine();
    const typing = line !== null && this.chars < line.text.length;
    const solo = this.actors.length === 1;
    for (const a of this.actors) {
      const bob = a.speaking && typing ? Math.floor(this.t * 4) % 2 : 0;
      const y = FEET_Y - bob;
      ctx.save();
      ctx.globalAlpha = a.speaking || solo ? 1 : 0.5;
      this.shadow(ctx, a.x, FEET_Y, 16);
      drawPersonSprite(ctx, a.person, a.x, y, { height: SPRITE_H });
      ctx.restore();
      if (a.speaking) {
        // Tiny speech caret above the speaker's head.
        ctx.fillStyle = CREAM;
        ctx.fillRect(px(a.x - 2), px(y - SPRITE_H - 6), 5, 2);
        ctx.fillRect(px(a.x - 1), px(y - SPRITE_H - 4), 3, 1);
        ctx.fillRect(px(a.x), px(y - SPRITE_H - 3), 1, 1);
      }
    }
  }

  /** Chunky two-step soft shadow at a baseline (PlazaScene pattern). */
  private shadow(
    ctx: CanvasRenderingContext2D,
    cx: number,
    y: number,
    w: number,
  ): void {
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#0a0810";
    ctx.fillRect(px(cx - w / 2), px(y - 2), px(w), 3);
    ctx.fillRect(px(cx - w / 2 + 2), px(y - 3), px(w - 4), 1);
    ctx.restore();
  }

  /* ----------------------------------------------------------- renderUI -- */

  renderUI(ctx: CanvasRenderingContext2D, ui: UiContext): void {
    this.ready = true;
    const s = ui.guiScale;
    this.s = s;
    const W = ui.viewW;
    const H = ui.viewH;
    const hasEvents = this.events.length > 0;
    const line = this.currentLine();

    // Letterbox bars (film feel) — both swallow taps.
    const topH = TOP_BAR * s;
    const botH = (hasEvents ? SCRUB_BAR : THIN_BAR) * s;
    this.topHPx = topH;
    ctx.fillStyle = BAR;
    ctx.fillRect(0, 0, W, topH);
    ctx.fillRect(0, H - botH, W, botH);
    ctx.fillStyle = EDGE;
    ctx.fillRect(0, topH - s, W, s);
    ctx.fillRect(0, H - botH, W, s);
    ui.registerHit(rect(0, 0, W, topH));
    ui.registerHit(rect(0, H - botH, W, botH));

    // Top chrome: back (left), date title (center), transcript (right).
    this.backRect = ui.button(
      ctx,
      ui.place("top-left", 22, 16, { margin: 4 }),
      "<",
      { style: "dark", textSize: 6 },
    );
    ui.text(ctx, this.title(), W / 2, topH / 2 - 4 * s, {
      size: 8,
      color: CREAM,
      align: "center",
      shadow: "#4a2e18",
    });
    this.transcriptBtnRect = ui.place("top-right", 22, 16, { margin: 4 });
    ui.scaled(ctx, this.transcriptBtnRect, (w, h) => {
      button(ctx, rect(0, 0, w, h), "", {
        style: "dark",
        pressed: this.transcriptOpen,
      });
      // Transcript icon: three text lines.
      const off = this.transcriptOpen ? 1 : 0;
      ctx.fillStyle = CREAM;
      ctx.fillRect(6, off + 5, 10, 1);
      ctx.fillRect(6, off + 8, 10, 1);
      ctx.fillRect(6, off + 11, 7, 1);
    });
    ui.registerHit(this.transcriptBtnRect);

    // Dialogue box above the bottom bar (dy lifts the bottom anchor past it).
    if (line) {
      const d = ui.place("bottom-center", DIALOG_W, DIALOG_H, {
        margin: 0,
        dy: -(hasEvents ? SCRUB_BAR : THIN_BAR) - 2,
      });
      this.dialogueRect = d;
      ui.registerHit(d);
      ui.scaled(ctx, d, (w, h) => this.drawDialogue(ctx, w, h, line));
      this.stageBottomPx = d.y;
    } else {
      this.dialogueRect = null;
      this.stageBottomPx = H - botH;
    }

    // Timeline scrubber inside the bottom bar.
    if (hasEvents) this.drawScrubber(ctx, ui, W, H, botH);
    else this.scrubRect = null;

    // Loading / empty notice.
    if (!this.view) {
      this.drawNotice(ctx, ui, this.error ?? "Remembering the day...");
    } else if (!line) {
      this.drawNotice(ctx, ui, "A quiet day - nothing recorded.");
    }

    // Transcript overlay over the stage band.
    if (this.transcriptOpen) {
      const top = topH + 4 * s;
      const bottom = this.stageBottomPx - 4 * s;
      const pr = rect(6 * s, top, W - 12 * s, Math.max(30 * s, bottom - top));
      this.drawTranscript(ctx, ui, pr);
    } else {
      this.transcriptPanelRect = null;
    }
  }

  private title(): string {
    const date = this.view?.day?.date ?? (this.date === "today" ? "" : this.date);
    if (!date) return "Today";
    const parts = date.split("-");
    const mon = MONTHS[Number(parts[1] ?? "1") - 1];
    if (!mon || parts.length < 3) return date;
    return `${mon} ${Number(parts[2])} ${parts[0] ?? ""}`.trim();
  }

  /** Dialogue panel + nameplate + typewriter text, in UI units (w × h). */
  private drawDialogue(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    line: { name: string; text: string; seen: boolean },
  ): void {
    panel(ctx, 0, NAME_PAD, w, h - NAME_PAD);

    // Nameplate riding the panel's top edge.
    const npW = measure(line.name, TEXT_SIZE) + 12;
    button(ctx, rect(5, 1, npW, 13), "", { style: "dark" });
    drawText(ctx, line.name, 5 + npW / 2, 5, {
      size: TEXT_SIZE,
      color: CREAM,
      align: "center",
    });

    // Typewriter-revealed wrapped text, latest MAX_LINES kept in view.
    const lines = wrapText(line.text, TEXT_SIZE, w - 16);
    let remaining = Math.floor(this.chars);
    const typed: string[] = [];
    for (const l of lines) {
      if (remaining <= 0) break;
      typed.push(l.slice(0, remaining));
      remaining -= l.length + 1; // +1 for the eaten separator
    }
    const visible = typed.slice(-MAX_LINES);
    const color = line.seen ? DIM : INK;
    visible.forEach((l, i) => {
      drawText(ctx, l, 8, NAME_PAD + 10 + i * LINE_H, {
        size: TEXT_SIZE,
        color,
      });
    });

    // Blinking continue caret once the line has fully typed.
    if (this.chars >= line.text.length && this.idx < this.events.length - 1) {
      if (Math.floor(this.t * 2) % 2 === 0) {
        ctx.fillStyle = ACCENT;
        ctx.fillRect(w - 12, h - 9, 5, 2);
        ctx.fillRect(w - 11, h - 7, 3, 1);
        ctx.fillRect(w - 10, h - 6, 1, 1);
      }
    }
  }

  /** Track + ticks + handle + times, in the bottom bar (screen px × s). */
  private drawScrubber(
    ctx: CanvasRenderingContext2D,
    ui: UiContext,
    W: number,
    H: number,
    botH: number,
  ): void {
    const s = this.s;
    const y0 = H - botH;
    this.scrubRect = rect(0, y0, W, botH);
    this.trackX = 16 * s;
    this.trackW = W - 32 * s;
    const trackY = y0 + 19 * s;

    // Track.
    ctx.fillStyle = EDGE;
    ctx.fillRect(this.trackX, trackY, this.trackW, 2 * s);

    // Event ticks (spoke bright, seen dim).
    this.eventPos.forEach((pos, i) => {
      const ev = this.events[i];
      ctx.fillStyle = ev?.type === "spoke" ? DIM : "#4a4058";
      ctx.fillRect(
        Math.round(this.trackX + pos * this.trackW),
        trackY - 2 * s,
        s,
        6 * s,
      );
    });

    // Handle at the current event.
    const cur = this.eventPos[this.idx] ?? 0;
    const hx = Math.round(this.trackX + cur * this.trackW);
    ctx.fillStyle = GOLD;
    ctx.fillRect(hx - s, trackY - 4 * s, 3 * s, 10 * s);

    // Start / current / end times.
    const first = this.eventMs[0];
    const last = this.eventMs[this.eventMs.length - 1];
    const curMs = this.eventMs[this.idx];
    const timeY = y0 + 4 * s;
    if (first !== undefined) {
      ui.text(ctx, this.fmtTime(first), this.trackX, timeY, {
        size: 6,
        color: DIM,
      });
    }
    if (last !== undefined && last !== first) {
      ui.text(ctx, this.fmtTime(last), this.trackX + this.trackW, timeY, {
        size: 6,
        color: DIM,
        align: "right",
      });
    }
    if (curMs !== undefined) {
      ui.text(ctx, this.fmtTime(curMs), W / 2, timeY, {
        size: 6,
        color: GOLD,
        align: "center",
      });
    }
  }

  private fmtTime(ms: number): string {
    const d = new Date(ms);
    let hh = d.getHours();
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ap = hh < 12 ? "a" : "p";
    hh = hh % 12 || 12;
    return `${hh}:${mm}${ap}`;
  }

  /** Scrollable raw-event overlay in `pr` (screen px), content in UI units. */
  private drawTranscript(
    ctx: CanvasRenderingContext2D,
    ui: UiContext,
    pr: Rect,
  ): void {
    const s = this.s;
    this.transcriptPanelRect = pr;
    ui.registerHit(pr);

    ctx.save();
    ctx.translate(px(pr.x), px(pr.y));
    ctx.scale(s, s);
    const w = pr.w / s;
    const h = pr.h / s;

    panel(ctx, 0, 0, w, h);
    drawText(ctx, "Transcript", w / 2, 6, {
      size: TEXT_SIZE,
      color: ACCENT,
      align: "center",
    });

    const textW = w - 16;
    if (!this.transcriptLines || this.transcriptW !== textW) {
      this.transcriptLines = this.buildTranscript(textW);
      this.transcriptW = textW;
      this.scrollY = 0;
    }

    const viewY = 16;
    const viewH = h - 22;
    let contentH = 0;
    for (const l of this.transcriptLines) contentH += l.gap + 8;
    this.maxScroll = Math.max(0, contentH - viewH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(px(6), px(viewY), px(textW + 4), px(viewH));
    ctx.clip();
    let y = viewY - this.scrollY;
    for (const l of this.transcriptLines) {
      y += l.gap;
      if (y > viewY - 8 && y < viewY + viewH) {
        drawText(ctx, l.text, 8, y, { size: TEXT_SIZE, color: l.color });
      }
      y += 8;
    }
    ctx.restore();

    if (this.transcriptLines.length === 0) {
      drawText(ctx, "Nothing was said today.", w / 2, viewY + 8, {
        size: TEXT_SIZE,
        color: DIM,
        align: "center",
      });
    }

    // Scroll hint bar.
    if (this.maxScroll > 0) {
      const barH = Math.max(6, (viewH * viewH) / contentH);
      const barY = viewY + (this.scrollY / this.maxScroll) * (viewH - barH);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(px(w - 5), px(barY), 2, px(barH));
    }
    ctx.restore();
  }

  private buildTranscript(textW: number): TranscriptLine[] {
    const out: TranscriptLine[] = [];
    this.events.forEach((ev, i) => {
      const ms = this.eventMs[i];
      const time = ms !== undefined ? this.fmtTime(ms) : "";
      out.push({
        text: `${time} ${this.nameFor(ev.person_id)}`.trim(),
        color: ACCENT,
        gap: i === 0 ? 0 : 4,
      });
      const body = ev.type === "seen" ? "* appeared" : (ev.text ?? "* ...");
      for (const l of wrapText(body, TEXT_SIZE, textW)) {
        out.push({ text: l, color: INK, gap: 0 });
      }
    });
    return out;
  }

  /** Centered parchment notice (loading / error / quiet-day). */
  private drawNotice(
    ctx: CanvasRenderingContext2D,
    ui: UiContext,
    msg: string,
  ): void {
    const r = ui.place("center", 190, 40);
    ui.scaled(ctx, r, (w, h) => {
      panel(ctx, 0, 0, w, h);
      const lines = wrapText(msg, 6, w - 16);
      const startY = Math.max(6, (h - lines.length * 9) / 2 + 1);
      lines.slice(0, 3).forEach((l, i) => {
        drawText(ctx, l, w / 2, startY + i * 9, {
          size: 6,
          color: "#5a4632",
          align: "center",
        });
      });
    });
  }
}
