/**
 * PeopleScene (contacts-style list) + PersonScene (profile) — engine v2.
 *
 * WORLD (renderWorld): camera-tiled grass across the whole viewport (same
 * drawWorldGrass + integer pickZoom as PlazaScene — fills any aspect ratio,
 * no letterbox). These are UI-heavy scenes; the world is just the backdrop.
 *
 * UI (renderUI, via the UiContext at guiScale, anchored + auto-laid-out):
 *   PeopleScene: wooden header (top-center), back button (top-left),
 *   Today/Journal/People nav (bottom, People active), and a parchment
 *   contacts panel filling the band between the chrome — each row = front
 *   sprite + displayName + last-seen, drag-to-scroll with flick inertia,
 *   tap a row → `person` nav intent.
 *
 *   PersonScene (`createPersonScene(nav, localId)` → `api.person(localId)`):
 *   header (person's name), back button, and one drag-scrollable profile
 *   panel — big front sprite + name + bio (italic, leaf-green) + notes +
 *   recent events.
 *
 * Input routing (v2 rule): own UI rects first in SCREEN px (back, nav
 * thirds, list rows), then `input.onUi` swallows any other chrome; these
 * scenes have no world interactions. Scroll state lives in UI units — drag
 * deltas (screen px) are divided by the panel's scale.
 */

import {
  api,
  ApiError,
  displayName,
  spriteUrl,
  type ApiPerson,
  type ApiPersonDetail,
} from "../lib/api";
import type { Camera } from "../engine/camera";
import type { DragState } from "../engine/input";
import type { Nav, Scene, SceneInput } from "../engine/scene";
import { drawPersonSprite } from "../engine/sprite";
import { px, type PixelSurface } from "../engine/surface";
import { drawText, wrapText, type TextOpts } from "../engine/text";
import { drawWorldGrass } from "../engine/tilemap";
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

/* ------------------------------------------------------------ palette ---- */

const INK = "#2a2140";
const CREAM = "#f5e5c5";
const BROWN = "#7a4a20";
const MUTED = "#6b5b45";
const LEAF = "#2f7a3f";

/* ------------------------------------------------------------ helpers ---- */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "Jul 18" from an ISO timestamp; "never" for null; date-part fallback. */
function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${MONTHS[d.getMonth()] ?? ""} ${d.getDate()}`;
}

/** "9:12pm" from an ISO timestamp ("" when unparsable). */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const h12 = d.getHours() % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${h12}:${mm}${d.getHours() >= 12 ? "pm" : "am"}`;
}

/** Hard-cap `str` to `maxChars` glyphs (monospace font → chars == width/size). */
function ellipsize(str: string, maxChars: number): string {
  if (maxChars <= 2 || str.length <= maxChars) return str;
  return `${str.slice(0, maxChars - 2)}..`;
}

/**
 * Faux-italic pixel text for the bio: a slight skew applied at art
 * resolution, so it stays chunky. Draws at (x, y) like drawText.
 */
function drawItalic(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  opts: TextOpts = {},
): void {
  ctx.save();
  ctx.translate(px(x), px(y));
  ctx.transform(1, 0, -0.18, 1, 0, 0);
  drawText(ctx, str, 0, 0, opts);
  ctx.restore();
}

/** Chunky two-step soft shadow at a baseline (same look as PlazaScene). */
function shadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  w: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#1a1410";
  ctx.fillRect(px(cx - w / 2), px(y - 2), px(w), 3);
  ctx.fillRect(px(cx - w / 2 + 2), px(y - 3), px(w - 4), 1);
  ctx.restore();
}

/**
 * Wooden SavePoint-style header (top-center, dark 9-slice, title centered)
 * — same chrome as PlazaScene's header. Registered so it swallows taps.
 */
function drawHeader(
  ctx: CanvasRenderingContext2D,
  ui: UiContext,
  title: string,
  size: 8 | 10,
): UiRect {
  const r = ui.place("top-center", 96, 22, { margin: 5 });
  ui.scaled(ctx, r, (w, h) => {
    button(ctx, rect(0, 0, w, h), "", { style: "dark" });
    drawText(ctx, ellipsize(title, Math.max(3, Math.floor((w - 8) / size))), w / 2, (h - size) / 2 + 1, {
      size,
      color: CREAM,
      align: "center",
      shadow: "#4a2e18",
    });
  });
  ui.registerHit(r);
  return r;
}

