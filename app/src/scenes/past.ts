/**
 * PastScene — the month-in-review archive (SAV-60's frontend, canvas edition).
 *
 * Engine-v2 TWO-space scene (CANVAS_ARCH_V2.md), structured like PlazaScene:
 *
 * WORLD (drawn under the Camera): grass tiled across the entire viewport via
 * `drawWorldGrass` (fills any aspect ratio, no letterbox), under a soft dusk
 * tint — the Past is an evening read.
 *
 * UI (drawn via the UiContext at guiScale, anchored + auto-laid-out): a "Past"
 * header (top-center) + back button (top-left), then a top-center content
 * column the overlap pass stacks vertically: month picker (‹ label ›, drives
 * `api.monthSummary("YYYY-MM")`), three stat tiles (days journaled / moments /
 * people), a podium of `top_people` (sprite + name + interactions, 1st
 * centered), and the busiest day as a tappable row → `day` nav intent. A month
 * with no data renders zero tiles + a gentle quiet-month note. Nothing ever
 * overlaps or clips: each element is placed with `ui.place`, which clamps into
 * the viewport and drops that element's scale when the window is small.
 *
 * Input routing: own UI rects first (screen px, cached from renderUI), then
 * `input.onUi` as the chrome catch-all; this scene has no tappable world.
 */

import { api, displayName, spriteUrl, type ApiMonthSummary } from "../lib/api";
import type { Camera } from "../engine/camera";
import type { Nav, Scene, SceneInput } from "../engine/scene";
import { drawPersonSprite } from "../engine/sprite";
import { px, type PixelSurface } from "../engine/surface";
import { drawText, measure } from "../engine/text";
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

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Podium sprite height in UI units — the 92px tile at a clean 1:2. */
const SPRITE_H = 46;
/** Widest the content column gets, UI units (narrow windows use less). */
const CONTENT_MAX = 220;

/** "YYYY-MM" for the local current month. */
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Shift a "YYYY-MM" month by `delta` months (Date normalizes overflow). */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-");
  const d = new Date(Number(y ?? "2026"), Number(m ?? "1") - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "July 2026" from "2026-07". */
function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  const name = MONTH_NAMES[Number(m ?? "1") - 1] ?? month;
  return `${name} ${y ?? ""}`.trim();
}

/** "Jul 18" from "2026-07-18". */
function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  const name = MONTH_SHORT[Number(m ?? "1") - 1] ?? "?";
  return `${name} ${Number(d ?? "1")}`;
}

export function createPastScene(nav: Nav): Scene {
  return new PastScene(nav);
}

class PastScene implements Scene {
  private nav: Nav;

  // data
  private month = currentMonth();
  private summary: ApiMonthSummary | null = null;
  private error: string | null = null;
  /** Guards against a slow response landing after a newer month was picked. */
  private fetchSeq = 0;

  // UI hit rects (SCREEN px, cached from renderUI; update bails until ready)
  private ready = false;
  private backRect: UiRect | null = null;
  private prevRect: Rect | null = null;
  private nextRect: Rect | null = null;
  private busiestRect: UiRect | null = null;

  constructor(nav: Nav) {
    this.nav = nav;
  }

  enter(): void {
    this.load();
  }

  /* ------------------------------------------------------------- data ---- */

  private load(): void {
    const seq = ++this.fetchSeq;
    this.summary = null;
    this.error = null;
    void api
      .monthSummary(this.month)
      .then((s) => {
        if (seq !== this.fetchSeq) return;
        this.summary = s;
        this.preloadSprites(s);
      })
      .catch(() => {
        if (seq !== this.fetchSeq) return;
        this.error = "The archive is out of reach...";
      });
  }

  /** Warm the podium's idle frames so winners never pop in. */
  private preloadSprites(s: ApiMonthSummary): void {
    for (const { person } of s.top_people) {
      if (person.sprite) {
        ensure(spriteUrl(person.local_id, person.sprite.static.south));
      }
    }
  }

  /** No months beyond the current one — there's no future to review. */
  private canGoNext(): boolean {
    return this.month < currentMonth();
  }

