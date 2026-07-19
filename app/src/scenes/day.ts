/**
 * DayScene — cinematic playback of one day's memories.
 *
 * `api.day(date)` (or `api.today()` for "today") → the people present stand on
 * a dim evening stage; the day's events play back in `ts` order inside a
 * parchment dialogue box with a typewriter effect (spoke → the line, seen → a
 * `* Name appeared.` narration). A timeline scrubber along the bottom maps
 * event timestamps across the day — tap or drag it to jump. Top chrome: back
 * button, date title, transcript toggle (scrollable raw-event overlay).
 * Letterbox bars top + bottom for the film feel.
 *
 * ENGINE-V2 NOTE: this scene is only minimally adapted to the two-space model
 * (a later pass refactors it properly). The world pass fills the letterbox
 * black; the whole old layout renders in `renderUI` under one ctx.scale(k, k)
 * at guiScale, with input mapped back through `scaleInput`.
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
import {
  scaleInput,
  type LegacyInput,
  type Nav,
  type Scene,
  type SceneInput,
} from "../engine/scene";
import { drawPersonSprite } from "../engine/sprite";
import { px, type PixelSurface } from "../engine/surface";
import { drawText, measure, wrapText } from "../engine/text";
import { fillTiles } from "../engine/tilemap";
import {
  button,
  ensure,
  hit,
  panel,
  rect,
  type Rect,
  type UiContext,
} from "../engine/ui";

/** Typewriter speed, characters per second. */
const CPS = 28;
/** Seconds a completed line holds before auto-advancing. */
const HOLD_S = 1.8;
/** Stage sprite height (92px tile at a clean 1:2). */
const SPRITE_H = 46;
/** Dialogue text metrics. */
const TEXT_SIZE = 6;
const LINE_H = 9;
const MAX_LINES = 5;

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

/** One prewrapped transcript-overlay line. */
interface TranscriptLine {
  text: string;
  color: string;
  /** Extra px of space ABOVE this line (gap between events). */
  gap: number;
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

  // playback state
  private idx = 0;
  private chars = 0;
  private holdLeft = HOLD_S;
  private scrubbing = false;

  // transcript overlay
  private transcriptOpen = false;
  private transcriptLines: TranscriptLine[] | null = null;
  private transcriptW = 0;
  private scrollY = 0;
  private maxScroll = 0;
  private lastDragDy = 0;

  private t = 0;

  // layout cache (filled by render; update bails until w > 0)
  private w = 0;
  /** guiScale the old art-px layout renders at (screen = art × k). */
  private k = 1;
  private backRect: Rect = rect(0, 0, 0, 0);
  private transcriptBtnRect: Rect = rect(0, 0, 0, 0);
  private transcriptPanelRect: Rect = rect(0, 0, 0, 0);
  private dialogueRect: Rect = rect(0, 0, 0, 0);
  private scrubRect: Rect = rect(0, 0, 0, 0);
  private trackX = 0;
  private trackW = 0;

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