/** Loading / error / empty notice panel (center-anchored, like PlazaScene). */
function drawNotice(
  ctx: CanvasRenderingContext2D,
  ui: UiContext,
  msg: string,
): void {
  const r = ui.place("center", 170, 34);
  ui.scaled(ctx, r, (w, h) => {
    panel(ctx, 0, 0, w, h);
    drawText(ctx, msg, w / 2, h / 2 - 3, {
      size: 6,
      color: "#5a4632",
      align: "center",
    });
  });
}

/**
 * Drag-to-scroll state for one vertical list. `y`/`max`/`vel` live in UI
 * units; the drag arrives in SCREEN px and is divided by the panel's scale.
 * Content follows the finger while a drag that STARTED inside `area`
 * (screen px) is live, then coasts with a light exponential-decay inertia.
 * `max` is set by render once content height is known; `y` stays clamped
 * to [0, max].
 */
class Scroll {
  y = 0;
  max = 0;

  private lastDy = 0; // screen px
  private dragging = false;
  private vel = 0; // UI units / s, positive = scrolling down

  update(dt: number, drag: DragState | null, area: Rect, scale: number): void {
    const k = Math.max(1, scale);
    if (drag && (this.dragging || hit(area, { x: drag.startX, y: drag.startY }))) {
      this.dragging = true;
      const delta = (drag.dy - this.lastDy) / k;
      this.lastDy = drag.dy;
      if (delta !== 0) {
        this.y -= delta;
        if (dt > 0) this.vel = -delta / dt;
      }
    } else {
      this.dragging = false;
      this.lastDy = 0;
      if (Math.abs(this.vel) > 2) {
        this.y += this.vel * dt;
        this.vel *= Math.exp(-5 * dt);
      } else {
        this.vel = 0;
      }
    }
    if (this.y < 0) {
      this.y = 0;
      this.vel = 0;
    }
    if (this.y > this.max) {
      this.y = this.max;
      this.vel = 0;
    }
  }
}

/** Thin scroll indicator along the right edge of `inner` (UI units). */
function drawScrollbar(
  ctx: CanvasRenderingContext2D,
  inner: Rect,
  scroll: Scroll,
): void {
  if (scroll.max <= 0) return;
  const trackH = inner.h;
  const barH = Math.max(8, Math.floor((trackH * trackH) / (trackH + scroll.max)));
  const barY = inner.y + ((trackH - barH) * scroll.y) / scroll.max;
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = INK;
  ctx.fillRect(px(inner.x + inner.w - 2), px(barY), 2, px(barH));
  ctx.restore();
}

/* ============================================================ PeopleScene */

const ROW_H = 32;
const ROW_SPRITE_H = 23; // 92px tile at a clean 1:4
/** Inner padding of the contacts/profile panel, UI units. */
const PAD = { x: 4, top: 5, bottom: 5 };

export function createPeopleScene(nav: Nav): Scene {
  return new PeopleScene(nav);
}

class PeopleScene implements Scene {
  private nav: Nav;

  // data
  private people: ApiPerson[] | null = null;
  private error: string | null = null;

  // scroll (UI units)
  private scroll = new Scroll();

  // UI hit rects (SCREEN px, cached from renderUI; update bails until ready)
  private ready = false;
  /** The scale the panel content draws at (screen px per UI unit). */
  private k = 1;
  private backRect: UiRect | null = null;
  /** The scrollable list viewport, screen px. */
  private innerScreen: Rect = rect(0, 0, 0, 0);
  private navRects: { label: string; r: Rect }[] = [];

  constructor(nav: Nav) {
    this.nav = nav;
  }

  enter(): void {
    void api
      .people()
      .then((people) => {
        this.people = [...people].sort((a, b) =>
          displayName(a).localeCompare(displayName(b)),
        );
        // Warm each row's front sprite so the list never pops.
        for (const p of people) {
          if (p.sprite) ensure(spriteUrl(p.local_id, p.sprite.static.south));
        }
      })
      .catch(() => {
        this.error = "The book won't open... backend unreachable.";
      });
  }

