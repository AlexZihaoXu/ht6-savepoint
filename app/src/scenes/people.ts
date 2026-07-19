/**
 * PeopleScene (contacts-style list) + PersonScene (profile) — Phase 2.
 *
 * PeopleScene: `api.people()` → an A–Z contacts list on a parchment panel;
 * each row = front sprite + displayName + last-seen. Drag to scroll (with a
 * light flick inertia), tap a row → `person` nav intent. Chrome mirrors the
 * PlazaScene reference: wooden header, back button, Today/Journal/People
 * bottom bar (People active).
 *
 * PersonScene: `createPersonScene(nav, localId)` → `api.person(localId)` →
 * big front sprite + name + bio (italic, leaf-green) + notes + recent
 * events, one drag-scrollable column; back button → `back` intent.
 *
 * ENGINE-V2 NOTE: both scenes are only minimally adapted to the two-space
 * model (a later pass refactors them properly). The world pass draws
 * camera-tiled grass; the whole old layout renders in `renderUI` under one
 * ctx.scale(k, k) at guiScale, with input mapped back through `scaleInput`.
 */

import {
  api,
  ApiError,
  displayName,
  spriteUrl,
  type ApiPerson,
  type ApiPersonDetail,
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
} from "../engine/ui";

/* ------------------------------------------------------------ palette ---- */

const INK = "#2a2140";
const CREAM = "#f5e5c5";
const BROWN = "#7a4a20";
const MUTED = "#6b5b45";
const LEAF = "#2f7a3f";

const NAV_H = 24; // bottom bar height (matches PlazaScene)

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

/** Wooden SavePoint-style header bar with a centered title. */
function drawHeader(
  ctx: CanvasRenderingContext2D,
  w: number,
  title: string,
  size: 8 | 10,
): void {
  const hw = Math.min(118, w - 56);
  button(ctx, rect((w - hw) / 2, 5, hw, 22), "", { style: "dark" });
  drawText(ctx, ellipsize(title, Math.floor((hw - 8) / size)), w / 2, 5 + (22 - size) / 2, {
    size,
    color: CREAM,
    align: "center",
    shadow: "#4a2e18",
  });
}

/** Loading / error / empty notice panel (same look as PlazaScene). */
function drawNotice(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  msg: string,
): void {
  const bw = Math.min(170, w - 20);
  const bh = 34;
  const bx = (w - bw) / 2;
  const by = h / 2 - 40;
  panel(ctx, bx, by, bw, bh);
  drawText(ctx, msg, w / 2, by + 14, { size: 6, color: "#5a4632", align: "center" });
}

/**
 * Drag-to-scroll state for one vertical list: content follows the finger
 * while a drag that STARTED inside `area` is live, then coasts with a light
 * exponential-decay inertia. `max` is set by render once content height is
 * known; `y` stays clamped to [0, max].
 */
class Scroll {
  y = 0;
  max = 0;

  private lastDy = 0;
  private dragging = false;
  private vel = 0; // art px / s, positive = scrolling down

