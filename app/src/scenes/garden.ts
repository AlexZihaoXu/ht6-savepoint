/**
 * GardenScene — the calendar of days as a cozy garden (engine v2).
 *
 * WORLD (drawn under the Camera): grass tiles across the ENTIRE viewport via
 * `drawWorldGrass` — same camera setup as the plaza, so any aspect ratio is
 * filled edge-to-edge, crisp, no letterbox. The garden's actual content is
 * chrome, so the world stays a calm backdrop.
 *
 * UI (drawn via the UiContext at guiScale, anchored + auto-laid-out):
 *   SavePoint header (top-center), Past (top-right), month bar `‹ Mon YYYY ›`
 *   (top-center — the overlap pass flows it below the header), the bottom nav
 *   (Today/Journal/People, full width), and the plaza arrow (left edge). The
 *   fenced dirt PLOT with the month calendar fills whatever screen space is
 *   left between the placed chrome, drawn in UI units through `ui.scaled`:
 *   one cell per day, a flower per journaled day (`flower-{hue}-{stage}.png`,
 *   stage from `day.plant_stage`, hue bucketed from `day.mood_color`), today
 *   framed, future day-numbers faded.
 *
 * Input routing: own UI rects first (screen px: Past, arrows, month nav, nav
 * bar, then day cells), `input.onUi` as the chrome catch-all, world last
 * (nothing tappable there). Swipe or left-arrow → plaza.
 */

import { api, type ApiDay } from "../lib/api";
import { SHEET } from "../engine/assets";
import type { Camera } from "../engine/camera";
import type { Nav, Scene, SceneInput } from "../engine/scene";
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

/** Horizontal swipe (screen px) that flips back to the plaza. */
const SWIPE_PX = 60;

/** The four flower hue families on the sheet. */
type FlowerHue = "pink" | "gold" | "green" | "blue";