  update(dt: number, input: SceneInput): void {
    if (!this.ready) return; // waiting for the first render's layout

    this.scroll.update(dt, input.drag, this.innerScreen, this.k);

    const tap = input.tap;
    if (!tap) return;

    // 1) Own UI rects first, in screen space.
    if (this.backRect && hit(this.backRect, tap)) {
      return this.nav.go({ kind: "back" });
    }
    for (const { label, r } of this.navRects) {
      if (!hit(r, tap)) continue;
      if (label === "Today") return this.nav.go({ kind: "day", date: "today" });
      if (label === "Journal") return this.nav.go({ kind: "garden" });
      return; // People — already here
    }
    if (this.people && hit(this.innerScreen, tap)) {
      const uy = (tap.y - this.innerScreen.y) / this.k + this.scroll.y;
      const p = this.people[Math.floor(uy / ROW_H)];
      if (p) this.nav.go({ kind: "person", localId: p.local_id });
      return;
    }
    // 2) Any other chrome (header, panel border, nav dead space) swallows it.
    if (input.onUi(tap)) return;
    // 3) World: nothing interactive — taps on the grass do nothing.
  }

  renderWorld(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    _surface: PixelSurface,
  ): void {
    cam.zoom = cam.pickZoom();
    cam.centerOn(0, 0);
    drawWorldGrass(ctx, cam);
  }

  renderUI(ctx: CanvasRenderingContext2D, ui: UiContext): void {
    const header = drawHeader(ctx, ui, "People", 10);
    this.backRect = ui.button(
      ctx,
      ui.place("top-left", 20, 20, { margin: 4 }),
      "<",
      { style: "tan", textSize: 8 },
    );

    const bar = this.drawBottomBar(ctx, ui);

    // Contacts panel fills the band between the chrome (screen px, at
    // guiScale) — derived from the ACTUAL placed rects, so it never
    // overlaps them at any window size.
    this.k = ui.guiScale;
    const k = this.k;
    const gap = 4 * k;
    const top = Math.max(header.y + header.h, this.backRect.y + this.backRect.h) + gap;
    const body: UiRect = {
      x: 6 * k,
      y: top,
      w: Math.max(k, ui.viewW - 12 * k),
      h: Math.max(24 * k, bar.y - gap - top),
      scale: k,
    };
    ui.panel(ctx, body);
    ui.registerHit(body); // panel dead space never falls through to world

    const inner = rect(
      PAD.x,
      PAD.top,
      body.w / k - PAD.x * 2,
      body.h / k - PAD.top - PAD.bottom,
    );
    this.innerScreen = rect(
      body.x + inner.x * k,
      body.y + inner.y * k,
      inner.w * k,
      inner.h * k,
    );

    if (this.people && this.people.length > 0) {
      this.scroll.max = Math.max(0, this.people.length * ROW_H - inner.h);
      ui.scaled(ctx, body, () => {
        this.drawRows(ctx, inner);
        drawScrollbar(ctx, inner, this.scroll);
      });
    }

    if (!this.people) drawNotice(ctx, ui, this.error ?? "Opening the book...");
    else if (this.people.length === 0)
      drawNotice(ctx, ui, "Nobody here yet — go meet someone!");

    this.ready = true;
  }

  /** The scrollable contact rows, in the panel's UI-unit space (clipped). */
  private drawRows(ctx: CanvasRenderingContext2D, inner: Rect): void {
    const people = this.people ?? [];
    ctx.save();
    ctx.beginPath();
    ctx.rect(px(inner.x), px(inner.y), px(inner.w), px(inner.h));
    ctx.clip();

    const first = Math.max(0, Math.floor(this.scroll.y / ROW_H));
    const last = Math.min(
      people.length - 1,
      Math.ceil((this.scroll.y + inner.h) / ROW_H),
    );
    const textX = inner.x + 32;
    const maxChars = Math.max(3, Math.floor((inner.w - 32 - 6) / 8));

    for (let i = first; i <= last; i++) {
      const p = people[i];
      if (!p) continue;
      const ry = inner.y + i * ROW_H - this.scroll.y;

      // Row divider along the bottom edge.
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = BROWN;
      ctx.fillRect(px(inner.x + 2), px(ry + ROW_H - 1), px(inner.w - 4), 1);
      ctx.restore();

      // Front sprite (or placeholder), feet on a small shadow.
      const sx = inner.x + 15;
      const sy = ry + ROW_H - 5;
      shadow(ctx, sx, sy, 14);
      drawPersonSprite(ctx, p, sx, sy, { height: ROW_SPRITE_H });

      drawText(ctx, ellipsize(displayName(p), maxChars), textX, ry + 7, {
        size: 8,
        color: INK,
      });
      drawText(ctx, `Last seen ${fmtDate(p.last_seen)}`, textX, ry + 18, {
        size: 6,
        color: MUTED,
      });
    }
    ctx.restore();
  }

