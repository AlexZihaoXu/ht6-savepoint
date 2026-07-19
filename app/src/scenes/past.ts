/**
 * PastScene — the month-in-review archive (SAV-60's frontend, canvas edition).
 *
 * A month picker (prev / next + label) drives `api.monthSummary("YYYY-MM")`
 * and renders a "month in review": days journaled / total moments / people
 * count stat tiles, a podium of `top_people` (sprite + name + interactions,
 * 1st centered), and the busiest day as a tappable row → `day` nav intent.
 * A month with no data renders zero tiles + a gentle quiet-month note.
 * Back button → `back` nav intent.
 *
 * ENGINE-V2 NOTE: this scene is only minimally adapted to the two-space model
 * (a later pass refactors it properly). The world pass draws camera-tiled
 * grass; the whole old layout renders in `renderUI` under one ctx.scale(k, k)
 * at guiScale, with input mapped back through `scaleInput`.
 */

import { api, displayName, spriteUrl, type ApiMonthSummary } from "../lib/api";
import type { Camera } from "../engine/camera";
import { scaleInput, type Nav, type Scene, type SceneInput } from "../engine/scene";
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

/** Podium sprite height — the 92px tile at a clean 1:2. */
const SPRITE_H = 46;

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

  // layout cache (filled by render; update bails until w > 0)
  private w = 0;
  /** guiScale the old art-px layout renders at (screen = art × k). */
  private k = 1;
  private backRect: Rect = rect(0, 0, 0, 0);
  private prevRect: Rect = rect(0, 0, 0, 0);
  private nextRect: Rect = rect(0, 0, 0, 0);
  private busiestRect: Rect | null = null;

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

  update(_dt: number, rawInput: SceneInput): void {
    if (this.w === 0) return; // waiting for the first render's layout
    const input = scaleInput(rawInput, this.k);

    const tap = input.tap;
    if (!tap) return;

    if (hit(this.backRect, tap)) return this.nav.go({ kind: "back" });
    if (hit(this.prevRect, tap)) return this.pickMonth(-1);
    if (hit(this.nextRect, tap) && this.canGoNext()) return this.pickMonth(1);

    const busiest = this.summary?.busiest_day;
    if (this.busiestRect && busiest && hit(this.busiestRect, tap)) {
      return this.nav.go({ kind: "day", date: busiest.date });
    }
  }

  /* ------------------------------------------------------------- render -- */

  renderWorld(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    surface: PixelSurface,
  ): void {
    cam.zoom = cam.pickZoom();
    cam.centerOn(0, 0);
    drawWorldGrass(ctx, cam);
    // Soft dusk tint — the Past is an evening read.
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#2a2140";
    ctx.fillRect(0, 0, surface.viewW, surface.viewH);
    ctx.restore();
  }

  renderUI(ctx: CanvasRenderingContext2D, ui: UiContext): void {
    this.k = ui.guiScale;
    const w = Math.ceil(ui.viewW / this.k);
    const h = Math.ceil(ui.viewH / this.k);
    this.w = w;
    ctx.save();
    ctx.scale(this.k, this.k);
    this.renderBody(ctx, w, h);
    ctx.restore();
  }

  private renderBody(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.drawHeader(ctx, w);
    this.drawPicker(ctx, w);

    const top = 92; // below header + picker
    if (!this.summary) {
      this.busiestRect = null;
      this.drawNotice(
        ctx,
        w,
        h,
        this.error ?? "Leafing through the archive...",
      );
      return;
    }

    const statsBottom = this.drawStats(ctx, w, top, this.summary);
    const empty =
      this.summary.days_journaled === 0 && this.summary.total_events === 0;

    if (empty) {
      this.busiestRect = null;
      this.drawQuietMonth(ctx, w, statsBottom + 8);
      return;
    }

    const podiumBottom = this.drawPodium(ctx, w, statsBottom + 8, this.summary);
    this.drawBusiest(ctx, w, podiumBottom + 8, this.summary);
  }

  private drawHeader(ctx: CanvasRenderingContext2D, w: number): void {
    const hw = Math.min(118, w - 56);
    button(ctx, rect((w - hw) / 2, 5, hw, 22), "", { style: "dark" });
    drawText(ctx, "Past", w / 2, 12, {
      size: 10,
      color: "#f5e5c5",
      align: "center",
      shadow: "#4a2e18",
    });

    // Back (top-left).
    this.backRect = button(ctx, rect(4, 6, 20, 20), "", { style: "tan" });
    drawText(ctx, "<", this.backRect.x + 7, this.backRect.y + 7, {
      size: 8,
      color: "#2a2140",
    });
  }

  private drawPicker(ctx: CanvasRenderingContext2D, w: number): void {
    const y = 36;
    this.prevRect = button(ctx, rect(8, y, 20, 20), "", { style: "tan" });
    drawText(ctx, "<", this.prevRect.x + 7, y + 7, {
      size: 8,
      color: "#2a2140",
    });

    const nextOn = this.canGoNext();
    ctx.save();
    if (!nextOn) ctx.globalAlpha = 0.45;
    this.nextRect = button(ctx, rect(w - 28, y, 20, 20), "", { style: "tan" });
    drawText(ctx, ">", this.nextRect.x + 7, y + 7, {
      size: 8,
      color: "#2a2140",
    });
    ctx.restore();

    const label = monthLabel(this.month);
    const labelRect = rect(32, y, w - 64, 20);
    button(ctx, labelRect, "", { style: "dark" });
    const size = measure(label, 8) <= labelRect.w - 8 ? 8 : 6;
    drawText(ctx, label, w / 2, y + (20 - size) / 2, {
      size,
      color: "#f5e5c5",
      align: "center",
    });

    drawText(ctx, "month in review", w / 2, y + 24, {
      size: 6,
      color: "#f5e5c5",
      align: "center",
      alpha: 0.8,
    });
  }

  /** Three stat tiles: days / moments / people. Returns their bottom edge. */
  private drawStats(
    ctx: CanvasRenderingContext2D,
    w: number,
    y: number,
    sum: ApiMonthSummary,
  ): number {
    const gap = 4;
    const x0 = 8;
    const tileW = Math.floor((w - x0 * 2 - gap * 2) / 3);
    const tileH = 30;
    const stats: { n: number; label: string }[] = [
      { n: sum.days_journaled, label: "days" },
      { n: sum.total_events, label: "moments" },
      { n: sum.people_count, label: "people" },
    ];
    stats.forEach((st, i) => {
      const x = x0 + i * (tileW + gap);
      panel(ctx, x, y, tileW, tileH);
      drawText(ctx, String(st.n), x + tileW / 2, y + 6, {
        size: 10,
        color: "#7a4a20",
        align: "center",
      });
      drawText(ctx, st.label, x + tileW / 2, y + 19, {
        size: 6,
        color: "#5a4632",
        align: "center",
      });
    });
    return y + tileH;
  }

  /** Podium of top people (1st centered). Returns the panel's bottom edge. */
  private drawPodium(
    ctx: CanvasRenderingContext2D,
    w: number,
    y: number,
    sum: ApiMonthSummary,
  ): number {
    const podium = sum.top_people.slice(0, 3);
    const extras = sum.top_people.slice(3);
    const P = rect(8, y, w - 16, 104 + (podium.length > 0 ? 0 : -48) + extras.length * 10);
    panel(ctx, P.x, P.y, P.w, P.h);
    drawText(ctx, "Top people", P.x + P.w / 2, P.y + 6, {
      size: 6,
      color: "#5a4632",
      align: "center",
    });

    if (podium.length === 0) {
      drawText(ctx, "Nobody made the podium.", P.x + P.w / 2, P.y + 26, {
        size: 6,
        color: "#5a4632",
        align: "center",
      });
      return P.y + P.h;
    }

    // Rank → column center + pedestal height (1st centered and tallest).
    const baseline = P.y + P.h - 26 - extras.length * 10;
    const cols = [
      { cx: P.x + P.w * 0.5, ped: 20 }, // 1st
      { cx: P.x + P.w * 0.2, ped: 12 }, // 2nd
      { cx: P.x + P.w * 0.8, ped: 6 }, // 3rd
    ];
    const pedW = Math.min(34, Math.floor(P.w / 4));
    const maxChars = Math.max(3, Math.floor((P.w / 3 - 2) / 6));

    podium.forEach((tp, i) => {
      const col = cols[i];
      if (!col) return;
      const pedTop = baseline - col.ped;

      // Pedestal: dirt block with an ink outline + rank number.
      ctx.fillStyle = "#2a2140";
      ctx.fillRect(px(col.cx - pedW / 2) - 1, px(pedTop) - 1, px(pedW) + 2, px(col.ped) + 1);
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
      const rowY = P.y + P.h - 8 - (extras.length - i) * 10 + 2;
      const name = displayName(tp.person);
      const maxRow = Math.max(4, Math.floor((P.w - 40) / 6));
      const short =
        name.length > maxRow ? `${name.slice(0, maxRow - 1)}.` : name;
      drawText(ctx, `${i + 4}. ${short}`, P.x + 8, rowY, {
        size: 6,
        color: "#5a4632",
      });
      drawText(ctx, `x${tp.interactions}`, P.x + P.w - 8, rowY, {
        size: 6,
        color: "#7a4a20",
        align: "right",
      });
    });

    return P.y + P.h;
  }

  /** The busiest-day row — tappable, deep-links into that day. */
  private drawBusiest(
    ctx: CanvasRenderingContext2D,
    w: number,
    y: number,
    sum: ApiMonthSummary,
  ): void {
    const busiest = sum.busiest_day;
    if (!busiest) {
      this.busiestRect = null;
      return;
    }
    const r = rect(8, y, w - 16, 24);
    this.busiestRect = button(ctx, r, "", { style: "blue" });
    const label = `Busiest: ${shortDate(busiest.date)} (${busiest.events})`;
    const size = measure(label, 8) <= r.w - 16 ? 8 : 6;
    drawText(ctx, label, r.x + r.w / 2 - 4, y + (r.h - size) / 2, {
      size,
      color: "#1c2a4a",
      align: "center",
    });
    drawText(ctx, ">", r.x + r.w - 12, y + (r.h - 8) / 2, {
      size: 8,
      color: "#1c2a4a",
    });
  }

  private drawQuietMonth(
    ctx: CanvasRenderingContext2D,
    w: number,
    y: number,
  ): void {
    const P = rect(8, y, w - 16, 44);
    panel(ctx, P.x, P.y, P.w, P.h);
    drawText(ctx, "A quiet month...", P.x + P.w / 2, P.y + 12, {
      size: 8,
      color: "#5a4632",
      align: "center",
    });
    drawText(ctx, "no moments saved here yet", P.x + P.w / 2, P.y + 26, {
      size: 6,
      color: "#5a4632",
      align: "center",
    });
  }

  private drawNotice(
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
    drawText(ctx, msg, w / 2, by + 14, {
      size: 6,
      color: "#5a4632",
      align: "center",
    });
  }
}
