/**
 * PlazaScene — the engine-v2 REFERENCE scene (CANVAS_ARCH_V2.md).
 *
 * WORLD (drawn under the Camera, world units, origin = plaza center):
 *   grass tiles across the entire viewport (wider windows reveal more world),
 *   a fenced dirt plaza with trees/lamp/log/decor at world positions (trees on
 *   the surrounding grass, fully visible), and everyone from `api.people()`
 *   wandering in world coords (idle → front, moving → walk cycle + flip,
 *   y-sorted). Camera: integer zoom from the viewport, centered on the plaza —
 *   zoomed in on a phone, more grass around it on a wide window; always
 *   filling the screen, crisp, no bars.
 *
 * UI (drawn after, via the UiContext at guiScale, anchored + auto-laid-out):
 *   SavePoint header (top-center), whistle toggle (top-left), Past
 *   (top-right), Today/Journal/People nav (bottom, full width), mic FAB
 *   (bottom-right — the overlap pass floats it above the nav bar), garden
 *   arrows (left/right edges).
 *
 * Input routing: UI rects first (screen px), then `input.onUi` as the
 * catch-all for chrome, and only then the world (tap a walker via
 * `input.tapWorld` → their Person view).
 */

import { api, spriteUrl, type ApiPerson } from "../lib/api";
import { SHEET } from "../engine/assets";
import type { Camera } from "../engine/camera";
import type { Nav, Scene, SceneInput } from "../engine/scene";
import { drawPersonSprite, type Facing } from "../engine/sprite";
import { px, type PixelSurface } from "../engine/surface";
import { drawText } from "../engine/text";
import { drawWorldGrass, fenceBorder, tiledPatch } from "../engine/tilemap";
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

/** One wandering person in the plaza sim (world units). */
interface Walker {
  person: ApiPerson;
  x: number;
  y: number;
  tx: number;
  ty: number;
  speed: number;
  idleLeft: number;
  facing: Facing;
  moving: boolean;
  /** Walk-cycle clock (s) — advanced only while moving. */
  phase: number;
}

/** Sprite height in world units (92px tile at a clean 1:2). */
const SPRITE_H = 46;
/** Horizontal swipe (screen px) that flips to the garden. */
const SWIPE_PX = 60;

/** The plaza rect in world units, centered on the world origin. */
const PLAZA: Rect = { x: -140, y: -95, w: 280, h: 190 };
/** Walkable area inside the fence (world units). */
const BOUNDS = {
  x0: PLAZA.x + 15,
  x1: PLAZA.x + PLAZA.w - 15,
  y0: PLAZA.y + 34,
  y1: PLAZA.y + PLAZA.h - 10,
};

/** Big decor on/around the plaza: sprite, anchor-x, baseline-y (world). */
const DECOR: [string, number, number][] = [
  // Inside the plaza.
  ["lamp", 42, -56],
  ["log", 104, 78],
  ["rock", -116, 52],
  // Trees on the surrounding grass — fully visible, never fence-clipped.
  ["tree-oak", -164, -30],
  ["tree-round", 163, -14],
  ["tree-round", -172, 74],
  ["tree-oak", 178, 96],
  ["tree-round", -70, -128],
  ["tree-oak", 80, -134],
];

/** Small flat dressing (drawn under everything that y-sorts). */
const FLAT_DECOR: [string, number, number][] = [
  // Inside the plaza.
  ["deco-daisies", 96, -40],
  ["deco-buttercups", -104, -14],
  ["pebbles", 30, 62],
  ["deco-mushroom", -112, 88],
  ["deco-daisies", -10, 74],
  // Out on the grass ring wide windows reveal.
  ["deco-daisies", -180, 20],
  ["deco-mushroom", 172, 40],
  ["pebbles", -160, -80],
  ["deco-buttercups", 186, -66],
  ["deco-daisies", 20, -126],
  ["deco-mushroom", -30, 130],
  ["pebbles", 120, 128],
];