  update(dt: number, input: LegacyInput, area: Rect): void {
    const d = input.drag;
    if (d && (this.dragging || hit(area, { x: d.startX, y: d.startY }))) {
      this.dragging = true;
      const delta = d.dy - this.lastDy;
      this.lastDy = d.dy;
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

/** Thin scroll indicator along the right edge of `inner` (only when needed). */
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

export function createPeopleScene(nav: Nav): Scene {
  return new PeopleScene(nav);
}

class PeopleScene implements Scene {
  private nav: Nav;

  // data
  private people: ApiPerson[] | null = null;
  private error: string | null = null;

  // scroll
  private scroll = new Scroll();

  // layout cache (filled by render; update bails until w > 0)
  private w = 0;
  /** guiScale the old art-px layout renders at (screen = art × k). */
  private k = 1;
  private backRect: Rect = rect(0, 0, 0, 0);
  private innerRect: Rect = rect(0, 0, 0, 0);
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

  update(dt: number, rawInput: SceneInput): void {
    if (this.w === 0) return; // waiting for the first render's layout
    const input = scaleInput(rawInput, this.k);

    this.scroll.update(dt, input, this.innerRect);

    const tap = input.tap;
    if (!tap) return;

    if (hit(this.backRect, tap)) return this.nav.go({ kind: "back" });
    for (const { label, r } of this.navRects) {
      if (!hit(r, tap)) continue;
      if (label === "Today") return this.nav.go({ kind: "day", date: "today" });
      if (label === "Journal") return this.nav.go({ kind: "garden" });
      return; // People — already here
    }
    if (this.people && hit(this.innerRect, tap)) {
      const i = Math.floor((tap.y - this.innerRect.y + this.scroll.y) / ROW_H);
      const p = this.people[i];
      if (p) return this.nav.go({ kind: "person", localId: p.local_id });
    }
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
    this.k = ui.guiScale;
    const w = Math.ceil(ui.viewW / this.k);
    const h = Math.ceil(ui.viewH / this.k);
    this.w = w;
    ctx.save();
    ctx.scale(this.k, this.k);

    drawHeader(ctx, w, "People", 10);
    this.backRect = button(ctx, rect(4, 6, 20, 20), "<", {
      style: "tan",
      textSize: 8,
    });

    // Contacts panel fills between header and bottom bar.
    const list = rect(6, 32, w - 12, h - 32 - NAV_H - 4);
    panel(ctx, list.x, list.y, list.w, list.h);
    const inner = rect(list.x + 4, list.y + 5, list.w - 8, list.h - 10);
    this.innerRect = inner;

    if (this.people && this.people.length > 0) {
      this.scroll.max = Math.max(0, this.people.length * ROW_H - inner.h);
      this.drawRows(ctx, inner);
      drawScrollbar(ctx, inner, this.scroll);
    }

    this.drawBottomBar(ctx, w, h);

    if (!this.people) drawNotice(ctx, w, h, this.error ?? "Opening the book...");
    else if (this.people.length === 0)
      drawNotice(ctx, w, h, "Nobody here yet — go meet someone!");
    ctx.restore();
  }

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

  /** Bottom Today/Journal/People bar — same pattern as PlazaScene, People active. */
  private drawBottomBar(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const bar = rect(-3, h - NAV_H, w + 6, NAV_H + 3);
    const panelImg = ensure(`${SHEET}/panel.png`);
    if (panelImg) {
      button(ctx, bar, "", { style: "tan" });
    } else {
      ctx.fillStyle = "#eec39a";
      ctx.fillRect(px(bar.x), px(bar.y), px(bar.w), px(bar.h));
    }
    const labels = ["Today", "Journal", "People"];
    this.navRects = labels.map((label, i) => {
      const r = rect((w / 3) * i, h - NAV_H, w / 3, NAV_H);
      const active = label === "People";
      drawText(ctx, label, r.x + r.w / 2, h - NAV_H + 9, {
        size: 6,
        color: active ? BROWN : INK,
        align: "center",
      });
      if (active) {
        ctx.fillStyle = BROWN;
        ctx.fillRect(px(r.x + r.w / 2 - 9), px(h - 7), 18, 2);
      }
      return { label, r };
    });
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

  // scroll
  private scroll = new Scroll();

  // layout cache (filled by render; update bails until w > 0)
  private w = 0;
  /** guiScale the old art-px layout renders at (screen = art × k). */
  private k = 1;
  private backRect: Rect = rect(0, 0, 0, 0);
  private innerRect: Rect = rect(0, 0, 0, 0);

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

  update(dt: number, rawInput: SceneInput): void {
    if (this.w === 0) return; // waiting for the first render's layout
    const input = scaleInput(rawInput, this.k);

    this.scroll.update(dt, input, this.innerRect);

    const tap = input.tap;
    if (!tap) return;
    if (hit(this.backRect, tap)) return this.nav.go({ kind: "back" });
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
    this.k = ui.guiScale;
    const w = Math.ceil(ui.viewW / this.k);
    const h = Math.ceil(ui.viewH / this.k);
    this.w = w;
    ctx.save();
    ctx.scale(this.k, this.k);

    drawHeader(ctx, w, this.detail ? displayName(this.detail) : "...", 8);
    this.backRect = button(ctx, rect(4, 6, 20, 20), "<", {
      style: "tan",
      textSize: 8,
    });

    // Profile panel fills the rest of the screen.
    const body = rect(6, 32, w - 12, h - 32 - 6);
    panel(ctx, body.x, body.y, body.w, body.h);
    const inner = rect(body.x + 5, body.y + 5, body.w - 10, body.h - 10);
    this.innerRect = inner;

    if (this.detail) {
      this.drawProfile(ctx, inner);
      drawScrollbar(ctx, inner, this.scroll);
    } else {
      drawNotice(ctx, w, h, this.error ?? "Turning to their page...");
    }
    ctx.restore();
  }

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