/** Fallback dot colors while a flower PNG is still loading. */
const HUE_COLOR: Record<FlowerHue, string> = {
  pink: "#e07a9a",
  gold: "#d9a527",
  green: "#58a63f",
  blue: "#4a7ac9",
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** One calendar cell for the currently-viewed month. `r` is SCREEN px. */
interface Cell {
  date: string; // YYYY-MM-DD
  dayNum: number;
  r: Rect;
  day: ApiDay | null;
  future: boolean;
}

/** Local YYYY-MM-DD for `d`. */
function isoDate(y: number, m0: number, d: number): string {
  return `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function todayIso(): string {
  const now = new Date();
  return isoDate(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Hue (0..360) of a #rrggbb color, or null for grays / unparseable input. */
function hexHue(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const digits = m?.[1];
  if (!digits) return null;
  const n = parseInt(digits, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.02) return null;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Bucket a day's mood color into a flower hue; deterministic per-date fallback. */
function flowerHue(day: ApiDay): FlowerHue {
  const hue = day.mood_color ? hexHue(day.mood_color) : null;
  if (hue !== null) {
    if (hue < 25 || hue >= 300) return "pink";
    if (hue < 70) return "gold";
    if (hue < 170) return "green";
    return "blue";
  }
  // No/gray mood color — stable pick from the date string.
  let acc = 0;
  for (let i = 0; i < day.date.length; i++) acc = (acc * 31 + day.date.charCodeAt(i)) | 0;
  const hues: FlowerHue[] = ["pink", "gold", "green", "blue"];
  return hues[Math.abs(acc) % 4] ?? "green";
}

/** Clamp plant_stage into the 1..4 growth sprites. */
function flowerStage(day: ApiDay): number {
  return Math.max(1, Math.min(4, Math.round(day.plant_stage) || 1));
}

export function createGardenScene(nav: Nav): Scene {
  return new GardenScene(nav);
}

class GardenScene implements Scene {
  private nav: Nav;

  // data
  private days: Map<string, ApiDay> | null = null;
  private error: string | null = null;

  // view state — month being shown (0-based month index within its year)
  private year: number;
  private month0: number;
  private minMonth: number; // y*12+m0 bounds for browsing
  private maxMonth: number;
  private t = 0;

  // UI hit rects (SCREEN px, cached from renderUI; update bails until ready)
  private ready = false;
  private pastRect: UiRect | null = null;
  private arrowL: UiRect | null = null;
  private prevRect: Rect | null = null;
  private nextRect: Rect | null = null;
  private navRects: { label: string; r: Rect }[] = [];
  private cells: Cell[] = [];

  private readonly today = todayIso();

  constructor(nav: Nav) {
    this.nav = nav;
    const now = new Date();
    this.year = now.getFullYear();
    this.month0 = now.getMonth();
    this.minMonth = this.year * 12 + this.month0;
    this.maxMonth = this.minMonth;
  }

  enter(): void {
    void api
      .days()
      .then((days) => {
        this.days = new Map(days.map((d) => [d.date, d]));
        this.computeMonthBounds(days);
      })
      .catch(() => {
        this.error = "The garden sleeps... backend unreachable.";
      });
  }

  /** Browsable month range: every month with data, plus the current month. */
  private computeMonthBounds(days: ApiDay[]): void {
    const current = new Date();
    let lo = current.getFullYear() * 12 + current.getMonth();
    let hi = lo;
    for (const d of days) {
      const y = Number(d.date.slice(0, 4));
      const m = Number(d.date.slice(5, 7)) - 1;
      if (!Number.isFinite(y) || !Number.isFinite(m)) continue;
      const idx = y * 12 + m;
      lo = Math.min(lo, idx);
      hi = Math.max(hi, idx);
    }
    this.minMonth = lo;
    this.maxMonth = hi;
  }

  private get monthIndex(): number {
    return this.year * 12 + this.month0;
  }

  private shiftMonth(delta: number): void {
    const idx = Math.max(this.minMonth, Math.min(this.maxMonth, this.monthIndex + delta));
    this.year = Math.floor(idx / 12);
    this.month0 = idx % 12;
  }

  /* ------------------------------------------------------------- update -- */

  update(dt: number, input: SceneInput): void {
    this.t += dt;

    // Horizontal swipe → back to the plaza (one continuous panning world).
    const de = input.dragEnd;
    if (de && Math.abs(de.dx) > SWIPE_PX && Math.abs(de.dx) > Math.abs(de.dy)) {
      this.nav.go({ kind: "plaza" });
      return;
    }

    const tap = input.tap;
    if (!tap || !this.ready) return;

    // 1) Own UI rects first, in screen space (chrome above, plot cells last).
    if (this.pastRect && hit(this.pastRect, tap)) {
      return this.nav.go({ kind: "past" });
    }
    if (this.arrowL && hit(this.arrowL, tap)) {
      return this.nav.go({ kind: "plaza" });
    }
    if (this.prevRect && hit(this.prevRect, tap)) return this.shiftMonth(-1);
    if (this.nextRect && hit(this.nextRect, tap)) return this.shiftMonth(1);
    for (const { label, r } of this.navRects) {
      if (!hit(r, tap)) continue;
      if (label === "Today") return this.nav.go({ kind: "day", date: "today" });
      if (label === "Journal") return this.nav.go({ kind: "plaza" }); // flip to the plaza half
      return this.nav.go({ kind: "people" });
    }
    for (const cell of this.cells) {
      if (!hit(cell.r, tap)) continue;
      // Only journaled days (and today, even if empty) open the day view.
      if (cell.day || cell.date === this.today) {
        this.nav.go({ kind: "day", date: cell.date });
      }
      return;
    }
    // Any other chrome (header, month bar, plot soil, nav dead space)
    // swallows the tap. The garden world has nothing tappable below.
    if (input.onUi(tap)) return;
  }

  /* -------------------------------------------------------- renderWorld -- */

  renderWorld(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    _surface: PixelSurface,
  ): void {
    // Same camera discipline as the plaza: integer zoom from the viewport,
    // centered — grass fills the whole viewport at any aspect ratio.
    cam.zoom = cam.pickZoom();
    cam.centerOn(0, 0);
    drawWorldGrass(ctx, cam);
  }

  /* ----------------------------------------------------------- renderUI -- */

  renderUI(ctx: CanvasRenderingContext2D, ui: UiContext): void {
    this.ready = true;

    // SavePoint header, top-center (same as the plaza).
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

    // Past, top-right.
    this.pastRect = ui.button(ctx, ui.place("top-right", 40, 20, { margin: 4 }), "Past", {
      style: "tan",
    });

    // Month bar `‹ Mon YYYY ›`, top-center — the overlap pass flows it down
    // below the header (and clear of Past on narrow windows).
    const monthBar = ui.place("top-center", 124, 18, { margin: 4 });
    const label = `${MONTHS[this.month0] ?? "?"} ${this.year}`;
    ui.scaled(ctx, monthBar, (w, h) => {
      // Center plaque, then the arrow buttons flanking it.
      button(ctx, rect(20, 0, w - 40, h), "", { style: "dark" });
      drawText(ctx, label, w / 2, (h - 8) / 2 + 1, {
        size: 8,
        color: "#f5e5c5",
        align: "center",
        shadow: "#4a2e18",
      });
      button(ctx, rect(0, 0, 18, h), "", { style: "tan" });
      button(ctx, rect(w - 18, 0, 18, h), "", { style: "tan" });
      drawText(ctx, "<", 9, (h - 6) / 2, {
        size: 6,
        color: "#2a2140",
        align: "center",
        alpha: this.monthIndex > this.minMonth ? 1 : 0.3,
      });
      drawText(ctx, ">", w - 9, (h - 6) / 2, {
        size: 6,
        color: "#2a2140",
        align: "center",
        alpha: this.monthIndex < this.maxMonth ? 1 : 0.3,
      });
    });
    ui.registerHit(monthBar);
    const s = monthBar.scale;
    this.prevRect = rect(monthBar.x, monthBar.y, 18 * s, monthBar.h);
    this.nextRect = rect(monthBar.x + monthBar.w - 18 * s, monthBar.y, 18 * s, monthBar.h);

    // Bottom nav — full width (place clamps the oversize request).
    const bar = ui.place("bottom-center", 4000, 24, { margin: 0 });
    ui.scaled(ctx, bar, (w, h) => {
      // Oversize the 9-slice sideways so only its top border shows.
      button(ctx, rect(-3, 0, w + 6, h + 3), "", { style: "tan" });
      const labels = ["Today", "Journal", "People"] as const;
      labels.forEach((navLabel, i) => {
        const active = navLabel === "Journal"; // the plaza/garden world
        drawText(ctx, navLabel, (w / 3) * i + w / 6, 9, {
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
    ui.registerHit(bar); // the bar's dead space never falls through
    this.navRects = ["Today", "Journal", "People"].map((navLabel, i) => ({
      label: navLabel,
      r: rect(bar.x + (bar.w / 3) * i, bar.y, bar.w / 3, bar.h),
    }));

    // Plaza arrow on the left edge (swipe hint), pulsing.
    const pulse = Math.floor(this.t * 2) % 2 === 0 ? 0 : 1;
    this.arrowL = ui.place("left-edge", 12, 26, { margin: 0 });
    ui.scaled(ctx, this.arrowL, (w, h) => {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = "#2a2140";
      ctx.fillRect(px(0), px((h - 20) / 2), px(w - 2), 20);
      ctx.restore();
      drawText(ctx, "<", 2 - pulse, h / 2 - 3, { size: 8, color: "#f5e5c5" });
    });
    ui.registerHit(this.arrowL);

    // The garden plot fills the screen space left between the placed chrome.
    this.renderPlot(ctx, ui, header, monthBar, this.pastRect, bar, this.arrowL);

    // Loading / empty notice.
    if (!this.days) {
      this.drawNotice(ctx, ui, this.error ?? "Watering the garden...");
    } else if (this.days.size === 0) {
      this.drawNotice(ctx, ui, "Nothing planted yet — live a day!");
    }
  }

  /**
   * Fenced dirt plot + month calendar, in the SCREEN rect between the chrome
   * that `place()` laid out (below header/month-bar/Past, above the nav bar,
   * clear of the edge arrow). Drawn in UI units via `ui.scaled`; cells cached
   * in screen px for hit-testing.
   */
  private renderPlot(
    ctx: CanvasRenderingContext2D,
    ui: UiContext,
    header: UiRect,
    monthBar: UiRect,
    past: UiRect,
    navBar: UiRect,
    arrowL: UiRect,
  ): void {
    const s = ui.guiScale;
    const gap = 4 * s;
    // fenceBorder rails are BOTTOM-aligned to the y they're given: the 24-unit
    // fence art drawn at local y=6 pokes 18 UI units ABOVE the plot rect. Push
    // the plot down by that overhang so the fence never covers the month bar.
    const fenceOverhang = 18 * s;
    const top =
      Math.max(header.y + header.h, monthBar.y + monthBar.h, past.y + past.h) +
      gap +
      fenceOverhang;
    const bottom = navBar.y - gap;
    const left = Math.max(gap, arrowL.x + arrowL.w + 2);
    const right = ui.viewW - gap;
    const plot: UiRect = {
      x: left,
      y: top,
      w: Math.max(40 * s, right - left),
      h: Math.max(40 * s, bottom - top),
      scale: s,
    };
    ui.registerHit(plot); // soil swallows taps; cells route via this.cells

    this.cells = [];
    ui.scaled(ctx, plot, (w, h) => {
      // Dirt + fence.
      const dirt = ensure(`${SHEET}/dirt-patch.png`);
      if (dirt) tiledPatch(ctx, dirt, 0, 0, w, h, 10);
      else {
        ctx.fillStyle = "#c9a26a";
        ctx.fillRect(px(0), px(0), px(w), px(h));
      }
      const fence = ensure(`${SHEET}/fence.png`);
      if (fence) fenceBorder(ctx, fence, 2, 6, w - 4, h - 2);

      // Weekday header row.
      const innerX = 8;
      const innerW = w - 16;
      const headY = 12;
      const cellW = Math.floor(innerW / 7);
      const gridX = innerX + Math.floor((innerW - cellW * 7) / 2);
      for (let i = 0; i < 7; i++) {
        drawText(ctx, WEEKDAYS[i] ?? "", gridX + i * cellW + cellW / 2, headY, {
          size: 6,
          color: "#8a6a42",
          align: "center",
        });
      }

      // Day grid. Cap cell height so tall viewports don't stretch each week
      // into a huge band; center the capped grid vertically in the plot.
      const firstWeekday = new Date(this.year, this.month0, 1).getDay();
      const daysInMonth = new Date(this.year, this.month0 + 1, 0).getDate();
      const rows = Math.ceil((firstWeekday + daysInMonth) / 7);
      const gridTop = headY + 10;
      const gridSpace = h - 6 - gridTop;
      const cellH = Math.max(16, Math.min(44, Math.floor(gridSpace / rows)));
      const gridY = gridTop + Math.max(0, Math.floor((gridSpace - cellH * rows) / 2));

      for (let d = 1; d <= daysInMonth; d++) {
        const slot = firstWeekday + d - 1;
        const col = slot % 7;
        const row = Math.floor(slot / 7);
        const r = rect(gridX + col * cellW, gridY + row * cellH, cellW, cellH);
        const date = isoDate(this.year, this.month0, d);
        const cell: Cell = {
          date,
          dayNum: d,
          // Hit rect in SCREEN px (the draw below uses local UI units).
          r: rect(plot.x + r.x * s, plot.y + r.y * s, r.w * s, r.h * s),
          day: this.days?.get(date) ?? null,
          future: date > this.today,
        };
        this.cells.push(cell);
        this.drawCell(ctx, cell, r);
      }
    });
  }

  /** One day cell, drawn in the plot's local UI units (`r`). */
  private drawCell(ctx: CanvasRenderingContext2D, cell: Cell, r: Rect): void {
    const isToday = cell.date === this.today;

    // Today gets a soft cream plot-marker frame.
    if (isToday) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = "#f5e5c5";
      ctx.strokeRect(px(r.x) + 0.5, px(r.y) + 0.5, px(r.w) - 1, px(r.h) - 1);
      ctx.restore();
    }

    // Day number, top-left corner of the cell (future days faded).
    drawText(ctx, String(cell.dayNum), r.x + 2, r.y + 2, {
      size: 6,
      color: isToday ? "#7a4a20" : "#5a4632",
      alpha: cell.future ? 0.3 : cell.day ? 0.9 : 0.55,
    });

    // Anchor the flower just under its own day number (not the cell bottom),
    // so a bloom never reads as belonging to the next week's row.
    const baseX = r.x + r.w / 2;
    const baseY = r.y + Math.min(r.h - 2, 28);

    if (!cell.day) {
      // Unjournaled past day → a tiny seed-dot in the soil.
      if (!cell.future) {
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = "#7a5a36";
        ctx.fillRect(px(baseX - 1), px(baseY - 2), 2, 2);
        ctx.restore();
      }
      return;
    }

    // Planted flower: hue from mood, growth from plant_stage, gentle sway.
    const hue = flowerHue(cell.day);
    const stage = flowerStage(cell.day);
    const img = ensure(`${SHEET}/flower-${hue}-${stage}.png`);
    const sway = Math.sin(this.t * 1.5 + cell.dayNum * 1.7) > 0.55 ? 1 : 0;
    if (img) {
      ctx.drawImage(img, px(baseX - img.width / 2 + sway), px(baseY - img.height));
    } else {
      ctx.fillStyle = HUE_COLOR[hue];
      ctx.fillRect(px(baseX - 1 + sway), px(baseY - 3 - stage), 3, 3);
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
}