export function createPlazaScene(nav: Nav): Scene {
  return new PlazaScene(nav);
}

class PlazaScene implements Scene {
  private nav: Nav;

  // data
  private people: ApiPerson[] | null = null;
  private error: string | null = null;
  private walkers: Walker[] = [];

  // ui state
  private whistle = false;
  private micOn = false;
  private t = 0;

  // UI hit rects (SCREEN px, cached from renderUI; update bails until ready)
  private ready = false;
  private whistleRect: UiRect | null = null;
  private pastRect: UiRect | null = null;
  private micRect: UiRect | null = null;
  private arrowL: UiRect | null = null;
  private arrowR: UiRect | null = null;
  private navRects: { label: string; r: Rect }[] = [];

  constructor(nav: Nav) {
    this.nav = nav;
  }

  enter(): void {
    void api
      .people()
      .then((people) => {
        this.people = people;
        this.preloadSprites(people);
      })
      .catch(() => {
        this.error = "The plaza is quiet... backend unreachable.";
      });
  }

  /** Warm each person's idle frame + walk cycle so wandering never pops. */
  private preloadSprites(people: ApiPerson[]): void {
    for (const p of people) {
      if (!p.sprite) continue;
      ensure(spriteUrl(p.local_id, p.sprite.static.south));
      for (const f of p.sprite.walk.east) ensure(spriteUrl(p.local_id, f));
    }
  }

  /* ------------------------------------------------------------- update -- */

  update(dt: number, input: SceneInput): void {
    this.t += dt;

    this.spawnWalkers();
    for (const wk of this.walkers) this.stepWalker(wk, dt);

    // Swipe left/right → garden (plaza↔garden is one panning world).
    const de = input.dragEnd;
    if (de && Math.abs(de.dx) > SWIPE_PX && Math.abs(de.dx) > Math.abs(de.dy)) {
      this.nav.go({ kind: "garden" });
      return;
    }

    const tap = input.tap;
    if (!tap || !this.ready) return;

    // 1) UI first, in screen space.
    if (this.whistleRect && hit(this.whistleRect, tap)) {
      this.whistle = !this.whistle;
      if (this.whistle) this.assignLineSlots();
      return;
    }
    if (this.pastRect && hit(this.pastRect, tap)) {
      return this.nav.go({ kind: "past" });
    }
    if (this.micRect && hit(this.micRect, tap)) {
      this.micOn = !this.micOn; // visual stub — real capture is app-side
      return;
    }
    if ((this.arrowL && hit(this.arrowL, tap)) || (this.arrowR && hit(this.arrowR, tap))) {
      return this.nav.go({ kind: "garden" });
    }
    for (const { label, r } of this.navRects) {
      if (!hit(r, tap)) continue;
      if (label === "Today") return this.nav.go({ kind: "day", date: "today" });
      if (label === "Journal") return this.nav.go({ kind: "garden" });
      return this.nav.go({ kind: "people" });
    }
    // Any other chrome (header, nav-bar dead space) swallows the tap.
    if (input.onUi(tap)) return;

    // 2) Nothing UI hit → the world: front-most walker under the tap.
    const wp = input.tapWorld;
    if (!wp) return;
    const sorted = [...this.walkers].sort((a, b) => b.y - a.y);
    for (const wk of sorted) {
      const r = rect(wk.x - 13, wk.y - SPRITE_H + 4, 26, SPRITE_H - 2);
      if (hit(r, wp)) {
        return this.nav.go({ kind: "person", localId: wk.person.local_id });
      }
    }
  }