  update(dt: number, rawInput: SceneInput): void {
    this.t += dt;
    if (this.w === 0) return; // waiting for the first render's layout
    const input = scaleInput(rawInput, this.k);

    const tap = input.tap;

    if (tap && hit(this.backRect, tap)) return this.nav.go({ kind: "back" });
    if (tap && hit(this.transcriptBtnRect, tap)) {
      this.transcriptOpen = !this.transcriptOpen;
      this.lastDragDy = 0;
      return;
    }

    if (this.transcriptOpen) {
      this.updateTranscript(input, tap);
      return;
    }

    const n = this.events.length;
    const line = this.currentLine();
    if (!line) return;

    // Scrubber — pointer-driven so both taps and drags work.
    if (n > 0) {
      const p = input.pointer;
      if (p.down && (this.scrubbing || hit(this.scrubRect, p))) {
        this.scrubbing = true;
        this.setIndexFromX(p.x);
      } else if (!p.down) {
        this.scrubbing = false;
      }
    }

    const full = line.text.length;

    // Tap the dialogue box: finish the line, else advance to the next event.
    if (tap && hit(this.dialogueRect, tap)) {
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
    input: LegacyInput,
    tap: { x: number; y: number } | null,
  ): void {
    const drag = input.drag;
    if (drag) {
      const delta = drag.dy - this.lastDragDy;
      this.lastDragDy = drag.dy;
      this.scrollY = Math.min(
        this.maxScroll,
        Math.max(0, this.scrollY - delta),
      );
    } else {
      this.lastDragDy = 0;
    }
    // Tap outside the panel closes the overlay.
    if (tap && !hit(this.transcriptPanelRect, tap)) this.transcriptOpen = false;
  }

  /* ------------------------------------------------------------- render -- */

  renderWorld(
    ctx: CanvasRenderingContext2D,
    _cam: Camera,
    surface: PixelSurface,
  ): void {
    // Letterbox black under everything (the film-frame backdrop).
    ctx.fillStyle = BAR;
    ctx.fillRect(0, 0, surface.viewW, surface.viewH);
  }

  renderUI(ctx: CanvasRenderingContext2D, ui: UiContext): void {
    this.k = ui.guiScale;
    const w = Math.ceil(ui.viewW / this.k);
    const h = Math.ceil(ui.viewH / this.k);
    this.w = w;
    ctx.save();
    ctx.scale(this.k, this.k);

    const topH = 24;
    const hasEvents = this.events.length > 0;
    const hasDialogue = this.currentLine() !== null;
    const scrubH = hasEvents ? 28 : 10;
    const dh = 18 + MAX_LINES * LINE_H; // panel padding + text block
    const dRect = rect(6, h - scrubH - dh - 4, w - 12, dh);
    this.dialogueRect = dRect;
    const stageTop = topH;
    const stageBottom = hasDialogue ? dRect.y - 4 : h - scrubH - 4;

    // Letterbox bars + backdrop.
    ctx.fillStyle = BAR;
    ctx.fillRect(0, 0, px(w), px(h));

    this.drawStage(ctx, w, stageTop, stageBottom);
    this.drawChrome(ctx, w, topH, stageBottom);

    if (hasDialogue) this.drawDialogue(ctx, dRect);
    if (hasEvents) this.drawScrubber(ctx, w, h);

    if (!this.view) {
      this.drawNotice(ctx, w, h, this.error ?? "Remembering the day...");
    } else if (!hasDialogue) {
      this.drawNotice(ctx, w, h, "A quiet day - nothing recorded.");
    }

    if (this.transcriptOpen) {
      this.drawTranscript(ctx, rect(6, topH + 4, w - 12, stageBottom - topH - 8));
    }
    ctx.restore();
  }

  /** Dim evening stage: indigo sky, grassy floor, cabin + lamp, the cast. */
  private drawStage(
    ctx: CanvasRenderingContext2D,
    w: number,
    top: number,
    bottom: number,
  ): void {
    const stageH = bottom - top;
    if (stageH <= 0) return;

    ctx.fillStyle = "#221b38"; // dusk sky
    ctx.fillRect(0, px(top), px(w), px(stageH));

    const floorH = Math.min(34, Math.max(12, Math.floor(stageH * 0.3)));
    const floorY = bottom - floorH;
    const grass = ensure(`${SHEET}/grass.png`);
    if (grass) fillTiles(ctx, grass, 0, floorY, w, floorH);
    else {
      ctx.fillStyle = "#3f6f33";
      ctx.fillRect(0, px(floorY), px(w), px(floorH));
    }

    const feetY = floorY + Math.min(10, floorH - 2);

    // Backdrop dressing, behind the cast.
    const cabin = ensure(`${SHEET}/cabin.png`);
    if (cabin && stageH > cabin.height * 0.6) {
      ctx.drawImage(cabin, px(8), px(feetY - cabin.height + 4));
    }
    const lamp = ensure(`${SHEET}/lamp.png`);
    if (lamp) ctx.drawImage(lamp, px(w - 20), px(feetY - lamp.height + 2));

    // Evening mood veil over the set (the cast is drawn on top, so they pop).
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#14101e";
    ctx.fillRect(0, px(top), px(w), px(stageH));
    ctx.restore();

    // The cast, spread along the floor line; current speaker lit + bobbing.
    const cast = this.onStage();
    const n = cast.length;
    const margin = 30;
    const span = Math.max(1, w - margin * 2);
    const typing =
      this.chars < (this.currentLine()?.text.length ?? 0) ? 1 : 0;
    cast.forEach(({ person, speaking }, i) => {
      const x = n === 1 ? w / 2 : margin + (span * i) / (n - 1);
      const bob = speaking && typing ? Math.floor(this.t * 4) % 2 : 0;
      const y = feetY - bob;
      ctx.save();
      ctx.globalAlpha = speaking || n === 1 ? 1 : 0.45;
      this.shadow(ctx, x, feetY, 16);
      drawPersonSprite(ctx, person, x, y, { height: SPRITE_H });
      ctx.restore();
      if (speaking) {
        // Tiny speech caret above the speaker's head.
        ctx.fillStyle = CREAM;
        ctx.fillRect(px(x - 2), px(y - SPRITE_H - 6), 5, 2);
        ctx.fillRect(px(x - 1), px(y - SPRITE_H - 4), 3, 1);
        ctx.fillRect(px(x), px(y - SPRITE_H - 3), 1, 1);
      }
    });
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

  private drawChrome(
    ctx: CanvasRenderingContext2D,
    w: number,
    topH: number,
    stageBottom: number,
  ): void {
    // Film-frame edge lines.
    ctx.fillStyle = "#3a3244";
    ctx.fillRect(0, px(topH - 1), px(w), 1);
    ctx.fillRect(0, px(stageBottom + 1), px(w), 1);

    this.backRect = button(ctx, rect(4, 4, 22, 16), "<", {
      style: "dark",
      textSize: 6,
    });

    drawText(ctx, this.title(), w / 2, 8, {
      size: 8,
      color: CREAM,
      align: "center",
      shadow: "#4a2e18",
    });

    this.transcriptBtnRect = button(ctx, rect(w - 26, 4, 22, 16), "", {
      style: "dark",
      pressed: this.transcriptOpen,
    });
    // Transcript icon: three text lines.
    const r = this.transcriptBtnRect;
    const off = this.transcriptOpen ? 1 : 0;
    ctx.fillStyle = CREAM;
    ctx.fillRect(px(r.x + 6), px(r.y + off + 5), 10, 1);
    ctx.fillRect(px(r.x + 6), px(r.y + off + 8), 10, 1);
    ctx.fillRect(px(r.x + 6), px(r.y + off + 11), 7, 1);
  }

  private title(): string {
    const date = this.view?.day?.date ?? (this.date === "today" ? "" : this.date);
    if (!date) return "Today";
    const parts = date.split("-");
    const mon = MONTHS[Number(parts[1] ?? "1") - 1];
    if (!mon || parts.length < 3) return date;
    return `${mon} ${Number(parts[2])} ${parts[0] ?? ""}`.trim();
  }

  private drawDialogue(ctx: CanvasRenderingContext2D, d: Rect): void {
    const line = this.currentLine();
    if (!line) return;

    panel(ctx, d.x, d.y, d.w, d.h);

    // Nameplate riding the panel's top edge.
    const name = line.name;
    const npW = measure(name, TEXT_SIZE) + 12;
    button(ctx, rect(d.x + 5, d.y - 7, npW, 13), "", { style: "dark" });
    drawText(ctx, name, d.x + 5 + npW / 2, d.y - 7 + 4, {
      size: TEXT_SIZE,
      color: CREAM,
      align: "center",
    });

    // Typewriter-revealed wrapped text, latest MAX_LINES kept in view.
    const lines = wrapText(line.text, TEXT_SIZE, d.w - 16);
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
      drawText(ctx, l, d.x + 8, d.y + 10 + i * LINE_H, {
        size: TEXT_SIZE,
        color,
      });
    });

    // Blinking continue caret once the line has fully typed.
    const full = line.text.length;
    if (this.chars >= full && this.idx < this.events.length - 1) {
      if (Math.floor(this.t * 2) % 2 === 0) {
        ctx.fillStyle = ACCENT;
        ctx.fillRect(px(d.x + d.w - 12), px(d.y + d.h - 9), 5, 2);
        ctx.fillRect(px(d.x + d.w - 11), px(d.y + d.h - 7), 3, 1);
        ctx.fillRect(px(d.x + d.w - 10), px(d.y + d.h - 6), 1, 1);
      }
    }
  }