  private pickMonth(delta: number): void {
    const next = shiftMonth(this.month, delta);
    if (delta > 0 && next > currentMonth()) return;
    this.month = next;
    this.load();
  }

  /* ------------------------------------------------------------- update -- */

  update(_dt: number, input: SceneInput): void {
    const tap = input.tap;
    if (!tap || !this.ready) return;

    // UI first, in screen space (this scene has no tappable world).
    if (this.backRect && hit(this.backRect, tap)) {
      return this.nav.go({ kind: "back" });
    }
    if (this.prevRect && hit(this.prevRect, tap)) return this.pickMonth(-1);
    if (this.nextRect && hit(this.nextRect, tap)) {
      if (this.canGoNext()) this.pickMonth(1);
      return;
    }
    const busiest = this.summary?.busiest_day;
    if (this.busiestRect && busiest && hit(this.busiestRect, tap)) {
      return this.nav.go({ kind: "day", date: busiest.date });
    }
    // Any other chrome (header, panels) swallows the tap.
    if (input.onUi(tap)) return;
  }

  /* -------------------------------------------------------- renderWorld -- */

  renderWorld(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    surface: PixelSurface,
  ): void {
    // Integer zoom from the viewport; nothing to focus on — hold the origin.
    cam.zoom = cam.pickZoom();
    cam.centerOn(0, 0);

    // Grass over the WHOLE viewport (no letterbox at any aspect ratio).
    drawWorldGrass(ctx, cam);

    // Soft dusk tint — the Past is an evening read.
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#2a2140";
    ctx.fillRect(0, 0, surface.viewW, surface.viewH);
    ctx.restore();
  }

  /* ----------------------------------------------------------- renderUI -- */

  renderUI(ctx: CanvasRenderingContext2D, ui: UiContext): void {
    this.ready = true;

    // Content-column width in UI units: near-full on phones, capped on wide.
    const contentW = Math.min(
      CONTENT_MAX,
      Math.floor(ui.viewW / ui.guiScale) - 8,
    );

    // "Past" header, top-center (the overlap pass stacks the column below it).
    const header = ui.place("top-center", 96, 22, { margin: 5 });
    ui.scaled(ctx, header, (w, h) => {
      button(ctx, rect(0, 0, w, h), "", { style: "dark" });
      drawText(ctx, "Past", w / 2, (h - 10) / 2 + 1, {
        size: 10,
        color: "#f5e5c5",
        align: "center",
        shadow: "#4a2e18",
      });
    });
    ui.registerHit(header); // header swallows taps

    // Back, top-left.
    this.backRect = ui.place("top-left", 20, 20, { margin: 4 });
    ui.scaled(ctx, this.backRect, (w, h) => {
      button(ctx, rect(0, 0, w, h), "", { style: "tan" });
      drawText(ctx, "<", Math.round(w / 2) - 3, Math.round((h - 8) / 2), {
        size: 8,
        color: "#2a2140",
      });
    });
    ui.registerHit(this.backRect);

    // Month picker (‹ label ›) + caption, one placed row.
    this.drawPicker(ctx, ui, contentW);

    if (!this.summary) {
      this.busiestRect = null;
      this.drawNotice(ctx, ui, this.error ?? "Leafing through the archive...");
      return;
    }

    this.drawStats(ctx, ui, contentW, this.summary);

    const empty =
      this.summary.days_journaled === 0 && this.summary.total_events === 0;
    if (empty) {
      this.busiestRect = null;
      this.drawQuietMonth(ctx, ui, contentW);
      return;
    }

    this.drawPodium(ctx, ui, contentW, this.summary);
    this.drawBusiest(ctx, ui, contentW, this.summary);
  }