  private spawnWalkers(): void {
    if (this.walkers.length > 0 || !this.people) return;
    const b = BOUNDS;
    this.walkers = this.people.map((person, i) => {
      const x = b.x0 + ((i * 53 + 17) % Math.max(1, b.x1 - b.x0));
      const y = b.y0 + ((i * 37 + 29) % Math.max(1, b.y1 - b.y0));
      return {
        person,
        x,
        y,
        tx: x,
        ty: y,
        speed: 11 + (i % 4) * 2,
        idleLeft: 0.4 + (i % 5) * 0.5,
        facing: (i % 2 === 0 ? "right" : "left") as Facing,
        moving: false,
        phase: 0,
      };
    });
  }

  /** Whistle: everyone lines up along the bottom of the plaza. */
  private assignLineSlots(): void {
    const b = BOUNDS;
    const n = this.walkers.length;
    if (n === 0) return;
    const x0 = b.x0 + 10;
    const span = b.x1 - 10 - x0;
    const gap = Math.min(30, span / Math.max(1, n - 1) || span);
    const width = gap * (n - 1);
    const startX = x0 + (span - width) / 2;
    this.walkers.forEach((wk, i) => {
      wk.tx = startX + i * gap;
      wk.ty = b.y1 - 6;
    });
  }

  private stepWalker(wk: Walker, dt: number): void {
    const b = BOUNDS;
    const dx = wk.tx - wk.x;
    const dy = wk.ty - wk.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 1.5) {
      const sp = this.whistle ? wk.speed + 14 : wk.speed;
      const step = Math.min(dist, sp * dt);
      wk.x += (dx / dist) * step;
      wk.y += (dy / dist) * step;
      if (Math.abs(dx) > 0.5) wk.facing = dx > 0 ? "right" : "left";
      wk.moving = true;
      wk.phase += dt;
      return;
    }