  /**
   * Bottom Today/Journal/People bar — full width via the oversize-request
   * clamp, exactly the PlazaScene pattern, with People active. Caches the
   * three tap thirds in screen px.
   */
  private drawBottomBar(ctx: CanvasRenderingContext2D, ui: UiContext): UiRect {
    const bar = ui.place("bottom-center", 4000, 24, { margin: 0 });
    ui.scaled(ctx, bar, (w, h) => {
      // Oversize the 9-slice sideways so only its top border shows.
      button(ctx, rect(-3, 0, w + 6, h + 3), "", { style: "tan" });
      const labels = ["Today", "Journal", "People"] as const;
      labels.forEach((label, i) => {
        const active = label === "People";
        drawText(ctx, label, (w / 3) * i + w / 6, 9, {
          size: 6,
          color: active ? BROWN : INK,
          align: "center",
        });
        if (active) {
          ctx.fillStyle = BROWN;
          ctx.fillRect(px((w / 3) * i + w / 6 - 9), px(h - 7), 18, 2);
        }
      });
    });
    ui.registerHit(bar); // the bar's dead space never falls through
    this.navRects = ["Today", "Journal", "People"].map((label, i) => ({
      label,
      r: rect(bar.x + (bar.w / 3) * i, bar.y, bar.w / 3, bar.h),
    }));
    return bar;
  }
}

/* ============================================================ PersonScene */

export function createPersonScene(nav: Nav, localId: string): Scene {
  return new PersonScene(nav, localId);
}

class PersonScene implements Scene {
  private nav: Nav;
  private localId: string;

  // data
  private detail: ApiPersonDetail | null = null;
  private error: string | null = null;

  // scroll (UI units)
  private scroll = new Scroll();

  // UI hit rects (SCREEN px, cached from renderUI; update bails until ready)
  private ready = false;
  /** The scale the panel content draws at (screen px per UI unit). */
  private k = 1;
  private backRect: UiRect | null = null;
  /** The scrollable profile viewport, screen px. */
  private innerScreen: Rect = rect(0, 0, 0, 0);

  constructor(nav: Nav, localId: string) {
    this.nav = nav;
    this.localId = localId;
  }

  enter(): void {
    void api
      .person(this.localId)
      .then((detail) => {
        this.detail = detail;
        if (detail.sprite)
          ensure(spriteUrl(detail.local_id, detail.sprite.static.south));
      })
      .catch((e: unknown) => {
        this.error =
          e instanceof ApiError && e.status === 404
            ? "This neighbor isn't in the journal yet."
            : "The page won't load... backend unreachable.";
      });
  }

  update(dt: number, input: SceneInput): void {
    if (!this.ready) return; // waiting for the first render's layout

    this.scroll.update(dt, input.drag, this.innerScreen, this.k);

    const tap = input.tap;
    if (!tap) return;
    // 1) Own UI rects first, in screen space.
    if (this.backRect && hit(this.backRect, tap)) {
      return this.nav.go({ kind: "back" });
    }
    // 2) Other chrome swallows the tap; 3) no world interactions here.
    if (input.onUi(tap)) return;
  }

  renderWorld(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    _surface: PixelSurface,
  ): void {
    cam.zoom = cam.pickZoom();
    cam.centerOn(0, 0);
    drawWorldGrass(ctx, cam);
  }

  renderUI(ctx: CanvasRenderingContext2D, ui: UiContext): void {
    const header = drawHeader(
      ctx,
      ui,
      this.detail ? displayName(this.detail) : "...",
      8,
    );
    this.backRect = ui.button(
      ctx,
      ui.place("top-left", 20, 20, { margin: 4 }),
      "<",
      { style: "tan", textSize: 8 },
    );

    // Profile panel fills the rest of the screen (below the placed chrome).
    this.k = ui.guiScale;
    const k = this.k;
    const gap = 4 * k;
    const top = Math.max(header.y + header.h, this.backRect.y + this.backRect.h) + gap;
    const body: UiRect = {
      x: 6 * k,
      y: top,
      w: Math.max(k, ui.viewW - 12 * k),
      h: Math.max(24 * k, ui.viewH - 6 * k - top),
      scale: k,
    };
    ui.panel(ctx, body);
    ui.registerHit(body); // panel dead space never falls through to world

    const inner = rect(
      PAD.x + 1,
      PAD.top,
      body.w / k - (PAD.x + 1) * 2,
      body.h / k - PAD.top - PAD.bottom,
    );
    this.innerScreen = rect(
      body.x + inner.x * k,
      body.y + inner.y * k,
      inner.w * k,
      inner.h * k,
    );

    if (this.detail) {
      ui.scaled(ctx, body, () => {
        this.drawProfile(ctx, inner);
        drawScrollbar(ctx, inner, this.scroll);
      });
    } else {
      drawNotice(ctx, ui, this.error ?? "Turning to their page...");
    }

    this.ready = true;
  }

