/**
 * GardenScene — the calendar of days as a cozy garden.
 *
 * `api.days()` → one flower per journaled day, planted in a fenced dirt plot
 * laid out as a month calendar (Sun..Sat columns). Flower growth stage comes
 * from `day.plant_stage` (flower-*-{1..4}.png) and the hue (pink/gold/green/
 * blue) from `day.mood_color`. Tap a journaled day (or today) → `day` nav
 * intent. The garden is the right half of the plaza↔garden panning world:
 * swipe horizontally or tap the left edge arrow → `plaza` intent. Month
 * arrows browse between the months that have data (and the current month).
 *
 * ENGINE-V2 NOTE: this scene is only minimally adapted to the two-space model
 * (a later pass refactors it properly). The world pass draws camera-tiled
 * grass; the whole old layout renders in `renderUI` under one ctx.scale(k, k)
 * at guiScale, with input mapped back through `scaleInput`.
 */

import { api, type ApiDay } from "../lib/api";
import { SHEET } from "../engine/assets";
import type { Camera } from "../engine/camera";
import { scaleInput, type Nav, type Scene, type SceneInput } from "../engine/scene";
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
} from "../engine/ui";

const SWIPE_PX = 45;

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

/** One calendar cell for the currently-viewed month. */
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

  // layout cache (filled by render; update bails until w > 0)
  private w = 0;
  /** guiScale the old art-px layout renders at (screen = art × k). */
  private k = 1;
  private plotRect: Rect = rect(0, 0, 0, 0);
  private pastRect: Rect = rect(0, 0, 0, 0);
  private arrowL: Rect = rect(0, 0, 0, 0);
  private prevRect: Rect = rect(0, 0, 0, 0);
  private nextRect: Rect = rect(0, 0, 0, 0);
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

  update(dt: number, rawInput: SceneInput): void {
    this.t += dt;
    if (this.w === 0) return; // waiting for the first render's layout
    const input = scaleInput(rawInput, this.k);

    // Horizontal swipe → back to the plaza (one continuous panning world).
    const de = input.dragEnd;
    if (de && Math.abs(de.dx) > SWIPE_PX && Math.abs(de.dx) > Math.abs(de.dy)) {
      this.nav.go({ kind: "plaza" });
      return;
    }

    const tap = input.tap;
    if (!tap) return;

    // Chrome first (drawn on top), plot cells last.
    if (hit(this.pastRect, tap)) return this.nav.go({ kind: "past" });
    if (hit(this.arrowL, tap)) return this.nav.go({ kind: "plaza" });
    if (hit(this.prevRect, tap)) return this.shiftMonth(-1);
    if (hit(this.nextRect, tap)) return this.shiftMonth(1);
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
  }

  /* ------------------------------------------------------------- render -- */

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

    const navH = 24;
    const monthBarY = 32;
    const monthBarH = 20;
    const plotTop = monthBarY + monthBarH + 4;
    this.plotRect = rect(8, plotTop, w - 16, h - plotTop - navH - 8);

    this.drawPlot(ctx);
    this.drawCalendar(ctx);
    this.drawChrome(ctx, w, h, navH, monthBarY, monthBarH);

    if (!this.days) this.drawNotice(ctx, w, h, this.error ?? "Watering the garden...");
    else if (this.days.size === 0) {
      this.drawNotice(ctx, w, h, "Nothing planted yet — live a day!");
    }
    ctx.restore();
  }

  /** The fenced dirt plot the calendar is planted in, plus light dressing. */
  private drawPlot(ctx: CanvasRenderingContext2D): void {
    const P = this.plotRect;
    const dirt = ensure(`${SHEET}/dirt-patch.png`);
    if (dirt) tiledPatch(ctx, dirt, P.x, P.y, P.w, P.h, 10);
    else {
      ctx.fillStyle = "#c9a26a";
      ctx.fillRect(px(P.x), px(P.y), px(P.w), px(P.h));
    }
    const fence = ensure(`${SHEET}/fence.png`);
    if (fence) fenceBorder(ctx, fence, P.x + 2, P.y + 6, P.w - 4, P.h - 2);
    // A couple of grass-strip decorations outside the plot.
    const at = (key: string, x: number, baseY: number): void => {
      const img = ensure(`${SHEET}/${key}.png`);
      if (img) ctx.drawImage(img, px(x - img.width / 2), px(baseY - img.height));
    };
    at("deco-mushroom", P.x + 4, P.y + P.h + 7);
    at("deco-daisies", P.x + P.w - 12, P.y + P.h + 8);
  }

  /** Weekday header + day cells + planted flowers for the viewed month. */
  private drawCalendar(ctx: CanvasRenderingContext2D): void {
    const P = this.plotRect;
    const innerX = P.x + 8;
    const innerW = P.w - 16;
    const headY = P.y + 12;

    const cellW = Math.floor(innerW / 7);
    const gridX = innerX + Math.floor((innerW - cellW * 7) / 2);

    for (let i = 0; i < 7; i++) {
      drawText(ctx, WEEKDAYS[i] ?? "", gridX + i * cellW + cellW / 2, headY, {
        size: 6,
        color: "#8a6a42",
        align: "center",
      });
    }

    const firstWeekday = new Date(this.year, this.month0, 1).getDay();
    const daysInMonth = new Date(this.year, this.month0 + 1, 0).getDate();
    const rows = Math.ceil((firstWeekday + daysInMonth) / 7);
    // Cap cell height so tall phone viewports don't stretch each week into a
    // huge band (number at top / flower at bottom drift apart); center the
    // capped grid vertically in the plot instead.
    const gridTop = headY + 10;
    const gridSpace = P.y + P.h - 6 - gridTop;
    const cellH = Math.max(16, Math.min(44, Math.floor(gridSpace / rows)));
    const gridY = gridTop + Math.max(0, Math.floor((gridSpace - cellH * rows) / 2));

    this.cells = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const slot = firstWeekday + d - 1;
      const col = slot % 7;
      const row = Math.floor(slot / 7);
      const r = rect(gridX + col * cellW, gridY + row * cellH, cellW, cellH);
      const date = isoDate(this.year, this.month0, d);
      const cell: Cell = {
        date,
        dayNum: d,
        r,
        day: this.days?.get(date) ?? null,
        future: date > this.today,
      };
      this.cells.push(cell);
      this.drawCell(ctx, cell);
    }
  }

  private drawCell(ctx: CanvasRenderingContext2D, cell: Cell): void {
    const { r } = cell;
    const isToday = cell.date === this.today;

    // Today gets a soft cream plot-marker frame.
    if (isToday) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = "#f5e5c5";
      ctx.strokeRect(px(r.x) + 0.5, px(r.y) + 0.5, px(r.w) - 1, px(r.h) - 1);
      ctx.restore();
    }

    // Day number, top-left corner of the cell.
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

  private drawChrome(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    navH: number,
    monthBarY: number,
    monthBarH: number,
  ): void {
    // Wooden SavePoint header (same as the plaza).
    const hw = Math.min(118, w - 56);
    const header = rect((w - hw) / 2, 5, hw, 22);
    button(ctx, header, "", { style: "dark" });
    drawText(ctx, "SavePoint", w / 2, 12, {
      size: 10,
      color: "#f5e5c5",
      align: "center",
      shadow: "#4a2e18",
    });

    // Past (top-right).
    this.pastRect = button(ctx, rect(w - 42, 6, 38, 20), "Past", { style: "tan" });

    // Month bar: < Mon YYYY > — arrows fade out at the browsable bounds.
    const label = `${MONTHS[this.month0] ?? "?"} ${this.year}`;
    this.prevRect = button(ctx, rect(8, monthBarY, 20, monthBarH), "", { style: "tan" });
    this.nextRect = button(ctx, rect(w - 28, monthBarY, 20, monthBarH), "", { style: "tan" });
    drawText(ctx, "<", this.prevRect.x + 7, monthBarY + 7, {
      size: 6,
      color: "#2a2140",
      alpha: this.monthIndex > this.minMonth ? 1 : 0.3,
    });
    drawText(ctx, ">", this.nextRect.x + 7, monthBarY + 7, {
      size: 6,
      color: "#2a2140",
      alpha: this.monthIndex < this.maxMonth ? 1 : 0.3,
    });
    drawText(ctx, label, w / 2, monthBarY + 6, {
      size: 8,
      color: "#f5e5c5",
      align: "center",
      shadow: "#4a2e18",
    });

    // Left edge arrow hinting the swipe back to the plaza.
    const midY = this.plotRect.y + this.plotRect.h / 2;
    this.arrowL = rect(0, midY - 14, 13, 28);
    const pulse = Math.floor(this.t * 2) % 2 === 0 ? 0 : 1;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "#2a2140";
    ctx.fillRect(px(this.arrowL.x), px(this.arrowL.y + 4), px(this.arrowL.w - 2), px(20));
    ctx.restore();
    drawText(ctx, "<", this.arrowL.x + 2 - pulse, midY - 3, { size: 8, color: "#f5e5c5" });

    // Bottom nav bar (Journal = this plaza/garden world).
    const bar = rect(-3, h - navH, w + 6, navH + 3);
    const panelImg = ensure(`${SHEET}/panel.png`);
    if (panelImg) {
      button(ctx, bar, "", { style: "tan" });
    } else {
      ctx.fillStyle = "#eec39a";
      ctx.fillRect(px(bar.x), px(bar.y), px(bar.w), px(bar.h));
    }
    const labels = ["Today", "Journal", "People"];
    this.navRects = labels.map((label, i) => {
      const r = rect((w / 3) * i, h - navH, w / 3, navH);
      const active = label === "Journal";
      drawText(ctx, label, r.x + r.w / 2, h - navH + 9, {
        size: 6,
        color: active ? "#7a4a20" : "#2a2140",
        align: "center",
      });
      if (active) {
        ctx.fillStyle = "#7a4a20";
        ctx.fillRect(px(r.x + r.w / 2 - 9), px(h - 7), 18, 2);
      }
      return { label, r };
    });
  }

  private drawNotice(ctx: CanvasRenderingContext2D, w: number, h: number, msg: string): void {
    const bw = Math.min(170, w - 20);
    const bh = 34;
    const bx = (w - bw) / 2;
    const by = h / 2 - 40;
    panel(ctx, bx, by, bw, bh);
    drawText(ctx, msg, w / 2, by + 14, { size: 6, color: "#5a4632", align: "center" });
  }
}