    wk.moving = false;
    wk.phase = 0;
    if (this.whistle) return; // hold the line, facing front
    wk.idleLeft -= dt;
    if (wk.idleLeft <= 0) {
      wk.tx = b.x0 + Math.random() * (b.x1 - b.x0);
      wk.ty = b.y0 + Math.random() * (b.y1 - b.y0);
      wk.idleLeft = 1 + Math.random() * 3.5;
    }
  }

  /* -------------------------------------------------------- renderWorld -- */

  renderWorld(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    _surface: PixelSurface,
  ): void {
    // Integer zoom from the viewport; camera locked on the plaza center.
    cam.zoom = cam.pickZoom();
    cam.centerOn(0, 0);

    // Grass over the WHOLE viewport (no letterbox at any aspect ratio).
    drawWorldGrass(ctx, cam);

    cam.withWorld(ctx, () => {
      this.drawPlazaGround(ctx);
      this.drawFlatDecor(ctx);
      this.drawEntities(ctx);
    });
  }

  /** Dirt plaza + fence (bottom rail y-sorts with the walkers). */
  private drawPlazaGround(ctx: CanvasRenderingContext2D): void {
    const dirt = ensure(`${SHEET}/dirt-patch.png`);
    if (dirt) tiledPatch(ctx, dirt, PLAZA.x, PLAZA.y, PLAZA.w, PLAZA.h, 10);
    else {
      ctx.fillStyle = "#c9a26a";
      ctx.fillRect(px(PLAZA.x), px(PLAZA.y), px(PLAZA.w), px(PLAZA.h));
    }
    const fence = ensure(`${SHEET}/fence.png`);
    if (fence) {
      // Top + sides here; the bottom rail joins the y-sorted entity pass so
      // walkers near the south edge stay behind it.
      fenceBorder(ctx, fence, PLAZA.x + 2, PLAZA.y + 6, PLAZA.w - 4, PLAZA.h - 2, {
        bottom: false,
      });
    }
  }

  /** Small ground-level dressing drawn under everything that y-sorts. */
  private drawFlatDecor(ctx: CanvasRenderingContext2D): void {
    for (const [key, x, baseY] of FLAT_DECOR) {
      const img = ensure(`${SHEET}/${key}.png`);
      if (img) ctx.drawImage(img, px(x - img.width / 2), px(baseY - img.height));
    }
  }

  /** Big decor + bottom fence + walkers, painter-sorted by baseline y. */
  private drawEntities(ctx: CanvasRenderingContext2D): void {
    type Entity = { y: number; draw: () => void };
    const list: Entity[] = [];

    for (const [key, x, baseY] of DECOR) {
      const img = ensure(`${SHEET}/${key}.png`);
      if (!img) continue;
      list.push({
        y: baseY,
        draw: () => {
          this.shadow(ctx, x, baseY, img.width - 6);
          ctx.drawImage(img, px(x - img.width / 2), px(baseY - img.height));
        },
      });
    }

    // South fence rail as an entity at its baseline.
    const fence = ensure(`${SHEET}/fence.png`);
    if (fence) {
      list.push({
        y: PLAZA.y + 6 + PLAZA.h - 2,
        draw: () =>
          fenceBorder(ctx, fence, PLAZA.x + 2, PLAZA.y + 6, PLAZA.w - 4, PLAZA.h - 2, {
            top: false,
            left: false,
            right: false,
          }),
      });
    }

    for (const wk of this.walkers) {
      list.push({
        y: wk.y,
        draw: () => {
          this.shadow(ctx, wk.x, wk.y, 16);
          drawPersonSprite(ctx, wk.person, wk.x, wk.y, {
            moving: wk.moving,
            facing: wk.facing,
            phase: wk.phase,
            height: SPRITE_H,
          });
        },
      });
    }

    list.sort((a, b) => a.y - b.y);
    for (const e of list) e.draw();
  }

  /** Chunky two-step soft shadow at a baseline (world units). */
  private shadow(ctx: CanvasRenderingContext2D, cx: number, y: number, w: number): void {
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "#1a1410";
    ctx.fillRect(px(cx - w / 2), px(y - 2), px(w), 3);
    ctx.fillRect(px(cx - w / 2 + 2), px(y - 3), px(w - 4), 1);
    ctx.restore();
  }

  /* ----------------------------------------------------------- renderUI -- */

  renderUI(ctx: CanvasRenderingContext2D, ui: UiContext): void {
    this.ready = true;

    // SavePoint header, top-center.
    const header = ui.place("top-center", 96, 22, { margin: 5 });
    ui.scaled(ctx, header, (w, h) => {
      button(ctx, rect(0, 0, w, h), "", { style: "dark" });
      drawText(ctx, "SavePoint", w / 2, (h - 10) / 2 + 1, {
        size: 10,
        color: "#f5e5c5",
        align: "center",
        shadow: "#4a2e18",
      });
    });
    ui.registerHit(header); // header swallows taps

    // Whistle toggle, top-left.
    this.whistleRect = ui.place("top-left", 20, 20, { margin: 4 });
    ui.scaled(ctx, this.whistleRect, (w, h) => {
      button(ctx, rect(0, 0, w, h), "", { style: "tan", pressed: this.whistle });
      this.drawWhistleIcon(ctx, this.whistle);
    });
    ui.registerHit(this.whistleRect);

    // Past, top-right.
    this.pastRect = ui.button(ctx, ui.place("top-right", 40, 20, { margin: 4 }), "Past", {
      style: "tan",
    });

    // Bottom nav — full width (place clamps the oversize request).
    const bar = ui.place("bottom-center", 4000, 24, { margin: 0 });
    ui.scaled(ctx, bar, (w, h) => {
      // Oversize the 9-slice sideways so only its top border shows.
      button(ctx, rect(-3, 0, w + 6, h + 3), "", { style: "tan" });
      const labels = ["Today", "Journal", "People"] as const;
      labels.forEach((label, i) => {
        const active = label === "Journal"; // the plaza/garden world
        drawText(ctx, label, (w / 3) * i + w / 6, 9, {
          size: 6,
          color: active ? "#7a4a20" : "#2a2140",
          align: "center",
        });
        if (active) {
          ctx.fillStyle = "#7a4a20";
          ctx.fillRect(px((w / 3) * i + w / 6 - 9), px(h - 7), 18, 2);
        }
      });
    });
    ui.registerHit(bar); // the bar's dead space never falls through to world
    this.navRects = ["Today", "Journal", "People"].map((label, i) => ({
      label,
      r: rect(bar.x + (bar.w / 3) * i, bar.y, bar.w / 3, bar.h),
    }));

    // Mic FAB, bottom-right — the overlap pass floats it above the nav bar.
    this.micRect = ui.place("bottom-right", 24, 24, { margin: 4 });
    ui.scaled(ctx, this.micRect, (w, h) => {
      button(ctx, rect(0, 0, w, h), "", { style: "blue", pressed: this.micOn });
      this.drawMicIcon(ctx, w, this.micOn);
    });
    ui.registerHit(this.micRect);

    // Garden arrows on the side edges (swipe hint), pulsing.
    const pulse = Math.floor(this.t * 2) % 2 === 0 ? 0 : 1;
    this.arrowL = ui.place("left-edge", 12, 26, { margin: 0 });
    this.arrowR = ui.place("right-edge", 12, 26, { margin: 0 });
    const drawArrow = (r: UiRect, ch: "<" | ">", edge: "l" | "r"): void => {
      ui.scaled(ctx, r, (w, h) => {
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = "#2a2140";
        ctx.fillRect(px(edge === "l" ? 0 : 2), px((h - 20) / 2), px(w - 2), 20);
        ctx.restore();
        const nudge = edge === "l" ? -pulse : pulse;
        drawText(ctx, ch, (edge === "l" ? 2 : 4) + nudge, h / 2 - 3, {
          size: 8,
          color: "#f5e5c5",
        });
      });
      ui.registerHit(r);
    };
    drawArrow(this.arrowL, "<", "l");
    drawArrow(this.arrowR, ">", "r");

    // Loading / empty notice.
    if (!this.people) {
      this.drawNotice(ctx, ui, this.error ?? "Loading the plaza...");
    } else if (this.people.length === 0) {
      this.drawNotice(ctx, ui, "Nobody here yet — go meet someone!");
    }
  }

  private drawNotice(ctx: CanvasRenderingContext2D, ui: UiContext, msg: string): void {
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

  /** Whistle icon in UI units at the button's origin. */
  private drawWhistleIcon(ctx: CanvasRenderingContext2D, on: boolean): void {
    const x = 5;
    const y = (on ? 1 : 0) + 8;
    ctx.fillStyle = "#2a2140";
    ctx.fillRect(x, y, 7, 5); // body
    ctx.fillRect(x + 7, y + 1, 3, 2); // mouthpiece
    ctx.fillStyle = "#f5e5c5";
    ctx.fillRect(x + 2, y + 2, 2, 1); // hole
    ctx.fillStyle = "#2a2140";
    ctx.fillRect(x + 2, y - 3, 1, 2); // toot marks
    ctx.fillRect(x + 5, y - 4, 1, 3);
  }

  /** Mic icon in UI units at the button's origin. */
  private drawMicIcon(ctx: CanvasRenderingContext2D, w: number, on: boolean): void {
    const cx = Math.round(w / 2);
    const y = (on ? 1 : 0) + 5;
    ctx.fillStyle = on ? "#c0392b" : "#2a2140";
    ctx.fillRect(cx - 2, y, 5, 8); // capsule
    ctx.fillStyle = "#2a2140";
    ctx.fillRect(cx - 4, y + 6, 1, 4); // cage
    ctx.fillRect(cx + 4, y + 6, 1, 4);
    ctx.fillRect(cx - 4, y + 10, 9, 1);
    ctx.fillRect(cx, y + 11, 1, 3); // stem
    ctx.fillRect(cx - 3, y + 14, 7, 1); // base
  }
}