  /** Prev / month-label / next in one anchored row, caption underneath. */
  private drawPicker(
    ctx: CanvasRenderingContext2D,
    ui: UiContext,
    contentW: number,
  ): void {
    const r = ui.place("top-center", contentW, 32, { margin: 4 });
    const bh = 20; // button row height, UI units
    ui.scaled(ctx, r, (w) => {
      // Prev (always on — the archive reaches back).
      button(ctx, rect(0, 0, 20, bh), "", { style: "tan" });
      drawText(ctx, "<", 7, 6, { size: 8, color: "#2a2140" });

      // Next (dimmed at the current month).
      const nextOn = this.canGoNext();
      ctx.save();
      if (!nextOn) ctx.globalAlpha = 0.45;
      button(ctx, rect(w - 20, 0, 20, bh), "", { style: "tan" });
      drawText(ctx, ">", w - 13, 6, { size: 8, color: "#2a2140" });
      ctx.restore();

      // Month label between the arrows.
      const lr = rect(24, 0, w - 48, bh);
      button(ctx, lr, "", { style: "dark" });
      const label = monthLabel(this.month);
      const size = measure(label, 8) <= lr.w - 8 ? 8 : 6;
      drawText(ctx, label, w / 2, (bh - size) / 2, {
        size,
        color: "#f5e5c5",
        align: "center",
      });

      drawText(ctx, "month in review", w / 2, bh + 4, {
        size: 6,
        color: "#f5e5c5",
        align: "center",
        alpha: 0.8,
      });
    });
    // Arrow hit zones in screen px (label + caption just swallow).
    const s = r.scale;
    this.prevRect = rect(r.x, r.y, 20 * s, bh * s);
    this.nextRect = rect(r.x + r.w - 20 * s, r.y, 20 * s, bh * s);
    ui.registerHit(r);
  }

  /** Three stat tiles: days / moments / people. */
  private drawStats(
    ctx: CanvasRenderingContext2D,
    ui: UiContext,
    contentW: number,
    sum: ApiMonthSummary,
  ): void {
    const r = ui.place("top-center", contentW, 30, { margin: 4 });
    ui.scaled(ctx, r, (w, h) => {
      const gap = 4;
      const tileW = Math.floor((w - gap * 2) / 3);
      const x0 = Math.floor((w - (tileW * 3 + gap * 2)) / 2);
      const stats: { n: number; label: string }[] = [
        { n: sum.days_journaled, label: "days" },
        { n: sum.total_events, label: "moments" },
        { n: sum.people_count, label: "people" },
      ];
      stats.forEach((st, i) => {
        const x = x0 + i * (tileW + gap);
        panel(ctx, x, 0, tileW, h);
        drawText(ctx, String(st.n), x + tileW / 2, 6, {
          size: 10,
          color: "#7a4a20",
          align: "center",
        });
        drawText(ctx, st.label, x + tileW / 2, 19, {
          size: 6,
          color: "#5a4632",
          align: "center",
        });
      });
    });
    ui.registerHit(r); // tiles swallow taps
  }