  /** The scrollable profile column, in the panel's UI-unit space (clipped). */
  private drawProfile(ctx: CanvasRenderingContext2D, inner: Rect): void {
    const d = this.detail;
    if (!d) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(px(inner.x), px(inner.y), px(inner.w), px(inner.h));
    ctx.clip();

    const cx = inner.x + inner.w / 2;
    const yTop = inner.y + inner.h;
    const visible = (y: number, lookback = 14): boolean =>
      y > inner.y - lookback && y < yTop + 4;
    let y = inner.y + 6 - this.scroll.y;

    // Big front sprite — full 92px tile at 1:1 when there's room, else 1:2.
    const spriteH = inner.h >= 190 ? 92 : 46;
    y += spriteH;
    if (visible(y, spriteH + 8)) {
      shadow(ctx, cx, y, Math.floor(spriteH * 0.45));
      drawPersonSprite(ctx, d, cx, y, { height: spriteH });
    }
    y += 8;

    // Name + meta.
    if (visible(y)) {
      drawText(ctx, ellipsize(displayName(d), Math.floor(inner.w / 10)), cx, y, {
        size: 10,
        color: INK,
        align: "center",
      });
    }
    y += 14;
    const meta = `First met ${fmtDate(d.first_seen)} - last seen ${fmtDate(d.last_seen)}`;
    for (const line of wrapText(meta, 6, inner.w - 12)) {
      if (visible(y)) drawText(ctx, line, cx, y, { size: 6, color: MUTED, align: "center" });
      y += 8;
    }
    y += 4;

    // Bio — italic, leaf-green, quoted.
    if (d.bio) {
      for (const line of wrapText(`"${d.bio}"`, 6, inner.w - 20)) {
        if (visible(y)) drawItalic(ctx, line, cx, y, { size: 6, color: LEAF, align: "center" });
        y += 8;
      }
      y += 6;
    }

    // Notes.
    if (d.notes) {
      if (visible(y)) drawText(ctx, "Notes", inner.x + 4, y, { size: 6, color: BROWN });
      y += 9;
      for (const line of wrapText(d.notes, 6, inner.w - 10)) {
        if (visible(y)) drawText(ctx, line, inner.x + 4, y, { size: 6, color: INK });
        y += 8;
      }
      y += 6;
    }

    // Recent events, newest first.
    if (visible(y)) drawText(ctx, "Recent moments", inner.x + 4, y, { size: 6, color: BROWN });
    y += 10;
    const events = [...d.events].sort((a, b) => b.ts.localeCompare(a.ts));
    if (events.length === 0) {
      if (visible(y)) drawText(ctx, "No moments yet.", inner.x + 4, y, { size: 6, color: MUTED });
      y += 8;
    }
    for (const ev of events) {
      const stamp = `${fmtDate(ev.ts)} ${fmtTime(ev.ts)}`.trim();
      if (visible(y)) drawText(ctx, stamp, inner.x + 4, y, { size: 6, color: BROWN });
      y += 8;
      const text = ev.text ?? (ev.type === "seen" ? "Crossed paths." : "...");
      for (const line of wrapText(text, 6, inner.w - 10)) {
        if (visible(y)) drawText(ctx, line, inner.x + 4, y, { size: 6, color: INK });
        y += 8;
      }
      y += 3;
      if (visible(y)) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = BROWN;
        ctx.fillRect(px(inner.x + 2), px(y), px(inner.w - 4), 1);
        ctx.restore();
      }
      y += 5;
    }

    ctx.restore();

    // Content height → scroll clamp (uses this frame's laid-out extent).
    const contentH = y + this.scroll.y - inner.y;
    this.scroll.max = Math.max(0, contentH - inner.h);
  }
}