  private drawScrubber(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
  ): void {
    this.scrubRect = rect(6, h - 28, w - 12, 26);
    this.trackX = 16;
    this.trackW = w - 32;
    const trackY = h - 11;

    // Track.
    ctx.fillStyle = "#3a3244";
    ctx.fillRect(px(this.trackX), px(trackY), px(this.trackW), 2);

    // Event ticks (spoke bright, seen dim).
    this.eventPos.forEach((pos, i) => {
      const ev = this.events[i];
      ctx.fillStyle = ev?.type === "spoke" ? DIM : "#4a4058";
      ctx.fillRect(px(this.trackX + pos * this.trackW), px(trackY - 2), 1, 6);
    });

    // Handle at the current event.
    const cur = this.eventPos[this.idx] ?? 0;
    const hx = this.trackX + cur * this.trackW;
    ctx.fillStyle = GOLD;
    ctx.fillRect(px(hx - 1), px(trackY - 4), 3, 10);

    // Start / current / end times.
    const first = this.eventMs[0];
    const last = this.eventMs[this.eventMs.length - 1];
    const curMs = this.eventMs[this.idx];
    if (first !== undefined) {
      drawText(ctx, this.fmtTime(first), this.trackX, h - 24, {
        size: 6,
        color: DIM,
      });
    }
    if (last !== undefined && last !== first) {
      drawText(ctx, this.fmtTime(last), this.trackX + this.trackW, h - 24, {
        size: 6,
        color: DIM,
        align: "right",
      });
    }
    if (curMs !== undefined) {
      drawText(ctx, this.fmtTime(curMs), w / 2, h - 24, {
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

  private drawTranscript(ctx: CanvasRenderingContext2D, pr: Rect): void {
    this.transcriptPanelRect = pr;
    panel(ctx, pr.x, pr.y, pr.w, pr.h);
    drawText(ctx, "Transcript", pr.x + pr.w / 2, pr.y + 6, {
      size: TEXT_SIZE,
      color: ACCENT,
      align: "center",
    });

    const textW = pr.w - 16;
    if (!this.transcriptLines || this.transcriptW !== textW) {
      this.transcriptLines = this.buildTranscript(textW);
      this.transcriptW = textW;
      this.scrollY = 0;
    }

    const viewY = pr.y + 16;
    const viewH = pr.h - 22;
    let contentH = 0;
    for (const l of this.transcriptLines) contentH += l.gap + 8;
    this.maxScroll = Math.max(0, contentH - viewH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(px(pr.x + 6), px(viewY), px(textW + 4), px(viewH));
    ctx.clip();
    let y = viewY - this.scrollY;
    for (const l of this.transcriptLines) {
      y += l.gap;
      if (y > viewY - 8 && y < viewY + viewH) {
        drawText(ctx, l.text, pr.x + 8, y, { size: TEXT_SIZE, color: l.color });
      }
      y += 8;
    }
    ctx.restore();

    if (this.transcriptLines.length === 0) {
      drawText(ctx, "Nothing was said today.", pr.x + pr.w / 2, viewY + 8, {
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
      ctx.fillRect(px(pr.x + pr.w - 5), px(barY), 2, px(barH));
    }
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
      const body =
        ev.type === "seen" ? "* appeared" : (ev.text ?? "* ...");
      for (const l of wrapText(body, TEXT_SIZE, textW)) {
        out.push({ text: l, color: INK, gap: 0 });
      }
    });
    return out;
  }

  private drawNotice(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    msg: string,
  ): void {
    const bw = Math.min(180, w - 20);
    const bh = 34;
    const bx = (w - bw) / 2;
    const by = h / 2 - 60;
    panel(ctx, bx, by, bw, bh);
    const lines = wrapText(msg, 6, bw - 16);
    lines.slice(0, 2).forEach((l, i) => {
      drawText(ctx, l, w / 2, by + (lines.length > 1 ? 10 : 14) + i * 9, {
        size: 6,
        color: "#5a4632",
        align: "center",
      });
    });
  }
}