  /** Podium of top people (1st centered) + compact 4th/5th rows. */
  private drawPodium(
    ctx: CanvasRenderingContext2D,
    ui: UiContext,
    contentW: number,
    sum: ApiMonthSummary,
  ): void {
    const podium = sum.top_people.slice(0, 3);
    const extras = sum.top_people.slice(3);
    const height = 104 + (podium.length > 0 ? 0 : -48) + extras.length * 10;
    const r = ui.place("top-center", contentW, height, { margin: 4 });

    ui.scaled(ctx, r, (w, h) => {
      panel(ctx, 0, 0, w, h);
      drawText(ctx, "Top people", w / 2, 6, {
        size: 6,
        color: "#5a4632",
        align: "center",
      });

      if (podium.length === 0) {
        drawText(ctx, "Nobody made the podium.", w / 2, 26, {
          size: 6,
          color: "#5a4632",
          align: "center",
        });
        return;
      }

      // Rank → column center + pedestal height (1st centered and tallest).
      const baseline = h - 26 - extras.length * 10;
      const cols = [
        { cx: w * 0.5, ped: 20 }, // 1st
        { cx: w * 0.2, ped: 12 }, // 2nd
        { cx: w * 0.8, ped: 6 }, // 3rd
      ];
      const pedW = Math.min(34, Math.floor(w / 4));
      const maxChars = Math.max(3, Math.floor((w / 3 - 2) / 6));

      podium.forEach((tp, i) => {
        const col = cols[i];
        if (!col) return;
        const pedTop = baseline - col.ped;

        // Pedestal: dirt block with an ink outline + rank number.
        ctx.fillStyle = "#2a2140";
        ctx.fillRect(
          px(col.cx - pedW / 2) - 1,
          px(pedTop) - 1,
          px(pedW) + 2,
          px(col.ped) + 1,
        );
        ctx.fillStyle = "#c9a26a";
        ctx.fillRect(px(col.cx - pedW / 2), px(pedTop), px(pedW), px(col.ped));
        if (col.ped >= 10) {
          drawText(ctx, String(i + 1), col.cx, pedTop + (col.ped - 6) / 2, {
            size: 6,
            color: "#7a4a20",
            align: "center",
          });
        }

        // Winner standing on the pedestal (idle, front-facing).
        drawPersonSprite(ctx, tp.person, col.cx, pedTop, { height: SPRITE_H });

        // Name + interactions under the baseline.
        const name = displayName(tp.person);
        const short =
          name.length > maxChars ? `${name.slice(0, maxChars - 1)}.` : name;
        drawText(ctx, short, col.cx, baseline + 3, {
          size: 6,
          color: "#2a2140",
          align: "center",
        });
        drawText(ctx, `x${tp.interactions}`, col.cx, baseline + 11, {
          size: 6,
          color: "#7a4a20",
          align: "center",
        });
      });

      // Runners-up (4th/5th) as compact rows.
      extras.forEach((tp, i) => {
        const rowY = h - 8 - (extras.length - i) * 10 + 2;
        const name = displayName(tp.person);
        const maxRow = Math.max(4, Math.floor((w - 40) / 6));
        const short =
          name.length > maxRow ? `${name.slice(0, maxRow - 1)}.` : name;
        drawText(ctx, `${i + 4}. ${short}`, 8, rowY, {
          size: 6,
          color: "#5a4632",
        });
        drawText(ctx, `x${tp.interactions}`, w - 8, rowY, {
          size: 6,
          color: "#7a4a20",
          align: "right",
        });
      });
    });
    ui.registerHit(r); // the podium panel swallows taps
  }

  /** The busiest-day row — tappable, deep-links into that day. */
  private drawBusiest(
    ctx: CanvasRenderingContext2D,
    ui: UiContext,
    contentW: number,
    sum: ApiMonthSummary,
  ): void {
    const busiest = sum.busiest_day;
    if (!busiest) {
      this.busiestRect = null;
      return;
    }
    const r = ui.place("top-center", contentW, 24, { margin: 4 });
    ui.scaled(ctx, r, (w, h) => {
      button(ctx, rect(0, 0, w, h), "", { style: "blue" });
      const label = `Busiest: ${shortDate(busiest.date)} (${busiest.events})`;
      const size = measure(label, 8) <= w - 24 ? 8 : 6;
      drawText(ctx, label, w / 2 - 4, (h - size) / 2, {
        size,
        color: "#1c2a4a",
        align: "center",
      });
      drawText(ctx, ">", w - 12, (h - 8) / 2, { size: 8, color: "#1c2a4a" });
    });
    ui.registerHit(r);
    this.busiestRect = r;
  }

  /** Zero-data month: a gentle note under the zero tiles. */
  private drawQuietMonth(
    ctx: CanvasRenderingContext2D,
    ui: UiContext,
    contentW: number,
  ): void {
    const r = ui.place("top-center", contentW, 44, { margin: 4 });
    ui.scaled(ctx, r, (w, h) => {
      panel(ctx, 0, 0, w, h);
      drawText(ctx, "A quiet month...", w / 2, 12, {
        size: 8,
        color: "#5a4632",
        align: "center",
      });
      drawText(ctx, "no moments saved here yet", w / 2, 26, {
        size: 6,
        color: "#5a4632",
        align: "center",
      });
    });
    ui.registerHit(r);
  }

  /** Loading / error notice, centered. */
  private drawNotice(
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
}
